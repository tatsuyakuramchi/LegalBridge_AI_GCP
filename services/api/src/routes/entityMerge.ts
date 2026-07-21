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
  // B系(T3): マスタ重複掃除の受け皿。取引先/素材/担当者を統合可能に。
  vendor: {
    label: "取引先",
    table: "vendors",
    pk: "id",
    idType: "int",
    refIntCols: [
      "vendor_id",
      "counterparty_vendor_id",
      "party_vendor_id",
      "publisher_vendor_id",
      "rights_holder_vendor_id",
      "primary_vendor_id",
      "licensor_vendor_id",
    ],
    refCodeCols: ["vendor_code"],
    codeSourceCol: "vendor_code",
  },
  work_material: {
    label: "素材",
    table: "work_materials",
    pk: "id",
    idType: "int",
    refIntCols: ["material_id", "source_material_id", "material_ref_id"],
    refCodeCols: ["material_code"],
    codeSourceCol: "material_code",
  },
  staff: {
    // 注: created_by 等の文字列参照(email/slack)は FK でないため自動付け替え対象外。
    //   staff_id(int) / slack_user_id を付け替え、loser 行を削除する。
    label: "担当者",
    table: "staff",
    pk: "id",
    idType: "int",
    refIntCols: ["staff_id"],
    refCodeCols: ["slack_user_id"],
    codeSourceCol: "slack_user_id",
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

    const actor =
      String(
        (req as any).get?.("x-goog-authenticated-user-email") ||
          (req as any).user?.email ||
          b.actor ||
          ""
      ).replace(/^accounts\.google\.com:/, "") || null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const targets = await buildTargets(cfg, survivorId, loserId);
      const moved: Array<{ table: string; column: string; updated: number }> = [];
      const conflicts: Array<{ table: string; column: string; error: string }> = [];
      // undo 用: 付け替えた行の PK(id) を記録(id 列を持つ表のみ)。
      const changes: Array<{ table: string; column: string; pks: any[] | null; loseVal: any; survVal: any; keyType: string }> = [];

      for (const t of targets) {
        await client.query("SAVEPOINT s");
        try {
          // 付け替え前に対象行の id を控える(取消し用)。id 列が無い表は pks=null。
          let pks: any[] | null = null;
          try {
            const sel = await client.query(`SELECT id FROM ${qi(t.table)} WHERE ${qi(t.column)} = $1`, [t.loseVal]);
            pks = sel.rows.map((x: any) => x.id);
          } catch {
            pks = null;
          }
          const r = await client.query(
            `UPDATE ${qi(t.table)} SET ${qi(t.column)} = $1 WHERE ${qi(t.column)} = $2`,
            [t.survVal, t.loseVal]
          );
          moved.push({ table: t.table, column: t.column, updated: r.rowCount || 0 });
          if ((r.rowCount || 0) > 0) changes.push({ table: t.table, column: t.column, pks, loseVal: t.loseVal, survVal: t.survVal, keyType: t.keyType });
          await client.query("RELEASE SAVEPOINT s");
        } catch (e: any) {
          // UNIQUE 衝突等: この列だけロールバックして継続(loser 側の衝突行は本体削除まで残置)。
          await client.query("ROLLBACK TO SAVEPOINT s");
          conflicts.push({ table: t.table, column: t.column, error: String(e?.message || e) });
        }
      }

      // 原作: ledgers(LO) の付け替え + loser 台帳の削除。
      if (cfg.ledger) {
        // WM-01 Phase E: ledger_ref_id は works(id) を指す(0101 FK)。旧 ledgers.id 経由の
        //   解決は撤去し、works id(loser→survivor) で直接付け替える。
        await client.query("SAVEPOINT lg");
        try {
          const refs = await discoverRefTables(query, ["ledger_ref_id"]);
          for (const r of refs) {
            await client.query("SAVEPOINT lr");
            try {
              const u = await client.query(
                `UPDATE ${qi(r.table)} SET ${qi(r.column)} = $1 WHERE ${qi(r.column)} = $2`,
                [survivorId, loserId]
              );
              moved.push({ table: r.table, column: r.column, updated: u.rowCount || 0 });
              await client.query("RELEASE SAVEPOINT lr");
            } catch (e: any) {
              await client.query("ROLLBACK TO SAVEPOINT lr");
              conflicts.push({ table: r.table, column: r.column, error: String(e?.message || e) });
            }
          }
          await client.query("RELEASE SAVEPOINT lg");
        } catch (e: any) {
          await client.query("ROLLBACK TO SAVEPOINT lg");
          conflicts.push({ table: "ledger_ref_id", column: "(merge)", error: String(e?.message || e) });
        }
      }

      // loser 本体を削除(id 基盤の実体のみ。issue は Backlog 側のためローカル削除なし)。
      //   削除前に loser 行のスナップショットを控える(取消し時の復元用)。
      let deletedLoser = false;
      let loserSnapshot: any = null;
      if (cfg.table && cfg.pk) {
        try {
          const snap = await client.query(`SELECT to_jsonb(t) AS row FROM ${qi(cfg.table)} t WHERE ${qi(cfg.pk)} = $1`, [loserId]);
          loserSnapshot = snap.rows[0]?.row ?? null;
        } catch { loserSnapshot = null; }
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

      // 監査ログを記録(merge_audit 未整備の環境でも失敗させない)。
      let auditId: number | null = null;
      try {
        const ins = await client.query(
          `INSERT INTO merge_audit
             (actor, entity, survivor_id, loser_id, survivor_label, loser_label,
              moved, changes, conflicts, loser_snapshot, deleted_loser)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11)
           RETURNING id`,
          [
            actor,
            String(b.entity),
            String(survivorId),
            String(loserId),
            b.survivorLabel ?? null,
            b.loserLabel ?? null,
            JSON.stringify(moved.filter((m) => m.updated > 0)),
            JSON.stringify(changes),
            JSON.stringify(conflicts),
            loserSnapshot ? JSON.stringify(loserSnapshot) : null,
            deletedLoser,
          ]
        );
        auditId = ins.rows[0]?.id ?? null;
      } catch (auErr) {
        console.warn("[merge] audit 記録スキップ(merge_audit 未整備?):", auErr);
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
        auditId,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, e);
    } finally {
      client.release();
    }
  });

  // 監査ログ一覧(最新順)。
  app.get("/api/v3/merge/audit", ...requireRead, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const r = await query(
        `SELECT id, created_at, actor, entity, survivor_id, loser_id, survivor_label, loser_label,
                moved, conflicts, deleted_loser, undone_at, undo_note
           FROM merge_audit ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      res.json({ ok: true, rows: r.rows });
    } catch (e) {
      // テーブル未整備なら空で返す(UI を壊さない)。
      res.json({ ok: true, rows: [], note: "merge_audit 未整備の可能性: " + String(e) });
    }
  });

  // 取消し(best-effort): 記録した pks で参照を loser へ戻し、削除した loser 本体を復元。
  //   ledger 付替え・pks 未記録(id 列なし)の表・削除された loser 側の衝突行は戻せない場合がある。
  app.post("/api/v3/merge/undo", ...requireWrite, express.json(), async (req, res) => {
    const auditId = Number(req.body?.audit_id);
    if (!Number.isFinite(auditId)) return res.status(400).json({ ok: false, error: "audit_id が必要です" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const a = await client.query(`SELECT * FROM merge_audit WHERE id = $1 FOR UPDATE`, [auditId]);
      const row = a.rows[0];
      if (!row) { await client.query("ROLLBACK"); return res.status(404).json({ ok: false, error: "監査ログが見つかりません" }); }
      if (row.undone_at) { await client.query("ROLLBACK"); return res.status(400).json({ ok: false, error: "既に取消し済みです" }); }
      const cfg = ENTITIES[String(row.entity)];
      if (!cfg) { await client.query("ROLLBACK"); return res.status(400).json({ ok: false, error: "unknown entity" }); }

      const notes: string[] = [];
      // 1) loser 本体を復元(削除していた場合)。jsonb → 行に復元。
      if (cfg.table && row.deleted_loser && row.loser_snapshot) {
        await client.query("SAVEPOINT r");
        try {
          await client.query(
            `INSERT INTO ${qi(cfg.table)} SELECT * FROM jsonb_populate_record(NULL::${qi(cfg.table)}, $1::jsonb) ON CONFLICT DO NOTHING`,
            [JSON.stringify(row.loser_snapshot)]
          );
          await client.query("RELEASE SAVEPOINT r");
        } catch (e: any) {
          await client.query("ROLLBACK TO SAVEPOINT r");
          notes.push(`loser 本体の復元に失敗: ${String(e?.message || e)}`);
        }
      }
      // 2) 参照を loser へ戻す(pks が記録されている表のみ)。
      const changes: any[] = Array.isArray(row.changes) ? row.changes : [];
      const reverted: Array<{ table: string; column: string; updated: number }> = [];
      for (const c of changes) {
        if (!Array.isArray(c.pks) || c.pks.length === 0) { notes.push(`${c.table}.${c.column}: pks 未記録のため戻せません`); continue; }
        await client.query("SAVEPOINT u");
        try {
          const u = await client.query(
            `UPDATE ${qi(c.table)} SET ${qi(c.column)} = $1 WHERE id = ANY($2)`,
            [c.loseVal, c.pks]
          );
          reverted.push({ table: c.table, column: c.column, updated: u.rowCount || 0 });
          await client.query("RELEASE SAVEPOINT u");
        } catch (e: any) {
          await client.query("ROLLBACK TO SAVEPOINT u");
          notes.push(`${c.table}.${c.column}: 差し戻し失敗 ${String(e?.message || e)}`);
        }
      }
      const note = notes.join(" / ") || null;
      await client.query(`UPDATE merge_audit SET undone_at = now(), undo_note = $2 WHERE id = $1`, [auditId, note]);
      await client.query("COMMIT");
      res.json({ ok: true, auditId, reverted, note });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, e);
    } finally {
      client.release();
    }
  });
}
