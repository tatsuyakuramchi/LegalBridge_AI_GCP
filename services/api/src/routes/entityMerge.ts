/**
 * entityMerge — 重複レコードの「ID統合(マージ)」モジュール。
 *
 * 依頼(issue) / 案件(matter) / 原作(source_ip) / 作品(work) を、不用意に二重登録した際に、
 * 片方(loser)を残す方(survivor)へ統合する。要は「関連する外部キーを survivor へ付け替えてから
 * loser を消す」ことで、文書番号(documents)や条件明細(condition_lines)などが孤立するのを防ぐ。
 *
 * 設計:
 *   - 参照列は FK 制約が張られていない論理参照も多いため、実行時に information_schema から
 *     「その実体を指す既知の列名(work_id / source_work_id / matter_id / backlog_issue_key 等)」を
 *     持つ BASE TABLE を動的発見して付け替える(ビューは除外)。
 *   - preview: 読み取りのみ。どのテーブル・列を何件付け替えるかを返す(安全に事前確認)。
 *   - execute: 1トランザクション。テーブルごとに SAVEPOINT で付け替え、UNIQUE 衝突は
 *     conflicts に記録して継続。最後に loser 本体を削除(id 基盤の実体のみ)。confirm 必須。
 */
import type { Express, RequestHandler } from "express";
import express from "express";
import { pool } from "../lib/db.ts";

type Query = (text: string, params?: any[]) => Promise<any>;
type Middleware = RequestHandler;

// 実体ごとの設定。refIntCols=その実体の id(int)を指す列。refCodeCols=別キー(コード/文字列)参照。
const ENTITIES: Record<
  string,
  {
    label: string;
    table: string | null; // 本体テーブル(id 基盤)。issue は Backlog キー基盤で null。
    pk: string | null;
    idType: "int" | "string";
    kindFilter?: string; // works を原作/作品で使い分けるための kind
    refIntCols: string[];
    refCodeCols: string[]; // 文字列コード参照(work_code/ledger_code/backlog_issue_key/issue_key 等)
    codeSourceCol?: string; // survivor/loser のコードを引く本体列(works.work_code)
    ledger?: boolean; // 原作: ledgers(LO) の付け替え/削除も行う
  }
> = {
  matter: {
    label: "案件",
    table: "matters",
    pk: "id",
    idType: "int",
    refIntCols: ["matter_id"],
    refCodeCols: [],
  },
  work: {
    label: "作品",
    table: "works",
    pk: "id",
    idType: "int",
    kindFilter: "own",
    refIntCols: ["work_id", "source_work_id", "linked_work_id"],
    refCodeCols: ["work_code"],
    codeSourceCol: "work_code",
  },
  source_ip: {
    label: "原作",
    table: "works",
    pk: "id",
    idType: "int",
    kindFilter: "licensed_in",
    refIntCols: ["work_id", "source_work_id", "linked_work_id"],
    refCodeCols: ["work_code", "ledger_code"],
    codeSourceCol: "work_code",
    ledger: true,
  },
  issue: {
    label: "依頼",
    table: null,
    pk: null,
    idType: "string",
    refIntCols: [],
    refCodeCols: ["backlog_issue_key", "issue_key"],
  },
};

