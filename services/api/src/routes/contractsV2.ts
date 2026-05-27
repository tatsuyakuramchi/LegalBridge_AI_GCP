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

      const sql = `
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
          cc.effective_date,
          cc.expiration_date,
          cc.drive_url,
          cc.original_work,
          cc.ledger_code,
          cc.is_active,
          cc.created_at,
          v.vendor_code,
          v.vendor_name,
          v.entity_type AS vendor_entity_type,
          (SELECT COUNT(*) FROM capability_line_items cli WHERE cli.capability_id = cc.id) AS line_count,
          (SELECT COUNT(*) FROM capability_financial_conditions cfc WHERE cfc.capability_id = cc.id) AS condition_count,
          (SELECT COALESCE(SUM(cli.inspected_amount_ex_tax), 0)
             FROM capability_line_items cli WHERE cli.capability_id = cc.id) AS inspected_amount,
          (cc.backlog_issue_key LIKE 'IMPORT-%') AS is_imported
        FROM contract_capabilities cc
        LEFT JOIN vendors v ON v.id = cc.vendor_id
        ${whereSql}
        ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC
        LIMIT ${limitParam}
      `;

      const rows = await deps.query(sql, params);
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
          effective_date: r.effective_date,
          expiration_date: r.expiration_date,
          drive_link: r.drive_url || "",
          original_work: r.original_work || "",
          ledger_code: r.ledger_code || "",
          is_active: r.is_active !== false,
          created_at: r.created_at,
          line_count: Number(r.line_count) || 0,
          condition_count: Number(r.condition_count) || 0,
          inspected_amount: Number(r.inspected_amount) || 0,
          remaining_amount:
            (Number(r.amount_ex_tax) || 0) - (Number(r.inspected_amount) || 0),
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
        `SELECT cc.*, v.vendor_code, v.vendor_name, v.entity_type AS vendor_entity_type,
                v.bank_name, v.branch_name, v.account_type, v.account_number,
                v.account_holder_kana, v.invoice_registration_number,
                v.withholding_enabled, v.is_invoice_issuer, v.vendor_rep
           FROM contract_capabilities cc
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
      const conds = await deps.query(
        `SELECT * FROM capability_financial_conditions
          WHERE capability_id = $1 ORDER BY condition_no`,
        [id]
      );
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
      const docRow = await deps.query(
        `SELECT document_number, drive_link, created_at
           FROM documents
          WHERE document_number = $1
          ORDER BY created_at DESC LIMIT 1`,
        [cc.document_number]
      );

      // 検収件数 (delivery_events.capability_id) と次の delivery_no
      const delivCount = await deps.query(
        `SELECT COUNT(*)::int AS done_count,
                COALESCE(MAX(delivery_no), 0) + 1 AS next_delivery_no
           FROM delivery_events WHERE capability_id = $1`,
        [id]
      );
      const doneCount = Number(delivCount.rows[0]?.done_count) || 0;
      const nextDeliveryNo = Number(delivCount.rows[0]?.next_delivery_no) || 1;

      const lineRows = lines.rows.map((l: any) => ({
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
      }));

      res.json({
        contract: {
          id: Number(cc.id),
          record_type: cc.record_type,
          contract_category: cc.contract_category,
          contract_type: cc.contract_type,
          contract_title: cc.contract_title || "",
          document_number: cc.document_number || "",
          backlog_issue_key: cc.backlog_issue_key || "",
          amount_ex_tax: cc.amount_ex_tax == null ? null : Number(cc.amount_ex_tax),
          amount_inc_tax:
            cc.amount_inc_tax == null ? null : Number(cc.amount_inc_tax),
          tax_rate: cc.tax_rate == null ? null : Number(cc.tax_rate),
          due_date: cc.due_date,
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
        financial_conditions: conds.rows.map((c: any) => ({
          id: Number(c.id),
          condition_no: Number(c.condition_no),
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
          payment_terms: c.payment_terms || "",
          mg_amount: Number(c.mg_amount) || 0,
          ag_amount: Number(c.ag_amount) || 0,
        })),
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
          const ordered = Number(cc.amount_ex_tax) || 0;
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
}
