/**
 * Phase 23 — 統一検索API (read-only)
 *
 *   GET /api/contracts/search?q=&record_types=&category=&limit=
 *     → contract_capabilities を一括検索。フォームの親契約 picker 用。
 *
 *   GET /api/contracts/:id
 *     → contract_capabilities 詳細 + 子テーブル (line_items, financial_conditions,
 *       expenses, other_fees) + vendor + 検収集計 + documents.drive_link。
 *
 * 旧 /api/order-items/list, /api/order-items/by-issue/:key,
 * /api/license-contracts/by-issue/:key を全置換する。
 */

import type { Express, RequestHandler } from "express";

export interface ContractsV2Deps {
  query: (text: string, params?: any[]) => Promise<any>;
  // Phase 23.0.4: portal secret 認証ミドルウェア。
  // search / detail とも社内テナント (admin-ui) 専用なので必須化。
  requirePortalSecret: RequestHandler;
}

/**
 * Phase E-2: 契約詳細の利用許諾(財務)条件を coverage-gated dual-read で取得。
 *   財務条件は status_flags 等の運用状態を持たない純表示データなので安全に
 *   condition_lines 優先へ切替可能。A案で暗黙 terms に切り出された分も
 *   source_condition_id 経由で連結、condition_no は source_seq_no で faithful 復元。
 *   完全カバー時のみ condition_lines、欠ければ capability_financial_conditions。
 */
async function readFinancialConditionsForDisplay(
  query: (text: string, params?: any[]) => Promise<any>,
  capabilityId: number
): Promise<any[]> {
  try {
    const cl = await query(
      `SELECT cl.source_condition_id AS id, cl.source_seq_no AS condition_no,
              cl.subject AS region_language_label, cl.calc_method, cl.rate_pct,
              cl.base_price_label, cl.calc_period, cl.currency, cl.formula_text,
              cl.payment_terms, cl.mg_amount, COALESCE(cl.ag_amount, 0) AS ag_amount,
              cl.calc_period_kind, cl.calc_period_close_month
         FROM condition_lines cl
        WHERE cl.source_condition_id IN (
                SELECT id FROM capability_financial_conditions WHERE capability_id = $1)
        ORDER BY cl.source_seq_no ASC NULLS LAST, cl.id`,
      [capabilityId]
    );
    const oldCount = await query(
      `SELECT COUNT(*)::int AS c FROM capability_financial_conditions WHERE capability_id = $1`,
      [capabilityId]
    );
    if (cl.rows.length > 0 && cl.rows.length === Number(oldCount.rows[0].c)) {
      return cl.rows;
    }
  } catch (err: any) {
    if (!err || (err.code !== "42P01" && err.code !== "42703")) throw err;
  }
  return (
    await query(
      `SELECT * FROM capability_financial_conditions
        WHERE capability_id = $1 ORDER BY condition_no`,
      [capabilityId]
    )
  ).rows;
}

