import express from "express";
import { createServer as createViteServer } from "vite";
import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { BacklogService } from "./src/services/backlogService.ts";
import { DocumentService } from "./src/services/documentService.ts";
import type { DocumentType } from "./src/services/documentService.ts";
import { GoogleDriveService } from "./src/services/googleDriveService.ts";
import { ExcelService } from "./src/services/excelService.ts";
import { pool, initDb, query, getNextSequenceValue, getNewDocumentNumber } from "./src/lib/db.ts";
import { CsvImportService } from "./src/services/csvImportService.ts";
import TurndownService from 'turndown';
import multer from 'multer';
import { Readable } from "stream";
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

dotenv.config();

  // Initialize PostgreSQL
  await initDb();
  console.log("✅ Database initialized");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  async function startServer() {
    const app = express();
    const PORT = Number(process.env.PORT) || 3000;
    console.log("🚀 Starting server...");

    const settingsResult = await query("SELECT * FROM app_settings");
    const dbSettings: Record<string, any> = {};
    settingsResult.rows.forEach(r => dbSettings[r.key] = r.value);
    console.log("✅ Settings loaded");

    // Simple request logger
    app.use((req, res, next) => {
      if (!req.url.startsWith('/dist') && !req.url.startsWith('/assets')) {
         console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
      }
      next();
    });

    // Slack Setup
    const slackBotToken = dbSettings.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
    const slackSigningSecret = dbSettings.SLACK_SIGNING_SECRET || process.env.SLACK_SIGNING_SECRET;

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

      // Mount Slack Receiver
      app.use(receiver.router);
    }

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

    console.log("⏳ Fetching app settings...");

  const backlogService = new BacklogService({
    host: dbSettings.BACKLOG_HOST || process.env.BACKLOG_HOST,
    apiKey: dbSettings.BACKLOG_API_KEY || process.env.BACKLOG_API_KEY,
    projectKey: dbSettings.BACKLOG_PROJECT_KEY || process.env.BACKLOG_PROJECT_KEY
  });
  const documentService = new DocumentService();
  const googleDriveService = new GoogleDriveService();
    const csvImportService = new CsvImportService();
    const excelService = new ExcelService();

    const upload = multer({ storage: multer.memoryStorage() });

    if (slackApp && receiver) {
      // --- Slack Helpers ---
      const getLegalRequestModal = (selectedType: string = "legal_consult"): any => {
      const blocks: any[] = [
        {
          type: "input",
          block_id: "request_type_block",
          label: { type: "plain_text", text: "依頼種別 (Request Type)" },
          element: {
            type: "static_select",
            action_id: "request_type_input",
            initial_option: {
              text: { type: "plain_text", text: selectedType === "legal_consult" ? "法務相談 (legal_consult)" : 
                                       selectedType === "nda" ? "秘密保持契約 (nda)" :
                                       selectedType === "outsourcing" ? "業務委託基本契約 (outsourcing)" :
                                       selectedType === "license_master" ? "ライセンス基本契約 (license_master)" :
                                       selectedType === "lic_individual" ? "個別利用許諾条件 (lic_individual)" :
                                       selectedType === "purchase_order" ? "発注書 (purchase_order)" :
                                       selectedType === "delivery_inspec" ? "納品 / 検収書 (delivery_inspec)" :
                                       selectedType === "sales_master" ? "売買基本契約 (sales_master)" :
                                       "その他" },
              value: selectedType
            },
            placeholder: { type: "plain_text", text: "種別を選択してください" },
            options: [
              { text: { type: "plain_text", text: "法務相談 (legal_consult)" }, value: "legal_consult" },
              { text: { type: "plain_text", text: "秘密保持契約 (nda)" }, value: "nda" },
              { text: { type: "plain_text", text: "業務委託基本契約 (outsourcing)" }, value: "outsourcing" },
              { text: { type: "plain_text", text: "ライセンス基本契約 (license_master)" }, value: "license_master" },
              { text: { type: "plain_text", text: "個別利用許諾条件 (lic_individual)" }, value: "lic_individual" },
              { text: { type: "plain_text", text: "発注書 (purchase_order)" }, value: "purchase_order" },
              { text: { type: "plain_text", text: "納品 / 検収書 (delivery_inspec)" }, value: "delivery_inspec" },
              { text: { type: "plain_text", text: "売買基本契約 (sales_master)" }, value: "sales_master" }
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
          block_id: "deadline_block",
          label: { type: "plain_text", text: "希望納期（文書作成等）" },
          element: {
            type: "datepicker",
            action_id: "deadline_input",
            initial_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*取引先情報 (Counterparty Info)*" }
        },
        {
          type: "input",
          block_id: "counterparty_block",
          label: { type: "plain_text", text: "相手方名称" },
          element: { type: "plain_text_input", action_id: "counterparty_input", placeholder: { type: "plain_text", text: "株式会社〇〇" } }
        },
        {
          type: "input",
          block_id: "entity_type_block",
          label: { type: "plain_text", text: "区分" },
          element: {
            type: "radio_buttons",
            action_id: "entity_type_input",
            initial_option: { text: { type: "plain_text", text: "法人" }, value: "corporate" },
            options: [
              { text: { type: "plain_text", text: "法人" }, value: "corporate" },
              { text: { type: "plain_text", text: "個人" }, value: "individual" }
            ]
          }
        },
        {
          type: "input",
          block_id: "entity_id_block",
          label: { type: "plain_text", text: "法人番号 / 社内個人コード" },
          element: { type: "plain_text_input", action_id: "entity_id_input", placeholder: { type: "plain_text", text: "13桁の番号、または社内コード" } }
        },
        {
          type: "divider"
        },
        {
          type: "input",
          block_id: "details_block",
          label: { type: "plain_text", text: "相談・依頼詳細" },
          element: { type: "plain_text_input", action_id: "details_input", multiline: true }
        }
      ];

      // Dynamic items for Delivery Request (now mapped to delivery_inspec)
      if (selectedType === "delivery_inspec") {
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

    const getLegalSearchModal = (): any => {
      return {
        type: "modal",
        callback_id: "legal_search_modal",
        title: { type: "plain_text", text: "法務検索 (Legal Search)" },
        blocks: [
          {
            type: "input",
            block_id: "keyword_block",
            label: { type: "plain_text", text: "検索キーワード" },
            element: {
              type: "plain_text_input",
              action_id: "keyword_input",
              placeholder: { type: "plain_text", text: "件名、取引先名、Backlogキーなどを入力" }
            }
          }
        ],
        submit: { type: "plain_text", text: "検索" }
      };
    };

    // --- Slack Handlers ---

    // 1. Command to open modal
    slackApp.command("/法務依頼", async ({ command, ack, client, body }) => {
      await ack();
      // Execute UI opening in background to ensure ack returns immediately
      (async () => {
        try {
          await client.views.open({
            trigger_id: body.trigger_id,
            view: getLegalRequestModal("legal_consult")
          });
        } catch (error) {
          console.error("Error opening /法務依頼 modal:", error);
        }
      })();
    });

    // 2. Command to search
    slackApp.command("/法務検索", async ({ command, ack, client, body }) => {
      await ack();
      (async () => {
        try {
          await client.views.open({
            trigger_id: body.trigger_id,
            view: getLegalSearchModal()
          });
        } catch (error) {
          console.error("Error opening /法務検索 modal:", error);
        }
      })();
    });

    // Modal submission for search
    slackApp.view("legal_search_modal", async ({ ack, body, view, client }) => {
      console.log(`🔍 Received search request from user ${body.user.id}`);
      // 1. Acknowledge the view_submission request immediately to avoid timeout
      await ack();
      console.log("   ✅ Acknowledged search request");
      
      const keyword = view.state.values.keyword_block.keyword_input.value || "";
      const user = body.user.id;
      
      if (!keyword) return;

      // 2. Perform search asynchronously in the background
      (async () => {
        try {
          // Search in Legal Requests (including inspection/royalty context)
          const lrResults = await query(
            `SELECT backlog_issue_key, summary, counterparty, request_type 
             FROM legal_requests 
             WHERE summary ILIKE $1 
                OR counterparty ILIKE $1 
                OR backlog_issue_key ILIKE $1 
                OR request_type ILIKE $1
             ORDER BY created_at DESC LIMIT 8`,
            [`%${keyword}%`]
          );

          // Search in Vendors
          const vendorResults = await query(
            "SELECT vendor_code, vendor_name, trade_name FROM vendors WHERE vendor_name ILIKE $1 OR vendor_code ILIKE $1 OR trade_name ILIKE $1 LIMIT 5",
            [`%${keyword}%`]
          );

          let blocks: any[] = [
            {
              type: "header",
              text: { type: "plain_text", text: `🔎 検索結果: ${keyword}`, emoji: true }
            }
          ];

          if (lrResults.rows.length === 0 && vendorResults.rows.length === 0) {
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: "該当するデータは見つかりませんでした。別のキーワードでお試しください。" }
          });
        }

        if (lrResults.rows.length > 0) {
          blocks.push({
             type: "section",
             text: { type: "mrkdwn", text: "*📁 関連課題 (検収・許諾・その他依頼)*" }
          });
          
          lrResults.rows.forEach(r => {
            const typeEmoji = r.summary.includes("検収") ? "✅" : (r.summary.includes("許諾") ? "💰" : "📝");
            blocks.push({
              type: "section",
              text: { 
                type: "mrkdwn", 
                text: `${typeEmoji} *${r.backlog_issue_key}*: ${r.summary}\n>相手方: ${r.counterparty || '未設定'}` 
              }
            });
          });
        }

        if (vendorResults.rows.length > 0) {
          if (lrResults.rows.length > 0) blocks.push({ type: "divider" });
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: "*🏢 取引先・パートナーマスター*" }
          });
          vendorResults.rows.forEach(v => {
            blocks.push({
              type: "section",
              text: { 
                type: "mrkdwn", 
                text: `• \`${v.vendor_code}\` *${v.vendor_name}*\n  _${v.trade_name || ''}_` 
              }
            });
          });
        }

        // Send results via DM to the user
        await client.chat.postMessage({
          channel: user,
          blocks: blocks,
          text: `🔍 検索結果: ${keyword}`
        });

      } catch (error) {
        console.error("Error during Slack search:", error);
      }
    })();
  });

    // Dynamic update based on selection
    slackApp.action("request_type_input", async ({ ack, body, client, action }) => {
      await ack();
      (async () => {
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
      })();
    });

    // 2. Modal submission
    slackApp.view("legal_request_modal", async ({ ack, body, view, client }) => {
      console.log(`📩 Received request modal submission from user ${body.user.id}`);
      // 1. Acknowledge immediately to avoid timeout
      await ack();
      console.log("   ✅ Acknowledged request modal submission");
      
      const values = view.state.values;
      const requestType = values.request_type_block.request_type_input.selected_option?.value || "legal_consult";
      const summary = values.summary_block.summary_input.value || "";
      const deadline = values.deadline_block.deadline_input.selected_date || "";
      const details = values.details_block.details_input.value || "";
      const counterparty = values.counterparty_block.counterparty_input.value || "";
      const entityType = values.entity_type_block.entity_type_input.selected_option?.value || "corporate";
      const entityId = values.entity_id_block.entity_id_input.value || "";
      
      // Delivery specific values
      const deliveryNoRaw = values.delivery_no_block?.delivery_no_input?.value;
      const deliveryNo = deliveryNoRaw ? parseInt(deliveryNoRaw) : null;
      const orderAmount = values.order_amount_block?.order_amount_input?.value;
      const deliveryDate = values.delivery_date_block?.delivery_date_input?.selected_date;
      const inspectionDeadline = values.inspection_deadline_block?.inspection_deadline_input?.selected_date;
      
      const user = body.user.id;
      
      // Map Slack request type to initial Document Template Type
      let templateType: DocumentType = "legal_request";
      if (requestType === "delivery_inspec") {
        templateType = "inspection_certificate";
      } else if (requestType === "purchase_order") {
        templateType = "purchase_order";
      } else if (requestType === "nda") {
        templateType = "nda";
      } else if (requestType === "license_master") {
        templateType = "license_master";
      } else if (requestType === "lic_individual") {
        templateType = "individual_license_terms";
      }

      // 2. Process everything else in the background
      (async () => {
        try {
          const displaySummary = deliveryNo ? `${summary} (第${deliveryNo}回納品)` : summary;
          
          // Detailed description for Backlog
          const backlogDescription = `
依頼タイプ: ${requestType}
希望納期: ${deadline}
依頼者: <@${user}>

【相手方情報】
名称: ${counterparty}
区分: ${entityType === 'corporate' ? '法人' : '個人'}
番号/コード: ${entityId}

【詳細】
${details}
          `.trim();

          // Create Backlog Issue
          // Fetch Issue Types to avoid hardcoding ID 1
          let issueTypeId = 1;
          try {
            const types = await backlogService.getIssueTypes();
            if (types && types.length > 0) {
              // Prefer a type named 'Task' or '依頼' or similar, else first
              const preferred = types.find((t: any) => t.name.includes("依頼") || t.name === "Task") || types[0];
              issueTypeId = preferred.id;
            }
          } catch (e) {
            console.warn("Failed to fetch issue types, falling back to ID 1", e);
          }

          const issue = await backlogService.createIssue({
            summary: `【${requestType}】${displaySummary}`,
            description: backlogDescription,
            issueTypeId: issueTypeId, 
            priorityId: 3, 
          });

          // Register in DB
          const lrResult = await query(
            "INSERT INTO legal_requests (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [issue.issueKey, user, requestType, counterparty, displaySummary, details]
          );

          const legalRequestId = lrResult.rows[0].id;

          // If it's a delivery request, also record it in delivery_events
          if (requestType === "delivery_inspec") {
            await query(
              "INSERT INTO delivery_events (backlog_issue_key, delivery_no, status, inspection_deadline, delivered_at, delivered_amount) VALUES ($1, $2, $3, $4, $5, $6)",
              [issue.issueKey, deliveryNo, "pending", inspectionDeadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), deliveryDate || new Date().toISOString(), parseFloat(orderAmount || "0")]
            );
          }

          await query(
            "INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name) VALUES ($1, $2, $3)",
            [issue.issueKey, requestType, "文書生成依頼"]
          );

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
        } catch (error) {
          console.error("Error handling modal submission background process:", error);
          // Try to let user know it failed
          try {
             await client.chat.postMessage({
               channel: user,
               text: `⚠️ 依頼の処理中にエラーが発生しました。法務担当者へ直接お問い合わせください。\n内容: ${String(error)}`
             });
          } catch (e) {}
        }
      })();
    });

    console.log("🚀 Slack Bolt app initialized with LegalBridge handlers");
  }

  // API Routes
  // Note: Slack Receiver is already mounted above

  // Error handling for Slack
  if (slackApp) {
    slackApp.error(async (error) => {
      console.error("Slack Bolt Error:", error);
    });
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

        // --- Parent-Child Link Logic ---
        // If an issue is completed, check its parent to see if it can also be completed.
        if (newStatus === "完了" || event.content.status.id === 4) {
          try {
            const issue = await backlogService.getIssue(issueKey);
            if (issue.parentIssueId) {
              const children = await backlogService.getChildIssues(issue.parentIssueId);
              const allCompleted = children.every(child => child.status.name === "完了" || child.status.id === 4);
              
              if (allCompleted) {
                // Update parent to 完了
                const parentIssue = await backlogService.getIssue(issue.parentIssueId.toString()); // If it's a number, convert to string just in case
                await backlogService.updateIssueStatus(parentIssue.issueKey, 4);
                console.log(`✅ Parent issue ${parentIssue.issueKey} auto-completed because all children are finished.`);
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
          
          const settingsResult = await query("SELECT value FROM app_settings WHERE key = 'slack_overdue_alert'");
          const template = settingsResult.rows[0]?.value?.template || 
            `⚠️ *【検収期限超過アラート】*\n\n{{mention}}*課題:* {{issueKey}} ({{summary}})\n*相手方:* {{counterparty}}\n*期限:* {{deadline}}\n\n至急、検収状況を確認してください。`;
          
          const message = template
            .replace(/{{mention}}/g, mention)
            .replace(/{{issueKey}}/g, item.backlog_issue_key || "")
            .replace(/{{summary}}/g, item.summary || "")
            .replace(/{{counterparty}}/g, item.counterparty || "")
            .replace(/{{deadline}}/g, new Date(item.inspection_deadline).toLocaleDateString("ja-JP"));
          
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
  
  app.get("/api/master/company-profile", async (req, res) => {
    try {
      const result = await query("SELECT * FROM app_settings WHERE key IN ('COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_REPRESENTATIVE', 'COMPANY_INVOICE_NO')");
      const settings: Record<string, string> = {};
      result.rows.forEach(r => settings[r.key] = r.value);

      res.json({
        name: settings.COMPANY_NAME || process.env.COMPANY_NAME || "サンプル株式会社",
        address: settings.COMPANY_ADDRESS || process.env.COMPANY_ADDRESS || "東京都千代田区丸の内1-1-1",
        representative: settings.COMPANY_REPRESENTATIVE || process.env.COMPANY_REPRESENTATIVE || "代表取締役 山田 太郎",
        invoice_no: settings.COMPANY_INVOICE_NO || process.env.COMPANY_INVOICE_NO || "T1234567890123"
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
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

  app.post("/api/master/vendors/upload-change-request", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const vendorCode = req.body.vendor_code;
      const fileName = `変更届_${vendorCode}_${Date.now()}_${req.file.originalname}`;
      
      const stream = Readable.from(req.file.buffer);
      const driveLink = await googleDriveService.uploadFile(stream, fileName, req.file.mimetype);
      
      res.json({ success: true, driveLink });
    } catch (error) {
      console.error("Upload error:", error);
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

  // --- Numbering Service ---
  app.get("/api/numbering/next", async (req, res) => {
    const { type, issueTypeName } = req.query;
    try {
      // Note: Calling this will increment the sequence!
      const number = await getNewDocumentNumber(String(type), issueTypeName ? String(issueTypeName) : undefined);
      res.json({ number });
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

  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const issues = await backlogService.getIssues();
      const docs = await query("SELECT issue_key, template_type, created_at FROM documents");
      
      const stats = {
        totalIssues: issues.length,
        totalDocuments: docs.rowCount,
        byStatus: {} as Record<string, number>,
        recentActivity: docs.rows.slice(0, 5),
        issueDetails: issues.map(i => {
           const relatedDocs = docs.rows.filter(d => d.issue_key === i.issueKey);
           return {
             ...i,
             documentCount: relatedDocs.length,
             lastDocDate: relatedDocs.length > 0 ? relatedDocs[0].created_at : null
           };
        })
      };

      issues.forEach(i => {
        const s = i.status?.name || "Unknown";
        stats.byStatus[s] = (stats.byStatus[s] || 0) + 1;
      });

      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/backlog/issues/:key/form-context", async (req, res) => {
    const { key } = req.params;
    const { template } = req.query;
    try {
      let context: Record<string, string | number | boolean | any> = {};

      // Phase 1: Dynamic Data Extraction from Backlog
      try {
        const fullIssue = await backlogService.getIssue(key);
        const flattenedFields = backlogService.extractCustomFields(fullIssue);
        // Merge these directly. Template variables named after Backlog fields will auto-populate.
        context = { ...context, ...flattenedFields };
      } catch (e) {
        console.warn("Could not fetch full issue details for context mapping", e);
      }

      if (template === 'inspection_certificate' || template === 'inspection_certificate_detailed' || template === 'inspection_certificate_v2') {
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
          context["accountNo"] = row.account_number || "";
          context["accountHolder"] = row.account_holder || "";
          context["linked_po_number"] = row.linked_po_number || "";
          context["linked_po_link"] = row.linked_po_link || "";
          context["paymentConditionSummary"] = "検収月の翌月末日払い";
        }
      } else if (template === 'royalty_statement' || template === 'individual_license_terms' || template === 'license_master' || template === 'license_report' || template === 'intl_purchase_order') {
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
          
          // Overseas PO mappings
          context["CONTRACTOR_NAME"] = row.vendor_name || row.licensor || "";
          context["CONTRACTOR_ADDRESS"] = row.vendor_address || "";
          context["CONTRACTOR_EMAIL"] = row.vendor_email || "";
          context["PROJECT_TITLE"] = row.product_name || "";
          context["OF_NO"] = row.contract_number || key;
          context["OF_DATE"] = new Date().toLocaleDateString('ja-JP');
          context["CURRENCY"] = "USD"; // Default for international
          
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
          context["linked_terms_number"] = row.linked_terms_number || "";
          context["linked_terms_link"] = row.linked_terms_link || "";
          
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

  app.post("/api/management/link-asset", express.json(), async (req, res) => {
    const { type, issueKey, assetId } = req.body;
    try {
      if (type === 'delivery') {
        await query("UPDATE delivery_events SET linked_asset_id = $1 WHERE backlog_issue_key = $2", [assetId, issueKey]);
      } else if (type === 'contract') {
        await query("UPDATE license_contracts SET linked_asset_id = $1 WHERE backlog_issue_key = $2", [assetId, issueKey]);
      }
      res.json({ status: "ok" });
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
        const channelId = process.env.SLACK_CHANNEL_ID || "C0123456789"; 
        
        const settingsResult = await query("SELECT value FROM app_settings WHERE key = 'slack_bulk_import_done'");
        const template = settingsResult.rows[0]?.value?.template || 
          `📦 一括発注・検収登録が完了しました（件数: {{processedCount}}件）。\n\n【納品時のご案内】\n納品が発生した際は、ダウンロードされた結果CSVに「納品日（deliveredAt）」と「納品額（deliveredAmount）」を記入し、再度一括インポートを行うことで検収登録が可能です。`;

        const msg = template.replace(/{{processedCount}}/g, String(result.processedCount));

        await slackApp.client.chat.postMessage({
          channel: channelId,
          text: msg,
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

  app.post("/api/documents/export-excel", express.json(), async (req, res) => {
    try {
      const data = req.body;
      const buffer = excelService.generateInspectionExcel(data);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=inspection_${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (error) {
      console.error("Excel export error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/documents/generate", express.json(), async (req, res) => {
    let { issueKey, templateType, formData, requesterEmail, nextStatusId } = req.body;

    try {
      // 1. Fetch Backlog Issue details
      const issue = await backlogService.getIssue(issueKey);
      
      const docNumber = await getNewDocumentNumber(templateType, issue.issueType.name);

      // --- New: Update Backlog Status if requested or configured ---
      if (!nextStatusId) {
        // Look up from workflow_settings
        const wsResult = await query("SELECT next_status_id FROM workflow_settings WHERE issue_type_name = $1", [issue.issueType.name]);
        if (wsResult.rows[0]?.next_status_id) {
          nextStatusId = wsResult.rows[0].next_status_id;
          console.log(`📡 Auto-Advance: Found next_status_id ${nextStatusId} for issue type ${issue.issueType.name}`);
        }
      }

      if (nextStatusId) {
        try {
          await backlogService.updateIssueStatus(issueKey, nextStatusId);
        } catch (statusError) {
          console.warn("Failed to update status, continuing...", statusError);
        }
      }

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

      // --- New: Also register as an External Asset for linking/tracking ---
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
          issueKey
        ]
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
      } else if (templateType === "license_master") {
        // Create/Update License Ledger
        await query(
          `INSERT INTO license_contracts (backlog_issue_key, ledger_id, ledger_number, licensor, original_work)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (backlog_issue_key) DO UPDATE SET
           ledger_number = EXCLUDED.ledger_number,
           licensor = EXCLUDED.licensor,
           original_work = EXCLUDED.original_work`,
          [issueKey, formData.ledgerId || docNumber, docNumber, formData.LICENSOR_NAME || formData.PARTY_B_NAME, formData.WORK_TITLE]
        );
      } else if (templateType === "lic_individual") {
        // Update License Contract with its specific number
        await query(
          `UPDATE license_contracts SET contract_number = $1 WHERE backlog_issue_key = $2`,
          [docNumber, issueKey]
        );
      } else if (templateType === "royalty_statement") {
        await query(
          "INSERT INTO royalty_payments (backlog_issue_key, total_amount, period, status) VALUES ($1, $2, $3, $4)",
          [issueKey, parseFloat((formData.royaltyTotal || "0").replace(/,/g, "")), formData.period || new Date().toISOString().slice(0, 7), "calculated"]
        );
      }

      // 5. Notify via Slack
      if (slackApp) {
        const settingsResult = await query("SELECT value FROM app_settings WHERE key = 'slack_document_generated'");
        const template = settingsResult.rows[0]?.value?.template || 
          `📄 *ドキュメントが作成されました*\n\n*課題:* {{issueKey}} ({{summary}})\n*タイプ:* {{type}}\n*リンク:* {{link}}`;

        const message = template
          .replace(/{{issueKey}}/g, issueKey)
          .replace(/{{summary}}/g, issue.summary || "")
          .replace(/{{type}}/g, templateType)
          .replace(/{{link}}/g, driveLink);
        
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
