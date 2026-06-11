// AUTO-GENERATED from services/api/server.ts by scripts/extract-form-routes.mjs.
// Do not edit. C2 batch 3b: backlog form-context / history の byte-exact 移植。
// 依存: query, backlogService(getIssue / extractCustomFields)。
import type { Express } from "express";

export function registerFormReadRoutes(
  app: Express,
  deps: { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>; backlogService: any }
): void {
  const { query, backlogService } = deps;

  app.get("/api/backlog/issues/:key/form-context", async (req, res) => {
    const { key } = req.params;
    const { template } = req.query;
    try {
      let context: Record<string, string | number | boolean | any> = {};

      try {
        const fullIssue = await backlogService.getIssue(key);
        const flattenedFields = backlogService.extractCustomFields(fullIssue);
        context = { ...context, ...flattenedFields };
      } catch (e) {
        console.warn("Could not fetch full issue details for context mapping", e);
      }

      // Phase 22.11.2: 同 issue_key + 同 template_type の "最新文書" メタを context に同梱。
      //   admin-ui が課題を選んだとき「前回の発注書を読み込む」UI を出すために使う。
      //   form_data そのものは大きいので別 endpoint (/api/documents/by-number/:n) で
      //   取得させる方針 — ここでは識別子 / 日付 / リビジョン情報のみ返す。
      try {
        if (template && typeof template === "string") {
          const prev = await query(
            `SELECT id, document_number, base_document_number, revision,
                    drive_link, created_at, vendor_name_snapshot
               FROM documents
              WHERE issue_key = $1 AND template_type = $2
              ORDER BY created_at DESC
              LIMIT 1`,
            [key, template]
          );
          if (prev.rows[0]) {
            const r = prev.rows[0];
            context["_previousDocument"] = {
              id: Number(r.id),
              document_number: r.document_number,
              base_document_number: r.base_document_number || r.document_number,
              revision: Number(r.revision) || 0,
              drive_link: r.drive_link || "",
              created_at: r.created_at,
              vendor_name_snapshot: r.vendor_name_snapshot || "",
            };
          }
        }
      } catch (lookupErr) {
        console.warn(
          "[form-context] previous-document lookup failed (non-fatal):",
          lookupErr
        );
      }

      // Phase 7b: 発注書テンプレなら既存 capability_line_items を items[] として
      // プリセットする (フォーム側の LineItemTable がそのまま使える shape)。
      // Phase 22.21.82: planning_purchase_order テンプレ削除に伴い分岐から除去
      // Phase 23: order_items → contract_capabilities (record_type='purchase_order'),
      //   order_line_items → capability_line_items に置換。
      if (template === "purchase_order") {
        const orderHeader = await query(
          `SELECT id, amount_ex_tax, tax_rate
             FROM contract_capabilities
            WHERE backlog_issue_key = $1
              AND record_type = 'purchase_order'`,
          [key]
        );
        if (orderHeader.rows.length > 0) {
          const orderItemId = orderHeader.rows[0].id;
          context["taxRate"] = orderHeader.rows[0].tax_rate || 10;
          context["grandTotalExTax"] = Number(orderHeader.rows[0].amount_ex_tax) || 0;
          // rate_pct 列が未マイグレーションの環境でも 500 にしないよう 2 段 fallback。
          let lines: any;
          try {
            lines = await query(
              `SELECT line_no, item_name, spec, unit_price, quantity,
                      amount_ex_tax, rate_pct, calc_method, payment_terms,
                      payment_method, payment_date, delivery_date,
                      cycle, term_start, term_end, billing_day
                 FROM capability_line_items
                WHERE capability_id = $1
                ORDER BY line_no ASC`,
              [orderItemId]
            );
          } catch (colErr: any) {
            if (colErr && colErr.code === "42703") {
              lines = await query(
                `SELECT line_no, item_name, spec, unit_price, quantity,
                        amount_ex_tax, calc_method, payment_terms,
                        payment_method, payment_date, delivery_date,
                        cycle, term_start, term_end, billing_day
                   FROM capability_line_items
                  WHERE capability_id = $1
                  ORDER BY line_no ASC`,
                [orderItemId]
              );
            } else {
              throw colErr;
            }
          }
          context["items"] = lines.rows.map((r: any) => ({
            line_no: Number(r.line_no),
            item_name: r.item_name || "",
            spec: r.spec || "",
            unit_price: Number(r.unit_price) || 0,
            quantity: Number(r.quantity) || 0,
            amount_ex_tax: Number(r.amount_ex_tax) || 0,
            // ROYALTY 用料率(%)。小計 = 単価 × 数量 × 料率%。
            rate_pct: r.rate_pct == null ? undefined : Number(r.rate_pct),
            // Phase 13: calc_method + payment_terms 統一
            calc_method: r.calc_method || "FIXED",
            payment_terms: r.payment_terms || r.payment_method || "",
            // legacy 互換
            payment_method: r.payment_method || r.payment_terms || "",
            payment_date: r.payment_date || "",
            // Phase 17h: 業務明細ごとの納期
            delivery_date: r.delivery_date || "",
            // Phase 22.8: SUBSCRIPTION フィールド (FIXED/ROYALTY 行では undefined)
            cycle: r.cycle || undefined,
            term_start: r.term_start || undefined,
            term_end: r.term_end || undefined,
            billing_day: r.billing_day == null ? undefined : Number(r.billing_day),
          }));
        }
      }

      // Phase 22.21.82: inspection_certificate_detailed / _v2 削除に伴い分岐から除去
      if (template === "inspection_certificate") {
        // Phase 7c: 親 PO の明細 + 検収累計を取得 (Backlog 親子 issue 経由)。
        //   1. この issue の parentIssueId を Backlog から拾う
        //   2. parentIssueKey → contract_capabilities (record_type='purchase_order') を見つける
        //   3. capability_line_items を inspection availability 付きで返す
        // Phase 23: order_items → contract_capabilities, order_line_items → capability_line_items,
        //   delivery_line_items.order_line_item_id → capability_line_item_id に置換。
        try {
          const fullIssue = await backlogService.getIssue(key);
          let parentKey: string | null = null;
          if (fullIssue?.parentIssueId) {
            try {
              const parent = await backlogService.getIssue(
                String(fullIssue.parentIssueId)
              );
              parentKey = parent?.issueKey || null;
            } catch (_) {
              // parent fetch failed; fall through
            }
          }
          if (parentKey) {
            // Phase 23.6.12: contract_capabilities には description 列が無い
            //   (旧 order_items の名残)。下流の poRow.description 参照箇所も
            //   無いので SELECT から削除。これで PG が 500 で死ぬのを防ぐ。
            const poHeader = await query(
              `SELECT id, amount_ex_tax, tax_rate, backlog_issue_key,
                      contract_title, due_date, created_at
                 FROM contract_capabilities
                WHERE backlog_issue_key = $1
                  AND record_type = 'purchase_order'`,
              [parentKey]
            );
            if (poHeader.rows.length > 0) {
              const poId = poHeader.rows[0].id;
              // 検収対象明細: amount>0 の業務委託に加え、受注者帰属(利用許諾料に含む=0円)
              //   の明細も含める。検収書に「利用許諾料に含む」として出すため。
              //   発注者帰属の0円明細は除外したままにする。
              //   deliverable_ownership 列が未追加の環境(0060前)は 42703 で旧挙動に fallback。
              let lines: any;
              try {
                lines = await query(
                  `SELECT id, line_no, item_name, spec, unit_price, quantity,
                          amount_ex_tax, calc_method, payment_terms,
                          payment_method, payment_date, delivery_date,
                          deliverable_ownership
                     FROM capability_line_items
                    WHERE capability_id = $1
                      AND (COALESCE(amount_ex_tax, 0) > 0
                           OR deliverable_ownership = '受注者')
                    ORDER BY line_no ASC`,
                  [poId]
                );
              } catch (colErr: any) {
                if (colErr && colErr.code === "42703") {
                  lines = await query(
                    `SELECT id, line_no, item_name, spec, unit_price, quantity,
                            amount_ex_tax, calc_method, payment_terms,
                            payment_method, payment_date, delivery_date
                       FROM capability_line_items
                      WHERE capability_id = $1
                        AND COALESCE(amount_ex_tax, 0) > 0
                      ORDER BY line_no ASC`,
                    [poId]
                  );
                } else {
                  throw colErr;
                }
              }
              const lineIds = lines.rows.map((l: any) => l.id);
              const inspMap: Record<number, { amt: number; qty: number }> = {};
              if (lineIds.length > 0) {
                const insp = await query(
                  `SELECT capability_line_item_id,
                          COALESCE(SUM(inspected_amount_ex_tax), 0) AS amt,
                          COALESCE(SUM(inspected_quantity),       0) AS qty
                     FROM delivery_line_items
                    WHERE capability_line_item_id = ANY($1::int[])
                    GROUP BY capability_line_item_id`,
                  [lineIds]
                );
                insp.rows.forEach((r: any) => {
                  inspMap[Number(r.capability_line_item_id)] = {
                    amt: Number(r.amt) || 0,
                    qty: Number(r.qty) || 0,
                  };
                });
              }

              // Phase 9c: 親 PO の document_number / 業務名 / 仕様 / 発注日
              //   - 発注番号 ← documents.template_type=purchase_order の最新行
              //   - 業務名 ← capability_line_items 1 行目の item_name
              //   - 仕様   ← capability_line_items 1 行目の spec
              //   - 発注日 ← contract_capabilities.created_at (due_date 優先)
              const docRow = await query(
                `SELECT document_number FROM documents
                  WHERE issue_key = $1
                    AND template_type LIKE '%purchase_order%'
                  ORDER BY created_at DESC LIMIT 1`,
                [parentKey]
              );
              const parentPoNumber = docRow.rows[0]?.document_number || "";
              const poRow = poHeader.rows[0];
              const firstLine = lines.rows[0];

              context["parent_po_issue_key"] = parentKey;
              context["parent_po_id"] = poId;
              context["parent_po_number"] = parentPoNumber;
              // 件名(親POの contract_title) を検収確認文の先頭に表示する。
              context["projectTitle"] = poRow.contract_title || "";
              if (firstLine?.item_name) {
                context["description"] = firstLine.item_name;
              }
              if (firstLine?.spec) {
                context["spec"] = firstLine.spec;
              }
              context["orderDate"] = poRow.due_date || poRow.created_at || null;
              context["itemCount"] = String(lines.rows.length);
              context["itemNo"] = "1"; // 単発検収では明細 1 を default
              context["documentDate"] = new Date().toISOString().slice(0, 10);

              // Phase 9f: 親 PO 配下の既存検収件数 +1 を次回 deliveryNo として
              // セット。残量 > 0 なら isPartial=true。
              const deliveryAgg = await query(
                `SELECT COUNT(*) AS done_count,
                        COALESCE(SUM(delivered_amount), 0) AS done_amt
                   FROM delivery_events
                  WHERE capability_id = $1
                    AND backlog_issue_key <> $2`,
                [poId, key]
              );
              const doneCount = Number(deliveryAgg.rows[0]?.done_count) || 0;
              const doneAmt = Number(deliveryAgg.rows[0]?.done_amt) || 0;
              const orderTotalEx = Number(poRow.amount_ex_tax) || 0;
              context["deliveryNo"] = String(doneCount + 1);
              context["totalDeliveries"] = String(
                Math.max(doneCount + 1, Number(context["totalDeliveries"]) || 0)
              );
              context["isPartial"] = doneCount > 0 ? "分割" : "完了"; // 2 回目以降は分割扱い
              context["inspectedAmountStr"] = new Intl.NumberFormat(
                "ja-JP"
              ).format(doneAmt);
              context["totalOrderAmountStr"] = new Intl.NumberFormat(
                "ja-JP"
              ).format(orderTotalEx);
              context["pendingAmountStr"] = new Intl.NumberFormat(
                "ja-JP"
              ).format(Math.max(0, orderTotalEx - doneAmt));
              context["inspectedPct"] =
                orderTotalEx > 0
                  ? String(Math.min(100, Math.floor((doneAmt / orderTotalEx) * 100)))
                  : "0";

              context["order_lines_for_inspection"] = lines.rows.map((l: any) => {
                const ordAmt = Number(l.amount_ex_tax) || 0;
                const ordQty = Number(l.quantity) || 0;
                const i = inspMap[Number(l.id)] || { amt: 0, qty: 0 };
                return {
                  id: Number(l.id),
                  line_no: Number(l.line_no),
                  item_name: l.item_name || "",
                  spec: l.spec || "",
                  unit_price: Number(l.unit_price) || 0,
                  quantity: ordQty,
                  amount_ex_tax: ordAmt,
                  // 成果物帰属。受注者帰属かつ0円は検収書で「利用許諾料に含む」表示。
                  deliverable_ownership: l.deliverable_ownership || "発注者",
                  // Phase 23.0.4: 検収書 Excel / PDF 生成時に納品日列が空に
                  //   なる問題を解消するため delivery_date / payment_date を追加。
                  //   excelService.findParentLine が l.delivery_date を読む。
                  delivery_date: l.delivery_date || null,
                  payment_date: l.payment_date || null,
                  inspection: {
                    ordered_amount: ordAmt,
                    ordered_quantity: ordQty,
                    inspected_amount: i.amt,
                    inspected_quantity: i.qty,
                    remaining_amount: ordAmt - i.amt,
                    remaining_quantity: ordQty - i.qty,
                    overflow_amount: i.amt > ordAmt,
                    overflow_quantity: i.qty > ordQty,
                  },
                };
              });
            }
          }
        } catch (parentErr) {
          console.warn("parent PO lookup failed:", parentErr);
        }

        // Phase 22.21.78: vendor_rep カラムは Phase 22.13 で正式に追加済み。
        //   空のときだけ contact_name にフォールバックする COALESCE で取得し、
        //   PO 帳票 / 検収書の代表者欄に正しい値が出るようにする。
        // Phase 23: order_items → contract_capabilities (record_type='purchase_order'),
        //   delivery_events.order_item_id → capability_id に置換。
        // Phase 23.6.12: contract_capabilities には amount / description / spec /
        //   vendor_code は無い (旧 order_items の名残)。
        //   - oi.amount        → oi.amount_ex_tax
        //   - oi.description   → oi.contract_title
        //   - oi.spec          → capability_line_items 1 行目から取る
        //   - JOIN vendors は vendor_id 経由に変更
        const deliveryQuery = `
          SELECT de.*,
                 oi.amount_ex_tax  as order_amount,
                 oi.contract_title as item_desc,
                 (SELECT cli.spec FROM capability_line_items cli
                    WHERE cli.capability_id = oi.id
                    ORDER BY cli.line_no LIMIT 1) as item_spec,
                 v.vendor_name, v.vendor_code, v.trade_name, v.bank_name, v.branch_name, v.account_type,
                 v.account_number, v.account_holder_kana as account_holder,
                 v.entity_type as vendor_entity_type,
                 COALESCE(NULLIF(v.vendor_rep, ''), v.contact_name) as vendor_rep_name,
                 v.invoice_registration_number as vendor_tni,
                 lr.summary as order_title, lr.created_at as order_date,
                 ea.asset_number as linked_po_number, ea.file_link as linked_po_link,
                 (SELECT d.document_number FROM documents d
                    WHERE d.issue_key = oi.backlog_issue_key
                      AND d.template_type LIKE '%purchase_order%'
                    ORDER BY d.created_at DESC LIMIT 1) AS parent_po_number
          FROM delivery_events de
          LEFT JOIN contract_capabilities oi
                 ON de.capability_id = oi.id
                AND oi.record_type = 'purchase_order'
          LEFT JOIN vendors v ON v.id = oi.vendor_id
          LEFT JOIN legal_requests lr ON de.backlog_issue_key = lr.backlog_issue_key
          LEFT JOIN external_assets ea ON de.linked_asset_id = ea.id
          WHERE de.backlog_issue_key = $1
          ORDER BY de.delivery_no DESC LIMIT 1
        `;
        const result = await query(deliveryQuery, [key]);
        if (result.rows.length > 0) {
          const row = result.rows[0];
          context["issueKey"] = key;
          context["itemNo"] = String(row.capability_id || row.order_item_id || "1");
          context["deliveryNo"] = String(row.delivery_no || "1");
          context["totalDeliveries"] = "1";
          context["itemCount"] = "1";
          context["orderDate"] = row.order_date || "";
          context["documentDate"] = new Date().toISOString().slice(0, 10);
          context["isPartial"] = row.delivery_no > 1 ? "分割" : "完了";
          // Phase 9c: 発注番号 (親 PO の document_number) を上書きしないよう、
          // 上の parent-by-Backlog 経路で既にセットされていれば温存。
          if (!context["parent_po_number"] && row.parent_po_number) {
            context["parent_po_number"] = row.parent_po_number;
          }

          context["counterparty"] = row.vendor_name || "";
          // Phase 9d: 法人/個人を select 「法人」/「個人」 文字列で保存
          const isCorp =
            (row.vendor_entity_type || "").toLowerCase() === "corporate" ||
            row.vendor_entity_type === "法人";
          context["COUNTERPARTY_IS_CORPORATION"] = isCorp ? "法人" : "個人";
          context["counterpartyRep"] = row.vendor_rep_name || "";
          // legacy フィールドも互換のため (旧テンプレ参照対策)
          context["counterpartyRepresentativeSama"] = row.vendor_rep_name
            ? `${row.vendor_rep_name} 様`
            : "";
          context["counterpartyTni"] = row.vendor_tni || row.trade_name || "";

          context["inspectorDept"] = "法務部";
          context["deliveredAt"] = row.delivered_at
            ? new Date(row.delivered_at).toLocaleDateString("ja-JP")
            : "";
          context["inspectionCompletedAt"] = new Date().toLocaleDateString("ja-JP");
          context["paymentDueDate"] = "";

          context["description"] = row.item_desc || "";
          context["spec"] = row.item_spec || "";
          context["isReducedTax"] = false;

          const amount = row.delivered_amount || 0;
          context["deliveredAmountStr"] = new Intl.NumberFormat("ja-JP").format(amount);
          context["taxRate"] = "10";
          context["taxAmountStr"] = new Intl.NumberFormat("ja-JP").format(
            Math.floor(amount * 0.1)
          );
          context["totalAmountStr"] = new Intl.NumberFormat("ja-JP").format(
            Math.floor(amount * 1.1)
          );

          context["inspectedPct"] = "100";
          context["inspectedAmountStr"] = context["totalAmountStr"];
          context["totalOrderAmountStr"] = new Intl.NumberFormat("ja-JP").format(
            row.order_amount || 0
          );
          context["pendingAmountStr"] = "0";

          context["bankName"] = row.bank_name || "";
          context["branchName"] = row.branch_name || "";
          context["accountType"] = row.account_type || "";
          context["accountNo"] = row.account_number || "";
          context["accountHolder"] = row.account_holder || "";
          context["linked_po_number"] = row.linked_po_number || "";
          context["linked_po_link"] = row.linked_po_link || "";
          context["paymentConditionSummary"] = "検収月の翌月末日払い";
        }
      } else if (
        // Phase 22.21.82: license_report テンプレ削除に伴い列挙から除去
        template === "royalty_statement" ||
        template === "individual_license_terms" ||
        template === "license_master" ||
        template === "intl_purchase_order"
      ) {
        // Phase 23: license_contracts → contract_capabilities (contract_category='license') に置換。
        // royalty_payments / manufacturing_events 側の license_contract_id は worker 担当の
        // マイグレーションで capability_id に置換予定だが、過渡期は alias で受ける想定で
        // ここでは contract_capabilities 側のみ切替える。
        const royaltyQuery = `
          SELECT lc.*, rp.total_amount as last_payment_amount, rp.period as last_period, me.product_name, me.msrp,
                 v.vendor_name, v.address as vendor_address, v.email as vendor_email, v.contact_name as vendor_contact,
                 ea.asset_number as linked_terms_number, ea.file_link as linked_terms_link
          FROM contract_capabilities lc
          LEFT JOIN royalty_payments rp ON lc.id = rp.license_contract_id
          LEFT JOIN manufacturing_events me ON lc.id = me.license_contract_id
          LEFT JOIN vendors v ON (lc.licensor = v.vendor_name)
          LEFT JOIN external_assets ea ON lc.linked_asset_id = ea.id
          WHERE lc.contract_category = 'license'
            AND (lc.backlog_issue_key = $1 OR rp.backlog_issue_key = $1)
          ORDER BY rp.created_at DESC, me.created_at DESC LIMIT 1
        `;
        const result = await query(royaltyQuery, [key]);
        if (result.rows.length > 0) {
          const row = result.rows[0];

          context["Licensor_名称"] = row.licensor || "";
          context["Licensor_氏名会社名"] = row.licensor || "";
          context["Licensee_名称"] = "株式会社アークライト";

          context["CONTRACTOR_NAME"] = row.vendor_name || row.licensor || "";
          context["CONTRACTOR_ADDRESS"] = row.vendor_address || "";
          context["CONTRACTOR_EMAIL"] = row.vendor_email || "";
          context["PROJECT_TITLE"] = row.product_name || "";
          context["OF_NO"] = row.contract_number || key;
          context["OF_DATE"] = new Date().toLocaleDateString("ja-JP");
          context["CURRENCY"] = "USD";

          context["原著作物名"] = row.original_work || "";
          context["対象製品予定名"] = row.product_name || "";

          context["MSRP"] = String(row.msrp || "");
          context["基準価格"] = String(row.msrp || "");

          context["料率"] = String(
            row.royalty_rate ? (row.royalty_rate * 100).toFixed(2) : ""
          );
          context["契約書番号"] = row.contract_number || "";
          context["台帳ID"] = row.ledger_id || "";

          context["MG_AMOUNT"] = String(row.mg_amount || "");
          context["MG/AG"] = String(row.mg_amount || "");

          context["許諾期間注記"] = row.last_period || "";

          context["royaltyRatePct"] = row.royalty_rate
            ? `${(row.royalty_rate * 100).toFixed(1)}%`
            : "";
          context["msrpStr"] = row.msrp
            ? new Intl.NumberFormat("ja-JP").format(row.msrp)
            : "";
          context["linked_terms_number"] = row.linked_terms_number || "";
          context["linked_terms_link"] = row.linked_terms_link || "";

          const formula = `売上高 × ${
            row.royalty_rate ? (row.royalty_rate * 100).toFixed(1) : "0"
          }%`;
          context["金銭条件1_計算式"] = formula;
          context["金銭条件1_計算方式"] = row.royalty_rate > 0 ? "ROYALTY" : "FIXED";
          context["金銭条件1_料率"] = context["料率"];

          context["manufacturingIssueKey"] = key;
          context["licenseIssueKey"] = row.backlog_issue_key || "";
          context["licensor"] = row.licensor || "";
          context["licensee"] = "株式会社アークライト";
          context["originalWork"] = row.original_work || "";
          context["productName"] = row.product_name || "";
          context["edition"] = "通常版";
          context["completionDate"] = row.created_at
            ? new Date(row.created_at).toLocaleDateString("ja-JP")
            : "";

          context["quantity"] = String(row.manufacturing_qty || 0);
          context["sampleQuantity"] = "0";
          context["billableQuantity"] = String(row.manufacturing_qty || 0);

          const msrp = row.msrp || 0;
          const rate = row.royalty_rate || 0;
          const gross = Math.floor(msrp * (row.manufacturing_qty || 0) * rate);

          context["calcType"] = "manufacturing";
          context["grossRoyaltyStr"] = new Intl.NumberFormat("ja-JP").format(gross);

          const mg = row.mg_amount || 0;
          context["mgAmount"] = String(mg);
          context["mgRemaining"] = String(mg - gross > 0 ? mg - gross : 0);

          context["actualRoyalty"] = gross - mg > 0 ? gross - mg : 0;
          context["actualRoyaltyStr"] = new Intl.NumberFormat("ja-JP").format(
            context["actualRoyalty"] as number
          );

          context["taxRate"] = "10";
          context["taxAmount"] = new Intl.NumberFormat("ja-JP").format(
            Math.floor((context["actualRoyalty"] as number) * 0.1)
          );
          context["totalPaymentStr"] = new Intl.NumberFormat("ja-JP").format(
            Math.floor((context["actualRoyalty"] as number) * 1.1)
          );

          context["currency"] = "JPY";
          context["reportingDeadline"] = "";
          context["paymentDueDate"] = "";
          context["paymentConditionSummary"] = "四半期報告後の翌月末日払い";
        }
      }

      // Phase 7d/7e: 個別利用許諾条件書 & 利用許諾料計算書の両方で
      // capability_financial_conditions を構造化 rows として同梱する。
      // - individual_license_terms: FinancialConditionTable の編集ソース
      // - royalty_statement: 計算対象の condition を選ぶドロップダウン用
      // 既存の {{金銭条件1_*}} flat field 群は上の royaltyQuery 分岐で
      // 既に埋まっているので、こちらは追加情報。
      // Phase 23: license_contracts → contract_capabilities (contract_category='license'),
      //   license_financial_conditions → capability_financial_conditions に置換。
      if (
        template === "individual_license_terms" ||
        template === "royalty_statement"
      ) {
        try {
          // Phase 22.19: ledger_ref_id / material_ref_id / work_id も含めて取得
          //   schema 未追加環境 (worker 未デプロイ) では undefined_column で
          //   落ちるので catch + legacy SELECT に fallback。
          let lc: any;
          try {
            lc = await query(
              `SELECT id, ledger_ref_id, material_ref_id, work_id
                 FROM contract_capabilities
                WHERE backlog_issue_key = $1
                  AND contract_category = 'license'`,
              [key]
            );
          } catch (colErr: any) {
            if (colErr && colErr.code === "42703") {
              lc = await query(
                `SELECT id FROM contract_capabilities
                  WHERE backlog_issue_key = $1
                    AND contract_category = 'license'`,
                [key]
              );
            } else {
              throw colErr;
            }
          }
          if (lc.rows.length > 0) {
            const row = lc.rows[0];
            const lcId = row.id;
            // Phase 23: フロント互換のため license_contract_id key も維持しつつ
            //   新規 capability_id key も同時にセットする。
            context["license_contract_id"] = lcId;
            context["capability_id"] = lcId;
            // Phase 22.19: Ledger / Material / WorkID を form context に注入
            if (row.ledger_ref_id) {
              context["ledger_ref_id"] = Number(row.ledger_ref_id);
            }
            if (row.material_ref_id) {
              context["material_ref_id"] = Number(row.material_ref_id);
            }
            if (row.work_id) {
              context["work_id"] = row.work_id;
              context["WORK_ID"] = row.work_id;
            }
            // Phase 22.20-B: calc_period_kind / calc_period_close_month を含める
            //   schema 未追加環境では 42703 を catch して legacy SELECT に fallback
            let conds: any;
            try {
              conds = await query(
                `SELECT id, condition_no, region_language_label, calc_method,
                        rate_pct, base_price_label, calc_period, currency,
                        formula_text, payment_terms, mg_amount, ag_amount,
                        calc_period_kind, calc_period_close_month,
                        condition_name, calc_type, fixed_kind,
                        subscription_cycle, unit_amount, guarantee_type,
                        region_territory, region_language, applies_scope
                   FROM capability_financial_conditions
                  WHERE capability_id = $1
                  ORDER BY condition_no ASC`,
                [lcId]
              );
            } catch (colErr2: any) {
              if (colErr2 && colErr2.code === "42703") {
                conds = await query(
                  `SELECT id, condition_no, region_language_label, calc_method,
                          rate_pct, base_price_label, calc_period, currency,
                          formula_text, payment_terms, mg_amount
                     FROM capability_financial_conditions
                    WHERE capability_id = $1
                    ORDER BY condition_no ASC`,
                  [lcId]
                );
              } else {
                throw colErr2;
              }
            }
            context["financial_conditions"] = conds.rows.map((r: any) => {
              // テリトリー / 言語 を別項目で返す。未設定の行は合成ラベルを
              //   最初の '・' で分割してフォールバック (API と同じロジック)。
              let territory = (r.region_territory || "").trim();
              let language = (r.region_language || "").trim();
              if (!territory && !language && r.region_language_label) {
                const s = String(r.region_language_label).trim();
                const idx = s.indexOf("・");
                if (idx < 0) territory = s;
                else {
                  territory = s.slice(0, idx).trim();
                  language = s.slice(idx + 1).trim();
                }
              }
              return {
              id: Number(r.id),
              condition_no: Number(r.condition_no),
              region_territory: territory,
              region_language: language,
              region_language_label: r.region_language_label || "",
              calc_method: r.calc_method || "",
              rate_pct: r.rate_pct !== null ? Number(r.rate_pct) : undefined,
              base_price_label: r.base_price_label || "",
              calc_period: r.calc_period || "",
              calc_period_kind: r.calc_period_kind || undefined,
              calc_period_close_month:
                r.calc_period_close_month != null
                  ? Number(r.calc_period_close_month)
                  : undefined,
              currency: r.currency || "JPY",
              formula_text: r.formula_text || "",
              applies_scope: r.applies_scope || "",
              payment_terms: r.payment_terms || "",
              mg_amount: r.mg_amount !== null ? Number(r.mg_amount) : 0,
              ag_amount: r.ag_amount != null ? Number(r.ag_amount) : 0,
              // 0045: 金銭条件の柔軟化フィールド (名称/計算式タイプ/保証種別)
              condition_name: r.condition_name || "",
              calc_type: r.calc_type || undefined,
              fixed_kind: r.fixed_kind || undefined,
              subscription_cycle: r.subscription_cycle || undefined,
              unit_amount: r.unit_amount != null ? Number(r.unit_amount) : undefined,
              guarantee_type: r.guarantee_type || undefined,
              };
            });

            // Phase 22.20-D: work_sublicensees を読み出して
            //   formData.サブライセンシー一覧 と同じ shape で返却。
            //   master が紐付いている場合は master_name / master_category を
            //   fallback として使う (inline 入力優先)。
            //   テーブル未追加環境では 42P01 を catch して空配列。
            try {
              // Phase 22.21.13: contract_date 追加。worker 未デプロイ環境では
              //   42703 で落ちるので 2 段階 fallback (新版 → 旧版)。
              // Phase 22.21.18: work_id を OR 条件で参照。lcId が違う行 でも
              //   work_id が一致すれば取得 → 「前回内容を引き継ぐ → 新規
              //   license_contracts 行」のようなフローでもサブライセンシーを
              //   復元できるようにする。row.work_id は context にも入っている。
              const workIdForLookup = row.work_id || "";
              let wsRes: any;
              try {
                wsRes = await query(
                  `SELECT ws.id, ws.sublicensee_id, ws.inline_name,
                          ws.category, ws.region, ws.language,
                          ws.payment_terms_label, ws.mg_ag_label, ws.rate_label,
                          ws.remarks, ws.contract_date, ws.sort_order, ws.work_id,
                          s.name AS master_name,
                          s.category AS master_category,
                          s.default_region AS master_region,
                          s.default_language AS master_language
                     FROM work_sublicensees ws
                     LEFT JOIN sublicensees s ON s.id = ws.sublicensee_id
                    WHERE ws.license_contract_id = $1
                       OR (ws.work_id IS NOT NULL AND ws.work_id <> ''
                           AND ws.work_id = $2)
                    ORDER BY ws.sort_order ASC, ws.id ASC`,
                  [lcId, workIdForLookup]
                );
              } catch (innerErr: any) {
                if (innerErr && innerErr.code === "42703") {
                  // work_id カラム未追加 → 第 1 段階 fallback (contract_date あり)
                  try {
                    wsRes = await query(
                      `SELECT ws.id, ws.sublicensee_id, ws.inline_name,
                              ws.category, ws.region, ws.language,
                              ws.payment_terms_label, ws.mg_ag_label, ws.rate_label,
                              ws.remarks, ws.contract_date, ws.sort_order,
                              NULL::text AS work_id,
                              s.name AS master_name,
                              s.category AS master_category,
                              s.default_region AS master_region,
                              s.default_language AS master_language
                         FROM work_sublicensees ws
                         LEFT JOIN sublicensees s ON s.id = ws.sublicensee_id
                        WHERE ws.license_contract_id = $1
                        ORDER BY ws.sort_order ASC, ws.id ASC`,
                      [lcId]
                    );
                  } catch (deepErr: any) {
                    if (deepErr && deepErr.code === "42703") {
                      // contract_date も無い超 legacy
                      wsRes = await query(
                        `SELECT ws.id, ws.sublicensee_id, ws.inline_name,
                                ws.category, ws.region, ws.language,
                                ws.payment_terms_label, ws.mg_ag_label, ws.rate_label,
                                ws.remarks, ws.sort_order,
                                NULL AS contract_date,
                                NULL::text AS work_id,
                                s.name AS master_name,
                                s.category AS master_category,
                                s.default_region AS master_region,
                                s.default_language AS master_language
                           FROM work_sublicensees ws
                           LEFT JOIN sublicensees s ON s.id = ws.sublicensee_id
                          WHERE ws.license_contract_id = $1
                          ORDER BY ws.sort_order ASC, ws.id ASC`,
                        [lcId]
                      );
                    } else {
                      throw deepErr;
                    }
                  }
                } else {
                  throw innerErr;
                }
              }
              context["サブライセンシー一覧"] = wsRes.rows.map((r: any) => ({
                id: Number(r.id),
                sublicensee_id: r.sublicensee_id
                  ? Number(r.sublicensee_id)
                  : undefined,
                区分: r.category || r.master_category || "",
                名称: r.inline_name || r.master_name || "",
                地域: r.region || r.master_region || "",
                言語: r.language || r.master_language || "",
                金銭条件: r.payment_terms_label || "",
                MGAG: r.mg_ag_label || "",
                料率: r.rate_label || "",
                // Phase 22.21.13: 契約締結日 (YYYY-MM-DD 文字列に正規化)
                契約締結日: r.contract_date
                  ? typeof r.contract_date === "string"
                    ? r.contract_date.slice(0, 10)
                    : new Date(r.contract_date).toISOString().slice(0, 10)
                  : "",
                備考: r.remarks || "",
              }));
            } catch (wsErr: any) {
              if (wsErr && (wsErr.code === "42P01" || wsErr.code === "42703")) {
                // テーブル / 列なし → worker 未デプロイ。空で返す。
                console.warn(
                  "[form-context] work_sublicensees テーブル未追加。空 list で返却。"
                );
              } else {
                console.warn("work_sublicensees lookup failed:", wsErr);
              }
            }
          }
        } catch (lcErr) {
          console.warn("capability_financial_conditions lookup failed:", lcErr);
        }
      }

      res.json(context);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/issues/:key/history", async (req, res) => {
    const { key } = req.params;
    try {
      const history: any[] = [];

      const docs = await query(
        "SELECT id, template_type, created_at, document_number FROM documents WHERE issue_key = $1 ORDER BY created_at ASC",
        [key]
      );
      docs.rows.forEach((d) => {
        history.push({
          id: `doc-${d.id}`,
          type: "document",
          label: `文書作成: ${d.template_type}`,
          date: d.created_at,
          ref: d.document_number,
          details: d,
        });
      });

      // Phase 23: order_items → contract_capabilities (record_type='purchase_order') に置換。
      // Phase 23.6.12: 旧 order_items.item_no / .amount は contract_capabilities
      //   には存在しない。document_number / contract_title / amount_ex_tax で
      //   置き換える。1 issue に複数 PO がぶら下がるケースのために id 順を
      //   line_no 代替として使う。
      const orders = await query(
        `SELECT id, document_number, contract_title, amount_ex_tax,
                created_at
           FROM contract_capabilities
          WHERE backlog_issue_key = $1
            AND record_type = 'purchase_order'
          ORDER BY created_at ASC`,
        [key]
      );
      orders.rows.forEach((o, idx) => {
        history.push({
          id: `order-${o.id}`,
          type: "order",
          label: `発注登録: ${o.document_number || o.contract_title || `#${idx + 1}`}`,
          date: o.created_at,
          ref: o.document_number || `PO #${o.id}`,
          amount: Number(o.amount_ex_tax) || 0,
          details: o,
        });
      });

      // Phase 23: order_items → contract_capabilities, delivery_events.order_item_id → capability_id に置換。
      // Phase 23.6.12: oi.item_no は存在しないので document_number を表示用に使う。
      const deliveries = await query(
        `
        SELECT de.*, oi.document_number AS po_document_number
        FROM delivery_events de
        LEFT JOIN contract_capabilities oi
               ON de.capability_id = oi.id
              AND oi.record_type = 'purchase_order'
        WHERE de.backlog_issue_key = $1 OR oi.backlog_issue_key = $2
        ORDER BY de.created_at ASC
      `,
        [key, key]
      );
      deliveries.rows.forEach((dev) => {
        history.push({
          id: `delivery-${dev.id}`,
          type: "delivery",
          label: `検収確認 [${(dev.status || "").toString().toUpperCase()}]`,
          date: dev.created_at,
          ref: `納品 #${dev.delivery_no}${
            dev.po_document_number ? ` (${dev.po_document_number})` : ""
          }`,
          details: dev,
        });
      });

      history.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
