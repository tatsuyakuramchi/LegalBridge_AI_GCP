/**
 * legalbridge-search-api
 *
 * Read-only Cloud Run service that fronts the LegalBridge PostgreSQL DB.
 * Owns NO write endpoints — all mutations live in services/worker/.
 *
 * Consumers:
 *   - Slack Gateway GAS  → POST /api/contract-check/search   (法務検索)
 *   - Admin UI (browser) → GET  /api/master/* (vendors, staff, contracts, rules)
 *                          GET  /api/management/* (dashboards)
 *                          GET  /api/backlog/* (issue lookups)
 *
 * Security stance:
 *   - The Cloud Run revision is configured with DATABASE_URL pointing to
 *     a PostgreSQL ROLE that holds SELECT-only privileges. Even if an
 *     injection bug slipped in, this process cannot mutate data.
 *   - /api/contract-check/* is gated by the X-LB-PORTAL-SECRET header
 *     (LB_PORTAL_SECRET env var), matching Slack Gateway's egress.
 *   - initDb() is intentionally NOT called here — schema migrations are
 *     owned by services/worker, which holds a read-write DB role.
 */

import express from "express";
import dotenv from "dotenv";
import { BacklogService } from "./src/services/backlogService.ts";
import { query } from "./src/lib/db.ts";
import * as contractCheckService from "./src/services/contractCheckService.ts";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;
  console.log("🚀 Starting legalbridge-search-api...");

  // Load Backlog credentials from DB app_settings (preferred) or env.
  let dbSettings: Record<string, any> = {};
  try {
    const settingsResult = await query("SELECT * FROM app_settings");
    settingsResult.rows.forEach((r) => (dbSettings[r.key] = r.value));
    console.log("✅ Settings loaded from DB");
  } catch (err) {
    console.warn("⚠️ Could not load app_settings; falling back to env vars only.", err);
  }

  // CORS — the Admin UI is loaded from legalbridge-admin-ui (different
  // origin) and dispatches /api/* via the apiRouter to this service.
  // Reflect the request Origin to keep credentials/cookies portable;
  // fall back to "*" when there is no Origin header (curl, server-side
  // probes).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.header("Access-Control-Allow-Origin", (origin as string) || "*");
    res.header("Vary", "Origin");
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-LB-PORTAL-SECRET"
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Request logger.
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const backlogService = new BacklogService({
    host: dbSettings.BACKLOG_HOST || process.env.BACKLOG_HOST,
    apiKey: dbSettings.BACKLOG_API_KEY || process.env.BACKLOG_API_KEY,
    projectKey: dbSettings.BACKLOG_PROJECT_KEY || process.env.BACKLOG_PROJECT_KEY,
  });

  // -------------------------------------------------------------------
  // /api/contract-check/* — gated by shared secret
  // -------------------------------------------------------------------

  function requirePortalSecret(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const expected = process.env.LB_PORTAL_SECRET;
    const actual = req.headers["x-lb-portal-secret"];

    if (!expected) {
      console.warn("⚠️ LB_PORTAL_SECRET is not set. Contract-check API is unprotected.");
      return next();
    }
    if (actual !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    return next();
  }

  app.get("/api/status", (_req, res) => {
    res.json({
      service: "legalbridge-search-api",
      status: "ok",
      role: "read-only",
      slackBotConfigured: !!(dbSettings.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN),
      backlogReady: !!(process.env.BACKLOG_API_KEY && process.env.BACKLOG_HOST),
      backlogHost: process.env.BACKLOG_HOST || null,
      backlogProjectKey: process.env.BACKLOG_PROJECT_KEY || null,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/contract-check/purposes", requirePortalSecret, async (_req, res) => {
    try {
      const purposes = await contractCheckService.getContractPurposes();
      res.json(purposes);
    } catch (error) {
      console.error("Error fetching purposes:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.post(
    "/api/contract-check/search",
    requirePortalSecret,
    express.json(),
    async (req, res) => {
      try {
        const input = req.body;
        if (!input || !input.counterpartyName) {
          return res
            .status(400)
            .json({ ok: false, error: "Missing counterpartyName in request body" });
        }
        const result = await contractCheckService.searchContractStatus(input);
        res.json(result);
      } catch (error) {
        console.error("Error searching contract status:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  // -------------------------------------------------------------------
  // /api/backlog/* — read-only Backlog REST API passthrough
  // -------------------------------------------------------------------

  app.get("/api/backlog/issues", async (_req, res) => {
    try {
      const issues = await backlogService.getIssues();
      res.json(issues);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/issue-types", async (_req, res) => {
    try {
      const types = await backlogService.getIssueTypes();
      res.json(types);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/custom-fields", async (_req, res) => {
    try {
      const fields = await backlogService.getCustomFields();
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/statuses", async (_req, res) => {
    try {
      const statuses = await backlogService.getStatuses();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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

      // Phase 7b: 発注書テンプレなら既存 order_line_items を items[] として
      // プリセットする (フォーム側の LineItemTable がそのまま使える shape)。
      if (template === "purchase_order" || template === "planning_purchase_order") {
        const orderHeader = await query(
          `SELECT id, amount_ex_tax, tax_rate
             FROM order_items
            WHERE backlog_issue_key = $1`,
          [key]
        );
        if (orderHeader.rows.length > 0) {
          const orderItemId = orderHeader.rows[0].id;
          context["taxRate"] = orderHeader.rows[0].tax_rate || 10;
          context["grandTotalExTax"] = Number(orderHeader.rows[0].amount_ex_tax) || 0;
          const lines = await query(
            `SELECT line_no, item_name, spec, unit_price, quantity,
                    amount_ex_tax, payment_method, payment_date
               FROM order_line_items
              WHERE order_item_id = $1
              ORDER BY line_no ASC`,
            [orderItemId]
          );
          context["items"] = lines.rows.map((r: any) => ({
            line_no: Number(r.line_no),
            item_name: r.item_name || "",
            spec: r.spec || "",
            unit_price: Number(r.unit_price) || 0,
            quantity: Number(r.quantity) || 0,
            amount_ex_tax: Number(r.amount_ex_tax) || 0,
            payment_method: r.payment_method || "",
            payment_date: r.payment_date || "",
          }));
        }
      }

      if (
        template === "inspection_certificate" ||
        template === "inspection_certificate_detailed" ||
        template === "inspection_certificate_v2"
      ) {
        // Phase 7c: 親 PO の明細 + 検収累計を取得 (Backlog 親子 issue 経由)。
        //   1. この issue の parentIssueId を Backlog から拾う
        //   2. parentIssueKey → order_items を見つける
        //   3. order_line_items を inspection availability 付きで返す
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
            const poHeader = await query(
              `SELECT id, amount_ex_tax, tax_rate, backlog_issue_key,
                      description, due_date, created_at
                 FROM order_items
                WHERE backlog_issue_key = $1`,
              [parentKey]
            );
            if (poHeader.rows.length > 0) {
              const poId = poHeader.rows[0].id;
              const lines = await query(
                `SELECT id, line_no, item_name, spec, unit_price, quantity,
                        amount_ex_tax, payment_method, payment_date
                   FROM order_line_items
                  WHERE order_item_id = $1
                  ORDER BY line_no ASC`,
                [poId]
              );
              const lineIds = lines.rows.map((l: any) => l.id);
              const inspMap: Record<number, { amt: number; qty: number }> = {};
              if (lineIds.length > 0) {
                const insp = await query(
                  `SELECT order_line_item_id,
                          COALESCE(SUM(inspected_amount_ex_tax), 0) AS amt,
                          COALESCE(SUM(inspected_quantity),       0) AS qty
                     FROM delivery_line_items
                    WHERE order_line_item_id = ANY($1::int[])
                    GROUP BY order_line_item_id`,
                  [lineIds]
                );
                insp.rows.forEach((r: any) => {
                  inspMap[Number(r.order_line_item_id)] = {
                    amt: Number(r.amt) || 0,
                    qty: Number(r.qty) || 0,
                  };
                });
              }

              // Phase 9c: 親 PO の document_number / 業務名 / 仕様 / 発注日
              //   - 発注番号 ← documents.template_type=purchase_order の最新行
              //   - 業務名 ← order_line_items 1 行目の item_name
              //   - 仕様   ← order_line_items 1 行目の spec
              //   - 発注日 ← order_items.created_at (due_date 優先)
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

        // 注: vendors.vendor_rep は存在しない。contact_name を代用。
        const deliveryQuery = `
          SELECT de.*, oi.amount as order_amount, oi.description as item_desc, oi.spec as item_spec,
                 v.vendor_name, v.vendor_code, v.trade_name, v.bank_name, v.branch_name, v.account_type,
                 v.account_number, v.account_holder_kana as account_holder,
                 v.entity_type as vendor_entity_type, v.contact_name as vendor_rep_name,
                 v.invoice_registration_number as vendor_tni,
                 lr.summary as order_title, lr.created_at as order_date,
                 ea.asset_number as linked_po_number, ea.file_link as linked_po_link,
                 (SELECT d.document_number FROM documents d
                    WHERE d.issue_key = oi.backlog_issue_key
                      AND d.template_type LIKE '%purchase_order%'
                    ORDER BY d.created_at DESC LIMIT 1) AS parent_po_number
          FROM delivery_events de
          LEFT JOIN order_items oi ON de.order_item_id = oi.id
          LEFT JOIN vendors v ON oi.vendor_code = v.vendor_code
          LEFT JOIN legal_requests lr ON de.backlog_issue_key = lr.backlog_issue_key
          LEFT JOIN external_assets ea ON de.linked_asset_id = ea.id
          WHERE de.backlog_issue_key = $1
          ORDER BY de.delivery_no DESC LIMIT 1
        `;
        const result = await query(deliveryQuery, [key]);
        if (result.rows.length > 0) {
          const row = result.rows[0];
          context["issueKey"] = key;
          context["itemNo"] = String(row.order_item_id || "1");
          context["deliveryNo"] = String(row.delivery_no || "1");
          context["totalDeliveries"] = "1";
          context["itemCount"] = "1";
          context["orderDate"] = row.order_date || "";
          context["documentDate"] = new Date().toISOString().slice(0, 10);
          context["isPartial"] = row.delivery_no > 1;
          // Phase 9c: 発注番号 (親 PO の document_number) を上書きしないよう、
          // 上の parent-by-Backlog 経路で既にセットされていれば温存。
          if (!context["parent_po_number"] && row.parent_po_number) {
            context["parent_po_number"] = row.parent_po_number;
          }

          context["counterparty"] = row.vendor_name || "";
          // Phase 9c: 法人/個人を分岐
          const isCorp =
            (row.vendor_entity_type || "").toLowerCase() === "corporate" ||
            row.vendor_entity_type === "法人";
          context["COUNTERPARTY_IS_CORPORATION"] = isCorp;
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
        template === "royalty_statement" ||
        template === "individual_license_terms" ||
        template === "license_master" ||
        template === "license_report" ||
        template === "intl_purchase_order"
      ) {
        const royaltyQuery = `
          SELECT lc.*, rp.total_amount as last_payment_amount, rp.period as last_period, me.product_name, me.msrp,
                 v.vendor_name, v.address as vendor_address, v.email as vendor_email, v.contact_name as vendor_contact,
                 ea.asset_number as linked_terms_number, ea.file_link as linked_terms_link
          FROM license_contracts lc
          LEFT JOIN royalty_payments rp ON lc.id = rp.license_contract_id
          LEFT JOIN manufacturing_events me ON lc.id = me.license_contract_id
          LEFT JOIN vendors v ON (lc.licensor = v.vendor_name)
          LEFT JOIN external_assets ea ON lc.linked_asset_id = ea.id
          WHERE lc.backlog_issue_key = $1 OR rp.backlog_issue_key = $1
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
      // license_financial_conditions を構造化 rows として同梱する。
      // - individual_license_terms: FinancialConditionTable の編集ソース
      // - royalty_statement: 計算対象の condition を選ぶドロップダウン用
      // 既存の {{金銭条件1_*}} flat field 群は上の royaltyQuery 分岐で
      // 既に埋まっているので、こちらは追加情報。
      if (
        template === "individual_license_terms" ||
        template === "royalty_statement"
      ) {
        try {
          const lc = await query(
            `SELECT id FROM license_contracts WHERE backlog_issue_key = $1`,
            [key]
          );
          if (lc.rows.length > 0) {
            const lcId = lc.rows[0].id;
            context["license_contract_id"] = lcId;
            const conds = await query(
              `SELECT id, condition_no, region_language_label, calc_method,
                      rate_pct, base_price_label, calc_period, currency,
                      formula_text, payment_terms, mg_amount
                 FROM license_financial_conditions
                WHERE license_contract_id = $1
                ORDER BY condition_no ASC`,
              [lcId]
            );
            context["financial_conditions"] = conds.rows.map((r: any) => ({
              id: Number(r.id),
              condition_no: Number(r.condition_no),
              region_language_label: r.region_language_label || "",
              calc_method: r.calc_method || "",
              rate_pct: r.rate_pct !== null ? Number(r.rate_pct) : undefined,
              base_price_label: r.base_price_label || "",
              calc_period: r.calc_period || "",
              currency: r.currency || "JPY",
              formula_text: r.formula_text || "",
              payment_terms: r.payment_terms || "",
              mg_amount: r.mg_amount !== null ? Number(r.mg_amount) : 0,
            }));
          }
        } catch (lcErr) {
          console.warn("license_financial_conditions lookup failed:", lcErr);
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

      const orders = await query(
        "SELECT * FROM order_items WHERE backlog_issue_key = $1 ORDER BY created_at ASC",
        [key]
      );
      orders.rows.forEach((o) => {
        history.push({
          id: `order-${o.id}`,
          type: "order",
          label: `発注登録 (アイテム #${o.item_no})`,
          date: o.created_at,
          ref: `PO Item #${o.item_no}`,
          amount: o.amount,
          details: o,
        });
      });

      const deliveries = await query(
        `
        SELECT de.*, oi.item_no
        FROM delivery_events de
        LEFT JOIN order_items oi ON de.order_item_id = oi.id
        WHERE de.backlog_issue_key = $1 OR oi.backlog_issue_key = $2
        ORDER BY de.created_at ASC
      `,
        [key, key]
      );
      deliveries.rows.forEach((dev) => {
        history.push({
          id: `delivery-${dev.id}`,
          type: "delivery",
          label: `検収確認 [${dev.status.toUpperCase()}]`,
          date: dev.created_at,
          ref: `納品 #${dev.delivery_no}${dev.item_no ? ` (Item #${dev.item_no})` : ""}`,
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

  // -------------------------------------------------------------------
  // /api/management/* — dashboard reads
  // -------------------------------------------------------------------

  app.get("/api/management/alerts", async (_req, res) => {
    try {
      const overdue = await query(
        `SELECT d.*, l.summary as issue_summary, l.counterparty
         FROM delivery_events d
         LEFT JOIN legal_requests l ON d.backlog_issue_key = l.backlog_issue_key
         WHERE d.status = 'pending' AND d.inspection_deadline < CURRENT_TIMESTAMP`
      );
      res.json({
        overdue: overdue.rows,
        totalAlerts: overdue.rowCount,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/deliveries", async (_req, res) => {
    try {
      const result = await query(`
        SELECT d.*, r.counterparty, r.summary
        FROM delivery_events d
        LEFT JOIN legal_requests r ON d.backlog_issue_key = r.backlog_issue_key
        ORDER BY d.inspection_deadline ASC NULLS LAST
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/royalties", async (_req, res) => {
    try {
      const result = await query(`
        SELECT p.*, r.summary as project_name
        FROM royalty_payments p
        LEFT JOIN legal_requests r ON p.backlog_issue_key = r.backlog_issue_key
        ORDER BY p.period DESC, project_name ASC
      `);

      if (result.rows.length === 0) {
        return res.json([
          { id: "m1", period: "2026-01", project_name: "Sample Game A", total_amount: 500000, status: "paid" },
          { id: "m2", period: "2026-02", project_name: "Sample Game A", total_amount: 750000, status: "calculated" },
          { id: "m3", period: "2026-03", project_name: "Sample Game B", total_amount: 1200000, status: "calculated" },
        ]);
      }

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/workflows", async (_req, res) => {
    try {
      const result = await query(`
        SELECT w.*, r.summary, r.counterparty, r.contract_type
        FROM issue_workflows w
        LEFT JOIN legal_requests r ON w.backlog_issue_key = r.backlog_issue_key
        ORDER BY w.updated_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/documents", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM documents ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/assets", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM external_assets ORDER BY created_at DESC"
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/master/* — read-only master data
  // -------------------------------------------------------------------

  app.get("/api/master/company-profile", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM app_settings WHERE key IN ('COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_REPRESENTATIVE', 'COMPANY_INVOICE_NO')"
      );
      const settings: Record<string, string> = {};
      result.rows.forEach((r) => (settings[r.key] = r.value));

      res.json({
        name: settings.COMPANY_NAME || process.env.COMPANY_NAME || "サンプル株式会社",
        address:
          settings.COMPANY_ADDRESS ||
          process.env.COMPANY_ADDRESS ||
          "東京都千代田区丸の内1-1-1",
        representative:
          settings.COMPANY_REPRESENTATIVE ||
          process.env.COMPANY_REPRESENTATIVE ||
          "代表取締役 山田 太郎",
        invoice_no:
          settings.COMPANY_INVOICE_NO ||
          process.env.COMPANY_INVOICE_NO ||
          "T1234567890123",
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/app-settings", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM app_settings");
      const settings: Record<string, any> = {};
      result.rows.forEach((row) => {
        settings[row.key] = row.value;
      });
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/vendors", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM vendors ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/vendors/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const result = await query("SELECT * FROM vendors WHERE vendor_code = $1", [code]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/staff", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM staff ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/contracts", async (_req, res) => {
    try {
      const result = await query(
        `SELECT cc.*, v.vendor_name
         FROM contract_capabilities cc
         LEFT JOIN vendors v ON cc.vendor_id = v.id
         ORDER BY cc.id DESC`
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/rules", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM department_workflow_rules ORDER BY id ASC"
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/order-items/* — read-only mirrors (Phase 4b)
  //
  // Writes live on the worker (POST /api/order-items/:id/line-items
  // and the inspection-side endpoints). Reads can stay on the api
  // service since they don't need elevated DB privileges.
  // -------------------------------------------------------------------

  /**
   * 発注書一覧 (検収書フォームの親 PO ピッカー用)。
   * search-api 側は read-only DB ロールなので副作用なしで安全に
   * リストアップできる。
   */
  app.get("/api/order-items/list", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await query(
        `SELECT
           oi.id,
           oi.backlog_issue_key,
           oi.description,
           oi.amount_ex_tax,
           oi.vendor_code,
           oi.tax_rate,
           oi.due_date,
           oi.created_at,
           (SELECT COUNT(*) FROM order_line_items oli
              WHERE oli.order_item_id = oi.id) AS line_count,
           (SELECT COALESCE(SUM(dli.inspected_amount_ex_tax), 0)
              FROM delivery_line_items dli
              JOIN order_line_items oli ON oli.id = dli.order_line_item_id
             WHERE oli.order_item_id = oi.id) AS inspected_amount,
           (SELECT d.document_number FROM documents d
             WHERE d.issue_key = oi.backlog_issue_key
               AND d.template_type LIKE '%purchase_order%'
             ORDER BY d.created_at DESC LIMIT 1) AS document_number,
           (SELECT ea.file_link FROM external_assets ea
             WHERE ea.backlog_issue_key = oi.backlog_issue_key
             ORDER BY ea.created_at DESC LIMIT 1) AS drive_link,
           (oi.backlog_issue_key LIKE 'IMPORT-%') AS is_imported,
           (SELECT v.vendor_name FROM vendors v
             WHERE v.vendor_code = oi.vendor_code LIMIT 1) AS vendor_name
         FROM order_items oi
         WHERE COALESCE($1, '') = ''
            OR oi.backlog_issue_key ILIKE '%' || $1 || '%'
            OR COALESCE(oi.description, '') ILIKE '%' || $1 || '%'
            OR COALESCE(oi.vendor_code, '') ILIKE '%' || $1 || '%'
         ORDER BY oi.created_at DESC
         LIMIT $2`,
        [q, limit]
      );
      res.json(
        rows.rows.map((r: any) => ({
          id: Number(r.id),
          backlog_issue_key: r.backlog_issue_key,
          description: r.description || "",
          amount_ex_tax: Number(r.amount_ex_tax) || 0,
          vendor_code: r.vendor_code || "",
          vendor_name: r.vendor_name || "",
          tax_rate: r.tax_rate != null ? Number(r.tax_rate) : null,
          due_date: r.due_date,
          created_at: r.created_at,
          line_count: Number(r.line_count) || 0,
          inspected_amount: Number(r.inspected_amount) || 0,
          remaining_amount:
            (Number(r.amount_ex_tax) || 0) - (Number(r.inspected_amount) || 0),
          document_number: r.document_number || "",
          drive_link: r.drive_link || "",
          is_imported: !!r.is_imported,
        }))
      );
    } catch (error) {
      console.error("/api/order-items/list failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/order-items/by-issue/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const header = await query(
        `SELECT id, legal_request_id, vendor_code, description,
                amount, amount_ex_tax, tax_rate, tax_amount, amount_inc_tax,
                due_date, backlog_issue_key, created_at
           FROM order_items
          WHERE backlog_issue_key = $1`,
        [key]
      );
      if (header.rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }
      const orderItem = header.rows[0];

      const lines = await query(
        `SELECT id, order_item_id, line_no, item_name, spec,
                unit_price, quantity, amount_ex_tax,
                payment_method, payment_date,
                created_at, updated_at
           FROM order_line_items
          WHERE order_item_id = $1
          ORDER BY line_no ASC`,
        [orderItem.id]
      );

      // Inline the availability roll-up here so the api service doesn't
      // have to import the worker-side calc helpers (which do UPDATEs
      // we can't do under the read-only DB role).
      const lineIds = lines.rows.map((l: any) => l.id);
      const inspectedMap: Record<number, { amt: number; qty: number }> = {};
      if (lineIds.length > 0) {
        const insp = await query(
          `SELECT order_line_item_id,
                  COALESCE(SUM(inspected_amount_ex_tax), 0) AS amt,
                  COALESCE(SUM(inspected_quantity),       0) AS qty
             FROM delivery_line_items
            WHERE order_line_item_id = ANY($1::int[])
            GROUP BY order_line_item_id`,
          [lineIds]
        );
        insp.rows.forEach((r: any) => {
          inspectedMap[Number(r.order_line_item_id)] = {
            amt: Number(r.amt) || 0,
            qty: Number(r.qty) || 0,
          };
        });
      }

      const linesWithAvail = lines.rows.map((line: any) => {
        const ordAmt = Number(line.amount_ex_tax) || 0;
        const ordQty = Number(line.quantity) || 0;
        const insp = inspectedMap[Number(line.id)] || { amt: 0, qty: 0 };
        return {
          ...line,
          inspection: {
            ordered_amount: ordAmt,
            ordered_quantity: ordQty,
            inspected_amount: insp.amt,
            inspected_quantity: insp.qty,
            remaining_amount: ordAmt - insp.amt,
            remaining_quantity: ordQty - insp.qty,
            overflow_amount: insp.amt > ordAmt,
            overflow_quantity: insp.qty > ordQty,
          },
        };
      });

      // Phase 9c: 親 PO の document_number と vendor 詳細も同梱。
      // ParentPoPicker で選んだ時、検収書フォームに 発注番号 / 取引先名 /
      // 法人個人 / 代表者 / 銀行口座 を一括流し込むため。
      const docRow = await query(
        `SELECT document_number FROM documents
          WHERE issue_key = $1
            AND template_type LIKE '%purchase_order%'
          ORDER BY created_at DESC LIMIT 1`,
        [key]
      );
      let vendor: any = null;
      if (orderItem.vendor_code) {
        // 注: vendors テーブルに vendor_rep カラムは存在しない。
        // 代表者名は contact_name を使う (DocumentForm 側でも同等の
        // フォールバック `v.vendor_rep || v.contact_name` を使っている)。
        const vRes = await query(
          `SELECT vendor_name, address, contact_name, entity_type,
                  invoice_registration_number,
                  bank_name, branch_name, account_type, account_number,
                  account_holder_kana
             FROM vendors WHERE vendor_code = $1 LIMIT 1`,
          [orderItem.vendor_code]
        );
        // 互換のため vendor_rep を contact_name のミラーで出す
        vendor = vRes.rows[0]
          ? { ...vRes.rows[0], vendor_rep: vRes.rows[0].contact_name }
          : null;
      }

      res.json({
        order_item: orderItem,
        line_items: linesWithAvail,
        document_number: docRow.rows[0]?.document_number || "",
        vendor,
      });
    } catch (error) {
      console.error("/api/order-items/by-issue failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/order-line-items/:id/availability", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ordered = await query(
        "SELECT amount_ex_tax, quantity FROM order_line_items WHERE id = $1",
        [id]
      );
      if (ordered.rows.length === 0) {
        return res.status(404).json({ error: "order_line_item not found" });
      }
      const ordAmt = Number(ordered.rows[0].amount_ex_tax) || 0;
      const ordQty = Number(ordered.rows[0].quantity) || 0;

      const inspected = await query(
        `SELECT COALESCE(SUM(inspected_amount_ex_tax), 0) AS amt,
                COALESCE(SUM(inspected_quantity),       0) AS qty
           FROM delivery_line_items
          WHERE order_line_item_id = $1`,
        [id]
      );
      const inspAmt = Number(inspected.rows[0].amt) || 0;
      const inspQty = Number(inspected.rows[0].qty) || 0;

      res.json({
        ordered_amount: ordAmt,
        ordered_quantity: ordQty,
        inspected_amount: inspAmt,
        inspected_quantity: inspQty,
        remaining_amount: ordAmt - inspAmt,
        remaining_quantity: ordQty - inspQty,
        overflow_amount: inspAmt > ordAmt,
        overflow_quantity: inspQty > ordQty,
      });
    } catch (error) {
      console.error("/api/order-line-items/:id/availability failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/license-contracts/* — read-only mirrors (Phase 5b)
  // -------------------------------------------------------------------

  app.get("/api/license-contracts/by-issue/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const header = await query(
        `SELECT id, backlog_issue_key, ledger_id, ledger_number, contract_number,
                issue_date, basic_contract_name,
                licensor_name, licensor_address, licensor_rep, licensor_is_corporation,
                licensee_name, licensee_address, licensee_rep, licensee_is_corporation,
                license_start_date, license_period_note,
                original_work, original_work_note, product_name_predicted,
                exclusivity, supervisor, credit_display, remarks,
                created_at
           FROM license_contracts
          WHERE backlog_issue_key = $1`,
        [key]
      );
      if (header.rows.length === 0) {
        return res.status(404).json({ error: "License contract not found" });
      }
      const lc = header.rows[0];

      const conds = await query(
        `SELECT id, condition_no, region_language_label, calc_method,
                rate_pct, base_price_label, calc_period, currency,
                formula_text, payment_terms, mg_amount,
                created_at, updated_at
           FROM license_financial_conditions
          WHERE license_contract_id = $1
          ORDER BY condition_no ASC`,
        [lc.id]
      );

      // Inline MG status aggregation (read-only DB role 用)。
      // calc_license.ts の getLicenseMgStatus と等価。
      const mgStatus: Array<any> = [];
      for (const c of conds.rows) {
        const consumedRes = await query(
          `SELECT COALESCE(SUM(mg_consumed_this_time), 0) AS consumed
             FROM royalty_calculations
            WHERE license_contract_id = $1
              AND license_financial_condition_id = $2`,
          [lc.id, Number(c.id)]
        );
        const consumed = Number(consumedRes.rows[0].consumed) || 0;
        const mgAmount = Number(c.mg_amount) || 0;
        mgStatus.push({
          condition_no: Number(c.condition_no),
          condition_id: Number(c.id),
          mg_amount: mgAmount,
          consumed_total: consumed,
          remaining: Math.max(0, mgAmount - consumed),
          fully_consumed: mgAmount > 0 && consumed >= mgAmount,
        });
      }

      res.json({
        license_contract: lc,
        financial_conditions: conds.rows,
        mg_status: mgStatus,
      });
    } catch (error) {
      console.error("/api/license-contracts/by-issue failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * ライセンス契約に紐づく利用許諾料計算書の履歴を返す。
   */
  app.get("/api/license-contracts/:id/royalty-history", async (req, res) => {
    try {
      const lcId = Number(req.params.id);
      const result = await query(
        `SELECT id, backlog_issue_key, license_financial_condition_id,
                manufacturing_event_id, calc_type,
                unit_price, quantity, sample_quantity, billable_quantity,
                rate_pct, gross_royalty_ex_tax,
                mg_amount, mg_consumed_before, mg_consumed_this_time,
                mg_consumed_after, mg_remaining, mg_fully_consumed,
                actual_royalty_ex_tax, tax_rate, tax_amount, total_payment_inc_tax,
                currency, period, reporting_deadline, payment_due_date,
                notes, created_at
           FROM royalty_calculations
          WHERE license_contract_id = $1
          ORDER BY created_at DESC`,
        [lcId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("/api/license-contracts/:id/royalty-history failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/dashboard/*
  // -------------------------------------------------------------------

  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const issues = await backlogService.getIssues();
      const docs = await query(
        "SELECT issue_key, template_type, created_at FROM documents"
      );

      const stats = {
        totalIssues: issues.length,
        totalDocuments: docs.rowCount,
        byStatus: {} as Record<string, number>,
        recentActivity: docs.rows.slice(0, 5),
        issueDetails: issues.map((i) => {
          const relatedDocs = docs.rows.filter((d) => d.issue_key === i.issueKey);
          return {
            ...i,
            documentCount: relatedDocs.length,
            lastDocDate:
              relatedDocs.length > 0 ? relatedDocs[0].created_at : null,
          };
        }),
      };

      issues.forEach((i) => {
        const s = i.status?.name || "Unknown";
        stats.byStatus[s] = (stats.byStatus[s] || 0) + 1;
      });

      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.listen(PORT, () => {
    console.log(`[search-api] listening on :${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal error starting search-api:", err);
  process.exit(1);
});
