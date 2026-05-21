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
  pool,
  getNewDocumentNumber,
  getDocumentNumberForGenerate,
  getNewLedgerId,
  getNewLedgerCode,
  getNewWorkId,
  createLedgerWithDefaultMaterial,
  addMaterialToLedger,
  markPrimaryDocument,
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
  // Phase 19: Slack 通知ヘルパー
  //
  // Backlog 課題作成 (webhook type=1) / ステータス変更 (webhook type=2)
  // の両イベントで使う共通通知関数。
  //
  // 動作:
  //   1. legal_requests から申請者 (slack_user_id) と申請内容を取得
  //   2. staff → department_workflow_rules で部署チャンネルを引く
  //   3. 最新の生成文書 (documents) から drive_link を引く (任意)
  //   4. 申請者へ DM を送信
  //   5. 部署チャンネルへ <@申請者> メンション付きで投稿
  //
  // 失敗はすべて warn ログのみ (sync 処理を止めない / webhook を 500 に
  // しない方針)。
  // -------------------------------------------------------------------
  type IssueNotifyEvent =
    | { type: "created" }
    | { type: "status_changed"; from?: string | null; to: string };

  async function notifyIssueEvent(
    issueKey: string,
    event: IssueNotifyEvent
  ): Promise<void> {
    if (!slackWebClient) return;

    let ctx: any;
    try {
      const r = await query(
        `SELECT
           lr.slack_user_id,
           lr.slack_user_name,
           lr.summary,
           lr.counterparty,
           lr.request_type,
           lr.dept           AS legal_request_dept,
           iw.current_status_name,
           iw.issue_type_name,
           s.department      AS staff_department,
           dwr.slack_channel_id,
           (SELECT drive_link
              FROM documents
             WHERE issue_key = $1
             ORDER BY created_at DESC
             LIMIT 1)        AS latest_drive_link
         FROM legal_requests lr
         LEFT JOIN issue_workflows iw
                ON iw.backlog_issue_key = lr.backlog_issue_key
         LEFT JOIN staff s
                ON s.slack_user_id = lr.slack_user_id
         LEFT JOIN department_workflow_rules dwr
                ON dwr.department = COALESCE(s.department, lr.dept)
         WHERE lr.backlog_issue_key = $1
         LIMIT 1`,
        [issueKey]
      );
      ctx = r.rows[0];
    } catch (e) {
      console.warn(`[notify] lookup failed for ${issueKey}:`, e);
      return;
    }
    if (!ctx) {
      console.warn(
        `[notify] no legal_requests row for ${issueKey}, skipping notification`
      );
      return;
    }
    const slackUserId = String(ctx.slack_user_id || "").trim();
    if (!slackUserId) {
      console.warn(`[notify] no slack_user_id for ${issueKey}, skipping`);
      return;
    }

    // Backlog 課題 URL を組み立てる (空ホストなら課題キーだけ表示)
    const backlogHost = (
      dbSettings.BACKLOG_HOST ||
      process.env.BACKLOG_HOST ||
      ""
    ).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const backlogUrl = backlogHost
      ? `https://${backlogHost}/view/${issueKey}`
      : "";

    // ヘッダ
    const header =
      event.type === "created"
        ? `🆕 *新規依頼を受け付けました*`
        : `🔄 *ステータス変更:* 「${event.from || "(不明)"}」 → 「${event.to}」`;

    // 本文 (共通)
    const lines: string[] = [
      header,
      "",
      `*課題:* ${backlogUrl ? `<${backlogUrl}|${issueKey}>` : issueKey}`,
    ];
    const typeLabel =
      ctx.issue_type_name || ctx.request_type || "—";
    if (typeLabel) lines.push(`*種別:* ${typeLabel}`);
    if (ctx.counterparty) lines.push(`*相手方:* ${ctx.counterparty}`);
    if (ctx.summary) lines.push(`*概要:* ${ctx.summary}`);

    const currentStatus =
      event.type === "status_changed"
        ? event.to
        : ctx.current_status_name || "受付済み";
    lines.push(`*ステータス:* ${currentStatus}`);

    // ステータス変更時に最新文書リンクがあれば添える
    if (event.type === "status_changed" && ctx.latest_drive_link) {
      lines.push(`*最新文書:* ${ctx.latest_drive_link}`);
    }

    const dmText = lines.join("\n");

    // 部署チャンネル投稿用 (先頭にメンション)
    const channelText = [
      `<@${slackUserId}> さんの依頼の通知です`,
      "",
      ...lines,
    ].join("\n");

    // DM 送信
    try {
      await slackWebClient.chat.postMessage({
        channel: slackUserId,
        text: dmText,
      });
    } catch (e: any) {
      console.warn(
        `[notify] DM send failed (${issueKey} → ${slackUserId}):`,
        e?.message || e
      );
    }

    // 部署チャンネル投稿 (設定があれば)
    const channelId = String(ctx.slack_channel_id || "").trim();
    if (channelId) {
      try {
        await slackWebClient.chat.postMessage({
          channel: channelId,
          text: channelText,
        });
      } catch (e: any) {
        console.warn(
          `[notify] channel post failed (${issueKey} → ${channelId}):`,
          e?.message || e
        );
      }
    }
  }

  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // Phase 22.2: 自動連鎖ルール
  //
  // 親課題が「締結待ち → 完了」遷移したら、特定の子課題を自動作成する。
  // 子課題は「トリガー待ち」初期状態。Slack /法務依頼 で対応する受動文書
  // (検収書 / 利用許諾料計算書) が起票されたら「未対応」に遷移する。
  // -------------------------------------------------------------------
  type AutoChainRule = {
    parentRequestType: string;
    childRequestType: string;
    childIssueTypeName: string;
    triggerLabel: string;
    childSummaryPrefix: string;
    childActionInstruction: string;
  };

  // Phase 22.21.23: Backlog プロジェクトに実在する課題種別名と一致させる。
  //   実存: 文書作成 / 契約審査 / 法務相談 / 事務手続 / 納品・検収 / 利用許諾計算
  //   旧コードは 「納品リクエスト」「売上報告案件」を探していたが、Backlog に
  //   存在せず、SKIP: issue type not found で止まっていた。
  const AUTO_CHAIN_RULES: AutoChainRule[] = [
    {
      parentRequestType: "purchase_order",
      childRequestType: "delivery_inspec",
      childIssueTypeName: "納品・検収",
      triggerLabel: "納品待ち",
      childSummaryPrefix: "[納品報告] ",
      childActionInstruction:
        "納品を確認したら Slack で `/法務依頼` → 「納品 / 検収書」 を選び、本課題を選択して起票してください。",
    },
    // 企画発注書も同じ「納品・検収」を連鎖させる。
    {
      parentRequestType: "planning_purchase_order",
      childRequestType: "delivery_inspec",
      childIssueTypeName: "納品・検収",
      triggerLabel: "納品待ち",
      childSummaryPrefix: "[納品報告] ",
      childActionInstruction:
        "納品を確認したら Slack で `/法務依頼` → 「納品 / 検収書」 を選び、本課題を選択して起票してください。",
    },
    {
      parentRequestType: "lic_individual",
      childRequestType: "license_calc",
      childIssueTypeName: "利用許諾計算",
      triggerLabel: "利用許諾報告待ち",
      childSummaryPrefix: "[利用許諾報告] ",
      childActionInstruction:
        "利用報告を受けたら Slack で `/法務依頼` → 「利用許諾料計算書」 を選び、本課題を選択して起票してください。",
    },
  ];

  /**
   * 親課題が完了したとき、対応する受動子課題を自動作成。
   * 既に同種類の子があれば二重生成を回避。
   */
  async function autoChainOnComplete(
    parentIssueKey: string,
    parentIssue: any
  ): Promise<void> {
    console.log(
      `🔗 [auto-chain] START parent=${parentIssueKey} parentIssueId=${parentIssue?.id}`
    );
    try {
      // 親の request_type を DB から取得。
      // Phase 22.21.20: 旧コードは `request_type / slack_user_name / dept` を
      //   SELECT していたが、legal_requests 実スキーマには存在せず 42703 で
      //   silently 失敗していた (catch で握り潰し)。実 column 名にあわせて
      //   alias し、未永続化の列はクエリから外す。
      const lrRes = await query(
        `SELECT contract_type AS request_type, slack_user_id, summary, counterparty
           FROM legal_requests
          WHERE backlog_issue_key = $1`,
        [parentIssueKey]
      );
      const parentLr = lrRes.rows[0];
      if (!parentLr) {
        console.log(
          `🔗 [auto-chain] SKIP: no legal_requests row for ${parentIssueKey}. ` +
            `Admin UI で /api/documents/generate が legal_requests に INSERT するはず。` +
            `課題が手動起票で文書未生成のケースで起こりうる。`
        );
        return;
      }
      if (!parentLr.request_type) {
        console.log(
          `🔗 [auto-chain] SKIP: ${parentIssueKey} has no contract_type. ` +
            `Phase 22.21.21 の backfill UPDATE が走っていない可能性。` +
            `worker 再起動 or 該当行に手動 UPDATE 必要。`
        );
        return;
      }
      console.log(
        `🔗 [auto-chain] parent contract_type=${parentLr.request_type}`
      );

      const rule = AUTO_CHAIN_RULES.find(
        (r) => r.parentRequestType === parentLr.request_type
      );
      if (!rule) {
        console.log(
          `🔗 [auto-chain] SKIP: no AUTO_CHAIN_RULES entry for request_type='${parentLr.request_type}'. ` +
            `Known rules: ${AUTO_CHAIN_RULES.map((r) => r.parentRequestType).join(", ")}`
        );
        return;
      }
      console.log(
        `🔗 [auto-chain] matched rule: ${rule.parentRequestType} → ${rule.childRequestType} (${rule.childIssueTypeName})`
      );

      // 既に同型の子課題があれば skip (二重生成防止)
      let existingChildren: any[] = [];
      try {
        existingChildren =
          (await backlogService.getChildIssues(parentIssue.id)) || [];
      } catch (e) {
        console.warn(`🔗 [auto-chain] getChildIssues failed for ${parentIssueKey}:`, e);
      }
      const alreadyChained = existingChildren.some(
        (c: any) => c?.issueType?.name === rule.childIssueTypeName
      );
      if (alreadyChained) {
        console.log(
          `🔗 [auto-chain] SKIP: ${parentIssueKey} already has ${rule.childIssueTypeName} child`
        );
        return;
      }
      console.log(
        `🔗 [auto-chain] existing children count=${existingChildren.length}, no ${rule.childIssueTypeName} yet`
      );

      // Phase 22.21.26: race-safe DB dedup。
      //   旧 Phase 22.21.24 は SELECT-then-INSERT で 2.2ms 差の同時呼び出しに
      //   負けた (LEGAL-125 / LEGAL-126 二重作成事案)。
      //   対策: PostgreSQL の advisory lock を専用 client + transaction で
      //   取得して critical section (dedup 確認 + createIssue + INSERT) を
      //   直列化する。2 件目以降のコールは 1 件目の COMMIT 待ちになり、
      //   その後 dedup 検査で必ずスキップする。
      //   client.release() / ROLLBACK は後段の finally で行う。
      const dedupClient = await pool.connect();
      try {
        await dedupClient.query("BEGIN");
        // xact-scope lock: 同じ (parent, child_type) ペアに対し他 trx を待たせる
        await dedupClient.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`autochain:${parentIssueKey}:${rule.childRequestType}`]
        );
        // Lock 下で再確認 (column 経由 + notes ILIKE 両方)
        const lockedDup = await dedupClient.query(
          `SELECT backlog_issue_key FROM legal_requests
            WHERE contract_type = $1
              AND (parent_issue_key = $2 OR notes ILIKE $3)
            LIMIT 1`,
          [rule.childRequestType, parentIssueKey, `%親: ${parentIssueKey}%`]
        );
        if (lockedDup.rows.length > 0) {
          console.log(
            `🔗 [auto-chain] SKIP (locked dedup): existing child ${lockedDup.rows[0].backlog_issue_key} for parent ${parentIssueKey}`
          );
          await dedupClient.query("COMMIT");
          return;
        }
        console.log(`🔗 [auto-chain] DB dedup OK under lock, proceed`);

        // 子課題の Backlog issue type id を解決
        const issueTypes = await backlogService.getIssueTypes();
        const childType = issueTypes.find(
          (t: any) => t.name === rule.childIssueTypeName
        );
        if (!childType) {
          console.warn(
            `🔗 [auto-chain] SKIP: Backlog issue type "${rule.childIssueTypeName}" not found. ` +
              `Available types: ${issueTypes.map((t: any) => t.name).join(", ")}`
          );
          await dedupClient.query("ROLLBACK");
          return;
        }
        console.log(
          `🔗 [auto-chain] resolved issueType ${rule.childIssueTypeName} id=${childType.id}`
        );

        // Phase 22.21.25: 子課題タイトルに親文書番号 + 取引先名を含める。
        //   旧: "[納品報告] 発注書"  ← 複数並ぶと区別不能
        //   新: "[納品報告] ARC-PO-2026-0007 / 福原 朋実"
        let parentDocNumber = "";
        try {
          // ルールに応じて template_type のパターンを切り替え
          const tmplPattern =
            rule.parentRequestType === "purchase_order" ||
            rule.parentRequestType === "planning_purchase_order"
              ? "%purchase_order%"
              : rule.parentRequestType === "lic_individual"
                ? "individual_license_terms"
                : "%";
          // documents テーブルは別 client (pool) で読んで OK (read-only)
          const docRes = await query(
            `SELECT document_number
               FROM documents
              WHERE issue_key = $1
                AND template_type LIKE $2
              ORDER BY created_at DESC
              LIMIT 1`,
            [parentIssueKey, tmplPattern]
          );
          parentDocNumber = String(docRes.rows[0]?.document_number || "").trim();
          console.log(
            `🔗 [auto-chain] document lookup: issue_key=${parentIssueKey} ` +
              `tmplPattern=${tmplPattern} → document_number='${parentDocNumber}'`
          );
        } catch (e) {
          console.warn(`🔗 [auto-chain] document_number lookup failed:`, e);
        }
        const counterpartyForTitle = String(
          parentLr.counterparty || ""
        ).trim();
        // タイトル組み立て: [納品報告] ARC-PO-2026-0007 / 福原 朋実
        const titleAfterPrefix = [parentDocNumber || parentIssueKey, counterpartyForTitle]
          .filter(Boolean)
          .join(" / ");
        const childSummary = rule.childSummaryPrefix + titleAfterPrefix;
        console.log(`🔗 [auto-chain] child summary = "${childSummary}"`);

        // Phase 22.21.24: Backlog は親子関係を 1 階層しか許さない。
        const grandParentId = parentIssue?.parentIssueId
          ? Number(parentIssue.parentIssueId)
          : null;
        const effectiveParentId = grandParentId || parentIssue.id;
        const fallbackDueToHierarchy = !!grandParentId;
        console.log(
          `🔗 [auto-chain] calling backlogService.createIssue ` +
            `(effectiveParentId=${effectiveParentId}, typeId=${childType.id})` +
            (fallbackDueToHierarchy
              ? ` [fallback: 祖父課題 ${grandParentId} を親にした (Backlog 1 階層制約のため LEGAL-${parentIssueKey} の直下には作れない)]`
              : "")
        );
        const baseDescription =
          `自動作成: 親課題 ${parentIssueKey} が完了したため、` +
          `${rule.triggerLabel} 課題を起こしました。\n\n` +
          (fallbackDueToHierarchy
            ? `※ Backlog の親子 1 階層制約により、本課題は ${parentIssueKey} の` +
              `「兄弟」(同じ親の配下) として作成されています。\n\n`
            : "") +
          `申請者: <@${parentLr.slack_user_id}>\n\n` +
          rule.childActionInstruction;

        // Backlog createIssue は遅い (~500ms-2s) が、advisory lock を
        // 保持し続けることで他の並行コールはここで COMMIT 待ちになる。
        let childIssue: any = null;
        try {
          childIssue = await backlogService.createIssue({
            summary: childSummary,
            description: baseDescription,
            issueTypeId: childType.id,
            priorityId: 3,
            parentIssueId: effectiveParentId,
          });
        } catch (createErr: any) {
          const msg = String(createErr?.message || createErr);
          if (msg.includes("parentChildIssue")) {
            console.warn(
              `🔗 [auto-chain] parentChildIssue error with parent=${effectiveParentId}, retry as top-level: ${msg}`
            );
            childIssue = await backlogService.createIssue({
              summary: childSummary,
              description:
                baseDescription +
                `\n\n※ Backlog の親子制約により、独立課題として作成されました。`,
              issueTypeId: childType.id,
              priorityId: 3,
            });
          } else {
            throw createErr;
          }
        }

        if (!childIssue?.issueKey) {
          console.warn(
            `🔗 [auto-chain] child creation returned no issueKey for ${parentIssueKey}. ` +
              `Backlog API がエラーを返した可能性。 BACKLOG_API_KEY / BACKLOG_PROJECT_KEY 環境変数を確認。`
          );
          await dedupClient.query("ROLLBACK");
          return;
        }

        console.log(
          `📎 [auto-chain] CREATED ${parentIssueKey} → ${childIssue.issueKey} (${rule.childIssueTypeName})`
        );

        // INSERT legal_requests (lock 保持中なので race-safe)。
        // parent_issue_key 列に親キーを入れることで、以降の dedup 検査が
        // notes ILIKE よりも確実かつ高速になる。
        await dedupClient.query(
          `INSERT INTO legal_requests
             (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, deadline, notes, parent_issue_key)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
           ON CONFLICT (backlog_issue_key) DO NOTHING`,
          [
            childIssue.issueKey,
            parentLr.slack_user_id,
            rule.childRequestType,
            parentLr.counterparty,
            childIssue.summary,
            `親: ${parentIssueKey}`,
            parentIssueKey,
          ]
        );

        // COMMIT してロック解放。以降は他コールの dedup で必ずヒットする。
        await dedupClient.query("COMMIT");
        console.log(`🔗 [auto-chain] transaction COMMIT, lock released`);

        // ロック外で並行可能な後処理: トリガー待ちステータス + workflows + 通知
        try {
          const statuses = await backlogService.getStatuses();
          const triggerStatus = statuses.find(
            (s: any) => s.name === "トリガー待ち"
          );
          if (triggerStatus) {
            await backlogService.updateIssueStatus(
              childIssue.issueKey,
              triggerStatus.id
            );
          } else {
            console.warn(`[auto-chain] "トリガー待ち" status not found in Backlog`);
          }
        } catch (e) {
          console.warn(`[auto-chain] failed to set トリガー待ち on ${childIssue.issueKey}:`, e);
        }

        try {
          await query(
            `INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name)
             VALUES ($1, $2, 'トリガー待ち')
             ON CONFLICT (backlog_issue_key) DO UPDATE SET
               current_status_name = 'トリガー待ち',
               issue_type_name     = EXCLUDED.issue_type_name`,
            [childIssue.issueKey, rule.childRequestType]
          );
        } catch (e) {
          console.warn(`[auto-chain] issue_workflows insert failed for ${childIssue.issueKey}:`, e);
        }

        try {
          await notifyAutoChainCreated(
            childIssue.issueKey,
            parentIssueKey,
            parentLr,
            rule
          );
        } catch (e) {
          console.warn(`[auto-chain] notify failed:`, e);
        }
      } catch (innerErr) {
        // 何らかの例外で create / INSERT が途中で死んだ → ROLLBACK
        try {
          await dedupClient.query("ROLLBACK");
        } catch {
          /* noop */
        }
        throw innerErr;
      } finally {
        dedupClient.release();
      }
    } catch (e) {
      console.error("[auto-chain] fatal error:", e);
    }
  }

  /**
   * 自動連鎖で子課題が作られたことを申請者と部署チャンネルに通知。
   */
  async function notifyAutoChainCreated(
    childIssueKey: string,
    parentIssueKey: string,
    parentLr: any,
    rule: AutoChainRule
  ): Promise<void> {
    if (!slackWebClient) return;

    const slackUserId = String(parentLr.slack_user_id || "").trim();
    if (!slackUserId) return;

    // 部署 channel を引く
    const dwrRes = await query(
      `SELECT dwr.slack_channel_id
         FROM staff s
         LEFT JOIN department_workflow_rules dwr
                ON dwr.department = COALESCE(s.department, $2)
        WHERE s.slack_user_id = $1
        LIMIT 1`,
      [slackUserId, parentLr.dept || ""]
    );
    const channelId = String(dwrRes.rows[0]?.slack_channel_id || "").trim();

    const backlogHost = (
      dbSettings.BACKLOG_HOST ||
      process.env.BACKLOG_HOST ||
      ""
    ).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const childUrl = backlogHost
      ? `https://${backlogHost}/view/${childIssueKey}`
      : "";
    const parentUrl = backlogHost
      ? `https://${backlogHost}/view/${parentIssueKey}`
      : "";

    const lines = [
      `📎 *${rule.triggerLabel} 課題が自動作成されました*`,
      ``,
      `親課題 ${parentUrl ? `<${parentUrl}|${parentIssueKey}>` : parentIssueKey} が完了したため、次の段階に進みました。`,
      ``,
      `*${rule.triggerLabel} 課題:* ${childUrl ? `<${childUrl}|${childIssueKey}>` : childIssueKey}`,
      ``,
      rule.childActionInstruction,
    ];

    const dmText = lines.join("\n");
    try {
      await slackWebClient.chat.postMessage({
        channel: slackUserId,
        text: dmText,
      });
    } catch (e: any) {
      console.warn(`[auto-chain notify] DM failed:`, e?.message || e);
    }

    if (channelId) {
      const channelText = [
        `<@${slackUserId}> さんへ`,
        "",
        ...lines,
      ].join("\n");
      try {
        await slackWebClient.chat.postMessage({
          channel: channelId,
          text: channelText,
        });
      } catch (e: any) {
        console.warn(`[auto-chain notify] channel failed:`, e?.message || e);
      }
    }
  }

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
      // Phase 9f: 複合 UNIQUE 制約 (backlog_issue_key, delivery_no) 対応。
      // 同じ delivery_no で再起票された場合は上書き (Backlog 起票の冪等性確保)。
      await query(
        `INSERT INTO delivery_events
           (backlog_issue_key, delivery_no, status, inspection_deadline,
            delivered_at, delivered_amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET
           status              = EXCLUDED.status,
           inspection_deadline = EXCLUDED.inspection_deadline,
           delivered_at        = EXCLUDED.delivered_at,
           delivered_amount    = EXCLUDED.delivered_amount`,
        [
          issue.issueKey,
          Number(deliveryNo) || 1,
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

    // Phase 9: PDF レンダリング経由で upload (Backlog webhook 経路)
    const driveLink = await googleDriveService.uploadPdf(html, fileName);

    await query(
      "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [docNumber, issue.issueKey, templateType, JSON.stringify(details), driveLink, user]
    );

    // Phase 19: 旧来の「文書生成完了」DM + 部署チャンネル投稿 (driveLink 付き)
    // は廃止し、共通の notifyIssueEvent ヘルパーで「受付しました」通知を出す
    // 形に統一。文書完成のお知らせは、admin-ui でステータスを進めたときの
    // type=2 webhook 経由通知 (latest_drive_link 含む) で兼ねる。
    await notifyIssueEvent(issue.issueKey, { type: "created" });

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

        // 旧 status を取得 (通知の "from" 表示用)。先に SELECT してから UPDATE。
        let previousStatus: string | null = null;
        try {
          const prev = await query(
            "SELECT current_status_name FROM issue_workflows WHERE backlog_issue_key = $1",
            [issueKey]
          );
          previousStatus = prev.rows[0]?.current_status_name ?? null;
        } catch {
          /* 失敗しても通知は続行 (from は "(不明)" になるだけ) */
        }

        await query(
          "UPDATE issue_workflows SET current_status_name = $1 WHERE backlog_issue_key = $2",
          [newStatus, issueKey]
        );

        // Phase 19: ステータス変更通知 (DM + 部署チャンネル)。
        // 同じステータスへの no-op 更新は通知しない (Backlog は何故か同じ
        // status で type=2 を送ってくることがある)。
        if (previousStatus !== newStatus) {
          await notifyIssueEvent(issueKey, {
            type: "status_changed",
            from: previousStatus,
            to: newStatus,
          });
        }

        if (newStatus === "完了" || event.content.status.id === 4) {
          try {
            const issue = await backlogService.getIssue(issueKey);

            // 既存: 子全完了 → 親自動完了 (Phase 18 で残置を確認した処理)
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

            // Phase 22.2: 親完了 → 受動子課題自動作成
            // 該当ルール (発注書→納品報告 / 個別利用許諾→利用許諾報告) に
            // 当てはまれば、Backlog に子課題を起こして「トリガー待ち」に。
            await autoChainOnComplete(issueKey, issue);

            // Phase 22.4: 納期変更依頼 完了 → 実際の納期変更を実行
            // 課題の contract_type が deadline_change なら notes JSON を
            // 取り出して applyBulkDeadlineChange を実行する (idempotent)。
            try {
              const lrRes = await query(
                "SELECT contract_type, notes FROM legal_requests WHERE backlog_issue_key = $1",
                [issueKey]
              );
              const lr = lrRes.rows[0];
              if (lr && lr.contract_type === "deadline_change") {
                await executeDeadlineChangeRequest(issueKey, lr.notes);
              }
            } catch (e) {
              console.warn(
                `[deadline-change-execute] check failed for ${issueKey}:`,
                e
              );
            }
          } catch (e) {
            console.warn("Parent-child sync / auto-chain failed:", e);
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

  /**
   * Phase 22.6: 口頭 / メール起案用の Backlog 課題作成エンドポイント。
   *
   * POST /api/backlog/issues/quick-create
   *   body: {
   *     issueTypeLabel: "契約審査" | "法務相談" | "事務手続" | "納品・検収" | "利用許諾計算",
   *     requestType: "contract" | "nda" | "outsourcing" | "license_master" |
   *                  "lic_individual" | "sales_master" | "purchase_order" |
   *                  "delivery_inspec" | "legal_consult" | "license_calc" | "legal_request",
   *     counterpartyName?: string,  // 表示用 (master 選択時は vendor_name)
   *     vendorCode?: string,        // master 選択時のみセット (description に記載)
   *     subTopic?: string,          // 「業務委託基本契約書ドラフト」等の短い見出し
   *     deadline?: string,          // YYYY-MM-DD
   *     dept?: string,              // 依頼部署 (省略可)
   *     details?: string,           // 自由記入の詳細メモ
   *     parentIssueKey?: string,    // Phase 22.6.2: 親課題 issueKey (子課題として起案する場合)
   *   }
   *
   * Slack 起票 (processLegalRequestSubmission) と異なり、本エンドポイントは
   * 「Backlog 課題を作るだけ」に責務を絞る。PDF 自動生成も Slack DM もしない。
   * 口頭/メール依頼を受けた法務担当が、UI 上でクイックに起案する用途。
   *
   * 課題名フォーマットは均一化のため固定:
   *   【${issueTypeLabel}】${counterpartyDisplay}｜${subTopicDisplay}
   *   例: 【契約審査】株式会社サンプル商事｜業務委託基本契約書
   *
   * 課題作成後は legal_requests + issue_workflows にも INSERT して、
   * 既存の workflow state machine と連動するようにする。
   */
  app.post(
    "/api/backlog/issues/quick-create",
    express.json(),
    async (req, res) => {
      try {
        const {
          issueTypeLabel,
          requestType,
          counterpartyName = "",
          vendorCode = "",
          subTopic = "",
          deadline = "",
          dept = "",
          details = "",
          parentIssueKey = "",
        } = (req.body || {}) as Record<string, string>;

        // ---- バリデーション ----
        const ALLOWED_TYPE_LABELS = new Set([
          "契約審査",
          "法務相談",
          "事務手続",
          "納品・検収",
          "利用許諾計算",
        ]);
        const ALLOWED_REQUEST_TYPES = new Set([
          "contract",
          "nda",
          "outsourcing",
          "license_master",
          "lic_individual",
          "sales_master",
          "purchase_order",
          "delivery_inspec",
          "legal_consult",
          "license_calc",
          "legal_request",
        ]);
        if (!ALLOWED_TYPE_LABELS.has(issueTypeLabel)) {
          return res.status(400).json({
            ok: false,
            error: `issueTypeLabel が不正: ${issueTypeLabel}`,
          });
        }
        if (!ALLOWED_REQUEST_TYPES.has(requestType)) {
          return res.status(400).json({
            ok: false,
            error: `requestType が不正: ${requestType}`,
          });
        }

        // ---- 課題名 (均一フォーマット) ----
        const counterpartyDisplay = counterpartyName.trim() || "(相手方未指定)";
        const subTopicDisplay = subTopic.trim() || "(内容未指定)";
        const summary = `【${issueTypeLabel}】${counterpartyDisplay}｜${subTopicDisplay}`;

        // ---- description (起案元と起案者情報を明示) ----
        const requester =
          (req as any).user?.email ||
          (req as any).user?.name ||
          "admin-ui";
        const descLines: string[] = [
          `依頼タイプ: ${requestType} (${issueTypeLabel})`,
        ];
        if (deadline) descLines.push(`希望納期: ${deadline}`);
        descLines.push(`起案者: ${requester}`);
        if (parentIssueKey) {
          descLines.push(`親課題: ${parentIssueKey}`);
        }
        descLines.push("");
        descLines.push("【相手方情報】");
        descLines.push(`名称: ${counterpartyName || "(未指定)"}`);
        if (vendorCode) descLines.push(`取引先コード: ${vendorCode}`);
        if (dept) {
          descLines.push("");
          descLines.push(`依頼部署: ${dept}`);
        }
        descLines.push("");
        descLines.push("【詳細】");
        descLines.push(details || "(なし)");
        descLines.push("");
        descLines.push(
          parentIssueKey
            ? `※ admin-ui の Backlog Requests 画面から起案 (${parentIssueKey} の子課題)`
            : "※ admin-ui の Backlog Requests 画面から起案 (口頭/メール起案トリガー)"
        );
        const description = descLines.join("\n");

        // ---- Backlog issueType / category の解決 ----
        // Slack 起票と同じロジックで mapping (UI 側で typeLabel を渡しているので
        // そのままマッチさせるだけだが、API 失敗時は最初の type にフォールバック)。
        let issueTypeId = 1;
        let categoryId: number | undefined;
        try {
          const [types, categories] = await Promise.all([
            backlogService.getIssueTypes(),
            backlogService.getCategories(),
          ]);
          if (types?.length) {
            const matched = types.find((t: any) => t.name === issueTypeLabel);
            issueTypeId = matched ? matched.id : types[0].id;
          }
          if (categories?.length) {
            let targetCategoryName = "通知書";
            if (
              [
                "nda",
                "contract",
                "outsourcing",
                "license_master",
                "lic_individual",
              ].includes(requestType)
            )
              targetCategoryName = "契約";
            else if (requestType === "purchase_order")
              targetCategoryName = "発注";
            else if (requestType === "delivery_inspec")
              targetCategoryName = "納品";
            else if (requestType === "sales_master")
              targetCategoryName = "売買";
            else if (requestType === "license_calc")
              targetCategoryName = "ライセンス";
            const matched = categories.find(
              (c: any) => c.name === targetCategoryName
            );
            if (matched) categoryId = matched.id;
          }
        } catch (lookupErr) {
          console.warn(
            "[quick-create] issueType/category lookup failed, falling back",
            lookupErr
          );
        }

        // ---- 親課題の解決 (子課題として起案する場合) ----
        // Phase 22.6.2: parentIssueKey が渡されたら Backlog から id を引いて
        // parentIssueId として createIssue に渡す。
        // 親が見つからない / 取得失敗時はエラーを返す (silently 親なしで
        // 作成すると意図と異なるため明示的に失敗させる)。
        let parentIssueId: number | undefined;
        if (parentIssueKey) {
          try {
            const parent = await backlogService.getIssue(parentIssueKey);
            if (!parent?.id) {
              return res.status(400).json({
                ok: false,
                error: `親課題 ${parentIssueKey} が見つかりません`,
              });
            }
            parentIssueId = parent.id;
          } catch (parentErr: any) {
            console.error(
              `[quick-create] 親課題 ${parentIssueKey} の取得に失敗:`,
              parentErr
            );
            return res.status(400).json({
              ok: false,
              error: `親課題の取得に失敗しました: ${
                parentErr?.message || parentErr
              }`,
            });
          }
        }

        // ---- Backlog 課題作成 ----
        const issueParams: any = {
          summary,
          description,
          issueTypeId,
          priorityId: 3,
          counterparty: counterpartyName,
          dept,
          deadline,
          remarks: details,
        };
        if (categoryId) issueParams["categoryId[]"] = categoryId;
        if (parentIssueId) issueParams.parentIssueId = parentIssueId;

        const issue = await backlogService.createIssue(issueParams);

        // ---- legal_requests / issue_workflows に登録 (Slack 起票と同じ流れ) ----
        // ON CONFLICT は付けない (新規 issueKey なので衝突しないはず) が、
        // ここで失敗しても Backlog 課題は既に作られているため、エラーは
        // ログだけ吐いて UI には ok を返す (issueKey は伝える)。
        try {
          await query(
            `INSERT INTO legal_requests
               (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              issue.issueKey,
              requester,
              requestType,
              counterpartyName || null,
              subTopic || null,
              details || null,
            ]
          );
          await query(
            `INSERT INTO issue_workflows
               (backlog_issue_key, issue_type_name, current_status_name)
             VALUES ($1, $2, $3)`,
            [issue.issueKey, requestType, "文書生成依頼"]
          );
        } catch (dbErr) {
          console.error(
            `[quick-create] DB insert failed for ${issue.issueKey} (Backlog 課題は作成済み):`,
            dbErr
          );
        }

        return res.json({
          ok: true,
          issueKey: issue.issueKey,
          summary,
        });
      } catch (error: any) {
        console.error("POST /api/backlog/issues/quick-create failed:", error);
        return res.status(500).json({
          ok: false,
          error: String(error?.message || error),
        });
      }
    }
  );

  // -------------------------------------------------------------------
  // Phase 22.21.22: 自動連鎖の手動トリガー (診断用)
  //
  //   POST /api/debug/auto-chain-trigger/:key
  //   body: なし
  //
  //   - 親課題を「完了」に進めずに autoChainOnComplete だけ強制実行
  //   - Cloud Run ログに 🔗 [auto-chain] ... の詳細が出るので、
  //     なぜ子課題が作られないかを段階追跡できる
  //   - 冪等 (既存子課題があれば作成しない)
  //   - レスポンスにも success / parent issue / 直近ログを返す
  // -------------------------------------------------------------------
  app.post(
    "/api/debug/auto-chain-trigger/:key",
    express.json(),
    async (req, res) => {
      const { key } = req.params;
      try {
        const issue = await backlogService.getIssue(key);
        if (!issue) {
          return res.status(404).json({
            ok: false,
            error: `Backlog issue ${key} not found`,
          });
        }
        // legal_requests 行の状態を返却 (なぜマッチしないか判別の助けに)
        const lrRes = await query(
          `SELECT contract_type, slack_user_id, summary, counterparty
             FROM legal_requests
            WHERE backlog_issue_key = $1`,
          [key]
        );
        const lr = lrRes.rows[0] || null;

        await autoChainOnComplete(key, issue);

        res.json({
          ok: true,
          parentIssueKey: key,
          parentIssueId: issue.id,
          legalRequest: lr,
          message:
            "autoChainOnComplete を実行しました。Cloud Run ログで 🔗 [auto-chain] を grep してください。",
        });
      } catch (e: any) {
        console.error("[auto-chain debug] failed:", e);
        res
          .status(500)
          .json({ ok: false, error: e?.message || String(e) });
      }
    }
  );

  app.patch("/api/backlog/issues/:key/status", express.json(), async (req, res) => {
    try {
      const { key } = req.params;
      const { statusId } = req.body;
      const result = await backlogService.updateIssueStatus(key, statusId);
      // Phase 22.21.20: Backlog webhook が安定して打ち返ってこない環境でも
      //   自動連鎖を発火させるため、status が「完了 (4)」になったら
      //   ここで直接 autoChainOnComplete を呼ぶ (冪等)。
      if (Number(statusId) === 4) {
        try {
          const issue = await backlogService.getIssue(key);
          await autoChainOnComplete(key, issue);
        } catch (chainErr) {
          console.warn(
            `[auto-chain] direct call from PATCH /status failed for ${key}:`,
            chainErr
          );
        }
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Phase 22.1: 「終結」アクション (= 既存課題に統合)。
   *
   * PATCH /api/backlog/issues/:key/terminate
   *   body: { merged_into_issue_key: "LEGAL-100", reason?: string, statusId?: number }
   *
   * 動作:
   *   1. Backlog 課題ステータスを「終結」に遷移 (statusId 必須 — Backlog 上の終結 status ID)
   *   2. legal_requests.merged_into_issue_key に統合先キーを保存
   *   3. Backlog 課題にコメントで「LEGAL-100 に統合」記録 (Q4 = a + c)
   *   4. Slack 通知 (申請者 + 部署チャンネル)
   */
  app.patch(
    "/api/backlog/issues/:key/terminate",
    express.json(),
    async (req, res) => {
      try {
        const { key } = req.params;
        const mergedInto = String(req.body?.merged_into_issue_key || "")
          .trim()
          .toUpperCase();
        const reason = req.body?.reason
          ? String(req.body.reason).slice(0, 500)
          : undefined;
        const statusId = Number(req.body?.statusId) || null;

        if (!mergedInto) {
          return res.status(400).json({
            ok: false,
            error: "merged_into_issue_key は必須です",
          });
        }
        if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(mergedInto)) {
          return res.status(400).json({
            ok: false,
            error: "merged_into_issue_key の形式が不正です (例: LEGAL-100)",
          });
        }

        // 1. Backlog の status を「終結」へ
        if (statusId) {
          try {
            await backlogService.updateIssueStatus(key, statusId);
          } catch (e: any) {
            console.warn(
              `[terminate] Backlog status update failed (${key}):`,
              e?.message || e
            );
          }
        }

        // 2. DB に merged_into_issue_key を保存
        try {
          await query(
            `UPDATE legal_requests
                SET merged_into_issue_key = $1
              WHERE backlog_issue_key = $2`,
            [mergedInto, key]
          );
        } catch (e) {
          console.warn(`[terminate] DB update failed (${key}):`, e);
        }

        // 3. issue_workflows のステータスも同期 (= "終結")
        try {
          await query(
            `UPDATE issue_workflows
                SET current_status_name = $1
              WHERE backlog_issue_key = $2`,
            ["終結", key]
          );
        } catch (e) {
          /* noop */
        }

        // 4. Backlog 課題にコメント追加
        let backlogCommented = false;
        if (!key.startsWith("MANUAL-")) {
          const reasonLine = reason ? `\n*理由:* ${reason}` : "";
          const body =
            `🔁 **本課題は終結しました**\n\n` +
            `この依頼は別の課題に統合されました。\n` +
            `*統合先:* ${mergedInto}` +
            reasonLine;
          try {
            await backlogService.addComment(key, body);
            backlogCommented = true;
          } catch (e: any) {
            console.warn(
              `[terminate] Backlog comment failed (${key}):`,
              e?.message || e
            );
          }
        }

        // 5. Slack 通知
        try {
          await notifyIssueEvent(key, {
            type: "status_changed",
            from: "(進行中)",
            to: `終結 → ${mergedInto} に統合`,
          });
        } catch (e) {
          console.warn(`[terminate] notify failed (${key}):`, e);
        }

        res.json({
          ok: true,
          key,
          merged_into_issue_key: mergedInto,
          backlog_commented: backlogCommented,
        });
      } catch (error: any) {
        console.error("PATCH /api/backlog/issues/:key/terminate failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

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

  // -------------------------------------------------------------------
  // Phase 20: 毎日定期アラート (Cloud Scheduler から呼ばれる)
  //
  // POST /api/management/daily-checks
  //   1. 発注書: 納期 7/3/1 日前 → 各 1 回通知
  //   2. 発注書: 納期超過 → 平日のみ毎日通知
  //   3. 契約書: 自動更新あり契約の通告期限の N カ月前 → 1 回通知
  //
  // 通知は notifyDeliveryAlert / notifyContractAlert に委譲。
  // -------------------------------------------------------------------

  /**
   * Phase 20 (修正版): 業務明細 (order_line_items) 1 行のアラート通知
   *
   * 業務明細レベルの納期 (oli.delivery_date) に対するアラート。
   * 申請者へ DM + 部署チャンネルへ <@申請者> メンション付き投稿。
   * 本文に「明細 #N (item_name)」を含めて、どの明細の話か明示する。
   */
  async function notifyLineItemAlert(
    row: any,
    issueKey: string,
    kind: "warning_7d" | "warning_3d" | "warning_1d" | "overdue",
    daysUntil: number
  ): Promise<void> {
    if (!slackWebClient) return;

    // 申請者 + 部署チャンネルを引く
    const ctxRes = await query(
      `SELECT
         lr.slack_user_id,
         lr.summary,
         lr.counterparty,
         lr.request_type,
         dwr.slack_channel_id
       FROM legal_requests lr
       LEFT JOIN staff s ON s.slack_user_id = lr.slack_user_id
       LEFT JOIN department_workflow_rules dwr
              ON dwr.department = COALESCE(s.department, lr.dept)
       WHERE lr.backlog_issue_key = $1
       LIMIT 1`,
      [issueKey]
    );
    const ctx = ctxRes.rows[0] || {};
    const slackUserId = String(ctx.slack_user_id || "").trim();

    const backlogHost = (
      dbSettings.BACKLOG_HOST ||
      process.env.BACKLOG_HOST ||
      ""
    ).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const backlogUrl = backlogHost
      ? `https://${backlogHost}/view/${issueKey}`
      : "";

    let header: string;
    if (kind === "warning_7d") header = `⏰ *納期 7 日前のお知らせ*`;
    else if (kind === "warning_3d") header = `⏰ *納期 3 日前*`;
    else if (kind === "warning_1d") header = `🚨 *納期前日 — 明日が期限です*`;
    else
      header = `🔴 *納期超過 ${Math.abs(daysUntil)} 日* — 延長または完了処理をお願いします`;

    const deadlineStr = row.delivery_date
      ? new Date(row.delivery_date).toLocaleDateString("ja-JP")
      : "—";

    const lines: string[] = [
      header,
      "",
      `*課題:* ${backlogUrl ? `<${backlogUrl}|${issueKey}>` : issueKey}`,
      `*業務明細:* #${row.line_no} ${row.item_name || ""}`,
    ];
    if (ctx.counterparty) lines.push(`*相手方:* ${ctx.counterparty}`);
    if (ctx.summary) lines.push(`*依頼:* ${ctx.summary}`);
    lines.push(`*納期:* ${deadlineStr}`);
    if (daysUntil >= 0) lines.push(`*残り:* ${daysUntil} 日`);

    const dmText = lines.join("\n");
    const channelText = slackUserId
      ? [`<@${slackUserId}> さんの依頼の納期アラートです`, "", ...lines].join(
          "\n"
        )
      : dmText;

    // DM
    if (slackUserId) {
      try {
        await slackWebClient.chat.postMessage({
          channel: slackUserId,
          text: dmText,
        });
      } catch (e: any) {
        console.warn(
          `[alert] line_item DM failed (${issueKey}#${row.line_no}):`,
          e?.message || e
        );
      }
    }
    // 部署チャンネル
    const channelId = String(ctx.slack_channel_id || "").trim();
    if (channelId) {
      try {
        await slackWebClient.chat.postMessage({
          channel: channelId,
          text: channelText,
        });
      } catch (e: any) {
        console.warn(
          `[alert] line_item channel failed (${issueKey}#${row.line_no}):`,
          e?.message || e
        );
      }
    }

    // 送信履歴を更新
    try {
      await query(
        `UPDATE order_line_items
            SET last_alert_at = CURRENT_TIMESTAMP,
                alert_count   = COALESCE(alert_count, 0) + 1
          WHERE id = $1`,
        [row.line_item_id]
      );
    } catch (e) {
      console.warn(
        `[alert] line_item flag update failed (id=${row.line_item_id}):`,
        e
      );
    }
  }

  /**
   * @deprecated Phase 20a 時点の delivery_events ベース実装。
   * 業務明細毎に納期を持つべき (= notifyLineItemAlert) ため未使用に。
   * コードは残置 (将来「検収期限超過アラート」を別途出す可能性)。
   */
  async function notifyDeliveryAlert(
    row: any,
    kind: "warning_7d" | "warning_3d" | "warning_1d" | "overdue",
    daysUntil: number
  ): Promise<void> {
    if (!slackWebClient) return;
    const issueKey = String(row.backlog_issue_key);

    // legal_requests + staff + department_workflow_rules を JOIN
    const ctxRes = await query(
      `SELECT
         lr.slack_user_id,
         lr.summary,
         lr.counterparty,
         lr.request_type,
         dwr.slack_channel_id
       FROM legal_requests lr
       LEFT JOIN staff s ON s.slack_user_id = lr.slack_user_id
       LEFT JOIN department_workflow_rules dwr
              ON dwr.department = COALESCE(s.department, lr.dept)
       WHERE lr.backlog_issue_key = $1
       LIMIT 1`,
      [issueKey]
    );
    const ctx = ctxRes.rows[0] || {};
    const slackUserId = String(ctx.slack_user_id || "").trim();

    const backlogHost = (
      dbSettings.BACKLOG_HOST ||
      process.env.BACKLOG_HOST ||
      ""
    ).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const backlogUrl = backlogHost
      ? `https://${backlogHost}/view/${issueKey}`
      : "";

    let header: string;
    if (kind === "warning_7d") header = `⏰ *納期 7 日前のお知らせ*`;
    else if (kind === "warning_3d") header = `⏰ *納期 3 日前*`;
    else if (kind === "warning_1d") header = `🚨 *納期前日 — 明日が期限です*`;
    else
      header = `🔴 *納期超過 ${Math.abs(daysUntil)} 日* — 延長または完了処理をお願いします`;

    const deadlineStr = row.inspection_deadline
      ? new Date(row.inspection_deadline).toLocaleDateString("ja-JP")
      : "—";

    const lines: string[] = [
      header,
      "",
      `*課題:* ${backlogUrl ? `<${backlogUrl}|${issueKey}>` : issueKey}`,
    ];
    if (ctx.counterparty) lines.push(`*相手方:* ${ctx.counterparty}`);
    if (ctx.summary) lines.push(`*概要:* ${ctx.summary}`);
    lines.push(`*納期:* ${deadlineStr}`);
    if (daysUntil >= 0) lines.push(`*残り:* ${daysUntil} 日`);

    const dmText = lines.join("\n");
    const channelText = slackUserId
      ? [`<@${slackUserId}> さんの依頼の納期アラートです`, "", ...lines].join(
          "\n"
        )
      : dmText;

    // DM
    if (slackUserId) {
      try {
        await slackWebClient.chat.postMessage({
          channel: slackUserId,
          text: dmText,
        });
      } catch (e: any) {
        console.warn(`[alert] delivery DM failed (${issueKey}):`, e?.message || e);
      }
    }
    // 部署チャンネル
    const channelId = String(ctx.slack_channel_id || "").trim();
    if (channelId) {
      try {
        await slackWebClient.chat.postMessage({
          channel: channelId,
          text: channelText,
        });
      } catch (e: any) {
        console.warn(
          `[alert] delivery channel failed (${issueKey} → ${channelId}):`,
          e?.message || e
        );
      }
    }

    // 送信履歴を更新 (失敗しても続行)
    try {
      await query(
        `UPDATE delivery_events
            SET last_alert_at = CURRENT_TIMESTAMP,
                alert_count   = COALESCE(alert_count, 0) + 1
          WHERE id = $1`,
        [row.id]
      );
    } catch (e) {
      console.warn(`[alert] delivery flag update failed (${issueKey}):`, e);
    }
  }

  /** 契約書 (contract_capabilities) 1 件のアラート通知。
   *
   * Phase 22.21.46:
   *   - row.alert_slack_channels (JSONB 配列) が設定されていれば全チャンネルに投稿。
   *     空配列なら env LB_CONTRACT_ALERT_CHANNEL_ID 1 件にフォールバック。
   *   - row.alert_slack_mentions (JSONB 配列) があれば本文先頭に prepend。
   */
  async function notifyContractAlert(row: any): Promise<void> {
    if (!slackWebClient) return;

    // 通知先チャンネルを決定。
    //   1. row.alert_slack_channels (per-contract, 複数可)
    //   2. env LB_CONTRACT_ALERT_CHANNEL_ID (legacy / global fallback)
    const perContractChannels: string[] = Array.isArray(row.alert_slack_channels)
      ? row.alert_slack_channels.filter((c: any) => c && String(c).trim())
      : [];
    const fallbackChannel =
      process.env.LB_CONTRACT_ALERT_CHANNEL_ID ||
      dbSettings.LB_CONTRACT_ALERT_CHANNEL_ID ||
      "";
    const targetChannels =
      perContractChannels.length > 0
        ? perContractChannels
        : fallbackChannel
        ? [fallbackChannel]
        : [];
    if (targetChannels.length === 0) {
      console.warn(
        `[alert] contract id=${row.id}: no Slack channel configured (per-contract or env)`
      );
      return;
    }

    // メンション (per-contract のみ; 空ならメンションなし)
    const mentions: string[] = Array.isArray(row.alert_slack_mentions)
      ? row.alert_slack_mentions.filter((m: any) => m && String(m).trim())
      : [];

    // vendor 名を引く
    let vendorName = "";
    try {
      if (row.vendor_id) {
        const v = await query(
          "SELECT vendor_name FROM vendors WHERE id = $1 LIMIT 1",
          [row.vendor_id]
        );
        vendorName = v.rows[0]?.vendor_name || "";
      }
    } catch {
      /* noop */
    }

    const expStr = row.expiration_date
      ? new Date(row.expiration_date).toLocaleDateString("ja-JP")
      : "—";
    const noticeMonths = Number(row.renewal_notice_months) || 0;
    const leadMonths = Number(row.alert_lead_months) || 0;

    // 通告期限 = expiration_date - noticeMonths months
    const noticeDate = row.expiration_date
      ? new Date(row.expiration_date)
      : null;
    if (noticeDate) noticeDate.setMonth(noticeDate.getMonth() - noticeMonths);
    const noticeStr = noticeDate
      ? noticeDate.toLocaleDateString("ja-JP")
      : "—";

    const lines: string[] = [];
    if (mentions.length > 0) {
      lines.push(mentions.join(" "));
    }
    lines.push(
      `🔔 *契約更新通告期限が近づいています*`,
      "",
      `*契約:* ${row.contract_title || "—"}`,
      `*取引先:* ${vendorName || "—"}`,
      `*満期日:* ${expStr}`,
      `*通告期限:* ${noticeStr} (満期の ${noticeMonths} カ月前)`,
      `*リード:* 通告期限の ${leadMonths} カ月前に通知`,
      `*自動更新:* ${row.auto_renewal ? "あり" : "なし"}`
    );
    const docUrl =
      row.legalon_url || row.cloudsign_url || row.drive_url || row.document_url;
    if (docUrl) lines.push(`*契約書:* ${docUrl}`);
    const messageText = lines.join("\n");

    // 全チャンネルに並列投稿。1 つが失敗しても他をブロックしない。
    await Promise.all(
      targetChannels.map(async (ch) => {
        try {
          await slackWebClient.chat.postMessage({
            channel: ch,
            text: messageText,
            link_names: true,
          });
        } catch (e: any) {
          console.warn(
            `[alert] contract channel failed (id=${row.id}, ch=${ch}):`,
            e?.message || e
          );
        }
      })
    );

    try {
      await query(
        `UPDATE contract_capabilities
            SET last_renewal_alert_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [row.id]
      );
    } catch (e) {
      console.warn(`[alert] contract flag update failed (id=${row.id}):`, e);
    }
  }

  /** 1 日分のアラート判定を走らせる */
  async function runDailyChecks(): Promise<{
    deliveryAlerts: number;
    contractAlerts: number;
  }> {
    const result = { deliveryAlerts: 0, contractAlerts: 0 };

    // 平日判定 (JST)。Cloud Scheduler は時刻は JST だが day は UTC で
    // 返るおそれもあるので、明示的に JST 換算する。
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const dayOfWeekJst = jstNow.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekday = dayOfWeekJst >= 1 && dayOfWeekJst <= 5;

    // ─── 1. 発注書 / 業務明細毎の納期アラート ────────────────────
    // Phase 20 (修正版): order_line_items.delivery_date を走査する。
    //   - 検収完了 (delivery_line_items.acceptance_ratio >= 1.0) の行は対象外
    //   - 7/3/1 日前 → 各 1 回通知
    //   - 期限超過 → 平日のみ毎日通知 (同日内重複は last_alert_at で抑止)
    try {
      const lineItems = await query(
        `SELECT
           oli.id            AS line_item_id,
           oli.order_item_id,
           oli.line_no,
           oli.item_name,
           oli.delivery_date,
           oi.backlog_issue_key,
           (oli.delivery_date - CURRENT_DATE) AS days_until
         FROM order_line_items oli
         JOIN order_items oi ON oi.id = oli.order_item_id
         WHERE oli.delivery_date IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM delivery_line_items dli
              WHERE dli.order_line_item_id = oli.id
                AND COALESCE(dli.acceptance_ratio, 1.0) >= 1.0
           )
           AND (
             (oli.delivery_date - CURRENT_DATE) IN (7, 3, 1)
             OR (oli.delivery_date - CURRENT_DATE) < 0
           )
           AND (
             oli.last_alert_at IS NULL
             OR oli.last_alert_at::date < CURRENT_DATE
           )`
      );
      for (const row of lineItems.rows) {
        const days = Number(row.days_until);
        let kind: "warning_7d" | "warning_3d" | "warning_1d" | "overdue";
        if (days === 7) kind = "warning_7d";
        else if (days === 3) kind = "warning_3d";
        else if (days === 1) kind = "warning_1d";
        else if (days < 0) {
          if (!isWeekday) continue; // 期限超過は平日のみ
          kind = "overdue";
        } else continue;

        const issueKey = String(row.backlog_issue_key || "");
        if (!issueKey) continue;
        await notifyLineItemAlert(row, issueKey, kind, days);
        result.deliveryAlerts++;
      }
    } catch (e) {
      console.error("[daily-checks] line_items scan failed:", e);
    }

    // ─── 2. 契約書アラート ───────────────────────────────────────
    try {
      const contracts = await query(
        `SELECT *
           FROM contract_capabilities
          WHERE expiration_date IS NOT NULL
            AND auto_renewal = TRUE
            AND renewal_notice_months IS NOT NULL
            AND alert_lead_months IS NOT NULL
            AND CURRENT_DATE >= (
              expiration_date
                - (renewal_notice_months + alert_lead_months) * INTERVAL '1 month'
            )::date
            AND CURRENT_DATE <= expiration_date
            AND (
              last_renewal_alert_at IS NULL
              OR last_renewal_alert_at::date < CURRENT_DATE
            )`
      );
      for (const row of contracts.rows) {
        await notifyContractAlert(row);
        result.contractAlerts++;
      }
    } catch (e) {
      console.error("[daily-checks] contract scan failed:", e);
    }

    console.log(
      `📅 [daily-checks] dispatched delivery=${result.deliveryAlerts} contract=${result.contractAlerts} (weekday=${isWeekday})`
    );
    return result;
  }

  /**
   * Phase 20 (修正版): 業務明細単位の納期延長コアロジック。
   *
   * 1. order_line_items.delivery_date を更新
   * 2. last_alert_at をリセット (= 新期日でアラートカウント再開)
   * 3. Backlog 課題にコメント追加で履歴を残す (Q3=a)
   *    Backlog のカスタムフィールドは更新しない (line item 概念が無いため)
   * 4. 申請者 + 部署チャンネルに Slack 通知
   */
  async function extendLineItemDeadline(
    lineItemId: number,
    newDate: string | Date,
    reason?: string
  ): Promise<{
    line_item_id: number;
    line_no: number;
    item_name: string;
    backlog_issue_key: string;
    previous_date: string | null;
    new_date: string;
    backlog_commented: boolean;
  }> {
    const d = new Date(newDate);
    if (Number.isNaN(d.getTime())) {
      throw new Error("invalid delivery_date");
    }
    const newDateStr = d.toISOString().slice(0, 10);

    // 旧値 + 紐付く Backlog issue key を取得
    const prevRes = await query(
      `SELECT
         oli.id, oli.line_no, oli.item_name, oli.delivery_date,
         oi.backlog_issue_key
       FROM order_line_items oli
       JOIN order_items oi ON oi.id = oli.order_item_id
       WHERE oli.id = $1`,
      [lineItemId]
    );
    const prev = prevRes.rows[0];
    if (!prev) {
      throw new Error("order_line_item not found");
    }
    const issueKey = String(prev.backlog_issue_key || "");
    const previousDateStr = prev.delivery_date
      ? new Date(prev.delivery_date).toISOString().slice(0, 10)
      : null;

    // 1. DB 更新 + アラートカウントリセット
    await query(
      `UPDATE order_line_items
          SET delivery_date  = $1,
              last_alert_at  = NULL,
              alert_count    = 0,
              updated_at     = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [newDateStr, lineItemId]
    );

    // 2. Backlog コメント追加 (履歴目的)
    let backlogCommented = false;
    if (issueKey && !issueKey.startsWith("MANUAL-")) {
      const reasonLine = reason ? `\n*変更理由:* ${reason}` : "";
      const body =
        `📅 **業務明細の納期を変更しました**\n\n` +
        `*明細:* #${prev.line_no} ${prev.item_name || ""}\n` +
        `*変更前:* ${previousDateStr || "(未設定)"}\n` +
        `*変更後:* ${newDateStr}` +
        reasonLine;
      try {
        await backlogService.addComment(issueKey, body);
        backlogCommented = true;
      } catch (e: any) {
        console.warn(
          `[line-item-extend] Backlog comment failed (${issueKey}#${prev.line_no}):`,
          e?.message || e
        );
      }
    }

    // 3. Slack 通知
    if (issueKey) {
      try {
        await notifyIssueEvent(issueKey, {
          type: "status_changed",
          from: `明細 #${prev.line_no} 納期 ${previousDateStr || "(未設定)"}`,
          to: `明細 #${prev.line_no} 納期 ${newDateStr} に変更`,
        });
      } catch (e) {
        console.warn(
          `[line-item-extend] notify failed (${issueKey}#${prev.line_no}):`,
          e
        );
      }
    }

    return {
      line_item_id: prev.id,
      line_no: prev.line_no,
      item_name: prev.item_name || "",
      backlog_issue_key: issueKey,
      previous_date: previousDateStr,
      new_date: newDateStr,
      backlog_commented: backlogCommented,
    };
  }

  /**
   * @deprecated Phase 20b 時点の delivery_events ベース実装。
   * 業務明細毎に納期を持つべき (= extendLineItemDeadline) ため未使用に。
   * 互換のためエンドポイントは残置するが、新規 admin-ui は line-item 経路を使う。
   */
  async function extendDeliveryDeadline(
    target: { id?: number; issueKey?: string },
    newDeadline: string | Date
  ): Promise<{
    id: number;
    backlog_issue_key: string;
    previous_deadline: string | null;
    new_deadline: string;
    backlog_synced: boolean;
  }> {
    const d = new Date(newDeadline);
    if (Number.isNaN(d.getTime())) {
      throw new Error("invalid inspection_deadline");
    }

    // 旧値を取得
    const prevRes = target.id
      ? await query(
          `SELECT id, backlog_issue_key, inspection_deadline
             FROM delivery_events WHERE id = $1`,
          [target.id]
        )
      : await query(
          `SELECT id, backlog_issue_key, inspection_deadline
             FROM delivery_events WHERE backlog_issue_key = $1`,
          [target.issueKey]
        );
    const prev = prevRes.rows[0];
    if (!prev) {
      throw new Error("delivery_event not found");
    }

    // 1. DB 更新 (last_alert_at リセット)
    await query(
      `UPDATE delivery_events
          SET inspection_deadline = $1,
              last_alert_at       = NULL,
              alert_count         = 0
        WHERE id = $2`,
      [d.toISOString(), prev.id]
    );

    // 2. Backlog 同期 (Q3=b: 「希望納期」カスタムフィールドも同期更新)
    let backlogSynced = false;
    const issueKey = prev.backlog_issue_key;
    if (issueKey && !issueKey.startsWith("MANUAL-")) {
      try {
        await backlogService.updateIssue(issueKey, {
          deadline: d.toISOString().slice(0, 10),
        });
        backlogSynced = true;
      } catch (e: any) {
        console.warn(
          `[delivery-extend] Backlog sync failed (${issueKey}):`,
          e?.message || e
        );
      }
    }

    // 3. Slack 通知 (任意・延長したことを申請者と部署に共有)
    if (issueKey) {
      try {
        await notifyIssueEvent(issueKey, {
          type: "status_changed",
          from: `納期 ${
            prev.inspection_deadline
              ? new Date(prev.inspection_deadline).toLocaleDateString("ja-JP")
              : "—"
          }`,
          to: `納期 ${d.toLocaleDateString("ja-JP")} に変更`,
        });
      } catch (e) {
        console.warn(`[delivery-extend] notify failed (${issueKey}):`, e);
      }
    }

    return {
      id: prev.id,
      backlog_issue_key: issueKey,
      previous_deadline: prev.inspection_deadline
        ? new Date(prev.inspection_deadline).toISOString()
        : null,
      new_deadline: d.toISOString(),
      backlog_synced: backlogSynced,
    };
  }

  // -------------------------------------------------------------------
  // Phase 20 (修正版): 業務明細レベルのエンドポイント
  // -------------------------------------------------------------------

  // GET /api/management/issues/:issueKey/line-items
  //   admin-ui WorkflowPanel が「この issue の業務明細一覧 + 納期」を取得する用。
  app.get(
    "/api/management/issues/:issueKey/line-items",
    async (req, res) => {
      try {
        const issueKey = String(req.params.issueKey || "").trim();
        if (!issueKey) {
          return res.status(400).json({ ok: false, error: "issueKey required" });
        }
        const r = await query(
          `SELECT
             oli.id              AS line_item_id,
             oli.order_item_id,
             oli.line_no,
             oli.item_name,
             oli.spec,
             oli.unit_price,
             oli.quantity,
             oli.amount_ex_tax,
             oli.delivery_date,
             oli.last_alert_at,
             oli.alert_count,
             EXISTS (
               SELECT 1 FROM delivery_line_items dli
                WHERE dli.order_line_item_id = oli.id
                  AND COALESCE(dli.acceptance_ratio, 1.0) >= 1.0
             ) AS accepted
           FROM order_line_items oli
           JOIN order_items oi ON oi.id = oli.order_item_id
          WHERE oi.backlog_issue_key = $1
          ORDER BY oli.line_no`,
          [issueKey]
        );
        res.json({ ok: true, line_items: r.rows });
      } catch (e: any) {
        console.error(
          "GET /api/management/issues/:issueKey/line-items failed:",
          e
        );
        res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }
  );

  /**
   * Phase 22.2: Slack /法務依頼 V2 select 用候補取得エンドポイント。
   *
   * 申請者の未完了課題から、紐付け候補を返す:
   *   type=delivery_inspec  → 申請者の発注書由来 納品報告子課題
   *   type=license_calc     → 申請者の個別利用許諾由来 利用許諾報告子課題
   *   type=any              → 申請者の未完了課題すべて (納期変更用)
   */
  app.get(
    "/api/management/users/:slackUserId/candidates",
    async (req, res) => {
      try {
        const slackUserId = String(req.params.slackUserId || "").trim();
        const filterType = String(req.query.type || "any").trim();
        if (!slackUserId) {
          return res
            .status(400)
            .json({ ok: false, error: "slackUserId required" });
        }

        const params: any[] = [slackUserId];
        let typeClause = "";
        if (filterType === "delivery_inspec" || filterType === "license_calc") {
          params.push(filterType);
          typeClause = `AND lr.contract_type = $2`;
        }

        const r = await query(
          `SELECT lr.backlog_issue_key AS issue_key,
                  lr.contract_type     AS request_type,
                  lr.summary,
                  lr.counterparty,
                  lr.slack_user_id,
                  iw.current_status_name AS status,
                  lr.created_at
             FROM legal_requests lr
             LEFT JOIN issue_workflows iw
                    ON iw.backlog_issue_key = lr.backlog_issue_key
            WHERE lr.slack_user_id = $1
              AND COALESCE(iw.current_status_name, '') NOT IN
                  ('完了', '終結', 'キャンセル')
              ${typeClause}
            ORDER BY lr.created_at DESC
            LIMIT 25`,
          params
        );

        res.json({ ok: true, candidates: r.rows });
      } catch (e: any) {
        console.error(
          "GET /api/management/users/:slackUserId/candidates failed:",
          e
        );
        res
          .status(500)
          .json({ ok: false, error: String(e?.message || e) });
      }
    }
  );

  /**
   * Phase 22.2: Slack /法務依頼 で候補課題が選択されたときの紐付け
   * エンドポイント。
   *
   * GAS が、新規 Backlog 課題を作らずに既存子課題を活用する経路で使う。
   * 1. 子課題のステータスを「トリガー待ち → 未対応」に遷移 (Backlog + DB)
   * 2. その後 processLegalRequestSubmission を呼んで通常の文書生成を走らせる
   *    (existing_issue_key を渡してパイプライン側で issue 作成スキップ)
   *
   * POST /api/intake/link-trigger
   *   body: LegalRequestSubmission + existing_issue_key (必須)
   */
  app.post("/api/intake/link-trigger", express.json(), async (req, res) => {
    try {
      const input = req.body || {};
      const childKey = String(input.existing_issue_key || "").trim();
      if (!childKey) {
        return res
          .status(400)
          .json({ ok: false, error: "existing_issue_key required" });
      }

      // Step 1: 子課題が トリガー待ち なら 未対応 に進める
      try {
        const wfRes = await query(
          "SELECT current_status_name FROM issue_workflows WHERE backlog_issue_key = $1",
          [childKey]
        );
        const currentStatusName = wfRes.rows[0]?.current_status_name || null;
        if (currentStatusName === "トリガー待ち") {
          const statuses = await backlogService.getStatuses();
          const target = (statuses as any[]).find(
            (s: any) => s?.name === "未対応"
          );
          if (target) {
            try {
              await backlogService.updateIssueStatus(childKey, target.id);
            } catch (e) {
              console.warn(
                `[link-trigger] Backlog status update failed (${childKey}):`,
                e
              );
            }
          }
          await query(
            "UPDATE issue_workflows SET current_status_name = '未対応' WHERE backlog_issue_key = $1",
            [childKey]
          );
        }
      } catch (e) {
        console.warn(`[link-trigger] pre-pipeline error:`, e);
      }

      // Step 2: 通常パイプライン (文書生成 + 通知)
      const result = await processLegalRequestSubmission(input);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("/api/intake/link-trigger failed:", e);
      res
        .status(500)
        .json({ ok: false, error: String(e?.message || e) });
    }
  });

  /**
   * Phase 22.4: 一括納期変更のコアロジック (関数化)。
   *
   * 旧 Phase 21 のエンドポイント内ロジックを抽出。
   *   - 既存の Slack 即時実行経路 (admin-ui 等) からも引き続き使用
   *   - Phase 22.4 の納期変更依頼 完了時 (= 法務承認後) の executeDeadlineChangeRequest からも呼ばれる
   */
  async function applyBulkDeadlineChange(
    targetIssueKey: string,
    newDeliveryDate: string,
    reason?: string,
    contextLabel?: string
  ): Promise<{
    issue_key: string;
    new_date: string;
    updated: Array<{
      line_item_id: number;
      line_no: number;
      item_name: string;
      previous_date: string | null;
    }>;
    backlog_commented: boolean;
  }> {
    const d = new Date(newDeliveryDate);
    if (Number.isNaN(d.getTime())) {
      throw new Error("invalid delivery_date");
    }
    const newDateStr = d.toISOString().slice(0, 10);

    // 未完了 line items を全取得
    const itemsRes = await query(
      `SELECT oli.id, oli.line_no, oli.item_name, oli.delivery_date
         FROM order_line_items oli
         JOIN order_items oi ON oi.id = oli.order_item_id
        WHERE oi.backlog_issue_key = $1
          AND NOT EXISTS (
            SELECT 1 FROM delivery_line_items dli
             WHERE dli.order_line_item_id = oli.id
               AND COALESCE(dli.acceptance_ratio, 1.0) >= 1.0
          )
        ORDER BY oli.line_no`,
      [targetIssueKey]
    );

    if (itemsRes.rows.length === 0) {
      throw new Error(
        `${targetIssueKey} に未完了の業務明細が見つかりません`
      );
    }

    const updated: Array<{
      line_item_id: number;
      line_no: number;
      item_name: string;
      previous_date: string | null;
    }> = [];

    for (const item of itemsRes.rows) {
      await query(
        `UPDATE order_line_items
            SET delivery_date  = $1,
                last_alert_at  = NULL,
                alert_count    = 0,
                updated_at     = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [newDateStr, item.id]
      );
      updated.push({
        line_item_id: item.id,
        line_no: item.line_no,
        item_name: item.item_name || "",
        previous_date: item.delivery_date
          ? new Date(item.delivery_date).toISOString().slice(0, 10)
          : null,
      });
    }

    // Backlog コメントで履歴を残す
    let backlogCommented = false;
    if (!targetIssueKey.startsWith("MANUAL-")) {
      const reasonLine = reason ? `\n*変更理由:* ${reason}` : "";
      const ctxLine = contextLabel ? ` (${contextLabel})` : "";
      const detailList = updated
        .map(
          (u) =>
            `  - #${u.line_no} ${u.item_name} (旧: ${u.previous_date || "未設定"})`
        )
        .join("\n");
      const body =
        `📅 **業務明細の納期を一括変更しました**${ctxLine}\n\n` +
        `*新しい納期:* ${newDateStr}\n` +
        `*対象明細:* ${updated.length} 件\n` +
        detailList +
        reasonLine;
      try {
        await backlogService.addComment(targetIssueKey, body);
        backlogCommented = true;
      } catch (e: any) {
        console.warn(
          `[deadline-change] Backlog comment failed (${targetIssueKey}):`,
          e?.message || e
        );
      }
    }

    // Slack 通知
    try {
      await notifyIssueEvent(targetIssueKey, {
        type: "status_changed",
        from: `業務明細 ${updated.length} 件の旧納期`,
        to: `全 ${updated.length} 件を ${newDateStr} に変更${
          contextLabel ? " (" + contextLabel + ")" : ""
        }`,
      });
    } catch (e) {
      console.warn(`[deadline-change] notify failed (${targetIssueKey}):`, e);
    }

    return {
      issue_key: targetIssueKey,
      new_date: newDateStr,
      updated,
      backlog_commented: backlogCommented,
    };
  }

  /**
   * Phase 22.4: 納期変更依頼 (deadline_change request_type) が「完了」遷移
   * したときの実行ロジック。worker webhook type=2 から呼ばれる。
   *
   * legal_requests.notes に保存された JSON から target/new_date/reason を
   * 取り出し、applyBulkDeadlineChange を実行。idempotency は notes.executed で。
   */
  async function executeDeadlineChangeRequest(
    issueKey: string,
    notesJson: string | null
  ): Promise<void> {
    if (!notesJson) {
      console.warn(`[deadline-change-execute] empty notes for ${issueKey}`);
      return;
    }
    let notes: any = {};
    try {
      notes = JSON.parse(notesJson);
    } catch {
      console.warn(
        `[deadline-change-execute] failed to parse notes for ${issueKey}`
      );
      return;
    }

    if (notes.executed) {
      console.log(
        `[deadline-change-execute] ${issueKey} already executed at ${notes.executed_at}, skip`
      );
      return;
    }

    const target = String(notes.target_issue_key || "").trim();
    const newDate = String(notes.new_delivery_date || "").trim();
    const reason = notes.reason ? String(notes.reason) : undefined;

    if (!target || !newDate) {
      console.warn(
        `[deadline-change-execute] invalid notes for ${issueKey}: target=${target}, newDate=${newDate}`
      );
      return;
    }

    try {
      const result = await applyBulkDeadlineChange(
        target,
        newDate,
        reason,
        "Slack 申請 → 法務承認 (admin-ui で実行)"
      );

      // mark as executed (idempotency)
      notes.executed = true;
      notes.executed_at = new Date().toISOString();
      notes.result = {
        updated_count: result.updated.length,
        new_date: result.new_date,
      };
      await query(
        "UPDATE legal_requests SET notes = $1 WHERE backlog_issue_key = $2",
        [JSON.stringify(notes), issueKey]
      );

      console.log(
        `✅ [deadline-change-execute] ${issueKey}: ${target} → ${newDate} (${result.updated.length} 明細更新)`
      );
    } catch (e: any) {
      console.error(
        `[deadline-change-execute] failed for ${issueKey}:`,
        e?.message || e
      );
      // throw しない (webhook handler を 500 にしない、ログだけ残す)
    }
  }

  /**
   * Phase 21 → 22.4: Slack /法務依頼 「納期変更依頼」起票エンドポイント。
   *
   * V1 (Phase 21): GAS が直接 /api/management/issues/:key/deadline-change を叩いて即時実行
   * V2 (Phase 22.4): 新規 Backlog 課題を作成、法務承認後 (= 完了遷移) に実行
   *
   * POST /api/intake/deadline-change-request
   *   body: { slack_user_id, slack_user_name?, dept?, target_issue_key, new_delivery_date, reason }
   */
  app.post(
    "/api/intake/deadline-change-request",
    express.json(),
    async (req, res) => {
      try {
        const {
          slack_user_id,
          target_issue_key,
          new_delivery_date,
          reason,
        } = req.body || {};

        if (!slack_user_id) {
          return res
            .status(400)
            .json({ ok: false, error: "slack_user_id required" });
        }
        if (!target_issue_key) {
          return res
            .status(400)
            .json({ ok: false, error: "target_issue_key required" });
        }
        if (!new_delivery_date) {
          return res
            .status(400)
            .json({ ok: false, error: "new_delivery_date required" });
        }

        const targetKey = String(target_issue_key).trim().toUpperCase();
        const newDate = String(new_delivery_date).trim();
        const reasonStr = reason ? String(reason).slice(0, 500) : "";

        // Backlog issue type: 専用が無ければ「法務相談」を流用
        const issueTypes = await backlogService.getIssueTypes();
        const dlrType =
          (issueTypes as any[]).find((t: any) => t.name === "納期変更依頼") ||
          (issueTypes as any[]).find((t: any) => t.name === "法務相談");
        if (!dlrType) {
          return res.status(500).json({
            ok: false,
            error: "Backlog issue type not available",
          });
        }

        // Backlog 課題作成
        const created = await backlogService.createIssue({
          summary: `[納期変更依頼] ${targetKey} → ${newDate}`,
          description:
            `納期変更を申請します。\n\n` +
            `*対象:* ${targetKey}\n` +
            `*新しい納期:* ${newDate}\n` +
            `*変更理由:* ${reasonStr || "(記載なし)"}\n` +
            `*申請者:* <@${slack_user_id}>\n\n` +
            `※ 法務担当者が内容を確認の上、admin-ui から「完了」遷移すると実際の納期変更が実行されます。`,
          issueTypeId: dlrType.id,
          priorityId: 3,
        });

        if (!created?.issueKey) {
          return res
            .status(500)
            .json({ ok: false, error: "Backlog issue creation failed" });
        }
        const issueKey = created.issueKey;

        // DB に保存
        const notes = JSON.stringify({
          type: "deadline_change_request",
          target_issue_key: targetKey,
          new_delivery_date: newDate,
          reason: reasonStr,
          requested_at: new Date().toISOString(),
          executed: false,
        });

        try {
          await query(
            `INSERT INTO legal_requests
               (backlog_issue_key, slack_user_id, contract_type, counterparty, summary, deadline, notes)
             VALUES ($1, $2, 'deadline_change', '', $3, NULL, $4)
             ON CONFLICT (backlog_issue_key) DO UPDATE SET
               contract_type = EXCLUDED.contract_type,
               summary       = EXCLUDED.summary,
               notes         = EXCLUDED.notes`,
            [issueKey, slack_user_id, `納期変更依頼 → ${targetKey}`, notes]
          );
          await query(
            `INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name)
             VALUES ($1, 'deadline_change', '未対応')
             ON CONFLICT (backlog_issue_key) DO UPDATE SET
               issue_type_name     = EXCLUDED.issue_type_name,
               current_status_name = '未対応'`,
            [issueKey]
          );
        } catch (e) {
          console.warn(
            `[deadline-change-request] DB insert failed for ${issueKey}:`,
            e
          );
        }

        res.json({ ok: true, issue_key: issueKey });
      } catch (e: any) {
        console.error("/api/intake/deadline-change-request failed:", e);
        res
          .status(500)
          .json({ ok: false, error: String(e?.message || e) });
      }
    }
  );

  /**
   * Phase 21 (legacy): 即時実行エンドポイント。Phase 22.4 で GAS は使わなく
   * なったが、admin-ui や運用ツールから直接叩く用途で残置。
   *
   * POST /api/management/issues/:issueKey/deadline-change
   *   body: { delivery_date: "YYYY-MM-DD", reason?: string }
   */
  app.post(
    "/api/management/issues/:issueKey/deadline-change",
    express.json(),
    async (req, res) => {
      try {
        const issueKey = String(req.params.issueKey || "").trim();
        if (!issueKey) {
          return res
            .status(400)
            .json({ ok: false, error: "issueKey is required" });
        }
        const newDate = req.body?.delivery_date;
        if (!newDate) {
          return res
            .status(400)
            .json({ ok: false, error: "delivery_date is required" });
        }
        const reason = req.body?.reason
          ? String(req.body.reason).slice(0, 500)
          : undefined;

        const result = await applyBulkDeadlineChange(
          issueKey,
          newDate,
          reason,
          "直接 API 呼び出し"
        );

        res.json({ ok: true, ...result });
      } catch (e: any) {
        console.error(
          "POST /api/management/issues/:issueKey/deadline-change failed:",
          e
        );
        const msg = String(e?.message || e);
        const status =
          /見つかりません|invalid|required/i.test(msg) ? 400 : 500;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  // PATCH /api/management/order-line-items/:id/deadline
  //   業務明細単位の納期延長。Phase 20 修正後の主経路。
  app.patch(
    "/api/management/order-line-items/:id/deadline",
    express.json(),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) {
          return res.status(400).json({ ok: false, error: "invalid id" });
        }
        const newDate = req.body?.delivery_date;
        if (!newDate) {
          return res
            .status(400)
            .json({ ok: false, error: "delivery_date is required" });
        }
        const reason = req.body?.reason
          ? String(req.body.reason).slice(0, 500)
          : undefined;
        const result = await extendLineItemDeadline(id, newDate, reason);
        res.json({ ok: true, ...result });
      } catch (e: any) {
        console.error(
          "PATCH /api/management/order-line-items/:id/deadline failed:",
          e
        );
        const msg = String(e?.message || e);
        const status = /not found|invalid/.test(msg) ? 400 : 500;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  // -------------------------------------------------------------------
  // @deprecated Phase 20a 時点の delivery_events ベース endpoint。
  // 互換のため残置するが、新 admin-ui は使わない。
  // -------------------------------------------------------------------

  // PATCH /api/management/issues/:issueKey/deadline
  //   admin-ui 等が backlog_issue_key で叩く用。
  app.patch(
    "/api/management/issues/:issueKey/deadline",
    express.json(),
    async (req, res) => {
      try {
        const issueKey = String(req.params.issueKey || "").trim();
        if (!issueKey) {
          return res
            .status(400)
            .json({ ok: false, error: "issueKey is required" });
        }
        const newDeadline = req.body?.inspection_deadline;
        if (!newDeadline) {
          return res
            .status(400)
            .json({ ok: false, error: "inspection_deadline is required" });
        }
        const result = await extendDeliveryDeadline({ issueKey }, newDeadline);
        res.json({ ok: true, ...result });
      } catch (e: any) {
        console.error(
          "PATCH /api/management/issues/:issueKey/deadline failed:",
          e
        );
        const msg = String(e?.message || e);
        const status = /not found|invalid/.test(msg) ? 400 : 500;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  // POST /api/management/daily-checks — Cloud Scheduler が朝 9:00 (JST) に叩く
  app.post("/api/management/daily-checks", async (_req, res) => {
    try {
      const r = await runDailyChecks();
      res.json({ ok: true, ...r });
    } catch (e: any) {
      console.error("/api/management/daily-checks failed:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // -------------------------------------------------------------------
  // Phase 20: 納期変更 (admin-ui 延長ボタン / Phase 21 のスラック申請)
  //
  // PATCH /api/management/delivery-events/:id
  //   body: { inspection_deadline: ISO8601, reason?: string }
  //   1. DB の inspection_deadline を更新
  //   2. last_alert_at をリセット (= 新しい期日でアラートカウント再開)
  //   3. Backlog 課題のカスタムフィールド「希望納期」も同期更新
  // -------------------------------------------------------------------
  // PATCH /api/management/delivery-events/:id
  //   内部 admin 用 (id で叩く)。ロジックは extendDeliveryDeadline に集約。
  app.patch(
    "/api/management/delivery-events/:id",
    express.json(),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) {
          return res.status(400).json({ ok: false, error: "invalid id" });
        }
        const newDeadline = req.body?.inspection_deadline;
        if (!newDeadline) {
          return res
            .status(400)
            .json({ ok: false, error: "inspection_deadline is required" });
        }
        const result = await extendDeliveryDeadline({ id }, newDeadline);
        res.json({ ok: true, ...result });
      } catch (e: any) {
        console.error("PATCH /api/management/delivery-events failed:", e);
        const msg = String(e?.message || e);
        const status = /not found|invalid/.test(msg) ? 400 : 500;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

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
    // Phase 22.13: vendor_rep + contacts[] を受け取れるよう拡張。
    //   contacts[] = [{ contact_name, contact_department?, title?, email?, phone?, is_primary?, sort_order?, remarks? }]
    //   contacts[] が渡されたら既存を全削除して入れ直し (= replacement semantics)。
    //   primary 担当者の name を vendors.contact_name にミラーして legacy 互換を維持。
    const v = req.body;
    try {
      // 1) vendor 本体 upsert (vendor_rep 追加)
      const upsert = await query(
        `INSERT INTO vendors (vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
          withholding_enabled, aliases, address, phone, email, contact_department, contact_name,
          master_contract_ref, bank_info, bank_name, branch_name, account_type, account_number,
          account_holder_kana, is_invoice_issuer, invoice_registration_number, vendor_rep)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
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
           invoice_registration_number = EXCLUDED.invoice_registration_number,
           vendor_rep = EXCLUDED.vendor_rep
         RETURNING id`,
        [
          v.vendor_code, v.vendor_name, v.trade_name || null, v.pen_name || null,
          v.vendor_suffix || null, v.entity_type || null, v.withholding_enabled || false,
          v.aliases || null, v.address || null, v.phone || null, v.email || null,
          v.contact_department || null, v.contact_name || null, v.master_contract_ref || null,
          v.bank_info || null, v.bank_name || null, v.branch_name || null, v.account_type || null,
          v.account_number || null, v.account_holder_kana || null, v.is_invoice_issuer || false,
          v.invoice_registration_number || null,
          v.vendor_rep || null,
        ]
      );
      const vendorId = Number(upsert.rows[0]?.id);

      // 2) contacts[] (Phase 22.13) — 配列が渡された場合のみ反映。
      //    渡されない (undefined) の場合は既存テーブルを触らない (後方互換)。
      if (Array.isArray(v.contacts) && vendorId) {
        const contacts: any[] = v.contacts
          .filter((c: any) => c && (c.contact_name || "").trim())
          .map((c: any, idx: number) => ({
            contact_name: String(c.contact_name).trim(),
            contact_department: c.contact_department || null,
            title: c.title || null,
            email: c.email || null,
            phone: c.phone || null,
            is_primary: !!c.is_primary,
            sort_order: Number.isFinite(Number(c.sort_order))
              ? Number(c.sort_order)
              : idx,
            remarks: c.remarks || null,
          }));

        // primary 担当者がない場合は先頭を primary に昇格 (一覧で必ず 1 件 primary)
        if (contacts.length > 0 && !contacts.some((c) => c.is_primary)) {
          contacts[0].is_primary = true;
        }

        await query("DELETE FROM vendor_contacts WHERE vendor_id = $1", [vendorId]);
        for (const c of contacts) {
          await query(
            `INSERT INTO vendor_contacts
              (vendor_id, contact_name, contact_department, title, email, phone, is_primary, sort_order, remarks)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              vendorId,
              c.contact_name,
              c.contact_department,
              c.title,
              c.email,
              c.phone,
              c.is_primary,
              c.sort_order,
              c.remarks,
            ]
          );
        }

        // 後方互換: primary contact の name を vendors.contact_name にミラー
        const primary = contacts.find((c) => c.is_primary) || contacts[0];
        if (primary) {
          await query(
            `UPDATE vendors
                SET contact_name        = $1,
                    contact_department  = COALESCE($2, contact_department)
              WHERE id = $3`,
            [primary.contact_name, primary.contact_department, vendorId]
          );
        }
      }

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

  // Phase 22.21.46: 文字列 (CSV / 改行区切り) / 配列の入力を JSONB 配列に正規化。
  //   admin-ui が "#legal, #ops" を送ってきても、["#legal","#ops"] を送ってきても
  //   両方を受け付ける。空文字 / null / undefined は [] にする。
  function normalizeAlertList(v: any): string[] {
    if (v == null) return [];
    if (Array.isArray(v)) {
      return v.map((s) => String(s).trim()).filter(Boolean);
    }
    return String(v)
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Phase 22.21.46: 文書番号が空のときの自動採番。
  //   入力フォームから document_number が空で来た場合に、worker の発番ロジックで
  //   1 件発行して上書きする。inferContractType 相当の判定は admin-ui 側で
  //   contract_type を選んで送ってくれているので、それを type ヒントに使う。
  async function ensureDocumentNumber(input: any, contractType: string): Promise<string> {
    const v = String(input || "").trim();
    if (v) return v;
    // contract_type が分かれば prefix が引ける (例: "service_basic" → SVC)。
    // 引けない場合は getNewDocumentNumber の最後の fallback (3 文字大文字) になる。
    return await getNewDocumentNumber(contractType || "external_contract");
  }

  app.post("/api/master/contracts", express.json(), async (req, res) => {
    const {
      vendor_id, record_type, contract_category, contract_type, contract_title,
      document_number, contract_status, effective_date, expiration_date, auto_renewal,
      original_work, product_name, work_name, media, territory, language, document_url, condition_number,
      // Phase 20: 更新アラート用フィールド
      renewal_notice_months, alert_lead_months,
      // Phase 22.9: 有効/無効フラグ
      is_active,
      // Phase 22.21.46: Slack アラート設定 (複数チャンネル / 複数メンション)
      alert_slack_channels, alert_slack_mentions,
    } = req.body;
    try {
      const channels = normalizeAlertList(alert_slack_channels);
      const mentions = normalizeAlertList(alert_slack_mentions);
      const finalDocNumber = await ensureDocumentNumber(document_number, contract_type);
      const result = await query(
        `INSERT INTO contract_capabilities (
          vendor_id, record_type, contract_category, contract_type, contract_title,
          document_number, contract_status, effective_date, expiration_date, auto_renewal,
          original_work, product_name, work_name, media, territory, language, document_url, condition_number,
          renewal_notice_months, alert_lead_months,
          is_active,
          alert_slack_channels, alert_slack_mentions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23::jsonb)
        RETURNING id, document_number`,
        [
          vendor_id || null, record_type || "master_contract", contract_category || "service",
          contract_type || "service_basic", contract_title, finalDocNumber,
          contract_status || "executed", effective_date || null, expiration_date || null,
          // Boolean 正規化 — 't' / 'f' / 1 / 0 / 文字列 'true' なども受け取れるように
          auto_renewal === true || auto_renewal === "t" || auto_renewal === "true" || auto_renewal === 1,
          original_work || "", product_name || "", work_name || "",
          media || "", territory || "", language || "", document_url || "", condition_number || "",
          renewal_notice_months != null && renewal_notice_months !== "" ? Number(renewal_notice_months) : null,
          alert_lead_months != null && alert_lead_months !== "" ? Number(alert_lead_months) : null,
          // is_active 省略時は TRUE (有効)
          is_active === undefined || is_active === null ? true : Boolean(is_active),
          JSON.stringify(channels),
          JSON.stringify(mentions),
        ]
      );
      res.json({
        success: true,
        id: result.rows[0].id,
        document_number: result.rows[0].document_number,
        document_number_auto: !String(document_number || "").trim(),
      });
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
      // Phase 20: 更新アラート用フィールド
      renewal_notice_months, alert_lead_months,
      // Phase 22.9: 有効/無効フラグ
      is_active,
      // Phase 22.21.46: Slack アラート設定
      alert_slack_channels, alert_slack_mentions,
    } = req.body;
    try {
      const channels = normalizeAlertList(alert_slack_channels);
      const mentions = normalizeAlertList(alert_slack_mentions);
      const finalDocNumber = await ensureDocumentNumber(document_number, contract_type);
      await query(
        `UPDATE contract_capabilities SET
          vendor_id = $1, record_type = $2, contract_category = $3, contract_type = $4,
          contract_title = $5, document_number = $6, contract_status = $7,
          effective_date = $8, expiration_date = $9, auto_renewal = $10,
          original_work = $11, product_name = $12, work_name = $13, media = $14,
          territory = $15, language = $16, document_url = $17, condition_number = $18,
          renewal_notice_months = $19, alert_lead_months = $20,
          is_active = $21,
          alert_slack_channels = $22::jsonb,
          alert_slack_mentions = $23::jsonb,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $24`,
        [
          vendor_id || null, record_type, contract_category, contract_type, contract_title,
          finalDocNumber, contract_status, effective_date || null, expiration_date || null,
          // Boolean 正規化
          auto_renewal === true || auto_renewal === "t" || auto_renewal === "true" || auto_renewal === 1,
          original_work || "", product_name || "", work_name || "",
          media || "", territory || "", language || "", document_url || "", condition_number || "",
          renewal_notice_months != null && renewal_notice_months !== "" ? Number(renewal_notice_months) : null,
          alert_lead_months != null && alert_lead_months !== "" ? Number(alert_lead_months) : null,
          is_active === undefined || is_active === null ? true : Boolean(is_active),
          JSON.stringify(channels),
          JSON.stringify(mentions),
          id,
        ]
      );
      res.json({
        success: true,
        document_number: finalDocNumber,
        document_number_auto: !String(document_number || "").trim(),
      });
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

  // -------------------------------------------------------------------
  // Phase 22.18: 原作マスター (ledgers) + 素材マスター (materials) CRUD
  // -------------------------------------------------------------------

  /**
   * 一覧取得 — 原作 + 配下の素材リストを embedded で返す。
   * Admin UI の LedgersPanel が直接 consume する想定。
   */
  app.get("/api/master/ledgers", async (_req, res) => {
    try {
      const ledgers = await query(
        `SELECT id, ledger_code, title, title_kana, alternative_titles,
                creator_name, publisher_name, remarks, is_active,
                default_rights_holder, default_credit_display, default_work_supplement,
                default_approval_target, default_approval_timing,
                created_at, updated_at
           FROM ledgers
          ORDER BY ledger_code DESC`
      );
      const ids = ledgers.rows.map((l: any) => Number(l.id));
      const matsMap = new Map<number, any[]>();
      if (ids.length > 0) {
        const mats = await query(
          `SELECT id, ledger_id, material_no, material_code, material_name,
                  material_type, rights_holder, remarks, is_default, is_active,
                  created_at, updated_at
             FROM materials
            WHERE ledger_id = ANY($1::int[])
            ORDER BY ledger_id, material_no ASC`,
          [ids]
        );
        mats.rows.forEach((m: any) => {
          const lid = Number(m.ledger_id);
          if (!matsMap.has(lid)) matsMap.set(lid, []);
          matsMap.get(lid)!.push({
            ...m,
            id: Number(m.id),
            ledger_id: lid,
            material_no: Number(m.material_no),
            is_default: !!m.is_default,
            is_active: m.is_active !== false,
          });
        });
      }
      const rows = ledgers.rows.map((l: any) => ({
        ...l,
        id: Number(l.id),
        is_active: l.is_active !== false,
        materials: matsMap.get(Number(l.id)) || [],
      }));
      res.json(rows);
    } catch (error) {
      console.error("GET /api/master/ledgers failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * 原作を新規登録 + 自動で -001 (原作本体) 素材を作成。
   */
  app.post("/api/master/ledgers", express.json(), async (req, res) => {
    const body = req.body || {};
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ ok: false, error: "title は必須" });
    }
    try {
      const result = await createLedgerWithDefaultMaterial({
        title: String(body.title).trim(),
        title_kana: body.title_kana,
        alternative_titles: Array.isArray(body.alternative_titles)
          ? body.alternative_titles
          : undefined,
        creator_name: body.creator_name,
        publisher_name: body.publisher_name,
        remarks: body.remarks,
        ledger_code: body.ledger_code, // legacy 移行時の手動指定可
        // Phase 22.20
        default_rights_holder: body.default_rights_holder,
        default_credit_display: body.default_credit_display,
        default_work_supplement: body.default_work_supplement,
        // Phase 22.21.7
        default_approval_target: body.default_approval_target,
        default_approval_timing: body.default_approval_timing,
      });
      console.log(
        `📚 [ledger] created ${result.ledger_code} (id=${result.id}), default material=${result.default_material_code}`
      );
      res.json({ ok: true, ...result });
    } catch (error: any) {
      console.error("POST /api/master/ledgers failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.put("/api/master/ledgers/:id", express.json(), async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    try {
      await query(
        `UPDATE ledgers SET
           title                    = $1,
           title_kana               = $2,
           alternative_titles       = $3,
           creator_name             = $4,
           publisher_name           = $5,
           remarks                  = $6,
           is_active                = $7,
           default_rights_holder    = $8,
           default_credit_display   = $9,
           default_work_supplement  = $10,
           default_approval_target  = $11,
           default_approval_timing  = $12,
           updated_at               = CURRENT_TIMESTAMP
         WHERE id = $13`,
        [
          body.title,
          body.title_kana || null,
          Array.isArray(body.alternative_titles) ? body.alternative_titles : [],
          body.creator_name || null,
          body.publisher_name || null,
          body.remarks || null,
          body.is_active === false ? false : true,
          body.default_rights_holder || null,
          body.default_credit_display || null,
          body.default_work_supplement || null,
          body.default_approval_target || null,
          body.default_approval_timing || null,
          id,
        ]
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("PUT /api/master/ledgers/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.delete("/api/master/ledgers/:id", async (req, res) => {
    const { id } = req.params;
    try {
      // 配下の素材を参照する license_contracts があるかチェック
      const refs = await query(
        `SELECT COUNT(*)::int AS c FROM license_contracts WHERE ledger_ref_id = $1`,
        [id]
      );
      if (Number(refs.rows[0].c) > 0) {
        return res.status(400).json({
          ok: false,
          error: `この原作には ${refs.rows[0].c} 件の契約が紐付いているため削除できません`,
        });
      }
      await query("DELETE FROM ledgers WHERE id = $1", [id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/master/ledgers/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 派生素材の追加 (-002, -003, ... と枝番自動)
   */
  app.post(
    "/api/master/ledgers/:id/materials",
    express.json(),
    async (req, res) => {
      const ledgerId = Number(req.params.id);
      const body = req.body || {};
      if (!body.material_name || !String(body.material_name).trim()) {
        return res.status(400).json({ ok: false, error: "material_name は必須" });
      }
      try {
        const m = await addMaterialToLedger({
          ledger_id: ledgerId,
          material_name: String(body.material_name).trim(),
          material_type: body.material_type || "derivative",
          rights_holder: body.rights_holder,
          remarks: body.remarks,
        });
        console.log(
          `📚 [material] added ${m.material_code} (id=${m.id}) under ledger ${ledgerId}`
        );
        res.json({ ok: true, ...m });
      } catch (error: any) {
        console.error("POST /api/master/ledgers/:id/materials failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  app.put("/api/master/materials/:id", express.json(), async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    try {
      await query(
        `UPDATE materials SET
           material_name = $1,
           material_type = $2,
           rights_holder = $3,
           remarks       = $4,
           is_active     = $5,
           updated_at    = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [
          body.material_name,
          body.material_type || null,
          body.rights_holder || null,
          body.remarks || null,
          body.is_active === false ? false : true,
          id,
        ]
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("PUT /api/master/materials/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.delete("/api/master/materials/:id", async (req, res) => {
    const { id } = req.params;
    try {
      // 原作本体 (-001) は削除不可
      const check = await query(
        `SELECT is_default FROM materials WHERE id = $1`,
        [id]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "素材が見つかりません" });
      }
      if (check.rows[0].is_default) {
        return res
          .status(400)
          .json({ ok: false, error: "原作本体素材 (-001) は削除できません" });
      }
      // 参照あれば拒否
      const refs = await query(
        `SELECT COUNT(*)::int AS c FROM license_contracts WHERE material_ref_id = $1`,
        [id]
      );
      if (Number(refs.rows[0].c) > 0) {
        return res.status(400).json({
          ok: false,
          error: `この素材には ${refs.rows[0].c} 件の契約が紐付いているため削除できません`,
        });
      }
      await query("DELETE FROM materials WHERE id = $1", [id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/master/materials/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // Phase 22.20-C: サブライセンシー マスター CRUD
  // -------------------------------------------------------------------
  app.get("/api/master/sublicensees", async (_req, res) => {
    try {
      const result = await query(
        `SELECT id, name, name_kana, category, default_region, default_language,
                rights_holder, contact_email, contact_phone, remarks, is_active,
                created_at, updated_at
           FROM sublicensees
          ORDER BY name ASC`
      );
      res.json(
        result.rows.map((r: any) => ({
          ...r,
          id: Number(r.id),
          is_active: r.is_active !== false,
        }))
      );
    } catch (error) {
      console.error("GET /api/master/sublicensees failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/master/sublicensees", express.json(), async (req, res) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ ok: false, error: "name は必須" });
    }
    try {
      const result = await query(
        `INSERT INTO sublicensees (
           name, name_kana, category, default_region, default_language,
           rights_holder, contact_email, contact_phone, remarks, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          String(body.name).trim(),
          body.name_kana || null,
          body.category || null,
          body.default_region || null,
          body.default_language || null,
          body.rights_holder || null,
          body.contact_email || null,
          body.contact_phone || null,
          body.remarks || null,
          body.is_active === false ? false : true,
        ]
      );
      res.json({ ok: true, id: Number(result.rows[0].id) });
    } catch (error) {
      console.error("POST /api/master/sublicensees failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.put("/api/master/sublicensees/:id", express.json(), async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    try {
      await query(
        `UPDATE sublicensees SET
           name             = $1,
           name_kana        = $2,
           category         = $3,
           default_region   = $4,
           default_language = $5,
           rights_holder    = $6,
           contact_email    = $7,
           contact_phone    = $8,
           remarks          = $9,
           is_active        = $10,
           updated_at       = CURRENT_TIMESTAMP
         WHERE id = $11`,
        [
          body.name,
          body.name_kana || null,
          body.category || null,
          body.default_region || null,
          body.default_language || null,
          body.rights_holder || null,
          body.contact_email || null,
          body.contact_phone || null,
          body.remarks || null,
          body.is_active === false ? false : true,
          id,
        ]
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("PUT /api/master/sublicensees/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.delete("/api/master/sublicensees/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await query("DELETE FROM sublicensees WHERE id = $1", [id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/master/sublicensees/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
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

  /**
   * Phase 17r: Backlog プロジェクトのステータス一覧を返す。
   * workflow_settings.next_status_id を設定するときに使う ID を調べる用。
   */
  app.get("/api/admin/backlog-statuses", async (_req, res) => {
    try {
      const statuses = await backlogService.getStatuses();
      res.json({
        ok: true,
        statuses: statuses.map((s: any) => ({
          id: s.id,
          name: s.name,
          displayOrder: s.displayOrder,
          color: s.color,
        })),
      });
    } catch (error: any) {
      console.error("/api/admin/backlog-statuses failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  /**
   * Phase 17r: 文書作成完了時に Backlog のどのステータスに遷移させるかを
   * 種別ごとに設定する。
   *
   * body: {
   *   transitions: [
   *     { issue_type_name: '発注書',   next_status_id: 4 },
   *     { issue_type_name: 'purchase_order', next_status_id: 4 },
   *     { issue_type_name: 'NDA',     next_status_id: 3 },
   *     ...
   *   ]
   * }
   *
   * 1 エントリ = workflow_settings 1 行を upsert (issue_type_name UNIQUE で
   * ON CONFLICT)。同じ next_status_id を「日本語ラベル」「英語テンプレ ID」
   * の両方で登録しておくと、worker の lookup がどちらのキーでも引ける。
   */
  app.post(
    "/api/admin/configure-status-transitions",
    express.json(),
    async (req, res) => {
      const transitions = Array.isArray(req.body?.transitions)
        ? req.body.transitions
        : [];
      try {
        const results: Array<{ issue_type_name: string; next_status_id: number | null }> = [];
        for (const t of transitions) {
          const name = String(t?.issue_type_name || "").trim();
          const nsid =
            t?.next_status_id == null ? null : Number(t.next_status_id);
          if (!name) continue;
          await query(
            `INSERT INTO workflow_settings (issue_type_name, next_status_id)
             VALUES ($1, $2)
             ON CONFLICT (issue_type_name) DO UPDATE SET
               next_status_id = EXCLUDED.next_status_id,
               updated_at = CURRENT_TIMESTAMP`,
            [name, nsid]
          );
          results.push({ issue_type_name: name, next_status_id: nsid });
        }
        res.json({ ok: true, configured: results });
      } catch (error: any) {
        console.error("/api/admin/configure-status-transitions failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  /**
   * Phase 17o: documents → contract_capabilities の再同期エンドポイント。
   *
   * 旧バージョンの worker は VENDOR_CODE をフォーム側で渡していなかった
   * ため、vendor_name の表記揺れで vendor_id が解決できず、結果として
   * contract_capabilities.vendor_id が NULL のレコードが残ってしまい、
   * 法務検索（個別契約セクション）で発注書が見えない問題があった。
   *
   * このエンドポイントは documents テーブルの全行を走査して、現在の
   * vendor master と突合し、contract_capabilities を再 upsert する。
   * 冪等。
   *
   * body: { dry_run?: boolean }
   */
  app.post("/api/admin/resync-contract-capabilities", express.json(), async (req, res) => {
    const dryRun = req.body?.dry_run === true;
    try {
      const docs = await query(
        `SELECT d.id, d.document_number, d.template_type, d.issue_key,
                d.form_data, d.drive_link, d.created_at
           FROM documents d
          WHERE d.document_number IS NOT NULL
            AND d.document_number <> ''
          ORDER BY d.created_at DESC`
      );

      const stats = {
        total: docs.rows.length,
        resolved_vendor: 0,
        unresolved_vendor: 0,
        upserted: 0,
        skipped: 0,
        errors: [] as Array<{ document_number: string; error: string }>,
      };

      for (const d of docs.rows) {
        try {
          const fd = d.form_data || {};
          const templateType = String(d.template_type || "");

          let vendorId: number | null = null;
          let vendorCode = String(fd.VENDOR_CODE || fd.vendorCode || "").trim();
          let vendorName = String(
            fd.VENDOR_NAME || fd.PARTY_B_NAME || fd.partyBName || ""
          ).trim();

          // Phase 17v: form_data に vendor 情報が無い場合は order_items から拾う。
          //   旧 bulk import で form_data に vendor_code/vendor_name を入れて
          //   いなかったケースを救済する。order_items.vendor_code は CSV から
          //   ちゃんと保存されているので、そこを経由できる。
          if ((!vendorCode || vendorCode.toUpperCase() === "UNKNOWN") && !vendorName && d.issue_key) {
            const orderRes = await query(
              `SELECT vendor_code FROM order_items
                WHERE backlog_issue_key = $1
                LIMIT 1`,
              [d.issue_key]
            );
            const ocode = String(orderRes.rows[0]?.vendor_code || "").trim();
            if (ocode && ocode.toUpperCase() !== "UNKNOWN") {
              vendorCode = ocode;
            }
          }

          if (vendorCode && vendorCode.toUpperCase() !== "UNKNOWN") {
            const r = await query(
              "SELECT id FROM vendors WHERE vendor_code = $1 LIMIT 1",
              [vendorCode]
            );
            if (r.rows.length > 0) vendorId = Number(r.rows[0].id);
          }
          if (!vendorId && vendorName) {
            const r = await query(
              "SELECT id FROM vendors WHERE vendor_name = $1 LIMIT 1",
              [vendorName]
            );
            if (r.rows.length > 0) vendorId = Number(r.rows[0].id);
          }
          if (!vendorId && vendorName) {
            const r = await query(
              "SELECT id FROM vendors WHERE trade_name = $1 OR pen_name = $1 LIMIT 1",
              [vendorName]
            );
            if (r.rows.length > 0) vendorId = Number(r.rows[0].id);
          }

          if (vendorId) stats.resolved_vendor++;
          else stats.unresolved_vendor++;

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

          if (dryRun) {
            stats.skipped++;
            continue;
          }

          await query(
            `INSERT INTO contract_capabilities (
              vendor_id, record_type, contract_category, contract_type, contract_title,
              document_number, contract_status, effective_date, expiration_date, auto_renewal,
              original_work, product_name, work_name, media, territory, language, document_url, source_system
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (document_number) DO UPDATE SET
              vendor_id      = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
              record_type    = EXCLUDED.record_type,
              contract_type  = EXCLUDED.contract_type,
              contract_title = COALESCE(NULLIF(EXCLUDED.contract_title, ''), contract_capabilities.contract_title),
              document_url   = COALESCE(NULLIF(EXCLUDED.document_url, ''), contract_capabilities.document_url),
              updated_at     = CURRENT_TIMESTAMP`,
            [
              vendorId,
              recordType,
              templateType.includes("license") ? "license" : "service",
              templateType,
              fd.CONTRACT_TITLE || fd.contract_title || fd.summary || fd.PROJECT_TITLE || "",
              d.document_number,
              "executed",
              fd.EFFECTIVE_DATE || fd.effectiveDate || null,
              fd.EXPIRATION_DATE || fd.expirationDate || null,
              fd.AUTO_RENEWAL === "true" || fd.AUTO_RENEWAL === true || false,
              fd.ORIGINAL_WORK || fd.originalWork || "",
              fd.PRODUCT_NAME || fd.productName || "",
              fd.WORK_NAME || fd.workName || "",
              fd.MEDIA || fd.media || "",
              fd.TERRITORY || fd.territory || "",
              fd.LANGUAGE || fd.language || "",
              d.drive_link || "",
              "resync",
            ]
          );
          stats.upserted++;
        } catch (rowErr: any) {
          stats.errors.push({
            document_number: d.document_number,
            error: String(rowErr?.message || rowErr),
          });
        }
      }

      res.json({ ok: true, dry_run: dryRun, ...stats });
    } catch (error: any) {
      console.error("/api/admin/resync-contract-capabilities failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
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
   * 発注書の一覧。検収書フォームで「親 PO を手動指定」する
   * ピッカー UI が使う。q (任意) で issue_key / description /
   * vendor_code を ILIKE で部分一致。
   *
   * 返り値には検収累計と残額も含めるので、ピッカー上で
   * 「残¥XXX」を一目で見せられる。is_imported は IMPORT-* 接頭辞で
   * 判定したフラグ (UI でラベル区別用)。
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
                calc_method, payment_terms,
                payment_method, payment_date, delivery_date,
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

      // Phase 17i: 経費（交通費等）も同時に返す
      const expensesRes = await query(
        `SELECT id, order_item_id, line_no, expense_name, spec,
                spent_date, amount_inc_tax, remarks,
                created_at, updated_at
           FROM order_expenses
          WHERE order_item_id = $1
          ORDER BY line_no ASC`,
        [orderItem.id]
      );

      // Phase 9c: 親 PO の document_number と vendor 詳細も同梱。
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
        // 代表者名は contact_name を使う。
        const vRes = await query(
          `SELECT vendor_name, address, contact_name, entity_type,
                  invoice_registration_number,
                  bank_name, branch_name, account_type, account_number,
                  account_holder_kana
             FROM vendors WHERE vendor_code = $1 LIMIT 1`,
          [orderItem.vendor_code]
        );
        vendor = vRes.rows[0]
          ? { ...vRes.rows[0], vendor_rep: vRes.rows[0].contact_name }
          : null;
      }

      // Phase 9f: 次回 deliveryNo と進捗
      const dvAgg = await query(
        `SELECT COUNT(*) AS done_count,
                COALESCE(SUM(delivered_amount), 0) AS done_amt
           FROM delivery_events
          WHERE order_item_id = $1`,
        [orderItem.id]
      );
      const doneCount = Number(dvAgg.rows[0]?.done_count) || 0;
      const doneAmt = Number(dvAgg.rows[0]?.done_amt) || 0;
      const orderTotalEx = Number(orderItem.amount_ex_tax) || 0;

      res.json({
        order_item: orderItem,
        line_items: linesWithAvail,
        expenses: expensesRes.rows,
        document_number: docRow.rows[0]?.document_number || "",
        vendor,
        delivery_progress: {
          done_count: doneCount,
          next_delivery_no: doneCount + 1,
          done_amount_ex_tax: doneAmt,
          remaining_amount_ex_tax: Math.max(0, orderTotalEx - doneAmt),
          inspected_pct:
            orderTotalEx > 0
              ? Math.min(100, Math.floor((doneAmt / orderTotalEx) * 100))
              : 0,
          is_partial: doneCount > 0,
        },
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
   *     ],
   *     expenses: [   // Phase 17i: 経費 (交通費等・税込み額)
   *       { line_no: 1, expense_name, spec, spent_date,
   *         amount_inc_tax, remarks },
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
      const expenses: Array<any> = Array.isArray(req.body.expenses) ? req.body.expenses : [];

      // 計算 + Phase 13: calc_method / payment_terms を統一
      const computedLines = lines.map((l: any) => {
        // 後方互換: payment_terms が空なら payment_method を使う
        const payTerms = l.payment_terms || l.payment_method || null;
        return {
          line_no: Number(l.line_no),
          item_name: l.item_name || "",
          spec: l.spec || "",
          unit_price: Number(l.unit_price) || 0,
          quantity: Number(l.quantity) || 0,
          amount_ex_tax: calculateOrderLineAmount(
            Number(l.unit_price) || 0,
            Number(l.quantity) || 0
          ),
          calc_method: l.calc_method || "FIXED",
          payment_terms: payTerms,
          // legacy: payment_method も payment_terms と同じ値で埋める (テンプレ後方互換)
          payment_method: payTerms,
          payment_date: l.payment_date || null,
          // Phase 17h: 業務明細ごとの納期
          delivery_date: l.delivery_date || null,
          // Phase 22.8: SUBSCRIPTION 用フィールド (FIXED/ROYALTY 行では NULL)
          cycle: l.calc_method === "SUBSCRIPTION" ? l.cycle || "MONTHLY" : null,
          term_start: l.calc_method === "SUBSCRIPTION" ? l.term_start || null : null,
          term_end: l.calc_method === "SUBSCRIPTION" ? l.term_end || null : null,
          billing_day:
            l.calc_method === "SUBSCRIPTION" &&
            l.billing_day !== undefined &&
            l.billing_day !== null &&
            l.billing_day !== ""
              ? Number(l.billing_day)
              : null,
        };
      });

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

      // upsert (Phase 13/17h: calc_method + payment_terms + delivery_date
      //         Phase 22.8: + SUBSCRIPTION fields cycle / term_start /
      //                       term_end / billing_day)
      for (const l of computedLines) {
        await query(
          `INSERT INTO order_line_items (
             order_item_id, line_no, item_name, spec,
             unit_price, quantity, amount_ex_tax,
             calc_method, payment_terms,
             payment_method, payment_date, delivery_date,
             cycle, term_start, term_end, billing_day,
             updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
           ON CONFLICT (order_item_id, line_no) DO UPDATE SET
             item_name      = EXCLUDED.item_name,
             spec           = EXCLUDED.spec,
             unit_price     = EXCLUDED.unit_price,
             quantity       = EXCLUDED.quantity,
             amount_ex_tax  = EXCLUDED.amount_ex_tax,
             calc_method    = EXCLUDED.calc_method,
             payment_terms  = EXCLUDED.payment_terms,
             payment_method = EXCLUDED.payment_method,
             payment_date   = EXCLUDED.payment_date,
             delivery_date  = EXCLUDED.delivery_date,
             cycle          = EXCLUDED.cycle,
             term_start     = EXCLUDED.term_start,
             term_end       = EXCLUDED.term_end,
             billing_day    = EXCLUDED.billing_day,
             updated_at     = CURRENT_TIMESTAMP`,
          [
            orderItemId,
            l.line_no,
            l.item_name,
            l.spec,
            l.unit_price,
            l.quantity,
            l.amount_ex_tax,
            l.calc_method,
            l.payment_terms,
            l.payment_method,
            l.payment_date,
            l.delivery_date,
            // Phase 22.8: SUBSCRIPTION fields (null-safe; FIXED/ROYALTY 行は NULL)
            (l as any).cycle || null,
            (l as any).term_start || null,
            (l as any).term_end || null,
            (l as any).billing_day === undefined || (l as any).billing_day === null
              ? null
              : Number((l as any).billing_day),
          ]
        );
      }

      // Phase 17i: 経費 (交通費等) を upsert
      const computedExpenses = expenses
        .map((e: any, idx: number) => ({
          line_no: Number(e.line_no) || idx + 1,
          expense_name: e.expense_name || "",
          spec: e.spec || "",
          spent_date: e.spent_date || null,
          amount_inc_tax: Number(e.amount_inc_tax) || 0,
          remarks: e.remarks || "",
        }))
        .filter((e) => e.expense_name); // 費目名がない行は除外

      const keepExpenseNos = computedExpenses.map((e) => e.line_no).filter((n) => n > 0);
      if (keepExpenseNos.length > 0) {
        await query(
          `DELETE FROM order_expenses
            WHERE order_item_id = $1
              AND line_no NOT IN (${keepExpenseNos.map((_, i) => `$${i + 2}`).join(",")})`,
          [orderItemId, ...keepExpenseNos]
        );
      } else {
        await query("DELETE FROM order_expenses WHERE order_item_id = $1", [orderItemId]);
      }

      for (const e of computedExpenses) {
        await query(
          `INSERT INTO order_expenses (
             order_item_id, line_no, expense_name, spec,
             spent_date, amount_inc_tax, remarks, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           ON CONFLICT (order_item_id, line_no) DO UPDATE SET
             expense_name   = EXCLUDED.expense_name,
             spec           = EXCLUDED.spec,
             spent_date     = EXCLUDED.spent_date,
             amount_inc_tax = EXCLUDED.amount_inc_tax,
             remarks        = EXCLUDED.remarks,
             updated_at     = CURRENT_TIMESTAMP`,
          [
            orderItemId,
            e.line_no,
            e.expense_name,
            e.spec,
            e.spent_date,
            e.amount_inc_tax,
            e.remarks,
          ]
        );
      }

      const totals = await recalculateOrderTotal(orderItemId, taxRate);
      res.json({
        success: true,
        totals,
        line_count: computedLines.length,
        expense_count: computedExpenses.length,
      });
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

  // -------------------------------------------------------------------
  // /api/imports/* — Past-document registration (Phase 8)
  //
  // 既に紙やメールベースで成立済みの契約 / 発注 / 個別利用許諾を
  // 「PDF を再生成せず」 DB に追記するためのエンドポイント。
  // フロント側の ImportPage が叩く。
  //
  // - Backlog 課題なし運用に対応: issue_key 未指定なら IMPORT-<ts> を
  //   採番。後で本物の課題ができたら、document_number 経由で外部
  //   アセット連携できる (external_assets テーブルが軸)。
  // - documents テーブルにも row を作るので、ダッシュボードの
  //   ドキュメント一覧 / アーカイブで履歴として可視化される。
  // - drive_link を渡せば external_assets.file_link としても登録、
  //   後続の発注書 → 検収書 / 個別利用許諾 → ロイヤリティ計算書 の
  //   フォームから「PO 紐付」 「個別紐付」ボタンで参照できる。
  // -------------------------------------------------------------------

  /**
   * 過去の発注書を DB に登録 (PDF 生成なし)。
   * body: {
   *   issue_key?: string,           // 省略時は IMPORT-<ts>
   *   document_number?: string,     // 省略時は worker が採番
   *   drive_link?: string,
   *   vendor_code?: string,
   *   vendor_name?: string,
   *   description?: string,
   *   tax_rate?: number,            // default 10
   *   due_date?: string,
   *   form_data?: any,              // 全フォーム値 (任意, 監査用)
   *   items: [{ line_no, item_name, spec, unit_price, quantity,
   *             amount_ex_tax?, payment_method?, payment_date? }]
   * }
   */
  app.post("/api/imports/order", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const issueKey =
        body.issue_key && String(body.issue_key).trim().length > 0
          ? String(body.issue_key).trim()
          : `IMPORT-${Date.now()}`;
      const docNumber =
        body.document_number && String(body.document_number).trim().length > 0
          ? String(body.document_number).trim()
          : await getNewDocumentNumber("purchase_order", "発注書");
      const taxRate = Number(body.tax_rate) || 10;
      const items: Array<any> = Array.isArray(body.items) ? body.items : [];
      // Phase 17i: 経費 (交通費等・税込み額) を一緒に登録
      const importExpenses: Array<any> = Array.isArray(body.expenses) ? body.expenses : [];

      if (items.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "items[] is required (1+ line)" });
      }

      // 各行の amount_ex_tax を再計算 (フロント送信値は信用しない)
      // Phase 13: calc_method + payment_terms split。
      // 旧 payment_method は payment_terms にマップして後方互換維持。
      // Phase 22.11: SUBSCRIPTION 構造化フィールドも読み取る (FIXED/ROYALTY なら null)。
      const computedLines = items.map((l, idx) => {
        const payTerms = l.payment_terms || l.payment_method || null;
        const isSub = String(l.calc_method || "").toUpperCase() === "SUBSCRIPTION";
        const billingDayRaw =
          l.billing_day === undefined || l.billing_day === null || l.billing_day === ""
            ? null
            : Number(l.billing_day);
        return {
          line_no: Number(l.line_no) || idx + 1,
          item_name: l.item_name || "",
          spec: l.spec || "",
          unit_price: Number(l.unit_price) || 0,
          quantity: Number(l.quantity) || 0,
          amount_ex_tax: calculateOrderLineAmount(
            Number(l.unit_price) || 0,
            Number(l.quantity) || 0
          ),
          calc_method: l.calc_method || "FIXED",
          payment_terms: payTerms,
          payment_method: payTerms, // legacy mirror
          payment_date: l.payment_date || null,
          delivery_date: l.delivery_date || null, // Phase 17h
          // Phase 22.11: SUBSCRIPTION 構造化フィールド
          cycle: isSub ? String(l.cycle || "").toUpperCase() || "MONTHLY" : null,
          term_start: isSub ? l.term_start || null : null,
          term_end: isSub ? l.term_end || null : null,
          billing_day:
            isSub && billingDayRaw !== null && !Number.isNaN(billingDayRaw)
              ? billingDayRaw
              : null,
        };
      });

      const totalExTax = computedLines.reduce(
        (s, l) => s + l.amount_ex_tax,
        0
      );

      // 1. order_items header — backlog_issue_key ベースで upsert
      //
      // 注: item_no は INTEGER NOT NULL (UNIQUE(legal_request_id, item_no))。
      // import は legal_request 紐付けなしの単発レコードなので、item_no=1
      // で固定する (legal_request_id が NULL なので UNIQUE 違反は起きない)。
      const headerRes = await query(
        `INSERT INTO order_items (
           backlog_issue_key, item_no, description, amount, vendor_code,
           tax_rate, due_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (backlog_issue_key) DO UPDATE SET
           description = COALESCE(NULLIF(EXCLUDED.description, ''), order_items.description),
           amount      = EXCLUDED.amount,
           vendor_code = COALESCE(NULLIF(EXCLUDED.vendor_code, ''), order_items.vendor_code),
           tax_rate    = EXCLUDED.tax_rate,
           due_date    = COALESCE(EXCLUDED.due_date, order_items.due_date)
         RETURNING id`,
        [
          issueKey,
          1, // item_no
          body.description || "",
          totalExTax,
          body.vendor_code || null,
          taxRate,
          body.due_date || null,
        ]
      );
      const orderItemId = Number(headerRes.rows[0].id);

      // 2. order_line_items — 既存 lines はいったん削除して入れ直し (Phase 13 対応)
      //    Phase 22.11: SUBSCRIPTION 構造化フィールド (cycle/term_start/term_end/billing_day) を含む
      await query("DELETE FROM order_line_items WHERE order_item_id = $1", [
        orderItemId,
      ]);
      for (const l of computedLines) {
        await query(
          `INSERT INTO order_line_items (
             order_item_id, line_no, item_name, spec,
             unit_price, quantity, amount_ex_tax,
             calc_method, payment_terms,
             payment_method, payment_date, delivery_date,
             cycle, term_start, term_end, billing_day
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            orderItemId,
            l.line_no,
            l.item_name,
            l.spec,
            l.unit_price,
            l.quantity,
            l.amount_ex_tax,
            l.calc_method,
            l.payment_terms,
            l.payment_method,
            l.payment_date,
            l.delivery_date,
            // Phase 22.11
            (l as any).cycle || null,
            (l as any).term_start || null,
            (l as any).term_end || null,
            (l as any).billing_day === null || (l as any).billing_day === undefined
              ? null
              : Number((l as any).billing_day),
          ]
        );
      }

      // Phase 17i: 経費を upsert
      const computedExpenses = importExpenses
        .map((e: any, idx: number) => ({
          line_no: Number(e.line_no) || idx + 1,
          expense_name: e.expense_name || "",
          spec: e.spec || "",
          spent_date: e.spent_date || null,
          amount_inc_tax: Number(e.amount_inc_tax) || 0,
          remarks: e.remarks || "",
        }))
        .filter((e) => e.expense_name);

      await query("DELETE FROM order_expenses WHERE order_item_id = $1", [
        orderItemId,
      ]);
      for (const e of computedExpenses) {
        await query(
          `INSERT INTO order_expenses (
             order_item_id, line_no, expense_name, spec,
             spent_date, amount_inc_tax, remarks
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderItemId,
            e.line_no,
            e.expense_name,
            e.spec,
            e.spent_date,
            e.amount_inc_tax,
            e.remarks,
          ]
        );
      }
      const expensesTotalIncTax = computedExpenses.reduce(
        (s, e) => s + e.amount_inc_tax,
        0
      );

      // 3. 集計 (tax / inc_tax) を header に書き戻し
      const totals = await recalculateOrderTotal(orderItemId, taxRate);

      // 4. documents 履歴
      await query(
        `INSERT INTO documents (
           document_number, issue_key, template_type, form_data,
           drive_link, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_number) DO UPDATE SET
           form_data  = EXCLUDED.form_data,
           drive_link = EXCLUDED.drive_link`,
        [
          docNumber,
          issueKey,
          "purchase_order",
          JSON.stringify({
            ...(body.form_data || {}),
            // Phase 17v: vendor 情報を form_data に必ず入れる
            //   (resync-contract-capabilities が vendor_id を解決するのに必要)。
            //   body.form_data 側にも入っていれば spread が優先するので
            //   それは温存される。
            VENDOR_CODE:
              (body.form_data && body.form_data.VENDOR_CODE) ||
              body.vendor_code ||
              "",
            VENDOR_NAME:
              (body.form_data && body.form_data.VENDOR_NAME) ||
              body.vendor_name ||
              "",
            items: computedLines,
            expenses: computedExpenses,
            expensesTotalIncTax,
            grandTotalExTax: totalExTax,
            taxRate,
            __imported: true,
          }),
          body.drive_link || "",
          "import",
        ]
      );

      // 5. external_assets — drive_link があれば「PO 紐付」ボタン経由で
      //    後続の検収書から参照できるよう登録
      if (body.drive_link) {
        await query(
          `INSERT INTO external_assets
           (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (asset_number) DO UPDATE SET
             file_link = EXCLUDED.file_link,
             counterparty = EXCLUDED.counterparty`,
          [
            docNumber,
            body.description || docNumber,
            "individual",
            body.vendor_name || body.vendor_code || "Imported",
            body.drive_link,
            issueKey,
          ]
        );
      }

      res.json({
        ok: true,
        order_item_id: orderItemId,
        issue_key: issueKey,
        document_number: docNumber,
        line_count: computedLines.length,
        expense_count: computedExpenses.length,
        expensesTotalIncTax,
        totals,
      });
    } catch (error) {
      console.error("/api/imports/order failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 過去の個別利用許諾条件書を DB に登録 (PDF 生成なし)。
   * body: {
   *   issue_key?: string,
   *   contract_number?: string,
   *   ledger_id?: string,
   *   drive_link?: string,
   *   licensor_name?, licensor_address?, licensor_rep?,
   *   licensor_is_corporation?: boolean,
   *   licensee_name?, licensee_address?, licensee_rep?,
   *   licensee_is_corporation?: boolean,
   *   original_work?, product_name_predicted?,
   *   license_start_date?, license_period_note?,
   *   supervisor?, credit_display?, remarks?,
   *   form_data?: any,
   *   financial_conditions: [{ condition_no, calc_method, rate_pct, ... }]
   * }
   */
  app.post("/api/imports/license-contract", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const issueKey =
        body.issue_key && String(body.issue_key).trim().length > 0
          ? String(body.issue_key).trim()
          : `IMPORT-${Date.now()}`;
      const contractNumber =
        body.contract_number && String(body.contract_number).trim().length > 0
          ? String(body.contract_number).trim()
          : await getNewDocumentNumber(
              "individual_license_terms",
              "個別利用許諾条件"
            );
      const ledgerId =
        body.ledger_id && String(body.ledger_id).trim().length > 0
          ? String(body.ledger_id).trim()
          : contractNumber;

      const conditions: Array<any> = Array.isArray(body.financial_conditions)
        ? body.financial_conditions
        : [];

      // 1. license_contracts header upsert (Phase 7d の /documents/generate
      //    で使ったロジックと同等)
      const lcRes = await query(
        `INSERT INTO license_contracts (
           backlog_issue_key, ledger_id, ledger_number, contract_number,
           licensor, original_work,
           licensor_name, licensor_address, licensor_rep, licensor_is_corporation,
           licensee_name, licensee_address, licensee_rep, licensee_is_corporation,
           product_name_predicted,
           license_start_date, license_period_note,
           supervisor, credit_display, remarks
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20
         )
         ON CONFLICT (backlog_issue_key) DO UPDATE SET
           contract_number          = EXCLUDED.contract_number,
           ledger_number            = COALESCE(NULLIF(EXCLUDED.ledger_number, ''), license_contracts.ledger_number),
           licensor                 = COALESCE(NULLIF(EXCLUDED.licensor, ''), license_contracts.licensor),
           original_work            = COALESCE(NULLIF(EXCLUDED.original_work, ''), license_contracts.original_work),
           licensor_name            = COALESCE(NULLIF(EXCLUDED.licensor_name, ''), license_contracts.licensor_name),
           licensor_address         = COALESCE(NULLIF(EXCLUDED.licensor_address, ''), license_contracts.licensor_address),
           licensor_rep             = COALESCE(NULLIF(EXCLUDED.licensor_rep, ''), license_contracts.licensor_rep),
           licensor_is_corporation  = EXCLUDED.licensor_is_corporation,
           licensee_name            = COALESCE(NULLIF(EXCLUDED.licensee_name, ''), license_contracts.licensee_name),
           licensee_address         = COALESCE(NULLIF(EXCLUDED.licensee_address, ''), license_contracts.licensee_address),
           licensee_rep             = COALESCE(NULLIF(EXCLUDED.licensee_rep, ''), license_contracts.licensee_rep),
           licensee_is_corporation  = EXCLUDED.licensee_is_corporation,
           product_name_predicted   = COALESCE(NULLIF(EXCLUDED.product_name_predicted, ''), license_contracts.product_name_predicted),
           license_start_date       = COALESCE(EXCLUDED.license_start_date, license_contracts.license_start_date),
           license_period_note      = COALESCE(NULLIF(EXCLUDED.license_period_note, ''), license_contracts.license_period_note),
           supervisor               = COALESCE(NULLIF(EXCLUDED.supervisor, ''), license_contracts.supervisor),
           credit_display           = COALESCE(NULLIF(EXCLUDED.credit_display, ''), license_contracts.credit_display),
           remarks                  = COALESCE(NULLIF(EXCLUDED.remarks, ''), license_contracts.remarks)
         RETURNING id`,
        [
          issueKey,
          ledgerId,
          contractNumber,
          contractNumber,
          body.licensor_name || "",
          body.original_work || "",
          body.licensor_name || "",
          body.licensor_address || "",
          body.licensor_rep || "",
          !!body.licensor_is_corporation,
          body.licensee_name || "",
          body.licensee_address || "",
          body.licensee_rep || "",
          !!body.licensee_is_corporation,
          body.product_name_predicted || "",
          body.license_start_date || null,
          body.license_period_note || "",
          body.supervisor || "",
          body.credit_display || "",
          body.remarks || "",
        ]
      );
      const lcId = Number(lcRes.rows[0].id);

      // 2. license_financial_conditions — 過去契約は royalty_calculations
      //    の参照がないので RESTRICT 衝突は起きないはず。が、念のため
      //    削除を try/catch で守る。
      const keepNos = conditions
        .map((c) => Number(c.condition_no))
        .filter((n) => n > 0);
      try {
        if (keepNos.length > 0) {
          await query(
            `DELETE FROM license_financial_conditions
              WHERE license_contract_id = $1
                AND condition_no NOT IN (${keepNos
                  .map((_, i) => `$${i + 2}`)
                  .join(",")})`,
            [lcId, ...keepNos]
          );
        } else {
          await query(
            "DELETE FROM license_financial_conditions WHERE license_contract_id = $1",
            [lcId]
          );
        }
      } catch (delErr) {
        console.warn(
          "Could not prune existing financial conditions on import:",
          delErr
        );
      }

      for (const c of conditions) {
        const condNo = Number(c.condition_no);
        if (!Number.isFinite(condNo) || condNo < 1) continue;
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
            condNo,
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

      // 3. documents 履歴
      await query(
        `INSERT INTO documents (
           document_number, issue_key, template_type, form_data,
           drive_link, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_number) DO UPDATE SET
           form_data  = EXCLUDED.form_data,
           drive_link = EXCLUDED.drive_link`,
        [
          contractNumber,
          issueKey,
          "individual_license_terms",
          JSON.stringify({
            ...(body.form_data || {}),
            financial_conditions: conditions,
            __imported: true,
          }),
          body.drive_link || "",
          "import",
        ]
      );

      // 4. external_assets
      if (body.drive_link) {
        await query(
          `INSERT INTO external_assets
           (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (asset_number) DO UPDATE SET
             file_link = EXCLUDED.file_link,
             counterparty = EXCLUDED.counterparty`,
          [
            contractNumber,
            body.original_work || contractNumber,
            "contract",
            body.licensor_name || "Imported",
            body.drive_link,
            issueKey,
          ]
        );
      }

      res.json({
        ok: true,
        license_contract_id: lcId,
        issue_key: issueKey,
        contract_number: contractNumber,
        ledger_id: ledgerId,
        condition_count: conditions.length,
      });
    } catch (error) {
      console.error("/api/imports/license-contract failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 過去の「ライセンス基本契約書」(license_master) を DB に登録。
   * 個別利用許諾条件書の親 (ledger 単位) として後続の個別契約から
   * ledger_id 経由で参照される。財務条件は伴わない (個別側で持つ)。
   *
   * body: {
   *   issue_key?, contract_number?, ledger_id?, drive_link?,
   *   basic_contract_name?, issue_date?,
   *   licensor_*, licensee_*, original_work?, license_start_date?,
   *   license_period_note?, supervisor?, credit_display?, remarks?,
   *   effective_date?, expiration_date?, auto_renewal?,
   *   form_data?: any
   * }
   */
  app.post("/api/imports/license-master", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const issueKey =
        body.issue_key && String(body.issue_key).trim().length > 0
          ? String(body.issue_key).trim()
          : `IMPORT-${Date.now()}`;
      const contractNumber =
        body.contract_number && String(body.contract_number).trim().length > 0
          ? String(body.contract_number).trim()
          : await getNewDocumentNumber("license_master", "ライセンス基本契約");
      const ledgerId =
        body.ledger_id && String(body.ledger_id).trim().length > 0
          ? String(body.ledger_id).trim()
          : contractNumber;

      // 1. license_contracts ヘッダ (financial_conditions なし)
      const lcRes = await query(
        `INSERT INTO license_contracts (
           backlog_issue_key, ledger_id, ledger_number, contract_number,
           licensor, original_work,
           basic_contract_name, issue_date,
           licensor_name, licensor_address, licensor_rep, licensor_is_corporation,
           licensee_name, licensee_address, licensee_rep, licensee_is_corporation,
           product_name_predicted,
           license_start_date, license_period_note,
           supervisor, credit_display, remarks
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15, $16,
           $17, $18, $19, $20, $21, $22
         )
         ON CONFLICT (backlog_issue_key) DO UPDATE SET
           ledger_id                = COALESCE(NULLIF(EXCLUDED.ledger_id, ''), license_contracts.ledger_id),
           ledger_number            = COALESCE(NULLIF(EXCLUDED.ledger_number, ''), license_contracts.ledger_number),
           contract_number          = EXCLUDED.contract_number,
           basic_contract_name      = COALESCE(NULLIF(EXCLUDED.basic_contract_name, ''), license_contracts.basic_contract_name),
           issue_date               = COALESCE(EXCLUDED.issue_date, license_contracts.issue_date),
           licensor                 = COALESCE(NULLIF(EXCLUDED.licensor, ''), license_contracts.licensor),
           original_work            = COALESCE(NULLIF(EXCLUDED.original_work, ''), license_contracts.original_work),
           licensor_name            = COALESCE(NULLIF(EXCLUDED.licensor_name, ''), license_contracts.licensor_name),
           licensor_address         = COALESCE(NULLIF(EXCLUDED.licensor_address, ''), license_contracts.licensor_address),
           licensor_rep             = COALESCE(NULLIF(EXCLUDED.licensor_rep, ''), license_contracts.licensor_rep),
           licensor_is_corporation  = EXCLUDED.licensor_is_corporation,
           licensee_name            = COALESCE(NULLIF(EXCLUDED.licensee_name, ''), license_contracts.licensee_name),
           licensee_address         = COALESCE(NULLIF(EXCLUDED.licensee_address, ''), license_contracts.licensee_address),
           licensee_rep             = COALESCE(NULLIF(EXCLUDED.licensee_rep, ''), license_contracts.licensee_rep),
           licensee_is_corporation  = EXCLUDED.licensee_is_corporation,
           product_name_predicted   = COALESCE(NULLIF(EXCLUDED.product_name_predicted, ''), license_contracts.product_name_predicted),
           license_start_date       = COALESCE(EXCLUDED.license_start_date, license_contracts.license_start_date),
           license_period_note      = COALESCE(NULLIF(EXCLUDED.license_period_note, ''), license_contracts.license_period_note),
           supervisor               = COALESCE(NULLIF(EXCLUDED.supervisor, ''), license_contracts.supervisor),
           credit_display           = COALESCE(NULLIF(EXCLUDED.credit_display, ''), license_contracts.credit_display),
           remarks                  = COALESCE(NULLIF(EXCLUDED.remarks, ''), license_contracts.remarks)
         RETURNING id`,
        [
          issueKey,
          ledgerId,
          contractNumber,
          contractNumber,
          body.licensor_name || "",
          body.original_work || "",
          body.basic_contract_name || "",
          body.issue_date || null,
          body.licensor_name || "",
          body.licensor_address || "",
          body.licensor_rep || "",
          !!body.licensor_is_corporation,
          body.licensee_name || "",
          body.licensee_address || "",
          body.licensee_rep || "",
          !!body.licensee_is_corporation,
          body.product_name_predicted || "",
          body.license_start_date || null,
          body.license_period_note || "",
          body.supervisor || "",
          body.credit_display || "",
          body.remarks || "",
        ]
      );
      const lcId = Number(lcRes.rows[0].id);

      // 2. documents 履歴
      await query(
        `INSERT INTO documents (
           document_number, issue_key, template_type, form_data,
           drive_link, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_number) DO UPDATE SET
           form_data  = EXCLUDED.form_data,
           drive_link = EXCLUDED.drive_link`,
        [
          contractNumber,
          issueKey,
          "license_master",
          JSON.stringify({
            ...(body.form_data || {}),
            // Phase 17w: vendor 情報を form_data にも保存し resync で救済可能に
            VENDOR_CODE:
              (body.form_data && body.form_data.VENDOR_CODE) ||
              body.vendor_code ||
              "",
            VENDOR_NAME:
              (body.form_data && body.form_data.VENDOR_NAME) ||
              body.licensor_name ||
              "",
            __imported: true,
            __ledger_id: ledgerId,
          }),
          body.drive_link || "",
          "import",
        ]
      );

      // 3. contract_capabilities (master_contract / license) — 法務検索の対象
      // Phase 17w: vendor_id を解決して INSERT に含める (これが無いと法務検索に
      //   出ない)。ライセンスマスタは「ライセンサー = 取引先 (vendor)」の構図。
      const lmVendorId = await resolveVendorIdForImport_(
        body.vendor_code,
        body.licensor_name
      );
      await query(
        `INSERT INTO contract_capabilities (
           vendor_id, record_type, contract_category, contract_type, contract_title,
           document_number, contract_status, effective_date, expiration_date,
           auto_renewal, original_work, document_url, source_system
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (document_number) DO UPDATE SET
           vendor_id        = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
           record_type      = EXCLUDED.record_type,
           contract_category = EXCLUDED.contract_category,
           contract_type    = EXCLUDED.contract_type,
           contract_title   = EXCLUDED.contract_title,
           effective_date   = EXCLUDED.effective_date,
           expiration_date  = EXCLUDED.expiration_date,
           auto_renewal     = EXCLUDED.auto_renewal,
           original_work    = EXCLUDED.original_work,
           document_url     = EXCLUDED.document_url,
           updated_at       = CURRENT_TIMESTAMP`,
        [
          lmVendorId,
          "master_contract",
          "license",
          "license_master",
          body.basic_contract_name ||
            body.original_work ||
            contractNumber,
          contractNumber,
          "executed",
          body.effective_date || body.license_start_date || null,
          body.expiration_date || null,
          !!body.auto_renewal,
          body.original_work || "",
          body.drive_link || "",
          "Import (Past Document)",
        ]
      );

      // 4. external_assets
      if (body.drive_link) {
        await query(
          `INSERT INTO external_assets
           (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (asset_number) DO UPDATE SET
             file_link = EXCLUDED.file_link,
             counterparty = EXCLUDED.counterparty`,
          [
            contractNumber,
            body.basic_contract_name || body.original_work || contractNumber,
            "contract",
            body.licensor_name || "Imported",
            body.drive_link,
            issueKey,
          ]
        );
      }

      res.json({
        ok: true,
        license_contract_id: lcId,
        issue_key: issueKey,
        contract_number: contractNumber,
        ledger_id: ledgerId,
      });
    } catch (error) {
      console.error("/api/imports/license-master failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 過去の「業務委託基本契約書」(service_master) を DB に登録。
   * 個別 PO の親 (master_contract) として contract_capabilities に
   * 入る。発注書 / 検収書のような明細を伴う伝票ではないので、
   * order_items 等には書き込まない。
   *
   * body: {
   *   issue_key?, contract_number?, drive_link?,
   *   contract_title?, effective_date?, expiration_date?, auto_renewal?,
   *   vendor_code?, vendor_name?,
   *   party_a_name?, party_a_address?, party_a_rep?,
   *   party_b_name?, party_b_address?, party_b_rep?,
   *   remarks?, form_data?: any
   * }
   */
  app.post("/api/imports/service-master", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const issueKey =
        body.issue_key && String(body.issue_key).trim().length > 0
          ? String(body.issue_key).trim()
          : `IMPORT-${Date.now()}`;
      const contractNumber =
        body.contract_number && String(body.contract_number).trim().length > 0
          ? String(body.contract_number).trim()
          : await getNewDocumentNumber("service_master", "業務委託基本契約");

      // 1. vendor lookup
      let vendorId: number | null = null;
      if (body.vendor_code || body.vendor_name) {
        const vRes = await query(
          "SELECT id FROM vendors WHERE vendor_code = $1 OR vendor_name = $2 LIMIT 1",
          [body.vendor_code || "", body.vendor_name || ""]
        );
        if (vRes.rows.length > 0) {
          vendorId = Number(vRes.rows[0].id);
        }
      }

      // 2. contract_capabilities (master_contract / service)
      await query(
        `INSERT INTO contract_capabilities (
           vendor_id, record_type, contract_category, contract_type, contract_title,
           document_number, contract_status, effective_date, expiration_date,
           auto_renewal, document_url, source_system
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (document_number) DO UPDATE SET
           vendor_id        = EXCLUDED.vendor_id,
           record_type      = EXCLUDED.record_type,
           contract_category = EXCLUDED.contract_category,
           contract_type    = EXCLUDED.contract_type,
           contract_title   = EXCLUDED.contract_title,
           effective_date   = EXCLUDED.effective_date,
           expiration_date  = EXCLUDED.expiration_date,
           auto_renewal     = EXCLUDED.auto_renewal,
           document_url     = EXCLUDED.document_url,
           updated_at       = CURRENT_TIMESTAMP`,
        [
          vendorId,
          "master_contract",
          "service",
          "service_master",
          body.contract_title || contractNumber,
          contractNumber,
          "executed",
          body.effective_date || null,
          body.expiration_date || null,
          !!body.auto_renewal,
          body.drive_link || "",
          "Import (Past Document)",
        ]
      );

      // 3. documents 履歴
      await query(
        `INSERT INTO documents (
           document_number, issue_key, template_type, form_data,
           drive_link, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_number) DO UPDATE SET
           form_data  = EXCLUDED.form_data,
           drive_link = EXCLUDED.drive_link`,
        [
          contractNumber,
          issueKey,
          "service_master",
          JSON.stringify({
            ...(body.form_data || {}),
            __imported: true,
            party_a_name: body.party_a_name,
            party_a_address: body.party_a_address,
            party_a_rep: body.party_a_rep,
            party_b_name: body.party_b_name,
            party_b_address: body.party_b_address,
            party_b_rep: body.party_b_rep,
            remarks: body.remarks,
          }),
          body.drive_link || "",
          "import",
        ]
      );

      // 4. external_assets
      if (body.drive_link) {
        await query(
          `INSERT INTO external_assets
           (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (asset_number) DO UPDATE SET
             file_link = EXCLUDED.file_link,
             counterparty = EXCLUDED.counterparty`,
          [
            contractNumber,
            body.contract_title || contractNumber,
            "contract",
            body.vendor_name || body.party_b_name || "Imported",
            body.drive_link,
            issueKey,
          ]
        );
      }

      res.json({
        ok: true,
        issue_key: issueKey,
        contract_number: contractNumber,
        vendor_id: vendorId,
      });
    } catch (error) {
      console.error("/api/imports/service-master failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/imports/bulk/* — CSV 一括インポート (Phase 10, 案 A)
  //
  // フロント側で CSV を parse → JSON 化 → ここに送信。
  // 各 endpoint は「行繰り返し + import_key グルーピング」を解凍し、
  // 既存の単発インポートロジックと同じ DB 書き込みを行単位で実行する。
  // 戻り値は { succeeded: [...], failed: [...] } のグループ単位サマリー。
  //
  // 注意:
  //  - 1 つの行が失敗しても他は処理を続行 (best-effort batch)。
  //  - 各グループ内のヘッダ列は first row を採用 (不一致は警告ログ)。
  //  - サーバ側で amount は再計算 (Math.ceil) してフロント送信値を信用しない。
  // -------------------------------------------------------------------

  /**
   * Phase 17w: import 系エンドポイントで使う共通 vendor 解決ヘルパー。
   * 優先順:
   *   1. vendor_code (vendors.vendor_code 完全一致)
   *   2. vendor_name (vendors.vendor_name 完全一致)
   *   3. vendor_name (vendors.trade_name / pen_name 完全一致)
   * 全部 miss なら null を返す → contract_capabilities.vendor_id は NULL で
   * INSERT されるが、後から /api/admin/resync-contract-capabilities で
   * 救済可能。
   */
  async function resolveVendorIdForImport_(
    vendorCode?: string | null,
    vendorName?: string | null
  ): Promise<number | null> {
    const code = String(vendorCode || "").trim();
    const name = String(vendorName || "").trim();

    if (code && code.toUpperCase() !== "UNKNOWN") {
      const r = await query(
        "SELECT id FROM vendors WHERE vendor_code = $1 LIMIT 1",
        [code]
      );
      if (r.rows.length > 0) return Number(r.rows[0].id);
    }
    if (name) {
      const r = await query(
        "SELECT id FROM vendors WHERE vendor_name = $1 LIMIT 1",
        [name]
      );
      if (r.rows.length > 0) return Number(r.rows[0].id);
    }
    if (name) {
      const r = await query(
        "SELECT id FROM vendors WHERE trade_name = $1 OR pen_name = $1 LIMIT 1",
        [name]
      );
      if (r.rows.length > 0) return Number(r.rows[0].id);
    }
    return null;
  }

  /**
   * Helper: 配列を import_key でグループ化。空 / null は __ROW_<idx>__ で
   * 各行を個別グループ扱いに (CSV ミスでも全行が 1 グループに吸われない保護)。
   */
  function groupByImportKey<T extends Record<string, any>>(
    rows: T[]
  ): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    rows.forEach((r, idx) => {
      const k =
        r.import_key != null && String(r.import_key).trim().length > 0
          ? String(r.import_key).trim()
          : `__ROW_${idx}__`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    });
    return groups;
  }

  /**
   * Phase 17b: bulk CSV の ringi_numbers 列 (カンマ区切り 5 桁数字)
   * を解析して documents との N:N 関連を作る。未登録の番号は warn ログで
   * スキップ。冪等性: 同じ document に複数回呼ばれても重複しない。
   */
  async function linkRingiToDocument(
    documentId: number,
    ringiNumbersStr: string | undefined | null
  ): Promise<{ linked: string[]; not_found: string[] }> {
    const linked: string[] = [];
    const not_found: string[] = [];
    if (!documentId || !ringiNumbersStr) return { linked, not_found };
    const nums = String(ringiNumbersStr)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[0-9]{5}$/.test(s));
    if (nums.length === 0) return { linked, not_found };
    await query(
      `DELETE FROM ringi_documents WHERE document_id = $1`,
      [documentId]
    );
    for (const num of Array.from(new Set(nums))) {
      const r = await query(
        `SELECT id FROM ringi_records WHERE ringi_number = $1`,
        [num]
      );
      if (r.rows.length === 0) {
        not_found.push(num);
        continue;
      }
      await query(
        `INSERT INTO ringi_documents (ringi_id, document_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [Number(r.rows[0].id), documentId]
      );
      linked.push(num);
    }
    return { linked, not_found };
  }

  /**
   * Phase 17b: 上の linkRingiToDocument の document_number 版ラッパー。
   * bulk endpoint で INSERT 後にこれを呼べば、稟議紐付けが 1 行で済む。
   */
  async function linkRingiByDocNumber(
    docNumber: string,
    ringiNumbersStr: string | undefined | null
  ): Promise<void> {
    if (!docNumber || !ringiNumbersStr) return;
    const r = await query(
      "SELECT id FROM documents WHERE document_number = $1",
      [docNumber]
    );
    if (r.rows.length > 0) {
      await linkRingiToDocument(Number(r.rows[0].id), ringiNumbersStr);
    }
  }

  /**
   * Phase 14b: staff_email から staff レコードを引き、部署 / 氏名 / メール
   * を補完するヘルパー。CSV では email だけ書いてもらえば、後の項目は
   * DB から自動で埋まる。
   */
  async function lookupStaffByEmail(email?: string): Promise<{
    staff_name: string;
    department: string;
    email: string;
    phone: string;
  } | null> {
    if (!email || String(email).trim() === "") return null;
    const res = await query(
      `SELECT staff_name, department, email, phone
         FROM staff WHERE email = $1 LIMIT 1`,
      [String(email).trim()]
    );
    if (res.rows.length === 0) return null;
    const s = res.rows[0];
    return {
      staff_name: s.staff_name || "",
      department: s.department || "",
      email: s.email || "",
      phone: s.phone || "",
    };
  }

  /**
   * Phase 14c: generate_pdf 列の値を真偽に変換。
   *   '未作成', 'true', 'TRUE', '1', 'YES'  → true (= PDF 生成)
   *   '作成済', '', 'false', 'FALSE', '0'   → false (= DB のみ)
   */
  function shouldGeneratePdf(raw: any): boolean {
    if (raw == null) return false;
    const s = String(raw).trim().toLowerCase();
    if (s === "" || s === "false" || s === "0" || s === "no" || s === "作成済") {
      return false;
    }
    if (s === "true" || s === "1" || s === "yes" || s === "未作成") {
      return true;
    }
    return false; // 不明値は安全側で false
  }

  /**
   * Phase 14c: bulk import + 未作成行で PDF をレンダリング + Drive に
   * upload して documents.drive_link を更新する共通ヘルパー。
   * 失敗時は warn ログ + 成功 boolean を返すだけ (DB インポートは中断しない)。
   */
  async function maybeGeneratePdfForImport(
    templateType: string,
    documentNumber: string,
    issueKey: string,
    rawData: Record<string, any>,
    staffInfo: any
  ): Promise<{ generated: boolean; drive_link: string; error?: string }> {
    try {
      // Phase 17i: 経費合計をサーバ側で再計算 (テンプレ {{expensesTotalIncTax}} 用)
      const bulkExpenses = Array.isArray(rawData?.expenses) ? rawData.expenses : [];
      const bulkExpensesTotal = bulkExpenses.reduce(
        (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
        0
      );

      const details = {
        ...rawData,
        ...staffInfo,
        expenses: bulkExpenses,
        expensesTotalIncTax: bulkExpensesTotal,
        DOC_NO: documentNumber,
        ORDER_NO: documentNumber,
        hasChangeLogs: false,
        changeLogs: [],
      };
      const { html, fileName } = await documentService.generateDocument(
        {
          issueKey,
          documentNumber,
          summary: rawData.contract_title || rawData.description || documentNumber,
          requester: staffInfo?.STAFF_NAME || "Bulk Import",
          date: new Date().toLocaleDateString("ja-JP"),
          details,
        },
        templateType as any
      );
      const driveLink = await googleDriveService.uploadPdf(html, fileName);
      // documents.drive_link を更新
      await query(
        `UPDATE documents SET drive_link = $1 WHERE document_number = $2`,
        [driveLink, documentNumber]
      );
      return { generated: true, drive_link: driveLink };
    } catch (err: any) {
      console.warn(
        `[bulk] PDF generation failed for ${documentNumber} (${templateType}):`,
        err?.message || err
      );
      return {
        generated: false,
        drive_link: "",
        error: String(err?.message || err),
      };
    }
  }

  /**
   * Bulk import: 発注書。CSV 1 行 = 1 明細 or 1 経費、import_key でグループ化。
   * 各グループは 1 PO として order_items + order_line_items + order_expenses を作成。
   *
   * body: { rows: Array<row> }
   * 共通列:
   *   import_key, issue_key?, document_number?, drive_link?,
   *   vendor_code?, vendor_name?, description?, tax_rate?, due_date?,
   *   staff_email?, generate_pdf?, ringi_numbers?,
   *   row_type ("item" | "expense", default "item")
   * item 行用列:
   *   line_no, item_name, spec?, unit_price, quantity,
   *   calc_method?, payment_terms?, delivery_date?, payment_date?
   * expense 行用列 (Phase 17i):
   *   line_no, expense_name, spec?, spent_date?, amount_inc_tax, remarks?
   */
  app.post("/api/imports/bulk/order", express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "rows[] is required (CSV のパース結果)" });
      }
      const groups = groupByImportKey(rows);
      const succeeded: any[] = [];
      const failed: any[] = [];

      // Phase 22.21.27: Backlog 課題 + auto-chain (納品・検収子課題) を
      //   bulk import の各行に対しても起こす。
      //   - issue_key が CSV にあれば既存課題に紐付け (再 import で冪等)
      //   - 無ければ Backlog に「契約審査」課題を新規作成
      //   - legal_requests に contract_type='purchase_order' で登録
      //   - 完了 (statusId=4) に自動進行
      //   - autoChainOnComplete を呼んで「納品・検収」子課題を起票
      //
      //   1 回だけ拾えば十分なので、ループ外で issue type / status の解決を
      //   キャッシュする。
      // Phase 22.21.28: 課題種別を generate_pdf に応じて切替。
      //   - 作成済 (= pdfPending=false): "契約審査" (発注書発行済 → 完了化 → 納品子課題)
      //   - 未作成 (= pdfPending=true):  "文書作成" (発注書を これから 作るタスク。完了化や納品子課題は走らせない)
      let cachedContractReviewTypeId: number | null = null;
      let cachedDocCreationTypeId: number | null = null;
      let cachedTypesLookup: any[] | null = null;
      const ensureIssueTypesFetched = async (): Promise<void> => {
        if (cachedTypesLookup !== null) return;
        try {
          cachedTypesLookup = (await backlogService.getIssueTypes()) || [];
          const reviewType = cachedTypesLookup.find(
            (x: any) => x.name === "契約審査"
          );
          if (reviewType) cachedContractReviewTypeId = Number(reviewType.id);
          const docType = cachedTypesLookup.find(
            (x: any) => x.name === "文書作成"
          );
          if (docType) cachedDocCreationTypeId = Number(docType.id);
        } catch (e) {
          console.warn(`[bulk/order] getIssueTypes failed:`, e);
        }
      };
      const resolveContractReviewTypeId = async (): Promise<number | null> => {
        await ensureIssueTypesFetched();
        return cachedContractReviewTypeId;
      };
      const resolveDocCreationTypeId = async (): Promise<number | null> => {
        await ensureIssueTypesFetched();
        return cachedDocCreationTypeId;
      };
      let cachedCompletedStatusId: number | null = null;
      const resolveCompletedStatusId = async (): Promise<number | null> => {
        if (cachedCompletedStatusId !== null) return cachedCompletedStatusId;
        try {
          const statuses = await backlogService.getStatuses();
          const s = statuses.find(
            (x: any) => x.name === "完了" || Number(x.id) === 4
          );
          if (s) cachedCompletedStatusId = Number(s.id);
        } catch (e) {
          console.warn(`[bulk/order] getStatuses failed:`, e);
        }
        return cachedCompletedStatusId;
      };

      for (const [importKey, groupRows] of groups) {
        try {
          const first = groupRows[0];
          // CSV 列 auto_complete (デフォルト true / 「Yes/true/1」も受容)
          const autoComplete = (() => {
            const v = first.auto_complete;
            if (v === undefined || v === null || v === "") return true;
            const s = String(v).trim().toLowerCase();
            return !["false", "no", "0", "off"].includes(s);
          })();
          // CSV 列 create_backlog (auto_complete とは独立。default true)
          const createBacklog = (() => {
            const v = first.create_backlog;
            if (v === undefined || v === null || v === "") return true;
            const s = String(v).trim().toLowerCase();
            return !["false", "no", "0", "off"].includes(s);
          })();

          let issueKey =
            first.issue_key && String(first.issue_key).trim().length > 0
              ? String(first.issue_key).trim()
              : "";
          const docNumber =
            first.document_number && String(first.document_number).trim().length > 0
              ? String(first.document_number).trim()
              : await getNewDocumentNumber("purchase_order", "発注書");

          // Phase 22.21.27: issue_key が未指定なら Backlog 課題を新規作成。
          //   作成失敗時は IMPORT-... fallback で続行 (DB だけ作って Backlog 同期は後日)。
          let backlogIssueCreated = false;
          // Phase 22.21.28: PDF 状態を早めに決定 (Backlog 課題種別の判別に使う)
          const pdfPendingEarly = shouldGeneratePdf(first.generate_pdf);
          if (!issueKey && createBacklog) {
            // pdfPendingEarly=true (未作成) → 文書作成 課題、後段の auto_complete はスキップ
            // pdfPendingEarly=false (作成済) → 契約審査 課題、auto_complete + auto-chain
            const typeId = pdfPendingEarly
              ? await resolveDocCreationTypeId()
              : await resolveContractReviewTypeId();
            const typeLabel = pdfPendingEarly ? "文書作成" : "契約審査";
            if (typeId) {
              try {
                const vendorName = String(
                  first.vendor_name || first.vendor_code || ""
                ).trim();
                const summary = pdfPendingEarly
                  ? `【文書作成】${vendorName || "—"}｜発注書 ${docNumber} (PDF 未作成)`
                  : `【契約審査】${vendorName || "—"}｜発注書 ${docNumber}`;
                const description =
                  `Bulk import で自動起票された発注書課題です (種別: ${typeLabel})。\n\n` +
                  `発注番号: ${docNumber}\n` +
                  `取引先: ${vendorName || "—"}\n` +
                  `案件: ${String(first.description || "—").slice(0, 200)}\n` +
                  `インポートグループキー: ${importKey}\n` +
                  (pdfPendingEarly
                    ? `\n※ generate_pdf=未作成 で取り込まれました。Document Editor で実 PDF を生成してから 完了 へ進めてください。完了時に納品・検収 子課題が自動作成されます。`
                    : "");
                const created = await backlogService.createIssue({
                  summary,
                  description,
                  issueTypeId: typeId,
                  priorityId: 3,
                });
                if (created?.issueKey) {
                  issueKey = String(created.issueKey).trim();
                  backlogIssueCreated = true;
                  console.log(
                    `📥 [bulk/order] created Backlog issue ${issueKey} for ${docNumber} (${typeLabel})`
                  );
                }
              } catch (e: any) {
                console.warn(
                  `[bulk/order] Backlog createIssue failed for ${docNumber} (continuing with synthetic key):`,
                  e?.message || e
                );
              }
            } else {
              console.warn(
                `[bulk/order] Backlog issue type "${typeLabel}" not found, skip create`
              );
            }
          }
          if (!issueKey) {
            issueKey = `IMPORT-${Date.now()}-${succeeded.length + failed.length}`;
          }
          const taxRate = Number(first.tax_rate) || 10;

          // Phase 17i: row_type で item / expense を判別。空 or "item" は明細扱い。
          //   item 行   → order_line_items (従来動作)
          //   expense 行 → order_expenses (経費・税込み額)
          const itemRows = groupRows.filter((r) => {
            const t = String(r.row_type || "item").trim().toLowerCase();
            return t !== "expense" && t !== "exp";
          });
          const expenseRows = groupRows.filter((r) => {
            const t = String(r.row_type || "item").trim().toLowerCase();
            return t === "expense" || t === "exp";
          });

          // Phase 13: calc_method + payment_terms 統一。旧 payment_method 入力も受容。
          // Phase 22.11: SUBSCRIPTION 行は cycle / term_start / term_end / billing_day
          //   構造化フィールドも読み込む。FIXED/ROYALTY 行では null のまま。
          const lines = itemRows
            .filter((r) => r.line_no || r.item_name || r.unit_price)
            .map((r, idx) => {
              const payTerms = r.payment_terms || r.payment_method || null;
              const isSub = String(r.calc_method || "").toUpperCase() === "SUBSCRIPTION";
              // billing_day を安全に Number 化 (空文字や非数は null)
              const billingDayRaw =
                r.billing_day === undefined || r.billing_day === null || r.billing_day === ""
                  ? null
                  : Number(r.billing_day);
              return {
                line_no: Number(r.line_no) || idx + 1,
                item_name: r.item_name || "",
                spec: r.spec || "",
                unit_price: Number(r.unit_price) || 0,
                quantity: Number(r.quantity) || 0,
                amount_ex_tax: calculateOrderLineAmount(
                  Number(r.unit_price) || 0,
                  Number(r.quantity) || 0
                ),
                calc_method: r.calc_method || "FIXED",
                payment_terms: payTerms,
                payment_method: payTerms, // legacy mirror
                payment_date: r.payment_date || null,
                delivery_date: r.delivery_date || null, // Phase 17h
                // Phase 22.11: SUBSCRIPTION 構造化フィールド (FIXED/ROYALTY なら null)
                cycle: isSub
                  ? String(r.cycle || "").toUpperCase() || "MONTHLY"
                  : null,
                term_start: isSub ? r.term_start || null : null,
                term_end: isSub ? r.term_end || null : null,
                billing_day:
                  isSub && billingDayRaw !== null && !Number.isNaN(billingDayRaw)
                    ? billingDayRaw
                    : null,
              };
            });

          // Phase 17i: 経費行 (税込み額)
          const bulkExpenses = expenseRows
            .filter((r) => r.expense_name || r.amount_inc_tax)
            .map((r, idx) => ({
              line_no: Number(r.line_no) || idx + 1,
              expense_name: r.expense_name || r.item_name || "",
              spec: r.spec || "",
              spent_date: r.spent_date || r.delivery_date || null,
              amount_inc_tax: Number(r.amount_inc_tax) || 0,
              remarks: r.remarks || "",
            }))
            .filter((e) => e.expense_name);

          if (lines.length === 0 && bulkExpenses.length === 0) {
            failed.push({
              import_key: importKey,
              error:
                "No valid item / expense rows (line_no + item_name + unit_price, or row_type=expense + expense_name + amount_inc_tax)",
            });
            continue;
          }

          const totalExTax = lines.reduce((s, l) => s + l.amount_ex_tax, 0);
          const expensesTotalIncTax = bulkExpenses.reduce(
            (s, e) => s + e.amount_inc_tax,
            0
          );

          // 1. header upsert (item_no=1 で単発)
          const headerRes = await query(
            `INSERT INTO order_items (
               backlog_issue_key, item_no, description, amount, vendor_code,
               tax_rate, due_date
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (backlog_issue_key) DO UPDATE SET
               description = COALESCE(NULLIF(EXCLUDED.description, ''), order_items.description),
               amount      = EXCLUDED.amount,
               vendor_code = COALESCE(NULLIF(EXCLUDED.vendor_code, ''), order_items.vendor_code),
               tax_rate    = EXCLUDED.tax_rate,
               due_date    = COALESCE(EXCLUDED.due_date, order_items.due_date)
             RETURNING id`,
            [
              issueKey,
              1,
              first.description || "",
              totalExTax,
              first.vendor_code || null,
              taxRate,
              first.due_date || null,
            ]
          );
          const orderItemId = Number(headerRes.rows[0].id);

          // 2. lines: 既存削除 + 入れ直し
          await query("DELETE FROM order_line_items WHERE order_item_id = $1", [
            orderItemId,
          ]);
          for (const l of lines) {
            await query(
              `INSERT INTO order_line_items (
                 order_item_id, line_no, item_name, spec,
                 unit_price, quantity, amount_ex_tax,
                 calc_method, payment_terms,
                 payment_method, payment_date, delivery_date,
                 cycle, term_start, term_end, billing_day
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
              [
                orderItemId,
                l.line_no,
                l.item_name,
                l.spec,
                l.unit_price,
                l.quantity,
                l.amount_ex_tax,
                l.calc_method,
                l.payment_terms,
                l.payment_method,
                l.payment_date,
                l.delivery_date,
                // Phase 22.11: SUBSCRIPTION 構造化フィールド
                (l as any).cycle || null,
                (l as any).term_start || null,
                (l as any).term_end || null,
                (l as any).billing_day === null || (l as any).billing_day === undefined
                  ? null
                  : Number((l as any).billing_day),
              ]
            );
          }

          // Phase 17i: 経費を一括 upsert (既存削除 + 入れ直し)
          await query("DELETE FROM order_expenses WHERE order_item_id = $1", [
            orderItemId,
          ]);
          for (const e of bulkExpenses) {
            await query(
              `INSERT INTO order_expenses (
                 order_item_id, line_no, expense_name, spec,
                 spent_date, amount_inc_tax, remarks
               ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                orderItemId,
                e.line_no,
                e.expense_name,
                e.spec,
                e.spent_date,
                e.amount_inc_tax,
                e.remarks,
              ]
            );
          }

          const totals = await recalculateOrderTotal(orderItemId, taxRate);

          // 3. documents 履歴
          await query(
            `INSERT INTO documents (
               document_number, issue_key, template_type, form_data,
               drive_link, created_by
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (document_number) DO UPDATE SET
               form_data  = EXCLUDED.form_data,
               drive_link = EXCLUDED.drive_link`,
            [
              docNumber,
              issueKey,
              "purchase_order",
              JSON.stringify({
                // Phase 17v: CSV 行の取引先・案件情報も form_data に保存。
                //   これが無いと resync-contract-capabilities が
                //   form_data.VENDOR_CODE / VENDOR_NAME を見つけられず
                //   vendor_id=NULL のまま contract_capabilities に入り、
                //   法務検索で「個別契約」セクションに出てこなくなる。
                VENDOR_CODE: first.vendor_code || "",
                VENDOR_NAME: first.vendor_name || "",
                description: first.description || "",
                due_date: first.due_date || "",
                items: lines,
                expenses: bulkExpenses,
                expensesTotalIncTax,
                grandTotalExTax: totalExTax,
                taxRate,
                // Phase 22.21.31: 発注書 PDF 用ヘッダの最小セット。
                //   VENDOR 詳細 (住所 / 代表者 / 担当者) や PARTY_A (自社) は
                //   Document Editor 側で vendor_code → 取引先マスター →
                //   自動補完 / 自社プロファイル → PARTY_A_* 自動補完 で埋まる
                //   ため CSV 列には含めない。
                発注日: first.order_date || "",
                order_date: first.order_date || "",
                PROJECT_TITLE: first.project_title || first.description || "",
                // STAFF_EMAIL は既存 CSV 列なので保存しておく (Editor で
                // staff_email → staff 行 → STAFF_NAME / DEPARTMENT / PHONE 自動補完)
                STAFF_EMAIL: first.staff_email || "",
                __imported: true,
                __bulk: true,
              }),
              first.drive_link || "",
              "import-bulk",
            ]
          );

          // Phase 17b: 稟議番号紐付け
          await linkRingiByDocNumber(docNumber, first.ringi_numbers);

          // 4. external_assets (drive_link あれば)
          if (first.drive_link) {
            await query(
              `INSERT INTO external_assets
                 (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (asset_number) DO UPDATE SET
                 file_link = EXCLUDED.file_link,
                 counterparty = EXCLUDED.counterparty`,
              [
                docNumber,
                first.description || docNumber,
                "individual",
                first.vendor_name || first.vendor_code || "Imported",
                first.drive_link,
                issueKey,
              ]
            );
          }

          // Phase 15: インライン PDF 生成は廃止 (キュー方式に移行)。
          // generate_pdf="未作成" の行は __pdf_pending=true フラグだけ立てて
          // PDF 未作成キュー画面で後から確認しながら生成する。
          // Phase 22.21.28: 上部で計算済の pdfPendingEarly を流用 (二重計算回避)
          const pdfPending = pdfPendingEarly;
          if (pdfPending) {
            // form_data の __pdf_pending を true に更新 (キュー対象として印付け)
            await query(
              `UPDATE documents
                  SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'true'::jsonb)
                WHERE document_number = $1`,
              [docNumber]
            );
          }

          // Phase 22.21.27: legal_requests に contract_type='purchase_order' を
          //   登録。auto-chain ルールがマッチするためのキー情報。
          //   ON CONFLICT は contract_type を上書きしない (既存値尊重)。
          //   issueKey が IMPORT-... の synthetic だと autoChainOnComplete が
          //   Backlog API で getIssue できないのでスキップする。
          const isSyntheticKey = issueKey.startsWith("IMPORT-");
          if (!isSyntheticKey) {
            try {
              await query(
                `INSERT INTO legal_requests
                   (backlog_issue_key, contract_type, counterparty, summary)
                 VALUES ($1, 'purchase_order', $2, $3)
                 ON CONFLICT (backlog_issue_key) DO UPDATE SET
                   counterparty  = COALESCE(NULLIF(EXCLUDED.counterparty, ''), legal_requests.counterparty),
                   contract_type = COALESCE(NULLIF(legal_requests.contract_type, ''),
                                            EXCLUDED.contract_type)`,
                [
                  issueKey,
                  first.vendor_name || first.vendor_code || null,
                  first.description || `発注書 ${docNumber}`,
                ]
              );
            } catch (lrErr) {
              console.warn(
                `[bulk/order] legal_requests insert failed for ${issueKey}:`,
                lrErr
              );
            }
          }

          // Phase 22.21.27 + 22.21.28: auto_complete が true かつ PDF 作成済
          //   (= pdfPendingEarly が false) のときだけ Backlog ステータスを
          //   完了に進めて autoChainOnComplete を発火し「納品・検収」子課題
          //   を起こす。
          //   - 未作成 (pdfPendingEarly=true): 発注書を Document Editor で
          //     作るタスクが残っているため、ここでは完了化しない。
          //     ユーザーが Document Editor で実 PDF を生成 → 完了に進めた
          //     タイミングで auto-chain が走る (Phase 22.21.12 の通常経路)。
          //   - synthetic IMPORT-... key の場合もスキップ。
          let chainResult: { triggered: boolean; childIssueKey?: string } = {
            triggered: false,
          };
          const shouldAutoComplete =
            autoComplete && !isSyntheticKey && !pdfPendingEarly;
          if (pdfPendingEarly && !isSyntheticKey) {
            console.log(
              `📥 [bulk/order] ${issueKey} は PDF 未作成 → 完了化 + auto-chain はスキップ (Document Editor で PDF 生成後に完了へ進めてください)`
            );
          }
          if (shouldAutoComplete) {
            try {
              const completedStatusId = await resolveCompletedStatusId();
              if (completedStatusId) {
                await backlogService.updateIssueStatus(issueKey, completedStatusId);
                console.log(
                  `📡 [bulk/order] ${issueKey} → status 完了 (${completedStatusId})`
                );
              } else {
                console.warn(`[bulk/order] cannot resolve 完了 status id`);
              }
            } catch (statusErr: any) {
              console.warn(
                `[bulk/order] Backlog status update failed for ${issueKey}:`,
                statusErr?.message || statusErr
              );
            }
            // auto-chain (納品・検収 子課題作成)
            try {
              const parentIssueForChain = await backlogService.getIssue(issueKey);
              await autoChainOnComplete(issueKey, parentIssueForChain);
              chainResult.triggered = true;
              // 結果課題の確認は最良努力 (children query は冪等)
              try {
                const kids =
                  (await backlogService.getChildIssues(parentIssueForChain.id)) ||
                  [];
                const deliveryChild = kids.find(
                  (k: any) => k?.issueType?.name === "納品・検収"
                );
                if (deliveryChild?.issueKey) {
                  chainResult.childIssueKey = deliveryChild.issueKey;
                }
              } catch {
                /* noop */
              }
            } catch (chainErr) {
              console.warn(
                `[bulk/order] autoChainOnComplete failed for ${issueKey}:`,
                chainErr
              );
            }
          }

          succeeded.push({
            import_key: importKey,
            order_item_id: orderItemId,
            issue_key: issueKey,
            issue_key_created: backlogIssueCreated,
            document_number: docNumber,
            line_count: lines.length,
            expense_count: bulkExpenses.length,
            expenses_total_inc_tax: expensesTotalIncTax,
            total_ex_tax: totals?.amount_ex_tax ?? totalExTax,
            pdf_pending: pdfPending,
            // Phase 22.21.27/28: bulk import の結果に Backlog 自動化の状態
            //   - issue_type: 文書作成 (未作成) or 契約審査 (作成済)
            //   - auto_completed: 完了に進めた + auto-chain 起動した
            //   - delivery_child_issue_key: 納品・検収 子課題のキー
            backlog_issue_type: backlogIssueCreated
              ? pdfPending
                ? "文書作成"
                : "契約審査"
              : null,
            auto_completed: shouldAutoComplete && chainResult.triggered,
            delivery_child_issue_key: chainResult.childIssueKey || null,
          });
        } catch (e: any) {
          console.error(`/api/imports/bulk/order group=${importKey} failed:`, e);
          failed.push({
            import_key: importKey,
            error: String(e?.message || e),
          });
        }
      }

      res.json({
        ok: true,
        total_rows: rows.length,
        groups: groups.size,
        succeeded,
        failed,
      });
    } catch (error) {
      console.error("/api/imports/bulk/order failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * Bulk import: 個別利用許諾条件書。
   * CSV 1 行 = 1 金銭条件、import_key でグループ化。
   * 各グループは 1 ライセンス契約として license_contracts +
   * license_financial_conditions を作成。
   */
  app.post(
    "/api/imports/bulk/license-contract",
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const groups = groupByImportKey(rows);
        const succeeded: any[] = [];
        const failed: any[] = [];

        for (const [importKey, groupRows] of groups) {
          try {
            const first = groupRows[0];
            const issueKey =
              first.issue_key && String(first.issue_key).trim().length > 0
                ? String(first.issue_key).trim()
                : `IMPORT-${Date.now()}-${succeeded.length + failed.length}`;
            const contractNumber =
              first.contract_number &&
              String(first.contract_number).trim().length > 0
                ? String(first.contract_number).trim()
                : await getNewDocumentNumber(
                    "individual_license_terms",
                    "個別利用許諾条件"
                  );
            const ledgerId =
              first.ledger_id && String(first.ledger_id).trim().length > 0
                ? String(first.ledger_id).trim()
                : contractNumber;

            // 1. license_contracts header upsert
            const lcRes = await query(
              `INSERT INTO license_contracts (
                 backlog_issue_key, ledger_id, ledger_number, contract_number,
                 licensor, original_work,
                 licensor_name, licensor_address, licensor_rep, licensor_is_corporation,
                 licensee_name, licensee_address, licensee_rep, licensee_is_corporation,
                 product_name_predicted,
                 license_start_date, license_period_note,
                 supervisor, credit_display, remarks
               )
               VALUES ($1, $2, $3, $4, $5, $6,
                       $7, $8, $9, $10,
                       $11, $12, $13, $14,
                       $15, $16, $17, $18, $19, $20)
               ON CONFLICT (backlog_issue_key) DO UPDATE SET
                 contract_number          = EXCLUDED.contract_number,
                 licensor_name            = COALESCE(NULLIF(EXCLUDED.licensor_name, ''), license_contracts.licensor_name),
                 licensor_address         = COALESCE(NULLIF(EXCLUDED.licensor_address, ''), license_contracts.licensor_address),
                 licensor_rep             = COALESCE(NULLIF(EXCLUDED.licensor_rep, ''), license_contracts.licensor_rep),
                 licensor_is_corporation  = EXCLUDED.licensor_is_corporation,
                 licensee_name            = COALESCE(NULLIF(EXCLUDED.licensee_name, ''), license_contracts.licensee_name),
                 licensee_address         = COALESCE(NULLIF(EXCLUDED.licensee_address, ''), license_contracts.licensee_address),
                 licensee_rep             = COALESCE(NULLIF(EXCLUDED.licensee_rep, ''), license_contracts.licensee_rep),
                 licensee_is_corporation  = EXCLUDED.licensee_is_corporation,
                 original_work            = COALESCE(NULLIF(EXCLUDED.original_work, ''), license_contracts.original_work),
                 product_name_predicted   = COALESCE(NULLIF(EXCLUDED.product_name_predicted, ''), license_contracts.product_name_predicted),
                 license_start_date       = COALESCE(EXCLUDED.license_start_date, license_contracts.license_start_date),
                 license_period_note      = COALESCE(NULLIF(EXCLUDED.license_period_note, ''), license_contracts.license_period_note),
                 supervisor               = COALESCE(NULLIF(EXCLUDED.supervisor, ''), license_contracts.supervisor),
                 credit_display           = COALESCE(NULLIF(EXCLUDED.credit_display, ''), license_contracts.credit_display),
                 remarks                  = COALESCE(NULLIF(EXCLUDED.remarks, ''), license_contracts.remarks)
               RETURNING id`,
              [
                issueKey,
                ledgerId,
                contractNumber,
                contractNumber,
                first.licensor_name || "",
                first.original_work || "",
                first.licensor_name || "",
                first.licensor_address || "",
                first.licensor_rep || "",
                !!first.licensor_is_corporation,
                first.licensee_name || "",
                first.licensee_address || "",
                first.licensee_rep || "",
                !!first.licensee_is_corporation,
                first.product_name_predicted || "",
                first.license_start_date || null,
                first.license_period_note || "",
                first.supervisor || "",
                first.credit_display || "",
                first.remarks || "",
              ]
            );
            const lcId = Number(lcRes.rows[0].id);

            // 2. financial_conditions: 既存削除 + 入れ直し
            const conditions = groupRows
              .filter((r) => r.condition_no || r.calc_method || r.rate_pct)
              .map((r, idx) => ({
                condition_no: Number(r.condition_no) || idx + 1,
                region_language_label: r.region_language_label || null,
                calc_method: r.calc_method || null,
                rate_pct: r.rate_pct != null ? Number(r.rate_pct) : null,
                base_price_label: r.base_price_label || null,
                calc_period: r.calc_period || null,
                currency: r.currency || "JPY",
                formula_text: r.formula_text || null,
                payment_terms: r.payment_terms || null,
                mg_amount: r.mg_amount != null ? Number(r.mg_amount) : 0,
              }));

            try {
              if (conditions.length > 0) {
                const keepNos = conditions.map((c) => c.condition_no);
                await query(
                  `DELETE FROM license_financial_conditions
                    WHERE license_contract_id = $1
                      AND condition_no NOT IN (${keepNos.map((_, i) => `$${i + 2}`).join(",")})`,
                  [lcId, ...keepNos]
                );
              }
            } catch (delErr) {
              console.warn("bulk license-contract delete pruning failed:", delErr);
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
                  c.condition_no,
                  c.region_language_label,
                  c.calc_method,
                  c.rate_pct,
                  c.base_price_label,
                  c.calc_period,
                  c.currency,
                  c.formula_text,
                  c.payment_terms,
                  c.mg_amount,
                ]
              );
            }

            // 3. documents
            await query(
              `INSERT INTO documents (
                 document_number, issue_key, template_type, form_data,
                 drive_link, created_by
               ) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (document_number) DO UPDATE SET
                 form_data  = EXCLUDED.form_data,
                 drive_link = EXCLUDED.drive_link`,
              [
                contractNumber,
                issueKey,
                "individual_license_terms",
                JSON.stringify({
                  financial_conditions: conditions,
                  __imported: true,
                  __bulk: true,
                }),
                first.drive_link || "",
                "import-bulk",
              ]
            );

            // Phase 17b: 稟議番号紐付け
            await linkRingiByDocNumber(contractNumber, first.ringi_numbers);

            // 4. external_assets
            if (first.drive_link) {
              await query(
                `INSERT INTO external_assets
                   (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (asset_number) DO UPDATE SET
                   file_link = EXCLUDED.file_link,
                   counterparty = EXCLUDED.counterparty`,
                [
                  contractNumber,
                  first.original_work || contractNumber,
                  "contract",
                  first.licensor_name || "Imported",
                  first.drive_link,
                  issueKey,
                ]
              );
            }

            // Phase 15: キュー方式 — フラグだけ立てて後で個別に生成
            const pdfPending = shouldGeneratePdf(first.generate_pdf);
            if (pdfPending) {
              await query(
                `UPDATE documents
                    SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'true'::jsonb)
                  WHERE document_number = $1`,
                [contractNumber]
              );
            }

            succeeded.push({
              import_key: importKey,
              license_contract_id: lcId,
              issue_key: issueKey,
              contract_number: contractNumber,
              condition_count: conditions.length,
              pdf_pending: pdfPending,
            });
          } catch (e: any) {
            console.error(
              `/api/imports/bulk/license-contract group=${importKey} failed:`,
              e
            );
            failed.push({
              import_key: importKey,
              error: String(e?.message || e),
            });
          }
        }

        res.json({
          ok: true,
          total_rows: rows.length,
          groups: groups.size,
          succeeded,
          failed,
        });
      } catch (error) {
        console.error("/api/imports/bulk/license-contract failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * Bulk import: ライセンス基本契約書 (license_master)。
   * 1 行 = 1 doc。グループ化不要だが import_key を尊重して順序保持。
   */
  app.post(
    "/api/imports/bulk/license-master",
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const succeeded: any[] = [];
        const failed: any[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const importKey = r.import_key || `__ROW_${idx}__`;
          try {
            const issueKey =
              r.issue_key && String(r.issue_key).trim().length > 0
                ? String(r.issue_key).trim()
                : `IMPORT-${Date.now()}-${idx}`;
            const contractNumber =
              r.contract_number && String(r.contract_number).trim().length > 0
                ? String(r.contract_number).trim()
                : await getNewDocumentNumber("license_master", "ライセンス基本契約");
            const ledgerId =
              r.ledger_id && String(r.ledger_id).trim().length > 0
                ? String(r.ledger_id).trim()
                : contractNumber;

            const lcRes = await query(
              `INSERT INTO license_contracts (
                 backlog_issue_key, ledger_id, ledger_number, contract_number,
                 licensor, original_work,
                 basic_contract_name, issue_date,
                 licensor_name, licensor_address, licensor_rep, licensor_is_corporation,
                 licensee_name, licensee_address, licensee_rep, licensee_is_corporation,
                 product_name_predicted,
                 license_start_date, license_period_note,
                 supervisor, credit_display, remarks
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                       $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
               ON CONFLICT (backlog_issue_key) DO UPDATE SET
                 contract_number          = EXCLUDED.contract_number,
                 basic_contract_name      = COALESCE(NULLIF(EXCLUDED.basic_contract_name, ''), license_contracts.basic_contract_name),
                 issue_date               = COALESCE(EXCLUDED.issue_date, license_contracts.issue_date),
                 licensor_name            = COALESCE(NULLIF(EXCLUDED.licensor_name, ''), license_contracts.licensor_name),
                 licensee_name            = COALESCE(NULLIF(EXCLUDED.licensee_name, ''), license_contracts.licensee_name),
                 original_work            = COALESCE(NULLIF(EXCLUDED.original_work, ''), license_contracts.original_work)
               RETURNING id`,
              [
                issueKey,
                ledgerId,
                contractNumber,
                contractNumber,
                r.licensor_name || "",
                r.original_work || "",
                r.basic_contract_name || "",
                r.issue_date || null,
                r.licensor_name || "",
                r.licensor_address || "",
                r.licensor_rep || "",
                !!r.licensor_is_corporation,
                r.licensee_name || "",
                r.licensee_address || "",
                r.licensee_rep || "",
                !!r.licensee_is_corporation,
                r.product_name_predicted || "",
                r.license_start_date || null,
                r.license_period_note || "",
                r.supervisor || "",
                r.credit_display || "",
                r.remarks || "",
              ]
            );
            const lcId = Number(lcRes.rows[0].id);

            await query(
              `INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (document_number) DO UPDATE SET form_data = EXCLUDED.form_data, drive_link = EXCLUDED.drive_link`,
              [
                contractNumber,
                issueKey,
                "license_master",
                JSON.stringify({
                  ...r,
                  // Phase 17w: canonical な VENDOR_CODE / VENDOR_NAME を入れる
                  //   resync が拾えるように。
                  VENDOR_CODE: r.vendor_code || "",
                  VENDOR_NAME: r.licensor_name || "",
                  __imported: true,
                  __bulk: true,
                }),
                r.drive_link || "",
                "import-bulk",
              ]
            );

            // Phase 17b: 稟議番号紐付け
            await linkRingiByDocNumber(contractNumber, r.ringi_numbers);

            // Phase 17w: vendor 解決 (license-master は licensor = 取引先)
            const lmBulkVendorId = await resolveVendorIdForImport_(
              r.vendor_code,
              r.licensor_name
            );
            await query(
              `INSERT INTO contract_capabilities (
                 vendor_id, record_type, contract_category, contract_type, contract_title,
                 document_number, contract_status, effective_date, expiration_date,
                 auto_renewal, original_work, document_url, source_system
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
               ON CONFLICT (document_number) DO UPDATE SET
                 vendor_id      = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
                 contract_title = EXCLUDED.contract_title,
                 effective_date = EXCLUDED.effective_date,
                 expiration_date = EXCLUDED.expiration_date,
                 updated_at = CURRENT_TIMESTAMP`,
              [
                lmBulkVendorId,
                "master_contract",
                "license",
                "license_master",
                r.basic_contract_name || r.original_work || contractNumber,
                contractNumber,
                "executed",
                r.effective_date || r.license_start_date || null,
                r.expiration_date || null,
                !!r.auto_renewal,
                r.original_work || "",
                r.drive_link || "",
                "Import (Bulk CSV)",
              ]
            );

            if (r.drive_link) {
              await query(
                `INSERT INTO external_assets
                   (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (asset_number) DO UPDATE SET file_link = EXCLUDED.file_link`,
                [
                  contractNumber,
                  r.basic_contract_name || r.original_work || contractNumber,
                  "contract",
                  r.licensor_name || "Imported",
                  r.drive_link,
                  issueKey,
                ]
              );
            }

            // Phase 15: キュー方式
            const pdfPending = shouldGeneratePdf(r.generate_pdf);
            if (pdfPending) {
              await query(
                `UPDATE documents
                    SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'true'::jsonb)
                  WHERE document_number = $1`,
                [contractNumber]
              );
            }

            succeeded.push({
              import_key: importKey,
              license_contract_id: lcId,
              contract_number: contractNumber,
              ledger_id: ledgerId,
              pdf_pending: pdfPending,
            });
          } catch (e: any) {
            console.error(`/api/imports/bulk/license-master row=${idx} failed:`, e);
            failed.push({ import_key: importKey, error: String(e?.message || e) });
          }
        }

        res.json({
          ok: true,
          total_rows: rows.length,
          groups: rows.length,
          succeeded,
          failed,
        });
      } catch (error) {
        console.error("/api/imports/bulk/license-master failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * Bulk import: 業務委託基本契約書 (service_master)。
   * 1 行 = 1 doc。
   */
  app.post(
    "/api/imports/bulk/service-master",
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const succeeded: any[] = [];
        const failed: any[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const importKey = r.import_key || `__ROW_${idx}__`;
          try {
            const issueKey =
              r.issue_key && String(r.issue_key).trim().length > 0
                ? String(r.issue_key).trim()
                : `IMPORT-${Date.now()}-${idx}`;
            const contractNumber =
              r.contract_number && String(r.contract_number).trim().length > 0
                ? String(r.contract_number).trim()
                : await getNewDocumentNumber("service_master", "業務委託基本契約");

            let vendorId: number | null = null;
            if (r.vendor_code || r.vendor_name) {
              const vRes = await query(
                "SELECT id FROM vendors WHERE vendor_code = $1 OR vendor_name = $2 LIMIT 1",
                [r.vendor_code || "", r.vendor_name || ""]
              );
              if (vRes.rows.length > 0) vendorId = Number(vRes.rows[0].id);
            }

            await query(
              `INSERT INTO contract_capabilities (
                 vendor_id, record_type, contract_category, contract_type, contract_title,
                 document_number, contract_status, effective_date, expiration_date,
                 auto_renewal, document_url, source_system
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (document_number) DO UPDATE SET
                 vendor_id = EXCLUDED.vendor_id,
                 contract_title = EXCLUDED.contract_title,
                 effective_date = EXCLUDED.effective_date,
                 expiration_date = EXCLUDED.expiration_date,
                 updated_at = CURRENT_TIMESTAMP`,
              [
                vendorId,
                "master_contract",
                "service",
                "service_master",
                r.contract_title || contractNumber,
                contractNumber,
                "executed",
                r.effective_date || null,
                r.expiration_date || null,
                !!r.auto_renewal,
                r.drive_link || "",
                "Import (Bulk CSV)",
              ]
            );

            await query(
              `INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (document_number) DO UPDATE SET form_data = EXCLUDED.form_data, drive_link = EXCLUDED.drive_link`,
              [
                contractNumber,
                issueKey,
                "service_master",
                JSON.stringify({ ...r, __imported: true, __bulk: true }),
                r.drive_link || "",
                "import-bulk",
              ]
            );

            // Phase 17b: 稟議番号紐付け
            await linkRingiByDocNumber(contractNumber, r.ringi_numbers);

            if (r.drive_link) {
              await query(
                `INSERT INTO external_assets
                   (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (asset_number) DO UPDATE SET file_link = EXCLUDED.file_link`,
                [
                  contractNumber,
                  r.contract_title || contractNumber,
                  "contract",
                  r.vendor_name || r.party_b_name || "Imported",
                  r.drive_link,
                  issueKey,
                ]
              );
            }

            // Phase 15: キュー方式
            const pdfPending = shouldGeneratePdf(r.generate_pdf);
            if (pdfPending) {
              await query(
                `UPDATE documents
                    SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'true'::jsonb)
                  WHERE document_number = $1`,
                [contractNumber]
              );
            }

            succeeded.push({
              import_key: importKey,
              contract_number: contractNumber,
              vendor_id: vendorId,
              pdf_pending: pdfPending,
            });
          } catch (e: any) {
            console.error(`/api/imports/bulk/service-master row=${idx} failed:`, e);
            failed.push({ import_key: importKey, error: String(e?.message || e) });
          }
        }

        res.json({
          ok: true,
          total_rows: rows.length,
          groups: rows.length,
          succeeded,
          failed,
        });
      } catch (error) {
        console.error("/api/imports/bulk/service-master failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * Bulk import: NDA (秘密保持契約書)。1 行 = 1 doc。
   *
   * documents (template_type='nda', category='other') +
   * contract_capabilities (record_type='master_contract',
   * contract_category='nda') + external_assets を作成。
   */
  app.post(
    "/api/imports/bulk/nda",
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const succeeded: any[] = [];
        const failed: any[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const importKey = r.import_key || `__ROW_${idx}__`;
          try {
            const issueKey =
              r.issue_key && String(r.issue_key).trim().length > 0
                ? String(r.issue_key).trim()
                : `IMPORT-${Date.now()}-${idx}`;
            const contractNumber =
              r.contract_number && String(r.contract_number).trim().length > 0
                ? String(r.contract_number).trim()
                : await getNewDocumentNumber("nda", "NDA");

            // documents 履歴 (template_type='nda' → trigger で category='other')
            await query(
              `INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (document_number) DO UPDATE SET
                 form_data = EXCLUDED.form_data,
                 drive_link = EXCLUDED.drive_link`,
              [
                contractNumber,
                issueKey,
                "nda",
                JSON.stringify({
                  ...r,
                  // Phase 17w: canonical な VENDOR_CODE / VENDOR_NAME を入れる
                  //   NDA は party_b が相手方 (= 取引先)。
                  VENDOR_CODE: r.vendor_code || "",
                  VENDOR_NAME: r.party_b_name || r.counterparty || "",
                  __imported: true,
                  __bulk: true,
                }),
                r.drive_link || "",
                "import-bulk",
              ]
            );

            // Phase 17b: 稟議番号紐付け
            await linkRingiByDocNumber(contractNumber, r.ringi_numbers);

            // contract_capabilities (NDA は契約カテゴリ独立)
            // Phase 17w: vendor_id を解決して INSERT に含める
            const ndaVendorId = await resolveVendorIdForImport_(
              r.vendor_code,
              r.party_b_name || r.counterparty
            );
            await query(
              `INSERT INTO contract_capabilities (
                 vendor_id, record_type, contract_category, contract_type, contract_title,
                 document_number, contract_status, effective_date, expiration_date,
                 auto_renewal, document_url, source_system
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (document_number) DO UPDATE SET
                 vendor_id      = COALESCE(EXCLUDED.vendor_id, contract_capabilities.vendor_id),
                 contract_title = EXCLUDED.contract_title,
                 effective_date = EXCLUDED.effective_date,
                 expiration_date = EXCLUDED.expiration_date,
                 updated_at = CURRENT_TIMESTAMP`,
              [
                ndaVendorId,
                "master_contract",
                "nda",
                "nda",
                r.contract_title || "NDA",
                contractNumber,
                "executed",
                r.effective_date || r.issue_date || null,
                r.expiration_date || null,
                !!r.auto_renewal,
                r.drive_link || "",
                "Import (Bulk CSV)",
              ]
            );

            // external_assets
            if (r.drive_link) {
              await query(
                `INSERT INTO external_assets
                   (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (asset_number) DO UPDATE SET file_link = EXCLUDED.file_link`,
                [
                  contractNumber,
                  r.contract_title || "NDA",
                  "contract",
                  r.party_b_name || r.party_a_name || "Imported",
                  r.drive_link,
                  issueKey,
                ]
              );
            }

            // Phase 15: キュー方式
            const pdfPending = shouldGeneratePdf(r.generate_pdf);
            if (pdfPending) {
              await query(
                `UPDATE documents
                    SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'true'::jsonb)
                  WHERE document_number = $1`,
                [contractNumber]
              );
            }

            succeeded.push({
              import_key: importKey,
              contract_number: contractNumber,
              issue_key: issueKey,
              pdf_pending: pdfPending,
            });
          } catch (e: any) {
            console.error(`/api/imports/bulk/nda row=${idx} failed:`, e);
            failed.push({ import_key: importKey, error: String(e?.message || e) });
          }
        }

        res.json({
          ok: true,
          total_rows: rows.length,
          groups: rows.length,
          succeeded,
          failed,
        });
      } catch (error) {
        console.error("/api/imports/bulk/nda failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * Bulk import: 売買基本契約書 (sales_master_*)。1 行 = 1 doc。
   * variant 列で buyer / standard / credit を振り分け。
   */
  app.post(
    "/api/imports/bulk/sales-master",
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const succeeded: any[] = [];
        const failed: any[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const importKey = r.import_key || `__ROW_${idx}__`;
          try {
            // variant 値の正規化
            const variantRaw = String(r.variant || "standard").toLowerCase().trim();
            const variant =
              variantRaw === "buyer" || variantRaw === "credit" || variantRaw === "standard"
                ? variantRaw
                : "standard";
            const templateType = `sales_master_${variant}`;

            const issueKey =
              r.issue_key && String(r.issue_key).trim().length > 0
                ? String(r.issue_key).trim()
                : `IMPORT-${Date.now()}-${idx}`;
            const contractNumber =
              r.contract_number && String(r.contract_number).trim().length > 0
                ? String(r.contract_number).trim()
                : await getNewDocumentNumber(templateType, "売買基本契約");

            // vendor lookup
            let vendorId: number | null = null;
            if (r.vendor_code || r.vendor_name || r.party_b_name) {
              const vRes = await query(
                "SELECT id FROM vendors WHERE vendor_code = $1 OR vendor_name = $2 OR vendor_name = $3 LIMIT 1",
                [r.vendor_code || "", r.vendor_name || "", r.party_b_name || ""]
              );
              if (vRes.rows.length > 0) vendorId = Number(vRes.rows[0].id);
            }

            // documents (template_type=sales_master_*, category='basic')
            await query(
              `INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (document_number) DO UPDATE SET
                 form_data = EXCLUDED.form_data,
                 drive_link = EXCLUDED.drive_link`,
              [
                contractNumber,
                issueKey,
                templateType,
                JSON.stringify({ ...r, variant, __imported: true, __bulk: true }),
                r.drive_link || "",
                "import-bulk",
              ]
            );

            // Phase 17b: 稟議番号紐付け
            await linkRingiByDocNumber(contractNumber, r.ringi_numbers);

            // contract_capabilities
            await query(
              `INSERT INTO contract_capabilities (
                 vendor_id, record_type, contract_category, contract_type, contract_title,
                 document_number, contract_status, effective_date, expiration_date,
                 auto_renewal, document_url, source_system
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (document_number) DO UPDATE SET
                 vendor_id = EXCLUDED.vendor_id,
                 contract_title = EXCLUDED.contract_title,
                 effective_date = EXCLUDED.effective_date,
                 expiration_date = EXCLUDED.expiration_date,
                 updated_at = CURRENT_TIMESTAMP`,
              [
                vendorId,
                "master_contract",
                "sales",
                templateType,
                r.contract_title || contractNumber,
                contractNumber,
                "executed",
                r.effective_date || null,
                r.expiration_date || null,
                !!r.auto_renewal,
                r.drive_link || "",
                "Import (Bulk CSV)",
              ]
            );

            // external_assets
            if (r.drive_link) {
              await query(
                `INSERT INTO external_assets
                   (asset_number, asset_name, asset_type, counterparty, file_link, backlog_issue_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (asset_number) DO UPDATE SET file_link = EXCLUDED.file_link`,
                [
                  contractNumber,
                  r.contract_title || contractNumber,
                  "contract",
                  r.vendor_name || r.party_b_name || "Imported",
                  r.drive_link,
                  issueKey,
                ]
              );
            }

            // Phase 15: キュー方式
            const pdfPending = shouldGeneratePdf(r.generate_pdf);
            if (pdfPending) {
              await query(
                `UPDATE documents
                    SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'true'::jsonb)
                  WHERE document_number = $1`,
                [contractNumber]
              );
            }

            succeeded.push({
              import_key: importKey,
              contract_number: contractNumber,
              issue_key: issueKey,
              variant,
              vendor_id: vendorId,
              pdf_pending: pdfPending,
            });
          } catch (e: any) {
            console.error(`/api/imports/bulk/sales-master row=${idx} failed:`, e);
            failed.push({ import_key: importKey, error: String(e?.message || e) });
          }
        }

        res.json({
          ok: true,
          total_rows: rows.length,
          groups: rows.length,
          succeeded,
          failed,
        });
      } catch (error) {
        console.error("/api/imports/bulk/sales-master failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  // -------------------------------------------------------------------
  // /api/ringi/* — Phase 17: 稟議マスタ + 文書との N:N 関連
  // 文書作成時インライン作成 + Masters タブの管理画面の両方から呼ばれる。
  // -------------------------------------------------------------------

  const RINGI_NUM_RE = /^[0-9]{5}$/;

  /**
   * 稟議の autocomplete / 検索。
   *   q: 5 桁数字 (前方一致) or title 部分一致
   */
  app.get("/api/ringi/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const sql = q
        ? `SELECT id, ringi_number, title, category, status, owner_name
             FROM ringi_records
            WHERE ringi_number ILIKE $1 || '%'
               OR title ILIKE '%' || $1 || '%'
            ORDER BY ringi_number ASC LIMIT $2`
        : `SELECT id, ringi_number, title, category, status, owner_name
             FROM ringi_records
            ORDER BY ringi_number DESC LIMIT $1`;
      const params = q ? [q, limit] : [limit];
      const r = await query(sql, params);
      res.json({ ok: true, rows: r.rows });
    } catch (error) {
      console.error("/api/ringi/search failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 単一稟議の詳細 + 紐付く文書一覧。
   * 法務検索 (稟議番号で検索) の表示にも使う。
   */
  app.get("/api/ringi/:number", async (req, res) => {
    try {
      const num = String(req.params.number || "").trim();
      const r = await query(
        `SELECT id, ringi_number, title, category, owner_name, owner_department,
                approved_at, backlog_issue_key, status, total_budget, remarks,
                created_at, updated_at
           FROM ringi_records WHERE ringi_number = $1`,
        [num]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "ringi not found" });
      }
      const ringi = r.rows[0];
      const docs = await query(
        `SELECT d.id, d.document_number, d.issue_key, d.template_type,
                d.document_category, d.drive_link, d.created_at,
                d.form_data
           FROM documents d
           JOIN ringi_documents rd ON rd.document_id = d.id
          WHERE rd.ringi_id = $1
          ORDER BY d.document_category, d.created_at DESC`,
        [ringi.id]
      );
      res.json({
        ok: true,
        ringi,
        documents: docs.rows.map((d: any) => {
          const fd = d.form_data || {};
          return {
            id: Number(d.id),
            document_number: d.document_number,
            issue_key: d.issue_key,
            template_type: d.template_type,
            document_category: d.document_category,
            drive_link: d.drive_link || "",
            created_at: d.created_at,
            counterparty:
              fd.vendor_name ||
              fd.party_b_name ||
              fd.licensor_name ||
              fd.licensee_name ||
              fd.counterparty ||
              "",
            title:
              fd.description ||
              fd.contract_title ||
              fd.basic_contract_name ||
              fd.original_work ||
              "",
            effective_date: fd.effective_date || fd.license_start_date || "",
            expiration_date: fd.expiration_date || "",
          };
        }),
      });
    } catch (error) {
      console.error("/api/ringi/:number failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 稟議を作成 / 更新 (upsert, ringi_number キー)。
   */
  app.post("/api/ringi", express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const ringiNumber = String(b.ringi_number || "").trim();
      if (!RINGI_NUM_RE.test(ringiNumber)) {
        return res.status(400).json({
          ok: false,
          error: `稟議番号は 5 桁数字で指定してください (received: '${ringiNumber}')`,
        });
      }
      if (!b.title || String(b.title).trim().length === 0) {
        return res.status(400).json({ ok: false, error: "title is required" });
      }
      const r = await query(
        `INSERT INTO ringi_records (
           ringi_number, title, category, owner_name, owner_department,
           approved_at, backlog_issue_key, status, total_budget, remarks
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (ringi_number) DO UPDATE SET
           title             = EXCLUDED.title,
           category          = COALESCE(NULLIF(EXCLUDED.category, ''), ringi_records.category),
           owner_name        = COALESCE(NULLIF(EXCLUDED.owner_name, ''), ringi_records.owner_name),
           owner_department  = COALESCE(NULLIF(EXCLUDED.owner_department, ''), ringi_records.owner_department),
           approved_at       = COALESCE(EXCLUDED.approved_at, ringi_records.approved_at),
           backlog_issue_key = COALESCE(NULLIF(EXCLUDED.backlog_issue_key, ''), ringi_records.backlog_issue_key),
           status            = COALESCE(NULLIF(EXCLUDED.status, ''), ringi_records.status),
           total_budget      = COALESCE(EXCLUDED.total_budget, ringi_records.total_budget),
           remarks           = COALESCE(NULLIF(EXCLUDED.remarks, ''), ringi_records.remarks),
           updated_at        = CURRENT_TIMESTAMP
         RETURNING id, ringi_number, title`,
        [
          ringiNumber,
          b.title,
          b.category || null,
          b.owner_name || null,
          b.owner_department || null,
          b.approved_at || null,
          b.backlog_issue_key || null,
          b.status || "open",
          b.total_budget != null ? Number(b.total_budget) : null,
          b.remarks || null,
        ]
      );
      res.json({ ok: true, ringi: r.rows[0] });
    } catch (error) {
      console.error("/api/ringi POST failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 文書と稟議の N:N リンク管理 (まとめて差し替え)。
   * body: { ringi_numbers: ["00001","00002"] }
   * 渡された配列を「正」とし、既存リンクを差し替える。
   */
  app.post(
    "/api/documents/:id/ringi-links",
    express.json(),
    async (req, res) => {
      try {
        const docId = Number(req.params.id);
        if (!Number.isFinite(docId) || docId <= 0) {
          return res.status(400).json({ ok: false, error: "invalid document id" });
        }
        const nums: string[] = Array.isArray(req.body?.ringi_numbers)
          ? req.body.ringi_numbers.map((s: any) => String(s || "").trim())
          : [];
        // 5 桁数字以外は除外
        const valid = nums.filter((n) => RINGI_NUM_RE.test(n));
        const invalid = nums.filter((n) => n && !RINGI_NUM_RE.test(n));

        // 既存リンク削除 → 入れ直し
        await query("DELETE FROM ringi_documents WHERE document_id = $1", [
          docId,
        ]);

        const linked: string[] = [];
        const notFound: string[] = [];
        for (const num of valid) {
          const r = await query(
            "SELECT id FROM ringi_records WHERE ringi_number = $1",
            [num]
          );
          if (r.rows.length === 0) {
            notFound.push(num);
            continue;
          }
          const ringiId = Number(r.rows[0].id);
          await query(
            `INSERT INTO ringi_documents (ringi_id, document_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [ringiId, docId]
          );
          linked.push(num);
        }
        res.json({
          ok: true,
          linked,
          not_found: notFound,
          invalid_format: invalid,
        });
      } catch (error) {
        console.error("/api/documents/:id/ringi-links POST failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * 文書 1 件に紐付く稟議一覧を返す (DocumentForm の RingiSelector が初期化時に使う)。
   */
  app.get("/api/documents/:id/ringi-links", async (req, res) => {
    try {
      const docId = Number(req.params.id);
      const r = await query(
        `SELECT rr.id, rr.ringi_number, rr.title, rr.status
           FROM ringi_records rr
           JOIN ringi_documents rd ON rd.ringi_id = rr.id
          WHERE rd.document_id = $1
          ORDER BY rr.ringi_number ASC`,
        [docId]
      );
      res.json({ ok: true, rows: r.rows });
    } catch (error) {
      console.error("/api/documents/:id/ringi-links GET failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // /api/documents/pending-pdf, /:id/regenerate-pdf, /:id/mark-as-imported
  // Phase 15: bulk import で「未作成」マーク付き ドキュメントを
  // 「PDF 未作成キュー」画面で 1 件ずつ確認しながら生成する経路。
  // -------------------------------------------------------------------

  /**
   * PDF 未作成キュー一覧。
   * form_data.__pdf_pending=true かつ drive_link が空のものを返す。
   */
  app.get("/api/documents/pending-pdf", async (req, res) => {
    try {
      const templateFilter = String(req.query.template_type || "").trim();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const params: any[] = [limit];
      let where = `(form_data->>'__pdf_pending')::text = 'true'
                    AND (drive_link IS NULL OR drive_link = '')`;
      if (templateFilter) {
        params.push(templateFilter);
        where += ` AND template_type = $${params.length}`;
      }
      const result = await query(
        `SELECT id, document_number, issue_key, template_type, document_category,
                form_data, drive_link, created_at
           FROM documents
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $1`,
        params
      );

      // form_data から summary 用の主要フィールドを抜粋して返す
      // (フロント表で「取引先 / タイトル / 主要情報」を 1 行で見せる用)。
      // form_data 全体も返す (編集ページの pre-fill 用)。
      const rows = result.rows.map((r: any) => {
        const fd = r.form_data || {};
        return {
          id: Number(r.id),
          document_number: r.document_number,
          issue_key: r.issue_key,
          template_type: r.template_type,
          document_category: r.document_category,
          created_at: r.created_at,
          form_data: fd, // Phase 15: 編集ページ pre-fill のため全部返す
          // 主要フィールド (テンプレ別に取り出すべきものを総ざらえ)
          summary: {
            counterparty:
              fd.vendor_name ||
              fd.party_b_name ||
              fd.licensor_name ||
              fd.licensee_name ||
              fd.counterparty ||
              "",
            title:
              fd.description ||
              fd.contract_title ||
              fd.basic_contract_name ||
              fd.original_work ||
              "",
            staff_email: fd.staff_email || "",
            line_count: Array.isArray(fd.items) ? fd.items.length : null,
            condition_count: Array.isArray(fd.financial_conditions)
              ? fd.financial_conditions.length
              : null,
            variant: fd.variant || null,
            amount: fd.grandTotalExTax || null,
          },
        };
      });

      // テンプレタイプ別 件数も同時に返す (タブの数字バッジ用)
      const countsRes = await query(
        `SELECT template_type, COUNT(*) AS n
           FROM documents
          WHERE (form_data->>'__pdf_pending')::text = 'true'
            AND (drive_link IS NULL OR drive_link = '')
          GROUP BY template_type
          ORDER BY n DESC`
      );
      const counts: Record<string, number> = {};
      countsRes.rows.forEach((r: any) => {
        counts[r.template_type] = Number(r.n);
      });

      res.json({
        ok: true,
        total: rows.length,
        rows,
        counts_by_template: counts,
      });
    } catch (error) {
      console.error("/api/documents/pending-pdf failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * Phase 16: document_number からドキュメント 1 件を引く。
   * Archive ページから「Re-edit」する経路で使う (asset_number =
   * document_number で紐付いているため)。
   */
  /**
   * Phase 22.12: 指定 document_number を「真の契約 (is_primary=TRUE)」にする。
   *   POST /api/documents/:docNumber/mark-primary
   *   同 base_document_number に属する他の行は is_primary=FALSE になり、
   *   superseded_by が今回の docNumber を指す。
   *
   *   Archive 画面で「これを真の契約にする」ボタンから呼ばれる。
   */
  app.post(
    "/api/documents/:docNumber/mark-primary",
    express.json(),
    async (req, res) => {
      try {
        const docNumber = String(req.params.docNumber || "").trim();
        if (!docNumber) {
          return res
            .status(400)
            .json({ ok: false, error: "invalid docNumber" });
        }
        const r = await query(
          `SELECT base_document_number FROM documents WHERE document_number = $1`,
          [docNumber]
        );
        if (r.rows.length === 0) {
          return res
            .status(404)
            .json({ ok: false, error: "document not found" });
        }
        const base = r.rows[0].base_document_number || docNumber;
        await markPrimaryDocument(base, docNumber);
        console.log(
          `🌟 [mark-primary] base=${base} → primary=${docNumber}`
        );
        return res.json({
          ok: true,
          document_number: docNumber,
          base_document_number: base,
        });
      } catch (error) {
        console.error("POST /api/documents/:docNumber/mark-primary failed:", error);
        return res
          .status(500)
          .json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * Phase 22.21.48: 文書アーカイブの部分検索。
   *
   *   GET /api/documents/search?q=<text>&template_types=a,b,c&limit=50
   *
   * - q: 部分一致 (NFKC 正規化、document_number / form_data の値 / issue_key を対象)
   *      空文字でも OK — その場合は template_types でフィルタした全件を created_at DESC で返す
   * - template_types: カンマ区切りで template_type を絞り込み (例: "service_master,license_master")
   * - limit: 1..200 (default 50)
   *
   * 発注書フォーム等の「基本契約検索」ウィジェットから呼ぶ。NFKC 正規化により
   * 全角/半角の差は無視 (Phase 22.21.47 と同じ思想)。
   */
  app.get("/api/documents/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const templateTypesRaw = String(req.query.template_types || "").trim();
      const templateTypes = templateTypesRaw
        ? templateTypesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const limit = Math.max(
        1,
        Math.min(200, Number(req.query.limit) || 50)
      );

      const conditions: string[] = [];
      const params: any[] = [];

      if (q) {
        params.push(`%${q.normalize("NFKC")}%`);
        const pIdx = params.length;
        conditions.push(
          `(
             normalize(document_number, NFKC) ILIKE normalize($${pIdx}, NFKC)
             OR normalize(COALESCE(issue_key, ''), NFKC) ILIKE normalize($${pIdx}, NFKC)
             OR normalize(form_data::text, NFKC) ILIKE normalize($${pIdx}, NFKC)
           )`
        );
      }
      if (templateTypes.length > 0) {
        params.push(templateTypes);
        conditions.push(`template_type = ANY($${params.length}::text[])`);
      }

      const whereNfkc = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      params.push(limit);

      const SQL_NFKC = `
        SELECT id, document_number, issue_key, template_type, document_category,
               form_data, drive_link, created_by, created_at,
               base_document_number, revision
          FROM documents
          ${whereNfkc}
          ORDER BY created_at DESC
          LIMIT $${params.length}
      `;

      // legacy fallback (PG12-) — normalize() を外しただけのフォーム
      const conditionsLegacy: string[] = [];
      const paramsLegacy: any[] = [];
      if (q) {
        paramsLegacy.push(`%${q}%`);
        const pIdx = paramsLegacy.length;
        conditionsLegacy.push(
          `(
             document_number ILIKE $${pIdx}
             OR COALESCE(issue_key, '') ILIKE $${pIdx}
             OR form_data::text ILIKE $${pIdx}
           )`
        );
      }
      if (templateTypes.length > 0) {
        paramsLegacy.push(templateTypes);
        conditionsLegacy.push(
          `template_type = ANY($${paramsLegacy.length}::text[])`
        );
      }
      paramsLegacy.push(limit);
      const SQL_LEGACY = `
        SELECT id, document_number, issue_key, template_type, document_category,
               form_data, drive_link, created_by, created_at,
               base_document_number, revision
          FROM documents
          ${conditionsLegacy.length > 0 ? `WHERE ${conditionsLegacy.join(" AND ")}` : ""}
          ORDER BY created_at DESC
          LIMIT $${paramsLegacy.length}
      `;

      let rows: any[] = [];
      try {
        const r = await query(SQL_NFKC, params);
        rows = r.rows;
      } catch (err: any) {
        if (err?.code === "42883") {
          console.warn(
            "[documents/search] normalize() unsupported, falling back to plain ILIKE"
          );
          const r = await query(SQL_LEGACY, paramsLegacy);
          rows = r.rows;
        } else {
          throw err;
        }
      }

      res.json({
        ok: true,
        total: rows.length,
        results: rows.map((r) => ({
          id: Number(r.id),
          document_number: r.document_number,
          issue_key: r.issue_key,
          template_type: r.template_type,
          document_category: r.document_category,
          form_data: r.form_data || {},
          drive_link: r.drive_link || "",
          created_by: r.created_by,
          created_at: r.created_at,
          base_document_number: r.base_document_number || null,
          revision: r.revision != null ? Number(r.revision) : null,
        })),
      });
    } catch (error) {
      console.error("/api/documents/search failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.get("/api/documents/by-number/:docNumber", async (req, res) => {
    try {
      const docNumber = String(req.params.docNumber || "").trim();
      if (!docNumber) {
        return res.status(400).json({ ok: false, error: "invalid docNumber" });
      }
      const result = await query(
        `SELECT id, document_number, issue_key, template_type, document_category,
                form_data, drive_link, created_by, created_at
           FROM documents WHERE document_number = $1`,
        [docNumber]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "document not found" });
      }
      const r = result.rows[0];
      res.json({
        ok: true,
        id: Number(r.id),
        document_number: r.document_number,
        issue_key: r.issue_key,
        template_type: r.template_type,
        document_category: r.document_category,
        form_data: r.form_data || {},
        drive_link: r.drive_link || "",
        created_by: r.created_by,
        created_at: r.created_at,
      });
    } catch (error) {
      console.error("/api/documents/by-number/:docNumber failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * Phase 16: 任意のドキュメント 1 件の詳細を返す。
   * Re-edit / Re-open 機能用 (form_data 全体を含む)。
   */
  app.get("/api/documents/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const result = await query(
        `SELECT id, document_number, issue_key, template_type, document_category,
                form_data, drive_link, created_by, created_at
           FROM documents WHERE id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "document not found" });
      }
      const r = result.rows[0];
      res.json({
        ok: true,
        id: Number(r.id),
        document_number: r.document_number,
        issue_key: r.issue_key,
        template_type: r.template_type,
        document_category: r.document_category,
        form_data: r.form_data || {},
        drive_link: r.drive_link || "",
        created_by: r.created_by,
        created_at: r.created_at,
      });
    } catch (error) {
      console.error("/api/documents/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 指定された 1 件の保留中ドキュメントについて、保存済み form_data から
   * テンプレを render → PDF → Drive アップロード → drive_link 更新。
   * 成功時は __pdf_pending=false に変更してキューから外す。
   */
  app.post("/api/documents/:id/regenerate-pdf", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const result = await query(
        `SELECT id, document_number, issue_key, template_type, form_data
           FROM documents WHERE id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "document not found" });
      }
      const doc = result.rows[0];
      const fd = doc.form_data || {};

      // staff 自動補完 (CSV に staff_email を入れていれば使う)
      const staff = await lookupStaffByEmail(fd.staff_email);
      const staffMerge = staff
        ? {
            STAFF_NAME: staff.staff_name,
            STAFF_DEPARTMENT: staff.department,
            STAFF_EMAIL: staff.email,
            STAFF_PHONE: staff.phone,
            inspectorName: fd.inspectorName || staff.staff_name,
            inspectorDept: fd.inspectorDept || staff.department,
            inspectorEmail: fd.inspectorEmail || staff.email,
          }
        : {};

      const pdfResult = await maybeGeneratePdfForImport(
        doc.template_type,
        doc.document_number,
        doc.issue_key,
        fd,
        staffMerge
      );

      if (!pdfResult.generated) {
        return res.status(500).json({
          ok: false,
          error: pdfResult.error || "PDF generation failed",
        });
      }

      // キューから外す
      await query(
        `UPDATE documents
            SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'false'::jsonb)
          WHERE id = $1`,
        [id]
      );

      res.json({
        ok: true,
        id,
        document_number: doc.document_number,
        drive_link: pdfResult.drive_link,
      });
    } catch (error) {
      console.error("/api/documents/:id/regenerate-pdf failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * Phase 22.21.33: 「📦 一括完了」エンドポイント。
   *
   *   POST /api/documents/:id/regenerate-and-complete
   *
   *   実行内容:
   *     1. regenerate-pdf と同じく PDF 生成 + Drive アップ + キュー除外
   *     2. Backlog 課題ステータスを 完了 (id=4) に進行
   *        - synthetic IMPORT-... / MANUAL-... key の場合はスキップ
   *     3. autoChainOnComplete を呼んで「納品・検収」子課題を起票
   *        (Phase 22.21.26 の race-safe lock 経由)
   *
   *   レスポンス:
   *     ok / drive_link / document_number / status_advanced / delivery_child_issue_key
   *
   *   失敗ハンドリング:
   *     - PDF 生成失敗: 500 で error 返却 (Backlog 触らない)
   *     - Backlog status 失敗 / auto-chain 失敗: warnings に積んで 200 で返す
   *       (PDF は完成しているので「失敗」とは扱わない)
   */
  app.post(
    "/api/documents/:id/regenerate-and-complete",
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ ok: false, error: "invalid id" });
        }
        const result = await query(
          `SELECT id, document_number, issue_key, template_type, form_data
             FROM documents WHERE id = $1`,
          [id]
        );
        if (result.rows.length === 0) {
          return res
            .status(404)
            .json({ ok: false, error: "document not found" });
        }
        const doc = result.rows[0];
        const fd = doc.form_data || {};

        // --- (1) PDF 生成 (regenerate-pdf 相当) ---
        const staff = await lookupStaffByEmail(fd.staff_email);
        const staffMerge = staff
          ? {
              STAFF_NAME: staff.staff_name,
              STAFF_DEPARTMENT: staff.department,
              STAFF_EMAIL: staff.email,
              STAFF_PHONE: staff.phone,
              inspectorName: fd.inspectorName || staff.staff_name,
              inspectorDept: fd.inspectorDept || staff.department,
              inspectorEmail: fd.inspectorEmail || staff.email,
            }
          : {};
        const pdfResult = await maybeGeneratePdfForImport(
          doc.template_type,
          doc.document_number,
          doc.issue_key,
          fd,
          staffMerge
        );
        if (!pdfResult.generated) {
          return res.status(500).json({
            ok: false,
            error: pdfResult.error || "PDF generation failed",
          });
        }
        // キューから外す
        await query(
          `UPDATE documents
              SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'false'::jsonb)
            WHERE id = $1`,
          [id]
        );

        const warnings: Array<{ step: string; error: string }> = [];
        let statusAdvanced = false;
        let deliveryChildKey: string | null = null;

        // synthetic key だと Backlog 連携不可
        const issueKey = String(doc.issue_key || "").trim();
        const isSyntheticKey =
          issueKey.startsWith("IMPORT-") || issueKey.startsWith("MANUAL-");

        if (!issueKey || isSyntheticKey) {
          warnings.push({
            step: "backlog",
            error: `issue_key が synthetic (${issueKey}) のため Backlog 連携をスキップ`,
          });
        } else {
          // --- (2) Backlog ステータスを 完了 に ---
          try {
            await backlogService.updateIssueStatus(issueKey, 4);
            statusAdvanced = true;
            console.log(
              `📡 [regen-complete] ${issueKey} → status 完了 (4)`
            );
          } catch (statusErr: any) {
            warnings.push({
              step: "backlog-status",
              error: String(statusErr?.message || statusErr),
            });
            console.warn(
              `[regen-complete] Backlog status update failed for ${issueKey}:`,
              statusErr?.message || statusErr
            );
          }

          // --- (3) auto-chain (納品・検収 子課題) ---
          try {
            const issue = await backlogService.getIssue(issueKey);
            await autoChainOnComplete(issueKey, issue);
            // 子課題が作られたか確認 (best effort)
            try {
              const kids =
                (await backlogService.getChildIssues(issue.id)) || [];
              const child = kids.find(
                (k: any) => k?.issueType?.name === "納品・検収"
              );
              if (child?.issueKey) {
                deliveryChildKey = String(child.issueKey);
              } else {
                // 兄弟として作られた場合は legal_requests から探す
                const sib = await query(
                  `SELECT backlog_issue_key FROM legal_requests
                    WHERE contract_type = 'delivery_inspec'
                      AND (parent_issue_key = $1 OR notes ILIKE $2)
                    ORDER BY created_at DESC LIMIT 1`,
                  [issueKey, `%親: ${issueKey}%`]
                );
                if (sib.rows[0]?.backlog_issue_key) {
                  deliveryChildKey = sib.rows[0].backlog_issue_key;
                }
              }
            } catch {
              /* noop */
            }
          } catch (chainErr: any) {
            warnings.push({
              step: "auto-chain",
              error: String(chainErr?.message || chainErr),
            });
          }
        }

        res.json({
          ok: true,
          id,
          document_number: doc.document_number,
          drive_link: pdfResult.drive_link,
          status_advanced: statusAdvanced,
          delivery_child_issue_key: deliveryChildKey,
          warnings,
        });
      } catch (error) {
        console.error(
          "/api/documents/:id/regenerate-and-complete failed:",
          error
        );
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * 「スキップ」操作 — __pdf_pending=false に変更してキューから除外。
   * PDF は作らないが DB 登録は維持。
   */
  app.post("/api/documents/:id/mark-as-imported", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const r = await query(
        `UPDATE documents
            SET form_data = jsonb_set(form_data, '{__pdf_pending}', 'false'::jsonb)
          WHERE id = $1
          RETURNING document_number`,
        [id]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "document not found" });
      }
      res.json({ ok: true, id, document_number: r.rows[0].document_number });
    } catch (error) {
      console.error("/api/documents/:id/mark-as-imported failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * Phase 17e: 稟議マスタの一括インポート (ringi_records への upsert)。
   * 文書とのリンクは作らない (これは「マスタ事前登録」のためのもの。
   * 個別文書からのリンクは別経路 bulk/order 等の ringi_numbers 列で行う)。
   */
  app.post(
    "/api/imports/bulk/ringi",
    express.json({ limit: "10mb" }),
    async (req, res) => {
      try {
        const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) {
          return res.status(400).json({ ok: false, error: "rows[] is required" });
        }
        const succeeded: any[] = [];
        const failed: any[] = [];

        for (let idx = 0; idx < rows.length; idx++) {
          const r = rows[idx];
          const ringiNumber = String(r.ringi_number || "").trim();
          try {
            if (!RINGI_NUM_RE.test(ringiNumber)) {
              throw new Error(
                `稟議番号は 5 桁数字で指定してください (received: '${ringiNumber}')`
              );
            }
            const title = String(r.title || "").trim();
            if (!title) {
              throw new Error("title は必須です");
            }
            const result = await query(
              `INSERT INTO ringi_records (
                 ringi_number, title, category, owner_name, owner_department,
                 approved_at, backlog_issue_key, status, total_budget, remarks
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (ringi_number) DO UPDATE SET
                 title             = EXCLUDED.title,
                 category          = COALESCE(NULLIF(EXCLUDED.category, ''), ringi_records.category),
                 owner_name        = COALESCE(NULLIF(EXCLUDED.owner_name, ''), ringi_records.owner_name),
                 owner_department  = COALESCE(NULLIF(EXCLUDED.owner_department, ''), ringi_records.owner_department),
                 approved_at       = COALESCE(EXCLUDED.approved_at, ringi_records.approved_at),
                 backlog_issue_key = COALESCE(NULLIF(EXCLUDED.backlog_issue_key, ''), ringi_records.backlog_issue_key),
                 status            = COALESCE(NULLIF(EXCLUDED.status, ''), ringi_records.status),
                 total_budget      = COALESCE(EXCLUDED.total_budget, ringi_records.total_budget),
                 remarks           = COALESCE(NULLIF(EXCLUDED.remarks, ''), ringi_records.remarks),
                 updated_at        = CURRENT_TIMESTAMP
               RETURNING id, ringi_number, title`,
              [
                ringiNumber,
                title,
                r.category || null,
                r.owner_name || null,
                r.owner_department || null,
                r.approved_at || null,
                r.backlog_issue_key || null,
                r.status || "open",
                r.total_budget != null && r.total_budget !== ""
                  ? Number(r.total_budget)
                  : null,
                r.remarks || null,
              ]
            );
            succeeded.push({
              import_key: r.import_key || `__ROW_${idx}__`,
              id: Number(result.rows[0].id),
              ringi_number: result.rows[0].ringi_number,
              title: result.rows[0].title,
            });
          } catch (e: any) {
            console.error(`/api/imports/bulk/ringi row=${idx} failed:`, e);
            failed.push({
              import_key: r.import_key || `__ROW_${idx}__`,
              error: String(e?.message || e),
            });
          }
        }
        res.json({
          ok: true,
          total_rows: rows.length,
          groups: rows.length,
          succeeded,
          failed,
        });
      } catch (error) {
        console.error("/api/imports/bulk/ringi failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  /**
   * テンプレ CSV ダウンロード。ユーザーがブランクのテンプレを Excel で
   * 開いて編集 → 一括 import するためのスケルトン。
   */
  app.get("/api/imports/bulk/templates/:type", (req, res) => {
    const { type } = req.params;
    const TEMPLATES: Record<string, { headers: string[]; sample: string[][] }> = {
      order: {
        // Phase 13: payment_method → calc_method + payment_terms に split。
        // payment_method 列も legacy 互換で受け取れるが、新規はこちらを推奨。
        // calc_method の値: FIXED / SUBSCRIPTION / ROYALTY (default FIXED)
        // payment_terms: 自由テキスト (例: '翌月末', '検収後')
        // Phase 14b: staff_email (担当者) / generate_pdf (作成済/未作成) 追加。
        // Phase 17i: row_type (item / expense) を追加。expense 行は同じ
        //   import_key グループに混在可。expense 行は line_no / expense_name /
        //   spec / spent_date / amount_inc_tax / remarks を使う。
        // Phase 22.11: SUBSCRIPTION 構造化フィールドを追加 (item 行のみ意味あり):
        //   cycle       : MONTHLY / QUARTERLY / SEMIANNUAL / ANNUAL
        //   term_start  : 契約開始日 (YYYY-MM-DD)
        //   term_end    : 契約終了日 (空なら継続中扱い)
        //   billing_day : 毎周期の支払日 (1-31。0 or >30 で末日)
        //   1 PO 内で FIXED と SUBSCRIPTION の明細混在 OK (per-row 判定)。
        headers: [
          // === 共通: グループキー + 識別子 ===
          "import_key",
          "issue_key",
          "document_number",
          "drive_link",
          // === 共通: 取引先・案件 ===
          //   vendor_code / vendor_name のみで OK。住所・代表者・担当者などの
          //   詳細は Document Editor で取引先マスター / 自社プロファイルから
          //   自動補完される (Phase 22.21.31 後の方針: CSV はミニマル列構成)。
          "vendor_code",
          "vendor_name",
          "description",
          // === Phase 22.21.31: 発注書専用ヘッダ追加 ===
          "order_date",            // 発注日 (Phase 22.21.30 で追加された PDF 行と紐付け)
          "project_title",         // 件名 (PROJECT_TITLE)。空なら description で fallback
          // === 共通: 期日・税率 ===
          "tax_rate",
          "due_date",
          "staff_email",
          "generate_pdf",
          "ringi_numbers",
          // === Phase 22.21.27: Backlog 課題自動作成 + 完了遷移 + auto-chain ===
          "create_backlog",
          "auto_complete",
          // === 明細・経費 (1 行 = 1 明細 or 経費) ===
          "row_type",
          "line_no",
          "item_name",
          "spec",
          "unit_price",
          "quantity",
          "calc_method",
          "payment_terms",
          "delivery_date",
          "payment_date",
          // === Phase 22.11: SUBSCRIPTION 専用フィールド (FIXED/ROYALTY 行は空欄で OK) ===
          "cycle",
          "term_start",
          "term_end",
          "billing_day",
          // === 経費行用 (row_type=expense のとき) ===
          "expense_name",
          "spent_date",
          "amount_inc_tax",
          "remarks",
        ],
        sample: [
          // Phase 22.21.31: ミニマル列構成版。
          //   発注先の住所 / 代表者 / 担当者 等は Document Editor 側で
          //   取引先マスター (vendor_code から) と自社プロファイルから
          //   自動補完されるため、CSV では vendor_code / vendor_name に絞る。
          //   ヘッダ追加: order_date (発注日) / project_title (件名) のみ。

          // === ORD001: 国内 PO、2 明細 + 2 経費。Backlog 既存課題に紐付け (issue_key=ARC-1234) ===
          //   作成済 → 契約審査 課題 + 完了 + 納品子課題チェーン。
          ["ORD001", "ARC-1234", "", "", "V001", "株式会社XYZ", "ノートPC調達",
           "2026-04-15", "ノートPC 5台調達",
           "10", "2026-04-30", "tanaka@arclight.co.jp", "作成済", "00001", "true", "true",
           "item",    "1", "ノートPC本体", "ThinkPad X1 Carbon", "180000", "5",
           "FIXED", "翌月末", "2026-04-25", "2026-05-31", "", "", "", "", "", "", "", ""],
          // ORD001 同グループ 2 明細目 (ヘッダ系は空でも OK — 1 行目を採用)
          ["ORD001", "ARC-1234", "", "", "V001", "株式会社XYZ", "ノートPC調達",
           "", "",
           "10", "2026-04-30", "tanaka@arclight.co.jp", "作成済", "00001", "true", "true",
           "item",    "2", "セットアップ作業料", "初期設定込み", "5000", "5",
           "FIXED", "翌月末", "2026-04-25", "2026-05-31", "", "", "", "", "", "", "", ""],
          ["ORD001", "ARC-1234", "", "", "V001", "株式会社XYZ", "ノートPC調達",
           "", "",
           "10", "2026-04-30", "tanaka@arclight.co.jp", "作成済", "00001", "true", "true",
           "expense", "1", "", "", "", "", "", "", "", "", "", "", "", "", "交通費", "2026-04-10", "12500", "東京〜大阪 新幹線"],
          ["ORD001", "ARC-1234", "", "", "V001", "株式会社XYZ", "ノートPC調達",
           "", "",
           "10", "2026-04-30", "tanaka@arclight.co.jp", "作成済", "00001", "true", "true",
           "expense", "2", "", "", "", "", "", "", "", "", "", "", "", "", "宿泊費", "2026-04-10", "9800",  "ビジネスホテル 1 泊"],

          // === ORD002: 単純 FIXED 1 明細。issue_key 空 → Backlog 新規作成 + 完了 + 納品子課題 ===
          ["ORD002", "", "", "", "V002", "株式会社ABC", "翻訳業務",
           "2026-05-01", "技術文書翻訳",
           "10", "", "tanaka@arclight.co.jp", "未作成", "00002", "true", "true",
           "item",    "1", "翻訳作業",   "EN→JA",          "5000",  "10", "FIXED", "検収後", "2026-06-15", "", "", "", "", "", "", "", "", ""],

          // === ORD003: 純サブスク。auto_complete=false → 課題は作るが 完了に進めない ===
          ["ORD003", "", "", "", "V003", "株式会社サンプル", "月額保守",
           "2026-04-01", "システム月額保守",
           "10", "", "tanaka@arclight.co.jp", "未作成", "00001,00003", "true", "false",
           "item", "1", "保守料月額", "12ヶ月", "50000", "12", "SUBSCRIPTION", "", "", "", "MONTHLY", "2026-04-01", "2027-03-31", "25", "", "", "", ""],

          // === ORD004: 顧問契約 (SUBSCRIPTION) + スポット業務 (FIXED) 混在 ===
          //   create_backlog=false → Backlog 課題自体を作らない (DB だけ登録)
          ["ORD004", "", "", "", "V004", "株式会社ミックス", "顧問+スポット",
           "2026-04-01", "法律顧問契約 + スポット業務",
           "10", "", "tanaka@arclight.co.jp", "未作成", "", "false", "false",
           "item", "1", "法律顧問業務", "月次定額 (顧問契約)", "100000", "12", "SUBSCRIPTION", "", "", "", "MONTHLY", "2026-04-01", "2027-03-31", "20", "", "", "", ""],
          ["ORD004", "", "", "", "V004", "株式会社ミックス", "顧問+スポット",
           "", "",
           "10", "", "tanaka@arclight.co.jp", "未作成", "", "false", "false",
           "item", "2", "新規契約レビュー (スポット)", "M&A 一件", "300000", "1", "FIXED", "翌月末", "2026-05-15", "2026-06-30", "", "", "", "", "", "", "", ""],
        ],
      },
      "license-contract": {
        headers: [
          "import_key",
          "issue_key",
          "contract_number",
          "ledger_id",
          "drive_link",
          "licensor_name",
          "licensor_address",
          "licensor_rep",
          "licensor_is_corporation",
          "licensee_name",
          "licensee_address",
          "licensee_rep",
          "licensee_is_corporation",
          "original_work",
          "product_name_predicted",
          "license_start_date",
          "license_period_note",
          "supervisor",
          "credit_display",
          "staff_email",
          "generate_pdf",
          "ringi_numbers",
          "remarks",
          "condition_no",
          "region_language_label",
          "calc_method",
          "rate_pct",
          "base_price_label",
          "calc_period",
          "currency",
          "formula_text",
          "payment_terms",
          "mg_amount",
        ],
        sample: [
          ["LIC001", "", "", "LIC-2024-001", "", "Sample IP Co.", "東京都...", "山田 太郎", "true", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "true", "ボードゲーム『◯◯』", "◯◯ Pocket", "2024-04-01", "基本契約の満了日まで", "", "© Sample IP", "tanaka@arclight.co.jp", "作成済", "00001", "", "1", "国内・日本語", "ROYALTY", "5.0", "上代", "四半期", "JPY", "上代 × 5.0% × 製造数", "四半期報告後の翌月末日払い", "1000000"],
          ["LIC001", "", "", "LIC-2024-001", "", "Sample IP Co.", "東京都...", "山田 太郎", "true", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "true", "ボードゲーム『◯◯』", "◯◯ Pocket", "2024-04-01", "基本契約の満了日まで", "", "© Sample IP", "tanaka@arclight.co.jp", "作成済", "00001", "", "2", "国内・日本語", "ROYALTY", "10.0", "売上", "四半期", "JPY", "売上 × 10.0%", "四半期報告後の翌月末日払い", "0"],
        ],
      },
      "license-master": {
        headers: [
          "import_key",
          "issue_key",
          "contract_number",
          "ledger_id",
          "drive_link",
          "basic_contract_name",
          "issue_date",
          "licensor_name",
          "licensor_address",
          "licensor_rep",
          "licensor_is_corporation",
          "licensee_name",
          "licensee_address",
          "licensee_rep",
          "licensee_is_corporation",
          "original_work",
          "effective_date",
          "expiration_date",
          "auto_renewal",
          "license_period_note",
          "supervisor",
          "credit_display",
          "staff_email",
          "generate_pdf",
          "ringi_numbers",
          "remarks",
        ],
        sample: [
          ["LM001", "", "", "LIC-MST-001", "", "◯◯シリーズ ライセンス基本契約", "2024-04-01", "Sample IP Co.", "東京都...", "山田 太郎", "true", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "true", "ボードゲーム『◯◯』", "2024-04-01", "2027-03-31", "true", "3 年自動更新", "", "", "tanaka@arclight.co.jp", "作成済", "00001", ""],
        ],
      },
      "service-master": {
        headers: [
          "import_key",
          "issue_key",
          "contract_number",
          "drive_link",
          "contract_title",
          "effective_date",
          "expiration_date",
          "auto_renewal",
          "vendor_code",
          "vendor_name",
          "party_a_name",
          "party_a_address",
          "party_a_rep",
          "party_b_name",
          "party_b_address",
          "party_b_rep",
          "staff_email",
          "generate_pdf",
          "ringi_numbers",
          "remarks",
        ],
        sample: [
          ["SM001", "", "", "", "株式会社XYZ 業務委託基本契約", "2024-04-01", "2027-03-31", "true", "V001", "株式会社XYZ", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "株式会社XYZ", "東京都...", "代表取締役 山田 太郎", "tanaka@arclight.co.jp", "作成済", "00001", ""],
        ],
      },
      // Phase 14a: NDA (秘密保持契約書)
      nda: {
        headers: [
          "import_key",
          "issue_key",
          "contract_number",
          "drive_link",
          "contract_title",
          "issue_date",
          "effective_date",
          "expiration_date",
          "term_months",
          "party_a_name",
          "party_a_address",
          "party_a_rep",
          "party_b_name",
          "party_b_address",
          "party_b_rep",
          "purpose",
          "return_or_destroy",
          "staff_email",
          "generate_pdf",
          "ringi_numbers",
          "remarks",
        ],
        sample: [
          ["NDA001", "", "", "", "業務協議に関する秘密保持契約", "2024-04-01", "2024-04-01", "2026-03-31", "24", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "株式会社XYZ", "東京都...", "代表取締役 山田 太郎", "新規ボードゲーム企画協議", "破棄", "tanaka@arclight.co.jp", "作成済", "00001", ""],
          ["NDA002", "", "", "", "ライセンス契約検討に伴う NDA", "2024-05-15", "2024-05-15", "2025-05-14", "12", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "Sample IP Co.", "Los Angeles, CA", "John Doe", "海外ライセンス可能性検討", "返却", "tanaka@arclight.co.jp", "未作成", "00002", ""],
        ],
      },
      // Phase 17e: 稟議マスタ
      ringi: {
        headers: [
          "import_key",
          "ringi_number",
          "title",
          "category",
          "owner_name",
          "owner_department",
          "approved_at",
          "backlog_issue_key",
          "status",
          "total_budget",
          "remarks",
        ],
        sample: [
          ["RNG001", "00001", "商品開発稟議 ◯◯シリーズ", "商品開発", "田中 太郎", "商品企画部", "2024-04-01", "ARC-1001", "approved", "5000000", "Phase 1 開発予算"],
          ["RNG002", "00002", "ライセンス取得稟議 (海外 IP)", "ライセンス取得", "鈴木 花子", "ライセンス部", "2024-05-15", "ARC-1050", "approved", "3000000", "Sample IP Co. との 3 年契約"],
          ["RNG003", "00003", "業務委託案件 (翻訳)", "業務委託", "佐藤 一郎", "編集部", "2024-06-01", "", "open", "500000", "翻訳業者選定中"],
        ],
      },
      // Phase 14a: 売買基本契約書 (3 バリエーション統合, variant 列で振り分け)
      "sales-master": {
        headers: [
          "import_key",
          "issue_key",
          "contract_number",
          "drive_link",
          "variant",
          "contract_title",
          "effective_date",
          "expiration_date",
          "auto_renewal",
          "vendor_code",
          "vendor_name",
          "party_a_name",
          "party_b_name",
          "party_b_address",
          "party_b_rep",
          "payment_terms",
          "delivery_terms",
          "credit_limit",
          "staff_email",
          "generate_pdf",
          "ringi_numbers",
          "remarks",
        ],
        sample: [
          ["SLS001", "", "", "", "buyer", "アークライト買主基本契約", "2024-04-01", "2027-03-31", "true", "V001", "株式会社XYZ", "株式会社アークライト", "株式会社XYZ", "東京都...", "代表取締役 山田 太郎", "翌月末払い", "FOB Tokyo", "5000000", "tanaka@arclight.co.jp", "作成済", "00001", ""],
          ["SLS002", "", "", "", "standard", "売買基本契約 (前払/代引)", "2024-04-01", "2027-03-31", "false", "V002", "株式会社ABC", "株式会社アークライト", "株式会社ABC", "東京都...", "代表取締役 鈴木", "前払い", "店頭引取", "", "tanaka@arclight.co.jp", "作成済", "00002", ""],
          ["SLS003", "", "", "", "credit", "売買基本契約 (掛売り)", "2024-04-01", "2027-03-31", "true", "V003", "株式会社DEF", "株式会社アークライト", "株式会社DEF", "東京都...", "代表取締役 佐藤", "月末締翌月末払い", "発送", "10000000", "tanaka@arclight.co.jp", "作成済", "00003", ""],
        ],
      },
    };
    const tmpl = TEMPLATES[type];
    if (!tmpl) {
      return res.status(404).json({ error: `Unknown template type: ${type}` });
    }
    // BOM + CRLF で Excel が UTF-8 + 日本語を文字化けなく開けるように
    const rows = [tmpl.headers.join(","), ...tmpl.sample.map((r) => r.join(","))];
    const csv = "﻿" + rows.join("\r\n") + "\r\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="import_template_${type}.csv"`
    );
    res.send(csv);
  });

  /**
   * 利用許諾料計算書を preview。MG 消化と試算を返す。
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

      // Phase 17i: 経費合計をサーバ側で再計算
      const previewExpenses = Array.isArray(formData?.expenses) ? formData.expenses : [];
      const previewExpensesTotal = previewExpenses.reduce(
        (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
        0
      );

      const { html, fileName } = await documentService.generateDocument(
        {
          issueKey: issueKey || "PREVIEW-000",
          documentNumber: "PREVIEW-" + Date.now(),
          summary: "Live Preview",
          requester: requesterEmail || "User",
          date: new Date().toLocaleDateString("ja-JP"),
          details: {
            ...formData,
            expenses: previewExpenses,
            expensesTotalIncTax: previewExpensesTotal,
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
    let { issueKey, templateType, formData, requesterEmail, nextStatusId, existingDocumentNumber } = req.body;

    try {
      // Admin UI が「Backlog 課題なし」で発行する仮キー (MANUAL-<ts>) は
      // Backlog 側に存在しない。getIssue で 404 になるため、合成 issue で
      // フォールバックする。同様に updateIssueStatus もスキップ。
      // テンプレ種別から issueType.name を推定 (workflow_settings 検索用)。
      const isManualIssue =
        typeof issueKey === "string" && issueKey.startsWith("MANUAL-");

      let issue: any;
      if (isManualIssue) {
        const inferredTypeName =
          templateType === "individual_license_terms"
            ? "個別利用許諾条件"
            : templateType === "license_master"
              ? "ライセンスマスター"
              : templateType === "purchase_order"
                ? "発注書"
                : templateType.startsWith("inspection_certificate")
                  ? "検収書"
                  : templateType === "royalty_statement"
                    ? "利用許諾料計算書"
                    : "Document";
        issue = {
          issueKey,
          summary: formData?.summary || formData?.PROJECT_TITLE || issueKey,
          issueType: { name: inferredTypeName },
          description: "",
        };
      } else {
        try {
          issue = await backlogService.getIssue(issueKey);
        } catch (e: any) {
          // Backlog 上に存在しない / 権限がない場合は MANUAL- 同様に
          // 続行可能にする (PDF 生成は副次的な Backlog 連携の有無に
          // 依らず実行できるべき)。
          console.warn(
            `Backlog getIssue failed for ${issueKey} (continuing with synthetic issue):`,
            e?.message || e
          );
          issue = {
            issueKey,
            summary: formData?.summary || formData?.PROJECT_TITLE || issueKey,
            issueType: { name: "Document" },
            description: "",
          };
        }
      }

      // Phase 22.10/22.11.2: 採番ロジック。
      //   優先順位:
      //   ① formData.documentNumberOverride が空でない → その文字列を強制使用
      //      (社内修正版のリビジョンを外に出さない用途。revision/isReissue は false)
      //   ② existingDocumentNumber 指定 + drive_link 空 → PDF未作成 draft 完成
      //   ③ existingDocumentNumber 指定 + drive_link 入り → リビジョン採番 _NNN
      //   ④ それ以外 → 完全新規採番
      const manualOverride =
        typeof formData?.documentNumberOverride === "string"
          ? formData.documentNumberOverride.trim()
          : "";
      let docNumber: string;
      let baseDocumentNumber: string;
      let revision: number;
      let isReissue: boolean;
      if (manualOverride) {
        // 手動上書き: 番号を完全にユーザーが制御
        docNumber = manualOverride;
        baseDocumentNumber = manualOverride;
        revision = 0;
        isReissue = false;
        console.log(
          `📝 [manual-override] ${issueKey} ${templateType}: docNumber=${docNumber}`
        );
      } else {
        const numAssign = await getDocumentNumberForGenerate({
          issueKey,
          templateType,
          issueTypeName: issue.issueType.name,
          existingDocumentNumber,
        });
        docNumber = numAssign.documentNumber;
        baseDocumentNumber = numAssign.baseDocumentNumber;
        revision = numAssign.revision;
        isReissue = numAssign.isReissue;
        if (isReissue) {
          console.log(
            `📝 [reissue] ${issueKey} ${templateType}: base=${baseDocumentNumber} rev=${revision} → ${docNumber}`
          );
        }
      }

      // Phase 18 (Manual Workflow): 文書生成時に Backlog status を
      // 自動進行させる挙動は撤去した。
      //
      // 以前は workflow_settings.next_status_id を参照して
      // backlogService.updateIssueStatus() を発火していたが、
      // 運用上「文書が完成した = ステータス進行 OK」と判断できない
      // ケースが多いため、Admin UI のワークフローパネルから人手で
      // ステータスを進める方針に変更した。
      //
      // workflow_settings テーブルは残してあり、UI 側で「推奨次ステータス」
      // として表示するヒントとして使う。
      //
      // 互換: 旧フローを残したい場合は、呼び出し元 (Admin UI) が
      // 明示的に nextStatusId を渡せば従来通り進行する (= opt-in)。
      if (nextStatusId && !isManualIssue) {
        try {
          await backlogService.updateIssueStatus(issueKey, nextStatusId);
          console.log(
            `📡 Manual Advance via nextStatusId: ${issueKey} → status ${nextStatusId} OK`
          );
          // Phase 22.21.20: 完了 (4) に進めたら自動連鎖を直接呼ぶ
          //   (Backlog webhook 待ちに依存しない)。冪等 (子課題があれば skip)。
          if (Number(nextStatusId) === 4) {
            try {
              const issueForChain = await backlogService.getIssue(issueKey);
              await autoChainOnComplete(issueKey, issueForChain);
            } catch (chainErr) {
              console.warn(
                `[auto-chain] direct call from /generate failed for ${issueKey}:`,
                chainErr
              );
            }
          }
        } catch (statusError) {
          console.warn(
            `[manual-advance] Backlog status 更新失敗 (${issueKey} → ${nextStatusId}):`,
            statusError
          );
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

      // -----------------------------------------------------------------
      // Phase 22.21.12: 個別利用許諾条件書 (individual_license_terms) の
      //   台帳ID / work_id を PDF レンダリング前に自動採番する。
      //   旧実装は templateType === "lic_individual" でチェックしていたが、
      //   実際の templateType は "individual_license_terms" のため分岐が
      //   一度もマッチせず採番されていなかった。さらに採番ロジックは
      //   generateDocument の "後" にあったため、PDF テンプレが空値で
      //   レンダリングされていた。両方を修正:
      //     - 分岐文字列を正す ("lic_individual" → "individual_license_terms")
      //     - 採番 (formData への書き戻し) を generateDocument の前に実行
      //   DB upsert 側 (旧 8534 行) は後段でも同じ値を再利用するので、
      //   ここで formData に書き込んだ値が PDF と DB の両方に反映される。
      // -----------------------------------------------------------------
      if (templateType === "individual_license_terms") {
        // 台帳ID 採番
        let resolvedLedgerId = formData.ledgerId
          ? String(formData.ledgerId).trim()
          : formData["台帳ID"]
            ? String(formData["台帳ID"]).trim()
            : "";
        if (!resolvedLedgerId) {
          const existing = await query(
            "SELECT ledger_id FROM license_contracts WHERE backlog_issue_key = $1 LIMIT 1",
            [issueKey]
          );
          if (existing.rows[0]?.ledger_id) {
            resolvedLedgerId = existing.rows[0].ledger_id;
          } else {
            resolvedLedgerId = await getNewLedgerId();
            console.log(
              `📒 [ledger-id pre-render] auto-assigned ${resolvedLedgerId} for ${issueKey}`
            );
          }
        }
        formData.ledgerId = resolvedLedgerId;
        formData["台帳ID"] = resolvedLedgerId;

        // work_id 採番 (formData.ledger_ref_id があれば ledger_code 配下で採番)
        let preResolvedWorkId: string = formData.work_id
          ? String(formData.work_id).trim()
          : "";
        const ledgerRefIdNum = formData.ledger_ref_id
          ? Number(formData.ledger_ref_id)
          : 0;
        // 既存 license_contracts に紐付き情報があれば取り込む (再発行ケース)
        if (!preResolvedWorkId) {
          const existingLc = await query(
            `SELECT ledger_ref_id, work_id FROM license_contracts
              WHERE backlog_issue_key = $1 LIMIT 1`,
            [issueKey]
          );
          if (existingLc.rows[0]?.work_id) {
            preResolvedWorkId = existingLc.rows[0].work_id;
          }
          // form から ledger_ref_id 来てないが DB にあれば取り込む
          if (!ledgerRefIdNum && existingLc.rows[0]?.ledger_ref_id) {
            formData.ledger_ref_id = Number(existingLc.rows[0].ledger_ref_id);
          }
        }
        // 新規採番 (ledger_ref_id がある場合のみ)
        if (!preResolvedWorkId) {
          const lref = formData.ledger_ref_id
            ? Number(formData.ledger_ref_id)
            : 0;
          if (lref) {
            const lr = await query(
              "SELECT ledger_code FROM ledgers WHERE id = $1",
              [lref]
            );
            if (lr.rows[0]?.ledger_code) {
              preResolvedWorkId = await getNewWorkId(lr.rows[0].ledger_code);
              console.log(
                `🎫 [work-id pre-render] auto-assigned ${preResolvedWorkId} for ${issueKey} (ledger=${lr.rows[0].ledger_code})`
              );
            }
          }
        }
        if (preResolvedWorkId) {
          formData.work_id = preResolvedWorkId;
          formData.WORK_ID = preResolvedWorkId;
        }
      }

      // Phase 7d: individual_license_terms 用に
      // formData.financial_conditions[] を HTML テンプレートが参照する
      // legacy flat field {{金銭条件1_料率}}, {{金銭条件1_計算式}} ... に
      // 展開する。Admin UI 側は FinancialConditionTable で構造化された
      // rows を持っているが、Handlebars テンプレ自体は古い flat ID で
      // 書かれているため、ここで橋渡し。
      // Phase 22.21.12: 分岐文字列を正す (旧: "lic_individual")
      if (
        templateType === "individual_license_terms" &&
        Array.isArray(formData.financial_conditions)
      ) {
        formData.financial_conditions.forEach((c: any) => {
          const n = Number(c.condition_no);
          if (!Number.isFinite(n) || n < 1) return;
          const prefix = `金銭条件${n}_`;
          formData[`${prefix}計算方式`] =
            formData[`${prefix}計算方式`] || c.calc_method || "";
          formData[`${prefix}料率`] =
            formData[`${prefix}料率`] ||
            (c.rate_pct !== undefined && c.rate_pct !== null
              ? String(c.rate_pct)
              : "");
          formData[`${prefix}基準価格`] =
            formData[`${prefix}基準価格`] || c.base_price_label || "";
          formData[`${prefix}計算期間`] =
            formData[`${prefix}計算期間`] || c.calc_period || "";
          formData[`${prefix}通貨`] =
            formData[`${prefix}通貨`] || c.currency || "";
          formData[`${prefix}計算式`] =
            formData[`${prefix}計算式`] || c.formula_text || "";
          formData[`${prefix}支払条件`] =
            formData[`${prefix}支払条件`] || c.payment_terms || "";
          formData[`${prefix}MG`] =
            formData[`${prefix}MG`] ||
            (c.mg_amount !== undefined && c.mg_amount !== null
              ? String(c.mg_amount)
              : "");
          formData[`${prefix}地域言語`] =
            formData[`${prefix}地域言語`] || c.region_language_label || "";
        });
      }

      // Phase 17i: 経費の合計 (税込) を確実にテンプレに渡す
      //   フロントが既に計算済みでも、念のためサーバ側で再計算して上書きする。
      const expensesForRender = Array.isArray(formData.expenses) ? formData.expenses : [];
      const expensesTotalIncTaxComputed = expensesForRender.reduce(
        (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
        0
      );

      // Phase 17m: 検収書の総支払額 = 検収税込 + 経費税込
      //   formData.totalAmountStr ("1,234") を数値化して expensesTotalIncTax を足す。
      //   inspection_certificate 系テンプレで {{grandTotalPayableStr}} を参照する。
      const inspectionTotalIncTax = Number(
        String(formData.totalAmountStr || "0").replace(/[^0-9.-]+/g, "")
      ) || 0;
      const grandTotalPayableComputed =
        inspectionTotalIncTax + expensesTotalIncTaxComputed;
      const expensesTotalIncTaxStrComputed =
        expensesTotalIncTaxComputed.toLocaleString("ja-JP");
      const grandTotalPayableStrComputed =
        grandTotalPayableComputed.toLocaleString("ja-JP");

      // Phase 22.10: ファイル名と reissue banner 用に取引先名を確定
      //   formData の VENDOR_NAME / counterparty / Licensor_名称 等から拾う。
      //   どれも無ければ空文字 (ファイル名にはサフィックスが付かない)。
      const vendorNameForFile: string =
        (formData?.VENDOR_NAME as string) ||
        (formData?.counterparty as string) ||
        (formData?.Licensor_名称 as string) ||
        (formData?.Licensor_氏名会社名 as string) ||
        (formData?.licensor as string) ||
        "";

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
            // Phase 17i: 経費（テンプレ側で {{#each expenses}} / {{expensesTotalIncTax}}）
            expenses: expensesForRender,
            expensesTotalIncTax: expensesTotalIncTaxComputed,
            // Phase 17m: 検収書専用 — 経費合計と総支払額の整形済み文字列
            expensesTotalIncTaxStr: expensesTotalIncTaxStrComputed,
            grandTotalPayable: grandTotalPayableComputed,
            grandTotalPayableStr: grandTotalPayableStrComputed,
            DOC_NO: docNumber,
            // Phase 22.10: 再発行時のリビジョン情報をテンプレに渡す。
            //   テンプレ側で {{#if isReissue}}<re-issue banner>{{/if}} 可能。
            BASE_DOC_NO: baseDocumentNumber,
            REVISION: revision,
            isReissue,
            // Phase 17l: ORDER_NO は新規発行された docNumber を優先する。
            //   issueKey (Backlog 課題キー) は最後のフォールバックに留めない —
            //   purchase_order テンプレ等で 発注番号 として表示されるため、
            //   ARC-PO-YYYY-NNNN を出さないと意味がない。
            //   - formData.orderNumber: ユーザーが手動入力した場合
            //   - parentOrderNumber:    検収書から見た親 PO の番号
            //   - docNumber:            通常はこれ (採番された自身の文書番号)
            ORDER_NO: formData.orderNumber || parentOrderNumber || docNumber,
            // Phase 22.15: ライセンス系テンプレが参照する CONTRACT_NO も
            //   自動採番した docNumber を渡す。formData にユーザー手動値が
            //   あればそれを優先 (上書き目的)。これにより license_master.html
            //   の {{CONTRACT_NO}} が空欄になる問題を解消。
            CONTRACT_NO: formData.CONTRACT_NO || docNumber,
            hasChangeLogs: !!formData.CHANGE_RECORDS,
            changeLogs: formData.CHANGE_RECORDS
              ? formData.CHANGE_RECORDS.split(";").map((log: string) => {
                  const [changedAt, fieldLabel, beforeValue, afterValue, reason] = log.split("|");
                  return { changedAt, fieldLabel, beforeValue, afterValue, reason };
                })
              : [],
          },
        },
        templateType,
        { vendorName: vendorNameForFile }
      );

      // Phase 9: PDF に切り替え。従来は uploadHtml で Google Docs に
      // 変換させていたが、CSS が大幅に潰れて template と程遠い見栄えに
      // なるため、Puppeteer で PDF をレンダリングしてそのまま upload する。
      const driveLink = await googleDriveService.uploadPdf(html, fileName);

      // Phase 15: 同じ document_number で再生成された場合 (PDF 未作成キュー
      // 由来など) は ON CONFLICT で UPDATE、新規なら INSERT。
      // form_data の __pdf_pending は false にして pending キューから外す。
      const mergedFormData = {
        ...(formData || {}),
        __pdf_pending: false,
      };
      const docInsert = await query(
        `INSERT INTO documents (
           document_number, issue_key, template_type, form_data, drive_link, created_by,
           base_document_number, revision, vendor_name_snapshot, is_primary
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
         ON CONFLICT (document_number) DO UPDATE SET
           form_data            = EXCLUDED.form_data,
           drive_link           = EXCLUDED.drive_link,
           template_type        = EXCLUDED.template_type,
           base_document_number = EXCLUDED.base_document_number,
           revision             = EXCLUDED.revision,
           vendor_name_snapshot = EXCLUDED.vendor_name_snapshot,
           is_primary           = TRUE,
           superseded_by        = NULL
         RETURNING id`,
        [
          docNumber,
          issueKey,
          templateType,
          JSON.stringify(mergedFormData),
          driveLink,
          requesterEmail || "legal_user",
          baseDocumentNumber,
          revision,
          vendorNameForFile || null,
        ]
      );

      // Phase 22.12: 新リビジョン生成時、同 base の旧 doc を全部 demote。
      //   markPrimaryDocument: 指定 target だけ is_primary=TRUE、それ以外は FALSE + superseded_by=target
      //   isReissue でも !isReissue でも呼ぶ (新規発行の場合は base = doc 自身、影響なし)。
      try {
        await markPrimaryDocument(baseDocumentNumber, docNumber);
      } catch (markErr) {
        console.warn(
          `[primary-mark] failed for ${docNumber} (base=${baseDocumentNumber}):`,
          markErr
        );
      }

      // Phase 17: 稟議リンクを upsert (formData.ringi_numbers が配列なら処理)
      // 既存リンクは削除して入れ直し (送信値を正とする)。
      const documentId = Number(docInsert.rows[0]?.id);

      // Phase 17q: 文書本体 (documents 行 + Drive PDF) が成功した時点で
      // 「文書作成」自体は完了。以降の各種同期処理 (ringi / external_assets /
      // contract_capabilities / order_items / legal_requests /
      // delivery_events / license_contracts / royalty / Slack 通知 等) は
      // best-effort 扱い。どこかで例外が起きてもユーザーには「作成失敗」
      // を返さず、warnings 配列に積んでレスポンスで返す。
      //
      // 旧実装は単一の try/catch で全部を包んでおり、後段の同期で
      // 想定外のエラー (FK 違反、Backlog 認証切れ、Slack トークン期限 等)
      // が起きると HTTP 500 で返してしまい、ユーザーには
      // 「文書作成に失敗しました」と出るのに DB には実体がある、という
      // 紛らわしい状態を引き起こしていた。
      const syncWarnings: Array<{ step: string; error: string }> = [];
      try {
      if (documentId && Array.isArray(formData?.ringi_numbers)) {
        const numbers: string[] = (formData.ringi_numbers as any[])
          .map((s) => String(s || "").trim())
          .filter((n) => /^[0-9]{5}$/.test(n));
        await query(`DELETE FROM ringi_documents WHERE document_id = $1`, [
          documentId,
        ]);
        for (const num of numbers) {
          const r = await query(
            `SELECT id FROM ringi_records WHERE ringi_number = $1`,
            [num]
          );
          if (r.rows.length > 0) {
            await query(
              `INSERT INTO ringi_documents (ringi_id, document_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [Number(r.rows[0].id), documentId]
            );
          } else {
            console.warn(
              `[ringi] document ${docNumber} は稟議 ${num} と紐付け要求されたが ringi_records に未登録のためスキップ`
            );
          }
        }
      }

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
        // Phase 17o: vendor lookup を堅牢化。
        //   優先順:
        //     1. VENDOR_CODE (master と一致 → 最も確実)
        //     2. VENDOR_NAME exact match
        //     3. trade_name / pen_name exact match (旧屋号や PN 入力対応)
        //   どれも当たらなければ vendor_id=null で INSERT (warn ログを残す)。
        let vendorId: number | null = null;
        const vendorCode = String(
          formData.VENDOR_CODE || formData.vendorCode || ""
        ).trim();
        const vendorName = String(
          formData.VENDOR_NAME ||
            formData.PARTY_B_NAME ||
            formData.partyBName ||
            ""
        ).trim();

        if (vendorCode && vendorCode.toUpperCase() !== "UNKNOWN") {
          const vRes = await query(
            "SELECT id FROM vendors WHERE vendor_code = $1 LIMIT 1",
            [vendorCode]
          );
          if (vRes.rows.length > 0) vendorId = Number(vRes.rows[0].id);
        }
        if (!vendorId && vendorName) {
          const vRes = await query(
            "SELECT id FROM vendors WHERE vendor_name = $1 LIMIT 1",
            [vendorName]
          );
          if (vRes.rows.length > 0) vendorId = Number(vRes.rows[0].id);
        }
        if (!vendorId && vendorName) {
          const vRes = await query(
            `SELECT id FROM vendors
              WHERE trade_name = $1 OR pen_name = $1
              LIMIT 1`,
            [vendorName]
          );
          if (vRes.rows.length > 0) vendorId = Number(vRes.rows[0].id);
        }
        if (!vendorId) {
          console.warn(
            `[contract_capabilities] vendor 解決失敗 (code='${vendorCode}', name='${vendorName}'). vendor_id=null で INSERT。`
          );
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
            original_work, product_name, work_name, media, territory, language, document_url, source_system,
            base_document_number, revision, is_primary
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, TRUE)
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
            base_document_number = EXCLUDED.base_document_number,
            revision = EXCLUDED.revision,
            is_primary = TRUE,
            superseded_by = NULL,
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
            // Phase 22.12: リビジョン情報を contract_capabilities にも同期
            baseDocumentNumber,
            revision,
          ]
        );
        console.log(`✅ Sync to contract_capabilities successful for: ${docNumber}`);

        // Phase 22.12: 旧版 demote (markPrimaryDocument は documents 側を既に
        // 更新済みだが、INSERT の ON CONFLICT で UPSERT した今の row が
        // is_primary=TRUE に上書きされている。同 base の他 row の
        // is_primary=FALSE 同期を再度走らせる)。
        try {
          await markPrimaryDocument(baseDocumentNumber, docNumber);
        } catch (rePromoteErr) {
          console.warn(
            `[primary-mark re-sync] failed:`,
            rePromoteErr
          );
        }
      } catch (ccErr) {
        console.warn(
          `⚠️ Failed to sync generated document to contract_capabilities:`,
          ccErr
        );
      }

      // Operational tables: orders / deliveries / license / royalties.
      if (templateType.includes("purchase_order")) {
        // item_no は INTEGER NOT NULL。legal_request_id 紐付けがある
        // ケースで item_no が衝突しないよう、当該 legal_request の
        // 既存 max(item_no)+1 を採番する (LineItem の line_no とは別物)。
        // backlog_issue_key で upsert。
        await query(
          `INSERT INTO order_items
             (backlog_issue_key, item_no, description, amount, vendor_code, spec)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (backlog_issue_key) DO UPDATE SET
             description = COALESCE(NULLIF(EXCLUDED.description, ''), order_items.description),
             amount      = EXCLUDED.amount,
             vendor_code = COALESCE(NULLIF(EXCLUDED.vendor_code, ''), order_items.vendor_code),
             spec        = COALESCE(NULLIF(EXCLUDED.spec, ''), order_items.spec)`,
          [
            issueKey,
            1, // item_no — 単発 PO の前提 (再生成時も同じ item_no を使う)
            formData.description || issue.summary,
            formData.amount || 0,
            formData.vendorCode || "",
            formData.spec || "",
          ]
        );
      } else if (templateType.includes("inspection")) {
        // Phase 9f: 複合 UNIQUE で上書き可能に。delivery_no が指定されて
        // いなければ MAX(delivery_no)+1 で自動採番。
        const orderRes = await query(
          "SELECT id FROM order_items WHERE backlog_issue_key = $1 LIMIT 1",
          [issueKey]
        );
        if (orderRes.rows.length > 0) {
          let dno = Number(formData.deliveryNo) || 0;
          if (!dno) {
            const maxRes = await query(
              `SELECT COALESCE(MAX(delivery_no), 0) AS max_no
                 FROM delivery_events
                WHERE backlog_issue_key = $1`,
              [issueKey]
            );
            dno = Number(maxRes.rows[0]?.max_no) + 1;
          }
          await query(
            `INSERT INTO delivery_events
               (order_item_id, backlog_issue_key, delivered_amount, delivery_no, delivered_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET
               order_item_id    = EXCLUDED.order_item_id,
               delivered_amount = EXCLUDED.delivered_amount,
               delivered_at     = EXCLUDED.delivered_at`,
            [
              orderRes.rows[0].id,
              issueKey,
              formData.deliveredAmount || formData.amount || 0,
              dno,
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
        // Phase 22.21.20: contract_type を必ずセットする。
        //   旧 INSERT は contract_type を入れていなかったため、自動連鎖
        //   (autoChainOnComplete) の `parentRequestType === "purchase_order"`
        //   照合がマッチせず、納品リクエスト子課題が作成されなかった。
        //   - 新規 INSERT: contract_type を 'purchase_order' で挿入
        //   - 既存行: COALESCE で空のときだけ補完 (既存値を上書きしない)
        const poContractType =
          templateType === "planning_purchase_order"
            ? "planning_purchase_order"
            : "purchase_order";
        const lrResult = await query(
          `INSERT INTO legal_requests (backlog_issue_key, contract_type, counterparty, summary)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (backlog_issue_key) DO UPDATE SET
               counterparty  = EXCLUDED.counterparty,
               contract_type = COALESCE(NULLIF(legal_requests.contract_type, ''),
                                        EXCLUDED.contract_type)
             RETURNING id`,
          [
            issueKey,
            poContractType,
            formData.VENDOR_NAME || formData.PARTY_B_NAME,
            issue.summary,
          ]
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
            // Phase 13: calc_method + payment_terms 統一
            const payTerms = l.payment_terms || l.payment_method || null;
            const calcMethod = l.calc_method || "FIXED";
            await query(
              `INSERT INTO order_line_items (
                 order_item_id, line_no, item_name, spec,
                 unit_price, quantity, amount_ex_tax,
                 calc_method, payment_terms,
                 payment_method, payment_date, delivery_date, updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
               ON CONFLICT (order_item_id, line_no) DO UPDATE SET
                 item_name      = EXCLUDED.item_name,
                 spec           = EXCLUDED.spec,
                 unit_price     = EXCLUDED.unit_price,
                 quantity       = EXCLUDED.quantity,
                 amount_ex_tax  = EXCLUDED.amount_ex_tax,
                 calc_method    = EXCLUDED.calc_method,
                 payment_terms  = EXCLUDED.payment_terms,
                 payment_method = EXCLUDED.payment_method,
                 payment_date   = EXCLUDED.payment_date,
                 delivery_date  = EXCLUDED.delivery_date,
                 updated_at     = CURRENT_TIMESTAMP`,
              [
                orderItemId,
                lineNo,
                l.item_name || "",
                l.spec || "",
                unit,
                qty,
                lineAmt,
                calcMethod,
                payTerms,
                payTerms, // legacy mirror
                l.payment_date || null,
                l.delivery_date || null, // Phase 17h
              ]
            );
          }
          await recalculateOrderTotal(orderItemId, taxRate);
        }

        // Phase 17i: 経費 (交通費等・税込み額) を upsert
        if (orderItemId && Array.isArray(formData.expenses)) {
          const incomingExpenses = formData.expenses as Array<any>;
          const computedExpenses = incomingExpenses
            .map((e: any, idx: number) => ({
              line_no: Number(e.line_no) || idx + 1,
              expense_name: e.expense_name || "",
              spec: e.spec || "",
              spent_date: e.spent_date || null,
              amount_inc_tax: Number(e.amount_inc_tax) || 0,
              remarks: e.remarks || "",
            }))
            .filter((e) => e.expense_name);

          const keepExpenseNos = computedExpenses.map((e) => e.line_no).filter((n) => n > 0);
          if (keepExpenseNos.length > 0) {
            await query(
              `DELETE FROM order_expenses
                WHERE order_item_id = $1
                  AND line_no NOT IN (${keepExpenseNos.map((_, i) => `$${i + 2}`).join(",")})`,
              [orderItemId, ...keepExpenseNos]
            );
          } else {
            await query("DELETE FROM order_expenses WHERE order_item_id = $1", [orderItemId]);
          }

          for (const e of computedExpenses) {
            await query(
              `INSERT INTO order_expenses (
                 order_item_id, line_no, expense_name, spec,
                 spent_date, amount_inc_tax, remarks, updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
               ON CONFLICT (order_item_id, line_no) DO UPDATE SET
                 expense_name   = EXCLUDED.expense_name,
                 spec           = EXCLUDED.spec,
                 spent_date     = EXCLUDED.spent_date,
                 amount_inc_tax = EXCLUDED.amount_inc_tax,
                 remarks        = EXCLUDED.remarks,
                 updated_at     = CURRENT_TIMESTAMP`,
              [
                orderItemId,
                e.line_no,
                e.expense_name,
                e.spec,
                e.spent_date,
                e.amount_inc_tax,
                e.remarks,
              ]
            );
          }
        }
      } else if (templateType.includes("inspection")) {
        // Phase 22.21.20: contract_type を 'delivery_inspec' でセット。
        //   ON CONFLICT は DO NOTHING を継続 (検収書側は既存行があれば触らない)。
        await query(
          `INSERT INTO legal_requests (backlog_issue_key, contract_type, counterparty, summary)
             VALUES ($1, 'delivery_inspec', $2, $3)
             ON CONFLICT (backlog_issue_key) DO NOTHING`,
          [issueKey, formData.counterparty || formData.PARTY_B_NAME, issue.summary]
        );
        // 親 PO 検索: formData.parent_po_id (form-context / picker が埋めた値) 優先、
        // 無ければこの issue 自体の order_items を見る (legacy fallback)。
        let orderItemId: number | null = null;
        if (formData.parent_po_id) {
          orderItemId = Number(formData.parent_po_id);
        } else {
          const orderItemResult = await query(
            "SELECT id FROM order_items WHERE backlog_issue_key = $1",
            [issueKey]
          );
          orderItemId = orderItemResult.rows[0]?.id || null;
        }

        // Phase 9f: 分割検収サポート — 1 PO に対する複数回検収を許容。
        // deliveryNo の決定優先順位:
        //   1. formData.deliveryNo (フロントから明示)
        //   2. 親 PO 配下の MAX(delivery_no) + 1 を自動採番
        //   3. なければ 1
        let deliveryNo = Number(formData.deliveryNo) || 0;
        if (!deliveryNo) {
          if (orderItemId) {
            const maxRes = await query(
              `SELECT COALESCE(MAX(delivery_no), 0) AS max_no
                 FROM delivery_events
                WHERE order_item_id = $1`,
              [orderItemId]
            );
            deliveryNo = Number(maxRes.rows[0]?.max_no) + 1;
          } else {
            const maxRes = await query(
              `SELECT COALESCE(MAX(delivery_no), 0) AS max_no
                 FROM delivery_events
                WHERE backlog_issue_key = $1`,
              [issueKey]
            );
            deliveryNo = Number(maxRes.rows[0]?.max_no) + 1;
          }
        }

        // 今回検収額 (税抜) — formData.delivery_line_items[] から再計算が
        // 正しいが、無いケースは deliveredAmountStr 経由でフォールバック。
        let deliveredAmount = 0;
        if (
          Array.isArray(formData.delivery_line_items) &&
          formData.delivery_line_items.length > 0
        ) {
          deliveredAmount = (formData.delivery_line_items as Array<any>)
            .reduce(
              (sum, l) => sum + (Number(l.inspected_amount_ex_tax) || 0),
              0
            );
        } else if (formData.deliveredAmountStr) {
          deliveredAmount = Number(
            String(formData.deliveredAmountStr).replace(/[^0-9.-]+/g, "")
          ) || 0;
        }

        const deliveryUpsert = await query(
          `INSERT INTO delivery_events
             (backlog_issue_key, order_item_id, delivery_no, delivered_at,
              delivered_amount, inspection_deadline, status, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET
             order_item_id       = EXCLUDED.order_item_id,
             delivered_at        = EXCLUDED.delivered_at,
             delivered_amount    = EXCLUDED.delivered_amount,
             inspection_deadline = EXCLUDED.inspection_deadline,
             status              = EXCLUDED.status,
             note                = EXCLUDED.note
           RETURNING id`,
          [
            issueKey,
            orderItemId,
            deliveryNo,
            formData.deliveredAt || new Date(),
            deliveredAmount,
            formData.inspectionDeadline || null,
            "pending",
            formData.REMARKS || "",
          ]
        );
        const deliveryEventId = deliveryUpsert.rows[0]?.id;
        console.log(
          `📦 delivery_events upsert: issueKey=${issueKey} delivery_no=${deliveryNo} amount=${deliveredAmount} id=${deliveryEventId}`
        );

        // Phase 7c: 検収明細を永続化する。
        // フロントが formData.delivery_line_items[] を載せていれば
        // overflow チェック付きで upsert する。
        if (
          deliveryEventId &&
          Array.isArray(formData.delivery_line_items) &&
          formData.delivery_line_items.length > 0
        ) {
          const incoming = (formData.delivery_line_items as Array<any>).map(
            (l) => ({
              order_line_item_id: Number(l.order_line_item_id),
              inspected_quantity: Number(l.inspected_quantity) || 0,
              acceptance_ratio:
                l.acceptance_ratio == null ? 1.0 : Number(l.acceptance_ratio),
              rejection_reason: l.rejection_reason || null,
            })
          );
          // サーバ側 overflow チェック (二重防衛)。フロントの数字を信用しない。
          const preview = await previewInspectionOverflow(
            incoming.map((l) => ({
              order_line_item_id: l.order_line_item_id,
              inspected_quantity: l.inspected_quantity,
              acceptance_ratio: l.acceptance_ratio,
            }))
          );
          const blocking = preview.filter(
            (p) => p.will_overflow_amount || p.will_overflow_quantity
          );
          if (blocking.length > 0) {
            throw new Error(
              "Inspection overflow detected on save: " +
                JSON.stringify(blocking.map((b) => b.order_line_item_id))
            );
          }

          for (const l of incoming) {
            const unitRes = await query(
              "SELECT unit_price FROM order_line_items WHERE id = $1",
              [l.order_line_item_id]
            );
            const unitPrice = Number(unitRes.rows[0]?.unit_price) || 0;
            const amt = calculateInspectedAmount(
              unitPrice,
              l.inspected_quantity,
              l.acceptance_ratio
            );
            await query(
              `INSERT INTO delivery_line_items (
                 delivery_event_id, order_line_item_id, inspected_quantity,
                 acceptance_ratio, inspected_amount_ex_tax, rejection_reason
               ) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (delivery_event_id, order_line_item_id) DO UPDATE SET
                 inspected_quantity      = EXCLUDED.inspected_quantity,
                 acceptance_ratio        = EXCLUDED.acceptance_ratio,
                 inspected_amount_ex_tax = EXCLUDED.inspected_amount_ex_tax,
                 rejection_reason        = EXCLUDED.rejection_reason`,
              [
                deliveryEventId,
                l.order_line_item_id,
                l.inspected_quantity,
                l.acceptance_ratio,
                amt,
                l.rejection_reason,
              ]
            );
          }
        }
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
      } else if (templateType === "individual_license_terms") {
        // Phase 7d: license_contracts ヘッダを upsert
        // (License Master が先に走っていなくても個別条件書から開始可)。
        // ledger_id は NOT NULL UNIQUE。
        // Phase 22.17: 台帳ID は自動採番に変更。
        //   優先順:
        //     1. formData.ledgerId が明示渡し → 尊重 (legacy 台帳 ID 持ち込み等)
        //     2. 同 backlog_issue_key の license_contracts 行が既存 → 既存 ledger_id を維持
        //     3. それ以外 → getNewLedgerId() で "LIC-YYYY-NNNN" を採番
        // Phase 22.21.12: 旧 "lic_individual" は templateType 実値と不一致で
        //   この分岐が一度もマッチしていなかった。"individual_license_terms"
        //   に修正。なお pre-render の auto-numbering で同じ値が formData に
        //   入っているため、ここでは再計算しても結果は同じ。
        let resolvedLedgerId = formData.ledgerId
          ? String(formData.ledgerId).trim()
          : "";
        if (!resolvedLedgerId) {
          const existing = await query(
            "SELECT ledger_id FROM license_contracts WHERE backlog_issue_key = $1 LIMIT 1",
            [issueKey]
          );
          if (existing.rows[0]?.ledger_id) {
            resolvedLedgerId = existing.rows[0].ledger_id;
          } else {
            resolvedLedgerId = await getNewLedgerId();
            console.log(
              `📒 [ledger-id] auto-assigned ${resolvedLedgerId} for ${issueKey}`
            );
          }
        }
        // formData にも書き戻し、PDF テンプレートが {{台帳ID}} / {{ledgerId}} を
        // 参照できるようにする。
        formData.ledgerId = resolvedLedgerId;
        formData["台帳ID"] = resolvedLedgerId;

        // Phase 22.19: 原作 / 素材 マスター連動。
        //   - formData.ledger_ref_id / material_ref_id が UI から渡されたら採用
        //   - 既存 license_contracts 行に ledger_ref_id があれば再発行時は維持
        //   - work_id は ledger_code 配下で独立採番 (再発行は既存維持)
        //   - 素材番号 / 素材名 / 原著作物名 を materials 行から PDF テンプレに供給
        let resolvedLedgerRefId: number | null = formData.ledger_ref_id
          ? Number(formData.ledger_ref_id)
          : null;
        let resolvedMaterialRefId: number | null = formData.material_ref_id
          ? Number(formData.material_ref_id)
          : null;
        let resolvedWorkId: string = formData.work_id
          ? String(formData.work_id).trim()
          : "";

        // 既存 license_contracts に紐付き情報があれば取り込む (再発行ケース)
        const existingLcRow = await query(
          `SELECT ledger_ref_id, material_ref_id, work_id
             FROM license_contracts WHERE backlog_issue_key = $1 LIMIT 1`,
          [issueKey]
        );
        const existingLc = existingLcRow.rows[0];
        if (existingLc) {
          // 渡されてなければ既存値を使う
          if (!resolvedLedgerRefId && existingLc.ledger_ref_id) {
            resolvedLedgerRefId = Number(existingLc.ledger_ref_id);
          }
          if (!resolvedMaterialRefId && existingLc.material_ref_id) {
            resolvedMaterialRefId = Number(existingLc.material_ref_id);
          }
          if (!resolvedWorkId && existingLc.work_id) {
            resolvedWorkId = existingLc.work_id;
          }
        }

        // 原作 / 素材 マスター情報を引いて PDF テンプレフィールドに反映
        let ledgerCodeForWork = "";
        if (resolvedLedgerRefId) {
          const lr = await query(
            "SELECT ledger_code, title FROM ledgers WHERE id = $1",
            [resolvedLedgerRefId]
          );
          if (lr.rows[0]) {
            ledgerCodeForWork = lr.rows[0].ledger_code;
            // 原著作物名 を ledger.title で同期 (ユーザー入力なしの場合)
            if (!formData.原著作物名 || !String(formData.原著作物名).trim()) {
              formData.原著作物名 = lr.rows[0].title;
            }
          }
        }
        if (resolvedMaterialRefId) {
          const mr = await query(
            `SELECT material_code, material_name, rights_holder, is_default
               FROM materials WHERE id = $1`,
            [resolvedMaterialRefId]
          );
          if (mr.rows[0]) {
            const m = mr.rows[0];
            // 素材番号 PDF フィールド
            if (!formData.素材番号 || !String(formData.素材番号).trim()) {
              formData.素材番号 = m.material_code;
            }
            // 素材名 / 素材権利者 (空のときだけ)
            if (!formData.素材名 || !String(formData.素材名).trim()) {
              formData.素材名 = m.material_name;
            }
            if (!formData.素材権利者 || !String(formData.素材権利者).trim()) {
              formData.素材権利者 = m.rights_holder || "";
            }
          }
        }

        // work_id 採番 (新規 + ledger_ref_id ありの場合のみ)
        if (!resolvedWorkId && ledgerCodeForWork) {
          resolvedWorkId = await getNewWorkId(ledgerCodeForWork);
          console.log(
            `🎫 [work-id] auto-assigned ${resolvedWorkId} for ${issueKey} (ledger=${ledgerCodeForWork})`
          );
        }

        // formData に書き戻し → PDF テンプレが {{work_id}} で参照可能
        if (resolvedWorkId) {
          formData.work_id = resolvedWorkId;
          formData.WORK_ID = resolvedWorkId;
        }

        const lcUpsert = await query(
          `INSERT INTO license_contracts (
             backlog_issue_key, ledger_id, ledger_number, contract_number,
             licensor, original_work,
             licensor_name, licensor_address, licensor_rep, licensor_is_corporation,
             licensee_name, licensee_address, licensee_rep, licensee_is_corporation,
             product_name_predicted,
             license_start_date, license_period_note,
             supervisor, credit_display, remarks,
             ledger_ref_id, material_ref_id, work_id
           )
           VALUES (
             $1, $2, $3, $4,
             $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14,
             $15,
             $16, $17,
             $18, $19, $20,
             $21, $22, $23
           )
           ON CONFLICT (backlog_issue_key) DO UPDATE SET
             contract_number          = EXCLUDED.contract_number,
             ledger_number            = COALESCE(NULLIF(EXCLUDED.ledger_number, ''), license_contracts.ledger_number),
             licensor                 = COALESCE(NULLIF(EXCLUDED.licensor, ''), license_contracts.licensor),
             original_work            = COALESCE(NULLIF(EXCLUDED.original_work, ''), license_contracts.original_work),
             licensor_name            = COALESCE(NULLIF(EXCLUDED.licensor_name, ''), license_contracts.licensor_name),
             licensor_address         = COALESCE(NULLIF(EXCLUDED.licensor_address, ''), license_contracts.licensor_address),
             licensor_rep             = COALESCE(NULLIF(EXCLUDED.licensor_rep, ''), license_contracts.licensor_rep),
             licensor_is_corporation  = EXCLUDED.licensor_is_corporation,
             licensee_name            = COALESCE(NULLIF(EXCLUDED.licensee_name, ''), license_contracts.licensee_name),
             licensee_address         = COALESCE(NULLIF(EXCLUDED.licensee_address, ''), license_contracts.licensee_address),
             licensee_rep             = COALESCE(NULLIF(EXCLUDED.licensee_rep, ''), license_contracts.licensee_rep),
             licensee_is_corporation  = EXCLUDED.licensee_is_corporation,
             product_name_predicted   = COALESCE(NULLIF(EXCLUDED.product_name_predicted, ''), license_contracts.product_name_predicted),
             license_start_date       = COALESCE(EXCLUDED.license_start_date, license_contracts.license_start_date),
             license_period_note      = COALESCE(NULLIF(EXCLUDED.license_period_note, ''), license_contracts.license_period_note),
             supervisor               = COALESCE(NULLIF(EXCLUDED.supervisor, ''), license_contracts.supervisor),
             credit_display           = COALESCE(NULLIF(EXCLUDED.credit_display, ''), license_contracts.credit_display),
             remarks                  = COALESCE(NULLIF(EXCLUDED.remarks, ''), license_contracts.remarks),
             ledger_ref_id            = COALESCE(EXCLUDED.ledger_ref_id, license_contracts.ledger_ref_id),
             material_ref_id          = COALESCE(EXCLUDED.material_ref_id, license_contracts.material_ref_id),
             work_id                  = COALESCE(NULLIF(EXCLUDED.work_id, ''), license_contracts.work_id)
           RETURNING id`,
          [
            issueKey,
            resolvedLedgerId,               // ledger_id (UNIQUE NOT NULL) — Phase 22.17 自動採番
            docNumber,                      // ledger_number
            docNumber,                      // contract_number
            formData.Licensor_名称 || formData.Licensor_氏名会社名 || "", // legacy licensor
            formData.原著作物名 || "",                                    // legacy original_work
            formData.Licensor_名称 || formData.Licensor_氏名会社名 || "",
            formData.Licensor_住所 || "",
            formData.Licensor_代表者名 || "",
            !!formData.LICENSOR_IS_CORPORATION,
            formData.Licensee_名称 || formData.Licensee_氏名会社名 || "",
            formData.Licensee_住所 || "",
            formData.Licensee_代表者名 || "",
            !!formData.LICENSEE_IS_CORPORATION,
            formData.対象製品予定名 || "",
            formData.許諾開始日 || null,
            formData.許諾期間注記 || "",
            formData.監修者 || "",
            formData.クレジット表示 || "",
            formData.特記事項 || formData.remarks || "",
            // Phase 22.19: ledger / material / work_id
            resolvedLedgerRefId,
            resolvedMaterialRefId,
            resolvedWorkId || null,
          ]
        );
        const lcId = Number(lcUpsert.rows[0]?.id);

        // Phase 7d: financial_conditions[] を license_financial_conditions
        // に upsert (condition_no をキーに一意)。FinancialConditionTable
        // で削除された condition は DB からも削除する。
        if (lcId && Array.isArray(formData.financial_conditions)) {
          const keepNos = new Set<number>();
          for (const c of formData.financial_conditions) {
            const condNo = Number(c?.condition_no);
            if (!Number.isFinite(condNo) || condNo < 1) continue;
            keepNos.add(condNo);
            await query(
              `INSERT INTO license_financial_conditions (
                 license_contract_id, condition_no, region_language_label,
                 calc_method, rate_pct, base_price_label, calc_period,
                 currency, formula_text, payment_terms, mg_amount,
                 calc_period_kind, calc_period_close_month
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
               ON CONFLICT (license_contract_id, condition_no) DO UPDATE SET
                 region_language_label   = EXCLUDED.region_language_label,
                 calc_method             = EXCLUDED.calc_method,
                 rate_pct                = EXCLUDED.rate_pct,
                 base_price_label        = EXCLUDED.base_price_label,
                 calc_period             = EXCLUDED.calc_period,
                 currency                = EXCLUDED.currency,
                 formula_text            = EXCLUDED.formula_text,
                 payment_terms           = EXCLUDED.payment_terms,
                 mg_amount               = EXCLUDED.mg_amount,
                 calc_period_kind        = EXCLUDED.calc_period_kind,
                 calc_period_close_month = EXCLUDED.calc_period_close_month,
                 updated_at              = CURRENT_TIMESTAMP`,
              [
                lcId,
                condNo,
                c.region_language_label || "",
                c.calc_method || "",
                c.rate_pct !== undefined && c.rate_pct !== null
                  ? Number(c.rate_pct)
                  : null,
                c.base_price_label || "",
                c.calc_period || "",
                c.currency || "JPY",
                c.formula_text || "",
                c.payment_terms || "",
                c.mg_amount !== undefined && c.mg_amount !== null
                  ? Number(c.mg_amount)
                  : 0,
                // Phase 22.20-B
                c.calc_period_kind || null,
                c.calc_period_close_month !== undefined &&
                c.calc_period_close_month !== null
                  ? Number(c.calc_period_close_month)
                  : null,
              ]
            );
          }
          // 表で削除された condition_no を DB からも削除。
          // ただし royalty_calculations が参照していたら FK で守られるので
          // ON DELETE は RESTRICT を期待。失敗時は黙って残す。
          if (keepNos.size > 0) {
            try {
              await query(
                `DELETE FROM license_financial_conditions
                  WHERE license_contract_id = $1
                    AND condition_no <> ALL($2::int[])`,
                [lcId, Array.from(keepNos)]
              );
            } catch (delErr) {
              console.warn(
                "Could not prune deleted financial conditions (likely FK from royalty_calculations):",
                delErr
              );
            }
          }
        }

        // Phase 22.20-D: work_sublicensees (Work × サブライセンシー) を永続化
        //   formData.サブライセンシー一覧 [] が UI から渡された場合のみ反映。
        //   undefined のときは触らない (フォームが他テンプレなら関係ない)。
        //   replacement semantics: 既存を削除 → 新リストを順番に INSERT。
        // Phase 22.21.14: 診断ログを充実 + 空判定をより寛容に。
        //   旧 hasContent は 名称 / sublicensee_id / 金銭条件 / 料率 / MGAG
        //   のいずれかが必要だったが、地域・言語・備考・契約締結日・区分
        //   のみ入っているケースも保持する。
        console.log(
          `🤝 [work-sublicensees] check for lcId=${lcId}: ` +
            `array=${Array.isArray(formData.サブライセンシー一覧)} ` +
            `length=${
              Array.isArray(formData.サブライセンシー一覧)
                ? formData.サブライセンシー一覧.length
                : "n/a"
            }`
        );
        if (
          lcId &&
          Array.isArray(formData.サブライセンシー一覧)
        ) {
          try {
            // Phase 22.21.18: DELETE のスコープを license_contract_id だけでなく
            //   work_id も対象にする。理由:
            //     (a) 通常: license_contract_id ベースで全行を一掃 (旧挙動)
            //     (b) 別 license_contracts 行に紐付いていた同 work_id の行も
            //         まとめて削除。これにより「前回内容を引き継ぐ → 新規
            //         license_contracts 行が出来てサブライセンシーが重複する」
            //         状況を防ぐ。
            //   resolvedWorkId が空文字なら (b) は skip (work_id IS NULL の
            //   全行を消すような事故を防ぐ ANDで防御)。
            await query(
              `DELETE FROM work_sublicensees
                WHERE license_contract_id = $1
                   OR (work_id IS NOT NULL AND work_id <> ''
                       AND work_id = $2)`,
              [lcId, resolvedWorkId || ""]
            );
            let order = 0;
            let skipped = 0;
            for (const sl of formData.サブライセンシー一覧) {
              if (!sl) {
                skipped++;
                continue;
              }
              // Phase 22.21.14: 完全空行判定をより寛容に。
              //   sublicensee_id / 名称 / 区分 / 地域 / 言語 / 金銭条件 /
              //   MGAG / 料率 / 契約締結日 / 備考 のいずれかがあれば保持。
              const nonEmpty = (v: any) =>
                v !== undefined && v !== null && String(v).trim() !== "";
              const hasContent =
                nonEmpty(sl.sublicensee_id) ||
                nonEmpty(sl.名称) ||
                nonEmpty(sl.区分) ||
                nonEmpty(sl.地域) ||
                nonEmpty(sl.言語) ||
                nonEmpty(sl.金銭条件) ||
                nonEmpty(sl.MGAG) ||
                nonEmpty(sl.料率) ||
                nonEmpty(sl.契約締結日) ||
                nonEmpty(sl.備考);
              if (!hasContent) {
                skipped++;
                continue;
              }

              // Phase 22.21.13: contract_date を YYYY-MM-DD 形式で取り込み。
              //   フォームの date input は ISO 文字列。空文字は null に。
              const contractDate =
                sl.契約締結日 && String(sl.契約締結日).trim()
                  ? String(sl.契約締結日).trim()
                  : null;
              try {
                // Phase 22.21.18: work_id を 13 番目の列として永続化。
                //   pre-render で resolvedWorkId が決まっていればその値、
                //   未確定なら NULL (= ledger 紐付け無しの個別利用許諾)。
                await query(
                  `INSERT INTO work_sublicensees (
                     license_contract_id, sublicensee_id, inline_name,
                     category, region, language,
                     payment_terms_label, mg_ag_label, rate_label, remarks,
                     contract_date, sort_order, work_id
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                  [
                    lcId,
                    sl.sublicensee_id ? Number(sl.sublicensee_id) : null,
                    sl.名称 || null,
                    sl.区分 || null,
                    sl.地域 || null,
                    sl.言語 || null,
                    sl.金銭条件 || null,
                    sl.MGAG || null,
                    sl.料率 || null,
                    sl.備考 || null,
                    contractDate,
                    order++,
                    resolvedWorkId || null,
                  ]
                );
              } catch (insertErr: any) {
                // work_id / contract_date カラムが無い環境では旧 INSERT に fallback。
                //   42703 = undefined_column。
                if (insertErr && insertErr.code === "42703") {
                  // 第 1 段階 fallback: contract_date あり、work_id なし (12 列)
                  try {
                    await query(
                      `INSERT INTO work_sublicensees (
                         license_contract_id, sublicensee_id, inline_name,
                         category, region, language,
                         payment_terms_label, mg_ag_label, rate_label, remarks,
                         contract_date, sort_order
                       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                      [
                        lcId,
                        sl.sublicensee_id ? Number(sl.sublicensee_id) : null,
                        sl.名称 || null,
                        sl.区分 || null,
                        sl.地域 || null,
                        sl.言語 || null,
                        sl.金銭条件 || null,
                        sl.MGAG || null,
                        sl.料率 || null,
                        sl.備考 || null,
                        contractDate,
                        order - 1, // order was already incremented in outer
                      ]
                    );
                  } catch (innerErr: any) {
                    if (innerErr && innerErr.code === "42703") {
                      // 第 2 段階 fallback: contract_date も無い超 legacy (11 列)
                      await query(
                        `INSERT INTO work_sublicensees (
                           license_contract_id, sublicensee_id, inline_name,
                           category, region, language,
                           payment_terms_label, mg_ag_label, rate_label, remarks,
                           sort_order
                         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                        [
                          lcId,
                          sl.sublicensee_id ? Number(sl.sublicensee_id) : null,
                          sl.名称 || null,
                          sl.区分 || null,
                          sl.地域 || null,
                          sl.言語 || null,
                          sl.金銭条件 || null,
                          sl.MGAG || null,
                          sl.料率 || null,
                          sl.備考 || null,
                          order - 1,
                        ]
                      );
                    } else {
                      throw innerErr;
                    }
                  }
                } else {
                  throw insertErr;
                }
              }
            }
            console.log(
              `🤝 [work-sublicensees] saved ${order} rows (skipped ${skipped} empty) for work ${
                resolvedWorkId || lcId
              }`
            );
          } catch (wsErr) {
            console.warn(
              `[work-sublicensees] persist failed for license_contract_id=${lcId}:`,
              wsErr
            );
          }
        }
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

      } catch (syncErr: any) {
        // Phase 17q: 同期処理での例外を捕捉して warnings に積む。
        //   文書本体 (documents + Drive) は既に作成済みなので、
        //   フロントには成功扱いで返す。
        console.warn(
          "[/api/documents/generate] post-document sync failed (non-fatal):",
          syncErr
        );
        syncWarnings.push({
          step: "post_document_sync",
          error: String(syncErr?.message || syncErr),
        });
      }

      // Phase 9g: documentNumber も返してフロントのサクセス画面で
      // 表示する。
      // Phase 17q: 同期警告があれば warnings として一緒に返す。
      //   フロントは success:true + driveLink を信用してモーダルを出し、
      //   warnings があれば追加で開発者向けの情報を console に出す。
      res.json({
        success: true,
        driveLink,
        documentNumber: docNumber,
        templateType,
        warnings: syncWarnings,
      });
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
