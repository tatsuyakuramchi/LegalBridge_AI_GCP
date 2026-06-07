/**
 * dataLinkage — データモデル整理: 連結チェック＆修復ツール。
 *
 * ばらばらのテーブルに散在/孤児化した「同じ発注条件」レコードを検出し、
 * 安全な範囲で紐づけ直す(修復する)。将来テーブル統合を進める際の点検入口。
 *
 *   GET  /api/admin/data-linkage/check          … 整合性カテゴリごとの件数+サンプル
 *   POST /api/admin/data-linkage/repair {action} … カテゴリ別の修復を実行
 *
 * 修復アクション(安全側):
 *   normalize_documents   : 発注書 documents.form_data の別名キー差異(items/line_items等)を正規化
 *   normalize_drafts      : 下書き document_drafts の form_data を正規化
 *   prune_orphan_contracts: capability の無い v3 ミラー(contracts)を削除(子はCASCADE)
 *   prune_stale_drafts    : 既に発行済の文書がある下書きを削除
 *   fix_orphan_refs       : 実体の無い明細を指す delivery/sublicense 参照を NULL 化
 */

import type { Express } from "express";
import express from "express";
import type { Pool } from "pg";
import { normalizeDocumentFormData } from "../lib/capabilityFormMapping";

export interface DataLinkageDeps {
  query: (text: string, params?: any[]) => Promise<any>;
  pool: Pool;
}

type CheckResult = {
  key: string;
  label: string;
  description: string;
  count: number; // -1 = チェック失敗(テーブル/列なし等)
  severity: "ok" | "warn" | "error";
  repair_action: string | null;
  sample: any[];
  error?: string;
};

// 発注書 form_data の「items と line_items の片方しか無い」ドリフト条件
const PO_DRIFT_WHERE = `
  template_type = 'purchase_order'
  AND (
    ( (form_data ? 'line_items') AND jsonb_typeof(form_data->'line_items')='array'
        AND jsonb_array_length(form_data->'line_items') > 0
        AND NOT ((form_data ? 'items') AND jsonb_typeof(form_data->'items')='array'
                   AND jsonb_array_length(form_data->'items') > 0) )
    OR
    ( (form_data ? 'items') AND jsonb_typeof(form_data->'items')='array'
        AND jsonb_array_length(form_data->'items') > 0
        AND NOT ((form_data ? 'line_items') AND jsonb_typeof(form_data->'line_items')='array'
                   AND jsonb_array_length(form_data->'line_items') > 0) )
  )
`;

