import express from "express";
import { createServer as createViteServer } from "vite";
import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { BacklogService } from "./src/services/backlogService.ts";
import { MODAL_FIELDS, resolveFieldId, type ModalField } from "./src/config/modalFields.ts";
import { DocumentService } from "./src/services/documentService.ts";
import type { DocumentType } from "./src/services/documentService.ts";
import { GoogleDriveService } from "./src/services/googleDriveService.ts";
import { pool, initDb, query, getNextSequenceValue, getNewDocumentNumber } from "./src/lib/db.ts";
import { CsvImportService } from "./src/services/csvImportService.ts";
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

dotenv.config();

// Initialize PostgreSQL
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---'
  });
  turndownService.use(gfm);
  
  // Custom rule to handle Google Docs' distaste for certain structures or to clean up
  turndownService.addRule('remove-styles', {
    filter: ['style', 'head', 'meta', 'title'],
    replacement: () => ''
  });

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
    // ── フィールド定義 → Slack Block 変換 ──────────────────
    const fieldToBlock = (f: ModalField): any => {
      const block: any = {
        type: "input",
        block_id: f.blockId,
        optional: f.optional ?? false,
        label: { type: "plain_text", text: f.label },
      };
      if (f.type === "text") {
        block.element = { type: "plain_text_input", action_id: f.actionId,
          ...(f.placeholder ? { placeholder: { type: "plain_text", text: f.placeholder } } : {}) };
      } else if (f.type === "textarea") {
        block.element = { type: "plain_text_input", action_id: f.actionId, multiline: true,
          ...(f.placeholder ? { placeholder: { type: "plain_text", text: f.placeholder } } : {}) };
      } else if (f.type === "date") {
        block.element = { type: "datepicker", action_id: f.actionId,
          placeholder: { type: "plain_text", text: "日付を選択" } };
      } else if (f.type === "select") {
        block.element = { type: "static_select", action_id: f.actionId,
          placeholder: { type: "plain_text", text: "選択してください" },
          options: (f.options || []).map((o: any) => ({
            text: { type: "plain_text", text: o.text }, value: o.value })) };
      }
      return block;
    };

    // ── 課題種別の表示名マップ ──────────────────────────────
    const ISSUE_TYPE_OPTIONS = [
      { text: "法務相談",                       value: "legal_consultation" },
      { text: "NDA（秘密保持契約）",            value: "nda" },
      { text: "ライセンス基本契約",              value: "license_master" },
      { text: "個別利用許諾条件",                value: "individual_license_terms" },
      { text: "製造イベント / ロイヤリティ計算", value: "manufacturing" },
      { text: "業務委託基本契約",                value: "outsourcing" },
      { text: "発注書 / 企画発注書",             value: "purchase_order" },
      { text: "納品 / 検収書",                  value: "delivery_inspection" },
      { text: "支払通知 / 報酬明細書",           value: "payment" },
      { text: "売買基本契約",                   value: "sales_master" },
    ];

    // ── モーダル生成（課題種別ごとにフィールドを動的切り替え）──
    const getLegalRequestModal = (selectedType: string = "legal_consultation"): any => {
      const fields = MODAL_FIELDS[selectedType] ?? MODAL_FIELDS["legal_consultation"];
      const selectedLabel = ISSUE_TYPE_OPTIONS.find(o => o.value === selectedType)?.text ?? selectedType;

      const typeBlock = {
        type: "input",
        block_id: "request_type_block",
        label: { type: "plain_text", text: "依頼種別" },
        element: {
          type: "static_select",
          action_id: "request_type_input",
          initial_option: { text: { type: "plain_text", text: selectedLabel }, value: selectedType },
          placeholder: { type: "plain_text", text: "種別を選択してください" },
          options: ISSUE_TYPE_OPTIONS.map(o => ({
            text: { type: "plain_text", text: o.text }, value: o.value })),
        },
      };

      return {
        type: "modal",
        callback_id: "legal_request_modal",
        title: { type: "plain_text", text: "法務 / 契約依頼" },
        submit: { type: "plain_text", text: "送信" },
        close:  { type: "plain_text", text: "キャンセル" },
        blocks: [typeBlock, ...fields.map(fieldToBlock)],
      };
    };

    // ── モーダル送信値 → Backlog課題パラメータ変換 ──────────
    const buildBacklogParams = (requestType: string, values: any, user: string) => {
      const fields = MODAL_FIELDS[requestType] ?? [];
      const getVal = (blockId: string, actionId: string): string =>
        values[blockId]?.[actionId]?.value ??
        values[blockId]?.[actionId]?.selected_date ??
        values[blockId]?.[actionId]?.selected_option?.value ?? "";

      let summary = "";
      let parentIssueKey = "";
      const descParts: string[] = [`依頼者: <@${user}>`];
      const customFields: { fieldId: string; value: string }[] = [];

      for (const f of fields) {
        const val = getVal(f.blockId, f.actionId);
        if (!val) continue;
        if (f.backlogNativeField === "summary") { summary = val; continue; }
        if (f.backlogNativeField === "parentIssueId") { parentIssueKey = val; continue; }
        if (f.backlogFieldEnvKey) {
          const fieldId = resolveFieldId(f.backlogFieldEnvKey);
          if (fieldId) customFields.push({ fieldId, value: val });
        }
        descParts.push(`${f.label}: ${val}`);
      }

      const typeEnvMap: Record<string, string> = {
        legal_consultation: "BACKLOG_ISSUE_TYPE_LEGAL_CONSULTATION",
        nda:                "BACKLOG_ISSUE_TYPE_NDA",
        license_master:     "BACKLOG_ISSUE_TYPE_LICENSE_MASTER",
        individual_license_terms: "BACKLOG_ISSUE_TYPE_INDIVIDUAL_LICENSE",
        manufacturing:      "BACKLOG_ISSUE_TYPE_MANUFACTURING",
        outsourcing:        "BACKLOG_ISSUE_TYPE_OUTSOURCING",
        purchase_order:     "BACKLOG_ISSUE_TYPE_PURCHASE_ORDER",
        delivery_inspection:"BACKLOG_ISSUE_TYPE_DELIVERY",
        payment:            "BACKLOG_ISSUE_TYPE_PAYMENT",
        sales_master:       "BACKLOG_ISSUE_TYPE_SALES_MASTER",
      };
      const issueTypeId = parseInt(process.env[typeEnvMap[requestType] ?? ""] ?? "1", 10);

      return { summary: summary || `【${requestType}】新規依頼`, description: descParts.join("\n"),
               issueTypeId, priorityId: 3, parentIssueKey, customFields };
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
      
      const values      = view.state.values;
      const requestType = values.request_type_block.request_type_input.selected_option?.value || "legal_consultation";
      const user        = body.user.id;

      // 新: modalFields定義からパラメータを構築
      const params = buildBacklogParams(requestType, values, user);

      // 後方互換用: counterparty / summary を旧変数にも保持
      const counterparty = values.counterparty_block?.counterparty_input?.value || "";
      const summary      = params.summary;

      // templateTypeマッピング（既存ロジック維持）
      let templateType: DocumentType = "legal_request";
      const tmplMap: Record<string, DocumentType> = {
        delivery_inspection:      "inspection_certificate",
        manufacturing:            "royalty_statement",
        purchase_order:           "purchase_order",
        nda:                      "nda",
        license_master:           "license_master",
        individual_license_terms: "individual_license_terms",
        outsourcing:              "service_master",
        sales_master:             "sales_master_buyer",
        payment:                  "payment_notice",
      };
      if (tmplMap[requestType]) templateType = tmplMap[requestType];

      try {
        // 親課題キー → IDに解決
        let parentIssueId: number | undefined;
        if (params.parentIssueKey) {
          try {
            const parentIssue = await backlogService.getIssue(params.parentIssueKey.trim());
            parentIssueId = parentIssue.id;
          } catch { /* 親課題が見つからなければ無視 */ }
        }

        // Backlog課題作成（カスタム属性付き）
        const issue = await backlogService.createIssueWithCustomFields({
          summary:      params.summary,
          description:  params.description,
          issueTypeId:  params.issueTypeId,
          priorityId:   params.priorityId,
          parentIssueId,
          customFields: params.customFields,
        });

        // Register in DB
        const lrResult = await query(
          "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [issue.issueKey, user, requestType, counterparty, summary, params.description]
        );

        // issue_workflows 初期レコード
        await query(
          "INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO NOTHING",
          [issue.issueKey, requestType, "起票"]
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
      const context: Record<string, string | number | boolean> = {};

      if (template === 'inspection_certificate' || template === 'inspection_certificate_detailed' || template === 'inspection_certificate_v2') {
        const deliveryQuery = `
          SELECT de.*, oi.amount as order_amount, oi.description as item_desc, oi.spec as item_spec, 
                 v.vendor_name, v.vendor_code, v.trade_name, v.bank_name, v.branch_name, v.account_type, v.account_no, v.account_holder,
                 lr.summary as order_title, lr.created_at as order_date
          FROM delivery_events de
          LEFT JOIN order_items oi ON de.order_item_id = oi.id
          LEFT JOIN vendors v ON oi.vendor_code = v.vendor_code
          LEFT JOIN legal_requests lr ON de.backlog_issue_key = lr.backlog_issue_key
          WHERE de.backlog_issue_key = $1
          ORDER BY de.delivery_no DESC LIMIT 1
        `;
        const result = await query(deliveryQuery, [key]);
        if (result.rows.length > 0) {
          const row = result.rows[0];
          context["issueKey"] = key;
          context["itemNo"] = String(row.order_item_id || "1");
          context["deliveryNo"] = String(row.delivery_no || "1");
          context["totalDeliveries"] = "1"; // Default or lookup
          context["itemCount"] = "1";
          context["orderDate"] = row.order_date ? new Date(row.order_date).toLocaleDateString('ja-JP') : "";
          context["documentDate"] = new Date().toLocaleDateString('ja-JP');
          context["isPartial"] = (row.delivery_no > 1);
          
          context["counterparty"] = row.vendor_name || "";
          context["counterpartyRepresentativeSama"] = row.vendor_rep ? `${row.vendor_rep} 様` : "";
          context["counterpartyTni"] = row.trade_name || "";
          
          context["inspectorDept"] = "法務部";
          context["deliveredAt"] = row.delivered_at ? new Date(row.delivered_at).toLocaleDateString('ja-JP') : "";
          context["inspectionCompletedAt"] = new Date().toLocaleDateString('ja-JP');
          context["paymentDueDate"] = ""; // Manual or calc
          
          context["description"] = row.item_desc || "";
          context["spec"] = row.item_spec || "";
          context["isReducedTax"] = false;
          
          const amount = row.delivered_amount || 0;
          context["deliveredAmountStr"] = new Intl.NumberFormat("ja-JP").format(amount);
          context["taxRate"] = "10";
          context["taxAmountStr"] = new Intl.NumberFormat("ja-JP").format(Math.floor(amount * 0.1));
          context["totalAmountStr"] = new Intl.NumberFormat("ja-JP").format(Math.floor(amount * 1.1));
          
          context["inspectedPct"] = "100";
          context["inspectedAmountStr"] = context["totalAmountStr"];
          context["totalOrderAmountStr"] = new Intl.NumberFormat("ja-JP").format(row.order_amount || 0);
          context["pendingAmountStr"] = "0";

          context["bankName"] = row.bank_name || "";
          context["branchName"] = row.branch_name || "";
          context["accountType"] = row.account_type || "";
          context["accountNo"] = row.account_no || "";
          context["accountHolder"] = row.account_holder || "";
          context["paymentConditionSummary"] = "検収月の翌月末日払い";
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
          
          context["Licensor_名称"] = row.licensor || "";
          context["Licensor_氏名会社名"] = row.licensor || "";
          context["Licensee_名称"] = "株式会社アークライト";
          
          context["原著作物名"] = row.original_work || "";
          context["対象製品予定名"] = row.product_name || "";
          
          context["MSRP"] = String(row.msrp || "");
          context["基準価格"] = String(row.msrp || "");
          
          context["料率"] = String(row.royalty_rate ? (row.royalty_rate * 100).toFixed(2) : "");
          context["契約書番号"] = row.contract_number || "";
          context["台帳ID"] = row.ledger_id || "";
          
          context["MG_AMOUNT"] = String(row.mg_amount || "");
          context["MG/AG"] = String(row.mg_amount || "");
          
          context["許諾期間注記"] = row.last_period || "";
          
          context["royaltyRatePct"] = row.royalty_rate ? `${(row.royalty_rate * 100).toFixed(1)}%` : "";
          context["msrpStr"] = row.msrp ? new Intl.NumberFormat("ja-JP").format(row.msrp) : "";
          
          const formula = `売上高 × ${row.royalty_rate ? (row.royalty_rate * 100).toFixed(1) : "0"}%`;
          context["金銭条件1_計算式"] = formula;
          context["金銭条件1_計算方式"] = row.royalty_rate > 0 ? "ROYALTY" : "FIXED";
          context["金銭条件1_料率"] = context["料率"];

          // Royalty statement specific variables
          context["manufacturingIssueKey"] = key;
          context["licenseIssueKey"] = row.backlog_issue_key || "";
          context["licensor"] = row.licensor || "";
          context["licensee"] = "株式会社アークライト";
          context["originalWork"] = row.original_work || "";
          context["productName"] = row.product_name || "";
          context["edition"] = "通常版";
          context["completionDate"] = row.created_at ? new Date(row.created_at).toLocaleDateString('ja-JP') : "";
          
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
          context["actualRoyaltyStr"] = new Intl.NumberFormat("ja-JP").format(context["actualRoyalty"] as number);
          
          context["taxRate"] = "10";
          context["taxAmount"] = new Intl.NumberFormat("ja-JP").format(Math.floor((context["actualRoyalty"] as number) * 0.1));
          context["totalPaymentStr"] = new Intl.NumberFormat("ja-JP").format(Math.floor((context["actualRoyalty"] as number) * 1.1));
          
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
  
      // 1. Documents generated
      const docs = await query("SELECT id, template_type, created_at, document_number FROM documents WHERE issue_key = $1 ORDER BY created_at ASC", [key]);
      docs.rows.forEach(d => {
        history.push({
          id: `doc-${d.id}`,
          type: 'document',
          label: `文書作成: ${d.template_type}`,
          date: d.created_at,
          ref: d.document_number,
          details: d
        });
      });
  
      // 2. Order Items (Purchase Orders)
      const orders = await query("SELECT * FROM order_items WHERE backlog_issue_key = $1 ORDER BY created_at ASC", [key]);
      orders.rows.forEach(o => {
        history.push({
          id: `order-${o.id}`,
          type: 'order',
          label: `発注登録 (アイテム #${o.item_no})`,
          date: o.created_at,
          ref: `PO Item #${o.item_no}`,
          amount: o.amount,
          details: o
        });
      });
  
      // 3. Delivery Events (Inspections)
      const deliveries = await query(`
        SELECT de.*, oi.item_no 
        FROM delivery_events de 
        LEFT JOIN order_items oi ON de.order_item_id = oi.id 
        WHERE de.backlog_issue_key = $1 OR oi.backlog_issue_key = $2
        ORDER BY de.created_at ASC
      `, [key, key]);
      deliveries.rows.forEach(dev => {
        history.push({
          id: `delivery-${dev.id}`,
          type: 'delivery',
          label: `検収確認 [${dev.status.toUpperCase()}]`,
          date: dev.created_at,
          ref: `納品 #${dev.delivery_no}${dev.item_no ? ` (Item #${dev.item_no})` : ''}`,
          details: dev
        });
      });
  
      history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      res.json(history);
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

  // --- Template Management Endpoints ---
  app.get("/api/templates", (req, res) => {
    try {
      const templatesDir = path.join(process.cwd(), "templates");
      const files = fs.readdirSync(templatesDir);
      const htmlFiles = files
        .filter(f => f.endsWith(".html"))
        .map(f => f.replace(".html", ""));
      res.json(htmlFiles);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/templates/:type", (req, res) => {
    try {
      const { type } = req.params;
      const templatesDir = path.join(process.cwd(), "templates");
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
      const templatesDir = path.join(process.cwd(), "templates");
      fs.writeFileSync(path.join(templatesDir, `${type}.html`), content, "utf-8");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete("/api/templates/:type", (req, res) => {
    try {
      const { type } = req.params;
      const templatesDir = path.join(process.cwd(), "templates");
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

  app.get("/api/templates/config/metadata", (req, res) => {
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

      // Notify Slack about bulk completion with delivery instructions
      if (slackApp && result.success && (mode === "publishing" || mode === "generic")) {
        const channelId = process.env.SLACK_CHANNEL_ID || "C0123456789"; // Fallback or configurable
        await slackApp.client.chat.postMessage({
          channel: channelId,
          text: `📦 一括発注・検収登録が完了しました（件数: ${result.processedCount}件）。\n\n【納品時のご案内】\n納品が発生した際は、ダウンロードされた結果CSVに「納品日（deliveredAt）」と「納品額（deliveredAmount）」を記入し、再度一括インポートを行うことで検収登録が可能です。`,
        });
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

  // --- Live Preview Endpoint ---
  app.post("/api/documents/preview", express.json(), async (req, res) => {
    try {
      const { templateType, formData, issueKey, requesterEmail } = req.body;
      
      const issue = issueKey ? (await query("SELECT * FROM backlog_issues WHERE issue_key = $1", [issueKey])).rows[0] : { summary: "Live Preview" };
      
      const { html, fileName } = await documentService.generateDocument({
        issueKey: issueKey || "PREVIEW-000",
        documentNumber: "PREVIEW-" + Date.now(),
        summary: issue?.summary || "Live Preview",
        requester: requesterEmail || "User",
        date: new Date().toLocaleDateString("ja-JP"),
        details: { 
          ...formData,
          isLivePreview: true
        }
      }, templateType);

      res.json({ success: true, html, fileName });
    } catch (error) {
      console.error("Preview failed:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post("/api/documents/generate", express.json(), async (req, res) => {
    const { issueKey, templateType, formData, requesterEmail } = req.body;

    try {
      // 1. Fetch Backlog Issue details
      const issue = await backlogService.getIssue(issueKey);
      
      const docNumber = await getNewDocumentNumber(templateType, issue.issueType.name);

      // --- New: Automated PO Number Lookup for Inspection Certificates ---
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
        details: { 
          ...staffInfo, 
          ...formData, 
          DOC_NO: docNumber,
          ORDER_NO: formData.orderNumber || parentOrderNumber || issueKey, // Use provided, then looked up, then fallback
          hasChangeLogs: !!formData.CHANGE_RECORDS,
          changeLogs: formData.CHANGE_RECORDS ? formData.CHANGE_RECORDS.split(";").map((log: string) => {
            const [changedAt, fieldLabel, beforeValue, afterValue, reason] = log.split("|");
            return { changedAt, fieldLabel, beforeValue, afterValue, reason };
          }) : []
        }
      }, templateType);

      // 3. Upload to Google Drive (Using HTML for better design fidelity)
      const driveLink = await googleDriveService.uploadHtml(html, fileName);

      // 4. Store in DB (PostgreSQL)
      await query(
        "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
        [docNumber, issueKey, templateType, JSON.stringify(formData), driveLink, requesterEmail || "legal_user"]
      );

      // --- New: Data Relay to Operational Tables ---
      if (templateType.includes("purchase_order")) {
        // Extract items from formData if available, or just the main amount
        await query(
          "INSERT INTO order_items (backlog_issue_key, description, amount, vendor_code, spec) VALUES ($1, $2, $3, $4, $5)",
          [issueKey, formData.description || issue.summary, formData.amount || 0, formData.vendorCode || "", formData.spec || ""]
        );
      } else if (templateType.includes("inspection")) {
        // Record a delivery event
        const orderRes = await query("SELECT id FROM order_items WHERE backlog_issue_key = $1 LIMIT 1", [issueKey]);
        if (orderRes.rows.length > 0) {
          await query(
            "INSERT INTO delivery_events (order_item_id, backlog_issue_key, delivered_amount, delivery_no, delivered_at) VALUES ($1, $2, $3, $4, $5)",
            [orderRes.rows[0].id, issueKey, formData.deliveredAmount || formData.amount || 0, 1, new Date()]
          );
        }
      }

      // Update Workflow Status
      await query(
        "UPDATE issue_workflows SET current_status_name = $1, document_draft = $2, updated_at = CURRENT_TIMESTAMP WHERE backlog_issue_key = $3",
        ["草案", driveLink, issueKey]
      );

      // --- New: Automatically sync Lifecycle Events based on technical design ---
      if (templateType.includes("purchase_order") || templateType === "planning_purchase_order") {
        // 1. Ensure legal_request exists
        const lrResult = await query(
          "INSERT INTO legal_requests (backlog_issue_key, counterparty, summary) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO UPDATE SET counterparty = EXCLUDED.counterparty RETURNING id",
          [issueKey, formData.VENDOR_NAME || formData.PARTY_B_NAME, issue.summary]
        );
        const lrId = lrResult.rows[0].id;

        // 2. Register/Update Order Item
        const amount = parseFloat((formData.ORDER_AMOUNT || formData.TOTAL_AMOUNT || "0").replace(/,/g, ""));
        await query(
          `INSERT INTO order_items (legal_request_id, item_no, vendor_code, description, amount, due_date, backlog_issue_key) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           ON CONFLICT (backlog_issue_key) DO UPDATE SET 
           amount = EXCLUDED.amount, 
           due_date = EXCLUDED.due_date,
           description = EXCLUDED.description`,
          [
            lrId, 
            1, 
            formData.VENDOR_CODE || "UNKNOWN", 
            formData.summary || issue.summary, 
            amount, 
            formData.DELIVERY_DATE || formData.due_date || null,
            issueKey
          ]
        );
      } else if (templateType.includes("inspection")) {
        // Find or create legal request first
        await query(
          "INSERT INTO legal_requests (backlog_issue_key, counterparty, summary) VALUES ($1, $2, $3) ON CONFLICT (backlog_issue_key) DO NOTHING",
          [issueKey, formData.counterparty || formData.PARTY_B_NAME, issue.summary]
        );

        // Find linking order item if it exists
        const orderItemResult = await query("SELECT id FROM order_items WHERE backlog_issue_key = $1", [issueKey]);
        const orderItemId = orderItemResult.rows[0]?.id || null;
        
        await query(
          "INSERT INTO delivery_events (backlog_issue_key, order_item_id, delivered_at, inspection_deadline, status, note) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (backlog_issue_key) DO UPDATE SET inspection_deadline = EXCLUDED.inspection_deadline, status = EXCLUDED.status",
          [issueKey, orderItemId, new Date(), formData.inspectionDeadline || null, "pending", formData.REMARKS || ""]
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

  // ── workflow_settings 一括セットアップ（setupBacklogStatuses.ts の出力を受け取る）──
  app.post("/api/admin/setup-workflow-settings", express.json(), async (req, res) => {
    const { workflows } = req.body as {
      workflows: Array<{
        issue_type_name: string;
        status_configs: Record<string, any>;
        document_prefix: string;
      }>;
    };
    if (!workflows?.length) return res.status(400).json({ error: "workflows は必須です" });

    const results: string[] = [];
    try {
      for (const wf of workflows) {
        await query(
          `INSERT INTO workflow_settings (issue_type_name, status_configs, document_prefix)
           VALUES ($1, $2, $3)
           ON CONFLICT (issue_type_name) DO UPDATE SET
             status_configs  = EXCLUDED.status_configs,
             document_prefix = EXCLUDED.document_prefix,
             updated_at      = CURRENT_TIMESTAMP`,
          [wf.issue_type_name, JSON.stringify(wf.status_configs), wf.document_prefix]
        );
        results.push(wf.issue_type_name);
      }
      console.log(`✅ workflow_settings 更新: ${results.join(", ")}`);
      res.json({ success: true, updated: results });
    } catch (error) {
      console.error("workflow_settings 更新エラー:", error);
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
          "発行日": "2026/04/01",
          "契約書番号": "C-ARC-DOM-LIC-202604001",
          "台帳ID": "LIC-ARC-DOM-202604001",
          "ライセンス種別名": "ボードゲーム国内・海外ライセンス",
          "基本契約名": "ライセンス利用許諾基本契約書（2026/04/01締結）",
          "licensor名": "高橋 宏佳",
          "licensee名": "株式会社アークライト",
          "許諾開始日": "2026/04/01",
          "許諾期間注記": "基本契約の満了日まで。",
          "原著作物名": "ボードゲーム『ダブルナイン』",
          "原著作物補記": "原作および派生作品を含む",
          "対象製品予定名": "『ダブルナイン』",
          "素材番号": "LIC-01",
          "素材名": "原作ボードゲーム",
          "素材権利者": "高橋 宏佳",
          "監修者": "高橋 宏佳",
          "金銭条件1_計算式": "上代 × 5.0% × 製造数",
          "金銭条件1_料率": "5.0%",
          "金銭条件1_基準価格ラベル": "上代（MSRP）",
          "金銭条件1_支払条件": "翌月20日",
          "特記事項_本文": "特になし",
          "licensor_住所": "東京都...",
          "licensor_氏名会社名": "高橋 宏佳",
          "licensee_住所": "東京都千代田区神田...",
          "licensee_氏名会社名": "株式会社アークライト",
          "licensee_代表者名": "代表取締役 金澤 利幸"
        }
      };

      const { html } = await documentService.generateDocument(demoData, type);
      
      // Convert to Markdown using Turndown
      const markdown = turndownService.turndown(html);

      res.json({ markdown, fileName: `sample_${type}.md` });
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
