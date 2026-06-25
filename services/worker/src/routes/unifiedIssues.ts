/**
 * unifiedIssues — 新課題(統一課題)導出API (read-only)。
 *
 * 設計: docs/design/unified-issue-ui-plan.md
 *   新課題 = 1 契約(capability, terms締結) を背骨に、配下の条件明細・支払実績・
 *   バラバラ起案された兄弟課題(締結1 + 支払N)を束ねた導出ビュー。新テーブルなし。
 *
 *   GET /api/unified-issues               … 契約単位の集約一覧(段階レーン・進捗・構成課題数)
 *   GET /api/unified-issues/:capabilityId … 1契約の詳細(構成課題・文書・条件明細進捗・次文書)
 *
 *   締結フェイズ課題が無い契約(取込/登録条件由来)も出す【決定 (a)】。
 *   合成 MLC- 登録器(source_system='master_register')は除外。
 */

import type { Express } from "express";

export interface UnifiedIssuesDeps {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

// 締結文書(契約文書)の template_type。
const CONTRACTING_TEMPLATES = [
  "purchase_order",
  "intl_purchase_order",
  "individual_license_terms",
  "pub_license_terms",
  "license_master",
  "service_master",
  "pub_master_individual",
  "pub_master_corporate",
];

export function registerUnifiedIssues(app: Express, deps: UnifiedIssuesDeps) {
  const { query } = deps;

  // 新スキーマ未適用環境(42P01/42703)では空で返す。
  const isMissingSchema = (e: any) => e && (e.code === "42P01" || e.code === "42703");

  /**
   * 一覧: 契約(capability)単位の集約。
   */
  app.get("/api/unified-issues", async (_req, res) => {
    try {
      const result = await query(
        `WITH caps AS (
           SELECT cc.id, cc.document_number, cc.contract_title, cc.record_type,
                  cc.contract_category, cc.vendor_id, cc.backlog_issue_key,
                  cc.effective_date, cc.expiration_date
             FROM contract_capabilities cc
            WHERE COALESCE(cc.is_primary, TRUE) = TRUE
              AND COALESCE(cc.lifecycle_status, 'final') = 'final'
              AND COALESCE(cc.source_system, '') <> 'master_register'
              -- delivery_record は検収/納品の支援 capability(締結契約でない・親POの支払側)。
              AND cc.record_type <> 'delivery_record'
              AND ( EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.capability_id = cc.id)
                 OR EXISTS (SELECT 1 FROM documents d WHERE d.document_number = cc.document_number) )
         )
         SELECT c.id AS capability_id,
                c.document_number,
                c.contract_title,
                c.record_type,
                c.contract_category,
                c.backlog_issue_key AS contracting_issue_key,
                c.effective_date,
                c.expiration_date,
                v.vendor_name,
                EXISTS (SELECT 1 FROM documents d
                         WHERE d.document_number = c.document_number
                           AND COALESCE(d.lifecycle_status, 'final') = 'final') AS has_contract_doc,
                (SELECT COUNT(*)::int FROM condition_lines cl WHERE cl.capability_id = c.id) AS line_count,
                (SELECT COUNT(*)::int FROM condition_line_status_v s
                   WHERE s.capability_id = c.id
                     AND s.status NOT IN ('fulfilled','expired','cancelled')) AS open_lines,
                (SELECT COUNT(*)::int FROM condition_line_status_v s
                   WHERE s.capability_id = c.id
                     AND s.status IN ('fulfilled','expired')) AS completed_lines,
                (SELECT COALESCE(SUM(s.remaining_amount),0) FROM condition_line_status_v s
                   WHERE s.capability_id = c.id
                     AND s.remaining_amount IS NOT NULL AND s.remaining_amount > 0) AS remaining_amount,
                (SELECT COUNT(*)::int FROM condition_events ce
                   JOIN condition_lines cl ON cl.id = ce.condition_line_id
                  WHERE cl.capability_id = c.id AND ce.voided_at IS NULL) AS event_count,
                EXISTS (SELECT 1 FROM condition_events ce
                   JOIN condition_lines cl ON cl.id = ce.condition_line_id
                  WHERE cl.capability_id = c.id AND ce.voided_at IS NULL
                    AND ce.event_type = 'inspection') AS has_inspection,
                EXISTS (SELECT 1 FROM condition_events ce
                   JOIN condition_lines cl ON cl.id = ce.condition_line_id
                  WHERE cl.capability_id = c.id AND ce.voided_at IS NULL
                    AND ce.event_type = 'royalty_calc') AS has_royalty,
                (SELECT COUNT(DISTINCT k)::int FROM (
                   SELECT c.backlog_issue_key AS k WHERE NULLIF(c.backlog_issue_key,'') IS NOT NULL
                   UNION
                   SELECT ce.backlog_issue_key
                     FROM condition_events ce JOIN condition_lines cl ON cl.id = ce.condition_line_id
                    WHERE cl.capability_id = c.id AND ce.voided_at IS NULL
                      AND NULLIF(ce.backlog_issue_key,'') IS NOT NULL
                 ) ks) AS issue_count,
                -- 未完了で次に文書を出すべき明細(消化型→検収書 / 継続型→計算書)
                (SELECT COUNT(*)::int FROM condition_line_status_v s
                   WHERE s.capability_id = c.id
                     AND s.status NOT IN ('fulfilled','expired','cancelled','pending')) AS next_action_lines
           FROM caps c
           LEFT JOIN vendors v ON v.id = c.vendor_id
          ORDER BY c.effective_date DESC NULLS LAST, c.id DESC
          LIMIT 500`
      );

      const rows = result.rows.map((r: any) => ({
        ...r,
        // 段階レーン(締結→検収→計算)の到達フラグ。
        stage: {
          contracting: r.has_contract_doc === true,
          inspection: r.has_inspection === true,
          royalty: r.has_royalty === true,
        },
        completed:
          Number(r.line_count) > 0 && Number(r.open_lines) === 0,
      }));

      res.json({ ok: true, total: rows.length, unified_issues: rows });
    } catch (e: any) {
      if (isMissingSchema(e)) {
        return res.json({ ok: true, total: 0, unified_issues: [] });
      }
      console.error("/api/unified-issues failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /**
   * 詳細: 1契約(capability)の構成課題・文書・条件明細進捗・次文書。
   */
  app.get("/api/unified-issues/:capabilityId", async (req, res) => {
    const capabilityId = Number(req.params.capabilityId);
    if (!Number.isFinite(capabilityId) || capabilityId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid capabilityId" });
    }
    try {
      // ヘッダ
      const capRes = await query(
        `SELECT cc.id, cc.document_number, cc.contract_title, cc.record_type,
                cc.contract_category, cc.backlog_issue_key, cc.effective_date,
                cc.expiration_date, v.vendor_name
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE cc.id = $1`,
        [capabilityId]
      );
      if (capRes.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "capability not found" });
      }
      const header = capRes.rows[0];

      // 条件明細(進捗・残高・次文書・直近イベント)
      const linesRes = await query(
        `SELECT cl.id,
                cl.line_code,
                cl.subject,
                cl.payment_scheme,
                cl.amount_ex_tax,
                cl.currency,
                cl.term_start,
                cl.term_end,
                s.status,
                s.consumed_amount,
                s.remaining_amount,
                s.event_count,
                s.last_event_at,
                b.mg_remaining,
                b.ag_remaining,
                CASE
                  WHEN s.status IN ('fulfilled','expired') THEN NULL
                  WHEN cl.payment_scheme IN ('lump_sum','per_unit','installment') THEN 'inspection_certificate'
                  WHEN cl.payment_scheme IN ('subscription','royalty') THEN 'royalty_statement'
                  ELSE NULL
                END AS next_template_type,
                (SELECT COALESCE(json_agg(ev), '[]'::json) FROM (
                   SELECT ce.event_no, ce.event_type, ce.occurred_at, ce.period,
                          ce.amount_ex_tax, ce.backlog_issue_key,
                          d.document_number, d.template_type
                     FROM condition_events ce
                     LEFT JOIN documents d ON d.id = ce.document_id
                    WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
                    ORDER BY ce.occurred_at DESC NULLS LAST, ce.event_no DESC
                    LIMIT 5
                 ) ev) AS recent_events
           FROM condition_lines cl
           LEFT JOIN condition_line_status_v s ON s.id = cl.id
           LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
          WHERE cl.capability_id = $1
          ORDER BY cl.line_no NULLS LAST, cl.id`,
        [capabilityId]
      );

      // 構成課題(締結1 + 支払N)。issue_workflows / legal_requests からステータス補完。
      const issuesRes = await query(
        `WITH issue_keys AS (
           SELECT cc.backlog_issue_key AS issue_key, 'contracting'::text AS phase
             FROM contract_capabilities cc
            WHERE cc.id = $1 AND NULLIF(cc.backlog_issue_key,'') IS NOT NULL
           UNION
           SELECT ce.backlog_issue_key AS issue_key, 'payment'::text AS phase
             FROM condition_events ce
             JOIN condition_lines cl ON cl.id = ce.condition_line_id
            WHERE cl.capability_id = $1 AND ce.voided_at IS NULL
              AND NULLIF(ce.backlog_issue_key,'') IS NOT NULL
         )
         SELECT ik.issue_key,
                -- 同一課題が両フェイズに出たら mixed
                CASE WHEN COUNT(DISTINCT ik.phase) > 1 THEN 'mixed' ELSE MAX(ik.phase) END AS phase,
                MAX(iw.current_status_name) AS status_name,
                BOOL_OR(lr.merged_into_issue_key IS NOT NULL) AS merged
           FROM issue_keys ik
           LEFT JOIN issue_workflows iw ON iw.backlog_issue_key = ik.issue_key
           LEFT JOIN legal_requests lr ON lr.backlog_issue_key = ik.issue_key
          GROUP BY ik.issue_key
          ORDER BY ik.issue_key`,
        [capabilityId]
      );

      // 文書(締結文書 + 支払文書)。締結=cc.document_number, 支払=events.document_id。
      const docsRes = await query(
        `WITH doc_ids AS (
           SELECT d.id
             FROM documents d
             JOIN contract_capabilities cc
               ON cc.document_number = COALESCE(NULLIF(d.base_document_number,''), d.document_number)
            WHERE cc.id = $1
           UNION
           SELECT ce.document_id AS id
             FROM condition_events ce
             JOIN condition_lines cl ON cl.id = ce.condition_line_id
            WHERE cl.capability_id = $1 AND ce.voided_at IS NULL AND ce.document_id IS NOT NULL
         )
         SELECT d.id, d.document_number, d.template_type, d.issue_key,
                d.created_at, d.created_by, d.drive_link,
                COALESCE(d.lifecycle_status,'final') AS lifecycle_status,
                COALESCE(d.is_primary, TRUE) AS is_primary,
                CASE WHEN d.template_type = ANY($2::text[]) THEN 'contracting' ELSE 'payment' END AS phase
           FROM documents d
          WHERE d.id IN (SELECT id FROM doc_ids WHERE id IS NOT NULL)
          ORDER BY (d.template_type = ANY($2::text[])) DESC, d.created_at DESC NULLS LAST`,
        [capabilityId, CONTRACTING_TEMPLATES]
      );

      const lines = linesRes.rows;
      res.json({
        ok: true,
        header,
        summary: {
          line_count: lines.length,
          open: lines.filter((r: any) => !["fulfilled", "expired", "cancelled"].includes(String(r.status || ""))).length,
          completed: lines.filter((r: any) => ["fulfilled", "expired"].includes(String(r.status || ""))).length,
          next_actions: lines.filter((r: any) => r.next_template_type).length,
          issue_count: issuesRes.rows.length,
        },
        issues: issuesRes.rows,
        documents: docsRes.rows,
        lines,
      });
    } catch (e: any) {
      if (isMissingSchema(e)) {
        return res.json({ ok: true, header: null, summary: {}, issues: [], documents: [], lines: [] });
      }
      console.error("/api/unified-issues/:capabilityId failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /**
   * リゾルバ: 個別 Backlog 課題 → 所属する新課題(契約=capability)。
   *   締結課題(cc.backlog_issue_key)と支払課題(condition_events.backlog_issue_key)の
   *   両経路から該当 capability を引く。IssueDetailPage から「統一課題で見る」導線に使う。
   */
  app.get("/api/issues/:issueKey/unified", async (req, res) => {
    const issueKey = String(req.params.issueKey || "").trim();
    if (!issueKey) return res.json({ ok: true, unified_issues: [] });
    try {
      const result = await query(
        `SELECT DISTINCT cc.id AS capability_id, cc.document_number,
                cc.contract_title, cc.record_type, v.vendor_name
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE cc.backlog_issue_key = $1
            AND COALESCE(cc.source_system, '') <> 'master_register'
            AND cc.record_type <> 'delivery_record'
          UNION
         SELECT DISTINCT cc.id AS capability_id, cc.document_number,
                cc.contract_title, cc.record_type, v.vendor_name
           FROM condition_events ce
           JOIN condition_lines cl ON cl.id = ce.condition_line_id
           JOIN contract_capabilities cc ON cc.id = cl.capability_id
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE ce.backlog_issue_key = $1
            AND ce.voided_at IS NULL
            AND COALESCE(cc.source_system, '') <> 'master_register'
            AND cc.record_type <> 'delivery_record'
          ORDER BY capability_id`,
        [issueKey]
      );
      res.json({ ok: true, unified_issues: result.rows });
    } catch (e: any) {
      if (isMissingSchema(e)) return res.json({ ok: true, unified_issues: [] });
      console.error("/api/issues/:issueKey/unified failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