export function registerDataLinkage(app: Express, deps: DataLinkageDeps) {
  const { query, pool } = deps;

  // 1カテゴリの件数＋サンプルを安全に取得 (失敗時 count=-1)
  async function probe(
    base: Omit<CheckResult, "count" | "severity" | "sample" | "error">,
    countSql: string,
    sampleSql: string,
    params: any[] = []
  ): Promise<CheckResult> {
    try {
      const c = await query(countSql, params);
      const count = Number(c.rows[0]?.n ?? 0);
      let sample: any[] = [];
      if (count > 0) {
        const s = await query(sampleSql, params);
        sample = s.rows;
      }
      return {
        ...base,
        count,
        severity: count > 0 ? "warn" : "ok",
        sample,
      };
    } catch (e: any) {
      return {
        ...base,
        count: -1,
        severity: "error",
        sample: [],
        error: String(e?.message || e),
      };
    }
  }

  app.get("/api/admin/data-linkage/check", async (_req, res) => {
    try {
      const checks = await Promise.all([
        // ① form_data の別名キー差異 (発注書)
        probe(
          {
            key: "form_data_drift_po",
            label: "発注書 form_data のキー差異",
            description:
              "items と line_items の片方しか無い発注書(編集/PDF/明細でズレる)。正規化で統一可能。",
            repair_action: "normalize_documents",
          },
          `SELECT COUNT(*)::int AS n FROM documents WHERE ${PO_DRIFT_WHERE}`,
          `SELECT document_number FROM documents WHERE ${PO_DRIFT_WHERE} ORDER BY created_at DESC LIMIT 8`
        ),
        // ② v3 ミラー孤児 (capability が無い contracts)
        probe(
          {
            key: "orphan_contracts",
            label: "v3ミラー孤児 (contracts)",
            description:
              "対応する contract_capabilities が無い contracts 行。DELETE非同期トリガの残骸。掃除可能。",
            repair_action: "prune_orphan_contracts",
          },
          `SELECT COUNT(*)::int AS n FROM contracts c
            WHERE NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id)`,
          `SELECT c.id, c.document_number FROM contracts c
            WHERE NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id)
            ORDER BY c.id DESC LIMIT 8`
        ),
        // ③ 発行済なのに残っている下書き
        probe(
          {
            key: "stale_drafts",
            label: "発行済なのに残る下書き",
            description:
              "同じ課題+テンプレで既に発行済(drive_link有)の文書があるのに残っている下書き。削除可能。",
            repair_action: "prune_stale_drafts",
          },
          `SELECT COUNT(*)::int AS n FROM document_drafts dr
            WHERE EXISTS (SELECT 1 FROM documents d
                           WHERE d.issue_key = dr.issue_key
                             AND d.template_type = dr.template_type
                             AND COALESCE(d.drive_link,'') <> '')`,
          `SELECT dr.issue_key, dr.template_type, dr.updated_at FROM document_drafts dr
            WHERE EXISTS (SELECT 1 FROM documents d
                           WHERE d.issue_key = dr.issue_key
                             AND d.template_type = dr.template_type
                             AND COALESCE(d.drive_link,'') <> '')
            ORDER BY dr.updated_at DESC LIMIT 8`
        ),
        // ④ 実体の無い明細を指す検収参照
        probe(
          {
            key: "orphan_delivery_refs",
            label: "検収の孤児参照 (delivery_line_items)",
            description:
              "存在しない capability_line_items を指す検収明細。参照を NULL 化して整合化。",
            repair_action: "fix_orphan_refs",
          },
          `SELECT COUNT(*)::int AS n FROM delivery_line_items dli
            WHERE dli.capability_line_item_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM capability_line_items cl WHERE cl.id = dli.capability_line_item_id)`,
          `SELECT dli.id, dli.delivery_event_id, dli.capability_line_item_id FROM delivery_line_items dli
            WHERE dli.capability_line_item_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM capability_line_items cl WHERE cl.id = dli.capability_line_item_id)
            ORDER BY dli.id DESC LIMIT 8`
        ),
        // ⑤ 実体の無い明細を指す請求権参照
        probe(
          {
            key: "orphan_sublicense_refs",
            label: "請求権台帳の孤児参照 (sublicense_deals)",
            description:
              "存在しない capability_line_items を指す請求権の由来。参照を NULL 化して整合化。",
            repair_action: "fix_orphan_refs",
          },
          `SELECT COUNT(*)::int AS n FROM sublicense_deals sd
            WHERE sd.source_line_item_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM capability_line_items cl WHERE cl.id = sd.source_line_item_id)`,
          `SELECT sd.id, sd.source_line_item_id FROM sublicense_deals sd
            WHERE sd.source_line_item_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM capability_line_items cl WHERE cl.id = sd.source_line_item_id)
            ORDER BY sd.id DESC LIMIT 8`
        ),
        // ⑥ capability の無い発注書(documents) — 連結欠落(検出のみ)
        probe(
          {
            key: "po_docs_without_capability",
            label: "capability未連結の発注書",
            description:
              "documents(purchase_order) に対応する contract_capabilities が無い。検収待ち等に出ない。要手動連結。",
            repair_action: null,
          },
          `SELECT COUNT(*)::int AS n FROM documents d
            WHERE d.template_type = 'purchase_order'
              AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.document_number = d.document_number)`,
          `SELECT d.document_number, d.issue_key FROM documents d
            WHERE d.template_type = 'purchase_order'
              AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.document_number = d.document_number)
            ORDER BY d.created_at DESC LIMIT 8`
        ),
        // ⑦ documents の無い capability — 連結欠落(検出のみ)
        probe(
          {
            key: "capabilities_without_document",
            label: "documents未連結のcapability",
            description:
              "contract_capabilities に対応する documents が無い。PDF/編集ができない。要確認。",
            repair_action: null,
          },
          `SELECT COUNT(*)::int AS n FROM contract_capabilities cc
            WHERE cc.document_number IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.document_number = cc.document_number)`,
          `SELECT cc.id, cc.document_number, cc.record_type FROM contract_capabilities cc
            WHERE cc.document_number IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.document_number = cc.document_number)
            ORDER BY cc.id DESC LIMIT 8`
        ),
        // ⑧ レガシーテーブル残存 (Step2撤去対象)
        probe(
          {
            key: "legacy_order_items",
            label: "レガシー order_items 残存",
            description:
              "Phase23で廃止予定の order_items に行が残存。Step2撤去の対象。",
            repair_action: null,
          },
          `SELECT CASE WHEN to_regclass('public.order_items') IS NULL THEN 0
                       ELSE (SELECT COUNT(*) FROM order_items) END::int AS n`,
          `SELECT 'order_items' AS table_name LIMIT 1`
        ),
        probe(
          {
            key: "legacy_license_contracts",
            label: "レガシー license_contracts 残存",
            description:
              "Phase23で contract_capabilities に移行済の license_contracts に行が残存。Step2撤去の対象。",
            repair_action: null,
          },
          `SELECT CASE WHEN to_regclass('public.license_contracts') IS NULL THEN 0
                       ELSE (SELECT COUNT(*) FROM license_contracts) END::int AS n`,
          `SELECT 'license_contracts' AS table_name LIMIT 1`
        ),
      ]);

      const totalIssues = checks.filter((c) => c.count > 0).length;
      res.json({ ok: true, generated_at: new Date().toISOString(), total_issue_categories: totalIssues, checks });
    } catch (e: any) {
      console.error("/api/admin/data-linkage/check failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post(
    "/api/admin/data-linkage/repair",
    express.json(),
    async (req, res) => {
      const action = String(req.body?.action || "").trim();
      const limit = Math.min(Math.max(Number(req.body?.limit) || 1000, 1), 5000);
      try {
        if (action === "normalize_documents") {
          const rows = (
            await query(
              `SELECT id, template_type, form_data FROM documents
                WHERE ${PO_DRIFT_WHERE} ORDER BY created_at DESC LIMIT $1`,
              [limit]
            )
          ).rows;
          let updated = 0;
          for (const r of rows) {
            const norm = normalizeDocumentFormData(r.template_type, r.form_data || {});
            await query(`UPDATE documents SET form_data = $2 WHERE id = $1`, [
              r.id,
              JSON.stringify(norm),
            ]);
            updated++;
          }
          return res.json({ ok: true, action, affected: updated });
        }

        if (action === "normalize_drafts") {
          const rows = (
            await query(
              `SELECT id, template_type, form_data FROM document_drafts LIMIT $1`,
              [limit]
            )
          ).rows;
          let updated = 0;
          for (const r of rows) {
            const norm = normalizeDocumentFormData(r.template_type, r.form_data || {});
            await query(`UPDATE document_drafts SET form_data = $2 WHERE id = $1`, [
              r.id,
              JSON.stringify(norm),
            ]);
            updated++;
          }
          return res.json({ ok: true, action, affected: updated });
        }

        if (action === "prune_orphan_contracts") {
          const r = await query(
            `DELETE FROM contracts c
              WHERE NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id)`
          );
          return res.json({ ok: true, action, affected: r.rowCount || 0 });
        }

        if (action === "prune_stale_drafts") {
          const r = await query(
            `DELETE FROM document_drafts dr
              WHERE EXISTS (SELECT 1 FROM documents d
                             WHERE d.issue_key = dr.issue_key
                               AND d.template_type = dr.template_type
                               AND COALESCE(d.drive_link,'') <> '')`
          );
          return res.json({ ok: true, action, affected: r.rowCount || 0 });
        }

        if (action === "fix_orphan_refs") {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const d = await client.query(
              `UPDATE delivery_line_items dli SET capability_line_item_id = NULL
                WHERE dli.capability_line_item_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM capability_line_items cl WHERE cl.id = dli.capability_line_item_id)`
            );
            const s = await client.query(
              `UPDATE sublicense_deals sd SET source_line_item_id = NULL
                WHERE sd.source_line_item_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM capability_line_items cl WHERE cl.id = sd.source_line_item_id)`
            );
            await client.query("COMMIT");
            return res.json({
              ok: true,
              action,
              affected: (d.rowCount || 0) + (s.rowCount || 0),
              detail: { delivery: d.rowCount || 0, sublicense: s.rowCount || 0 },
            });
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        }

        return res
          .status(400)
          .json({ ok: false, error: `unknown action: ${action}` });
      } catch (e: any) {
        console.error(`/api/admin/data-linkage/repair (${action}) failed:`, e);
        res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }
  );
}