const IDENT = /^[a-z_][a-z0-9_]*$/; // catalog 由来の識別子を二重引用する前の安全確認
const qi = (s: string) => {
  if (!IDENT.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return `"${s}"`;
};

// 指定した列名を持つ BASE TABLE(ビュー除外) を発見。
async function discoverRefTables(
  query: Query,
  cols: string[]
): Promise<Array<{ table: string; column: string }>> {
  if (!cols.length) return [];
  const r = await query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.column_name = ANY($1)
      ORDER BY c.table_name, c.column_name`,
    [cols]
  );
  return r.rows.map((x: any) => ({ table: x.table_name, column: x.column_name }));
}

export function registerEntityMergeRoutes(
  app: Express,
  deps: { query: Query; requireWrite: Middleware[]; requireRead?: Middleware[] }
): void {
  const { query, requireWrite } = deps;
  const requireRead = deps.requireRead ?? [];
  const fail = (res: any, e: unknown) => res.status(500).json({ ok: false, error: String(e) });

  // 対応実体と参照列の一覧(イントロスペクション)。
  app.get("/api/v3/merge/entities", ...requireRead, async (_req, res) => {
    res.json({
      ok: true,
      entities: Object.entries(ENTITIES).map(([key, c]) => ({
        key,
        label: c.label,
        idType: c.idType,
        refIntCols: c.refIntCols,
        refCodeCols: c.refCodeCols,
      })),
    });
  });

  // 本体レコードのコード(work_code 等)を引く。
  const resolveCode = async (cfg: any, id: any): Promise<string | null> => {
    if (!cfg.table || !cfg.codeSourceCol) return null;
    const r = await query(
      `SELECT ${qi(cfg.codeSourceCol)} AS code FROM ${qi(cfg.table)} WHERE ${qi(cfg.pk)} = $1`,
      [id]
    );
    return r.rows[0]?.code ?? null;
  };

  // 付け替え対象(テーブル/列/照合キー)を組み立てる。
  const buildTargets = async (
    cfg: any,
    survivorId: any,
    loserId: any
  ): Promise<Array<{ table: string; column: string; loseVal: any; survVal: any; keyType: "int" | "string" }>> => {
    const targets: Array<{ table: string; column: string; loseVal: any; survVal: any; keyType: "int" | "string" }> = [];
    // int 参照(この実体の id)
    if (cfg.refIntCols.length) {
      const t = await discoverRefTables(query, cfg.refIntCols);
      for (const r of t) {
        // 本体テーブル自身は除外(自己参照列でない限り)。
        if (r.table === cfg.table) continue;
        targets.push({ table: r.table, column: r.column, loseVal: loserId, survVal: survivorId, keyType: "int" });
      }
    }
    // code 参照(文字列)
    if (cfg.refCodeCols.length) {
      // issue はキー自体がコード。work/source_ip は work_code を引く。
      const loseCode = cfg.idType === "string" ? String(loserId) : await resolveCode(cfg, loserId);
      const survCode = cfg.idType === "string" ? String(survivorId) : await resolveCode(cfg, survivorId);
      if (loseCode && survCode) {
        const t = await discoverRefTables(query, cfg.refCodeCols);
        for (const r of t) {
          if (r.table === cfg.table) continue;
          targets.push({ table: r.table, column: r.column, loseVal: loseCode, survVal: survCode, keyType: "string" });
        }
      }
    }
    return targets;
  };

  // preview: 付け替え対象と件数(読み取りのみ)。
  app.post("/api/v3/merge/preview", ...requireWrite, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const cfg = ENTITIES[String(b.entity)];
      if (!cfg) return res.status(400).json({ ok: false, error: "unknown entity" });
      const survivorId = cfg.idType === "int" ? Number(b.survivorId) : String(b.survivorId ?? "");
      const loserId = cfg.idType === "int" ? Number(b.loserId) : String(b.loserId ?? "");
      if (cfg.idType === "int" && (!Number.isFinite(survivorId) || !Number.isFinite(loserId))) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      if (String(survivorId) === String(loserId)) {
        return res.status(400).json({ ok: false, error: "survivor と loser が同一です" });
      }
      const targets = await buildTargets(cfg, survivorId, loserId);
      const refs: Array<{ table: string; column: string; count: number; keyType: string }> = [];
      for (const t of targets) {
        const c = await query(
          `SELECT count(*)::int AS n FROM ${qi(t.table)} WHERE ${qi(t.column)} = $1`,
          [t.loseVal]
        );
        const n = c.rows[0]?.n ?? 0;
        if (n > 0) refs.push({ table: t.table, column: t.column, count: n, keyType: t.keyType });
      }
      const total = refs.reduce((s, r) => s + r.count, 0);
      res.json({ ok: true, entity: b.entity, survivorId, loserId, refs, total });
    } catch (e) {
      fail(res, e);
    }
  });

  // execute: トランザクションで付け替え→loser 削除。confirm 必須。
  app.post("/api/v3/merge/execute", ...requireWrite, express.json(), async (req, res) => {
    const b = req.body || {};
    const cfg = ENTITIES[String(b.entity)];
    if (!cfg) return res.status(400).json({ ok: false, error: "unknown entity" });
    if (b.confirm !== true) return res.status(400).json({ ok: false, error: "confirm=true が必要です" });
    const survivorId = cfg.idType === "int" ? Number(b.survivorId) : String(b.survivorId ?? "");
    const loserId = cfg.idType === "int" ? Number(b.loserId) : String(b.loserId ?? "");
    if (cfg.idType === "int" && (!Number.isFinite(survivorId) || !Number.isFinite(loserId))) {
      return res.status(400).json({ ok: false, error: "invalid id" });
    }
    if (String(survivorId) === String(loserId)) {
      return res.status(400).json({ ok: false, error: "survivor と loser が同一です" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const targets = await buildTargets(cfg, survivorId, loserId);
      const moved: Array<{ table: string; column: string; updated: number }> = [];
      const conflicts: Array<{ table: string; column: string; error: string }> = [];

      for (const t of targets) {
        await client.query("SAVEPOINT s");
        try {
          const r = await client.query(
            `UPDATE ${qi(t.table)} SET ${qi(t.column)} = $1 WHERE ${qi(t.column)} = $2`,
            [t.survVal, t.loseVal]
          );
          moved.push({ table: t.table, column: t.column, updated: r.rowCount || 0 });
          await client.query("RELEASE SAVEPOINT s");
        } catch (e: any) {
          // UNIQUE 衝突等: この列だけロールバックして継続(loser 側の衝突行は本体削除まで残置)。
          await client.query("ROLLBACK TO SAVEPOINT s");
          conflicts.push({ table: t.table, column: t.column, error: String(e?.message || e) });
        }
      }

      // 原作: ledgers(LO) の付け替え + loser 台帳の削除。
      if (cfg.ledger) {
        await client.query("SAVEPOINT lg");
        try {
          const loseCode = await (async () => {
            const r = await client.query(`SELECT work_code FROM works WHERE id = $1`, [loserId]);
            return r.rows[0]?.work_code ?? null;
          })();
          const survCode = await (async () => {
            const r = await client.query(`SELECT work_code FROM works WHERE id = $1`, [survivorId]);
            return r.rows[0]?.work_code ?? null;
          })();
          if (loseCode && survCode) {
            const lg = await client.query(`SELECT id FROM ledgers WHERE ledger_code = $1`, [loseCode]);
            const sv = await client.query(`SELECT id FROM ledgers WHERE ledger_code = $1`, [survCode]);
            const loseLid = lg.rows[0]?.id;
            const survLid = sv.rows[0]?.id;
            if (loseLid && survLid) {
              const refs = await discoverRefTables(query, ["ledger_ref_id"]);
              for (const r of refs) {
                await client.query("SAVEPOINT lr");
                try {
                  const u = await client.query(
                    `UPDATE ${qi(r.table)} SET ${qi(r.column)} = $1 WHERE ${qi(r.column)} = $2`,
                    [survLid, loseLid]
                  );
                  moved.push({ table: r.table, column: r.column, updated: u.rowCount || 0 });
                  await client.query("RELEASE SAVEPOINT lr");
                } catch (e: any) {
                  await client.query("ROLLBACK TO SAVEPOINT lr");
                  conflicts.push({ table: r.table, column: r.column, error: String(e?.message || e) });
                }
              }
              await client.query(`DELETE FROM ledgers WHERE id = $1`, [loseLid]);
              moved.push({ table: "ledgers", column: "(loser削除)", updated: 1 });
            }
          }
          await client.query("RELEASE SAVEPOINT lg");
        } catch (e: any) {
          await client.query("ROLLBACK TO SAVEPOINT lg");
          conflicts.push({ table: "ledgers", column: "(merge)", error: String(e?.message || e) });
        }
      }

      // loser 本体を削除(id 基盤の実体のみ。issue は Backlog 側のためローカル削除なし)。
      let deletedLoser = false;
      if (cfg.table && cfg.pk) {
        await client.query("SAVEPOINT del");
        try {
          const d = await client.query(`DELETE FROM ${qi(cfg.table)} WHERE ${qi(cfg.pk)} = $1`, [loserId]);
          deletedLoser = (d.rowCount || 0) > 0;
          await client.query("RELEASE SAVEPOINT del");
        } catch (e: any) {
          await client.query("ROLLBACK TO SAVEPOINT del");
          conflicts.push({ table: cfg.table, column: "(loser削除)", error: String(e?.message || e) });
        }
      }

      await client.query("COMMIT");
      res.json({
        ok: true,
        entity: b.entity,
        survivorId,
        loserId,
        moved: moved.filter((m) => m.updated > 0),
        conflicts,
        deletedLoser,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, e);
    } finally {
      client.release();
    }
  });
}
