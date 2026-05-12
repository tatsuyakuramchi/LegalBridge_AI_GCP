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

      if (
        template === "inspection_certificate" ||
        template === "inspection_certificate_detailed" ||
        template === "inspection_certificate_v2"
      ) {
        const deliveryQuery = `
          SELECT de.*, oi.amount as order_amount, oi.description as item_desc, oi.spec as item_spec,
                 v.vendor_name, v.vendor_code, v.trade_name, v.bank_name, v.branch_name, v.account_type, v.account_number, v.account_holder_kana as account_holder,
                 lr.summary as order_title, lr.created_at as order_date,
                 ea.asset_number as linked_po_number, ea.file_link as linked_po_link
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
          context["orderDate"] = row.order_date
            ? new Date(row.order_date).toLocaleDateString("ja-JP")
            : "";
          context["documentDate"] = new Date().toLocaleDateString("ja-JP");
          context["isPartial"] = row.delivery_no > 1;

          context["counterparty"] = row.vendor_name || "";
          context["counterpartyRepresentativeSama"] = row.vendor_rep
            ? `${row.vendor_rep} 様`
            : "";
          context["counterpartyTni"] = row.trade_name || "";

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
