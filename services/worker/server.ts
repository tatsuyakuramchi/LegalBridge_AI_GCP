/**
 * legalbridge-document-worker
 *
 * Cloud Run service that owns ALL writes against the LegalBridge
 * PostgreSQL DB, plus document generation and the Backlog webhook
 * pipeline.
 *
 * Critical paths:
 *   POST /api/webhooks/backlog
 *     ← Backlog (issue created / status updated)
 *     → runs processLegalRequestSubmission → DB write + doc render
 *       + Drive upload + Slack DM
 *
 *   POST /api/master/*  (vendors, staff, contracts, rules, app-settings)
 *   PUT/DELETE /api/master/contracts/:id
 *   POST /api/management/{link-asset, assets, import-csv, check-status-trigger}
 *   PATCH /api/backlog/issues/:key/status
 *   GET /api/numbering/next  ← writes to document_sequences
 *
 *   POST /api/documents/generate (Admin UI manual doc generation)
 *   GET/POST /api/templates/*  (template management)
 *   GET/POST /api/master/workflow-settings
 *     → these are migrated in a follow-up commit (Phase 2d-2) since
 *       they require additional template-rendering helpers.
 *
 * Owned by the Legal team. Independent of services/api — no shared
 * code, only the PostgreSQL schema is the contract.
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Readable } from "stream";
import { WebClient } from "@slack/web-api";
import TurndownService from "turndown";
// @ts-ignore — turndown-plugin-gfm has no types
import { gfm } from "turndown-plugin-gfm";
import { BacklogService } from "./src/services/backlogService.ts";
import { DocumentService } from "./src/services/documentService.ts";
import type { DocumentType } from "./src/services/documentService.ts";
import { GoogleDriveService } from "./src/services/googleDriveService.ts";
import { ExcelService } from "./src/services/excelService.ts";
import { CsvImportService } from "./src/services/csvImportService.ts";
import {
  initDb,
  query,
  getNewDocumentNumber,
} from "./src/lib/db.ts";
import {
  calculateTax,
  calculateOrderLineAmount,
  calculateInspectedAmount,
  recalculateOrderTotal,
  getInspectionAvailability,
  previewInspectionOverflow,
} from "./src/lib/calc.ts";
import {
  calculateGrossRoyalty,
  applyMgConsumption,
  previewRoyaltyCalculation,
  getLicenseMgStatus,
} from "./src/lib/calc_license.ts";

dotenv.config();

interface LegalRequestSubmission {
  slack_user_id: string;
  slack_user_name?: string;
  dept: string;
  request_type: string;
  summary: string;
  deadline?: string;
  details?: string;
  counterparty?: string;
  entity_type?: "corporate" | "individual";
  entity_id?: string;
  delivery_no?: number | null;
  order_amount?: string | null;
  delivery_date?: string | null;
  inspection_deadline?: string | null;
  existing_issue_key?: string;
  existing_issue_id?: number;
}

const ISSUE_TYPE_TO_REQUEST_TYPE: Record<string, string> = {
  "法務相談": "legal_consult",
  "NDA": "nda",
  "業務委託基本契約": "outsourcing",
  "ライセンス契約": "license_master",
  "個別利用許諾条件": "lic_individual",
  "売買契約（当社買手）": "sales_master",
  "売買契約（当社売手・標準）": "sales_master",
  "売買契約（当社売手・保証金掛け売り）": "sales_master",
  "発注書": "purchase_order",
  "企画発注書": "purchase_order",
  "出版発注書": "purchase_order",
  "納品リクエスト": "delivery_inspec",
  "製造案件": "delivery_inspec",
  "売上報告案件": "license_calc",
  "海外IP契約（基本契約）": "license_master",
  "海外IP契約（変更合意）": "license_master",
  "契約審査": "outsourcing",
  "事務手続": "legal_consult",
};

const replaceSlackPlaceholders = (tmpl: string, data: any): string => {
  return tmpl
    .replace(/{{requestType}}/g, data.requestType || "")
    .replace(/{{issueKey}}/g, data.issueKey || "")
    .replace(/{{docNumber}}/g, data.docNumber || "")
    .replace(/{{driveLink}}/g, data.driveLink || "")
    .replace(/{{user}}/g, data.user ? `<@${data.user}>` : "")
    .replace(/{{summary}}/g, data.summary || "")
    .replace(/{{counterparty}}/g, data.counterparty || "");
};

async function startServer() {
  try {
    await initDb();
    console.log("✅ Database initialized (worker has read-write role)");
  } catch (dbErr) {
    console.error("❌ Database initialization failed:", dbErr);
  }

  const app = express();
  const PORT = Number(process.env.PORT) || 8080;
  console.log("🚀 Starting legalbridge-document-worker...");

  // Load app_settings.
  let dbSettings: Record<string, any> = {};
  try {
    const settingsResult = await query("SELECT * FROM app_settings");
    settingsResult.rows.forEach((r) => (dbSettings[r.key] = r.value));
    console.log("✅ Settings loaded");
  } catch (err) {
    console.warn("⚠️ Could not load app_settings; falling back to env vars only.", err);
  }

  // CORS — Admin UI dispatches mutation routes here across origins.
  // See services/api/server.ts for the same policy on the read side.
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

  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const slackBotToken = dbSettings.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  const slackWebClient: WebClient | null = slackBotToken
    ? new WebClient(slackBotToken)
    : null;

  const backlogService = new BacklogService({
    host: dbSettings.BACKLOG_HOST || process.env.BACKLOG_HOST,
    apiKey: dbSettings.BACKLOG_API_KEY || process.env.BACKLOG_API_KEY,
    projectKey: dbSettings.BACKLOG_PROJECT_KEY || process.env.BACKLOG_PROJECT_KEY,
  });
  const documentService = new DocumentService();
  const googleDriveService = new GoogleDriveService();
  const excelService = new ExcelService();
  const csvImportService = new CsvImportService();

  // Turndown for /api/test-generate-markdown (HTML → Markdown).
  const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    hr: "---",
  });
  turndownService.use(gfm);
  turndownService.addRule("remove-styles", {
    filter: ["style", "head", "meta", "title"],
    replacement: () => "",
  });

  const upload = multer({ storage: multer.memoryStorage() });

  // -------------------------------------------------------------------
  // Core pipeline (used by both webhook and the legacy intake endpoint).
  // -------------------------------------------------------------------

  async function processLegalRequestSubmission(
    input: LegalRequestSubmission
  ): Promise<{ issueKey: string; docNumber: string; driveLink: string }> {
    const {
      slack_user_id: user,
      slack_user_name: userName,
      dept,
      request_type: requestType,
      summary,
      deadline = "",
      details = "",
      counterparty = "",
      entity_type: entityType = "corporate",
      entity_id: entityId = "",
      delivery_no: deliveryNo = null,
      order_amount: orderAmount = null,
      delivery_date: deliveryDate = null,
      inspection_deadline: inspectionDeadline = null,
    } = input;

    let templateType: DocumentType = "legal_request";
    if (requestType === "delivery_inspec") templateType = "inspection_certificate";
    else if (requestType === "purchase_order") templateType = "purchase_order";
    else if (requestType === "nda") templateType = "nda";
    else if (requestType === "license_master") templateType = "license_master";
    else if (requestType === "lic_individual") templateType = "individual_license_terms";
    else if (requestType === "license_calc") templateType = "license_calculation_sheet";

    const displaySummary = deliveryNo ? `${summary} (第${deliveryNo}回納品)` : summary;

    const backlogDescription = `
依頼タイプ: ${requestType}
希望納期: ${deadline}
依頼者: <@${user}>

【相手方情報】
名称: ${counterparty}
区分: ${entityType === "corporate" ? "法人" : "個人"}
番号/コード: ${entityId}

【詳細】
${details}
    `.trim();

    let issueTypeId = 1;
    let categoryId: number | undefined = undefined;
    try {
      const [types, categories] = await Promise.all([
        backlogService.getIssueTypes(),
        backlogService.getCategories(),
      ]);

      if (types && types.length > 0) {
        let targetTypeName = "事務手続";
        if (requestType === "legal_consult") targetTypeName = "法務相談";
        else if (
          ["contract", "nda", "outsourcing", "license_master", "lic_individual", "sales_master", "purchase_order"].includes(
            requestType
          )
        )
          targetTypeName = "契約審査";
        else if (requestType === "delivery_inspec") targetTypeName = "納品・検収";
        else if (requestType === "license_calc") targetTypeName = "利用許諾計算";

        const matchedType = types.find((t: any) => t.name === targetTypeName);
        issueTypeId = matchedType ? matchedType.id : types[0].id;
      }

      if (categories && categories.length > 0) {
        let targetCategoryName = "通知書";
        if (["nda", "contract", "outsourcing", "license_master", "lic_individual"].includes(requestType))
          targetCategoryName = "契約";
        else if (requestType === "purchase_order") targetCategoryName = "発注";
        else if (requestType === "delivery_inspec") targetCategoryName = "納品";
        else if (requestType === "sales_master") targetCategoryName = "売買";
        else if (requestType === "license_calc") targetCategoryName = "ライセンス";

        const matchedCategory = categories.find((c: any) => c.name === targetCategoryName);
        if (matchedCategory) categoryId = matchedCategory.id;
      }
    } catch (e) {
      console.warn("Failed to fetch issue types or categories, falling back", e);
    }

    const issueParams: any = {
      summary: `【${requestType}】${displaySummary}`,
      description: backlogDescription,
      issueTypeId,
      priorityId: 3,
      counterparty,
      dept,
      deadline,
      remarks: details,
    };
    if (categoryId) issueParams["categoryId[]"] = categoryId;

    const issue =
      input.existing_issue_key
        ? { issueKey: input.existing_issue_key, id: input.existing_issue_id }
        : await backlogService.createIssue(issueParams);

    await query(
      "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [issue.issueKey, user, requestType, counterparty, displaySummary, details]
    );

    if (requestType === "delivery_inspec") {
      await query(
        "INSERT INTO delivery_events (backlog_issue_key, delivery_no, status, inspection_deadline, delivered_at, delivered_amount) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          issue.issueKey,
          deliveryNo,
          "pending",
          inspectionDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          deliveryDate || new Date().toISOString(),
          parseFloat(orderAmount || "0"),
        ]
      );
    }

    await query(
      "INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name) VALUES ($1, $2, $3)",
      [issue.issueKey, requestType, "文書生成依頼"]
    );

    const deptRule = await query(
      `SELECT r.slack_channel_id
         FROM staff s
         JOIN department_workflow_rules r ON s.department = r.department
         WHERE s.slack_user_id = $1`,
      [user]
    );
    const deptChannel = deptRule.rows[0]?.slack_channel_id;

    const docNumber = await getNewDocumentNumber(templateType, requestType);

    const { html, fileName } = await documentService.generateDocument(
      {
        issueKey: issue.issueKey,
        documentNumber: docNumber,
        summary: displaySummary,
        requester: userName || user,
        date: new Date().toLocaleDateString("ja-JP"),
        details: {
          相談詳細: details,
          相手方: counterparty,
          counterparty,
          description: details || displaySummary,
          SlackユーザーID: user,
          VENDOR_NAME: counterparty,
          DELIVERY_NUMBER: deliveryNo ? String(deliveryNo) : "",
          deliveryDate: deliveryDate ? new Date(deliveryDate).toLocaleDateString("ja-JP") : "",
          inspectionDeadline: inspectionDeadline
            ? new Date(inspectionDeadline).toLocaleDateString("ja-JP")
            : "",
          orderAmountStr: orderAmount
            ? new Intl.NumberFormat("ja-JP").format(parseFloat(orderAmount))
            : "0",
          DOC_NO: docNumber,
        },
      },
      templateType
    );

    const driveLink = await googleDriveService.uploadHtml(html, fileName);

    await query(
      "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [docNumber, issue.issueKey, templateType, JSON.stringify(details), driveLink, user]
    );

    if (slackWebClient) {
      try {
        const userSettingsResult = await query(
          "SELECT value FROM app_settings WHERE key = 'slack_answer_back_user'"
        );
        const userTemplate =
          userSettingsResult.rows[0]?.value?.template ||
          `✅ 法務相談・文書作成の受付が完了しました。\n\n*種別:* {{requestType}}\n*課題キー:* {{issueKey}}\n*文書番号:* {{docNumber}}\n*生成ドキュメント:* {{driveLink}}\n\n法務担当者からの連絡をお待ちください。`;

        await slackWebClient.chat.postMessage({
          channel: user,
          text: replaceSlackPlaceholders(userTemplate, {
            requestType,
            issueKey: issue.issueKey,
            docNumber,
            driveLink,
            user,
            summary,
            counterparty,
          }),
        });

        if (deptChannel) {
          const chanSettingsResult = await query(
            "SELECT value FROM app_settings WHERE key = 'slack_answer_back_channel'"
          );
          const chanTemplate =
            chanSettingsResult.rows[0]?.value?.template ||
            `🆕 *新規依頼受付通知*\n\n<@{{user}}> さんより新規依頼 ({{requestType}}) を受け付けました。\n*課題:* {{issueKey}} ({{summary}})\n*相手方:* {{counterparty}}\n*生成ドキュメント:* {{driveLink}}`;

          await slackWebClient.chat.postMessage({
            channel: deptChannel,
            text: replaceSlackPlaceholders(chanTemplate, {
              requestType,
              issueKey: issue.issueKey,
              docNumber,
              driveLink,
              user,
              summary,
              counterparty,
            }),
          });
        }
      } catch (e) {
        console.warn("Slack notification failed (non-fatal):", e);
      }
    }

    return { issueKey: issue.issueKey, docNumber, driveLink };
  }

  // -------------------------------------------------------------------
  // /api/status
  // -------------------------------------------------------------------

  app.get("/api/status", (_req, res) => {
    res.json({
      service: "legalbridge-document-worker",
      status: "ok",
      role: "read-write",
      slackReady: !!slackWebClient,
      backlogReady: !!(process.env.BACKLOG_API_KEY && process.env.BACKLOG_HOST),
      timestamp: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------
  // /api/webhooks/backlog — Backlog → Cloud Run document pipeline
  // -------------------------------------------------------------------

  app.post("/api/webhooks/backlog", express.json(), async (req, res) => {
    const event = req.body;
    console.log("⚓ Backlog Webhook Received:", event.type);

    try {
      if (event.type === 1) {
        try {
          if (!event.project?.projectKey || !event.content?.key_id) {
            console.warn("Webhook type=1 missing projectKey or key_id; skipping.");
          } else {
            const issueKey = `${event.project.projectKey}-${event.content.key_id}`;

            const lr = await query(
              "SELECT id FROM legal_requests WHERE backlog_issue_key = $1",
              [issueKey]
            );
            if (lr.rowCount && lr.rowCount > 0) {
              await query(
                `UPDATE issue_workflows
                    SET current_status_name = $1
                  WHERE backlog_issue_key = $2`,
                ["受付済み", issueKey]
              );
              console.log(`✅ ${issueKey}: pipeline already ran via Slack intake; marked 受付済み.`);
            } else {
              const content = event.content;
              const typeName = content.issueType?.name || "";
              const requestType = ISSUE_TYPE_TO_REQUEST_TYPE[typeName] || "legal_consult";

              const cfMap: Record<string, any> = {};
              if (Array.isArray(content.customFields)) {
                content.customFields.forEach((cf: any) => {
                  if (cf && cf.id != null) cfMap[String(cf.id)] = cf.value;
                });
              }
              const cfBy = (envKey: string) => {
                const id = process.env[envKey];
                if (!id) return "";
                const v = cfMap[id];
                if (v == null) return "";
                if (typeof v === "object" && v.name) return v.name;
                return String(v);
              };

              const summary = content.summary || "";
              const description = content.description || "";

              const slackMatch = description.match(/<@([A-Z0-9]+)>/);
              const slackUserId = slackMatch ? slackMatch[1] : "";

              const input: LegalRequestSubmission = {
                slack_user_id: slackUserId,
                slack_user_name: event.createdUser?.name || "",
                dept: cfBy("BACKLOG_FIELD_DEPT") || "",
                request_type: requestType,
                summary: summary,
                deadline: cfBy("BACKLOG_FIELD_DEADLINE"),
                details: description,
                counterparty: cfBy("BACKLOG_FIELD_COUNTERPARTY"),
                entity_type: "corporate",
                entity_id: "",
                existing_issue_key: issueKey,
                existing_issue_id: content.id,
              };

              try {
                const result = await processLegalRequestSubmission(input);
                console.log(
                  `✅ Webhook pipeline completed for ${issueKey}: docNumber=${result.docNumber}`
                );
              } catch (pipelineErr) {
                console.error(
                  `❌ Webhook pipeline failed for ${issueKey}:`,
                  pipelineErr
                );
                if (slackWebClient && slackUserId) {
                  try {
                    await slackWebClient.chat.postMessage({
                      channel: slackUserId,
                      text: `⚠️ ${issueKey} の文書生成中にエラーが発生しました。法務担当者へ直接ご連絡ください。\n\n*エラー詳細:*\n\`\`\`\n${String(pipelineErr).slice(0, 1500)}\n\`\`\``,
                    });
                  } catch (_) {}
                }
              }
            }
          }
        } catch (e) {
          console.warn("Failed to process issue-created webhook:", e);
        }
      } else if (event.type === 2) {
        const issueKey = `${event.project.projectKey}-${event.content.key_id}`;
        const newStatus = event.content.status.name;

        await query(
          "UPDATE issue_workflows SET current_status_name = $1 WHERE backlog_issue_key = $2",
          [newStatus, issueKey]
        );

        if (newStatus === "完了" || event.content.status.id === 4) {
          try {
            const issue = await backlogService.getIssue(issueKey);
            if (issue.parentIssueId) {
              const children = await backlogService.getChildIssues(issue.parentIssueId);
              const allCompleted = children.every(
                (child: any) => child.status.name === "完了" || child.status.id === 4
              );

              if (allCompleted) {
                const parentIssue = await backlogService.getIssue(
                  issue.parentIssueId.toString()
                );
                await backlogService.updateIssueStatus(parentIssue.issueKey, 4);
                console.log(
                  `✅ Parent issue ${parentIssue.issueKey} auto-completed because all children are finished.`
                );
              }
            }
          } catch (e) {
            console.warn("Parent-child sync failed:", e);
          }
        }
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/backlog/* — write operations (status patch)
  // -------------------------------------------------------------------

  app.patch("/api/backlog/issues/:key/status", express.json(), async (req, res) => {
    try {
      const { key } = req.params;
      const { statusId } = req.body;
      const result = await backlogService.updateIssueStatus(key, statusId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/management/* — write operations
  // -------------------------------------------------------------------

  const checkAndNotifyLifecycle = async () => {
    try {
      const overdue = await query(
        "SELECT * FROM delivery_events WHERE status = 'pending' AND inspection_deadline < CURRENT_TIMESTAMP"
      );
      console.log(
        `📊 Lifecycle check: ${overdue.rowCount} overdue items found out of total.`
      );
      // Slack notification logic intentionally omitted; the worker logs
      // and operators can subscribe to Cloud Logging alerts.
    } catch (err) {
      console.error("Lifecycle monitoring failed:", err);
    }
  };

  setInterval(checkAndNotifyLifecycle, 3600000);

  app.post("/api/management/check-status-trigger", async (_req, res) => {
    await checkAndNotifyLifecycle();
    res.json({ success: true, message: "Manual check triggered" });
  });

  app.post("/api/management/link-asset", express.json(), async (req, res) => {
    const { type, issueKey, assetId } = req.body;
    try {
      if (type === "delivery") {
        await query(
          "UPDATE delivery_events SET linked_asset_id = $1 WHERE backlog_issue_key = $2",
          [assetId, issueKey]
        );
      } else if (type === "contract") {
        await query(
          "UPDATE license_contracts SET linked_asset_id = $1 WHERE backlog_issue_key = $2",
          [assetId, issueKey]
        );
      }
      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/management/assets", express.json(), async (req, res) => {
    const { asset_number, asset_name, asset_type, counterparty, file_link, start_date, end_date, backlog_issue_key } = req.body;
    try {
      const result = await query(
        `INSERT INTO external_assets (asset_number, asset_name, asset_type, counterparty, file_link, start_date, end_date, backlog_issue_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [asset_number, asset_name, asset_type, counterparty, file_link, start_date || null, end_date || null, backlog_issue_key]
      );
      res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/master/* — write operations
  // -------------------------------------------------------------------

  app.post("/api/master/app-settings", express.json(), async (req, res) => {
    try {
      const { settings } = req.body;
      for (const [key, value] of Object.entries(settings)) {
        await query(
          "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP",
          [key, JSON.stringify(value)]
        );
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/vendors", express.json(), async (req, res) => {
    // Accept a row payload with vendor_code uniqueness enforced.
    const v = req.body;
    try {
      await query(
        `INSERT INTO vendors (vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
          withholding_enabled, aliases, address, phone, email, contact_department, contact_name,
          master_contract_ref, bank_info, bank_name, branch_name, account_type, account_number,
          account_holder_kana, is_invoice_issuer, invoice_registration_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (vendor_code) DO UPDATE SET
           vendor_name = EXCLUDED.vendor_name,
           trade_name = EXCLUDED.trade_name,
           pen_name = EXCLUDED.pen_name,
           vendor_suffix = EXCLUDED.vendor_suffix,
           entity_type = EXCLUDED.entity_type,
           withholding_enabled = EXCLUDED.withholding_enabled,
           aliases = EXCLUDED.aliases,
           address = EXCLUDED.address,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           contact_department = EXCLUDED.contact_department,
           contact_name = EXCLUDED.contact_name,
           master_contract_ref = EXCLUDED.master_contract_ref,
           bank_info = EXCLUDED.bank_info,
           bank_name = EXCLUDED.bank_name,
           branch_name = EXCLUDED.branch_name,
           account_type = EXCLUDED.account_type,
           account_number = EXCLUDED.account_number,
           account_holder_kana = EXCLUDED.account_holder_kana,
           is_invoice_issuer = EXCLUDED.is_invoice_issuer,
           invoice_registration_number = EXCLUDED.invoice_registration_number`,
        [
          v.vendor_code, v.vendor_name, v.trade_name || null, v.pen_name || null,
          v.vendor_suffix || null, v.entity_type || null, v.withholding_enabled || false,
          v.aliases || null, v.address || null, v.phone || null, v.email || null,
          v.contact_department || null, v.contact_name || null, v.master_contract_ref || null,
          v.bank_info || null, v.bank_name || null, v.branch_name || null, v.account_type || null,
          v.account_number || null, v.account_holder_kana || null, v.is_invoice_issuer || false,
          v.invoice_registration_number || null,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post(
    "/api/master/vendors/upload-change-request",
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }
        const vendorCode = req.body.vendor_code;
        const fileName = `変更届_${vendorCode}_${Date.now()}_${req.file.originalname}`;

        const stream = Readable.from(req.file.buffer);
        const driveLink = await googleDriveService.uploadFile(
          stream,
          fileName,
          req.file.mimetype
        );

        res.json({ success: true, driveLink });
      } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.post("/api/master/staff", express.json(), async (req, res) => {
    const { slack_user_id, staff_name, email, phone, department, department_code } = req.body;
    try {
      await query(
        `INSERT INTO staff (slack_user_id, staff_name, email, phone, department, department_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slack_user_id) DO UPDATE SET
         staff_name = EXCLUDED.staff_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
         department = EXCLUDED.department, department_code = EXCLUDED.department_code`,
        [slack_user_id, staff_name, email, phone, department, department_code]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/contracts", express.json(), async (req, res) => {
    const {
      vendor_id, record_type, contract_category, contract_type, contract_title,
      document_number, contract_status, effective_date, expiration_date, auto_renewal,
      original_work, product_name, work_name, media, territory, language, document_url, condition_number,
    } = req.body;
    try {
      const result = await query(
        `INSERT INTO contract_capabilities (
          vendor_id, record_type, contract_category, contract_type, contract_title,
          document_number, contract_status, effective_date, expiration_date, auto_renewal,
          original_work, product_name, work_name, media, territory, language, document_url, condition_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id`,
        [
          vendor_id || null, record_type || "master_contract", contract_category || "service",
          contract_type || "service_basic", contract_title, document_number,
          contract_status || "executed", effective_date || null, expiration_date || null,
          auto_renewal || false, original_work || "", product_name || "", work_name || "",
          media || "", territory || "", language || "", document_url || "", condition_number || "",
        ]
      );
      res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.put("/api/master/contracts/:id", express.json(), async (req, res) => {
    const { id } = req.params;
    const {
      vendor_id, record_type, contract_category, contract_type, contract_title,
      document_number, contract_status, effective_date, expiration_date, auto_renewal,
      original_work, product_name, work_name, media, territory, language, document_url, condition_number,
    } = req.body;
    try {
      await query(
        `UPDATE contract_capabilities SET
          vendor_id = $1, record_type = $2, contract_category = $3, contract_type = $4,
          contract_title = $5, document_number = $6, contract_status = $7,
          effective_date = $8, expiration_date = $9, auto_renewal = $10,
          original_work = $11, product_name = $12, work_name = $13, media = $14,
          territory = $15, language = $16, document_url = $17, condition_number = $18,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $19`,
        [
          vendor_id || null, record_type, contract_category, contract_type, contract_title,
          document_number, contract_status, effective_date || null, expiration_date || null,
          auto_renewal, original_work || "", product_name || "", work_name || "",
          media || "", territory || "", language || "", document_url || "", condition_number || "",
          id,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete("/api/master/contracts/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await query("DELETE FROM contract_capabilities WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/rules", express.json(), async (req, res) => {
    const { department, approver_slack_id, stamp_operator_slack_id, manager_slack_id, slack_channel_id, is_active } = req.body;
    try {
      await query(
        `INSERT INTO department_workflow_rules (department, approver_slack_id, stamp_operator_slack_id, manager_slack_id, slack_channel_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (department) DO UPDATE SET
         approver_slack_id = EXCLUDED.approver_slack_id, stamp_operator_slack_id = EXCLUDED.stamp_operator_slack_id,
         manager_slack_id = EXCLUDED.manager_slack_id, slack_channel_id = EXCLUDED.slack_channel_id, is_active = EXCLUDED.is_active`,
        [department, approver_slack_id, stamp_operator_slack_id, manager_slack_id, slack_channel_id, is_active]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/numbering/next — writes to document_sequences via getNewDocumentNumber
  // -------------------------------------------------------------------

  app.get("/api/numbering/next", async (req, res) => {
    const { type, issueTypeName } = req.query;
    try {
      const number = await getNewDocumentNumber(
        String(type),
        issueTypeName ? String(issueTypeName) : undefined
      );
      res.json({ number });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/order-items/* + /api/order-line-items/* (Phase 4b)
  //
  // 発注書の明細レコード CRUD + 検収可能量チェック。
  // PO ヘッダは既存の order_items にぶら下がる。
  // 検収書側ガード (`/api/inspections/preview`) は overflow チェックで
  // 「これから書こうとしている検収明細」が発注額を超えないか事前確認。
  // -------------------------------------------------------------------

  /**
   * PO 全体（ヘッダ + 全明細 + 検収状況サマリ）を取得する。
   * フロント側で発注書を選んだとき、検収書フォームに既存値を
   * 流し込むために使う。
   */
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

      // 各明細の検収累計も同時に返す（フロントで残量バッジを描くため）
      const linesWithAvail = await Promise.all(
        lines.rows.map(async (line: any) => {
          const av = await getInspectionAvailability(line.id);
          return { ...line, inspection: av };
        })
      );

      res.json({
        order_item: orderItem,
        line_items: linesWithAvail,
      });
    } catch (error) {
      console.error("/api/order-items/by-issue failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * PO の明細を一括 upsert する（フロントの明細編集 UI から）。
   * リクエスト body:
   *   {
   *     tax_rate: 10,
   *     lines: [
   *       { line_no: 1, item_name, spec, unit_price, quantity,
   *         payment_method, payment_date },
   *       ...
   *     ]
   *   }
   * 既存明細は line_no が重複したら更新、それ以外は INSERT。
   * 送信されなかった line_no は削除。
   * 最後に order_items の総額を recalculateOrderTotal で書き戻し。
   */
  app.post("/api/order-items/:id/line-items", express.json(), async (req, res) => {
    try {
      const orderItemId = Number(req.params.id);
      const taxRate = Number(req.body.tax_rate) || 10;
      const lines: Array<any> = Array.isArray(req.body.lines) ? req.body.lines : [];

      // 計算
      const computedLines = lines.map((l) => ({
        line_no: Number(l.line_no),
        item_name: l.item_name || "",
        spec: l.spec || "",
        unit_price: Number(l.unit_price) || 0,
        quantity: Number(l.quantity) || 0,
        amount_ex_tax: calculateOrderLineAmount(
          Number(l.unit_price) || 0,
          Number(l.quantity) || 0
        ),
        payment_method: l.payment_method || null,
        payment_date: l.payment_date || null,
      }));

      // 送信された line_no 一覧 → これ以外は削除
      const keepNos = computedLines.map((l) => l.line_no).filter((n) => n > 0);
      if (keepNos.length > 0) {
        await query(
          `DELETE FROM order_line_items
            WHERE order_item_id = $1
              AND line_no NOT IN (${keepNos.map((_, i) => `$${i + 2}`).join(",")})`,
          [orderItemId, ...keepNos]
        );
      } else {
        await query("DELETE FROM order_line_items WHERE order_item_id = $1", [orderItemId]);
      }

      // upsert
      for (const l of computedLines) {
        await query(
          `INSERT INTO order_line_items (
             order_item_id, line_no, item_name, spec,
             unit_price, quantity, amount_ex_tax,
             payment_method, payment_date, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
           ON CONFLICT (order_item_id, line_no) DO UPDATE SET
             item_name      = EXCLUDED.item_name,
             spec           = EXCLUDED.spec,
             unit_price     = EXCLUDED.unit_price,
             quantity       = EXCLUDED.quantity,
             amount_ex_tax  = EXCLUDED.amount_ex_tax,
             payment_method = EXCLUDED.payment_method,
             payment_date   = EXCLUDED.payment_date,
             updated_at     = CURRENT_TIMESTAMP`,
          [
            orderItemId,
            l.line_no,
            l.item_name,
            l.spec,
            l.unit_price,
            l.quantity,
            l.amount_ex_tax,
            l.payment_method,
            l.payment_date,
          ]
        );
      }

      const totals = await recalculateOrderTotal(orderItemId, taxRate);
      res.json({ success: true, totals, line_count: computedLines.length });
    } catch (error) {
      console.error("/api/order-items/:id/line-items failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * 単一の PO 明細について、発注 vs 累計検収の availability を返す。
   * フロントで検収数量を入れるたびにこれを叩いて残量を可視化する用途。
   */
  app.get("/api/order-line-items/:id/availability", async (req, res) => {
    try {
      const availability = await getInspectionAvailability(Number(req.params.id));
      res.json(availability);
    } catch (error) {
      console.error("/api/order-line-items/:id/availability failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * 検収書の事前 overflow チェック。検収書を確定保存する前に必ず叩く。
   * body:
   *   {
   *     lines: [
   *       { order_line_item_id, inspected_quantity, acceptance_ratio }
   *     ]
   *   }
   * 1 件でも will_overflow_* が true なら、フロントは送信ボタンを
   * 無効化し warning を出す。
   */
  app.post("/api/inspections/preview", express.json(), async (req, res) => {
    try {
      const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
      const result = await previewInspectionOverflow(lines);
      const overflowExists = result.some(
        (r) => r.will_overflow_amount || r.will_overflow_quantity
      );
      res.json({ ok: !overflowExists, lines: result });
    } catch (error) {
      console.error("/api/inspections/preview failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * 検収書の明細を保存する。送信時に再度 overflow チェックを行い、
   * 発注額/数量を超えたら HTTP 400 で拒否する (二重防衛)。
   * body:
   *   {
   *     delivery_event_id: ...,
   *     lines: [
   *       { order_line_item_id, inspected_quantity, acceptance_ratio,
   *         rejection_reason }
   *     ]
   *   }
   * 既存の同じ (delivery_event_id, order_line_item_id) は上書き。
   */
  app.post(
    "/api/delivery-events/:id/line-items",
    express.json(),
    async (req, res) => {
      try {
        const deliveryEventId = Number(req.params.id);
        const lines = Array.isArray(req.body.lines) ? req.body.lines : [];

        // overflow 二重チェック (フロントを信用しない)
        const preview = await previewInspectionOverflow(
          lines.map((l: any) => ({
            order_line_item_id: Number(l.order_line_item_id),
            inspected_quantity: Number(l.inspected_quantity) || 0,
            acceptance_ratio:
              l.acceptance_ratio == null ? 1.0 : Number(l.acceptance_ratio),
          }))
        );
        const blocking = preview.filter(
          (p) => p.will_overflow_amount || p.will_overflow_quantity
        );
        if (blocking.length > 0) {
          return res.status(400).json({
            ok: false,
            error: "Inspection would exceed ordered amount/quantity.",
            blocking,
          });
        }

        for (const l of lines) {
          const orderLineId = Number(l.order_line_item_id);
          const qty = Number(l.inspected_quantity) || 0;
          const ratio =
            l.acceptance_ratio == null ? 1.0 : Number(l.acceptance_ratio);

          // unit_price を引いて金額計算
          const unitRes = await query(
            "SELECT unit_price FROM order_line_items WHERE id = $1",
            [orderLineId]
          );
          const unitPrice = Number(unitRes.rows[0]?.unit_price) || 0;
          const amount = calculateInspectedAmount(unitPrice, qty, ratio);

          await query(
            `INSERT INTO delivery_line_items (
               delivery_event_id, order_line_item_id, inspected_quantity,
               acceptance_ratio, inspected_amount_ex_tax, rejection_reason
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (delivery_event_id, order_line_item_id) DO UPDATE SET
               inspected_quantity = EXCLUDED.inspected_quantity,
               acceptance_ratio = EXCLUDED.acceptance_ratio,
               inspected_amount_ex_tax = EXCLUDED.inspected_amount_ex_tax,
               rejection_reason = EXCLUDED.rejection_reason`,
            [
              deliveryEventId,
              orderLineId,
              qty,
              ratio,
              amount,
              l.rejection_reason || null,
            ]
          );
        }

        res.json({ ok: true, line_count: lines.length });
      } catch (error) {
        console.error("/api/delivery-events/:id/line-items failed:", error);
        res.status(500).json({ error: String(error) });
      }
    }
  );

  // -------------------------------------------------------------------
  // /api/license-contracts/* + /api/royalty-calculations/* (Phase 5b)
  //
  // 個別利用許諾条件書 ↔ 利用許諾料計算書 の連動 API。発注書↔検収書と
  // 同じ構造:
  //   - 金銭条件 (= 発注明細) を CRUD する write エンドポイント
  //   - 計算書を preview / save する MG 消化チェック付きエンドポイント
  //   - MG ステータスの即時取得
  // -------------------------------------------------------------------

  /**
   * ライセンス契約全体 (ヘッダ + 全金銭条件 + MG 消化サマリ) を返す。
   * 利用許諾料計算書フォームを開くときに叩く。
   */
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

      const mgStatus = await getLicenseMgStatus(lc.id);

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
   * 金銭条件を一括 upsert (1〜3 件)。
   * body: { conditions: [{ condition_no, calc_method, rate_pct, ... }] }
   */
  app.post(
    "/api/license-contracts/:id/financial-conditions",
    express.json(),
    async (req, res) => {
      try {
        const lcId = Number(req.params.id);
        const conditions: Array<any> = Array.isArray(req.body.conditions)
          ? req.body.conditions
          : [];

        const keepNos = conditions
          .map((c) => Number(c.condition_no))
          .filter((n) => n > 0);
        if (keepNos.length > 0) {
          await query(
            `DELETE FROM license_financial_conditions
              WHERE license_contract_id = $1
                AND condition_no NOT IN (${keepNos.map((_, i) => `$${i + 2}`).join(",")})`,
            [lcId, ...keepNos]
          );
        } else {
          await query(
            "DELETE FROM license_financial_conditions WHERE license_contract_id = $1",
            [lcId]
          );
        }

        for (const c of conditions) {
          await query(
            `INSERT INTO license_financial_conditions (
               license_contract_id, condition_no,
               region_language_label, calc_method, rate_pct,
               base_price_label, calc_period, currency,
               formula_text, payment_terms, mg_amount, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
             ON CONFLICT (license_contract_id, condition_no) DO UPDATE SET
               region_language_label = EXCLUDED.region_language_label,
               calc_method           = EXCLUDED.calc_method,
               rate_pct              = EXCLUDED.rate_pct,
               base_price_label      = EXCLUDED.base_price_label,
               calc_period           = EXCLUDED.calc_period,
               currency              = EXCLUDED.currency,
               formula_text          = EXCLUDED.formula_text,
               payment_terms         = EXCLUDED.payment_terms,
               mg_amount             = EXCLUDED.mg_amount,
               updated_at            = CURRENT_TIMESTAMP`,
            [
              lcId,
              Number(c.condition_no),
              c.region_language_label || null,
              c.calc_method || null,
              c.rate_pct != null ? Number(c.rate_pct) : null,
              c.base_price_label || null,
              c.calc_period || null,
              c.currency || "JPY",
              c.formula_text || null,
              c.payment_terms || null,
              c.mg_amount != null ? Number(c.mg_amount) : 0,
            ]
          );
        }
        res.json({ success: true, count: conditions.length });
      } catch (error) {
        console.error(
          "/api/license-contracts/:id/financial-conditions failed:",
          error
        );
        res.status(500).json({ error: String(error) });
      }
    }
  );

  /**
   * 利用許諾料計算書を preview。MG 消化と税の試算を返す。
   * フロントは数量・サンプル数を変更するたびにこれを叩いて
   * リアルタイム計算表示する。
   */
  app.post("/api/royalty-calculations/preview", express.json(), async (req, res) => {
    try {
      const result = await previewRoyaltyCalculation({
        license_contract_id: Number(req.body.license_contract_id),
        license_financial_condition_id: Number(req.body.license_financial_condition_id),
        unit_price: Number(req.body.unit_price),
        quantity: Number(req.body.quantity),
        sample_quantity: Number(req.body.sample_quantity) || 0,
        tax_rate: req.body.tax_rate != null ? Number(req.body.tax_rate) : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("/api/royalty-calculations/preview failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * 利用許諾料計算書を確定保存する。サーバ側で再度 preview を実行し
   * 結果を royalty_calculations に書き込む (フロント送信値を信用しない)。
   */
  app.post("/api/royalty-calculations", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const computed = await previewRoyaltyCalculation({
        license_contract_id: Number(body.license_contract_id),
        license_financial_condition_id: Number(body.license_financial_condition_id),
        unit_price: Number(body.unit_price),
        quantity: Number(body.quantity),
        sample_quantity: Number(body.sample_quantity) || 0,
        tax_rate: body.tax_rate != null ? Number(body.tax_rate) : undefined,
      });

      const result = await query(
        `INSERT INTO royalty_calculations (
           backlog_issue_key, license_contract_id, license_financial_condition_id,
           manufacturing_event_id, calc_type,
           unit_price, quantity, sample_quantity, billable_quantity,
           rate_pct, gross_royalty_ex_tax,
           mg_amount, mg_consumed_before, mg_consumed_this_time,
           mg_consumed_after, mg_remaining, mg_fully_consumed,
           actual_royalty_ex_tax, tax_rate, tax_amount, total_payment_inc_tax,
           currency, period, reporting_deadline, payment_due_date, notes
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11,
           $12, $13, $14, $15, $16, $17,
           $18, $19, $20, $21,
           $22, $23, $24, $25, $26
         ) RETURNING id`,
        [
          body.backlog_issue_key || null,
          Number(body.license_contract_id),
          Number(body.license_financial_condition_id),
          body.manufacturing_event_id ? Number(body.manufacturing_event_id) : null,
          body.calc_type || "manufacturing",
          computed.unit_price,
          computed.quantity,
          computed.sample_quantity,
          computed.billable_quantity,
          computed.rate_pct,
          computed.gross_royalty_ex_tax,
          computed.mg_amount,
          computed.mg_consumed_before,
          computed.mg_consumed_this_time,
          computed.mg_consumed_after,
          computed.mg_remaining,
          computed.mg_fully_consumed,
          computed.actual_royalty_ex_tax,
          computed.tax_rate,
          computed.tax_amount,
          computed.total_payment_inc_tax,
          computed.currency,
          body.period || null,
          body.reporting_deadline || null,
          body.payment_due_date || null,
          body.notes || null,
        ]
      );
      res.json({ ok: true, id: result.rows[0].id, computed });
    } catch (error) {
      console.error("/api/royalty-calculations failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/documents/* — generation / preview / export (Phase 2d-2 batch A)
  // -------------------------------------------------------------------

  app.post("/api/documents/preview", express.json(), async (req, res) => {
    try {
      const { templateType, formData, issueKey, requesterEmail } = req.body;

      const { html, fileName } = await documentService.generateDocument(
        {
          issueKey: issueKey || "PREVIEW-000",
          documentNumber: "PREVIEW-" + Date.now(),
          summary: "Live Preview",
          requester: requesterEmail || "User",
          date: new Date().toLocaleDateString("ja-JP"),
          details: {
            ...formData,
            isLivePreview: true,
          },
        },
        templateType
      );

      res.json({ success: true, html, fileName });
    } catch (error) {
      console.error("Preview failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/documents/export-excel", express.json(), async (req, res) => {
    try {
      const data = req.body;
      const buffer = excelService.generateInspectionExcel(data);

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=inspection_${Date.now()}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      console.error("Excel export error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/documents/generate", express.json(), async (req, res) => {
    let { issueKey, templateType, formData, requesterEmail, nextStatusId } = req.body;

    try {
      const issue = await backlogService.getIssue(issueKey);
      const docNumber = await getNewDocumentNumber(templateType, issue.issueType.name);

      // Auto-advance Backlog status if a next_status_id is configured.
      if (!nextStatusId) {
        const wsResult = await query(
          "SELECT next_status_id FROM workflow_settings WHERE issue_type_name = $1",
          [issue.issueType.name]
        );
        if (wsResult.rows[0]?.next_status_id) {
          nextStatusId = wsResult.rows[0].next_status_id;
          console.log(
            `📡 Auto-Advance: Found next_status_id ${nextStatusId} for issue type ${issue.issueType.name}`
          );
        }
      }
      if (nextStatusId) {
        try {
          await backlogService.updateIssueStatus(issueKey, nextStatusId);
        } catch (statusError) {
          console.warn("Failed to update status, continuing...", statusError);
        }
      }

      // Auto-discover parent PO number for inspection-certificate templates.
      let parentOrderNumber = "";
      if (templateType.includes("inspection")) {
        const poResult = await query(
          "SELECT document_number FROM documents WHERE issue_key = $1 AND template_type LIKE '%purchase_order%' ORDER BY created_at DESC LIMIT 1",
          [issueKey]
        );
        if (poResult.rows.length > 0) {
          parentOrderNumber = poResult.rows[0].document_number;
        }
      }

      // Enrich context with staff info if a known requester is supplied.
      let staffInfo: any = {};
      if (requesterEmail) {
        const staffResult = await query(
          "SELECT * FROM staff WHERE email = $1 OR slack_user_id = $1 LIMIT 1",
          [requesterEmail]
        );
        if (staffResult.rows.length > 0) {
          const s = staffResult.rows[0];
          staffInfo = {
            STAFF_NAME: s.staff_name,
            STAFF_DEPARTMENT: s.department,
            STAFF_EMAIL: s.email,
            STAFF_PHONE: s.phone,
          };
        }
      }

      const { html, fileName } = await documentService.generateDocument(
        {
          issueKey,
          documentNumber: docNumber,
          summary: issue.summary,
          requester: requesterEmail || "Legal Department",
          date: new Date().toLocaleDateString("ja-JP"),
          details: {
            ...staffInfo,
            ...formData,
            DOC_NO: docNumber,
            ORDER_NO: formData.orderNumber || parentOrderNumber || issueKey,
            hasChangeLogs: !!formData.CHANGE_RECORDS,
            changeLogs: formData.CHANGE_RECORDS
              ? formData.CHANGE_RECORDS.split(";").map((log: string) => {
                  const [changedAt, fieldLabel, beforeValue, afterValue, reason] = log.split("|");
                  return { changedAt, fieldLabel, beforeValue, afterValue, reason };
                })
              : [],
          },
        },
        templateType
      );

      const driveLink = await googleDriveService.uploadHtml(html, fileName);

      await query(
        "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          docNumber,
          issueKey,
          templateType,
          JSON.stringify(formData),
          driveLink,
          requesterEmail || "legal_user",
        ]
      );

      await query(
        `INSERT INTO external_assets
         (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (asset_number) DO UPDATE SET file_link = EXCLUDED.file_link`,
        [
          docNumber,
          issue.summary,
          templateType.includes("purchase_order") ? "individual" : "contract",
          formData.VENDOR_NAME || formData.PARTY_B_NAME || "Internal",
          driveLink,
          issueKey,
        ]
      );

      // Mirror as a contract_capability row so the contract-check API
      // surfaces newly-generated docs.
      try {
        let vendorId = null;
        const vendorCode = formData.VENDOR_CODE || formData.vendorCode || "";
        const vendorName =
          formData.VENDOR_NAME || formData.PARTY_B_NAME || formData.partyBName || "";
        if (vendorCode || vendorName) {
          const vRes = await query(
            "SELECT id FROM vendors WHERE vendor_code = $1 OR vendor_name = $2 LIMIT 1",
            [vendorCode, vendorName]
          );
          if (vRes.rows.length > 0) {
            vendorId = vRes.rows[0].id;
          }
        }

        let recordType = "master_contract";
        if (
          templateType.includes("license") ||
          templateType.includes("royalty") ||
          templateType.includes("fee_statement")
        ) {
          recordType = "license_condition";
        } else if (
          templateType.includes("purchase_order") ||
          templateType.includes("inspection")
        ) {
          recordType = "individual_contract";
        }

        await query(
          `INSERT INTO contract_capabilities (
            vendor_id, record_type, contract_category, contract_type, contract_title,
            document_number, contract_status, effective_date, expiration_date, auto_renewal,
            original_work, product_name, work_name, media, territory, language, document_url, source_system
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (document_number) DO UPDATE SET
            vendor_id = EXCLUDED.vendor_id,
            record_type = EXCLUDED.record_type,
            contract_category = EXCLUDED.contract_category,
            contract_type = EXCLUDED.contract_type,
            contract_title = EXCLUDED.contract_title,
            contract_status = EXCLUDED.contract_status,
            effective_date = EXCLUDED.effective_date,
            expiration_date = EXCLUDED.expiration_date,
            auto_renewal = EXCLUDED.auto_renewal,
            original_work = EXCLUDED.original_work,
            product_name = EXCLUDED.product_name,
            work_name = EXCLUDED.work_name,
            media = EXCLUDED.media,
            territory = EXCLUDED.territory,
            language = EXCLUDED.language,
            document_url = EXCLUDED.document_url,
            updated_at = CURRENT_TIMESTAMP`,
          [
            vendorId,
            recordType,
            templateType.includes("license") ? "license" : "service",
            templateType,
            formData.CONTRACT_TITLE || formData.contract_title || issue.summary,
            docNumber,
            "executed",
            formData.EFFECTIVE_DATE || formData.effectiveDate || null,
            formData.EXPIRATION_DATE || formData.expirationDate || null,
            formData.AUTO_RENEWAL === "true" || formData.AUTO_RENEWAL === true || false,
            formData.ORIGINAL_WORK || formData.originalWork || "",
            formData.PRODUCT_NAME || formData.productName || "",
            formData.WORK_NAME || formData.workName || "",
            formData.MEDIA || formData.media || "",
            formData.TERRITORY || formData.territory || "",
            formData.LANGUAGE || formData.language || "",
            driveLink,
            "App Document Generator",
          ]
        );
        console.log(`✅ Sync to contract_capabilities successful for: ${docNumber}`);
      } catch (ccErr) {
        console.warn(
          `⚠️ Failed to sync generated document to contract_capabilities:`,
          ccErr
        );
      }

      // Operational tables: orders / deliveries / license / royalties.
      if (templateType.includes("purchase_order")) {
        await query(
          "INSERT INTO order_items (backlog_issue_key, description, amount, vendor_code, spec) VALUES ($1, $2, $3, $4, $5)",
          [
            issueKey,
            formData.description || issue.summary,
            formData.amount || 0,
            formData.vendorCode || "",
            formData.spec || "",
          ]
        );
      } else if (templateType.includes("inspection")) {
        const orderRes = await query(
          "SELECT id FROM order_items WHERE backlog_issue_key = $1 LIMIT 1",
          [issueKey]
        );
        if (orderRes.rows.length > 0) {
          await query(
            "INSERT INTO delivery_events (order_item_id, backlog_issue_key, delivered_amount, delivery_no, delivered_at) VALUES ($1, $2, $3, $4, $5)",
            [
              orderRes.rows[0].id,
              issueKey,
              formData.deliveredAmount || formData.amount || 0,
              1,
              new Date(),
            ]
          );
        }
      }

      await query(
        "UPDATE issue_workflows SET current_status_name = $1, document_draft = $2, updated_at = CURRENT_TIMESTAMP WHERE backlog_issue_key = $3",
        ["草案", driveLink, issueKey]
      );

      try {
        await backlogService.updateIssue(issueKey, { docNumber });
        console.log(
          `✅ Backlog issue ${issueKey} updated with Document Number: ${docNumber}`
        );
      } catch (backlogError) {
        console.warn(
          `⚠️ Failed to update Backlog issue ${issueKey} with document number:`,
          backlogError
        );
      }

      // Lifecycle event sync (purchase_order / inspection / license / royalty).
      if (
        templateType.includes("purchase_order") ||
        templateType === "planning_purchase_order"
      ) {
        const lrResult = await query(
          "INSERT INTO legal_requests (backlog_issue_key, counterparty, summary) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO UPDATE SET counterparty = EXCLUDED.counterparty RETURNING id",
          [issueKey, formData.VENDOR_NAME || formData.PARTY_B_NAME, issue.summary]
        );
        const lrId = lrResult.rows[0].id;
        const amount = parseFloat(
          (formData.ORDER_AMOUNT || formData.TOTAL_AMOUNT || "0").replace(/,/g, "")
        );
        const orderItemRes = await query(
          `INSERT INTO order_items (legal_request_id, item_no, vendor_code, description, amount, due_date, backlog_issue_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (backlog_issue_key) DO UPDATE SET
           amount = EXCLUDED.amount,
           due_date = EXCLUDED.due_date,
           description = EXCLUDED.description
           RETURNING id`,
          [
            lrId,
            1,
            formData.VENDOR_CODE || "UNKNOWN",
            formData.summary || issue.summary,
            amount,
            formData.DELIVERY_DATE || formData.due_date || null,
            issueKey,
          ]
        );
        const orderItemId = orderItemRes.rows[0]?.id;

        // Phase 7b: 発注書フォームから items[] が送信されていれば
        // order_line_items を upsert し, recalculateOrderTotal で
        // ヘッダ総額を「明細合計」と整合させる。
        if (orderItemId && Array.isArray(formData.items) && formData.items.length > 0) {
          const taxRate = Number(formData.taxRate) || 10;
          const incomingLines = formData.items as Array<any>;
          const keepNos = incomingLines
            .map((l, i) => Number(l.line_no) || i + 1)
            .filter((n) => n > 0);

          if (keepNos.length > 0) {
            await query(
              `DELETE FROM order_line_items
                WHERE order_item_id = $1
                  AND line_no NOT IN (${keepNos.map((_, i) => `$${i + 2}`).join(",")})`,
              [orderItemId, ...keepNos]
            );
          }

          for (let i = 0; i < incomingLines.length; i++) {
            const l = incomingLines[i];
            const lineNo = Number(l.line_no) || i + 1;
            const unit = Number(l.unit_price) || 0;
            const qty = Number(l.quantity) || 0;
            const lineAmt = calculateOrderLineAmount(unit, qty);
            await query(
              `INSERT INTO order_line_items (
                 order_item_id, line_no, item_name, spec,
                 unit_price, quantity, amount_ex_tax,
                 payment_method, payment_date, updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
               ON CONFLICT (order_item_id, line_no) DO UPDATE SET
                 item_name      = EXCLUDED.item_name,
                 spec           = EXCLUDED.spec,
                 unit_price     = EXCLUDED.unit_price,
                 quantity       = EXCLUDED.quantity,
                 amount_ex_tax  = EXCLUDED.amount_ex_tax,
                 payment_method = EXCLUDED.payment_method,
                 payment_date   = EXCLUDED.payment_date,
                 updated_at     = CURRENT_TIMESTAMP`,
              [
                orderItemId,
                lineNo,
                l.item_name || "",
                l.spec || "",
                unit,
                qty,
                lineAmt,
                l.payment_method || null,
                l.payment_date || null,
              ]
            );
          }
          await recalculateOrderTotal(orderItemId, taxRate);
        }
      } else if (templateType.includes("inspection")) {
        await query(
          "INSERT INTO legal_requests (backlog_issue_key, counterparty, summary) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO NOTHING",
          [issueKey, formData.counterparty || formData.PARTY_B_NAME, issue.summary]
        );
        const orderItemResult = await query(
          "SELECT id FROM order_items WHERE backlog_issue_key = $1",
          [issueKey]
        );
        const orderItemId = orderItemResult.rows[0]?.id || null;
        await query(
          "INSERT INTO delivery_events (backlog_issue_key, order_item_id, delivered_at, inspection_deadline, status, note) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (backlog_issue_key) DO UPDATE SET inspection_deadline = EXCLUDED.inspection_deadline, status = EXCLUDED.status",
          [
            issueKey,
            orderItemId,
            new Date(),
            formData.inspectionDeadline || null,
            "pending",
            formData.REMARKS || "",
          ]
        );
      } else if (templateType === "license_master") {
        await query(
          `INSERT INTO license_contracts (backlog_issue_key, ledger_id, ledger_number, licensor, original_work)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (backlog_issue_key) DO UPDATE SET
           ledger_number = EXCLUDED.ledger_number,
           licensor = EXCLUDED.licensor,
           original_work = EXCLUDED.original_work`,
          [
            issueKey,
            formData.ledgerId || docNumber,
            docNumber,
            formData.LICENSOR_NAME || formData.PARTY_B_NAME,
            formData.WORK_TITLE,
          ]
        );
      } else if (templateType === "lic_individual") {
        await query(
          `UPDATE license_contracts SET contract_number = $1 WHERE backlog_issue_key = $2`,
          [docNumber, issueKey]
        );
      } else if (templateType === "royalty_statement") {
        await query(
          "INSERT INTO royalty_payments (backlog_issue_key, total_amount, period, status) VALUES ($1, $2, $3, $4)",
          [
            issueKey,
            parseFloat((formData.royaltyTotal || "0").replace(/,/g, "")),
            formData.period || new Date().toISOString().slice(0, 7),
            "calculated",
          ]
        );
      }

      // Slack notification with the Drive link.
      if (slackWebClient) {
        try {
          const settingsResult = await query(
            "SELECT value FROM app_settings WHERE key = 'slack_document_generated'"
          );
          const template =
            settingsResult.rows[0]?.value?.template ||
            `📄 *ドキュメントが作成されました*\n\n*課題:* {{issueKey}} ({{summary}})\n*タイプ:* {{type}}\n*リンク:* {{link}}`;

          const message = template
            .replace(/{{issueKey}}/g, issueKey)
            .replace(/{{summary}}/g, issue.summary || "")
            .replace(/{{type}}/g, templateType)
            .replace(/{{link}}/g, driveLink);

          const slackIdMatch =
            issue.description && issue.description.match(/<@([A-Z0-9]+)>/);
          const targetChannel = slackIdMatch
            ? slackIdMatch[1]
            : process.env.SLACK_NOTIFY_CHANNEL || "general";

          await slackWebClient.chat.postMessage({
            channel: targetChannel,
            text: message,
          });
        } catch (slackErr) {
          console.warn("Slack notification failed (non-fatal):", slackErr);
        }
      }

      res.json({ success: true, driveLink });
    } catch (error) {
      console.error("Error in /api/documents/generate:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/test-generate", async (req, res) => {
    try {
      const type = (req.query.type as any) || "legal_request";

      let demoData: any = {
        issueKey: "DEMO-123",
        summary: "サンプル案件",
        requester: "AI Studio User",
        date: new Date().toLocaleDateString("ja-JP"),
        details: {
          CONTRACT_NO: "LB-2026-001",
          CONTRACT_DATE_FORMATTED: "2026年4月16日",
          PARTY_B_NAME: "サンプル株式会社",
          PARTY_B_ADDRESS: "東京都千代田区...",
          PARTY_B_REPRESENTATIVE: "代表取締役 山田 太郎",
          VENDOR_NAME: "サンプル株式会社",
          VENDOR_ADDRESS: "東京都千代田区...",
          ORDER_NO: "PO-2026-001",
          ORDER_DATE: "2026/04/16",
          DELIVERY_DATE: "2026/05/31",
          TOTAL_AMOUNT: "1,100,000",
          TAX_AMOUNT: "100,000",
          SUBTOTAL: "1,000,000",
          PURPOSE: "新規事業開発に関する技術情報の共有",
          DURATION: "本契約締結日から3年間",
          GOVERNING_LAW: "日本法",
          JURISDICTION: "東京地方裁判所",
        } as any,
      };

      if (type === "purchase_order") {
        demoData.summary = "ノートPC 5台セット";
        demoData.details = {
          ...demoData.details,
          VENDOR_NAME: "サンプルOA機器株式会社",
          ORDER_AMOUNT: "750,000",
          REMARKS: "納期：2026年5月末日",
        };
      } else if (type === "contract") {
        demoData.summary = "新規事業開発に関する秘密保持契約";
        demoData.details = {
          ...demoData.details,
          PARTY_B_NAME: "株式会社イノベーション・ラボ",
          PARTY_B_ADDRESS: "大阪府大阪市北区...",
          DURATION: "3年",
        };
      } else if (type === "nda") {
        demoData.summary = "NDA (秘密保持契約書)";
      } else if (type === "planning_purchase_order") {
        demoData.summary = "企画発注書";
      } else if (type === "payment_notice") {
        demoData.summary = "支払通知書";
      } else if (type === "fee_statement") {
        demoData.summary = "報酬明細書";
      } else if (type === "license_report") {
        demoData.summary = "ライセンス報告書";
      } else if (type === "sales_master_buyer") {
        demoData.summary = "売買基本契約書（買主側）";
      }

      demoData.documentNumber = `DEMO-${Date.now()}`;
      const { html, fileName } = await documentService.generateDocument(demoData, type);
      res.json({ html, fileName });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/test-generate-markdown", async (req, res) => {
    try {
      const type = (req.query.type as any) || "individual_license_terms";

      let demoData: any = {
        issueKey: "DEMO-123",
        summary: "サンプル案件",
        requester: "AI Studio User",
        date: new Date().toLocaleDateString("ja-JP"),
        details: {
          発行日: "2026/04/01",
          契約書番号: "C-ARC-DOM-LIC-202604001",
          台帳ID: "LIC-ARC-DOM-202604001",
          ライセンス種別名: "ボードゲーム国内・海外ライセンス",
          基本契約名: "ライセンス利用許諾基本契約書（2026/04/01締結）",
          licensor名: "高橋 宏佳",
          licensee名: "株式会社アークライト",
          許諾開始日: "2026/04/01",
          許諾期間注記: "基本契約の満了日まで。",
          原著作物名: "ボードゲーム『ダブルナイン』",
          原著作物補記: "原作および派生作品を含む",
          対象製品予定名: "『ダブルナイン』",
          素材番号: "LIC-01",
          素材名: "原作ボードゲーム",
          素材権利者: "高橋 宏佳",
          監修者: "高橋 宏佳",
          金銭条件1_計算式: "上代 × 5.0% × 製造数",
          金銭条件1_料率: "5.0%",
          金銭条件1_基準価格ラベル: "上代（MSRP）",
          金銭条件1_支払条件: "翌月20日",
          特記事項_本文: "特になし",
          licensor_住所: "東京都...",
          licensor_氏名会社名: "高橋 宏佳",
          licensee_住所: "東京都千代田区神田...",
          licensee_氏名会社名: "株式会社アークライト",
          licensee_代表者名: "代表取締役 金澤 利幸",
        },
      };

      const { html } = await documentService.generateDocument(demoData, type);
      const markdown = turndownService.turndown(html);
      res.json({ markdown, fileName: `sample_${type}.md` });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/templates/* — template file CRUD + schema/preview (Phase 2d-2 batch B)
  //
  // Templates live on the container filesystem at /app/templates (copied
  // in by the Dockerfile). Writes are session-local and disappear with
  // the revision; this matches admin-ui's behavior. Future work could
  // migrate templates to GCS or a DB table.
  // -------------------------------------------------------------------

  const templatesDir = path.join(process.cwd(), "templates");

  app.get("/api/templates", (_req, res) => {
    try {
      const files = fs.readdirSync(templatesDir);
      const htmlFiles = files
        .filter((f) => f.endsWith(".html"))
        .map((f) => f.replace(".html", ""));
      res.json(htmlFiles);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/:type", (req, res) => {
    try {
      const { type } = req.params;
      const filePath = path.join(templatesDir, `${type}.html`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        res.send(content);
      } else {
        res.status(404).send("Template not found");
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/templates/:type", express.json(), (req, res) => {
    try {
      const { type } = req.params;
      const { content } = req.body;
      fs.writeFileSync(path.join(templatesDir, `${type}.html`), content, "utf-8");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete("/api/templates/:type", (req, res) => {
    try {
      const { type } = req.params;
      const filePath = path.join(templatesDir, `${type}.html`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Template not found" });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/config/metadata", (_req, res) => {
    try {
      const configPath = path.join(process.cwd(), "templates_config.json");
      if (fs.existsSync(configPath)) {
        res.json(JSON.parse(fs.readFileSync(configPath, "utf-8")));
      } else {
        res.json({});
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/templates/config/metadata", express.json(), (req, res) => {
    try {
      const configPath = path.join(process.cwd(), "templates_config.json");
      fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/:type/schema", (req, res) => {
    try {
      const { type } = req.params;
      const variables = documentService.getTemplateVariables(type as any);
      res.json({ variables });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/:type/preview", (req, res) => {
    try {
      const { type } = req.params;
      const variables = documentService.getTemplateVariables(type as any);
      const dummyDetails: Record<string, string> = {};
      variables.forEach((v) => {
        dummyDetails[v] = `[${v}]`;
      });

      const html = documentService.renderHtml(
        {
          issueKey: "DEMO-123",
          summary: "DEMO ISSUE SUMMARY",
          requester: "DEMO USER",
          date: new Date().toLocaleDateString("ja-JP"),
          details: dummyDetails,
        },
        type as any
      );

      res.send(html);
    } catch (error) {
      res.status(500).send(String(error));
    }
  });

  // -------------------------------------------------------------------
  // /api/master/workflow-settings (Phase 2d-2 batch C)
  // -------------------------------------------------------------------

  app.get("/api/master/workflow-settings", async (_req, res) => {
    try {
      const result = await query(
        "SELECT * FROM workflow_settings ORDER BY issue_type_name ASC"
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/workflow-settings", express.json(), async (req, res) => {
    const {
      issue_type_name,
      allowed_templates,
      status_configs,
      variable_mappings,
      next_status_id,
      document_prefix,
    } = req.body;
    try {
      await query(
        `INSERT INTO workflow_settings (issue_type_name, allowed_templates, status_configs, variable_mappings, next_status_id, document_prefix)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (issue_type_name) DO UPDATE SET
         allowed_templates = EXCLUDED.allowed_templates,
         status_configs = EXCLUDED.status_configs,
         variable_mappings = EXCLUDED.variable_mappings,
         next_status_id = EXCLUDED.next_status_id,
         document_prefix = EXCLUDED.document_prefix,
         updated_at = CURRENT_TIMESTAMP`,
        [
          issue_type_name,
          JSON.stringify(allowed_templates || []),
          JSON.stringify(status_configs || {}),
          JSON.stringify(variable_mappings || {}),
          next_status_id,
          document_prefix,
        ]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/management/import-csv (Phase 2d-2 batch C)
  // -------------------------------------------------------------------

  app.post(
    "/api/management/import-csv",
    express.text({ limit: "50mb" }),
    async (req, res) => {
      const { mode } = req.query;
      try {
        let result;
        if (mode === "publishing") {
          result = await csvImportService.importPublishingBulk(req.body);
        } else if (mode === "vendor") {
          result = await csvImportService.importVendors(req.body);
        } else if (mode === "staff") {
          result = await csvImportService.importStaff(req.body);
        } else if (mode === "contract") {
          result = await csvImportService.importContracts(req.body);
        } else {
          result = await csvImportService.importGeneric(req.body);
        }

        // Notify Slack about bulk completion with delivery instructions.
        if (
          slackWebClient &&
          result.success &&
          (mode === "publishing" || mode === "generic")
        ) {
          const channelId = process.env.SLACK_CHANNEL_ID || "C0123456789";
          const settingsResult = await query(
            "SELECT value FROM app_settings WHERE key = 'slack_bulk_import_done'"
          );
          const template =
            settingsResult.rows[0]?.value?.template ||
            `📦 一括発注・検収登録が完了しました（件数: {{processedCount}}件）。\n\n【納品時のご案内】\n納品が発生した際は、ダウンロードされた結果CSVに「納品日（deliveredAt）」と「納品額（deliveredAmount）」を記入し、再度一括インポートを行うことで検収登録が可能です。`;
          const msg = template.replace(
            /{{processedCount}}/g,
            String(result.processedCount)
          );
          try {
            await slackWebClient.chat.postMessage({ channel: channelId, text: msg });
          } catch (slackErr) {
            console.warn("Bulk-import Slack notify failed (non-fatal):", slackErr);
          }
        }

        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.listen(PORT, () => {
    console.log(`[document-worker] listening on :${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal error starting document-worker:", err);
  process.exit(1);
});
