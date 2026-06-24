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

  // レガシーテーブルの存在＋件数。先に to_regclass で存在確認してから COUNT する
  //   (CASE 内に FROM を書くと解析時に "relation does not exist" になるため)。
  async function legacyProbe(
    base: Omit<CheckResult, "count" | "severity" | "sample" | "error">,
    tableName: string
  ): Promise<CheckResult> {
    try {
      const reg = await query(`SELECT to_regclass($1) AS reg`, [
        `public.${tableName}`,
      ]);
      if (!reg.rows[0]?.reg) {
        // テーブルが無い = 撤去済み(または新規DB)。問題なし。
        return { ...base, count: 0, severity: "ok", sample: [] };
      }
      // 存在する場合のみ COUNT (tableName は固定リテラル、注入リスクなし)
      const c = await query(`SELECT COUNT(*)::int AS n FROM ${tableName}`);
      const count = Number(c.rows[0]?.n ?? 0);
      return {
        ...base,
        count,
        severity: count > 0 ? "warn" : "ok",
        sample: count > 0 ? [{ table_name: tableName, rows: count }] : [],
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

  async function issueConsistencyChecks(): Promise<CheckResult[]> {
    const contractingTemplates = `(
      'purchase_order',
      'intl_purchase_order',
      'individual_license_terms',
      'pub_license_terms'
    )`;
    const paymentPrepTemplates = `(
      'inspection_certificate',
      'royalty_statement',
      'license_calculation_sheet'
    )`;

    return Promise.all([
      probe(
        {
          key: "issue_capability_mismatch",
          label: "文書とcapabilityの課題キー不一致",
          description:
            "documents.issue_key と contract_capabilities.backlog_issue_key が異なる文書。統合時の取り残し候補。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM documents d
           JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
          WHERE d.issue_key IS NOT NULL
            AND cc.backlog_issue_key IS NOT NULL
            AND d.issue_key <> cc.backlog_issue_key`,
        `SELECT d.document_number,
                d.template_type,
                d.issue_key AS document_issue_key,
                cc.id AS capability_id,
                cc.backlog_issue_key AS capability_issue_key
           FROM documents d
           JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
          WHERE d.issue_key IS NOT NULL
            AND cc.backlog_issue_key IS NOT NULL
            AND d.issue_key <> cc.backlog_issue_key
          ORDER BY d.created_at DESC NULLS LAST
          LIMIT 8`
      ),
      probe(
        {
          key: "final_contract_docs_without_lines",
          label: "締結文書の条件明細未生成",
          description:
            "final/正本の発注書・条件書に紐づく condition_lines が無い。締結フェイズの空振り候補。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM documents d
           LEFT JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
           LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
          WHERE d.template_type IN ${contractingTemplates}
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND cl.id IS NULL`,
        `SELECT d.document_number,
                d.issue_key,
                d.template_type,
                cc.id AS capability_id
           FROM documents d
           LEFT JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
           LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
          WHERE d.template_type IN ${contractingTemplates}
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND cl.id IS NULL
          ORDER BY d.created_at DESC NULLS LAST
          LIMIT 8`
      ),
      probe(
        {
          key: "payment_docs_without_events",
          label: "支払準備文書の実績未結合",
          description:
            "検収書・計算書があるのに condition_events が無い。支払準備フェイズの結合漏れ候補。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM documents d
          WHERE d.template_type IN ${paymentPrepTemplates}
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM condition_events ce WHERE ce.document_id = d.id
            )`,
        `SELECT d.id,
                d.document_number,
                d.issue_key,
                d.template_type,
                d.created_at
           FROM documents d
          WHERE d.template_type IN ${paymentPrepTemplates}
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM condition_events ce WHERE ce.document_id = d.id
            )
          ORDER BY d.created_at DESC NULLS LAST
          LIMIT 8`
      ),
      probe(
        {
          key: "condition_line_classification_missing",
          label: "条件明細の分類未完了",
          description:
            "transaction_kind または counterparty_vendor_id が NULL の condition_lines。分類補完の対象。",
          repair_action: "backfill_condition_line_classification",
        },
        `SELECT COUNT(*)::int AS n
           FROM condition_lines
          WHERE transaction_kind IS NULL OR counterparty_vendor_id IS NULL`,
        `SELECT payment_scheme,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE transaction_kind IS NULL)::int AS transaction_kind_null,
                COUNT(*) FILTER (WHERE counterparty_vendor_id IS NULL)::int AS counterparty_vendor_id_null
           FROM condition_lines
          WHERE transaction_kind IS NULL OR counterparty_vendor_id IS NULL
          GROUP BY payment_scheme
          ORDER BY n DESC
          LIMIT 8`
      ),
      probe(
        {
          key: "merged_source_final_documents",
          label: "統合済み課題に残るfinal文書",
          description:
            "legal_requests.merged_into_issue_key がある統合元課題に final 文書が残っている。統合取り残し候補。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM legal_requests lr
           JOIN documents d ON d.issue_key = lr.backlog_issue_key
          WHERE NULLIF(lr.merged_into_issue_key, '') IS NOT NULL
            AND COALESCE(d.lifecycle_status, 'final') = 'final'`,
        `SELECT lr.backlog_issue_key AS source_issue_key,
                lr.merged_into_issue_key,
                d.document_number,
                d.template_type
           FROM legal_requests lr
           JOIN documents d ON d.issue_key = lr.backlog_issue_key
          WHERE NULLIF(lr.merged_into_issue_key, '') IS NOT NULL
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
          ORDER BY d.created_at DESC NULLS LAST
          LIMIT 8`
      ),
      probe(
        {
          key: "non_primary_final_records",
          label: "非正本なのにfinalの旧版",
          description:
            "is_primary=false なのに lifecycle_status=final の documents/capabilities。重複計上の温床。",
          repair_action: null,
        },
        `WITH stale AS (
            SELECT id FROM documents
             WHERE COALESCE(is_primary, TRUE) = FALSE
               AND COALESCE(lifecycle_status, 'final') = 'final'
            UNION ALL
            SELECT id FROM contract_capabilities
             WHERE COALESCE(is_primary, TRUE) = FALSE
               AND COALESCE(lifecycle_status, 'final') = 'final'
          )
          SELECT COUNT(*)::int AS n FROM stale`,
        `WITH stale AS (
            SELECT 'documents' AS source,
                   id,
                   document_number,
                   issue_key AS issue_key,
                   template_type AS record_type
              FROM documents
             WHERE COALESCE(is_primary, TRUE) = FALSE
               AND COALESCE(lifecycle_status, 'final') = 'final'
            UNION ALL
            SELECT 'contract_capabilities' AS source,
                   id,
                   document_number,
                   backlog_issue_key AS issue_key,
                   record_type
              FROM contract_capabilities
             WHERE COALESCE(is_primary, TRUE) = FALSE
               AND COALESCE(lifecycle_status, 'final') = 'final'
          )
          SELECT * FROM stale ORDER BY source, id DESC LIMIT 8`
      ),
      probe(
        {
          key: "pub_license_terms_without_lines",
          label: "出版系条件書の明細未生成",
          description:
            "pub_license_terms の final/正本文書に condition_lines が無い。publication 系生成経路の確認対象。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM documents d
           LEFT JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
           LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
          WHERE d.template_type = 'pub_license_terms'
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND cl.id IS NULL`,
        `SELECT d.document_number,
                d.issue_key,
                cc.id AS capability_id
           FROM documents d
           LEFT JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
           LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
          WHERE d.template_type = 'pub_license_terms'
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND cl.id IS NULL
          ORDER BY d.created_at DESC NULLS LAST
          LIMIT 8`
      ),
    ]);
  }

  app.get("/api/audit/issue-consistency", async (_req, res) => {
    try {
      const checks = await issueConsistencyChecks();
      const totalIssues = checks.filter((c) => c.count > 0).length;
      res.json({
        ok: true,
        generated_at: new Date().toISOString(),
        total_issue_categories: totalIssues,
        checks,
      });
    } catch (e: any) {
      console.error("/api/audit/issue-consistency failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

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
        // ② v3 ミラー孤児 (capability が無い workflow 由来の contracts)
        //    ※ origin='registered' は作品モデルが直接作る独自契約なので孤児ではない。
        probe(
          {
            key: "orphan_contracts",
            label: "v3ミラー孤児 (contracts)",
            description:
              "対応する contract_capabilities が無い workflow 由来の contracts 行(ミラー残骸)。掃除可能。registered(作品モデル登録契約)は対象外。",
            repair_action: "prune_orphan_contracts",
          },
          `SELECT COUNT(*)::int AS n FROM contracts c
            WHERE c.origin = 'workflow'
              AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id)`,
          `SELECT c.id, c.document_number FROM contracts c
            WHERE c.origin = 'workflow'
              AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id)
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
        // ⑧ レガシーテーブル残存 (Step2撤去対象)。撤去後は to_regclass NULL → 0件(問題なし)
        legacyProbe(
          {
            key: "legacy_order_items",
            label: "レガシー order_items 残存",
            description:
              "Phase23で廃止の order_items の残存件数。撤去済み(テーブル無し)なら0。",
            repair_action: null,
          },
          "order_items"
        ),
        legacyProbe(
          {
            key: "legacy_license_contracts",
            label: "レガシー license_contracts 残存",
            description:
              "Phase23で contract_capabilities へ移行済の license_contracts の残存件数。撤去済みなら0。",
            repair_action: null,
          },
          "license_contracts"
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
          // origin='workflow'(ミラー)のみ削除。registered(作品モデル独自契約)は保護。
          const r = await query(
            `DELETE FROM contracts c
              WHERE c.origin = 'workflow'
                AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id)`
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
            await client.query("COMMIT");
            return res.json({
              ok: true,
              action,
              affected: d.rowCount || 0,
              detail: { delivery: d.rowCount || 0 },
            });
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        }

        if (action === "backfill_condition_line_classification") {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");

            const t = await client.query(
              `WITH candidates AS (
                 SELECT cl.id,
                        CASE
                          WHEN cc.record_type = 'purchase_order' THEN 'service'
                          WHEN cc.contract_category = 'service' THEN 'service'
                          WHEN cc.contract_category = 'sales' THEN 'product'
                          WHEN cc.contract_category IN ('license', 'publication') THEN 'license'
                          WHEN cc.record_type IN ('license_condition', 'publication_condition') THEN 'license'
                          WHEN cl.payment_scheme = 'royalty' THEN 'license'
                          WHEN cl.payment_scheme = 'per_unit' THEN 'service'
                          ELSE NULL
                        END AS suggested_transaction_kind
                   FROM condition_lines cl
                   LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
                  WHERE cl.transaction_kind IS NULL
                  ORDER BY cl.id
                  LIMIT $1
               )
               UPDATE condition_lines cl
                  SET transaction_kind = c.suggested_transaction_kind
                 FROM candidates c
                WHERE cl.id = c.id
                  AND c.suggested_transaction_kind IS NOT NULL`,
              [limit]
            );

            const v = await client.query(
              `WITH candidates AS (
                 SELECT cl.id,
                        cc.vendor_id AS suggested_counterparty_vendor_id
                   FROM condition_lines cl
                   LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
                  WHERE cl.counterparty_vendor_id IS NULL
                    AND cc.vendor_id IS NOT NULL
                  ORDER BY cl.id
                  LIMIT $1
               )
               UPDATE condition_lines cl
                  SET counterparty_vendor_id = c.suggested_counterparty_vendor_id
                 FROM candidates c
                WHERE cl.id = c.id`,
              [limit]
            );

            await client.query("COMMIT");
            return res.json({
              ok: true,
              action,
              affected: (t.rowCount || 0) + (v.rowCount || 0),
              detail: {
                transaction_kind: t.rowCount || 0,
                counterparty_vendor_id: v.rowCount || 0,
              },
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
