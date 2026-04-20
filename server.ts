import express from "express";
import { createServer as createViteServer } from "vite";
import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { BacklogService } from "./src/services/backlogService.ts";
import { DocumentService } from "./src/services/documentService.ts";
import type { DocumentType } from "./src/services/documentService.ts";
import { GoogleDriveService } from "./src/services/googleDriveService.ts";
import { pool, initDb, query, getNextSequenceValue } from "./src/lib/db.ts";
import { CsvImportService } from "./src/services/csvImportService.ts";

dotenv.config();

// Initialize PostgreSQL
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getNewDocumentNumber(type: string, issueTypeName?: string): Promise<string> {
  let prefix = "";
  
  if (issueTypeName) {
    const wsResult = await query("SELECT document_prefix FROM workflow_settings WHERE issue_type_name = $1", [issueTypeName]);
    if (wsResult.rows[0]?.document_prefix) {
      prefix = wsResult.rows[0].document_prefix;
    }
  }

  if (!prefix) {
    const typeCodes: Record<string, string> = {
      nda: "NDA",
      purchase_order: "PO",
      contract: "CTR",
      inspection_certificate: "INS",
      royalty_statement: "ROY",
      payment_notice: "PAY",
      legal_request: "REQ",
      service_master: "SRVP",
      license_master: "LIC",
      fee_statement: "FEE",
      asset: "AST",
      external_contract: "EXT",
      design: "DSG",
      spec: "SPC"
    };
    prefix = typeCodes[type] || type.toUpperCase().substring(0, 3);
  }

  const year = new Date().getFullYear();
  const sequenceKey = `${prefix}-${year}`;
  const val = await getNextSequenceValue(sequenceKey);
  return `${prefix}-${year}-${val.toString().padStart(4, "0")}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Simple request logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const backlogService = new BacklogService();
  const documentService = new DocumentService();
  const googleDriveService = new GoogleDriveService();
  const csvImportService = new CsvImportService();

  // Slack Setup
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  let slackApp: App | null = null;
  let receiver: ExpressReceiver | null = null;

  if (slackBotToken && slackSigningSecret) {
    receiver = new ExpressReceiver({
      signingSecret: slackSigningSecret,
      endpoints: {
        commands: "/slack/commands",
        actions: "/slack/interactions",
        events: "/slack/events",
      },
      processBeforeResponse: false,
    });

    slackApp = new App({
      token: slackBotToken,
      receiver,
      logLevel: LogLevel.INFO,
    });

    // --- Slack Helpers ---
    const getLegalRequestModal = (selectedType: string = "legal_consultation"): any => {
      const blocks: any[] = [
        {
          type: "input",
          block_id: "request_type_block",
          label: { type: "plain_text", text: "依頼種別 (Request Type)" },
          element: {
            type: "static_select",
            action_id: "request_type_input",
            initial_option: {
              text: { type: "plain_text", text: selectedType === "legal_consultation" ? "法務相談 (legal_consultation)" : 
                                       selectedType === "nda" ? "秘密保持契約 (nda)" :
                                       selectedType === "outsourcing" ? "業務委託基本契約 (outsourcing)" :
                                       selectedType === "license" ? "ライセンス契約 (license)" :
                                       selectedType === "purchase_order" ? "発注書 (purchase_order)" :
                                       selectedType === "delivery_request" ? "納品リクエスト (delivery_request)" :
                                       "利用許諾料計算 (royalty_calculation)" },
              value: selectedType
            },
            placeholder: { type: "plain_text", text: "種別を選択してください" },
            options: [
              { text: { type: "plain_text", text: "法務相談 (legal_consultation)" }, value: "legal_consultation" },
              { text: { type: "plain_text", text: "秘密保持契約 (nda)" }, value: "nda" },
              { text: { type: "plain_text", text: "業務委託基本契約 (outsourcing)" }, value: "outsourcing" },
              { text: { type: "plain_text", text: "ライセンス契約 (license)" }, value: "license" },
              { text: { type: "plain_text", text: "発注書 (purchase_order)" }, value: "purchase_order" },
              { text: { type: "plain_text", text: "納品リクエスト (delivery_request)" }, value: "delivery_request" },
              { text: { type: "plain_text", text: "利用許諾料計算 (royalty_calculation)" }, value: "royalty_calculation_sales_report" }
            ]
          }
        },
        {
          type: "input",
          block_id: "summary_block",
          label: { type: "plain_text", text: "件名" },
          element: { type: "plain_text_input", action_id: "summary_input", placeholder: { type: "plain_text", text: "例: 秘密保持契約の審査依頼" } }
        },
        {
          type: "input",
          block_id: "details_block",
          label: { type: "plain_text", text: "相談・依頼詳細" },
          element: { type: "plain_text_input", action_id: "details_input", multiline: true }
        },
        {
          type: "input",
          block_id: "counterparty_block",
          label: { type: "plain_text", text: "相手方企業名 / 関連キー" },
          element: { type: "plain_text_input", action_id: "counterparty_input" }
        }
      ];

      // Dynamic items for Delivery Request
      if (selectedType === "delivery_request") {
        blocks.push(
          {
            type: "divider"
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: "*検収書作成用データ*" }
          },
          {
            type: "input",
            block_id: "delivery_no_block",
            label: { type: "plain_text", text: "納品回数 (第 n 回納品)" },
            element: { type: "plain_text_input", action_id: "delivery_no_input", placeholder: { type: "plain_text", text: "1" }, initial_value: "1" }
          },
          {
            type: "input",
            block_id: "order_amount_block",
            label: { type: "plain_text", text: "金額（税抜）" },
            element: { type: "plain_text_input", action_id: "order_amount_input", placeholder: { type: "plain_text", text: "100000" } }
          },
          {
            type: "input",
            block_id: "delivery_date_block",
            label: { type: "plain_text", text: "納品日 (YYYY-MM-DD)" },
            element: { 
              type: "datepicker", 
              action_id: "delivery_date_input", 
              initial_date: new Date().toISOString().split('T')[0]
            }
          },
          {
            type: "input",
            block_id: "inspection_deadline_block",
            label: { type: "plain_text", text: "検収期限 (YYYY-MM-DD)" },
            element: { 
              type: "datepicker", 
              action_id: "inspection_deadline_input",
              initial_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            }
          }
        );
      }

      return {
        type: "modal",
        callback_id: "legal_request_modal",
        title: { type: "plain_text", text: "法務相談・契約審査" },
        blocks,
        submit: { type: "plain_text", text: "送信" }
      };
    };

    // --- Slack Handlers ---

    // 1. Command to open modal
    slackApp.command("/法務依頼", async ({ command, ack, client, body }) => {
      await ack();
      try {
        await client.views.open({
          trigger_id: body.trigger_id,
          view: getLegalRequestModal("legal_consultation")
        });
      } catch (error) {
        console.error("Error opening modal:", error);
      }
    });

    // Dynamic update based on selection
    slackApp.action("request_type_input", async ({ ack, body, client, action }) => {
      await ack();
      try {
        const selectedOption = (action as any).selected_option.value;
        await client.views.update({
          view_id: (body as any).view.id,
          hash: (body as any).view.hash,
          view: getLegalRequestModal(selectedOption)
        });
      } catch (error) {
        console.error("Error updating view:", error);
      }
    });

    // 2. Modal submission
    slackApp.view("legal_request_modal", async ({ ack, body, view, client }) => {
      await ack();
      
      const values = view.state.values;
      const requestType = values.request_type_block.request_type_input.selected_option?.value || "legal_consultation";
      const summary = values.summary_block.summary_input.value || "";
      const details = values.details_block.details_input.value || "";
      const counterparty = values.counterparty_block.counterparty_input.value || "";
      
      // Delivery specific values
      const deliveryNoRaw = values.delivery_no_block?.delivery_no_input?.value;
      const deliveryNo = deliveryNoRaw ? parseInt(deliveryNoRaw) : null;
      const orderAmount = values.order_amount_block?.order_amount_input?.value;
      const deliveryDate = values.delivery_date_block?.delivery_date_input?.selected_date;
      const inspectionDeadline = values.inspection_deadline_block?.inspection_deadline_input?.selected_date;
      
      const user = body.user.id;
      
      // Map Slack request type to initial Document Template Type
      let templateType: DocumentType = "legal_request";
      if (requestType === "delivery_request") {
        templateType = "inspection_certificate";
      } else if (requestType === "royalty_calculation_sales_report") {
        templateType = "royalty_statement";
      } else if (requestType === "purchase_order") {
        templateType = "purchase_order";
      } else if (requestType === "nda") {
        templateType = "nda";
      }

      try {
        const displaySummary = deliveryNo ? `${summary} (第${deliveryNo}回納品)` : summary;
        
        // Create Backlog Issue
        const issue = await backlogService.createIssue({
          summary: `【${requestType}】${displaySummary}`,
          description: `依頼タイプ: ${requestType}\n依頼者: <@${user}>\n相手方/キー: ${counterparty}\n納品回次: ${deliveryNo || "通常"}\n\n詳細:\n${details}`,
          issueTypeId: 1, 
          priorityId: 3, 
        });

        // Register in DB
        const lrResult = await query(
          "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [issue.issueKey, user, requestType, counterparty, displaySummary, details]
        );

        const legalRequestId = lrResult.rows[0].id;

        // If it's a delivery request, also record it in delivery_events
        if (requestType === "delivery_request") {
          await query(
            "INSERT INTO delivery_events (backlog_issue_key, delivery_no, status, inspection_deadline, delivered_at, delivered_amount) VALUES ($1, $2, $3, $4, $5, $6)",
            [issue.issueKey, deliveryNo, "pending", inspectionDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), deliveryDate || new Date(), parseFloat(orderAmount || "0")]
          );
        }

        await query(
          "INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name) VALUES ($1, $2, $3)",
          [issue.issueKey, requestType, "文書生成依頼"]
        );

        // We do this asynchronously to avoid blocking Slack
        (async () => {
          try {
            // Find target channel
            const deptRule = await query(
              `SELECT r.slack_channel_id 
               FROM staff s 
               JOIN department_workflow_rules r ON s.department = r.department 
               WHERE s.slack_user_id = $1`,
              [user]
            );
            const deptChannel = deptRule.rows[0]?.slack_channel_id;

            const docNumber = await getNewDocumentNumber(templateType, requestType);

            // Generate Initial Document based on predicted flow
            const { html, fileName } = await documentService.generateDocument({
              issueKey: issue.issueKey,
              documentNumber: docNumber,
              summary: displaySummary,
              requester: body.user.name || user,
              date: new Date().toLocaleDateString("ja-JP"),
              details: {
                "相談詳細": details,
                "相手方": counterparty,
                "counterparty": counterparty,
                "description": details || displaySummary,
                "SlackユーザーID": user,
                "VENDOR_NAME": counterparty, 
                "DELIVERY_NUMBER": deliveryNo ? String(deliveryNo) : "",
                "deliveryDate": deliveryDate ? new Date(deliveryDate).toLocaleDateString('ja-JP') : "",
                "inspectionDeadline": inspectionDeadline ? new Date(inspectionDeadline).toLocaleDateString('ja-JP') : "",
                "orderAmountStr": orderAmount ? new Intl.NumberFormat('ja-JP').format(parseFloat(orderAmount)) : "0",
                "DOC_NO": docNumber
              }
            }, templateType);

            // Upload to Google Drive
            const driveLink = await googleDriveService.uploadHtml(html, fileName);

            // Audit Log
            await query(
              "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
              [docNumber, issue.issueKey, templateType, JSON.stringify(details), driveLink, user]
            );

            // 1. Notify User (DM)
            const userSettingsResult = await query("SELECT value FROM app_settings WHERE key = 'slack_answer_back_user'");
            const userTemplate = userSettingsResult.rows[0]?.value?.template || 
              `✅ 法務相談・文書作成の受付が完了しました。\n\n*種別:* {{requestType}}\n*課題キー:* {{issueKey}}\n*文書番号:* {{docNumber}}\n*生成ドキュメント:* {{driveLink}}\n\n法務担当者からの連絡をお待ちください。`;

            const replacePlaceholders = (tmpl: string, data: any) => {
              return tmpl
                .replace(/{{requestType}}/g, data.requestType || "")
                .replace(/{{issueKey}}/g, data.issueKey || "")
                .replace(/{{docNumber}}/g, data.docNumber || "")
                .replace(/{{driveLink}}/g, data.driveLink || "")
                .replace(/{{user}}/g, `<@${data.user}>` || "")
                .replace(/{{summary}}/g, data.summary || "")
                .replace(/{{counterparty}}/g, data.counterparty || "");
            };

            const userMsg = replacePlaceholders(userTemplate, {
              requestType, issueKey: issue.issueKey, docNumber, driveLink, user, summary, counterparty
            });

            await client.chat.postMessage({
              channel: user,
              text: userMsg
            });

            // 2. Notify Department Channel (if configured)
            if (deptChannel) {
              const chanSettingsResult = await query("SELECT value FROM app_settings WHERE key = 'slack_answer_back_channel'");
              const chanTemplate = chanSettingsResult.rows[0]?.value?.template || 
                `🆕 *新規依頼受付通知*\n\n<@{{user}}> さんより新規依頼 ({{requestType}}) を受け付けました。\n*課題:* {{issueKey}} ({{summary}})\n*相手方:* {{counterparty}}\n*生成ドキュメント:* {{driveLink}}`;

              const chanMsg = replacePlaceholders(chanTemplate, {
                requestType, issueKey: issue.issueKey, docNumber, driveLink, user, summary, counterparty
              });

              await client.chat.postMessage({
                channel: deptChannel,
                text: chanMsg
              });
            }
          } catch (err) {
            console.error("Background processing failed:", err);
            await client.chat.postMessage({
              channel: user,
              text: `⚠️ 相談は受け付けましたが、初期ドキュメントの生成に失敗しました。\n課題キー: ${issue.issueKey}`
            });
          }
        })();

      } catch (error) {
        console.error("Error handling modal submission:", error);
      }
    });

    console.log("🚀 Slack Bolt app initialized with LegalBridge handlers");
  } else {
    console.warn("⚠️ Slack credentials missing. Slack endpoints will not be active.");
  }

  // API Routes
  // Slack Receiver Middleware (MUST be before any global body paring middleware like express.json())
  if (receiver) {
    app.use(receiver.router);
  }

  app.post("/api/webhooks/backlog", express.json(), async (req, res) => {
    // Section 2-2: Webhook Implementation
    const event = req.body;
    console.log("⚓ Backlog Webhook Received:", event.type);
    
    try {
      if (event.type === 1) { // Issue Created
        // Logic for auto-processing
      } else if (event.type === 2) { // Issue Updated
        const issueKey = `${event.project.projectKey}-${event.content.key_id}`;
        const newStatus = event.content.status.name;
        
        // Sync status to issue_workflows
        await query(
          "UPDATE issue_workflows SET current_status_name = $1 WHERE backlog_issue_key = $2",
          [newStatus, issueKey]
        );
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/status", (req, res) => {
    res.json({
      status: slackApp ? "active" : "degraded",
      slackReady: !!slackApp,
      backlogReady: !!(process.env.BACKLOG_API_KEY && process.env.BACKLOG_HOST),
      backlogHost: process.env.BACKLOG_HOST || null,
      backlogProjectKey: process.env.BACKLOG_PROJECT_KEY || null,
      updatedAt: new Date().toISOString(),
      warnings: !slackApp ? ["Slack credentials missing"] : [],
    });
  });

  app.get("/api/backlog/issues", async (req, res) => {
    try {
      const issues = await backlogService.getIssues();
      res.json(issues);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/issue-types", async (req, res) => {
    try {
      const types = await backlogService.getIssueTypes();
      res.json(types);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/custom-fields", async (req, res) => {
    try {
      const fields = await backlogService.getCustomFields();
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/statuses", async (req, res) => {
    try {
      const statuses = await backlogService.getStatuses();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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

  // --- Lifecycle Monitoring Implementation ---

  const checkAndNotifyLifecycle = async () => {
    try {
      // 1. Check Overdue Delivery/Inspection
      // Join with legal_requests to get the requester, then staff to get department, 
      // then department_rules to get the channel
      const overdueDeliveries = await query(
        `SELECT 
          d.*, 
          l.summary, 
          l.counterparty, 
          l.slack_user_id as staff_slack_id,
          r.slack_channel_id
         FROM delivery_events d
         LEFT JOIN legal_requests l ON d.backlog_issue_key = l.backlog_issue_key
         LEFT JOIN staff s ON l.slack_user_id = s.slack_user_id
         LEFT JOIN department_workflow_rules r ON s.department = r.department
         WHERE d.status = 'pending' AND d.inspection_deadline < CURRENT_TIMESTAMP`
      );

      for (const item of overdueDeliveries.rows) {
        if (slackApp) {
          const mention = item.staff_slack_id ? `<@${item.staff_slack_id}> ` : "";
          const targetChannel = item.slack_channel_id || process.env.SLACK_NOTIFY_CHANNEL || "general";
          
          const message = `⚠️ *【検収期限超過アラート】*\n\n${mention}*課題:* ${item.backlog_issue_key} (${item.summary})\n*相手方:* ${item.counterparty}\n*期限:* ${new Date(item.inspection_deadline).toLocaleDateString("ja-JP")}\n\n至急、検収状況を確認してください。`;
          
          await slackApp.client.chat.postMessage({
            channel: targetChannel,
            text: message
          });
        }
        console.log(`Alert sent for overdue delivery: ${item.backlog_issue_key} to channel: ${item.slack_channel_id || 'default'}`);
      }

      // 2. Check Upcoming Royalty Reports
      const upcomingRoyalties = await query(
        `SELECT * FROM royalty_payments 
         WHERE status = 'calculated' 
         AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'`
      );
      // Logic for royalties...
      
    } catch (err) {
      console.error("Lifecycle monitoring failed:", err);
    }
  };

  // Run initial check and then every 1 hour (simulated)
  setInterval(checkAndNotifyLifecycle, 3600000);

  app.post("/api/management/check-status-trigger", async (req, res) => {
    await checkAndNotifyLifecycle();
    res.json({ success: true, message: "Manual check triggered" });
  });

  app.get("/api/management/alerts", async (req, res) => {
    try {
      const overdue = await query(
        `SELECT d.*, l.summary as issue_summary, l.counterparty 
         FROM delivery_events d
         LEFT JOIN legal_requests l ON d.backlog_issue_key = l.backlog_issue_key
         WHERE d.status = 'pending' AND d.inspection_deadline < CURRENT_TIMESTAMP`
      );
      res.json({
        overdue: overdue.rows,
        totalAlerts: overdue.rowCount
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/deliveries", async (req, res) => {
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

  app.get("/api/management/royalties", async (req, res) => {
    try {
      const result = await query(`
        SELECT p.*, r.summary as project_name
        FROM royalty_payments p
        LEFT JOIN legal_requests r ON p.backlog_issue_key = r.backlog_issue_key
        ORDER BY p.period DESC, project_name ASC
      `);
      
      // If no data, return some sample records for demonstration
      if (result.rows.length === 0) {
        return res.json([
          { id: 'm1', period: '2026-01', project_name: 'Sample Game A', total_amount: 500000, status: 'paid' },
          { id: 'm2', period: '2026-02', project_name: 'Sample Game A', total_amount: 750000, status: 'calculated' },
          { id: 'm3', period: '2026-03', project_name: 'Sample Game B', total_amount: 1200000, status: 'calculated' },
        ]);
      }
      
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/workflows", async (req, res) => {
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

  app.get("/api/management/documents", async (req, res) => {
    try {
      const result = await query("SELECT * FROM documents ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Master Data APIs
  // (Simplified: these already use local express.json())
  
  app.get("/api/master/company-profile", (req, res) => {
    res.json({
      name: process.env.COMPANY_NAME || "サンプル株式会社",
      address: process.env.COMPANY_ADDRESS || "東京都千代田区丸の内1-1-1",
      representative: process.env.COMPANY_REPRESENTATIVE || "代表取締役 山田 太郎",
      invoice_no: process.env.COMPANY_INVOICE_NO || "T1234567890123"
    });
  });

  app.get("/api/master/app-settings", async (req, res) => {
    try {
      const result = await query("SELECT * FROM app_settings");
      const settings: Record<string, any> = {};
      result.rows.forEach(row => {
        settings[row.key] = row.value;
      });
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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

  app.get("/api/master/vendors", async (req, res) => {
    try {
      const result = await query("SELECT * FROM vendors ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/vendors", express.json(), async (req, res) => {
    const { 
      vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type, 
      withholding_enabled, aliases, address, phone, email, contact_department, 
      contact_name, master_contract_ref, bank_info, bank_name, branch_name, 
      account_type, account_number, account_holder_kana, is_invoice_issuer, 
      invoice_registration_number 
    } = req.body;
    try {
      await query(
        `INSERT INTO vendors (
          vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type, 
          withholding_enabled, aliases, address, phone, email, contact_department, 
          contact_name, master_contract_ref, bank_info, bank_name, branch_name, 
          account_type, account_number, account_holder_kana, is_invoice_issuer, 
          invoice_registration_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (vendor_code) DO UPDATE SET 
          vendor_name = EXCLUDED.vendor_name, trade_name = EXCLUDED.trade_name, pen_name = EXCLUDED.pen_name, 
          vendor_suffix = EXCLUDED.vendor_suffix, entity_type = EXCLUDED.entity_type, 
          withholding_enabled = EXCLUDED.withholding_enabled, aliases = EXCLUDED.aliases, 
          address = EXCLUDED.address, phone = EXCLUDED.phone, email = EXCLUDED.email, 
          contact_department = EXCLUDED.contact_department, contact_name = EXCLUDED.contact_name, 
          master_contract_ref = EXCLUDED.master_contract_ref, bank_info = EXCLUDED.bank_info, 
          bank_name = EXCLUDED.bank_name, branch_name = EXCLUDED.branch_name, 
          account_type = EXCLUDED.account_type, account_number = EXCLUDED.account_number, 
          account_holder_kana = EXCLUDED.account_holder_kana, is_invoice_issuer = EXCLUDED.is_invoice_issuer, 
          invoice_registration_number = EXCLUDED.invoice_registration_number`,
        [
          vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type, 
          withholding_enabled, aliases, address, phone, email, contact_department, 
          contact_name, master_contract_ref, bank_info, bank_name, branch_name, 
          account_type, account_number, account_holder_kana, is_invoice_issuer, 
          invoice_registration_number
        ]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/master/staff", async (req, res) => {
    try {
      const result = await query("SELECT * FROM staff ORDER BY id ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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

  app.get("/api/master/rules", async (req, res) => {
    try {
      const result = await query("SELECT * FROM department_workflow_rules ORDER BY id ASC");
      res.json(result.rows);
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

  app.get("/api/backlog/issues/:key/form-context", async (req, res) => {
    const { key } = req.params;
    const { template } = req.query;
    try {
      const context: Record<string, string> = {};

      if (template === 'inspection_certificate' || template === 'inspection_certificate_detailed' || template === 'inspection_certificate_v2') {
        const deliveryQuery = `
          SELECT de.*, oi.amount as order_amount, oi.description as item_desc, v.vendor_name, v.vendor_code, lr.summary as order_title
          FROM delivery_events de
          LEFT JOIN order_items oi ON de.order_item_id = oi.id
          LEFT JOIN vendors v ON oi.vendor_code = v.vendor_code
          LEFT JOIN legal_requests lr ON de.backlog_issue_key = lr.backlog_issue_key
          WHERE de.backlog_issue_key = $1
        `;
        const result = await query(deliveryQuery, [key]);
        if (result.rows.length > 0) {
          const row = result.rows[0];
          context["CLIENT_NAME"] = row.vendor_name || "";
          context["COUNTERPARTY"] = row.vendor_name || "";
          context["ITEM_NAME"] = row.item_desc || "";
          context["ORDER_TITLE"] = row.order_title || row.item_desc || "";
          context["AMOUNT"] = String(row.delivered_amount || "");
          context["DELIVERY_DATE"] = row.delivered_at ? new Date(row.delivered_at).toLocaleDateString('ja-JP') : "";
          context["INSPECTION_DATE"] = row.delivered_at ? new Date(row.delivered_at).toLocaleDateString('ja-JP') : "";
          context["INSPECTION_DEADLINE"] = row.inspection_deadline ? new Date(row.inspection_deadline).toLocaleDateString('ja-JP') : "";
          context["DELIVERY_NO"] = String(row.delivery_no || "1");
          context["INSPECTION_DAYS"] = "14"; // Default
        }
      } else if (template === 'royalty_statement' || template === 'individual_license_terms' || template === 'license_master' || template === 'license_report') {
        const royaltyQuery = `
          SELECT lc.*, rp.total_amount as last_payment_amount, rp.period as last_period, me.product_name, me.msrp
          FROM license_contracts lc
          LEFT JOIN royalty_payments rp ON lc.id = rp.license_contract_id
          LEFT JOIN manufacturing_events me ON lc.id = me.license_contract_id
          WHERE lc.backlog_issue_key = $1 OR rp.backlog_issue_key = $1
          ORDER BY rp.created_at DESC, me.created_at DESC LIMIT 1
        `;
        const result = await query(royaltyQuery, [key]);
        if (result.rows.length > 0) {
          const row = result.rows[0];
          
          // Mapping for both conventions (UPPERCASE for legal documents, camelCase for reports/statements)
          context["LICENSOR_NAME"] = row.licensor || "";
          context["licensor"] = row.licensor || "";
          
          context["WORK_TITLE"] = row.original_work || "";
          context["originalWork"] = row.original_work || "";
          context["PROPERTY_TITLE"] = row.original_work || "";
          
          context["PRODUCT_NAME"] = row.product_name || "";
          context["productName"] = row.product_name || "";
          
          context["MSRP"] = String(row.msrp || "");
          context["msrpStr"] = row.msrp ? new Intl.NumberFormat("ja-JP").format(row.msrp) : "";
          
          context["ROYALTY_RATE"] = String(row.royalty_rate ? (row.royalty_rate * 100).toFixed(2) : "");
          context["royaltyRatePct"] = row.royalty_rate ? `${(row.royalty_rate * 100).toFixed(1)}%` : "";
          
          context["CONTRACT_ID"] = row.ledger_id || "";
          context["LEDGER_ID"] = row.ledger_id || "";
          context["ledgerId"] = row.ledger_id || "";
          
          context["MG_AMOUNT"] = String(row.mg_amount || "");
          context["mgAmount"] = String(row.mg_amount || "");
          
          context["PERIOD"] = row.last_period || "";
          context["period"] = row.last_period || "";
          
          context["FEE_STRUCTURE"] = row.fee_structure || (row.royalty_rate > 0 ? "PERFORMANCE" : "FIXED");
          
          if (context["FEE_STRUCTURE"] === "PERFORMANCE") {
            const formula = `売上高 × ${row.royalty_rate ? (row.royalty_rate * 100).toFixed(1) : "0"}%`;
            context["CALCULATION_FORMULA"] = formula;
            context["calculation"] = formula;
          }
        }
      }

      res.json(context);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/management/assets", async (req, res) => {
    try {
      const result = await query("SELECT * FROM external_assets ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/management/assets", express.json(), async (req, res) => {
    const { asset_name, asset_type, counterparty, status, file_link, metadata, start_date, end_date, backlog_issue_key } = req.body;
    try {
      const assetNumber = await getNewDocumentNumber(asset_type === 'contract' ? 'external_contract' : asset_type);
      
      const result = await query(
        `INSERT INTO external_assets 
         (asset_number, asset_name, asset_type, counterparty, status, file_link, metadata, start_date, end_date, backlog_issue_key) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING id, asset_number`,
        [assetNumber, asset_name, asset_type, counterparty, status || 'active', file_link, metadata || {}, start_date, end_date, backlog_issue_key]
      );
      res.json({ success: true, id: result.rows[0].id, asset_number: result.rows[0].asset_number });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/management/import-csv", express.text(), async (req, res) => {
    const { mode } = req.query;
    try {
      let result;
      if (mode === "publishing") {
        result = await csvImportService.importPublishingBulk(req.body);
      } else if (mode === "vendor") {
        result = await csvImportService.importVendors(req.body);
      } else if (mode === "staff") {
        result = await csvImportService.importStaff(req.body);
      } else {
        result = await csvImportService.importGeneric(req.body);
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/:type/schema", async (req, res) => {
    try {
      const { type } = req.params;
      const variables = documentService.getTemplateVariables(type as any);
      res.json({ variables });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/:type/preview", async (req, res) => {
    try {
      const { type } = req.params;
      const variables = documentService.getTemplateVariables(type as any);
      const dummyDetails: Record<string, string> = {};
      variables.forEach(v => {
        dummyDetails[v] = `[${v}]`;
      });
      
      const html = documentService.renderHtml({
        issueKey: "DEMO-123",
        summary: "DEMO ISSUE SUMMARY",
        requester: "DEMO USER",
        date: new Date().toLocaleDateString("ja-JP"),
        details: dummyDetails
      }, type as any);
      
      res.send(html);
    } catch (error) {
      res.status(500).send(String(error));
    }
  });

  app.post("/api/documents/generate", express.json(), async (req, res) => {
    const { issueKey, templateType, formData, requesterEmail } = req.body;

    try {
      // 1. Fetch Backlog Issue details
      const issue = await backlogService.getIssue(issueKey);
      
      const docNumber = await getNewDocumentNumber(templateType, issue.issueType.name);

      // 2. Fetch Staff Details from Master DB to enrich context
      let staffInfo: any = {};
      if (requesterEmail) {
        const staffResult = await query("SELECT * FROM staff WHERE email = $1 OR slack_user_id = $1 LIMIT 1", [requesterEmail]);
        if (staffResult.rows.length > 0) {
          const s = staffResult.rows[0];
          staffInfo = {
            STAFF_NAME: s.staff_name,
            STAFF_DEPARTMENT: s.department,
            STAFF_EMAIL: s.email,
            STAFF_PHONE: s.phone
          };
        }
      }

      // 3. Generate Document
      const { html, fileName } = await documentService.generateDocument({
        issueKey,
        documentNumber: docNumber,
        summary: issue.summary,
        requester: requesterEmail || "Legal Department",
        date: new Date().toLocaleDateString("ja-JP"),
        details: { ...staffInfo, ...formData, DOC_NO: docNumber }
      }, templateType);

      // 3. Upload to Google Drive
      const driveLink = await googleDriveService.uploadHtml(html, fileName);

      // 4. Store in DB (PostgreSQL)
      await query(
        "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
        [docNumber, issueKey, templateType, JSON.stringify(formData), driveLink, requesterEmail || "legal_user"]
      );

      // Update Workflow Status
      await query(
        "UPDATE issue_workflows SET current_status_name = $1, document_draft = $2, updated_at = CURRENT_TIMESTAMP WHERE backlog_issue_key = $3",
        ["草案", driveLink, issueKey]
      );

      // --- New: Automatically sync Lifecycle Events based on technical design ---
      if (templateType.includes("inspection")) {
        // Find or create legal request first
        await query(
          "INSERT INTO legal_requests (backlog_issue_key, counterparty, summary) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO NOTHING",
          [issueKey, formData.counterparty || formData.PARTY_B_NAME, issue.summary]
        );
        
        await query(
          "INSERT INTO delivery_events (backlog_issue_key, delivered_at, inspection_deadline, status, note) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (backlog_issue_key) DO UPDATE SET inspection_deadline = EXCLUDED.inspection_deadline, status = EXCLUDED.status",
          [issueKey, new Date(), formData.inspectionDeadline || null, "pending", formData.REMARKS || ""]
        );
      } else if (templateType === "royalty_statement") {
        await query(
          "INSERT INTO royalty_payments (backlog_issue_key, total_amount, period, status) VALUES ($1, $2, $3, $4)",
          [issueKey, parseFloat((formData.royaltyTotal || "0").replace(/,/g, "")), formData.period || new Date().toISOString().slice(0, 7), "calculated"]
        );
      }

      // 5. Notify via Slack
      if (slackApp) {
        // Try to find the user in Slack by email or use a default channel
        // For now, we'll post to the general channel or a specific one if configured
        const message = `📄 *ドキュメントが作成されました*\n\n*課題:* ${issueKey} (${issue.summary})\n*タイプ:* ${templateType}\n*リンク:* ${driveLink}`;
        
        // If we have the original requester's Slack ID from the Backlog description (we saved it earlier)
        const slackIdMatch = issue.description.match(/<@([A-Z0-9]+)>/);
        const targetChannel = slackIdMatch ? slackIdMatch[1] : (process.env.SLACK_NOTIFY_CHANNEL || "general");

        await slackApp.client.chat.postMessage({
          channel: targetChannel,
          text: message
        });
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
          "CONTRACT_NO": "LB-2026-001",
          "CONTRACT_DATE_FORMATTED": "2026年4月16日",
          "PARTY_B_NAME": "サンプル株式会社",
          "PARTY_B_ADDRESS": "東京都千代田区...",
          "PARTY_B_REPRESENTATIVE": "代表取締役 山田 太郎",
          "VENDOR_NAME": "サンプル株式会社",
          "VENDOR_ADDRESS": "東京都千代田区...",
          "ORDER_NO": "PO-2026-001",
          "ORDER_DATE": "2026/04/16",
          "DELIVERY_DATE": "2026/05/31",
          "TOTAL_AMOUNT": "1,100,000",
          "TAX_AMOUNT": "100,000",
          "SUBTOTAL": "1,000,000",
          "PURPOSE": "新規事業開発に関する技術情報の共有",
          "DURATION": "本契約締結日から3年間",
          "GOVERNING_LAW": "日本法",
          "JURISDICTION": "東京地方裁判所"
        } as any
      };

      if (type === "purchase_order") {
        demoData.summary = "ノートPC 5台セット";
        demoData.details = {
          ...demoData.details,
          "VENDOR_NAME": "サンプルOA機器株式会社",
          "ORDER_AMOUNT": "750,000",
          "REMARKS": "納期：2026年5月末日"
        };
      } else if (type === "contract") {
        demoData.summary = "新規事業開発に関する秘密保持契約";
        demoData.details = {
          ...demoData.details,
          "PARTY_B_NAME": "株式会社イノベーション・ラボ",
          "PARTY_B_ADDRESS": "大阪府大阪市北区...",
          "DURATION": "3年"
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

  app.get("/api/master/workflow-settings", async (req, res) => {
    try {
      const result = await query("SELECT * FROM workflow_settings ORDER BY issue_type_name ASC");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/workflow-settings", express.json(), async (req, res) => {
    const { issue_type_name, allowed_templates, status_configs, variable_mappings, next_status_id, document_prefix } = req.body;
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
          document_prefix
        ]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // API Catch-all (must be before Vite/Static middleware)
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
