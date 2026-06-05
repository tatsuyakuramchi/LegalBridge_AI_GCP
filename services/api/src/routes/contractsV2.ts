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
          -- 検収書未発行の明細数: status_flags.inspection_issued が true でなく、かつ
          --   まだ全額検収されていない(残額あり)業務明細。検収待ち制御の主キー。
          (SELECT COUNT(*) FROM capability_line_items cli
             WHERE cli.capability_id = cc.id
               AND COALESCE(cli.amount_ex_tax, 0) > 0
               AND (cli.status_flags->>'inspection_issued') IS DISTINCT FROM 'true'
               AND COALESCE(cli.inspected_amount_ex_tax, 0) < cli.amount_ex_tax - 0.5
          ) AS unissued_line_count,
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

      // Phase 23.6.6: capability_line_items が空のとき、documents.form_data
      //   からフォールバック合成する。Phase 23 移行スクリプト未実行 or 旧
      //   生成経路で contract_capabilities ヘッダだけ登録され明細が無いケース
      //   (例: ARC-PO-2026-0019) で検収書フォームが空になる事故を防ぐ。
      //   - form_data.line_items[] があればそれを使う
      //   - 無ければ cc.amount_ex_tax / form_data.amount から 1 行合成
      //   - synthetic な行は id を負の値にして DB の行と区別 (検収時の参照用)
      if (lineRows.length === 0) {
        const formData = docRow.rows[0]?.form_data || {};
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
          document_number: cc.document_number || "",
          backlog_issue_key: cc.backlog_issue_key || "",
          amount_ex_tax: cc.amount_ex_tax == null ? null : Number(cc.amount_ex_tax),
          amount_inc_tax:
            cc.amount_inc_tax == null ? null : Number(cc.amount_inc_tax),
          tax_rate: cc.tax_rate == null ? null : Number(cc.tax_rate),
          due_date: cc.due_date,
          // Phase 23.5: 発注書系の「発注日」。検収書 onPick で orderDate 補完の
          //   最優先キーとして使う。
          issue_date_po: cc.issue_date_po,
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
}
