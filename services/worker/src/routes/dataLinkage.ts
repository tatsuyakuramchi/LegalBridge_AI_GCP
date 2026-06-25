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
import {
  syncConditionLinesForCapability,
  syncInspectionEventsForDelivery,
  syncRoyaltyCalcEvent,
} from "../lib/conditionSync";

// 締結文書(発注書/利用許諾条件書)の template_type 一覧。
//   A2(締結フェイズで条件明細が未生成)の対象判定に使う。
const CONTRACTING_TEMPLATE_TYPES = [
  "purchase_order",
  "intl_purchase_order",
  "individual_license_terms",
  "pub_license_terms",
];

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
            "final/正本の発注書・条件書に紐づく condition_lines が無い。締結フェイズの空振り候補。capability配下の明細から復元可能。",
          repair_action: "backfill_contract_condition_lines",
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
            "検収書・計算書があるのに condition_events が無い。支払準備フェイズの結合漏れ候補。検収=delivery_events / 計算書=royalty_calculations から復元可能(condition_lines が前提のため F1 を先に適用)。",
          repair_action: "backfill_payment_condition_events",
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
        `SELECT cl.id,
                cl.line_code,
                cl.payment_scheme,
                cl.transaction_kind,
                cl.counterparty_vendor_id,
                cc.document_number,
                cc.backlog_issue_key AS issue_key,
                cc.record_type,
                cc.contract_category,
                cc.vendor_id AS capability_vendor_id,
                cv.vendor_name AS capability_vendor_name,
                cc.parent_capability_id,
                parent_cc.vendor_id AS parent_vendor_id,
                pv.vendor_name AS parent_vendor_name,
                d.issue_key AS document_issue_key,
                lr.counterparty AS legal_request_counterparty,
                COALESCE(
                  NULLIF(d.form_data->>'vendor_name', ''),
                  NULLIF(d.form_data->>'vendorName', ''),
                  NULLIF(d.form_data->>'VENDOR_NAME', ''),
                  NULLIF(d.form_data->>'counterparty', ''),
                  NULLIF(d.form_data->>'licensor', ''),
                  NULLIF(d.form_data->>'licensor_name', ''),
                  NULLIF(d.form_data->>'Licensor_名称', '')
                ) AS document_counterparty,
                doc_vendor.id AS document_vendor_id,
                doc_vendor.vendor_name AS document_vendor_name
           FROM condition_lines cl
           LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
           LEFT JOIN contract_capabilities parent_cc ON parent_cc.id = cc.parent_capability_id
           LEFT JOIN documents d ON d.document_number = cc.document_number
           LEFT JOIN legal_requests lr ON lr.backlog_issue_key = COALESCE(cc.backlog_issue_key, d.issue_key)
           LEFT JOIN vendors cv ON cv.id = cc.vendor_id
           LEFT JOIN vendors pv ON pv.id = parent_cc.vendor_id
           LEFT JOIN LATERAL (
             SELECT v.id, v.vendor_name
               FROM vendors v
              WHERE LOWER(BTRIM(v.vendor_name)) = LOWER(BTRIM(COALESCE(
                      NULLIF(d.form_data->>'vendor_name', ''),
                      NULLIF(d.form_data->>'vendorName', ''),
                      NULLIF(d.form_data->>'VENDOR_NAME', ''),
                      NULLIF(d.form_data->>'counterparty', ''),
                      NULLIF(d.form_data->>'licensor', ''),
                      NULLIF(d.form_data->>'licensor_name', ''),
                      NULLIF(d.form_data->>'Licensor_名称', ''),
                      NULLIF(lr.counterparty, '')
                    )))
              ORDER BY v.id
              LIMIT 1
           ) doc_vendor ON TRUE
          WHERE cl.transaction_kind IS NULL OR cl.counterparty_vendor_id IS NULL
          ORDER BY cl.id
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
            "is_primary=false なのに lifecycle_status=final の documents/capabilities。重複計上の温床。primary版がある旧版を superseded 化して整理。",
          repair_action: "normalize_superseded_revisions",
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
      // A8: 締結のみで支払実績ゼロの条件明細(循環が止まっている候補)。
      //   消化型(payable)で status='open'(消化額0)かつ event 0 = 締結後に検収/計算が
      //   一度も来ていない。status_v 由来。advisory(自動修復なし)。
      probe(
        {
          key: "condition_lines_stalled_no_events",
          label: "締結のみ・支払実績ゼロの条件明細",
          description:
            "消化型(payable)で status=open かつ実績イベント0。締結したが支払準備フェイズが一度も来ていない=循環が途中で止まっている候補(advisory)。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM condition_line_status_v s
           JOIN condition_lines cl ON cl.id = s.id
          WHERE s.direction = 'payable'
            AND s.payment_scheme IN ('lump_sum','per_unit','installment')
            AND s.status = 'open'
            AND s.event_count = 0
            AND cl.cancelled_at IS NULL
            AND cl.closed_at IS NULL`,
        `SELECT s.line_code, s.payment_scheme, cl.amount_ex_tax,
                cl.capability_id, cl.subject
           FROM condition_line_status_v s
           JOIN condition_lines cl ON cl.id = s.id
          WHERE s.direction = 'payable'
            AND s.payment_scheme IN ('lump_sum','per_unit','installment')
            AND s.status = 'open'
            AND s.event_count = 0
            AND cl.cancelled_at IS NULL
            AND cl.closed_at IS NULL
          ORDER BY cl.id DESC
          LIMIT 8`
      ),
      // A9: 実績が契約額を超過した条件明細(過大計上/重複実績の候補)。
      //   消化型で consumed_amount > amount_ex_tax。重複検収/計算書を取り込むと発生。
      //   ※ F2b の重複排除が効いていれば 0 のはず(整合性の常時監視)。
      probe(
        {
          key: "condition_lines_overconsumed",
          label: "実績が契約額を超過した条件明細",
          description:
            "消化型で消化額が契約額(amount_ex_tax)を超過。重複検収/重複計算書など実績の二重計上候補(advisory)。",
          repair_action: null,
        },
        `SELECT COUNT(*)::int AS n
           FROM condition_line_status_v s
           JOIN condition_lines cl ON cl.id = s.id
          WHERE s.payment_scheme IN ('lump_sum','per_unit','installment')
            AND cl.amount_ex_tax IS NOT NULL
            AND s.consumed_amount > cl.amount_ex_tax`,
        `SELECT s.line_code, cl.amount_ex_tax, s.consumed_amount,
                s.event_count, cl.capability_id
           FROM condition_line_status_v s
           JOIN condition_lines cl ON cl.id = s.id
          WHERE s.payment_scheme IN ('lump_sum','per_unit','installment')
            AND cl.amount_ex_tax IS NOT NULL
            AND s.consumed_amount > cl.amount_ex_tax
          ORDER BY (s.consumed_amount - cl.amount_ex_tax) DESC
          LIMIT 8`
      ),
      // A10: 完了済みなのに課題が未終結(循環が閉じていない候補)。
      //   条件明細が fulfilled/expired なのに、紐づく課題(issue_workflows)が
      //   完了/終結/キャンセル/差戻し 以外のステータスのまま。
      probe(
        {
          key: "completed_lines_open_issue",
          label: "完了済みなのに課題が未終結",
          description:
            "条件明細が fulfilled/expired なのに、紐づく課題ワークフローが終端(完了/終結/キャンセル/差戻し)以外のまま。循環が閉じていない候補(advisory)。",
          repair_action: null,
        },
        `SELECT COUNT(DISTINCT s.id)::int AS n
           FROM condition_line_status_v s
           JOIN contract_capabilities cc ON cc.id = s.capability_id
           JOIN issue_workflows iw ON iw.backlog_issue_key = cc.backlog_issue_key
          WHERE s.status IN ('fulfilled','expired')
            AND COALESCE(iw.current_status_name, '') NOT IN ('完了','終結','キャンセル','差戻し')`,
        `SELECT s.line_code, s.status, cc.backlog_issue_key,
                iw.current_status_name
           FROM condition_line_status_v s
           JOIN contract_capabilities cc ON cc.id = s.capability_id
           JOIN issue_workflows iw ON iw.backlog_issue_key = cc.backlog_issue_key
          WHERE s.status IN ('fulfilled','expired')
            AND COALESCE(iw.current_status_name, '') NOT IN ('完了','終結','キャンセル','差戻し')
          ORDER BY cc.backlog_issue_key
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
              "final/正本の発注書(purchase_order)に対応する contract_capabilities が無い。検収待ち等に出ない。要手動連結。(superseded 旧版・枝番は除外)",
            repair_action: null,
          },
          `SELECT COUNT(*)::int AS n FROM documents d
            WHERE d.template_type = 'purchase_order'
              AND COALESCE(d.is_primary, TRUE) = TRUE
              AND COALESCE(d.lifecycle_status, 'final') = 'final'
              AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc
                               WHERE cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number))`,
          `SELECT d.document_number, d.issue_key FROM documents d
            WHERE d.template_type = 'purchase_order'
              AND COALESCE(d.is_primary, TRUE) = TRUE
              AND COALESCE(d.lifecycle_status, 'final') = 'final'
              AND NOT EXISTS (SELECT 1 FROM contract_capabilities cc
                               WHERE cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number))
            ORDER BY d.created_at DESC LIMIT 8`
        ),
        // ⑦ documents の無い capability — 連結欠落(検出のみ)
        probe(
          {
            key: "capabilities_without_document",
            label: "documents未連結のcapability",
            description:
              "final/正本の空 contract_capabilities(条件明細なし)に対応する documents が無い。PDF/編集できない孤立 capability の候補。(除外: 合成 MLC- 登録器 source_system='master_register' / superseded 旧版 / condition_lines を持つ登録条件=文書なしが正常)",
            repair_action: null,
          },
          `SELECT COUNT(*)::int AS n FROM contract_capabilities cc
            WHERE cc.document_number IS NOT NULL
              AND COALESCE(cc.source_system, '') <> 'master_register'
              AND COALESCE(cc.is_primary, TRUE) = TRUE
              AND COALESCE(cc.lifecycle_status, 'final') = 'final'
              AND NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.capability_id = cc.id)
              AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.document_number = cc.document_number)`,
          `SELECT cc.id, cc.document_number, cc.record_type FROM contract_capabilities cc
            WHERE cc.document_number IS NOT NULL
              AND COALESCE(cc.source_system, '') <> 'master_register'
              AND COALESCE(cc.is_primary, TRUE) = TRUE
              AND COALESCE(cc.lifecycle_status, 'final') = 'final'
              AND NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.capability_id = cc.id)
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
                        COALESCE(cc.vendor_id, parent_cc.vendor_id, doc_vendor.id) AS suggested_counterparty_vendor_id
                   FROM condition_lines cl
                   LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
                   LEFT JOIN contract_capabilities parent_cc ON parent_cc.id = cc.parent_capability_id
                   LEFT JOIN documents d ON d.document_number = cc.document_number
                   LEFT JOIN legal_requests lr ON lr.backlog_issue_key = COALESCE(cc.backlog_issue_key, d.issue_key)
                   LEFT JOIN LATERAL (
                     SELECT v.id
                       FROM vendors v
                      WHERE LOWER(BTRIM(v.vendor_name)) = LOWER(BTRIM(COALESCE(
                              NULLIF(d.form_data->>'vendor_name', ''),
                              NULLIF(d.form_data->>'vendorName', ''),
                              NULLIF(d.form_data->>'VENDOR_NAME', ''),
                              NULLIF(d.form_data->>'counterparty', ''),
                              NULLIF(d.form_data->>'licensor', ''),
                              NULLIF(d.form_data->>'licensor_name', ''),
                              NULLIF(d.form_data->>'Licensor_名称', ''),
                              NULLIF(lr.counterparty, '')
                            )))
                      ORDER BY v.id
                      LIMIT 1
                   ) doc_vendor ON TRUE
                  WHERE cl.counterparty_vendor_id IS NULL
                    AND COALESCE(cc.vendor_id, parent_cc.vendor_id, doc_vendor.id) IS NOT NULL
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

        if (action === "backfill_contract_condition_lines") {
          // A2 修復: final/正本の締結文書(発注書・条件書)で condition_lines が
          //   未生成のものを、正準生成経路 syncConditionLinesForCapability で復元する。
          //   - capability 配下の capability_line_items / capability_financial_conditions
          //     から冪等に condition_lines を生成(source_* の NOT EXISTS で二重生成防止)。
          //   - dry_run(既定 true): 同一トランザクションで生成→ROLLBACK し、実際に
          //     生成される件数を正確にプレビューする(本番DBは変更しない)。
          //   - dry_run=false: COMMIT して確定。
          const dryRun = req.body?.dry_run !== false;

          const targets = (
            await query(
              `SELECT d.id AS document_id,
                      d.document_number,
                      d.issue_key,
                      d.template_type,
                      cc.id AS capability_id
                 FROM documents d
                 LEFT JOIN contract_capabilities cc
                   ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
                 LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
                WHERE d.template_type = ANY($1::text[])
                  AND COALESCE(d.lifecycle_status, 'final') = 'final'
                  AND COALESCE(d.is_primary, TRUE) = TRUE
                  AND cl.id IS NULL
                ORDER BY d.created_at DESC NULLS LAST
                LIMIT $2`,
              [CONTRACTING_TEMPLATE_TYPES, limit]
            )
          ).rows;

          const report = {
            regenerated: [] as any[],
            skipped_no_capability: [] as any[],
            skipped_empty_source: [] as any[],
          };
          let totalLines = 0;

          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            // syncConditionLinesForCapability にトランザクション接続を渡す。
            const txDb = {
              query: (text: string, params?: any[]) => client.query(text, params),
            };
            // 同一 capability の二重処理を避ける(同一capabilityを指す文書が複数の場合)。
            const processed = new Set<number>();
            for (const t of targets) {
              if (!t.capability_id) {
                report.skipped_no_capability.push({
                  document_number: t.document_number,
                  issue_key: t.issue_key,
                  template_type: t.template_type,
                });
                continue;
              }
              if (processed.has(t.capability_id)) continue;
              processed.add(t.capability_id);
              const n = await syncConditionLinesForCapability(txDb, t.capability_id);
              if (n > 0) {
                report.regenerated.push({
                  document_number: t.document_number,
                  issue_key: t.issue_key,
                  capability_id: t.capability_id,
                  lines: n,
                });
                totalLines += n;
              } else {
                // capability はあるが capability_line_items / financial_conditions が
                //   無い = 明細が form_data にしか存在しない。form_data 再構成が必要な
                //   別系統(手動/別フォロー)。ここでは生成せず分けて報告する。
                report.skipped_empty_source.push({
                  document_number: t.document_number,
                  issue_key: t.issue_key,
                  capability_id: t.capability_id,
                });
              }
            }
            if (dryRun) await client.query("ROLLBACK");
            else await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }

          return res.json({
            ok: true,
            action,
            dry_run: dryRun,
            affected: totalLines,
            detail: {
              documents_total: targets.length,
              regenerated_lines: totalLines,
              regenerated_documents: report.regenerated.length,
              skipped_no_capability: report.skipped_no_capability.length,
              skipped_empty_source: report.skipped_empty_source.length,
              report,
            },
          });
        }

        if (action === "backfill_payment_condition_events") {
          // A3 修復: 検収書・計算書があるのに condition_events が無い文書の実績を、
          //   正準同期経路で復元する。
          //   - 検収: delivery_events 配下の検収明細 → syncInspectionEventsForDelivery。
          //   - 計算書: royalty_calculations → syncRoyaltyCalcEvent。
          //   いずれも condition_lines が存在することが前提(無ければ skip)＝F1(A2)を
          //   先に適用しておくこと。両 sync は冪等(source_* の NOT EXISTS で二重生成しない)。
          //   dry_run(既定 true): トランザクション内で生成→ROLLBACK し、生成件数だけ報告。
          const dryRun = req.body?.dry_run !== false;

          let inspectionEvents = 0;
          let royaltyEvents = 0;
          const deliveryEventsTouched: number[] = [];
          const royaltyCalcsTouched: number[] = [];

          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const txDb = {
              query: (text: string, params?: any[]) => client.query(text, params),
            };

            // 検収側: 実績未生成だが condition_lines がある delivery_event を走査。
            const deRows = (
              await client.query(
                `SELECT DISTINCT de.id
                   FROM delivery_events de
                   JOIN delivery_line_items dli ON dli.delivery_event_id = de.id
                  WHERE NOT EXISTS (
                          SELECT 1 FROM condition_events ce
                           WHERE ce.source_delivery_line_item_id = dli.id)
                    AND EXISTS (
                          SELECT 1 FROM condition_lines cl
                           WHERE cl.source_line_item_id = dli.capability_line_item_id)
                  ORDER BY de.id
                  LIMIT $1`,
                [limit]
              )
            ).rows;
            for (const e of deRows) {
              const n = await syncInspectionEventsForDelivery(txDb, Number(e.id));
              if (n > 0) {
                inspectionEvents += n;
                deliveryEventsTouched.push(Number(e.id));
              }
            }

            // 計算書側: 実績未生成だが condition_lines がある royalty_calculation を走査。
            const rcRows = (
              await client.query(
                `SELECT rc.id
                   FROM royalty_calculations rc
                  WHERE NOT EXISTS (
                          SELECT 1 FROM condition_events ce
                           WHERE ce.source_royalty_calculation_id = rc.id)
                    AND rc.capability_financial_condition_id IS NOT NULL
                    AND EXISTS (
                          SELECT 1 FROM condition_lines cl
                           WHERE cl.source_condition_id = rc.capability_financial_condition_id)
                  ORDER BY rc.id
                  LIMIT $1`,
                [limit]
              )
            ).rows;
            for (const r of rcRows) {
              const n = await syncRoyaltyCalcEvent(txDb, Number(r.id));
              if (n > 0) {
                royaltyEvents += n;
                royaltyCalcsTouched.push(Number(r.id));
              }
            }

            if (dryRun) await client.query("ROLLBACK");
            else await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }

          return res.json({
            ok: true,
            action,
            dry_run: dryRun,
            affected: inspectionEvents + royaltyEvents,
            detail: {
              inspection_events: inspectionEvents,
              royalty_events: royaltyEvents,
              delivery_events_touched: deliveryEventsTouched.length,
              royalty_calcs_touched: royaltyCalcsTouched.length,
            },
          });
        }

        if (action === "normalize_superseded_revisions") {
          // A6 修復: is_primary=false なのに lifecycle_status='final' の旧版を
          //   'superseded' 化する。原因は baseline 移行で lifecycle_status を一律
          //   'final' 初期化した一方 is_primary は新版優先で false にしたため、旧版が
          //   final のまま残ったこと。base_document_number 家族に primary 版が存在する
          //   ものだけを superseded 化(superseded_by = primary の document_number)。
          //   primary 版が無い(=正本欠落)ものは触らず residual として報告(要手動)。
          //   dry_run(既定 true): tx 内で UPDATE→件数取得→ROLLBACK。
          const dryRun = req.body?.dry_run !== false;

          let documentsSuperseded = 0;
          let capabilitiesSuperseded = 0;
          let residualDocuments = 0;
          let residualCapabilities = 0;

          const client = await pool.connect();
          try {
            await client.query("BEGIN");

            const d = await client.query(
              `UPDATE documents d
                  SET lifecycle_status = 'superseded',
                      superseded_by = COALESCE(NULLIF(d.superseded_by, ''), p.document_number)
                 FROM documents p
                WHERE COALESCE(d.is_primary, TRUE) = FALSE
                  AND COALESCE(d.lifecycle_status, 'final') = 'final'
                  AND d.base_document_number IS NOT NULL
                  AND p.base_document_number = d.base_document_number
                  AND COALESCE(p.is_primary, TRUE) = TRUE
                  AND COALESCE(p.lifecycle_status, 'final') = 'final'`
            );
            documentsSuperseded = d.rowCount || 0;

            const c = await client.query(
              `UPDATE contract_capabilities cc
                  SET lifecycle_status = 'superseded',
                      superseded_by = COALESCE(NULLIF(cc.superseded_by, ''), p.document_number)
                 FROM contract_capabilities p
                WHERE COALESCE(cc.is_primary, TRUE) = FALSE
                  AND COALESCE(cc.lifecycle_status, 'final') = 'final'
                  AND cc.base_document_number IS NOT NULL
                  AND p.base_document_number = cc.base_document_number
                  AND COALESCE(p.is_primary, TRUE) = TRUE
                  AND COALESCE(p.lifecycle_status, 'final') = 'final'`
            );
            capabilitiesSuperseded = c.rowCount || 0;

            // 残り(primary 版が無い等で superseded 化できなかった非primary final)。
            residualDocuments = Number(
              (
                await client.query(
                  `SELECT COUNT(*)::int AS n FROM documents
                    WHERE COALESCE(is_primary, TRUE) = FALSE
                      AND COALESCE(lifecycle_status, 'final') = 'final'`
                )
              ).rows[0].n
            );
            residualCapabilities = Number(
              (
                await client.query(
                  `SELECT COUNT(*)::int AS n FROM contract_capabilities
                    WHERE COALESCE(is_primary, TRUE) = FALSE
                      AND COALESCE(lifecycle_status, 'final') = 'final'`
                )
              ).rows[0].n
            );

            if (dryRun) await client.query("ROLLBACK");
            else await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }

          return res.json({
            ok: true,
            action,
            dry_run: dryRun,
            affected: documentsSuperseded + capabilitiesSuperseded,
            detail: {
              documents_superseded: documentsSuperseded,
              capabilities_superseded: capabilitiesSuperseded,
              residual_documents_no_primary: residualDocuments,
              residual_capabilities_no_primary: residualCapabilities,
            },
          });
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