export function registerContractsV2(app: Express, deps: ContractsV2Deps) {
  /**
   * 統一検索。
   *   record_types : カンマ区切り (purchase_order,individual_contract,...)
   *                  指定なしなら全件
   *   category     : カンマ区切り (service,license,...)
   *                  指定なしなら全件
   *   q            : title / document_number / vendor_name / backlog_issue_key /
   *                  vendor_code の ILIKE 部分一致
   *   limit        : デフォルト 50, 最大 200
   *   include_inactive=1 を付けると is_active=FALSE も返す
   */
  app.get("/api/contracts/search", deps.requirePortalSecret, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const recordTypesRaw = String(req.query.record_types || "").trim();
      const categoryRaw = String(req.query.category || "").trim();
      const includeInactive = String(req.query.include_inactive || "") === "1";
      // Phase 23.1: 履歴 (archived_draft / reissued) も含めるトグル。
      //   default は false (= lifecycle_status='final' のみ)。
      const includeHistory = String(req.query.include_history || "") === "1";
      const limit = Math.min(Number(req.query.limit) || 50, 200);

      const recordTypes = recordTypesRaw
        ? recordTypesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const categories = categoryRaw
        ? categoryRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      const where: string[] = [];
      const params: any[] = [];
      if (recordTypes.length > 0) {
        params.push(recordTypes);
        where.push(`cc.record_type = ANY($${params.length}::text[])`);
      }
      if (categories.length > 0) {
        params.push(categories);
        where.push(`cc.contract_category = ANY($${params.length}::text[])`);
      }
      if (!includeInactive) {
        where.push(`COALESCE(cc.is_active, TRUE) = TRUE`);
      }
      // Phase 23.1: lifecycle_status='final' のみを既定で返す。
      //   include_history=1 で archived_draft / reissued も含める。
      if (!includeHistory) {
        where.push(`COALESCE(cc.lifecycle_status, 'final') = 'final'`);
      }
      if (q) {
        params.push(`%${q}%`);
        const i = params.length;
        where.push(
          `(cc.contract_title ILIKE $${i}
             OR cc.document_number ILIKE $${i}
             OR cc.backlog_issue_key ILIKE $${i}
             OR EXISTS (SELECT 1 FROM vendors v
                         WHERE v.id = cc.vendor_id
                           AND (v.vendor_name ILIKE $${i} OR v.vendor_code ILIKE $${i})))`
        );
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      params.push(limit);
      const limitParam = `$${params.length}`;

      // 検収待ち(unissued_line_count)の算出式。
      //   新台帳優先の coverage-gated dual-read。検収(消化型: lump_sum/per_unit/installment)
      //   で未消化(status open/partially_fulfilled)の行のみ数える。subscription/royalty は
      //   消化型ステータスにならず自然に除外され、旧ロジックが継続役務(顧問/月額保守等)を
      //   検収待ちに混入させていた過剰カウントを是正する。カバレッジ未充足(条件明細の
      //   line item 由来件数 ≠ 旧明細件数, または 0)は CASE が NULL を返し、COALESCE で
      //   旧 status_flags 方式へフォールバック。
      const unissuedNewExpr = `
          COALESCE(
            (SELECT CASE
               WHEN (SELECT COUNT(*) FROM condition_lines x
                      WHERE x.capability_id = cc.id AND x.source_line_item_id IS NOT NULL)
                    = (SELECT COUNT(*) FROM capability_line_items y WHERE y.capability_id = cc.id)
                AND (SELECT COUNT(*) FROM capability_line_items y WHERE y.capability_id = cc.id) > 0
               THEN (
                 SELECT COUNT(*)::int FROM condition_lines cl
                   JOIN condition_line_status_v s ON s.id = cl.id
                  WHERE cl.capability_id = cc.id
                    AND cl.source_line_item_id IS NOT NULL
                    AND cl.payment_scheme IN ('lump_sum','per_unit','installment')
                    AND COALESCE(cl.amount_ex_tax, 0) > 0
                    AND s.status IN ('open','partially_fulfilled')
               )
               ELSE NULL END),
            (SELECT COUNT(*) FROM capability_line_items cli
               WHERE cli.capability_id = cc.id
                 AND COALESCE(cli.amount_ex_tax, 0) > 0
                 AND (cli.status_flags->>'inspection_issued') IS DISTINCT FROM 'true'
                 AND COALESCE(cli.inspected_amount_ex_tax, 0) < cli.amount_ex_tax - 0.5
            )
          ) AS unissued_line_count`;
      // 旧式(新台帳テーブル未適用環境向けフォールバック)。
      const unissuedLegacyExpr = `
          (SELECT COUNT(*) FROM capability_line_items cli
             WHERE cli.capability_id = cc.id
               AND COALESCE(cli.amount_ex_tax, 0) > 0
               AND (cli.status_flags->>'inspection_issued') IS DISTINCT FROM 'true'
               AND COALESCE(cli.inspected_amount_ex_tax, 0) < cli.amount_ex_tax - 0.5
          ) AS unissued_line_count`;

      const buildSql = (unissuedExpr: string) => `
        SELECT
          cc.id,
          cc.record_type,
          cc.contract_category,
          cc.contract_type,
          cc.contract_title,
          cc.document_number,
          cc.backlog_issue_key,
          cc.vendor_id,
          cc.amount_ex_tax,
          cc.amount_inc_tax,
          cc.tax_rate,
          cc.due_date,
          cc.issue_date_po,
          cc.effective_date,
          cc.expiration_date,
          cc.drive_url,
          cc.original_work,
          cc.ledger_code,
          cc.is_active,
          cc.lifecycle_status,
          cc.revision,
          cc.base_document_number,
          cc.created_at,
          v.vendor_code,
          v.vendor_name,
          v.entity_type AS vendor_entity_type,
          (SELECT COUNT(*) FROM capability_line_items cli WHERE cli.capability_id = cc.id) AS line_count,
          (SELECT COUNT(*) FROM capability_financial_conditions cfc WHERE cfc.capability_id = cc.id) AS condition_count,
          (SELECT COALESCE(SUM(cli.inspected_amount_ex_tax), 0)
             FROM capability_line_items cli WHERE cli.capability_id = cc.id) AS inspected_amount,
          -- 検収書未発行の明細数(検収待ち制御の主キー)。算出式は下で組み立て、
          --   新台帳テーブル未適用環境では旧 status_flags 方式へフォールバックする。
          ${unissuedExpr},
          -- 法務タスク制御: 納品報告(delivered_at)・納期(inspection_deadline)・
          --   「納期超過かつ未報告」を delivery_events(capability_id 結線) から導出。
          (SELECT MAX(de.delivered_at) FROM delivery_events de
             WHERE de.capability_id = cc.id) AS latest_delivered_at,
          (SELECT MIN(de.inspection_deadline) FROM delivery_events de
             WHERE de.capability_id = cc.id AND de.status = 'pending') AS nearest_inspection_deadline,
          EXISTS (SELECT 1 FROM delivery_events de
                   WHERE de.capability_id = cc.id AND de.delivered_at IS NOT NULL) AS has_delivery_report,
          EXISTS (SELECT 1 FROM delivery_events de
                   WHERE de.capability_id = cc.id AND de.status = 'pending'
                     AND de.delivered_at IS NULL
                     AND de.inspection_deadline < CURRENT_TIMESTAMP) AS overdue_no_report,
          -- 発注書由来の予定納期: 納品報告(delivery_events)が無く inspection_deadline が
          --   出ない検収待ち行向けに、未検収明細(capability_line_items.delivery_date)の
          --   最も近い納期を返す。画面は inspection_deadline が無い時のフォールバック表示に使う。
          (SELECT MIN(cli.delivery_date) FROM capability_line_items cli
             WHERE cli.capability_id = cc.id
               AND cli.delivery_date IS NOT NULL
               AND COALESCE(cli.amount_ex_tax, 0) > 0
               AND (cli.status_flags->>'inspection_issued') IS DISTINCT FROM 'true'
               AND COALESCE(cli.inspected_amount_ex_tax, 0) < cli.amount_ex_tax - 0.5
          ) AS nearest_line_delivery_date,
          (cc.backlog_issue_key LIKE 'IMPORT-%') AS is_imported
        FROM documents cc
        LEFT JOIN vendors v ON v.id = cc.vendor_id
        ${whereSql}
        ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC
        LIMIT ${limitParam}
      `;

      // 新台帳優先で実行。condition_lines/condition_line_status_v 未適用環境
      //   (42P01/42703)では旧式に切り替えて再実行(検収待ち一覧を落とさない)。
      let rows: any;
      try {
        rows = await deps.query(buildSql(unissuedNewExpr), params);
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          console.warn(
            "[/api/contracts/search] 新台帳未適用 — 検収待ちを旧 status_flags 方式で算出"
          );
          rows = await deps.query(buildSql(unissuedLegacyExpr), params);
        } else {
          throw err;
        }
      }
      res.json(
        rows.rows.map((r: any) => ({
          id: Number(r.id),
          record_type: r.record_type,
          contract_category: r.contract_category,
          contract_type: r.contract_type,
          contract_title: r.contract_title || "",
          document_number: r.document_number || "",
          backlog_issue_key: r.backlog_issue_key || "",
          vendor_id: r.vendor_id == null ? null : Number(r.vendor_id),
          vendor_code: r.vendor_code || "",
          vendor_name: r.vendor_name || "",
          vendor_entity_type: r.vendor_entity_type || "",
          amount_ex_tax: r.amount_ex_tax == null ? null : Number(r.amount_ex_tax),
          amount_inc_tax: r.amount_inc_tax == null ? null : Number(r.amount_inc_tax),
          tax_rate: r.tax_rate == null ? null : Number(r.tax_rate),
          due_date: r.due_date,
          // Phase 23.5: 発注書系の「発注日」。検収書フォームの orderDate
          //   自動補完で最優先キーとして使う (due_date は支払期限のため別概念)。
          issue_date_po: r.issue_date_po,
          effective_date: r.effective_date,
          expiration_date: r.expiration_date,
          drive_link: r.drive_url || "",
          original_work: r.original_work || "",
          ledger_code: r.ledger_code || "",
          is_active: r.is_active !== false,
          lifecycle_status: r.lifecycle_status || "final",
          revision: Number(r.revision) || 0,
          base_document_number: r.base_document_number || "",
          created_at: r.created_at,
          line_count: Number(r.line_count) || 0,
          condition_count: Number(r.condition_count) || 0,
          inspected_amount: Number(r.inspected_amount) || 0,
          remaining_amount:
            (Number(r.amount_ex_tax) || 0) - (Number(r.inspected_amount) || 0),
          // 検収書未発行(=検収待ち)の業務明細数。0 なら検収待ちではない。
          unissued_line_count: Number(r.unissued_line_count) || 0,
          // 法務タスク制御(検収待ち再構成)。delivery_events 由来。
          latest_delivered_at: r.latest_delivered_at || null,
          nearest_inspection_deadline: r.nearest_inspection_deadline || null,
          // 発注書由来の予定納期(納品報告前のフォールバック表示用)。
          nearest_line_delivery_date: r.nearest_line_delivery_date || null,
          has_delivery_report: !!r.has_delivery_report,
          overdue_no_report: !!r.overdue_no_report,
          is_imported: !!r.is_imported,
        }))
      );
    } catch (e: any) {
      console.error("/api/contracts/search failed:", e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  /**
   * 詳細取得。子テーブル全部 + vendor + 検収集計を返す。
   * 検収書フォームの onPick で必要な形にまとめる。
   */
  app.get("/api/contracts/:id", deps.requirePortalSecret, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "invalid id" });
      }
      const header = await deps.query(
        `SELECT cc.id, cc.vendor_id, cc.external_asset_id, cc.record_type, cc.contract_category, cc.contract_type, cc.contract_title, cc.document_number, cc.contract_status, cc.effective_date, cc.expiration_date, cc.auto_renewal, cc.source_system, cc.legalon_url, cc.cloudsign_url, cc.drive_url, cc.document_url, cc.purpose_codes, cc.purchase_order_allowed, cc.license_condition_allowed, cc.publication_contract_allowed, cc.publication_condition_allowed, cc.condition_number, cc.original_work, cc.work_name, cc.product_name, cc.media, cc.territory, cc.language, cc.scope, cc.covered_service_categories, cc.covered_works, cc.covered_products, cc.covered_media, cc.covered_territory, cc.covered_language, cc.sublicense_allowed, cc.overseas_allowed, cc.translation_allowed, cc.ebook_allowed, cc.merchandising_allowed, cc.video_adaptation_allowed, cc.game_adaptation_allowed, cc.risk_flags, cc.legal_review_required, cc.scope_confidence, cc.reason_template, cc.caution_note, cc.created_at, cc.updated_at, cc.base_document_number, cc.revision, cc.is_primary, cc.superseded_by, cc.lifecycle_status, cc.is_active, cc.additional_parties, cc.renewal_notice_months, cc.alert_lead_months, cc.last_renewal_alert_at, cc.alert_slack_channels, cc.alert_slack_mentions, cc.ledger_code, cc.ledger_ref_id, cc.material_ref_id, cc.tax_rate, cc.amount_ex_tax, cc.amount_inc_tax, cc.tax_amount, cc.due_date, cc.issue_date_po, cc.legal_request_id, cc.backlog_issue_key, cc.flow_direction, cc.deliverable_ownership, cc.structural_role, cc.parent_capability_id, cc.template_family, v.vendor_code, v.vendor_name, v.entity_type AS vendor_entity_type,
                v.bank_name, v.branch_name, v.account_type, v.account_number,
                v.account_holder_kana, v.invoice_registration_number,
                v.withholding_enabled, v.is_invoice_issuer, v.vendor_rep
           FROM documents cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE cc.id = $1`,
        [id]
      );
      if (header.rows.length === 0) {
        return res.status(404).json({ error: "contract not found" });
      }
      const cc = header.rows[0];

      const lines = await deps.query(
        `SELECT cli.*,
                COALESCE((
                  SELECT SUM(dli.inspected_amount_ex_tax)
                    FROM delivery_line_items dli
                   WHERE dli.capability_line_item_id = cli.id
                ), 0) AS inspected_amount_so_far
           FROM capability_line_items cli
          WHERE cli.capability_id = $1
          ORDER BY cli.line_no`,
        [id]
      );
      // Phase E-2: condition_lines 優先の coverage-gated dual-read (状態非依存)
      const conds = {
        rows: await readFinancialConditionsForDisplay(deps.query, id),
      };
      const expenses = await deps.query(
        `SELECT * FROM capability_expenses
          WHERE capability_id = $1 ORDER BY line_no`,
        [id]
      );
      const fees = await deps.query(
        `SELECT * FROM capability_other_fees
          WHERE capability_id = $1 ORDER BY line_no`,
        [id]
      );
      // Phase 23.6.10: form_data lookup を broaden する。
      //   直接 document_number でヒットしない場合 (例: ARC-PO-2026-0021_004
      //   が contract_capabilities にだけあって documents に無いケース) に、
      //   base_document_number の revision chain 全体を見にいく。
      //   ON CONFLICT (document_number) によるリビジョン管理の過程で、
      //   contract_capabilities と documents の document_number が一致しなく
      //   なっていることがあるため、その救済。
      //
      //   優先順位 (一番上が最良):
      //     1. document_number = cc.document_number (完全一致)
      //     2. document_number = cc.base_document_number (基底)
      //     3. document_number LIKE base_document_number || '\_%'
      //                                            (改版 _001 / _002 / ...)
      //     4. form_data に items[] が入っている方を優先
      //     5. created_at DESC で最新
      const docRow = await deps.query(
        `SELECT document_number, drive_link, created_at, form_data,
                CASE
                  WHEN document_number = $1 THEN 1
                  WHEN document_number = $2 THEN 2
                  ELSE 3
                END AS match_rank,
                (form_data ? 'items'
                   AND jsonb_typeof(form_data->'items') = 'array'
                   AND jsonb_array_length(form_data->'items') > 0) AS has_items
           FROM documents
          WHERE document_number = $1
             OR ($2 <> '' AND (
                  document_number = $2
                  OR document_number LIKE $2 || '\_%' ESCAPE '\'
                ))
          ORDER BY has_items DESC, match_rank ASC, created_at DESC
          LIMIT 1`,
        [cc.document_number, cc.base_document_number || ""]
      );
      if (
        docRow.rows.length > 0 &&
        docRow.rows[0].document_number !== cc.document_number
      ) {
        console.log(
          `[contracts/${id}] form_data fallback: ${cc.document_number} → ${docRow.rows[0].document_number} (base=${cc.base_document_number})`
        );
      }
      // form_data は下の lineRows 空フォールバックと issue_date_po フォールバックの
      //   両方で使うため、ここで外側スコープに宣言する(以前は if ブロック内のみで、
      //   明細ありかつ issue_date_po が null の契約で ReferenceError → 500 になっていた)。
      const formData: any = docRow.rows[0]?.form_data || {};

      // 検収件数 (delivery_events.capability_id) と次の delivery_no
      const delivCount = await deps.query(
        `SELECT COUNT(*)::int AS done_count,
                COALESCE(MAX(delivery_no), 0) + 1 AS next_delivery_no
           FROM delivery_events WHERE capability_id = $1`,
        [id]
      );
      const doneCount = Number(delivCount.rows[0]?.done_count) || 0;
      const nextDeliveryNo = Number(delivCount.rows[0]?.next_delivery_no) || 1;

      let lineRows: any[] = lines.rows.map((l: any) => ({
        id: Number(l.id),
        line_no: Number(l.line_no),
        item_name: l.item_name || "",
        spec: l.spec || "",
        category: l.category || "",
        calc_method: l.calc_method || "FIXED",
        payment_terms: l.payment_terms || "",
        payment_method: l.payment_method || "",
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        amount_ex_tax: Number(l.amount_ex_tax) || 0,
        // 成果物帰属。受注者帰属かつ0円は検収書で「利用許諾料に含む」表示。
        deliverable_ownership: l.deliverable_ownership || "発注者",
        rate_pct: l.rate_pct == null ? undefined : Number(l.rate_pct),
        delivery_date: l.delivery_date,
        payment_date: l.payment_date,
        cycle: l.cycle || "",
        billing_day: l.billing_day == null ? null : Number(l.billing_day),
        term_start: l.term_start,
        term_end: l.term_end,
        ordered_amount_ex_tax: Number(l.amount_ex_tax) || 0,
        inspected_amount_so_far: Number(l.inspected_amount_so_far) || 0,
        remaining_amount_ex_tax:
          (Number(l.amount_ex_tax) || 0) -
          (Number(l.inspected_amount_so_far) || 0),
        // 検収書発行済フラグ(一括検収で「対象外/発行済」明細をスキップするのに使う)。
        inspection_issued: !!(
          l.status_flags &&
          typeof l.status_flags === "object" &&
          (l.status_flags as any).inspection_issued === true
        ),
      }));

      // Phase 23.6.6: capability_line_items が空のとき、documents.form_data
      //   からフォールバック合成する。Phase 23 移行スクリプト未実行 or 旧
      //   生成経路で contract_capabilities ヘッダだけ登録され明細が無いケース
      //   (例: ARC-PO-2026-0019) で検収書フォームが空になる事故を防ぐ。
      //   - form_data.line_items[] があればそれを使う
      //   - 無ければ cc.amount_ex_tax / form_data.amount から 1 行合成
      //   - synthetic な行は id を負の値にして DB の行と区別 (検収時の参照用)
      if (lineRows.length === 0) {
        // Phase 23.6.11: worker (/api/documents/generate) は formData.items
        //   (アンダースコアなし) で明細を保存している (server.ts:9595)。
        //   従来 Phase 23.6.6 のここは formData.line_items / delivery_line_items
        //   しか見ていなかったため、items 経由で保存された旧 PO (例: 手数料計算
        //   付き発注書) は line_count=0 のまま autofill されなかった。
        //   items を最優先に追加する。
        const formLines = Array.isArray(formData.items)
          ? formData.items
          : Array.isArray(formData.line_items)
          ? formData.line_items
          : Array.isArray(formData.delivery_line_items)
          ? formData.delivery_line_items
          : [];
        if (formLines.length > 0) {
          lineRows = formLines.map((l: any, i: number) => {
            const amt =
              Number(l.amount_ex_tax) ||
              Number(l.amount) ||
              (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) ||
              0;
            return {
              id: -(i + 1), // 負 ID で synthetic を識別
              line_no: Number(l.line_no) || i + 1,
              item_name: l.item_name || l.description || "",
              spec: l.spec || "",
              category: l.category || "",
              calc_method: l.calc_method || "FIXED",
              payment_terms: l.payment_terms || "",
              payment_method: l.payment_method || "",
              quantity: Number(l.quantity) || 1,
              unit_price: Number(l.unit_price) || amt,
              amount_ex_tax: amt,
              delivery_date: l.delivery_date || null,
              payment_date: l.payment_date || null,
              cycle: l.cycle || "",
              billing_day: l.billing_day == null ? null : Number(l.billing_day),
              term_start: l.term_start || null,
              term_end: l.term_end || null,
              ordered_amount_ex_tax: amt,
              inspected_amount_so_far: 0,
              remaining_amount_ex_tax: amt,
              __synthetic: true,
            };
          });
        } else {
          // Phase 23.6.13: form_data に items[] が無くても expenses[] や
          //   other_fees[] が入っている「経費 / 手数料だけの PO」がある
          //   ため、それらを合成して line_items 1 行にまとめる。
          //   - expenses: amount_inc_tax を税抜換算 (簡易、税率10%固定)
          //   - other_fees: amount をそのまま
          //   いずれかが見つかれば「(その他経費/手数料)」の単行 line_item
          //   として STEP 2 を表示できるようにする。
          const formExpenses = Array.isArray(formData.expenses)
            ? formData.expenses
            : [];
          const formOtherFees = Array.isArray(formData.other_fees)
            ? formData.other_fees
            : [];
          const expensesTotal = formExpenses.reduce(
            (s: number, e: any) => s + (Number(e.amount_inc_tax) || 0),
            0
          );
          const feesTotal = formOtherFees.reduce(
            (s: number, f: any) => s + (Number(f.amount) || 0),
            0
          );
          // 経費は税込なので税抜に戻す (税率 10% 固定で簡易換算)
          const feeBasedAmt =
            Math.floor(expensesTotal / 1.1) + feesTotal;

          // form_data にも line_items が無い場合、ヘッダの金額から 1 行合成。
          // amount_ex_tax が null でも、form_data の deliveredAmountStr 等から
          // 復元を試みる。Phase 23.6.13: 経費/手数料合計も候補に加える。
          const headerAmt =
            Number(cc.amount_ex_tax) ||
            Number(
              (formData.deliveredAmountStr || formData.totalAmountStr || "")
                .toString()
                .replace(/[^0-9.-]/g, "")
            ) ||
            Number(formData.amount) ||
            feeBasedAmt ||
            0;
          if (headerAmt > 0) {
            lineRows = [
              {
                id: -1,
                line_no: 1,
                item_name:
                  cc.contract_title ||
                  formData.description ||
                  formData.itemName ||
                  cc.document_number,
                spec: formData.spec || "",
                category: "",
                calc_method: "FIXED",
                payment_terms: "",
                payment_method: "",
                quantity: 1,
                unit_price: headerAmt,
                amount_ex_tax: headerAmt,
                delivery_date: cc.due_date,
                payment_date: null,
                cycle: "",
                billing_day: null,
                term_start: null,
                term_end: null,
                ordered_amount_ex_tax: headerAmt,
                inspected_amount_so_far: 0,
                remaining_amount_ex_tax: headerAmt,
                __synthetic: true,
              },
            ];
          }
        }
        if (lineRows.length > 0) {
          console.log(
            `[contracts/${id}] line_items 空 → form_data から ${lineRows.length} 行を合成 (synthetic)`
          );
        }
      }

      res.json({
        contract: {
          id: Number(cc.id),
          record_type: cc.record_type,
          contract_category: cc.contract_category,
          contract_type: cc.contract_type,
          contract_title: cc.contract_title || "",
          // 検収書の件名引用用: 発注書フォームで入力した件名(PROJECT_TITLE)を優先。
          //   無ければ contract_title にフォールバック。
          project_title: formData.PROJECT_TITLE || cc.contract_title || "",
          document_number: cc.document_number || "",
          backlog_issue_key: cc.backlog_issue_key || "",
          amount_ex_tax: cc.amount_ex_tax == null ? null : Number(cc.amount_ex_tax),
          amount_inc_tax:
            cc.amount_inc_tax == null ? null : Number(cc.amount_inc_tax),
          tax_rate: cc.tax_rate == null ? null : Number(cc.tax_rate),
          due_date: cc.due_date,
          // Phase 23.5: 発注書系の「発注日」。検収書 onPick で orderDate 補完の
          //   最優先キーとして使う。
          //   通常作成の発注書は issue_date_po(capability列)が空で、発注日が
          //   発注書ドキュメントの form_data['発注日'] にしか無いことがあるため、
          //   そこからもフォールバック補完する。
          issue_date_po:
            cc.issue_date_po ||
            formData["発注日"] ||
            formData.order_date ||
            null,
          effective_date: cc.effective_date,
          expiration_date: cc.expiration_date,
          original_work: cc.original_work || "",
          ledger_code: cc.ledger_code || "",
        },
        vendor: cc.vendor_id
          ? {
              id: Number(cc.vendor_id),
              vendor_code: cc.vendor_code || "",
              vendor_name: cc.vendor_name || "",
              entity_type: cc.vendor_entity_type || "",
              vendor_rep: cc.vendor_rep || "",
              bank_name: cc.bank_name || "",
              branch_name: cc.branch_name || "",
              account_type: cc.account_type || "",
              account_number: cc.account_number || "",
              account_holder_kana: cc.account_holder_kana || "",
              invoice_registration_number: cc.invoice_registration_number || "",
              withholding_enabled: !!cc.withholding_enabled,
              is_invoice_issuer: !!cc.is_invoice_issuer,
            }
          : null,
        line_items: lineRows,
        financial_conditions: conds.rows.map((c: any) => {
          // テリトリー / 言語 を別項目で返す。古い行(2項目なし)は
          //   合成ラベル region_language_label を最初の '・' で分割してフォールバック。
          let territory = (c.region_territory || "").trim();
          let language = (c.region_language || "").trim();
          if (!territory && !language && c.region_language_label) {
            const s = String(c.region_language_label).trim();
            const idx = s.indexOf("・");
            if (idx < 0) territory = s;
            else {
              territory = s.slice(0, idx).trim();
              language = s.slice(idx + 1).trim();
            }
          }
          return {
          id: Number(c.id),
          condition_no: Number(c.condition_no),
          region_territory: territory,
          region_language: language,
          region_language_label: c.region_language_label || "",
          calc_method: c.calc_method || "",
          rate_pct: c.rate_pct == null ? null : Number(c.rate_pct),
          base_price_label: c.base_price_label || "",
          calc_period: c.calc_period || "",
          calc_period_kind: c.calc_period_kind || "",
          calc_period_close_month:
            c.calc_period_close_month == null ? null : Number(c.calc_period_close_month),
          currency: c.currency || "JPY",
          formula_text: c.formula_text || "",
          applies_scope: c.applies_scope || "",
          payment_terms: c.payment_terms || "",
          mg_amount: Number(c.mg_amount) || 0,
          ag_amount: Number(c.ag_amount) || 0,
          // 0045: 金銭条件の柔軟化フィールド (名称/計算式タイプ/保証種別)
          condition_name: c.condition_name || "",
          calc_type: c.calc_type || null,
          fixed_kind: c.fixed_kind || null,
          subscription_cycle: c.subscription_cycle || null,
          unit_amount: c.unit_amount == null ? null : Number(c.unit_amount),
          guarantee_type: c.guarantee_type || null,
          };
        }),
        expenses: expenses.rows.map((e: any) => ({
          id: Number(e.id),
          line_no: Number(e.line_no),
          expense_name: e.expense_name,
          spec: e.spec || "",
          spent_date: e.spent_date,
          amount_inc_tax: Number(e.amount_inc_tax) || 0,
          remarks: e.remarks || "",
        })),
        other_fees: fees.rows.map((f: any) => ({
          id: Number(f.id),
          line_no: Number(f.line_no),
          fee_name: f.fee_name,
          amount: Number(f.amount) || 0,
          remarks: f.remarks || "",
        })),
        document_number: cc.document_number || "",
        drive_link: docRow.rows[0]?.drive_link || cc.drive_url || "",
        delivery_progress: (() => {
          // Phase 23.6.6: cc.amount_ex_tax が null のとき (旧データ等) は
          //   合成された lineRows の合計から ordered を計算する。
          //   これにより検収書フォームの進捗バーが「0/0」表示にならない。
          const headerAmt = Number(cc.amount_ex_tax) || 0;
          const lineSum = lineRows.reduce(
            (s: number, l: any) => s + (Number(l.amount_ex_tax) || 0),
            0
          );
          const ordered = headerAmt > 0 ? headerAmt : lineSum;
          const inspected = lineRows.reduce(
            (s: number, l: any) => s + l.inspected_amount_so_far,
            0
          );
          const remaining = ordered - inspected;
          const pct = ordered > 0 ? Math.round((inspected / ordered) * 100) : 0;
          return {
            ordered_amount_ex_tax: ordered,
            inspected_amount_ex_tax: inspected,
            remaining_amount_ex_tax: remaining,
            done_amount_ex_tax: inspected,
            done_count: doneCount,
            next_delivery_no: nextDeliveryNo,
            inspected_pct: pct,
            is_partial: inspected > 0 && remaining > 0,
          };
        })(),
      });
    } catch (e: any) {
      console.error("/api/contracts/:id failed:", e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // 利用許諾料計算書の「条件一覧」ピッカー用。
  //   capability_financial_conditions を契約 + 取引先と JOIN して一覧返す。
  //   発注書由来(受注者帰属)の印税条件も、ライセンス契約の条件も同じ土俵で選べる。
  app.get(
    "/api/financial-conditions/search",
    deps.requirePortalSecret,
    async (req, res) => {
      try {
        const q = String(req.query.q || "").trim();
        const limit = Math.min(Number(req.query.limit) || 100, 300);
        // is_active で絞らない: 検収完了や archive 済みでも、利用許諾料計算の条件としては
        //   選べるべき(印税は継続課金で発注書の状態とは独立)。
        const where: string[] = ["TRUE"];
        const params: any[] = [];
        if (q) {
          params.push(`%${q}%`);
          const i = params.length;
          where.push(
            `(cfc.condition_name ILIKE $${i}
               OR cc.contract_title ILIKE $${i}
               OR cc.document_number ILIKE $${i}
               OR cfc.region_language_label ILIKE $${i}
               OR v.vendor_name ILIKE $${i}
               OR v.vendor_code ILIKE $${i})`
          );
        }
        params.push(limit);
        const limitParam = `$${params.length}`;
        const sql = `
          SELECT cfc.id, cfc.condition_no, cfc.condition_name, cfc.region_language_label,
                 cfc.calc_type, cfc.calc_method, cfc.rate_pct, cfc.base_price_label,
                 cfc.mg_amount, cfc.ag_amount, cfc.guarantee_type, cfc.currency,
                 cc.id AS capability_id, cc.document_number, cc.contract_title,
                 cc.contract_category, cc.record_type,
                 v.vendor_name, v.vendor_code
            FROM capability_financial_conditions cfc
            JOIN documents cc ON cc.id = cfc.capability_id
            LEFT JOIN vendors v ON v.id = cc.vendor_id
           WHERE ${where.join(" AND ")}
           ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC, cfc.condition_no ASC
           LIMIT ${limitParam}
        `;
        const r = await deps.query(sql, params);
        res.json(
          r.rows.map((c: any) => ({
            id: Number(c.id),
            condition_no: Number(c.condition_no),
            condition_name: c.condition_name || "",
            region_language_label: c.region_language_label || "",
            calc_type: c.calc_type || null,
            calc_method: c.calc_method || "",
            rate_pct: c.rate_pct == null ? null : Number(c.rate_pct),
            base_price_label: c.base_price_label || "",
            mg_amount: Number(c.mg_amount) || 0,
            ag_amount: Number(c.ag_amount) || 0,
            guarantee_type: c.guarantee_type || null,
            currency: c.currency || "JPY",
            capability_id: Number(c.capability_id),
            document_number: c.document_number || "",
            contract_title: c.contract_title || "",
            contract_category: c.contract_category || "",
            record_type: c.record_type || "",
            vendor_name: c.vendor_name || "",
            vendor_code: c.vendor_code || "",
          }))
        );
      } catch (e: any) {
        console.error("/api/financial-conditions/search failed:", e);
        res.status(500).json({ error: String(e?.message || e) });
      }
    }
  );
}
