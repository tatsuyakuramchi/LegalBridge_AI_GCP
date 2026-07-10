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
import { DocumentService, buildDocumentFileName } from "./src/services/documentService.ts";
import type { DocumentType } from "./src/services/documentService.ts";
import { GoogleDriveService } from "./src/services/googleDriveService.ts";
import { CloudSignService } from "./src/services/cloudSignService.ts";
import { renderHtmlToPdf } from "./src/services/pdfRenderer.ts";
import { EmailService } from "./src/services/emailService.ts";
import { ExcelService } from "./src/services/excelService.ts";
import { CsvImportService } from "./src/services/csvImportService.ts";
import {
  initDb,
  query,
  pool,
  getNewDocumentNumber,
  getDocumentNumberForGenerate,
  computeFormContentHash,
  getNewLedgerId,
  getNewLedgerCode,
  getNewWorkId,
  getNewIltNumberForLedger,
  sanitizeForFilename,
  createLedgerWithDefaultMaterial,
  addMaterialToLedger,
  ensureMaterialCategory,
  markPrimaryDocument,
} from "./src/lib/db.ts";
import { normalizeGenre, normalizeRole } from "./src/lib/materialVocab.ts";
// データ構造刷新 Phase C-5: 新スキーマへの二重書き込み (冪等・非致命)
import {
  syncConditionLinesForCapability,
  syncInspectionEventsForDelivery,
  syncRoyaltyCalcEvent,
  pruneOrphanConditionLines,
  safeSync,
} from "./src/lib/conditionSync.ts";
// Stage C-3: 加算型のLC別セル分解で condition_lines を追加生成する際、
//   既存の列マッピング(C-5 二重書き込みと同一ルール)を流用する。
import {
  mapFinancialConditionToConditionLine,
  conditionLineInsertValues,
  CONDITION_LINE_COLUMNS,
} from "./src/lib/conditionLineMapper.ts";
// 雛形プレビュー用 v3 サンプルデータ（個別利用許諾 v3 テンプレの sample-preview に使う）。
import { v3SampleFormData } from "./src/lib/individualLicenseV3Context.ts";
// スキーマ単純化 Phase 2: Master(契約マスタ)保存を documents 統合＋CL直接書き込みで行う。
import { upsertMasterContract, mapV3MatrixToConditions } from "./src/lib/documentSave.ts";
// 再発行時に旧版明細の実績を新版明細へ引き継ぐ(一意対応できる場合のみ)。
import { carryOverReissueConsumption } from "./src/lib/reissueCarryover.ts";
import { registerImportsV2 } from "./src/routes/importsV2.ts";
import { registerGenericImport } from "./src/routes/genericImport.ts";
import { registerDataLinkage } from "./src/routes/dataLinkage.ts";
import { registerRelatedParty } from "./src/routes/relatedParty.ts";
import { registerUnifiedIssues } from "./src/routes/unifiedIssues.ts";
import { registerMatters } from "./src/routes/matters.ts";
import { normalizeDocumentFormData } from "./src/lib/capabilityFormMapping.ts";
// C2: admin-ui を worker 専用化(C1)するため、search-api の read を worker に補完。
import { registerSharedReads } from "./src/routes/sharedReads.ts";
// C2 batch 3b: form-context / history(byte-exact 抽出。生成元 scripts/extract-form-routes.mjs)。
import { registerFormReadRoutes } from "./src/routes/formReadRoutes.ts";
import {
  calculateTax,
  calculateOrderLineAmount,
  calculateInspectedAmount,
  // Phase 23: 旧名 (recalculateOrderTotal / getInspectionAvailability) は
  //   deprecated alias として calc.ts に残っているが、本ファイルでは
  //   新名 (recalculateCapabilityTotal / getCapabilityLineAvailability) を使う。
  recalculateCapabilityTotal,
  getCapabilityLineAvailability,
  previewInspectionOverflow,
  getOrderedLineEconomics, // Phase E-2: 発注側 economics の dual-read
} from "./src/lib/calc.ts";
import {
  previewRoyaltyCalculation,
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
  // Phase 28.1: 複数契約(=複数取引先)に跨る検収依頼は自動 PDF 生成を
  // スキップし、admin-ui 検収待ちページの一括作成 (/api/imports/bulk/inspection)
  // で法務が取引先ごとに発行する。
  skip_pdf?: boolean;
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

/**
 * サブスク明細(calc_method=SUBSCRIPTION かつ payment_schedule あり)を
 * 「支払予定日ごとの 1 行」に展開する。条件明細(capability_line_items)へ
 * ミラーするとき、各回の支払予定日が個別の行として並ぶようにする。
 *   - 各行: payment_date=予定日, unit_price/amount_ex_tax=その回の金額, quantity=1
 *   - cycle / term_start / term_end / billing_day は文脈として元の値を保持
 *   - line_no は全体で連番に振り直す(キー衝突と keep/delete の整合のため)
 * 非サブスクや schedule 無しの行はそのまま(連番のみ振り直し)。
 */
function expandLinesWithSchedule(rawLines: any[]): any[] {
  if (!Array.isArray(rawLines)) return [];
  const out: any[] = [];
  let seq = 0;
  for (const l of rawLines) {
    const sched = Array.isArray(l?.payment_schedule)
      ? l.payment_schedule.filter((s: any) => s && s.date)
      : [];
    if (l?.calc_method === "SUBSCRIPTION" && sched.length > 0) {
      const total = sched.length;
      sched.forEach((s: any, k: number) => {
        seq++;
        const amt =
          s.amount != null && s.amount !== "" ? Number(s.amount) : Number(l.unit_price) || 0;
        out.push({
          ...l,
          line_no: seq,
          item_name: `${l.item_name || ""} (${k + 1}/${total})`,
          unit_price: amt,
          quantity: 1,
          amount_ex_tax: amt,
          payment_date: s.date || null,
          payment_schedule: undefined,
        });
      });
    } else {
      seq++;
      out.push({ ...l, line_no: seq, payment_schedule: undefined });
    }
  }
  return out;
}

async function startServer() {
  // 検収書の「明細No.」を列挙表示するための値を formData から算出。
  //   分納(deliveryNo>1)・delivery_line_items 無し は null(従来表示)。
  //   それ以外は { itemNoList: "1, 2", itemNoCovered: N, itemCount: M } を返し、
  //   テンプレで『明細No.: 1, 2 （N/M件）』と表示する。
  //   ※ 関数式(startServer 内ローカル)にして preview/generate 両経路から使う。
  const computeInspectionItemNo = (
    formData: any
  ): { itemNoList?: string; itemNoCovered?: number; itemCount?: number } | null => {
    const isSplit = Number(formData?.deliveryNo || formData?.DELIVERY_NUMBER || 0) > 1;
    if (isSplit) return null;
    const dlines = Array.isArray(formData?.delivery_line_items)
      ? formData.delivery_line_items
      : [];
    if (dlines.length >= 1) {
      // 明細別検収: 実際の親PO行番号(無ければ通し番号)を列挙。
      const total = Number(formData?.itemCount) || dlines.length;
      const lineNos = dlines.map((l: any, i: number) =>
        l?.line_no != null ? l.line_no : l?.lineNo != null ? l.lineNo : i + 1
      );
      return { itemNoList: lineNos.join(", "), itemNoCovered: dlines.length, itemCount: total };
    }
    // 明細別入力が無い(whole-PO)検収: PO 全行をカバーとみなし 1..itemCount を列挙。
    const total = Number(formData?.itemCount) || 0;
    if (total > 1) {
      const lineNos = Array.from({ length: total }, (_, i) => i + 1);
      return { itemNoList: lineNos.join(", "), itemNoCovered: total, itemCount: total };
    }
    return null; // 単一明細 → 従来表示
  };

  // schema は migrations/ ランナーが単一所有する(統合: worker デプロイ・パイプラインの
  //   migrate ステップ = cloudbuild-worker.yaml ① で適用)。worker は既定では起動時に
  //   DDL を触らない。boot-time DDL は複数インスタンス同時起動での競合・アプリロールへの
  //   DDL 権限付与を招くため避ける。
  //   RUN_INIT_DB="true" の時だけ後方互換で起動時 initDb を実行(ローカル/緊急用)。
  if (process.env.RUN_INIT_DB === "true") {
    try {
      await initDb();
      console.log("✅ Database initialized via initDb (RUN_INIT_DB=true; legacy boot-time DDL)");
    } catch (dbErr) {
      console.error("❌ Database initialization failed:", dbErr);
    }
  } else {
    console.log("⏭️  initDb skipped — schema owned by migrations/ runner (applied in worker deploy pipeline)");
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

  /**
   * Phase 22.21.71: worker への直接アクセスを防ぐ shared-secret middleware。
   *
   * 想定経路:
   *   - 通常: admin-ui の apiRouter.ts が全 API 呼び出しに
   *     X-LB-PORTAL-SECRET ヘッダを付与 → ここで突合チェック
   *   - 想定外: Cloud Run の *.run.app 直 URL でこのエンドポイントを叩く
   *     (IAP 未通過 / 漏洩 URL) → 401 で reject
   *
   * env LB_PORTAL_SECRET が未設定の環境 (= local dev / 旧運用) では
   * warning ログを出して通過させる (= 旧挙動互換)。
   *
   * 全エンドポイントに app.use で適用すると Slack webhook 等の
   * 既存 GAS 経由フローが壊れるため、必要なエンドポイントに対して
   * 明示的に middleware として刺す方式を採用。
   */
  function requirePortalSecret(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const expected = process.env.LB_PORTAL_SECRET;
    if (!expected) {
      // 未設定環境は通す (テスト / ローカル / 旧運用互換)。
      // 重要: 本番 Cloud Run では必ず LB_PORTAL_SECRET を設定すること。
      console.warn(
        "⚠️ LB_PORTAL_SECRET is not set on worker. Direct access is not protected."
      );
      return next();
    }
    // 大文字小文字どちらでも受ける (Express は header 名 lowercase に正規化)
    const actual =
      req.headers["x-lb-portal-secret"] ||
      req.headers["X-LB-PORTAL-SECRET" as any];
    if (actual !== expected) {
      console.warn(
        `[requirePortalSecret] 401 reject: ${req.method} ${req.url} (header missing or invalid)`
      );
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    return next();
  }

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
  // Phase 2 / C3: TEMPLATE_SOURCE=db のとき、起動時に DB からテンプレを一括ロード
  //   (disk モードでは no-op)。失敗しても disk フォールバックで動作継続。
  await documentService.loadFromDb();
  const googleDriveService = new GoogleDriveService();
  const excelService = new ExcelService();
  const csvImportService = new CsvImportService();

  // ── クラウドサイン(電子契約)連携 ───────────────────────────────
  //   送信は必ずここ(worker)経由。client_id は app_settings or env。
  //   CLOUDSIGN_ENABLED が true のときだけ送信を許可(既定は無効=誤起動防止)。
  //   CLOUDSIGN_ALLOWED_RECIPIENTS(カンマ区切り)を設定すると、その宛先のみ送信可
  //   = 「社内宛だけで締結まで」テストのガード。
  const loadCloudSignCfg = async () => {
    const keys = ["CLOUDSIGN_CLIENT_ID", "CLOUDSIGN_ENABLED", "CLOUDSIGN_ALLOWED_RECIPIENTS", "CLOUDSIGN_BASE_URL", "CLOUDSIGN_APP_URL"];
    const m: Record<string, any> = {};
    try {
      const r = await query(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [keys]);
      for (const row of r.rows) {
        try { m[row.key] = JSON.parse(row.value); } catch { m[row.key] = row.value; }
      }
    } catch {
      /* app_settings 未整備でも env で動作継続 */
    }
    const get = (k: string) => (m[k] ?? process.env[k] ?? "");
    return {
      clientId: String(get("CLOUDSIGN_CLIENT_ID") || ""),
      baseUrl: String(get("CLOUDSIGN_BASE_URL") || "") || undefined,
      appUrl: String(get("CLOUDSIGN_APP_URL") || "") || undefined,
      enabled: String(get("CLOUDSIGN_ENABLED") || "").toLowerCase() === "true",
      allow: String(get("CLOUDSIGN_ALLOWED_RECIPIENTS") || "")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    };
  };

  // クラウドサインの「書類を開く」Web画面のベースURLを決定する。
  //   本番:  api.cloudsign.jp        → app.cloudsign.jp
  //   検証:  api-sandbox.cloudsign.jp → sandbox.cloudsign.jp  (app-sandbox は存在しない)
  //   CLOUDSIGN_APP_URL を設定すると明示上書き(導出より優先)。
  const cloudSignAppBase = (cfg: { baseUrl?: string; appUrl?: string }) => {
    if (cfg.appUrl) return cfg.appUrl.replace(/\/+$/, "");
    const b = (cfg.baseUrl || "https://api.cloudsign.jp").replace(/\/+$/, "");
    if (/\/\/api-sandbox\./.test(b)) return b.replace(/\/\/api-sandbox\./, "//sandbox.");
    return b.replace(/\/\/api\./, "//app.");
  };

  // ── メール送信(Gmail API)連携 ───────────────────────────────
  //   検収書 / 利用許諾料計算書 を取引先へメール送信する。送信は worker 経由。
  //   設定は app_settings or env。EMAIL_ENABLED=true のときだけ送信可(誤起動防止)。
  //   EMAIL_ALLOWED_RECIPIENTS(カンマ区切り)で宛先を社内に限定するテストガード。
  //   本文/件名テンプレは設定画面で編集可(email_subject_* / email_body_*)。
  // 署名は会社名義(送信元が固定の会社アドレスのため、個人名でなく法務部として送る)。
  const EMAIL_SIGNATURE =
    "──────────────────────\n" +
    "株式会社アークライト\n" +
    "東京都千代田区神田小川町1-2　風雲堂ビル２階\n" +
    "経営管理本部　法務部　倉持\n" +
    "──────────────────────";
  const DEFAULT_EMAIL_TPL = {
    inspection: {
      subject: "【株式会社アークライト】検収書のご送付（{{documentNumber}}）",
      body:
        "{{vendorName}} 御中\n\nいつもお世話になっております。\n株式会社アークライトでございます。\n\nこのたび納品いただきました内容につきまして検収が完了いたしましたので、\n検収書を添付のとおりお送りいたします。\n\n■ 文書番号：{{documentNumber}}\n■ 検収金額：{{amount}}\n■ 発行日　：{{date}}\n\n内容をご確認のうえ、相違等がございましたら、お手数ですが\n本メールへのご返信にてご連絡ください。\nお支払いは、契約に定める支払条件に基づきお手続きいたします。\n\n今後ともどうぞよろしくお願い申し上げます。\n\n" +
        EMAIL_SIGNATURE,
    },
    royalty: {
      subject: "【株式会社アークライト】利用許諾料計算書のご送付（{{documentNumber}}）",
      body:
        "{{vendorName}} 御中\n\nいつもお世話になっております。\n株式会社アークライトでございます。\n\n利用許諾契約に基づく利用許諾料の計算書を、添付のとおりお送りいたします。\n\n■ 文書番号　　：{{documentNumber}}\n■ 利用許諾料額：{{amount}}\n■ 発行日　　　：{{date}}\n\n計算内容をご確認のうえ、ご不明な点や相違がございましたら、\nお手数ですが本メールへのご返信にてお知らせください。\nお支払いは、契約に定める支払条件に基づきお手続きいたします。\n\n今後ともどうぞよろしくお願い申し上げます。\n\n" +
        EMAIL_SIGNATURE,
    },
    general: {
      subject: "【株式会社アークライト】書類のご送付（{{documentNumber}}）",
      body:
        "{{vendorName}} 御中\n\nいつもお世話になっております。\n株式会社アークライトでございます。\n\n書類を添付のとおりお送りいたします。\n\n■ 文書番号：{{documentNumber}}\n■ 発行日　：{{date}}\n\n内容をご確認のうえ、ご不明な点がございましたら、お手数ですが\n本メールへのご返信にてご連絡ください。\n\n今後ともどうぞよろしくお願い申し上げます。\n\n" +
        EMAIL_SIGNATURE,
    },
  };
  const loadEmailCfg = async () => {
    const keys = [
      "EMAIL_ENABLED", "EMAIL_SENDER", "EMAIL_ALLOWED_RECIPIENTS", "EMAIL_CC",
      "email_subject_inspection", "email_body_inspection",
      "email_subject_royalty", "email_body_royalty",
      "email_subject_general", "email_body_general",
    ];
    const m: Record<string, any> = {};
    try {
      const r = await query(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [keys]);
      for (const row of r.rows) {
        try { m[row.key] = JSON.parse(row.value); } catch { m[row.key] = row.value; }
      }
    } catch {
      /* app_settings 未整備でも env で継続 */
    }
    const get = (k: string) => (m[k] ?? process.env[k] ?? "");
    return {
      enabled: String(get("EMAIL_ENABLED") || "").toLowerCase() === "true",
      sender: String(get("EMAIL_SENDER") || ""),
      allow: String(get("EMAIL_ALLOWED_RECIPIENTS") || "")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      // 既定 CC 送信先(設定画面で複数指定可・カンマ区切り)。
      cc: String(get("EMAIL_CC") || "")
        .split(",").map((s) => s.trim()).filter(Boolean),
      tpl: {
        inspection: {
          subject: String(get("email_subject_inspection") || "") || DEFAULT_EMAIL_TPL.inspection.subject,
          body: String(get("email_body_inspection") || "") || DEFAULT_EMAIL_TPL.inspection.body,
        },
        royalty: {
          subject: String(get("email_subject_royalty") || "") || DEFAULT_EMAIL_TPL.royalty.subject,
          body: String(get("email_body_royalty") || "") || DEFAULT_EMAIL_TPL.royalty.body,
        },
        general: {
          subject: String(get("email_subject_general") || "") || DEFAULT_EMAIL_TPL.general.subject,
          body: String(get("email_body_general") || "") || DEFAULT_EMAIL_TPL.general.body,
        },
      },
    };
  };

  // メール本文(プレーンテキスト)を簡易 HTML 化。URL はリンク化。
  const emailTextToHtml = (text: string): string => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const linked = esc(text).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1">$1</a>'
    );
    return `<div style="white-space:pre-wrap;font-family:'Hiragino Sans',sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a">${linked}</div>`;
  };
  const applyEmailTokens = (
    tpl: string,
    vars: { vendorName: string; documentNumber: string; amount: string; date: string; link: string }
  ): string =>
    String(tpl)
      .replace(/\{\{\s*vendorName\s*\}\}/g, vars.vendorName)
      .replace(/\{\{\s*documentNumber\s*\}\}/g, vars.documentNumber)
      .replace(/\{\{\s*amount\s*\}\}/g, vars.amount)
      .replace(/\{\{\s*date\s*\}\}/g, vars.date)
      .replace(/\{\{\s*link\s*\}\}/g, vars.link);

  // 接続テスト: 送信元(EMAIL_SENDER)でプロフィール取得できるか(送信はしない)。
  app.get("/api/email/health", async (_req, res) => {
    try {
      const cfg = await loadEmailCfg();
      if (!cfg.sender)
        return res.json({ ok: false, enabled: cfg.enabled, error: "EMAIL_SENDER 未設定" });
      const r = await new EmailService({ sender: cfg.sender }).verifyConnection();
      res.json({ ok: true, enabled: cfg.enabled, sender: r.sender });
    } catch (e: any) {
      res.json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 接続テスト: 設定中の client_id で /token を取得できるか確認する(書類は送らない)。
  //   実接続テストの第一歩。設定は app_settings から読むので「保存後」に叩く。
  app.get("/api/cloudsign/health", async (_req, res) => {
    try {
      const cfg = await loadCloudSignCfg();
      const base = (cfg.baseUrl || process.env.CLOUDSIGN_BASE_URL || "https://api.cloudsign.jp").replace(/\/+$/, "");
      const out: any = {
        ok: true,
        configured: !!cfg.clientId,
        enabled: cfg.enabled,
        base,
        allow_count: cfg.allow.length,
        client_id_masked: cfg.clientId
          ? `${cfg.clientId.slice(0, 4)}…${cfg.clientId.slice(-2)}`
          : null,
      };
      if (!cfg.clientId) {
        out.token = { ok: false, error: "client_id 未設定" };
        return res.json(out);
      }
      try {
        const cs = new CloudSignService({ baseUrl: cfg.baseUrl, clientId: cfg.clientId });
        await cs.verifyConnection();
        out.token = { ok: true };
      } catch (e: any) {
        const data = e?.response?.data;
        out.token = {
          ok: false,
          status: e?.response?.status,
          error: typeof data === "string" ? data : data ? JSON.stringify(data).slice(0, 300) : String(e?.message || e),
        };
      }
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // CloudSign 応答から日時を取り出す(キー名の表記揺れに耐えるよう複数候補を試す)。
  const pickCsDate = (obj: any, keys: string[]): Date | null => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) return d;
      }
    }
    return null;
  };

  // CloudSign の getDocument 応答を cloudsign_requests に反映する共通処理。
  //   sent_at / completed_at は CloudSign の実日時(updatedAt/createdAt)を採用し、
  //   取れない場合のみ now() にフォールバック(過去書類でも正しい日時で履歴化できる)。
  //   既に値があるカラムは上書きしない(冪等)。
  const applyCloudSignDocStatus = async (reqRow: any, doc: any) => {
    const statusNum = Number(doc?.status);
    const isCompleted = statusNum === 2;
    const isDeclined = statusNum === 3;
    const newStatus = isCompleted
      ? "completed"
      : isDeclined
      ? "declined"
      : statusNum === 1
      ? "sent"
      : reqRow.status;
    const wasSent = statusNum === 1 || isCompleted;
    const updatedTs = pickCsDate(doc, ["updatedAt", "updated_at", "updateDate", "updatedDate"]);
    const createdTs = pickCsDate(doc, ["createdAt", "created_at", "createDate", "createdDate"]);
    const completedTs = updatedTs || new Date();
    const sentTs = (statusNum === 1 ? updatedTs : createdTs || updatedTs) || new Date();
    await query(
      `UPDATE cloudsign_requests
          SET status=$2,
              sent_at = CASE WHEN $4 AND sent_at IS NULL THEN $5 ELSE sent_at END,
              completed_at = CASE WHEN $3 AND completed_at IS NULL THEN $6 ELSE completed_at END,
              updated_at=now()
        WHERE id=$1`,
      [reqRow.id, newStatus, isCompleted, wasSent, sentTs, completedTs]
    );
    if (isCompleted && reqRow.capability_id) {
      await query(
        `UPDATE contract_capabilities SET contract_status='executed', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [reqRow.capability_id]
      );
    }
    const changed = newStatus !== reqRow.status || (wasSent && !reqRow.sent_at) || (isCompleted && !reqRow.completed_at);
    return { status: newStatus, statusNum, changed };
  };

  // 手動ステータス同期: CloudSign から書類の現在状態(status)を取得して反映する。
  //   webhook が飛ばない/取りこぼした場合でも、署名済みなら締結を確実に反映できる。
  //   (status: 1=先方確認中 / 2=締結済 / 3=取消・却下)
  app.get("/api/cloudsign/sync/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const found = await query(`SELECT * FROM cloudsign_requests WHERE id = $1`, [id]);
      const reqRow = found.rows[0];
      if (!reqRow) return res.status(404).json({ ok: false, error: "送信レコードが見つかりません" });
      if (!reqRow.cloudsign_document_id)
        return res.status(400).json({ ok: false, error: "cloudsign_document_id が無い(未送信)" });

      const cfg = await loadCloudSignCfg();
      if (!cfg.clientId) return res.status(400).json({ ok: false, error: "client_id 未設定" });
      const cloudSign = new CloudSignService({ baseUrl: cfg.baseUrl, clientId: cfg.clientId });
      const doc = await cloudSign.getDocument(reqRow.cloudsign_document_id);

      const result = await applyCloudSignDocStatus(reqRow, doc);
      res.json({ ok: true, id: reqRow.id, cloudsign_status: doc?.status, status: result.status });
    } catch (e: any) {
      console.error("[cloudsign sync] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 一括ステータス同期: cloudsign_document_id を持つ未確定レコードをまとめて CloudSign へ
  //   問い合わせ、送信日時/締結日時を取り込む(既存の送信済データに履歴を後付けする用)。
  //   token レート保護のため逐次処理し、上限件数を設ける。
  app.post("/api/cloudsign/sync-all", express.json(), async (req, res) => {
    try {
      const cfg = await loadCloudSignCfg();
      if (!cfg.clientId) return res.status(400).json({ ok: false, error: "client_id 未設定" });
      const limit = Math.min(Math.max(Number(req.body?.limit) || 300, 1), 1000);
      // 未確定 or 送信日時が未取得のレコードを対象(締結済/却下で日時も揃っていれば除外)。
      const rows = (await query(
        `SELECT * FROM cloudsign_requests
          WHERE cloudsign_document_id IS NOT NULL
            AND (status NOT IN ('completed','declined') OR sent_at IS NULL OR completed_at IS NULL)
          ORDER BY created_at DESC
          LIMIT $1`,
        [limit]
      )).rows;
      const cloudSign = new CloudSignService({ baseUrl: cfg.baseUrl, clientId: cfg.clientId });
      let checked = 0, updated = 0, failed = 0;
      const errors: string[] = [];
      for (const reqRow of rows) {
        checked++;
        try {
          const doc = await cloudSign.getDocument(reqRow.cloudsign_document_id);
          const result = await applyCloudSignDocStatus(reqRow, doc);
          if (result.changed) updated++;
        } catch (e: any) {
          failed++;
          if (errors.length < 5) errors.push(`#${reqRow.id}: ${String(e?.message || e).slice(0, 200)}`);
        }
      }
      res.json({ ok: true, checked, updated, failed, errors });
    } catch (e: any) {
      console.error("[cloudsign sync-all] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 送信履歴の手動取得: ある文書(document_number)の最新 cloudsign_requests を返す。
  //   手動編集フォームの初期値表示に使う。
  app.get("/api/cloudsign/history/:docNumber", async (req, res) => {
    try {
      const docNumber = String(req.params.docNumber || "").trim();
      if (!docNumber) return res.status(400).json({ ok: false, error: "document_number required" });
      const r = await query(
        `SELECT id, document_number, status, title, cloudsign_document_id,
                sent_at, completed_at, created_by, created_at
           FROM cloudsign_requests
          WHERE document_number = $1
          ORDER BY created_at DESC LIMIT 1`,
        [docNumber]
      );
      res.json({ ok: true, history: r.rows[0] || null });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 送信履歴の手動編集: 過去に(システム外でも)送信/締結したものを手で記録・修正する。
  //   既存レコードがあれば最新を更新、無ければ手動レコードを作成する。
  //   status: draft(未送信) / sent(送信済) / completed(締結済) / declined(却下)
  app.post("/api/cloudsign/manual-history", express.json(), async (req, res) => {
    try {
      const docNumber = String(req.body?.document_number || "").trim();
      if (!docNumber) return res.status(400).json({ ok: false, error: "document_number required" });
      const allowed = ["draft", "sent", "completed", "declined"];
      const status = allowed.includes(String(req.body?.status)) ? String(req.body.status) : "sent";
      const toTs = (v: any) => {
        if (!v) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      };
      let sentAt = toTs(req.body?.sent_at);
      let completedAt = toTs(req.body?.completed_at);
      // 締結済は送信済みを含意。送信日時が空なら締結日時で補完して送信履歴にも出す。
      if (status === "completed" && !sentAt) sentAt = completedAt;
      if (status === "draft") { sentAt = null; completedAt = null; }
      // 契約番号なら capability に紐付ける。
      const capRow = await query(
        `SELECT id FROM contract_capabilities WHERE document_number = $1 LIMIT 1`,
        [docNumber]
      );
      const capId = capRow.rows[0]?.id ?? null;
      const existing = await query(
        `SELECT id FROM cloudsign_requests WHERE document_number = $1 ORDER BY created_at DESC LIMIT 1`,
        [docNumber]
      );
      let id: number;
      if (existing.rows[0]) {
        id = existing.rows[0].id;
        await query(
          `UPDATE cloudsign_requests
              SET status = $2, sent_at = $3, completed_at = $4,
                  capability_id = COALESCE(capability_id, $5), updated_at = now()
            WHERE id = $1`,
          [id, status, sentAt, completedAt, capId]
        );
      } else {
        const user = (req.headers["x-user-email"] as string) || "manual-edit";
        const ins = await query(
          `INSERT INTO cloudsign_requests
             (document_number, capability_id, status, title, sent_at, completed_at, is_test, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,false,$7) RETURNING id`,
          [docNumber, capId, status, `手動記録 ${docNumber}`, sentAt, completedAt, user]
        );
        id = ins.rows[0].id;
      }
      // 締結済なら契約状態も executed に反映(自動送信と同じ挙動)。
      if (status === "completed" && capId) {
        await query(
          `UPDATE contract_capabilities SET contract_status='executed', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
          [capId]
        );
      }
      res.json({ ok: true, id, status, sent_at: sentAt, completed_at: completedAt });
    } catch (e: any) {
      console.error("[cloudsign manual-history] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── A+C: 検収待ち / 期限超過のダイジェスト ───────────────────────────
  //   検収書の自動課題を廃した代わりに、未検収(検収書未発行)の支払明細を
  //   発注書(PO)単位でまとめて取得する。GET=一覧取得 / POST=Slack 日次通知。
  async function loadInspectionPending() {
    const r = await query(
      `SELECT cc.id AS po_id, cc.document_number AS po_number, cc.contract_title,
              v.vendor_name,
              cl.id AS line_id, cl.line_code, cl.subject, cl.delivery_date, cl.amount_ex_tax,
              (cl.delivery_date IS NOT NULL AND cl.delivery_date <= CURRENT_DATE) AS overdue
         FROM condition_lines cl
         JOIN condition_line_status_v s ON s.id = cl.id
         LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
         LEFT JOIN vendors v ON v.id = cc.vendor_id
        WHERE s.status IN ('open','partially_fulfilled')
          AND cl.payment_scheme IN ('lump_sum','per_unit','installment')
          AND NOT EXISTS (
            SELECT 1 FROM condition_events ce
             WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
               AND ce.event_type = 'inspection')
          AND COALESCE(cc.is_primary, TRUE) = TRUE
          AND COALESCE(cc.lifecycle_status, 'final') = 'final'
        ORDER BY overdue DESC, cl.delivery_date ASC NULLS LAST, cc.document_number`
    );
    return r.rows;
  }

  app.get("/api/management/inspection-pending", async (_req, res) => {
    try {
      const rows = await loadInspectionPending();
      const overdue = rows.filter((r: any) => r.overdue).length;
      res.json({ ok: true, total: rows.length, overdue, rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/management/inspection-digest", express.json(), async (req, res) => {
    try {
      if (!slackWebClient) return res.status(400).json({ ok: false, error: "Slack 未設定(SLACK_BOT_TOKEN)" });
      // 通知先: body.channel > app_settings.SLACK_INSPECTION_DIGEST_CHANNEL > env。
      let channel = String(req.body?.channel || "").trim();
      if (!channel) {
        try {
          const s = await query(`SELECT value FROM app_settings WHERE key = 'SLACK_INSPECTION_DIGEST_CHANNEL'`);
          let v: any = s.rows[0]?.value;
          if (v != null) { try { v = JSON.parse(v); } catch { /* str */ } }
          channel = String(v || process.env.SLACK_INSPECTION_DIGEST_CHANNEL || "").trim();
        } catch {
          channel = String(process.env.SLACK_INSPECTION_DIGEST_CHANNEL || "").trim();
        }
      }
      if (!channel) return res.status(400).json({ ok: false, error: "通知先チャンネル未設定(SLACK_INSPECTION_DIGEST_CHANNEL)" });

      const rows = await loadInspectionPending();
      const overdueRows = rows.filter((r: any) => r.overdue);
      const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
      const yen = (v: any) => (v == null ? "" : `¥${Number(v).toLocaleString("ja-JP")}`);
      const fmtDate = (d: any) => (d ? String(d).slice(0, 10) : "—");

      // PO 単位にグループ化(超過を優先表示)。
      const byPo = new Map<string, { po: string; title: string; vendor: string; lines: any[] }>();
      for (const r of rows) {
        const key = r.po_number || `cap-${r.po_id}`;
        if (!byPo.has(key)) byPo.set(key, { po: r.po_number || "(契約番号なし)", title: r.contract_title || "", vendor: r.vendor_name || "", lines: [] });
        byPo.get(key)!.lines.push(r);
      }
      // 超過を含む PO を先に並べる。
      const groups = Array.from(byPo.values()).sort((a, b) => {
        const ao = a.lines.some((l) => l.overdue) ? 0 : 1;
        const bo = b.lines.some((l) => l.overdue) ? 0 : 1;
        return ao - bo;
      });

      const lines: string[] = [];
      lines.push(`📋 *検収待ちダイジェスト* (${today})`);
      lines.push(`検収待ち: *${rows.length}件* ／ うち期限超過: *${overdueRows.length}件*`);
      if (rows.length === 0) lines.push("✅ 検収待ちはありません。");
      let shown = 0;
      const MAX = 40;
      for (const g of groups) {
        if (shown >= MAX) { lines.push(`…ほか ${rows.length - shown} 件`); break; }
        const hasOver = g.lines.some((l) => l.overdue);
        lines.push(`\n${hasOver ? "🔴" : "🟡"} *[${g.po}]* ${g.vendor}${g.title ? ` — ${g.title}` : ""}（${g.lines.length}件）`);
        for (const l of g.lines) {
          if (shown >= MAX) break;
          const flag = l.overdue ? "⏰超過 " : "";
          lines.push(`   • ${flag}${l.subject || l.line_code || ""} (納期 ${fmtDate(l.delivery_date)}${l.amount_ex_tax != null ? `, ${yen(l.amount_ex_tax)}` : ""})`);
          shown++;
        }
      }
      const text = lines.join("\n");
      await slackWebClient.chat.postMessage({ channel, text });
      res.json({ ok: true, total: rows.length, overdue: overdueRows.length, channel });
    } catch (e: any) {
      console.error("[inspection-digest] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 統合 Phase2 ドライラン: 移行の影響件数・衝突候補を読み取り専用で集計 ──
  //   何も変更しない。Phase2 移行スクリプトの設計と件数照合に使う。
  app.get("/api/admin/unify/phase2-dryrun", async (_req, res) => {
    const scalar = async (sql: string): Promise<number | null> => {
      try { const r = await query(sql); return Number(r.rows?.[0]?.n ?? 0); }
      catch { return null; } // テーブル/列が無い環境では null
    };
    const rowsOf = async (sql: string): Promise<any[]> => {
      try { return (await query(sql)).rows; } catch { return []; }
    };
    try {
      const report: any = { generated_at: new Date().toISOString() };

      // A) Ledgers / materials の移行対象
      report.ledgers = {
        total: await scalar(`SELECT COUNT(*)::int n FROM ledgers`),
        active: await scalar(`SELECT COUNT(*)::int n FROM ledgers WHERE COALESCE(is_active,true)=true`),
        materials: await scalar(`SELECT COUNT(*)::int n FROM work_materials`),
        materials_default: await scalar(`SELECT COUNT(*)::int n FROM work_materials WHERE is_default=true`),
      };

      // B) works(原作=licensed_in, IP-) と名寄せ候補
      report.works_source = {
        licensed_in_total: await scalar(`SELECT COUNT(*)::int n FROM works WHERE kind='licensed_in'`),
        ip_coded: await scalar(`SELECT COUNT(*)::int n FROM works WHERE kind='licensed_in' AND work_code LIKE 'IP-%'`),
        own_total: await scalar(`SELECT COUNT(*)::int n FROM works WHERE kind='own'`),
      };
      // ledgers.title ↔ works(licensed_in).title の正規化一致(=名寄せ要レビュー)
      report.name_collisions = {
        count: await scalar(
          `SELECT COUNT(*)::int n FROM ledgers l
             JOIN works w ON w.kind='licensed_in'
              AND lower(btrim(w.title)) = lower(btrim(l.title))`
        ),
        sample: await rowsOf(
          `SELECT l.ledger_code, w.work_code, l.title
             FROM ledgers l
             JOIN works w ON w.kind='licensed_in'
              AND lower(btrim(w.title)) = lower(btrim(l.title))
            ORDER BY l.ledger_code LIMIT 20`
        ),
      };

      // C) IP→LO 再採番の影響(被参照件数=ブラスト半径)
      report.ip_renumber = {
        targets: await scalar(`SELECT COUNT(*)::int n FROM works WHERE kind='licensed_in' AND work_code LIKE 'IP-%'`),
        ref_contract_works: await scalar(
          `SELECT COUNT(*)::int n FROM contract_works cw JOIN works w ON w.id=cw.work_id
            WHERE w.kind='licensed_in' AND w.work_code LIKE 'IP-%'`),
        ref_condition_lines_work: await scalar(
          `SELECT COUNT(*)::int n FROM condition_lines cl JOIN works w ON w.id=cl.work_id
            WHERE w.kind='licensed_in' AND w.work_code LIKE 'IP-%'`),
        ref_work_materials: await scalar(
          `SELECT COUNT(*)::int n FROM work_materials wm JOIN works w ON w.id=wm.work_id
            WHERE w.kind='licensed_in' AND w.work_code LIKE 'IP-%'`),
      };

      // D) condition_lines の取引種別 分類状況(Phase1 backfill 後)
      report.condition_lines = {
        total: await scalar(`SELECT COUNT(*)::int n FROM condition_lines`),
        by_kind: await rowsOf(
          `SELECT COALESCE(transaction_kind,'(NULL)') AS transaction_kind, COUNT(*)::int n
             FROM condition_lines GROUP BY 1 ORDER BY n DESC`),
        null_by_scheme: await rowsOf(
          `SELECT payment_scheme, COUNT(*)::int n
             FROM condition_lines WHERE transaction_kind IS NULL
            GROUP BY 1 ORDER BY n DESC`),
        // 種別NULLの明細を個別分類するための内訳(方向/契約/取引先/金額)。
        null_lines: await rowsOf(
          `SELECT cl.id, cl.line_code, cl.subject, cl.direction, cl.payment_scheme,
                  cl.amount_ex_tax, cl.quantity, cl.unit_price,
                  cc.document_number, cc.record_type, cc.contract_title,
                  v.vendor_name
             FROM condition_lines cl
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN vendors v ON v.id = cc.vendor_id
            WHERE cl.transaction_kind IS NULL
            ORDER BY cl.id LIMIT 50`),
        counterparty_null: await scalar(`SELECT COUNT(*)::int n FROM condition_lines WHERE counterparty_vendor_id IS NULL`),
      };

      // E) work_materials の状態
      report.work_materials = {
        total: await scalar(`SELECT COUNT(*)::int n FROM work_materials`),
        by_acquisition: await rowsOf(
          `SELECT COALESCE(acquisition_type,'(NULL)') AS acquisition_type, COUNT(*)::int n
             FROM work_materials GROUP BY 1 ORDER BY n DESC`),
        missing_code: await scalar(`SELECT COUNT(*)::int n FROM work_materials WHERE material_code IS NULL`),
        is_default: await scalar(`SELECT COUNT(*)::int n FROM work_materials WHERE is_default=true`),
      };

      res.json({ ok: true, report });
    } catch (e: any) {
      console.error("[phase2-dryrun] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });


  // 修復ツール: 上書き事故で「検収書(inspection_certificate)だが発注書番号」になった文書を
  //   検収書として再採番(ARC-INS-…)し、紐づく条件明細を検収済(inspection イベント=金額分)にする。
  //   contract_capabilities(発注書側)はそのまま(record_type/番号は触らない)。
  app.post("/api/admin/documents/:docNumber/repair-inspection", express.json(), async (req, res) => {
    const client = await pool.connect();
    try {
      const docNumber = String(req.params.docNumber || "").trim();
      if (!docNumber) {
        return res.status(400).json({ ok: false, error: "docNumber required" });
      }
      await client.query("BEGIN");
      const dq = await client.query(
        `SELECT id, document_number, template_type, issue_key FROM documents WHERE document_number = $1 LIMIT 1`,
        [docNumber]
      );
      const doc = dq.rows[0];
      if (!doc) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "文書が見つかりません" });
      }
      if (doc.template_type !== "inspection_certificate") {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ ok: false, error: `検収書(inspection_certificate)ではありません: ${doc.template_type}` });
      }
      // この番号の capability 配下の条件明細
      const clq = await client.query(
        `SELECT cl.id, cl.amount_ex_tax
           FROM contract_capabilities cc
           JOIN condition_lines cl ON cl.capability_id = cc.id
          WHERE cc.document_number = $1`,
        [docNumber]
      );
      // 検収済化: 未充足分を inspection イベントで埋める
      let eventsInserted = 0;
      for (const line of clq.rows) {
        const sumq = await client.query(
          `SELECT COALESCE(SUM(amount_ex_tax),0) AS consumed, COALESCE(MAX(event_no),0) AS maxno
             FROM condition_events WHERE condition_line_id = $1 AND voided_at IS NULL`,
          [line.id]
        );
        const consumed = Number(sumq.rows[0].consumed) || 0;
        const amount = Number(line.amount_ex_tax) || 0;
        const remaining = amount - consumed;
        if (remaining <= 0) continue;
        await client.query(
          `INSERT INTO condition_events
             (condition_line_id, event_no, event_type, document_id, backlog_issue_key, occurred_at, amount_ex_tax)
           VALUES ($1, $2, 'inspection', $3, $4, now(), $5)`,
          [line.id, Number(sumq.rows[0].maxno) + 1, doc.id, doc.issue_key || null, remaining]
        );
        eventsInserted++;
      }
      // 検収書の新番号で再採番(documents のみ。capability=発注書はそのまま)
      const newNumber = await getNewDocumentNumber("inspection_certificate", undefined);
      await client.query(
        `UPDATE documents SET document_number = $1, base_document_number = $1 WHERE id = $2`,
        [newNumber, doc.id]
      );
      await client.query("COMMIT");
      res.json({
        ok: true,
        doc_id: doc.id,
        old_number: docNumber,
        new_number: newNumber,
        condition_lines: clq.rows.length,
        events_inserted: eventsInserted,
      });
    } catch (e: any) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      console.error("[repair-inspection] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    } finally {
      client.release();
    }
  });

  // 契約(contract_capabilities)を CloudSign へ送信(下書き作成→PDF添付→宛先→送信確定)。
  app.post("/api/contracts/:id/cloudsign/send", express.json(), async (req, res) => {
    try {
      const cfg = await loadCloudSignCfg();
      if (!cfg.enabled)
        return res.status(403).json({ ok: false, error: "CloudSign 連携が無効です (設定でオンにしてください)" });
      if (!cfg.clientId)
        return res.status(400).json({ ok: false, error: "client_id 未設定 (設定画面で入力してください)" });
      const cloudSign = new CloudSignService({ baseUrl: cfg.baseUrl, clientId: cfg.clientId });
      const capId = Number(req.params.id);
      if (!Number.isFinite(capId)) return res.status(400).json({ ok: false, error: "invalid id" });

      const c = await query(
        `SELECT cc.id, cc.document_number, cc.contract_title, cc.vendor_id, v.vendor_name,
                (SELECT drive_link FROM documents d WHERE d.document_number = cc.document_number
                  ORDER BY created_at DESC LIMIT 1) AS drive_link,
                (SELECT template_type FROM documents d WHERE d.document_number = cc.document_number
                  ORDER BY created_at DESC LIMIT 1) AS template_type
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE cc.id = $1`,
        [capId]
      );
      const row = c.rows[0];
      if (!row) return res.status(404).json({ ok: false, error: "契約が見つかりません" });
      if (!row.drive_link)
        return res.status(400).json({ ok: false, error: "生成済みPDFがありません(先に文書生成が必要)" });
      // PDF の取得元は Google Drive 限定。LegalOn 等の外部リンクは添付できないので
      //   分かりやすいエラーで返す(cryptic な「fileId を抽出できません」を回避)。
      {
        const dl = String(row.drive_link);
        const isDriveUrl =
          /\/file\/d\/[a-zA-Z0-9_-]+/.test(dl) || /(drive|docs)\.google\.com/.test(dl);
        if (!isDriveUrl) {
          let host = "";
          try {
            host = new URL(dl).host;
          } catch {
            /* noop */
          }
          return res.status(400).json({
            ok: false,
            error: `この契約のPDFは Google Drive 上にありません${
              host ? `（リンク先: ${host}）` : ""
            }。クラウドサイン送信には Drive 上のPDFが必要です。文書を生成して Drive に保存してから送信してください。`,
          });
        }
      }

      // 宛先: body.participants 優先、無ければ取引先の主担当を採用。
      let participants: any[] = Array.isArray(req.body?.participants) ? req.body.participants : [];
      if (!participants.length) {
        const vc = await query(
          `SELECT contact_name, email FROM vendor_contacts
            WHERE vendor_id = $1 AND email IS NOT NULL AND email <> ''
            ORDER BY is_primary DESC, sort_order ASC LIMIT 1`,
          [row.vendor_id]
        );
        if (vc.rows[0])
          participants = [
            { name: vc.rows[0].contact_name || row.vendor_name, email: vc.rows[0].email, organization: row.vendor_name, order: 1 },
          ];
      }
      participants = participants.filter((p) => p && p.email);
      if (!participants.length)
        return res.status(400).json({ ok: false, error: "宛先(署名者メール)がありません" });

      // 言語(ja|en)と CC(共有先 reportees)。draft=true なら送信せず下書きのままにし、
      //   CloudSign の編集画面で署名欄/印影を配置→送信してもらう。
      const language = String(req.body?.language || "").trim().toLowerCase();
      const draft = req.body?.draft === true;
      const cc: any[] = Array.isArray(req.body?.cc)
        ? req.body.cc.filter((c: any) => c && c.email).map((c: any) => ({ email: String(c.email), name: c.name }))
        : [];

      // テストガード: allowlist 設定時は全宛先(署名者+CC)がその集合内であること。
      const isTest = cfg.allow.length > 0;
      if (isTest) {
        const bad = [...participants, ...cc].find(
          (p) => !cfg.allow.includes(String(p.email).toLowerCase())
        );
        if (bad)
          return res
            .status(400)
            .json({ ok: false, error: `テスト中は許可された宛先のみ送信できます: ${bad.email}` });
      }

      const user = (req.headers["x-user-email"] as string) || "cloudsign";
      // タイトルは「取引先名, 文書番号」のカンマ区切り(運用要望)。
      const title =
        [row.vendor_name, row.document_number].filter(Boolean).join(", ") ||
        row.contract_title || row.document_number || `契約 ${capId}`;
      const ins = await query(
        `INSERT INTO cloudsign_requests
           (document_number, capability_id, template_type, status, title, participants, is_test, created_by)
         VALUES ($1,$2,$3,'sending',$4,$5::jsonb,$6,$7) RETURNING id`,
        [row.document_number, capId, row.template_type || null, title, JSON.stringify(participants), isTest, user]
      );
      const reqId = ins.rows[0].id;

      try {
        const pdf = await googleDriveService.downloadPdf(row.drive_link);
        const csId = await cloudSign.createDocument(title);
        // 作成直後に書類IDを保存(以降の attach/participants/reportees で失敗しても
        //   CloudSign 上の書類との紐付けを失わない → 後から sync で回収・整合できる)。
        await query(
          `UPDATE cloudsign_requests SET cloudsign_document_id=$2, updated_at=now() WHERE id=$1`,
          [reqId, csId]
        );
        await cloudSign.attachFile(csId, pdf, `${row.document_number || "contract"}.pdf`);
        for (const p of participants)
          await cloudSign.addParticipant(csId, { ...p, languageCode: language || undefined });
        for (const c of cc) await cloudSign.addReportee(csId, c);
        const csUrl = `${cloudSignAppBase(cfg)}/documents/${csId}`;
        if (draft) {
          await query(
            `UPDATE cloudsign_requests SET cloudsign_document_id=$2, status='draft', updated_at=now() WHERE id=$1`,
            [reqId, csId]
          );
          res.json({ ok: true, id: reqId, cloudsign_document_id: csId, is_test: isTest, draft: true, cloudsign_url: csUrl });
        } else {
          await cloudSign.sendDocument(csId);
          await query(
            `UPDATE cloudsign_requests SET cloudsign_document_id=$2, status='sent', sent_at=now(), updated_at=now() WHERE id=$1`,
            [reqId, csId]
          );
          res.json({ ok: true, id: reqId, cloudsign_document_id: csId, is_test: isTest });
        }
      } catch (e: any) {
        await query(`UPDATE cloudsign_requests SET status='error', error=$2, updated_at=now() WHERE id=$1`, [
          reqId,
          String(e?.message || e),
        ]);
        throw e;
      }
    } catch (e: any) {
      console.error("[cloudsign send] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 検収書 / 利用許諾料計算書 をメール送信(Gmail API)。手動送信ボタン用。
  //   body: { to?: string|string[], cc?: string[] }  to 未指定なら取引先主担当。
  //   PDF は Drive 上の HTML を取得して描画し添付(best-effort)。
  app.post("/api/documents/:docNumber/email/send", express.json(), async (req, res) => {
    try {
      const docNumber = String(req.params.docNumber || "").trim();
      if (!docNumber) return res.status(400).json({ ok: false, error: "document_number が必要です" });
      const cfg = await loadEmailCfg();
      if (!cfg.enabled)
        return res.status(400).json({ ok: false, error: "メール送信が無効です(設定で EMAIL_ENABLED を true に)" });
      if (!cfg.sender)
        return res.status(400).json({ ok: false, error: "送信元(EMAIL_SENDER)が未設定です" });

      // 文書 + 取引先を解決。
      const dr = await query(
        `SELECT d.id, d.document_number, d.template_type, d.form_data, d.drive_link, d.issue_key,
                d.matter_id, cc.vendor_id, v.vendor_name
           FROM documents d
           LEFT JOIN contract_capabilities cc ON cc.document_number = d.document_number
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE d.document_number = $1
          ORDER BY cc.is_primary DESC NULLS LAST
          LIMIT 1`,
        [docNumber]
      );
      if (!dr.rows[0]) return res.status(404).json({ ok: false, error: "文書が見つかりません" });
      const doc = dr.rows[0];
      const tt = String(doc.template_type || "");
      const isInspection = tt.includes("inspection");
      const isRoyalty = tt === "royalty_statement" || tt === "license_calculation_sheet";
      // 種別制限は撤廃: 全文書を個別メール送信可。本文テンプレは種別で選ぶ
      //   (検収書/計算書は専用、その他は汎用)。契約書は CloudSign 推奨だが送信は可。

      // 宛先: body.to 優先(上書き)、無ければ取引先の主担当メール。
      let to: string[] = [];
      if (Array.isArray(req.body?.to)) to = req.body.to.map((s: any) => String(s).trim()).filter(Boolean);
      else if (typeof req.body?.to === "string" && req.body.to.trim())
        to = req.body.to.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (!to.length && doc.vendor_id) {
        const vc = await query(
          `SELECT email FROM vendor_contacts
            WHERE vendor_id = $1 AND email IS NOT NULL AND email <> ''
            ORDER BY is_primary DESC, sort_order ASC LIMIT 1`,
          [doc.vendor_id]
        );
        if (vc.rows[0]?.email) to = [String(vc.rows[0].email)];
      }
      to = to.filter(Boolean);
      if (!to.length)
        return res.status(400).json({ ok: false, error: "宛先メールがありません(取引先の主担当が未設定)" });
      // CC: 設定の既定 CC(EMAIL_CC) + body.cc をマージして重複除去。
      const bodyCc: string[] = Array.isArray(req.body?.cc)
        ? req.body.cc.map((s: any) => String(s).trim()).filter(Boolean)
        : [];
      const cc: string[] = Array.from(
        new Set([...cfg.cc, ...bodyCc].map((s) => s.trim()).filter(Boolean))
      ).filter((e) => !to.includes(e)); // 宛先と重複する CC は除外

      // テストガード: allowlist 設定時は全宛先がその集合内であること。
      if (cfg.allow.length) {
        const bad = [...to, ...cc].find((e) => !cfg.allow.includes(String(e).toLowerCase()));
        if (bad)
          return res
            .status(400)
            .json({ ok: false, error: `テスト中は許可された宛先のみ送信できます: ${bad}` });
      }

      // 件名/本文(テンプレ + トークン置換)。
      const fd = doc.form_data || {};
      // 金額: 整形済み(…Str)を優先し、生値しか無ければ桁区切りに整形。
      const amountRaw =
        fd.grandTotalPayableStr || fd.totalPaymentStr || fd.totalAmountStr ||
        fd.grandTotalPayable || fd.totalAmount || fd.GRAND_TOTAL || fd.TOTAL_AMOUNT || "";
      const amountNum = Number(amountRaw);
      const amount =
        String(amountRaw).trim() && Number.isFinite(amountNum)
          ? `¥${amountNum.toLocaleString("ja-JP")}`
          : String(amountRaw);
      // 宛名: 取引先マスタ(capability 経由)が引けない文書(検収書等は capability を
      //   持たない)は form_data から救済する。検収書=counterparty / 計算書=licensor。
      const vendorName = String(
        doc.vendor_name ||
          fd.counterparty ||
          fd.licensor ||
          fd.VENDOR_NAME ||
          fd["Licensor_名称"] ||
          fd["Licensor_氏名会社名"] ||
          fd.PARTY_B_NAME ||
          fd.partyBName ||
          ""
      ).trim();
      const vars = {
        vendorName,
        documentNumber: String(doc.document_number || ""),
        amount,
        date: new Date().toLocaleDateString("ja-JP"),
        link: String(doc.drive_link || ""),
      };
      const t = isInspection ? cfg.tpl.inspection : isRoyalty ? cfg.tpl.royalty : cfg.tpl.general;
      const subject = applyEmailTokens(t.subject, vars);
      const html = emailTextToHtml(applyEmailTokens(t.body, vars));

      // 添付: Drive 上の正本を取得して添付(best-effort)。正本は生成時に PDF で
      //   保存されているのでそのまま添付する。PDF バイナリを文字列化して
      //   renderHtmlToPdf に通すと壊れる(文字化けPDFになる)ため、旧形式の
      //   HTML ファイルだった場合のみ PDF 化する。
      let attachments: any[] = [];
      let attached = false;
      try {
        const buf = await googleDriveService.downloadPdf(doc.drive_link);
        const isPdf = buf.subarray(0, 5).toString("latin1").startsWith("%PDF");
        const pdf = isPdf ? buf : await renderHtmlToPdf(buf.toString("utf8"));
        attachments = [{ filename: `${doc.document_number}.pdf`, content: pdf, mimeType: "application/pdf" }];
        attached = true;
      } catch (e: any) {
        console.warn("[email] PDF 添付の生成に失敗(リンクのみで送信):", e?.message || e);
      }

      const { messageId } = await new EmailService({ sender: cfg.sender }).sendEmail({
        to, cc, subject, html, attachments,
      });

      await query(
        `UPDATE documents SET email_sent_at = now(), email_to = $2, email_message_id = $3
          WHERE document_number = $1`,
        [doc.document_number, to.join(", "), messageId || null]
      );

      // 案件の送信履歴(document_sends)にも記録する(best-effort。送信自体は成功扱い)。
      try {
        await query(
          `INSERT INTO document_sends (document_id, matter_id, channel, recipient, status, subject, message_id, remarks)
           VALUES ($1,$2,'email',$3,'sent',$4,$5,$6)`,
          [
            doc.id, doc.matter_id ?? null, to.join(", "), subject, messageId || null,
            cc.length ? `CC: ${cc.join(", ")}` : null,
          ]
        );
      } catch (e: any) {
        console.warn("[email send] document_sends の記録に失敗:", e?.message || e);
      }

      res.json({
        ok: true,
        to, cc, attached,
        message_id: messageId,
        sent_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[email send] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 契約に紐づく CloudSign 送信履歴(UI の状態表示用)。
  app.get("/api/contracts/:id/cloudsign", async (req, res) => {
    try {
      const capId = Number(req.params.id);
      if (!Number.isFinite(capId)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT * FROM cloudsign_requests WHERE capability_id = $1 ORDER BY created_at DESC`,
        [capId]
      );
      res.json(r.rows);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 部署ルートによる社内署名者の自動解決。
  //   契約 → 起票課題 → 申請者(legal_requests.slack_user_id) → staff.department →
  //   department_workflow_rules(承認者/押印担当/責任者) → 各ロールを staff(email/name)へ解決。
  //   返した順(承認者→押印担当→責任者)を既定の社内署名ルートとして送信ダイアログがプリフィルする。
  app.get("/api/contracts/:id/cloudsign/route", async (req, res) => {
    try {
      const capId = Number(req.params.id);
      if (!Number.isFinite(capId)) return res.status(400).json({ ok: false, error: "invalid id" });
      const r = await query(
        `SELECT COALESCE(s.department, lr.dept) AS department,
                ap.staff_name AS approver_name, ap.email AS approver_email,
                so.staff_name AS stamp_name,    so.email AS stamp_email,
                mg.staff_name AS manager_name,  mg.email AS manager_email
           FROM contract_capabilities cc
           LEFT JOIN legal_requests lr ON lr.backlog_issue_key = cc.backlog_issue_key
           LEFT JOIN staff s  ON s.slack_user_id = lr.slack_user_id
           LEFT JOIN department_workflow_rules dwr ON dwr.department = COALESCE(s.department, lr.dept)
           LEFT JOIN staff ap ON ap.slack_user_id = dwr.approver_slack_id
           LEFT JOIN staff so ON so.slack_user_id = dwr.stamp_operator_slack_id
           LEFT JOIN staff mg ON mg.slack_user_id = dwr.manager_slack_id
          WHERE cc.id = $1
          LIMIT 1`,
        [capId]
      );
      const row: any = r.rows[0] || {};
      const signers: any[] = [];
      if (row.approver_email)
        signers.push({ role: "承認者", name: row.approver_name || "承認者", email: row.approver_email });
      if (row.stamp_email)
        signers.push({ role: "押印担当", name: row.stamp_name || "押印担当", email: row.stamp_email });
      if (row.manager_email)
        signers.push({ role: "責任者", name: row.manager_name || "責任者", email: row.manager_email });
      res.json({ ok: true, department: row.department || null, signers });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 課題ベースの部署ルート解決(社内署名者) + 取引先主担当。まとめ送信ダイアログのプリフィル用。
  app.get("/api/issues/:key/cloudsign/route", async (req, res) => {
    try {
      const key = String(req.params.key || "").trim();
      if (!key) return res.status(400).json({ ok: false, error: "key required" });
      const r = await query(
        `SELECT COALESCE(s.department, lr.dept) AS department,
                ap.staff_name AS approver_name, ap.email AS approver_email,
                so.staff_name AS stamp_name,    so.email AS stamp_email,
                mg.staff_name AS manager_name,  mg.email AS manager_email
           FROM legal_requests lr
           LEFT JOIN staff s ON s.slack_user_id = lr.slack_user_id
           LEFT JOIN department_workflow_rules dwr ON dwr.department = COALESCE(s.department, lr.dept)
           LEFT JOIN staff ap ON ap.slack_user_id = dwr.approver_slack_id
           LEFT JOIN staff so ON so.slack_user_id = dwr.stamp_operator_slack_id
           LEFT JOIN staff mg ON mg.slack_user_id = dwr.manager_slack_id
          WHERE lr.backlog_issue_key = $1 LIMIT 1`,
        [key]
      );
      const row: any = r.rows[0] || {};
      const signers: any[] = [];
      if (row.approver_email)
        signers.push({ role: "承認者", name: row.approver_name || "承認者", email: row.approver_email });
      if (row.stamp_email)
        signers.push({ role: "押印担当", name: row.stamp_name || "押印担当", email: row.stamp_email });
      if (row.manager_email)
        signers.push({ role: "責任者", name: row.manager_name || "責任者", email: row.manager_email });
      // 取引先主担当(この課題の capability から)。
      let vendor: any = null;
      const v = await query(
        `SELECT v.vendor_name, vc.contact_name, vc.email
           FROM contract_capabilities cc
           JOIN vendors v ON v.id = cc.vendor_id
           LEFT JOIN LATERAL (
             SELECT contact_name, email FROM vendor_contacts
              WHERE vendor_id = cc.vendor_id AND email IS NOT NULL AND email <> ''
              ORDER BY is_primary DESC, sort_order ASC LIMIT 1
           ) vc ON TRUE
          WHERE cc.backlog_issue_key = $1 AND cc.vendor_id IS NOT NULL
          LIMIT 1`,
        [key]
      );
      if (v.rows[0])
        vendor = {
          name: v.rows[0].contact_name || v.rows[0].vendor_name || "",
          email: v.rows[0].email || "",
          vendor_name: v.rows[0].vendor_name || "",
        };
      res.json({ ok: true, department: row.department || null, signers, vendor });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 課題の複数文書を 1 つの CloudSign 書類にまとめて送信(発注書+検収書 等)。
  app.post("/api/issues/:key/cloudsign/send-bundle", express.json(), async (req, res) => {
    try {
      const cfg = await loadCloudSignCfg();
      if (!cfg.enabled)
        return res.status(403).json({ ok: false, error: "CloudSign 連携が無効です (設定でオンに)" });
      if (!cfg.clientId)
        return res.status(400).json({ ok: false, error: "client_id 未設定" });
      const key = String(req.params.key || "").trim();
      const docNumbers: string[] = Array.isArray(req.body?.document_numbers)
        ? req.body.document_numbers.map((s: any) => String(s)).filter(Boolean)
        : [];
      if (docNumbers.length === 0)
        return res.status(400).json({ ok: false, error: "文書が選択されていません" });
      let participants: any[] = Array.isArray(req.body?.participants)
        ? req.body.participants.filter((p: any) => p && p.email)
        : [];
      if (!participants.length)
        return res.status(400).json({ ok: false, error: "宛先(署名者メール)がありません" });

      // 各文書の PDF を取得 + Drive URL 検証。
      const docs: any[] = [];
      for (const dn of docNumbers) {
        const d = await query(
          `SELECT d.document_number, d.template_type, d.drive_link, v.vendor_name
             FROM documents d
             LEFT JOIN contract_capabilities cc ON cc.document_number = d.document_number
             LEFT JOIN vendors v ON v.id = cc.vendor_id
            WHERE d.document_number = $1 ORDER BY d.created_at DESC LIMIT 1`,
          [dn]
        );
        const row = d.rows[0];
        if (!row || !row.drive_link)
          return res.status(400).json({ ok: false, error: `生成済みPDFがありません: ${dn}` });
        const dl = String(row.drive_link);
        const isDriveUrl =
          /\/file\/d\/[a-zA-Z0-9_-]+/.test(dl) || /(drive|docs)\.google\.com/.test(dl);
        if (!isDriveUrl) {
          let host = "";
          try {
            host = new URL(dl).host;
          } catch {
            /* noop */
          }
          return res.status(400).json({
            ok: false,
            error: `${dn} のPDFは Google Drive 上にありません${host ? `（${host}）` : ""}。`,
          });
        }
        docs.push(row);
      }

      const language = String(req.body?.language || "").trim().toLowerCase();
      const draft = req.body?.draft === true;
      const cc: any[] = Array.isArray(req.body?.cc)
        ? req.body.cc.filter((c: any) => c && c.email).map((c: any) => ({ email: String(c.email), name: c.name }))
        : [];
      const isTest = cfg.allow.length > 0;
      if (isTest) {
        const bad = [...participants, ...cc].find(
          (p) => !cfg.allow.includes(String(p.email).toLowerCase())
        );
        if (bad)
          return res
            .status(400)
            .json({ ok: false, error: `テスト中は許可された宛先のみ送信できます: ${bad.email}` });
      }

      const cloudSign = new CloudSignService({ baseUrl: cfg.baseUrl, clientId: cfg.clientId });
      const user = (req.headers["x-user-email"] as string) || "cloudsign";
      // タイトルは「取引先名, 文書番号, 文書番号…」のカンマ区切り(運用要望)。
      //   取引先名は重複排除して先頭に並べ、続けて全文書番号を列挙する。
      const titleVendors = Array.from(
        new Set(docs.map((d) => d.vendor_name).filter(Boolean))
      );
      const titleDocNumbers = docs.map((d) => d.document_number).filter(Boolean);
      const title =
        String(req.body?.title || "").trim() ||
        [...titleVendors, ...titleDocNumbers].join(", ") ||
        `${key} まとめ送信（${docs.length}件）`;
      const capRow = await query(
        `SELECT id FROM contract_capabilities WHERE document_number = $1 LIMIT 1`,
        [docs[0].document_number]
      );
      const capId = capRow.rows[0]?.id ?? null;
      const ins = await query(
        `INSERT INTO cloudsign_requests
           (document_number, capability_id, template_type, status, title, participants, is_test, created_by)
         VALUES ($1,$2,$3,'sending',$4,$5::jsonb,$6,$7) RETURNING id`,
        [
          docs[0].document_number,
          capId,
          // template_type は VARCHAR(50)。まとめ送信は複数種別なので先頭1件を保存
          //   (全種別は title に記載)。50字超過(value too long)を防ぐ。
          docs[0].template_type || null,
          title,
          JSON.stringify(participants),
          isTest,
          user,
        ]
      );
      const reqId = ins.rows[0].id;
      try {
        const csId = await cloudSign.createDocument(title);
        // 作成直後に書類IDを保存(以降の attach/participants/reportees で失敗しても
        //   CloudSign 上の書類との紐付けを失わない → 後から sync で回収・整合できる)。
        await query(
          `UPDATE cloudsign_requests SET cloudsign_document_id=$2, updated_at=now() WHERE id=$1`,
          [reqId, csId]
        );
        for (const d of docs) {
          const pdf = await googleDriveService.downloadPdf(d.drive_link);
          await cloudSign.attachFile(csId, pdf, `${d.document_number || "doc"}.pdf`);
        }
        for (const p of participants)
          await cloudSign.addParticipant(csId, { ...p, languageCode: language || undefined });
        for (const c of cc) await cloudSign.addReportee(csId, c);
        const csUrl = `${cloudSignAppBase(cfg)}/documents/${csId}`;
        if (draft) {
          await query(
            `UPDATE cloudsign_requests SET cloudsign_document_id=$2, status='draft', updated_at=now() WHERE id=$1`,
            [reqId, csId]
          );
          res.json({ ok: true, id: reqId, cloudsign_document_id: csId, is_test: isTest, count: docs.length, draft: true, cloudsign_url: csUrl });
        } else {
          await cloudSign.sendDocument(csId);
          await query(
            `UPDATE cloudsign_requests SET cloudsign_document_id=$2, status='sent', sent_at=now(), updated_at=now() WHERE id=$1`,
            [reqId, csId]
          );
          res.json({ ok: true, id: reqId, cloudsign_document_id: csId, is_test: isTest, count: docs.length });
        }
      } catch (e: any) {
        await query(`UPDATE cloudsign_requests SET status='error', error=$2, updated_at=now() WHERE id=$1`, [
          reqId,
          String(e?.message || e),
        ]);
        throw e;
      }
    } catch (e: any) {
      console.error("[cloudsign send-bundle] failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // CloudSign Webhook 受信(締結完了等で状態を反映)。
  app.post("/api/webhooks/cloudsign", express.json(), async (req, res) => {
    try {
      const ev: any = req.body || {};
      // CloudSign Webhook ペイロード(実環境で確認):
      //   { documentID, status(整数: 1=先方確認中 / 2=締結済 / 3=取消・却下 / 13=インポート),
      //     userID, email, text("COMPLETED : ..." / "REJECTED : ..." 等) }
      const csId = String(ev.documentID || ev.document_id || ev.id || "");
      const statusNum = Number(ev.status);
      const text = String(ev.text || ev.event || "").toLowerCase();
      const statusStr = String(ev.status ?? "").toLowerCase();
      console.log("📝 CloudSign Webhook:", JSON.stringify(ev).slice(0, 300));
      if (!csId) return res.json({ ok: true, skipped: "no document id" });
      const found = await query(`SELECT * FROM cloudsign_requests WHERE cloudsign_document_id = $1`, [csId]);
      const reqRow = found.rows[0];
      if (!reqRow) return res.json({ ok: true, skipped: "unknown document" });

      // 締結済=2 / 取消・却下=3 / 先方確認中=1。text(COMPLETED/REJECTED/CANCELED)も併用して堅牢化。
      const isCompleted =
        statusNum === 2 ||
        /complete|done|finish|締結/.test(text) ||
        /complete|done|finish|締結/.test(statusStr);
      const isDeclined =
        statusNum === 3 ||
        /declin|reject|却下|cancel|取消/.test(text) ||
        /declin|reject|却下|cancel|取消/.test(statusStr);
      const newStatus = isCompleted
        ? "completed"
        : isDeclined
        ? "declined"
        : statusNum === 1
        ? "sent"
        : reqRow.status;

      // ①: 下書き運用では worker が sent_at を入れない(実送信は CloudSign 上で人が確定)。
      //   「先方確認中(1)」「締結済(2)」の webhook は実際に送信済みを意味するので、
      //   sent_at が未設定なら now() で補完し、送信履歴に反映されるようにする。
      const wasSent = statusNum === 1 || isCompleted;
      await query(
        `UPDATE cloudsign_requests
            SET status=$2,
                sent_at = CASE WHEN $4 AND sent_at IS NULL THEN now() ELSE sent_at END,
                completed_at = CASE WHEN $3 THEN now() ELSE completed_at END, updated_at=now()
          WHERE id=$1`,
        [reqRow.id, newStatus, isCompleted, wasSent]
      );

      if (isCompleted && reqRow.capability_id) {
        // 締結完了 → 契約状態を executed(締結中)へ。
        await query(
          `UPDATE contract_capabilities SET contract_status='executed', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
          [reqRow.capability_id]
        );
        // TODO(実環境): 締結済みPDF + 合意締結証明書を DL → Drive 保存 → signed_drive_link 更新。
        // TODO: notifyIssueEvent で Slack / Backlog へ締結完了通知。
      }
      res.json({ ok: true, status: newStatus });
    } catch (e: any) {
      console.error("[cloudsign webhook] error:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

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
           s.email           AS staff_email,
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

    // ステータス変更時に最新文書リンクがあれば添える。
    // リンクを Slack に貼る前に申請者へ Drive の閲覧権限を付与する
    // (共有ドライブ非メンバーだと「アクセス権をリクエスト」になるため)。
    // 付与失敗は warn ログのみで通知自体は続行する。
    if (event.type === "status_changed" && ctx.latest_drive_link) {
      const staffEmail = String(ctx.staff_email || "").trim();
      if (staffEmail) {
        const grant = await googleDriveService.grantViewPermission(
          ctx.latest_drive_link,
          staffEmail
        );
        if (!grant.ok) {
          console.warn(
            `[notify] drive view-permission grant failed (${issueKey} → ${staffEmail}): ${grant.error}`
          );
        }
      } else {
        console.warn(
          `[notify] staff.email not set for ${slackUserId} (${issueKey}); ` +
            `drive link may not be viewable by the requester`
        );
      }
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
    // Phase 22.21.82: planning_purchase_order テンプレ削除に伴い、
    //   AUTO_CHAIN_RULES から該当ルールを撤去。
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

      // A+C 運用: 発注書→検収(delivery_inspec) の子課題自動生成は既定で停止する。
      //   検収は「検収待ち」ビュー + 期限超過アラートで管理し、課題の乱立を防ぐ。
      //   AUTO_CHAIN_INSPECTION_ENABLED=true(app_settings or env) で従来どおり
      //   子課題を生成する(可逆)。利用許諾計算(license_calc)はこの停止の対象外。
      if (rule.childRequestType === "delivery_inspec") {
        let enabled = false;
        try {
          const r = await query(
            `SELECT value FROM app_settings WHERE key = 'AUTO_CHAIN_INSPECTION_ENABLED'`
          );
          let v: any = r.rows[0]?.value;
          if (v != null) { try { v = JSON.parse(v); } catch { /* 文字列のまま */ } }
          else v = process.env.AUTO_CHAIN_INSPECTION_ENABLED;
          enabled = String(v).toLowerCase() === "true";
        } catch {
          enabled = String(process.env.AUTO_CHAIN_INSPECTION_ENABLED || "").toLowerCase() === "true";
        }
        if (!enabled) {
          console.log(
            `🔗 [auto-chain] SKIP(検収): inspection auto-chain disabled (A+C 運用)。` +
              `検収待ちビュー/アラートで管理。AUTO_CHAIN_INSPECTION_ENABLED=true で再有効化可。`
          );
          return;
        }
      }

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
          // Phase 22.21.82: planning_purchase_order 削除に伴い分岐から外す
          //   (intl_purchase_order などの "%purchase_order%" マッチは生かす)。
          const tmplPattern =
            rule.parentRequestType === "purchase_order"
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

    // Phase 22.21.83: requestType → templateType マップ。
    //   legal_consult / 事務手続 / 未知 issueType は PDF テンプレ無し
    //   (= 自動 PDF 生成をスキップ、Backlog チケットだけ作る) に変更。
    //   担当者が後で admin-ui から「法務回答書 (legal_response)」を選んで
    //   PDF を発行する想定。
    //
    //   skipPdf = true のとき:
    //     - documentService.generateDocument() / uploadPdf() / documents INSERT
    //       を全部スキップ
    //     - getNewDocumentNumber も呼ばない (採番しない)
    //     - 戻り値の docNumber / driveLink は空文字
    let templateType: DocumentType | null = null;
    let skipPdf = false;
    // Phase 28.1: 複数契約に跨る検収依頼 (Slack 側で skip_pdf 判定済み) は
    // チケットだけ作り、検収書の発行は admin-ui の一括作成に委ねる。
    if (input.skip_pdf) skipPdf = true;
    if (requestType === "delivery_inspec") templateType = "inspection_certificate";
    else if (requestType === "purchase_order") templateType = "purchase_order";
    else if (requestType === "nda") templateType = "nda";
    else if (requestType === "license_master") templateType = "license_master";
    else if (requestType === "lic_individual") templateType = "individual_license_terms";
    else if (requestType === "license_calc") templateType = "license_calculation_sheet";
    else {
      // legal_consult / 事務手続 / 未知の Backlog issueType
      skipPdf = true;
      console.log(
        `[legacy-issue] requestType=${requestType} → PDF auto-generation skipped (担当者が後で法務回答書を発行)`
      );
    }

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

    // Phase 22.21.83: skipPdf=true なら docNumber/driveLink は空、PDF 関連の
    //   一連の処理 (採番 / レンダ / Drive アップ / documents INSERT) をすべて
    //   省略する。Backlog チケットと legal_requests 行だけ作って受付完了通知
    //   (notifyIssueEvent) を出す。
    let docNumber = "";
    let driveLink = "";
    if (!skipPdf && templateType) {
      docNumber = await getNewDocumentNumber(templateType, requestType);

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
      driveLink = await googleDriveService.uploadPdf(html, fileName);

      await query(
        "INSERT INTO documents (document_number, issue_key, template_type, form_data, drive_link, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
        [docNumber, issue.issueKey, templateType, JSON.stringify(details), driveLink, user]
      );
    } else {
      console.log(
        `[legacy-issue] ${issue.issueKey} (${requestType}): skipped auto PDF generation, awaiting manual document by 法務担当`
      );
    }

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
                // Phase 28.1: 複数契約(=複数取引先)に跨る検収依頼は GAS が
                // description に「対象契約番号: 複数」を書く。この場合は自動
                // PDF を作らず、admin-ui 検収待ちページの一括作成で法務が
                // 取引先ごとに検収書を発行する。
                skip_pdf:
                  requestType === "delivery_inspec" &&
                  /対象契約番号:\s*複数/.test(description),
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
   *   【${titleLabel}】${counterpartyDisplay}_${subTopicDisplay}_${YYYYMMDD}
   *   ※ titleLabel: 契約審査→文書作成 に置換(Backlog の issue type 名は温存)。
   *   例: 【文書作成】株式会社サンプル商事_業務委託基本契約書_20260616
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
          // Phase 25.7: 出版系 (基本契約=pub_master / 利用許諾条件書=pub_terms /
          //   追加利用許諾条件書=pub_additional)。いずれも issueTypeLabel=契約審査。
          "pub_master",
          "pub_terms",
          "pub_additional",
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
        // 表示用ラベル: 「契約審査」は文書作成と質が異なるため課題名の prefix を
        //   「文書作成」に変える(文書レビューは別途【法務相談】)。Backlog の
        //   issue type 名は契約審査のまま温存(下の type 解決には issueTypeLabel を使う)。
        const titleLabel = issueTypeLabel === "契約審査" ? "文書作成" : issueTypeLabel;
        // 作成日 YYYYMMDD (JST)。
        const ymd = new Date(Date.now() + 9 * 3600 * 1000)
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        const summary = `【${titleLabel}】${counterpartyDisplay}_${subTopicDisplay}_${ymd}`;

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
                // Phase 25.7: 出版系も「契約」カテゴリに割当
                "pub_master",
                "pub_terms",
                "pub_additional",
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
        //
        // Phase 23.6.9: Backlog は親子関係を 1 階層しか許さないため、
        //   parentIssueKey が既に他の課題の子だった場合 (= parent.parentIssueId
        //   が non-null) は、その祖父課題に昇格させて「兄弟」として作成する。
        //   auto-chain (line 614-619 付近) と同じロジックを quick-create にも
        //   適用。これがないと err.editIssue.parentChildIssue.3 で 400 が返る。
        let parentIssueId: number | undefined;
        let fallbackDueToHierarchy = false;
        let originalParentKey = "";
        if (parentIssueKey) {
          try {
            const parent = await backlogService.getIssue(parentIssueKey);
            if (!parent?.id) {
              return res.status(400).json({
                ok: false,
                error: `親課題 ${parentIssueKey} が見つかりません`,
              });
            }
            const grandParentId = parent.parentIssueId
              ? Number(parent.parentIssueId)
              : null;
            if (grandParentId) {
              // 親自身が子 → 祖父を effective parent にする
              parentIssueId = grandParentId;
              fallbackDueToHierarchy = true;
              originalParentKey = parentIssueKey;
              console.log(
                `[quick-create] Backlog 1 階層制約 fallback: ${parentIssueKey} (id=${parent.id}) は既に子課題のため、祖父 (id=${grandParentId}) を effective parent にする`
              );
            } else {
              parentIssueId = parent.id;
            }
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
        // Phase 23.6.9: fallback 時は description に注記を追加。
        const descriptionFinal = fallbackDueToHierarchy
          ? description +
            `\n\n※ Backlog の親子 1 階層制約により、本課題は ${originalParentKey} の「兄弟」(同じ祖父配下) として作成されています。`
          : description;
        const issueParams: any = {
          summary,
          description: descriptionFinal,
          issueTypeId,
          priorityId: 3,
          counterparty: counterpartyName,
          dept,
          deadline,
          remarks: details,
        };
        if (categoryId) issueParams["categoryId[]"] = categoryId;
        if (parentIssueId) issueParams.parentIssueId = parentIssueId;

        // Phase 23.6.9: parentChildIssue エラーが残り続けるケース
        //   (祖父も子だった、親が完了状態、etc.) を考慮し、最終 safety net
        //   として top-level retry を入れる。auto-chain と同じ振る舞い。
        let issue: any;
        try {
          issue = await backlogService.createIssue(issueParams);
        } catch (createErr: any) {
          const msg = String(createErr?.message || createErr);
          if (msg.includes("parentChildIssue") && parentIssueId) {
            console.warn(
              `[quick-create] parentChildIssue error with parent=${parentIssueId}, retry as top-level: ${msg}`
            );
            const retryParams = { ...issueParams };
            delete retryParams.parentIssueId;
            retryParams.description =
              description +
              `\n\n※ Backlog の親子制約により、独立課題として作成されました。` +
              (originalParentKey
                ? ` (起案時の指定親: ${originalParentKey})`
                : "");
            issue = await backlogService.createIssue(retryParams);
          } else {
            throw createErr;
          }
        }

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
   *   1. DB に merged_into_issue_key と issue_workflows='終結' を原子的に保存
   *   2. DB commit 後に Backlog 課題ステータスを「終結」に遷移
   *   3. Backlog 課題にコメントで「LEGAL-100 に統合」記録 (best-effort)
   *   4. Slack 通知 (best-effort)
   */
  app.patch(
    "/api/backlog/issues/:key/terminate",
    express.json(),
    async (req, res) => {
      try {
        const key = String(req.params.key || "").trim().toUpperCase();
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
        if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
          return res.status(400).json({
            ok: false,
            error: "source キー不正",
          });
        }
        if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(mergedInto)) {
          return res.status(400).json({
            ok: false,
            error: "merged_into_issue_key の形式が不正です (例: LEGAL-100)",
          });
        }
        if (key === mergedInto) {
          return res.status(400).json({
            ok: false,
            error: "統合元と統合先が同じです",
          });
        }

        const result = await mergeIssueInto(key, mergedInto, {
          mode: "child",
          // 終結=統合の一種なので、文書・明細も統合先へ引き継ぐ。
          moveData: true,
          reason: reason || "",
          shuketsuStatusId: statusId,
          targetId: null,
        });
        const backlogCommented = !result.warnings.some((w) =>
          w.startsWith("統合元コメント失敗")
        );

        res.json({
          ok: true,
          key,
          merged_into_issue_key: mergedInto,
          backlog_commented: backlogCommented,
          moved: result.moved,
          warnings: result.warnings,
        });
      } catch (error: any) {
        console.error("PATCH /api/backlog/issues/:key/terminate failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  /**
   * 課題統合: 重複/誤起票の課題(source)を survivor(target)へ統合する。
   *   mode='child' (既定): source を target の子課題にし、ステータスを「終結」に。
   *                        両課題へ統合コメント。非破壊で履歴が残る。
   *   mode='delete': source を Backlog から削除。target に統合コメント。不可逆。
   *   move_data=true: source に紐づく文書/明細/イベントを target 課題へ付け替える。
   *   いずれも DB は legal_requests.merged_into_issue_key と issue_workflows='終結' を更新。
   */
  // 課題統合の中核処理(単一/一括の両方から呼ぶ)。終結ステータスIDを渡せば
  //   getStatuses の再取得を省ける(一括時の最適化)。hard error は throw。
  async function mergeIssueInto(
    source: string,
    target: string,
    opts: { mode: "child" | "delete"; moveData: boolean; reason: string; shuketsuStatusId?: number | null; targetId?: number | null }
  ): Promise<{ moved: Record<string, number>; warnings: string[]; document_report: { moved: string[]; primary: string[]; superseded: string[] } }> {
    const { mode, moveData, reason } = opts;
    const moved: Record<string, number> = {};
    const documentReport = { moved: [] as string[], primary: [] as string[], superseded: [] as string[] };

    // 1) DB: 文書/明細/イベント/統合記録を単一トランザクションで更新。
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (moveData) {
        const sourceDocs = await client.query(
          `SELECT DISTINCT template_type
             FROM documents
            WHERE issue_key = $1
              AND template_type IS NOT NULL`,
          [source]
        );
        const touchedTemplateTypes = sourceDocs.rows
          .map((r: any) => String(r.template_type || "").trim())
          .filter(Boolean);

        const d = await client.query(
          `UPDATE documents
              SET issue_key = $1
            WHERE issue_key = $2
            RETURNING document_number`,
          [target, source]
        );
        moved.documents = d.rowCount || 0;
        documentReport.moved = d.rows
          .map((r: any) => String(r.document_number || ""))
          .filter(Boolean);

        const c = await client.query(
          `UPDATE contract_capabilities
              SET backlog_issue_key = $1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE backlog_issue_key = $2`,
          [target, source]
        );
        moved.capabilities = c.rowCount || 0;

        const ce = await client.query(
          `UPDATE condition_events
              SET backlog_issue_key = $1
            WHERE backlog_issue_key = $2`,
          [target, source]
        );
        moved.condition_events = ce.rowCount || 0;

        if (touchedTemplateTypes.length > 0) {
          const versions = await client.query(
            `WITH ranked AS (
               SELECT id,
                      document_number,
                      template_type,
                      ROW_NUMBER() OVER w AS rn,
                      FIRST_VALUE(document_number) OVER w AS primary_document_number
                 FROM documents
                WHERE issue_key = $1
                  AND template_type = ANY($2::text[])
                  AND COALESCE(lifecycle_status, 'final') = 'final'
                WINDOW w AS (
                  PARTITION BY template_type
                  ORDER BY created_at DESC NULLS LAST, id DESC
                )
             )
             UPDATE documents d
                SET is_primary = (ranked.rn = 1),
                    lifecycle_status = CASE WHEN ranked.rn = 1 THEN 'final' ELSE 'superseded' END,
                    superseded_by = CASE WHEN ranked.rn = 1 THEN NULL ELSE ranked.primary_document_number END
               FROM ranked
              WHERE d.id = ranked.id
              RETURNING d.document_number, d.is_primary, d.lifecycle_status`,
            [target, touchedTemplateTypes]
          );
          documentReport.primary = versions.rows
            .filter((r: any) => r.is_primary === true)
            .map((r: any) => String(r.document_number || ""))
            .filter(Boolean);
          documentReport.superseded = versions.rows
            .filter((r: any) => r.lifecycle_status === "superseded")
            .map((r: any) => String(r.document_number || ""))
            .filter(Boolean);

          const synced = await client.query(
            `UPDATE contract_capabilities cc
                SET is_primary = d.is_primary,
                    lifecycle_status = d.lifecycle_status,
                    superseded_by = d.superseded_by,
                    updated_at = CURRENT_TIMESTAMP
               FROM documents d
              WHERE cc.document_number = d.document_number
                AND d.issue_key = $1
                AND d.template_type = ANY($2::text[])`,
            [target, touchedTemplateTypes]
          );
          moved.capability_versions = synced.rowCount || 0;
        }
      }

      const lr = await client.query(
        `UPDATE legal_requests
            SET merged_into_issue_key = $1
          WHERE backlog_issue_key = $2`,
        [target, source]
      );
      moved.legal_requests = lr.rowCount || 0;

      const wf = await client.query(
        `UPDATE issue_workflows
            SET current_status_name = '終結',
                updated_at = now()
          WHERE backlog_issue_key = $1`,
        [source]
      );
      moved.issue_workflows = wf.rowCount || 0;

      // 案件(matter)の整合: Request 側の統合を案件へも反映する。
      //   - target が案件を持つ → source 側の案件を丸ごと吸収(課題/文書/送信を移し、空案件を削除)
      //   - source だけ案件を持つ → その案件を本件の案件として残し、代表を target へ切替
      //   - どちらも無い → 何もしない
      //   いずれも target 案件内に source を relation='duplicate' で残し、統合の履歴とする。
      {
        const tm = await client.query(
          `SELECT matter_id FROM matter_issues WHERE backlog_issue_key = $1 ORDER BY id LIMIT 1`,
          [target]
        );
        let caseMid: number | null = tm.rows[0]?.matter_id ?? null;
        const sm = await client.query(
          `SELECT DISTINCT matter_id FROM matter_issues WHERE backlog_issue_key = $1`,
          [source]
        );
        const sourceMids = sm.rows
          .map((r: any) => Number(r.matter_id))
          .filter((mid: number) => mid !== caseMid);

        if (caseMid == null && sourceMids.length > 0) {
          // target が案件未所属なら source の案件を引き継ぎ、target を代表として登録。
          caseMid = sourceMids.shift()!;
          await client.query(
            `INSERT INTO matter_issues (matter_id, backlog_issue_key, relation)
             VALUES ($1,$2,'primary')
             ON CONFLICT (matter_id, backlog_issue_key) DO UPDATE SET relation = 'primary'`,
            [caseMid, target]
          );
        }
        if (caseMid != null) {
          for (const mid of sourceMids) {
            await client.query(
              `UPDATE matter_issues mi SET matter_id = $1
                WHERE mi.matter_id = $2
                  AND NOT EXISTS (SELECT 1 FROM matter_issues x
                                   WHERE x.matter_id = $1 AND x.backlog_issue_key = mi.backlog_issue_key)`,
              [caseMid, mid]
            );
            await client.query(`UPDATE documents SET matter_id = $1 WHERE matter_id = $2`, [caseMid, mid]);
            await client.query(`UPDATE document_sends SET matter_id = $1 WHERE matter_id = $2`, [caseMid, mid]);
            await client.query(`DELETE FROM matters WHERE id = $1`, [mid]);
            moved.matters_absorbed = (moved.matters_absorbed || 0) + 1;
          }
          await client.query(
            `INSERT INTO matter_issues (matter_id, backlog_issue_key, relation, note)
             VALUES ($1,$2,'duplicate',$3)
             ON CONFLICT (matter_id, backlog_issue_key)
               DO UPDATE SET relation = 'duplicate',
                             note = COALESCE(matter_issues.note, EXCLUDED.note)`,
            [caseMid, source, `${target} へ統合(${mode === "delete" ? "削除" : "終結"})`]
          );
          await client.query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [caseMid]);
        }
        // 代表課題が source を指したままの案件はすべて target へ付け替える。
        await client.query(`UPDATE matters SET primary_issue_key = $1 WHERE primary_issue_key = $2`, [target, source]);
      }

      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK");
      console.warn(`[merge] DB transaction failed (${source}→${target}):`, e?.message || e);
      throw e;
    } finally {
      client.release();
    }

    // 2) Backlog 操作。外部APIなのでDBコミット後にbest-effortで実施する。
    const warnings: string[] = [];
    const reasonLine = reason ? `\n*理由:* ${reason}` : "";
    try { await backlogService.addComment(target, `🔗 *${source} を本課題へ統合しました*（重複/誤起票の整理）。${reasonLine}`); }
    catch (e: any) { warnings.push(`統合先コメント失敗: ${e?.message || e}`); }

    if (mode === "delete") {
      try { await backlogService.deleteIssue(source); }
      catch (e: any) { warnings.push(`統合元削除失敗: ${e?.message || e}`); }
    } else {
      if (opts.targetId) {
        try { await backlogService.setParent(source, opts.targetId); }
        catch (e: any) { warnings.push(`子課題化に失敗(階層制約の可能性)。終結のみ実施: ${e?.message || e}`); }
      }
      if (opts.shuketsuStatusId) {
        try { await backlogService.updateIssueStatus(source, opts.shuketsuStatusId); }
        catch (e: any) { warnings.push(`終結ステータス設定失敗: ${e?.message || e}`); }
      } else {
        warnings.push(`Backlog に「終結」ステータスが見つかりません`);
      }
      try { await backlogService.addComment(source, `🔁 *本課題は ${target} へ統合終結しました*。${reasonLine}`); }
      catch (e: any) { warnings.push(`統合元コメント失敗: ${e?.message || e}`); }
    }
    try { await notifyIssueEvent(source, { type: "status_changed", from: "(進行中)", to: `${target} に統合${mode === "delete" ? "(削除)" : "(終結)"}` }); }
    catch { /* noop */ }
    return { moved, warnings, document_report: documentReport };
  }

  const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
  // 終結ステータスID + 統合先課題IDを解決(子課題化/終結用)。
  //   統合元は必ず終了させたいので、「終結」が無い環境では キャンセル → 完了 の順で代替する。
  async function resolveMergeTargets(target: string) {
    let shuketsuStatusId: number | null = null;
    let targetId: number | null = null;
    try {
      const statuses = await backlogService.getStatuses();
      for (const name of ["終結", "キャンセル", "完了"]) {
        const hit = statuses.find((s: any) => s?.name === name);
        if (hit?.id) { shuketsuStatusId = hit.id; break; }
      }
    } catch { /* noop */ }
    try { targetId = (await backlogService.getIssue(target))?.id ?? null; } catch { /* noop */ }
    return { shuketsuStatusId, targetId };
  }

  app.post("/api/backlog/issues/:key/merge", express.json(), async (req, res) => {
    try {
      const source = String(req.params.key || "").trim().toUpperCase();
      const target = String(req.body?.target_key || "").trim().toUpperCase();
      const mode = req.body?.mode === "delete" ? "delete" : "child";
      // 統合元の文書・明細は既定で統合先へ引き継ぐ(明示的に false のときだけ残す)。
      const moveData = req.body?.move_data !== false;
      const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : "";
      if (!ISSUE_KEY_RE.test(source)) return res.status(400).json({ ok: false, error: "source キー不正" });
      if (!ISSUE_KEY_RE.test(target)) return res.status(400).json({ ok: false, error: "統合先(target)のキーが不正です (例: LEGAL-100)" });
      if (source === target) return res.status(400).json({ ok: false, error: "統合元と統合先が同じです" });
      const { shuketsuStatusId, targetId } = await resolveMergeTargets(target);
      try {
        const r = await mergeIssueInto(source, target, { mode, moveData, reason, shuketsuStatusId, targetId });
        res.json({ ok: true, source, target, mode, ...r });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: `統合に失敗(${source}): ${e?.message || e}` });
      }
    } catch (error: any) {
      console.error("POST /api/backlog/issues/:key/merge failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // 一括統合: 複数の source_keys を1つの target へまとめて統合する。
  app.post("/api/backlog/issues/merge-bulk", express.json(), async (req, res) => {
    try {
      const target = String(req.body?.target_key || "").trim().toUpperCase();
      const mode = req.body?.mode === "delete" ? "delete" : "child";
      // 統合元の文書・明細は既定で統合先へ引き継ぐ(明示的に false のときだけ残す)。
      const moveData = req.body?.move_data !== false;
      const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : "";
      if (!ISSUE_KEY_RE.test(target)) return res.status(400).json({ ok: false, error: "統合先(target)のキーが不正です (例: LEGAL-100)" });
      const sources: string[] = Array.from(new Set(
        (Array.isArray(req.body?.source_keys) ? req.body.source_keys : [])
          .map((s: any) => String(s).trim().toUpperCase())
          .filter((s: string) => ISSUE_KEY_RE.test(s) && s !== target)
      )) as string[];
      if (sources.length === 0) return res.status(400).json({ ok: false, error: "統合元(source_keys)がありません(統合先と同じものは除外されます)" });

      // 終結ID/統合先IDは1回だけ解決して使い回す(Backlog API 節約)。
      const { shuketsuStatusId, targetId } = await resolveMergeTargets(target);
      const results: any[] = [];
      let ok = 0, failed = 0;
      for (const source of sources) {
        try {
          const r = await mergeIssueInto(source, target, { mode, moveData, reason, shuketsuStatusId, targetId });
          results.push({ source, ok: true, warnings: r.warnings, moved: r.moved, document_report: r.document_report });
          ok++;
        } catch (e: any) {
          results.push({ source, ok: false, error: String(e?.message || e) });
          failed++;
        }
      }
      res.json({ ok: true, target, mode, total: sources.length, merged: ok, failed, results });
    } catch (error: any) {
      console.error("POST /api/backlog/issues/merge-bulk failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
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
        `UPDATE capability_line_items
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
    expiredTransitions: number;
  }> {
    const result = { deliveryAlerts: 0, contractAlerts: 0, expiredTransitions: 0 };

    // 平日判定 (JST)。Cloud Scheduler は時刻は JST だが day は UTC で
    // 返るおそれもあるので、明示的に JST 換算する。
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const dayOfWeekJst = jstNow.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekday = dayOfWeekJst >= 1 && dayOfWeekJst <= 5;

    // ─── 1. 発注書 / 業務明細毎の納期アラート ────────────────────
    // Phase 20 (修正版): capability_line_items.delivery_date を走査する。
    //   - 検収完了 (delivery_line_items.acceptance_ratio >= 1.0) の行は対象外
    //   - 7/3/1 日前 → 各 1 回通知
    //   - 期限超過 → 平日のみ毎日通知 (同日内重複は last_alert_at で抑止)
    // Phase 23: order_items / order_line_items は contract_capabilities /
    //   capability_line_items に統合された。発注書 = record_type='purchase_order'。
    try {
      const lineItems = await query(
        `SELECT
           cli.id            AS line_item_id,
           cli.capability_id AS order_item_id,
           cli.line_no,
           cli.item_name,
           cli.delivery_date,
           cc.backlog_issue_key,
           (cli.delivery_date - CURRENT_DATE) AS days_until
         FROM capability_line_items cli
         JOIN contract_capabilities cc
           ON cc.id = cli.capability_id
          AND cc.record_type = 'purchase_order'
         WHERE cli.delivery_date IS NOT NULL
           -- Phase D-2 (dual-read): 全量検収の除外判定。
           --   移行済み(condition_lines あり) → 導出ビュー status='fulfilled' で正確に判定
           --     (旧来の「比率1.0の部分検収1件で全量扱い」誤判定を解消)。
           --   未移行 → 従来の acceptance_ratio>=1.0 EXISTS にフォールバック。
           AND NOT (
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = cli.id
               ) THEN EXISTS (
                 SELECT 1 FROM condition_lines cl
                   JOIN condition_line_status_v s ON s.id = cl.id
                  WHERE cl.source_line_item_id = cli.id AND s.status = 'fulfilled'
               )
               ELSE EXISTS (
                 SELECT 1 FROM delivery_line_items dli
                  WHERE dli.capability_line_item_id = cli.id
                    AND COALESCE(dli.acceptance_ratio, 1.0) >= 1.0
               )
             END
           )
           AND (
             (cli.delivery_date - CURRENT_DATE) IN (7, 3, 1)
             OR (cli.delivery_date - CURRENT_DATE) < 0
           )
           AND (
             cli.last_alert_at IS NULL
             OR cli.last_alert_at::date < CURRENT_DATE
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

    // ─── 3. Phase 22.21.66: 満了ステータス自動遷移 ──────────────────
    //   expiration_date < CURRENT_DATE で contract_status が
    //   draft / awaiting_signature / executed のままの行を 'expired' に。
    //   terminated は早期解約のため触らない。
    try {
      const expired = await query(
        `UPDATE contract_capabilities
            SET contract_status = 'expired',
                updated_at = CURRENT_TIMESTAMP
          WHERE expiration_date IS NOT NULL
            AND expiration_date < CURRENT_DATE
            AND contract_status IN ('draft', 'awaiting_signature', 'executed')
          RETURNING id, document_number, contract_title, expiration_date`
      );
      result.expiredTransitions = expired.rowCount || 0;
      if (result.expiredTransitions > 0) {
        console.log(
          `📅 [daily-checks] auto-transitioned ${result.expiredTransitions} contracts to 'expired': ` +
            expired.rows
              .map((r: any) => `${r.document_number}(${r.expiration_date.toISOString().split("T")[0]})`)
              .join(", ")
        );
      }
    } catch (e) {
      console.error("[daily-checks] expired auto-transition failed:", e);
    }

    console.log(
      `📅 [daily-checks] dispatched delivery=${result.deliveryAlerts} contract=${result.contractAlerts} expired=${result.expiredTransitions} (weekday=${isWeekday})`
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
    // Phase 23: capability_line_items + contract_capabilities (record_type='purchase_order') から取る
    const prevRes = await query(
      `SELECT
         cli.id, cli.line_no, cli.item_name, cli.delivery_date,
         cc.backlog_issue_key
       FROM capability_line_items cli
       JOIN contract_capabilities cc
         ON cc.id = cli.capability_id
        AND cc.record_type = 'purchase_order'
       WHERE cli.id = $1`,
      [lineItemId]
    );
    const prev = prevRes.rows[0];
    if (!prev) {
      throw new Error("capability_line_item not found");
    }
    const issueKey = String(prev.backlog_issue_key || "");
    const previousDateStr = prev.delivery_date
      ? new Date(prev.delivery_date).toISOString().slice(0, 10)
      : null;

    // 1. DB 更新 + アラートカウントリセット (Phase 23: capability_line_items)
    await query(
      `UPDATE capability_line_items
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
        // Phase 23: order_items / order_line_items → contract_capabilities / capability_line_items
        const r = await query(
          `SELECT
             cli.id              AS line_item_id,
             cli.capability_id   AS order_item_id,
             cli.line_no,
             cli.item_name,
             cli.spec,
             cli.unit_price,
             cli.quantity,
             cli.amount_ex_tax,
             cli.delivery_date,
             cli.last_alert_at,
             cli.alert_count,
             EXISTS (
               SELECT 1 FROM delivery_line_items dli
                WHERE dli.capability_line_item_id = cli.id
                  AND COALESCE(dli.acceptance_ratio, 1.0) >= 1.0
             ) AS accepted
           FROM capability_line_items cli
           JOIN contract_capabilities cc
             ON cc.id = cli.capability_id
            AND cc.record_type = 'purchase_order'
          WHERE cc.backlog_issue_key = $1
          ORDER BY cli.line_no`,
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

  // ラインIDで明細を引く: 条件明細コード(line_code)/明細行ID/condition_lines.id/
  //   capability ID のいずれかから capability を解決し、その capability_line_items を
  //   items[] (form-context と同じ shape) で返す。課題キー×種別で引けない場合
  //   (record_type 化け・複数PO)でもピンポイントに明細を呼び出せる。
  app.get("/api/line-items/lookup", async (req, res) => {
    try {
      const key = String(req.query.key || "").trim();
      if (!key) return res.status(400).json({ ok: false, error: "key required" });

      let capId: number | null = null;
      let lineCode: string | null = null;

      // 1) 条件明細コード line_code 一致
      let r = await query(
        `SELECT capability_id, line_code FROM condition_lines WHERE line_code = $1 LIMIT 1`,
        [key]
      );
      if (r.rows[0]) {
        capId = Number(r.rows[0].capability_id);
        lineCode = r.rows[0].line_code;
      }
      // 2) 数値なら 明細行ID → condition_lines.id → capability ID の順に解決
      if (capId == null && /^\d+$/.test(key)) {
        const idNum = Number(key);
        r = await query(
          `SELECT capability_id FROM capability_line_items WHERE id = $1 LIMIT 1`,
          [idNum]
        );
        if (r.rows[0]) capId = Number(r.rows[0].capability_id);
        if (capId == null) {
          r = await query(
            `SELECT capability_id, line_code FROM condition_lines WHERE id = $1 LIMIT 1`,
            [idNum]
          );
          if (r.rows[0]) {
            capId = Number(r.rows[0].capability_id);
            lineCode = r.rows[0].line_code;
          }
        }
        if (capId == null) {
          r = await query(
            `SELECT id FROM contract_capabilities WHERE id = $1 LIMIT 1`,
            [idNum]
          );
          if (r.rows[0]) capId = Number(r.rows[0].id);
        }
      }
      if (capId == null) {
        return res
          .status(404)
          .json({ ok: false, error: `ラインID '${key}' に該当する明細が見つかりません` });
      }

      // capability_line_items → items[] (form-context purchase_order と同じ整形)。
      //   rate_pct 列が無い環境向けに 2 段 fallback。
      let lines: any;
      try {
        lines = await query(
          `SELECT line_no, item_name, spec, unit_price, quantity, amount_ex_tax, rate_pct,
                  calc_method, payment_terms, payment_method, payment_date, delivery_date,
                  cycle, term_start, term_end, billing_day,
                  deliverable_ownership, royalty_calc_basis
             FROM capability_line_items WHERE capability_id = $1 ORDER BY line_no ASC`,
          [capId]
        );
      } catch (colErr: any) {
        if (colErr && colErr.code === "42703") {
          lines = await query(
            `SELECT line_no, item_name, spec, unit_price, quantity, amount_ex_tax,
                    calc_method, payment_terms, payment_method, payment_date, delivery_date,
                    cycle, term_start, term_end, billing_day
               FROM capability_line_items WHERE capability_id = $1 ORDER BY line_no ASC`,
            [capId]
          );
        } else {
          throw colErr;
        }
      }
      const items = lines.rows.map((x: any) => ({
        line_no: Number(x.line_no),
        item_name: x.item_name || "",
        spec: x.spec || "",
        unit_price: Number(x.unit_price) || 0,
        quantity: Number(x.quantity) || 0,
        amount_ex_tax: Number(x.amount_ex_tax) || 0,
        rate_pct: x.rate_pct == null ? undefined : Number(x.rate_pct),
        calc_method: x.calc_method || "FIXED",
        payment_terms: x.payment_terms || x.payment_method || "",
        payment_method: x.payment_method || x.payment_terms || "",
        payment_date: x.payment_date || "",
        delivery_date: x.delivery_date || "",
        cycle: x.cycle || "",
        // 継続(SUBSCRIPTION)の課金周期。cycle に MONTHLY/ANNUAL を保存しているため復元。
        subscription_cycle: x.cycle === "MONTHLY" || x.cycle === "ANNUAL" ? x.cycle : undefined,
        term_start: x.term_start || "",
        term_end: x.term_end || "",
        billing_day: x.billing_day ?? "",
        deliverable_ownership: x.deliverable_ownership || "発注者",
        royalty_calc_basis: x.royalty_calc_basis || "",
      }));

      const hdr = await query(
        `SELECT amount_ex_tax, tax_rate FROM contract_capabilities WHERE id = $1`,
        [capId]
      );
      res.json({
        ok: true,
        capability_id: capId,
        line_code: lineCode,
        count: items.length,
        taxRate: hdr.rows[0]?.tax_rate ?? 10,
        grandTotalExTax: Number(hdr.rows[0]?.amount_ex_tax) || 0,
        items,
      });
    } catch (e: any) {
      console.error("GET /api/line-items/lookup failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

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

    // 未完了 line items を全取得 (Phase 23: capability ベース)
    const itemsRes = await query(
      `SELECT cli.id, cli.line_no, cli.item_name, cli.delivery_date
         FROM capability_line_items cli
         JOIN contract_capabilities cc
           ON cc.id = cli.capability_id
          AND cc.record_type = 'purchase_order'
        WHERE cc.backlog_issue_key = $1
          AND NOT EXISTS (
            SELECT 1 FROM delivery_line_items dli
             WHERE dli.capability_line_item_id = cli.id
               AND COALESCE(dli.acceptance_ratio, 1.0) >= 1.0
          )
        ORDER BY cli.line_no`,
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
        `UPDATE capability_line_items
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
        // Phase 23: license_contracts → contract_capabilities (license category)
        await query(
          `UPDATE contract_capabilities
              SET linked_asset_id = $1
            WHERE backlog_issue_key = $2
              AND contract_category = 'license'`,
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

  // 個人情報取得同意フラグ(個人取引先): 参照 / 設定。
  //   ※ search-api(/api/master/vendors)は自動デプロイ無しのため worker 側に置く。
  app.get("/api/master/vendors/:code/pii-consent", async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      const r = await query(
        `SELECT vendor_code, vendor_name, entity_type,
                COALESCE(pii_consent_obtained, FALSE) AS pii_consent_obtained,
                pii_consent_date
           FROM vendors WHERE vendor_code = $1 LIMIT 1`,
        [code]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "vendor not found" });
      const v = r.rows[0];
      const et = String(v.entity_type || "").toLowerCase();
      res.json({
        ok: true,
        vendor_code: v.vendor_code,
        vendor_name: v.vendor_name,
        entity_type: v.entity_type || "",
        is_individual: et === "individual" || et === "個人" || et === "personal",
        pii_consent_obtained: v.pii_consent_obtained === true,
        pii_consent_date: v.pii_consent_date
          ? new Date(v.pii_consent_date).toISOString().slice(0, 10)
          : null,
      });
    } catch (error: any) {
      console.error("/api/master/vendors/:code/pii-consent GET failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.post("/api/master/vendors/:code/pii-consent", express.json(), async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      const b = req.body || {};
      const obtained = b.obtained === false ? false : true; // 既定は取得(true)
      const date = b.date ? String(b.date) : null;
      const r = await query(
        `UPDATE vendors
            SET pii_consent_obtained = $2,
                pii_consent_date = CASE WHEN $2 THEN COALESCE($3::date, pii_consent_date, CURRENT_DATE) ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
          WHERE vendor_code = $1
          RETURNING pii_consent_obtained, pii_consent_date`,
        [code, obtained, date]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "vendor not found" });
      res.json({
        ok: true,
        pii_consent_obtained: r.rows[0].pii_consent_obtained === true,
        pii_consent_date: r.rows[0].pii_consent_date
          ? new Date(r.rows[0].pii_consent_date).toISOString().slice(0, 10)
          : null,
      });
    } catch (error: any) {
      console.error("/api/master/vendors/:code/pii-consent POST failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.post("/api/master/vendors", express.json(), async (req, res) => {
    // Accept a row payload with vendor_code uniqueness enforced.
    // Phase 22.13: vendor_rep + contacts[] を受け取れるよう拡張。
    //   contacts[] = [{ contact_name, contact_department?, title?, email?, phone?, is_primary?, sort_order?, remarks? }]
    //   contacts[] が渡されたら既存を全削除して入れ直し (= replacement semantics)。
    //   primary 担当者の name を vendors.contact_name にミラーして legacy 互換を維持。
    const v = req.body || {};
    // Phase 25.1: 必須項目ガード。詳細取得が 404 になった際にエラーボディを
    //   そのまま編集対象として保存しようとすると vendor_name=NULL で
    //   NOT NULL 制約違反 → 500 になっていた。空なら 400 を返して握る。
    const vcode = String(v.vendor_code || "").trim();
    const vname = String(v.vendor_name || "").trim();
    if (!vcode || !vname) {
      return res
        .status(400)
        .json({ error: "vendor_code と vendor_name は必須です" });
    }
    // Phase 25.1: 数値カラム (capital_yen BIGINT / employee_count INTEGER) は
    //   「1,000,000」等カンマ付き文字列が来ると Number() が NaN になり、
    //   BIGINT/INTEGER への INSERT で "invalid input syntax" → 500 になっていた
    //   (企業情報の資本金・従業員数の登録で発生)。数字以外を除去して安全に
    //   パースし、不正値は null にフォールバックする (search-api 側 normalizeNumber と同等)。
    const toIntOrNull = (x: any): number | null => {
      if (x == null || x === "") return null;
      const n = Number(String(x).replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };
    try {
      // 1) vendor 本体 upsert
      //   Phase 22.13: vendor_rep + contacts[] を受け取れるよう拡張。
      //   Phase 22.21.119: search-api 側 vendor 登録画面と項目を揃える。
      //   追加列: corporate_number / transaction_category / capital_yen /
      //          employee_count / subcontract_act_applicable /
      //          master_updated_at / main_business / payment_terms /
      //          rating / antisocial_check_result
      //   いずれも vendors テーブルには列存在済 (Phase 22.13 / Phase 16 で追加)。
      const upsert = await query(
        `INSERT INTO vendors (vendor_code, vendor_name, trade_name, pen_name, vendor_suffix, entity_type,
          withholding_enabled, aliases, address, phone, email, contact_department, contact_name,
          master_contract_ref, bank_info, bank_name, branch_name, account_type, account_number,
          account_holder_kana, is_invoice_issuer, invoice_registration_number, vendor_rep,
          corporate_number, transaction_category, capital_yen, employee_count,
          subcontract_act_applicable, master_updated_at, main_business, payment_terms,
          rating, antisocial_check_result)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
                 $24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
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
           vendor_rep = EXCLUDED.vendor_rep,
           corporate_number = EXCLUDED.corporate_number,
           transaction_category = EXCLUDED.transaction_category,
           capital_yen = EXCLUDED.capital_yen,
           employee_count = EXCLUDED.employee_count,
           subcontract_act_applicable = EXCLUDED.subcontract_act_applicable,
           master_updated_at = EXCLUDED.master_updated_at,
           main_business = EXCLUDED.main_business,
           payment_terms = EXCLUDED.payment_terms,
           rating = EXCLUDED.rating,
           antisocial_check_result = EXCLUDED.antisocial_check_result
         RETURNING id`,
        [
          // Phase 25.1: vendor_code は受領値のまま使用する。ここで trim すると
          //   既存行の vendor_code に末尾空白が残っている場合に ON CONFLICT
          //   (vendor_code) が一致せず、重複行 INSERT や制約違反 (500) を
          //   引き起こすため。前後空白の吸収は search-api getVendor 側 (TRIM
          //   一致) と既存データの正規化 SQL で対応する。
          v.vendor_code, v.vendor_name, v.trade_name || null, v.pen_name || null,
          v.vendor_suffix || null, v.entity_type || null, v.withholding_enabled || false,
          v.aliases || null, v.address || null, v.phone || null, v.email || null,
          v.contact_department || null, v.contact_name || null, v.master_contract_ref || null,
          v.bank_info || null, v.bank_name || null, v.branch_name || null, v.account_type || null,
          v.account_number || null, v.account_holder_kana || null, v.is_invoice_issuer || false,
          v.invoice_registration_number || null,
          v.vendor_rep || null,
          // Phase 22.21.119 追加列
          v.corporate_number || null,
          v.transaction_category || null,
          toIntOrNull(v.capital_yen),
          toIntOrNull(v.employee_count),
          v.subcontract_act_applicable === true || v.subcontract_act_applicable === "true" || false,
          v.master_updated_at || null,
          v.main_business || null,
          v.payment_terms || null,
          v.rating || null,
          v.antisocial_check_result || null,
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

  // ── 案件へ契約書ファイルを格納 ───────────────────────────────────────────────
  //   法務相談(=案件)で受け取った/作成した契約書の生ファイル(Word/PDF 等)を
  //   Drive にアップロードし、documents 行(ATT-YYYY-NNNNN 採番)として案件に紐付ける。
  //   通常の文書生成(HTML→PDF レンダリング)とは別経路。既存ファイルをそのまま保管し、
  //   後段の Cowork 1 次レビューの入力にする。is_primary=false(正本契約版ではない)。
  const ATTACHMENT_KINDS: Record<string, string> = {
    counterparty_draft: "相手方ドラフト",
    own_draft: "自社ドラフト",
    reference: "参考資料",
  };
  app.post(
    "/api/matters/:id/attachments",
    requirePortalSecret,
    upload.single("file"),
    async (req, res) => {
      try {
        const matterId = Number(req.params.id);
        if (!Number.isFinite(matterId)) {
          return res.status(400).json({ ok: false, error: "matter id が不正です" });
        }
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "ファイルが指定されていません" });
        }
        const kind = String(req.body.docKind || "").trim();
        const templateType = ATTACHMENT_KINDS[kind] ? kind : "reference";
        const title = (req.body.title ? String(req.body.title) : "").trim();
        const createdBy =
          (req.body.createdBy ? String(req.body.createdBy) : "").trim() || null;

        // 案件と代表課題キーを引く(documents.issue_key に使い autolink とも整合)。
        const m = await query(
          `SELECT id, matter_code, primary_issue_key FROM matters WHERE id = $1`,
          [matterId]
        );
        if (!m.rows[0]) {
          return res.status(404).json({ ok: false, error: "案件が見つかりません" });
        }
        const issueKey = String(m.rows[0].primary_issue_key || "").trim();

        // 生ファイルを Drive へアップロード。
        const safeName = String(req.file.originalname).replace(/[\r\n]/g, "_");
        const fileName = `${ATTACHMENT_KINDS[templateType]}_${m.rows[0].matter_code}_${Date.now()}_${safeName}`;
        const stream = Readable.from(req.file.buffer);
        const driveLink = await googleDriveService.uploadFile(
          stream,
          fileName,
          req.file.mimetype
        );
        // 空リンクは保存しない(後段の fileId 抽出/本文抽出が壊れるため)。
        //   uploadFile 側で fileId からの合成を試みるので、ここに来るのは想定外。
        if (!driveLink) {
          return res.status(502).json({
            ok: false,
            error: "Drive へのアップロードに失敗しました (リンク未取得)",
          });
        }

        // ATT-YYYY-NNNNN 採番(matter_code と同じ document_sequences を使用)。
        const year = new Date().getFullYear();
        const seq = await query(
          `INSERT INTO document_sequences (kind, year, current_value) VALUES ('attachment', $1, 1)
             ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
           RETURNING current_value`,
          [year]
        );
        const docNumber = `ATT-${year}-${String(
          Number(seq.rows[0].current_value)
        ).padStart(5, "0")}`;

        // documents 行として登録。matter_id は明示設定(autolink トリガは NULL 時のみ発火)。
        const ins = await query(
          `INSERT INTO documents
             (document_number, issue_key, template_type, form_data, drive_link,
              matter_id, is_primary, lifecycle_status, contract_title, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,FALSE,'final',$7,$8)
           RETURNING id, document_number, template_type, drive_link, matter_id, contract_title, created_at`,
          [
            docNumber,
            issueKey,
            templateType,
            JSON.stringify({
              title,
              original_file_name: req.file.originalname,
              source_mime_type: req.file.mimetype,
              kind: templateType,
            }),
            driveLink,
            matterId,
            title || null,
            createdBy,
          ]
        );
        await query(`UPDATE matters SET updated_at = now() WHERE id = $1`, [matterId]);
        res.json({ ok: true, document: ins.rows[0] });
      } catch (error) {
        console.error("[matters] attachment upload failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  app.post("/api/master/staff", express.json(), async (req, res) => {
    // Phase 22.21.120: 編集時は body.id を尊重して UPDATE。新規時は slack_user_id
    //   での upsert。slack_user_id が空のまま新規登録すると UNIQUE/NOT NULL で
    //   エラーになるケースを解消する (UI 入力が任意なため空文字を許容)。
    const {
      id,
      slack_user_id,
      staff_name,
      email,
      phone,
      department,
      department_code,
    } = req.body;
    try {
      // バリデーション
      if (!staff_name || String(staff_name).trim() === "") {
        return res.status(400).json({ error: "氏名 (staff_name) は必須です" });
      }
      // 編集モード: body.id があり、その id が staff 表に存在する → UPDATE
      if (id != null && Number.isFinite(Number(id))) {
        const upd = await query(
          `UPDATE staff
              SET staff_name      = $1,
                  email           = $2,
                  phone           = $3,
                  department      = $4,
                  department_code = $5,
                  slack_user_id   = COALESCE(NULLIF($6, ''), slack_user_id)
            WHERE id = $7
          RETURNING id, slack_user_id`,
          [
            staff_name,
            email || null,
            phone || null,
            department || null,
            department_code || null,
            slack_user_id || null,
            Number(id),
          ]
        );
        if (upd.rows.length === 0) {
          return res
            .status(404)
            .json({ error: `staff id=${id} が見つかりません` });
        }
        return res.json({ success: true, id: upd.rows[0].id, mode: "update" });
      }
      // 新規モード: slack_user_id が空ならプレースホルダで自動採番
      //   (UNIQUE 衝突防止のため tmp prefix + timestamp)
      const finalSlackId =
        slack_user_id && String(slack_user_id).trim().length > 0
          ? String(slack_user_id).trim()
          : `LOCAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const r = await query(
        `INSERT INTO staff (slack_user_id, staff_name, email, phone, department, department_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slack_user_id) DO UPDATE SET
           staff_name      = EXCLUDED.staff_name,
           email           = EXCLUDED.email,
           phone           = EXCLUDED.phone,
           department      = EXCLUDED.department,
           department_code = EXCLUDED.department_code
         RETURNING id`,
        [
          finalSlackId,
          staff_name,
          email || null,
          phone || null,
          department || null,
          department_code || null,
        ]
      );
      res.json({ success: true, id: r.rows[0].id, mode: "insert" });
    } catch (error: any) {
      console.error("/api/master/staff POST failed:", error);
      res.status(500).json({
        error: String(error?.message || error),
        code: error?.code,
        constraint: error?.constraint,
      });
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

  /**
   * Phase 22.21.51: 文書番号の prefix 決定ロジック。
   *
   *   contract_category (UI で必ず選ばれる: service / license / publication)
   *   + record_type     (master_contract / individual_contract / standalone_contract /
   *                      legacy license_condition)
   *   から、worker が持つ typeCodes (db.ts) に登録済みの template type 名を引いて
   *   prefix を 1 段間接的に決める。これで「カテゴリ = ライセンス なのに SER」
   *   みたいなズレが起きない。
   *
   *   service + 基本 → service_master → SVC
   *   service + 個別/単独 → outsourcing → OUT
   *   license + 基本 → license_master → LIC
   *   license + 個別/単独 → individual_license_terms → ILT
   *   publication + 基本 → publication_master → PUB (fallback)
   *   publication + 個別/単独 → publication_individual → PUB (fallback)
   */
  function deriveTemplateTypeForNumbering(
    category: string,
    recordType: string
  ): string {
    const cat = String(category || "").toLowerCase();
    const isIndividualLike =
      recordType === "individual_contract" ||
      recordType === "standalone_contract" ||
      recordType === "license_condition";

    if (cat === "license") {
      return isIndividualLike ? "individual_license_terms" : "license_master";
    }
    if (cat === "publication") {
      return isIndividualLike ? "publication_individual" : "publication_master";
    }
    // service or unknown
    return isIndividualLike ? "outsourcing" : "service_master";
  }

  /**
   * Phase 22.21.62: 文書番号を archive 全体で `from` → `to` にリネーム。
   *
   * 単純な完全一致だけでなく、Phase 22.10 のリビジョン suffix (`_NNN`) 行も
   * 一緒に追従させる。例えば from = "ARC-PO-2026-0021" / to = "ARC-SVC-2026-0008"
   * のとき:
   *   - documents.document_number = "ARC-PO-2026-0021"             → "ARC-SVC-2026-0008"
   *   - documents.document_number = "ARC-PO-2026-0021_001..._005"  → "ARC-SVC-2026-0008_001..._005"
   *   - documents.base_document_number = "ARC-PO-2026-0021"        → "ARC-SVC-2026-0008"
   *   - documents.superseded_by (完全一致 + suffix 付き) も同様
   *   - external_assets.asset_number (完全一致 + suffix 付き)      も同様
   *
   * 23505 (UNIQUE 違反) は呼び出し側で catch して "conflict" として扱う。
   */
  async function renameArchiveDocumentNumber(
    from: string,
    to: string
  ): Promise<{
    documents_updated: number;
    documents_revisions_updated: number;
    documents_base_updated: number;
    documents_superseded_updated: number;
    assets_updated: number;
    assets_revisions_updated: number;
    drive_files_renamed: number;
  }> {
    const fromUnderscore = from + "_"; // e.g. "ARC-PO-2026-0021_"
    const fromUnderscoreLen = fromUnderscore.length;

    // Phase 22.21.66: DB rename 前に Drive ファイル名 rename 対象を取得しておく。
    //   documents.drive_link を持つ行 (base + revision suffix 付き 両方) について、
    //   新しい document_number で Drive 上のファイル名も追従させる。
    //   DB rename と Drive rename は別トランザクションなので、片方失敗しても
    //   他方は反映され続ける ("最終的整合性" を許容)。
    //   best-effort: Drive API 失敗は warn ログだけで継続。
    let driveTargets: Array<{ oldDocNumber: string; newDocNumber: string; driveLink: string; vendorName: string | null }> = [];
    try {
      const driveFetch = await query(
        `SELECT document_number, drive_link, vendor_name_snapshot
           FROM documents
          WHERE drive_link IS NOT NULL AND drive_link <> ''
            AND (document_number = $1 OR LEFT(document_number, $2::int) = $3)`,
        [from, fromUnderscoreLen, fromUnderscore]
      );
      driveTargets = driveFetch.rows.map((r: any) => {
        const oldNo = String(r.document_number || "");
        // base / revision の判定: from と完全一致なら base、それ以外は suffix を保つ
        const newNo =
          oldNo === from
            ? to
            : to + oldNo.substring(fromUnderscoreLen - 1); // -1: '_' の前から
        return {
          oldDocNumber: oldNo,
          newDocNumber: newNo,
          driveLink: r.drive_link,
          vendorName: r.vendor_name_snapshot || null,
        };
      });
    } catch (err: any) {
      console.warn("[renameArchive] failed to fetch drive targets:", err?.message || err);
    }

    // 1. 完全一致 (base row)
    const r1 = await query(
      `UPDATE documents SET document_number = $1 WHERE document_number = $2`,
      [to, from]
    );
    // 2. リビジョン suffix 行: "from_NNN" → "to_NNN"
    const r2 = await query(
      `UPDATE documents
          SET document_number = $1 || SUBSTRING(document_number FROM $2::int)
        WHERE LEFT(document_number, $3::int) = $4`,
      [to, fromUnderscoreLen, fromUnderscoreLen, fromUnderscore]
    );
    // 3. base_document_number 参照
    const r3 = await query(
      `UPDATE documents SET base_document_number = $1 WHERE base_document_number = $2`,
      [to, from]
    );
    // 4. superseded_by 参照 (完全一致)
    const r4 = await query(
      `UPDATE documents SET superseded_by = $1 WHERE superseded_by = $2`,
      [to, from]
    );
    // 5. superseded_by 参照 (suffix 付き)
    const r5 = await query(
      `UPDATE documents
          SET superseded_by = $1 || SUBSTRING(superseded_by FROM $2::int)
        WHERE LEFT(superseded_by, $3::int) = $4`,
      [to, fromUnderscoreLen, fromUnderscoreLen, fromUnderscore]
    );

    // 6. external_assets — table が無い環境はスキップ
    let assetsBase = 0;
    let assetsRev = 0;
    try {
      const a1 = await query(
        `UPDATE external_assets SET asset_number = $1 WHERE asset_number = $2`,
        [to, from]
      );
      assetsBase = a1.rowCount || 0;
      const a2 = await query(
        `UPDATE external_assets
            SET asset_number = $1 || SUBSTRING(asset_number FROM $2::int)
          WHERE LEFT(asset_number, $3::int) = $4`,
        [to, fromUnderscoreLen, fromUnderscoreLen, fromUnderscore]
      );
      assetsRev = a2.rowCount || 0;
    } catch (err: any) {
      if (err?.code !== "42P01") throw err;
    }

    // Phase 22.21.66: DB rename 完了後、Drive ファイル名を非同期に追従させる。
    //   各ターゲットを順次 (Promise.all だとレートリミットに当たる可能性あり) 処理。
    //   成功件数を返却し、失敗は warn ログのみ。
    let driveRenamed = 0;
    for (const t of driveTargets) {
      const vendorPart = t.vendorName ? `_${sanitizeForFilename(t.vendorName)}` : "";
      const newFileName = `${t.newDocNumber}${vendorPart}.html`;
      try {
        const result = await googleDriveService.renameFile(t.driveLink, newFileName);
        if (result) {
          driveRenamed++;
          console.log(`[renameArchive] Drive renamed: ${t.oldDocNumber} → ${t.newDocNumber}`);
        }
      } catch (err: any) {
        console.warn(
          `[renameArchive] Drive rename failed for ${t.oldDocNumber}:`,
          err?.message || err
        );
      }
    }

    return {
      documents_updated: r1.rowCount || 0,
      documents_revisions_updated: r2.rowCount || 0,
      documents_base_updated: r3.rowCount || 0,
      documents_superseded_updated: (r4.rowCount || 0) + (r5.rowCount || 0),
      assets_updated: assetsBase,
      assets_revisions_updated: assetsRev,
      drive_files_renamed: driveRenamed,
    };
  }

  // Phase 22.21.46 / 22.21.49 / 22.21.51 / 22.21.52: 文書番号の自動採番。
  //   - regenerate=true → input 値を無視して強制的に新規発番
  //   - input が空文字 / null / undefined / 空白だけ → 新規発番
  //   - それ以外 → input をそのまま返す
  //
  //   prefix は contract_category + record_type から derive (Phase 22.21.51)。
  //
  //   Phase 22.21.52: ライセンス系 (license + individual/standalone/legacy) かつ
  //   ledger_code 紐付けがある場合は、原作ベースの新フォーマットを使う:
  //     LIC-{ledger_code}-ILT-{NNNN}
  //     例: LIC-LO-2026-0001-ILT-0001
  //   ledger 紐付けがない場合は従来通り ARC-ILT-YYYY-NNNN にフォールバック。
  async function ensureDocumentNumber(
    input: any,
    contractType: string,
    contractCategory: string,
    recordType: string,
    ledgerCode: string | null | undefined,
    regenerate: boolean = false
  ): Promise<string> {
    const numberingType = deriveTemplateTypeForNumbering(contractCategory, recordType);

    // ledger ベース ILT 採番の判定。
    //   - カテゴリ license
    //   - record_type が individual_contract / standalone_contract /
    //     license_condition (legacy)
    //   - ledger_code が紐付いている
    const ledger = String(ledgerCode || "").trim();
    const isIndividualLike =
      recordType === "individual_contract" ||
      recordType === "standalone_contract" ||
      recordType === "license_condition";
    const useLedgerBasedIlt =
      String(contractCategory || "").toLowerCase() === "license" &&
      isIndividualLike &&
      !!ledger;

    if (regenerate) {
      if (useLedgerBasedIlt) {
        console.log(
          `[contracts] regenerate=true → ledger-based ILT (ledger=${ledger})`
        );
        return await getNewIltNumberForLedger(ledger);
      }
      console.log(
        `[contracts] regenerate=true → fresh number (category=${contractCategory}, record_type=${recordType}, type=${numberingType})`
      );
      return await getNewDocumentNumber(numberingType);
    }
    const v = String(input || "").trim();
    if (v) return v;
    if (useLedgerBasedIlt) {
      console.log(
        `[contracts] document_number empty → ledger-based ILT (ledger=${ledger})`
      );
      return await getNewIltNumberForLedger(ledger);
    }
    console.log(
      `[contracts] document_number empty → fresh number (category=${contractCategory}, record_type=${recordType}, type=${numberingType})`
    );
    return await getNewDocumentNumber(numberingType);
  }

  /**
   * Phase 22.21.91: 契約マスタの金銭条件 (capability_financial_conditions) を
   *   配列で受け取って upsert する。license_financial_conditions の
   *   upsert ロジック (server.ts /api/imports/license-contract) と同等。
   *
   *   - raw が undefined → 何もしない (既存条件を保持)
   *   - raw が null or [] → 全件削除
   *   - それ以外 → 配列内の condition_no で upsert、含まれていない condition_no
   *               を削除 (= ユーザーが行を消したら DB からも消える)
   */
  async function upsertCapabilityFinancialConditions(
    capabilityId: number,
    raw: any
  ): Promise<void> {
    if (raw === undefined) return;
    const conditions: Array<any> = Array.isArray(raw) ? raw : [];
    const keepNos = conditions
      .map((c) => Number(c?.condition_no))
      .filter((n) => Number.isFinite(n) && n >= 1);
    try {
      if (keepNos.length === 0) {
        await query(
          `DELETE FROM capability_financial_conditions WHERE capability_id = $1`,
          [capabilityId]
        );
      } else {
        await query(
          `DELETE FROM capability_financial_conditions
            WHERE capability_id = $1
              AND condition_no NOT IN (${keepNos
                .map((_, i) => `$${i + 2}`)
                .join(",")})`,
          [capabilityId, ...keepNos]
        );
      }
    } catch (delErr) {
      console.warn(
        "[capability_financial_conditions] prune failed:",
        delErr
      );
    }
    for (const c of conditions) {
      const condNo = Number(c?.condition_no);
      if (!Number.isFinite(condNo) || condNo < 1) continue;
      // テリトリー / 言語 を別項目で保存し、表示用の合成ラベルを再計算する。
      //   2項目が無い旧データはクライアントから来た region_language_label をそのまま使う。
      const regionTerritory =
        c.region_territory != null && String(c.region_territory).trim() !== ""
          ? String(c.region_territory).trim()
          : null;
      const regionLanguage =
        c.region_language != null && String(c.region_language).trim() !== ""
          ? String(c.region_language).trim()
          : null;
      const regionLabel =
        [regionTerritory, regionLanguage].filter(Boolean).join("・") ||
        c.region_language_label ||
        null;
      await query(
        `INSERT INTO capability_financial_conditions (
           capability_id, condition_no,
           region_language_label, calc_method, rate_pct,
           base_price_label, calc_period, calc_period_kind, calc_period_close_month,
           currency, formula_text, payment_terms, mg_amount, ag_amount,
           condition_name, calc_type, fixed_kind, subscription_cycle, unit_amount, guarantee_type,
           region_territory, region_language, applies_scope,
           copied_from_condition_id, work_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, CURRENT_TIMESTAMP)`,
        [
          capabilityId,
          condNo,
          regionLabel,
          c.calc_method || null,
          c.rate_pct != null && c.rate_pct !== "" ? Number(c.rate_pct) : null,
          c.base_price_label || null,
          c.calc_period || null,
          c.calc_period_kind || null,
          c.calc_period_close_month != null && c.calc_period_close_month !== ""
            ? Number(c.calc_period_close_month)
            : null,
          c.currency || "JPY",
          c.formula_text || null,
          c.payment_terms || null,
          c.mg_amount != null && c.mg_amount !== "" ? Number(c.mg_amount) : 0,
          // Phase 22.21.95: AG (前払い保証 = 累積消化)
          c.ag_amount != null && c.ag_amount !== "" ? Number(c.ag_amount) : 0,
          // 0045: 金銭条件の柔軟化 (名称 / 構造化計算式タイプ / 保証種別)
          c.condition_name || null,
          c.calc_type || null,
          c.fixed_kind || null,
          c.subscription_cycle || null,
          c.unit_amount != null && c.unit_amount !== "" ? Number(c.unit_amount) : null,
          c.guarantee_type || null,
          regionTerritory,
          regionLanguage,
          c.applies_scope || null,
          // O4: コピー痕跡(コピー元 cfc.id)。通常入力は NULL。
          c.copied_from_condition_id != null && c.copied_from_condition_id !== ""
            ? Number(c.copied_from_condition_id)
            : null,
          // 明細(条件)ごとの作品。未指定は NULL(文書 work へフォールバック)。
          c.work_id != null && c.work_id !== "" ? Number(c.work_id) : null,
        ]
      );
    }
    // Phase C-5: 旧金銭条件(capability_financial_conditions)書き込み後、
    //   condition_lines にも非致命で二重書き込み(冪等)。
    await safeSync("CL(capability)", () =>
      syncConditionLinesForCapability({ query }, capabilityId)
    );
  }

  // 出版利用許諾条件書(pub_license_terms)の印税条件配列を form_data から組み立てる。
  //   紙媒体=condition_no 1(常に), 電子書籍=2(「許諾する」時のみ)。
  //   condition_name も明示して条件明細の件名(subject フォールバック)を確実にする。
  //   生成本経路と、後段の自己修復ブロックの両方から呼ぶ(単一の真実)。
  function buildPubLicenseConditions(formData: any): any[] {
    const toPct = (v: any) => {
      const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const payDay = formData["許諾者種別"] === "法人" ? "末日" : "20日";
    const conds: any[] = [
      {
        // 紙媒体出版 (常に独占的に許諾)
        condition_no: 1,
        region_language_label: "紙書籍出版",
        condition_name: "紙書籍出版",
        calc_method: "ROYALTY",
        calc_type: "BASE_QTY_RATE",
        guarantee_type: "NONE",
        rate_pct: toPct(formData["紙書籍印税率"]),
        base_price_label: "税抜定価",
        formula_text: formData["紙媒体計算式"] || "税抜定価 × 印税対象部数 × 印税率",
        calc_period: formData["紙媒体印税対象部数区分"] || "",
        currency: "JPY",
        payment_terms: `都度払い（刊行日を含む月の翌々月${payDay}払い）`,
        mg_amount: 0,
        ag_amount: 0,
      },
    ];
    if (formData["電子書籍配信許諾有無"] === "許諾する") {
      conds.push({
        condition_no: 2,
        region_language_label: "電子書籍配信",
        condition_name: "電子書籍配信",
        calc_method: "ROYALTY",
        calc_type: "BASE_QTY_RATE",
        guarantee_type: "NONE",
        rate_pct: toPct(formData["電子書籍印税率"]),
        base_price_label: "被許諾者受領額",
        formula_text: formData["電子書籍計算式"] || "被許諾者の受領額 × 料率",
        calc_period: "毎年4月1日〜翌3月末日",
        currency: "JPY",
        payment_terms: `年1回・6月${payDay}払い`,
        mg_amount: 0,
        ag_amount: 0,
      });
    }
    // 翻訳版・海外版は二次的著作物として本条件書の対象外(別途)。海外はテリトリー(許諾地域)で制御。
    return conds;
  }

  /**
   * Stage 2(文書ファースト 原作マテリアル紐付けプラン): 作品連動 ON の文書保存で、
   *   各利用許諾条件 → 原作マテリアル を結線し、対象作品(own)の構成へ組み込む共通ヘルパ。
   *   個別利用許諾条件書 / 発注書(受注者帰属の利用許諾条件) など、
   *   capability_financial_conditions → condition_lines 経路を持つ文書で共用する。
   *
   *   - マテリアル: conditionMaterialCodes に既存コードがあれば原作配下の work_materials を再利用、
   *     無ければ件名で新規作成({原作code}-NNN 採番。Stage 0 で台帳とコード同期済)。
   *   - condition_line(source_condition_id 経由で condition_no と対応)に
   *     source_work_id(原作)/source_material_id/work_id(対象作品)を結線。
   *   - 対象作品があれば work_components + work_component_lines を ensure(N:N)。
   *   - 再発行の二重生成防止: 既にこの明細へ紐付く原作素材があれば再利用(冪等)。
   *   設計: docs/design/document-first-material-linkage-plan.md
   */
  // 1本の condition_line を 原作マテリアルへ結線し、対象作品の構成へ組み込む(共通下請け)。
  //   - pickedCode 指定=既存 work_material(原作配下)を再利用。
  //   - 未指定でも、既にこの明細へ紐付く原作素材があれば再利用(再発行の二重生成防止)。
  //   - どちらも無ければ name で新規作成({原作code}-NNN 採番、rights/acquisition/royalty を指定)。
  //   - 対象作品があれば work_components + work_component_lines を ensure(N:N)。
  async function ensureMaterialAndCompose(o: {
    lineId: number;
    origWorkId: number | null;
    ownWorkId: number | null;
    ledgerCode: string | null;
    name: string;
    rightsType: string;
    acquisitionType: string;
    isRoyaltyBearing: boolean;
    pickedCode?: string;
  }): Promise<boolean> {
    const { lineId, ownWorkId, ledgerCode } = o;
    const origWorkId = o.origWorkId ?? null;
    let materialId: number | null = null;
    // material_code が指す実際の原作(work)。クロス原作対応の正準＝この値で source_work_id を束ねる。
    let effSrcWorkId: number | null = null;
    const pickedCode = String(o.pickedCode || "").trim();
    if (pickedCode) {
      // material_code はグローバル UNIQUE(migrations/0004)。所属 work を一意解決し、
      //   単一 origWork に縛らない(1発注書で複数の別原作の素材に紐付け可能)。
      const mr = await query(
        `SELECT id, work_id FROM work_materials WHERE material_code = $1 LIMIT 1`,
        [pickedCode]
      );
      if (mr.rows[0]) {
        materialId = Number(mr.rows[0].id);
        effSrcWorkId = mr.rows[0].work_id ? Number(mr.rows[0].work_id) : null;
      }
    }
    if (!materialId && origWorkId) {
      // 行に既存の素材紐付けがあり、それが origWork 配下なら再利用(フォールバック)。
      const cur = await query(
        `SELECT source_material_id FROM condition_lines WHERE id = $1`,
        [lineId]
      );
      const exMat = cur.rows[0]?.source_material_id
        ? Number(cur.rows[0].source_material_id)
        : null;
      if (exMat) {
        const chk = await query(
          `SELECT id FROM work_materials WHERE id = $1 AND work_id = $2 LIMIT 1`,
          [exMat, origWorkId]
        );
        if (chk.rows[0]) {
          materialId = exMat;
          effSrcWorkId = origWorkId;
        }
      }
    }
    if (!materialId && origWorkId && ledgerCode) {
      // 軸/上書きコードが解決できないときだけ origWork 配下に件名で新規作成。
      const noRes = await query(
        `SELECT COALESCE(MAX(material_no), 0) + 1 AS n FROM work_materials WHERE work_id = $1`,
        [origWorkId]
      );
      const nextNo = Number(noRes.rows[0]?.n || 1);
      const matCode = `${ledgerCode}-${String(nextNo).padStart(3, "0")}`;
      // Category(2): 自動生成素材はジャンル不明 → 'other' カテゴリへ紐付け。
      const autoCategoryId = await ensureMaterialCategory(origWorkId, "other");
      const ins = await query(
        `INSERT INTO work_materials (
           work_id, material_no, material_code, material_name,
           material_type, rights_type, is_royalty_bearing, acquisition_type, material_role, category_id
         ) VALUES ($1, $2, $3, $4, 'other', $5, $6, $7, 'sub_component', $8)
         RETURNING id`,
        [origWorkId, nextNo, matCode, o.name, o.rightsType, o.isRoyaltyBearing, o.acquisitionType, autoCategoryId]
      );
      materialId = ins.rows[0]?.id ? Number(ins.rows[0].id) : null;
      effSrcWorkId = origWorkId;
      // マテリアル一本化(0089/0090): work_materials が唯一の正準。台帳(materials)への逆ミラーは廃止。
    }
    if (!materialId) return false;
    if (effSrcWorkId == null) effSrcWorkId = origWorkId;

    // 引用した既存マテリアルがロイヤリティ対象セルを得たら、材料フラグを true へ昇格。
    //   (買切由来Bが利用許諾セルを持つ等)。昇格のみ・降格はしない
    //   (他作品でロイヤリティを持つ材料のフラグを巻き戻さないため)。
    if (o.isRoyaltyBearing) {
      await query(
        `UPDATE work_materials
            SET is_royalty_bearing = TRUE, updated_at = now()
          WHERE id = $1 AND COALESCE(is_royalty_bearing, FALSE) = FALSE`,
        [materialId]
      );
    }

    await query(
      `UPDATE condition_lines
          SET source_work_id = COALESCE($2, source_work_id),
              source_material_id = $3,
              work_id = COALESCE($4, work_id),
              updated_at = now()
        WHERE id = $1`,
      [lineId, effSrcWorkId, materialId, ownWorkId]
    );

    if (ownWorkId) {
      await query(
        `INSERT INTO work_components (work_id, component_no, component_kind, material_id)
           SELECT $1,
                  COALESCE((SELECT MAX(component_no) + 1 FROM work_components WHERE work_id = $1), 1),
                  'material', $2
         ON CONFLICT (work_id, material_id) WHERE material_id IS NOT NULL DO NOTHING`,
        [ownWorkId, materialId]
      );
      const comp = await query(
        `SELECT id FROM work_components WHERE work_id = $1 AND material_id = $2 LIMIT 1`,
        [ownWorkId, materialId]
      );
      const compId = comp.rows[0]?.id ? Number(comp.rows[0].id) : null;
      if (compId) {
        await query(
          `INSERT INTO work_component_lines (component_id, condition_line_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [compId, lineId]
        );
      }
    }
    return true;
  }

  async function linkWorkMaterialsForCapability(opts: {
    capabilityId: number;
    ledgerCode: string | null | undefined;
    ownWorkId: number | null;
    conditionMaterialCodes: Record<string, string>;
    financialConditions: any[];
    defaultMaterialCode?: string | null;
  }): Promise<number> {
    const { capabilityId, ledgerCode, ownWorkId, conditionMaterialCodes, financialConditions } = opts;
    if (!capabilityId || !Array.isArray(financialConditions)) return 0;
    const cmCodesAll = conditionMaterialCodes || {};
    const hasPerCondCodes = Object.values(cmCodesAll).some((v) =>
      String(v || "").trim()
    );
    // 単一原作(ledgerCode)が無くても、条件ごとの material_code 指定があれば続行(クロス原作)。
    //   各 material_code は ensureMaterialAndCompose がグローバル解決して実際の原作へ紐付ける。
    if (!ledgerCode && !hasPerCondCodes) return 0;
    let linked = 0;

    // 軸マテリアル/自動生成フォールバックは ledgerCode(単一原作)がある時だけ解決する。
    //   軸 = 呼び出し側指定(素材番号) → 無ければ原作本体(is_default)。行ごとの上書き
    //   (condition_material_codes)があればそれを優先。
    let origWorkId: number | null = null;
    let anchorCode = "";
    if (ledgerCode) {
      const srcRes = await query(
        `SELECT id FROM works WHERE work_code = $1 AND kind = 'licensed_in' LIMIT 1`,
        [ledgerCode]
      );
      origWorkId = srcRes.rows[0]?.id ? Number(srcRes.rows[0].id) : null;
      anchorCode = String(opts.defaultMaterialCode || "").trim();
      if (!anchorCode && origWorkId) {
        const dm = await query(
          `SELECT material_code FROM work_materials
            WHERE work_id = $1 AND is_default = TRUE
            ORDER BY material_no NULLS LAST, id LIMIT 1`,
          [origWorkId]
        );
        anchorCode = dm.rows[0]?.material_code || "";
      }
    }

    // この文書の各金銭条件 → 生成された condition_line を condition_no で対応付け。
    const clRes = await query(
      `SELECT cl.id AS line_id, cfc.condition_no
         FROM capability_financial_conditions cfc
         JOIN condition_lines cl ON cl.source_condition_id = cfc.id
        WHERE cfc.capability_id = $1`,
      [capabilityId]
    );
    const lineByNo = new Map<number, number>();
    for (const r of clRes.rows) lineByNo.set(Number(r.condition_no), Number(r.line_id));

    const cmCodes = conditionMaterialCodes || {};
    for (const c of financialConditions) {
      const condNo = Number(c?.condition_no);
      if (!Number.isFinite(condNo) || condNo < 1) continue;
      const lineId = lineByNo.get(condNo);
      if (!lineId) continue;
      // 行で材料を上書き指定が無ければ軸マテリアルへ束ねる(1材料:N条件)。
      const pickedCode = String(cmCodes[String(condNo)] || "").trim() || anchorCode;
      // 軸も上書きも無い(原作に本体素材が無い等)ときだけ、件名で新規作成にフォールバック。
      const name =
        (c.condition_name && String(c.condition_name).trim()) || `条件${condNo}`;
      // 利用許諾=相手方帰属。FIXED=買切固定額=ロイヤリティ計算なし。それ以外は royalty 対象。
      // 作品1:文書N:明細N — 条件ごとに作品が指定されていればそれを優先し、
      //   未指定なら文書単位の ownWorkId にフォールバック。
      const condWorkId =
        c?.work_id != null && String(c.work_id).trim() !== "" && Number.isFinite(Number(c.work_id))
          ? Number(c.work_id)
          : ownWorkId;
      const ok = await ensureMaterialAndCompose({
        lineId,
        origWorkId,
        ownWorkId: condWorkId,
        ledgerCode: ledgerCode ?? null,
        name,
        rightsType: "license",
        acquisitionType: "license",
        isRoyaltyBearing: c.calc_type !== "FIXED",
        pickedCode,
      });
      if (ok) linked++;
    }
    return linked;
  }

  // 発注書 買切(発注者帰属=当社帰属)の業務委託明細 → 当社保有マテリアルとして作品構成へ。
  //   買切も「業務委託の条件明細(payment_scheme=lump_sum 等)」を持つので、それを原作マテリアルへ
  //   結線する(ロイヤリティ計算は走らないが構成には入る)。line_item 由来の condition_line を
  //   deliverable_ownership='発注者' で絞り込み、rights_type=owned / acquisition_type=buyout_commission
  //   の work_material(件名=item_name)を作って結線する。
  async function linkBuyoutMaterialsForCapability(opts: {
    capabilityId: number;
    ledgerCode: string | null | undefined;
    ownWorkId: number | null;
  }): Promise<number> {
    const { capabilityId, ledgerCode, ownWorkId } = opts;
    if (!capabilityId || !ledgerCode) return 0;
    let linked = 0;
    const srcRes = await query(
      `SELECT id FROM works WHERE work_code = $1 AND kind = 'licensed_in' LIMIT 1`,
      [ledgerCode]
    );
    const origWorkId = srcRes.rows[0]?.id ? Number(srcRes.rows[0].id) : null;
    if (!origWorkId) return 0;

    // 買切(発注者帰属)の業務委託明細から生成された condition_line を引く。
    const clRes = await query(
      `SELECT cl.id AS line_id, cli.item_name
         FROM capability_line_items cli
         JOIN condition_lines cl ON cl.source_line_item_id = cli.id
        WHERE cli.capability_id = $1
          AND COALESCE(cli.deliverable_ownership, '発注者') = '発注者'`,
      [capabilityId]
    );
    for (const r of clRes.rows) {
      const lineId = Number(r.line_id);
      if (!Number.isFinite(lineId)) continue;
      const name = (r.item_name && String(r.item_name).trim()) || `成果物#${lineId}`;
      const ok = await ensureMaterialAndCompose({
        lineId,
        origWorkId,
        ownWorkId,
        ledgerCode,
        name,
        rightsType: "owned",
        acquisitionType: "buyout_commission",
        isRoyaltyBearing: false,
      });
      if (ok) linked++;
    }
    return linked;
  }

  // ── Stage C-2/C-3: 個別利用許諾 v3(マトリクス）条件の登録 ──────────────────
  //   v3 フォーム(formData.v3_conds / v3_lcs)→ 既存スキーマへ永続化する。
  //   - 取引形態(列) を capability_financial_conditions の1条件(condition_no=列index+1)へ。
  //     rate_pct = 適用料率(加算型=各LCの当該料率Σ / 非加算型=実効料率(fixedRate))。
  //   - v3 固有メタ(製造者/販売者/最大地域/最大言語/加算型/個数)は migration 0086 で
  //     追加した6列へ condition_no で UPDATE(冪等・best-effort)。
  //   - condition_line は upsert 内の syncConditionLinesForCapability が生成。
  //     【非加算型】= 本体マテリアル(is_default)へアンカーした1本(実効料率)。
  //     【加算型・C-3】= 取引形態の1本を **LC別セル(N本)へ分解**。各セル=
  //       source_material_id=該当LCの原作マテリアル × source_condition_id=取引形態 ×
  //       rate_pct=そのLCのセル料率。mg/ag は代表行(先頭LC)のみ保持し他行は0
  //       (下流の合算で二重計上しないため)。Σ(セル)=cfc.rate_pct を不変条件として維持。
  //   - 下流(calc_license.getRoyaltyConditionEconomics)は source_condition_id 配下の
  //     rate_pct を **合算** して読むため、加算型でも適用料率=Σ が透過供給される。
  //   設計: docs/design/individual-license-terms-v3-migration-plan.md §3.1 / §5 C-2,C-3
  async function registerV3MatrixConditions(opts: {
    capabilityId: number;
    ledgerCode: string | null | undefined;
    ownWorkId: number | null;
    conds: any[];
    lcs: any[];
    anchorMaterialCode?: string | null;
    conditionMaterialCodes?: Record<string, string>;
  }): Promise<number> {
    const { capabilityId, ledgerCode, ownWorkId } = opts;
    const conds = Array.isArray(opts.conds) ? opts.conds : [];
    const lcs = Array.isArray(opts.lcs) ? opts.lcs : [];
    if (!capabilityId || conds.length === 0) return 0;

    const toNum = (v: any): number | null => {
      if (v == null || String(v).trim() === "") return null;
      const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    // 適用料率: 加算型=各LCの当該取引形態料率を合算(Σ)/ 非加算型=実効料率(fixedRate)。
    //   個別利用許諾 v3 テンプレ context ビルダー(computeAppliedRate)と同一ロジック。
    const appliedRate = (c: any): number | null => {
      if (!c?.addon) return toNum(c?.fixedRate);
      const key = String(c?.id ?? "");
      let sum = 0;
      let any = false;
      for (const l of lcs) {
        const r = toNum(l?.rates?.[key]);
        if (r != null) {
          sum += r;
          any = true;
        }
      }
      return any ? sum : null;
    };

    // v3_conds(取引形態) → financial_conditions 互換配列(既存 upsert 経路を流用)。
    const mapped = conds.map((c: any, i: number) => {
      const rate = appliedRate(c);
      return {
        condition_no: i + 1,
        condition_name: (c?.name && String(c.name).trim()) || `条件${i + 1}`,
        // 料率があれば royalty 計算対象(ROYALTY)、無ければ固定額扱い(FIXED)。
        calc_type: rate != null ? "ROYALTY" : "FIXED",
        // condition_lines の payment_scheme 判定は calc_method を見る
        //   (determineFinancialScheme: 'FIXED'＋rate空→lump_sum / 他→royalty)。
        //   料率付き=royalty、料率なし=lump_sum に確定させるため明示。
        calc_method: rate != null ? null : "FIXED",
        rate_pct: rate,
        base_price_label: c?.basePrice || null,
        region_territory: c?.reg || null,
        region_language: c?.lang || null,
        mg_amount: toNum(c?.mg) ?? 0,
        ag_amount: toNum(c?.ag) ?? 0,
        currency: c?.cur || "JPY",
        work_id: ownWorkId ?? null,
      };
    });

    // capability_financial_conditions へ upsert(内部で condition_lines も同期)。
    await upsertCapabilityFinancialConditions(capabilityId, mapped);

    // v3 固有メタ(migration 0086 の6列)を condition_no で補完 UPDATE。
    for (let i = 0; i < conds.length; i++) {
      const c = conds[i] as any;
      try {
        await query(
          `UPDATE capability_financial_conditions
              SET manufacturer = $3, seller = $4, max_region = $5,
                  max_language = $6, is_addon = $7, quantity = $8,
                  updated_at = CURRENT_TIMESTAMP
            WHERE capability_id = $1 AND condition_no = $2`,
          [
            capabilityId,
            i + 1,
            c?.manufacturer || null,
            c?.seller || null,
            c?.maxReg || null,
            c?.maxLang || null,
            !!c?.addon,
            c?.qty != null && String(c.qty).trim() !== "" ? String(c.qty) : null,
          ]
        );
      } catch (e: any) {
        console.warn(
          `[v3-matrix] meta update skipped cond#${i + 1}:`,
          e?.message || e
        );
      }
    }

    if (!ledgerCode) return 0;

    // 原作(licensed_in)を解決(加算型分解の素材作成・作品構成に使う)。
    const srcRes = await query(
      `SELECT id FROM works WHERE work_code = $1 AND kind = 'licensed_in' LIMIT 1`,
      [ledgerCode]
    );
    const origWorkId = srcRes.rows[0]?.id ? Number(srcRes.rows[0].id) : null;

    let linked = 0;

    // 【非加算型】= 本体マテリアル(is_default)へアンカーした1本。既存ヘルパ流用。
    //   加算型は下で LC別に分解するため、ここでは非加算型のみ渡す。
    const nonAddon = mapped.filter((_, i) => !conds[i]?.addon);
    if (nonAddon.length > 0) {
      linked += await linkWorkMaterialsForCapability({
        capabilityId,
        ledgerCode,
        ownWorkId,
        conditionMaterialCodes: opts.conditionMaterialCodes || {},
        financialConditions: nonAddon,
        defaultMaterialCode: opts.anchorMaterialCode || null,
      });
    }

    // 【加算型・C-3】= 取引形態の1本を LC別セル(N本)へ分解。
    if (origWorkId) {
      for (let i = 0; i < conds.length; i++) {
        const c = conds[i] as any;
        if (!c?.addon) continue;
        try {
          linked += await decomposeAddonConditionToLcCells({
            capabilityId,
            origWorkId,
            ownWorkId,
            ledgerCode,
            conditionNo: i + 1,
            condTempId: c?.id,
            lcs,
          });
        } catch (e: any) {
          console.warn(
            `[v3-matrix] addon decompose skipped cond#${i + 1}:`,
            e?.message || e
          );
        }
      }
    }

    return linked;
  }

  // Stage C-3: 加算型の取引形態(1 condition_line=Σ料率)を LC別セル(N本)へ分解する。
  //   - 先頭LC: 既存の集計1本を再利用(rate_pct=セル料率に更新、mg/ag は代表として保持)。
  //   - 2本目以降: condition_line を新規生成(mg/ag=0、rate_pct=セル料率)。
  //   各セルは ensureMaterialAndCompose で該当LCの原作マテリアルへ結線＋作品構成へ組み込む。
  //   Σ(セル rate_pct)=元の集計料率 を不変条件として維持する。
  async function decomposeAddonConditionToLcCells(o: {
    capabilityId: number;
    origWorkId: number;
    ownWorkId: number | null;
    ledgerCode: string;
    conditionNo: number;
    condTempId: any;
    lcs: any[];
  }): Promise<number> {
    const toNum = (v: any): number | null => {
      if (v == null || String(v).trim() === "") return null;
      const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    // 取引形態(cfc)を解決。
    const fcRes = await query(
      `SELECT * FROM capability_financial_conditions
        WHERE capability_id = $1 AND condition_no = $2 LIMIT 1`,
      [o.capabilityId, o.conditionNo]
    );
    const fc = fcRes.rows[0];
    if (!fc) return 0;
    const fcId = Number(fc.id);

    // この取引形態で料率を持つ LC(セル)を抽出。
    const key = String(o.condTempId ?? "");
    const cells = (Array.isArray(o.lcs) ? o.lcs : [])
      .map((l: any) => ({ lc: l, rate: toNum(l?.rates?.[key]) }))
      .filter((x) => x.rate != null);
    if (cells.length === 0) return 0; // 料率セルが無ければ集計1本のまま(本体アンカーは別経路に委ねる)。

    // この取引形態の既存 condition_lines を全取得(再保存時の再構成に使う)。
    //   先頭(最小 line_no)=代表行: mg/ag を保持する。以降は LC別セル。
    const exAll = await query(
      `SELECT id, capability_id, term_start, term_end FROM condition_lines
        WHERE source_condition_id = $1 ORDER BY line_no, id`,
      [fcId]
    );
    const existing = exAll.rows.map((r: any) => ({
      id: Number(r.id),
      capId: Number(r.capability_id),
    }));
    if (existing.length === 0) return 0; // sync 未生成。次回 safeSync に委ねる。
    const targetCapId = existing[0].capId;
    // 新規セル行に継ぐ期間は代表行(sync が親契約から複写済み)から引く。
    const termStart = exAll.rows[0]?.term_start ?? null;
    const termEnd = exAll.rows[0]?.term_end ?? null;

    const year = new Date().getFullYear();
    let count = 0;

    for (let k = 0; k < cells.length; k++) {
      const { lc, rate } = cells[k];
      const matCode = String(lc?.material_code || "").trim();
      const matName = (lc?.name && String(lc.name).trim()) || `構成要素${k + 1}`;
      let lineId: number;

      if (k < existing.length) {
        // 既存行を再利用。先頭(k=0)は mg/ag を代表として保持、以降は 0(二重計上回避)。
        lineId = existing[k].id;
        if (k === 0) {
          await query(
            `UPDATE condition_lines SET rate_pct = $2, updated_at = now() WHERE id = $1`,
            [lineId, rate]
          );
        } else {
          await query(
            `UPDATE condition_lines
                SET rate_pct = $2, mg_amount = 0, ag_amount = 0, updated_at = now()
              WHERE id = $1`,
            [lineId, rate]
          );
        }
      } else {
        // 不足分: 集計行のメタを継いだ新規 condition_line を生成。
        //   mapper で列を作り、rate_pct=セル料率 / mg・ag=0(二重計上回避)へ上書き。
        const lineNoRes = await query(
          `SELECT COALESCE(MAX(line_no),0)+1 AS n FROM condition_lines WHERE capability_id = $1`,
          [targetCapId]
        );
        const lineNo = Number(lineNoRes.rows[0]?.n || 1);
        const seqRes = await query(
          `INSERT INTO document_sequences (kind, year, current_value) VALUES ('condition_line', $1, 1)
             ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
           RETURNING current_value`,
          [year]
        );
        const code = `CL-${year}-${String(Number(seqRes.rows[0].current_value)).padStart(5, "0")}`;
        const row = mapFinancialConditionToConditionLine(
          { ...fc, rate_pct: rate, mg_amount: 0, ag_amount: 0 },
          { effective_date: termStart, expiration_date: termEnd },
          targetCapId,
          lineNo,
          code
        );
        const ins = await query(
          `INSERT INTO condition_lines (${CONDITION_LINE_COLUMNS.join(", ")})
             VALUES (${CONDITION_LINE_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})
           RETURNING id`,
          conditionLineInsertValues(row)
        );
        lineId = Number(ins.rows[0].id);
      }

      // 跨ぎ原作対応: セルの material_code から所属原作を全体検索で解決する。
      //   material_code は {原作code}-{NNN} でグローバル一意のため、コードから所属原作を
      //   逆引きできる。既存材料が見つかればその原作配下で引用(別原作のB等)。無ければ
      //   文書の原作へ新規作成(件名のみの新規LC)。これにより作品Cが複数原作の構成要素を
      //   束ねられる(work_components は ownWorkId=作品C へ原作を跨いで組み込む)。
      let cellOrigWorkId = o.origWorkId;
      let cellLedgerCode: string = o.ledgerCode;
      if (matCode) {
        const owner = await query(
          `SELECT wm.work_id, w.work_code
             FROM work_materials wm
             JOIN works w ON w.id = wm.work_id
            WHERE wm.material_code = $1 LIMIT 1`,
          [matCode]
        );
        if (owner.rows[0]?.work_id) {
          cellOrigWorkId = Number(owner.rows[0].work_id);
          cellLedgerCode = String(owner.rows[0].work_code || o.ledgerCode);
        }
      }

      // セルを該当LCの原作マテリアルへ結線＋作品構成(作品C)へ組み込む。
      await ensureMaterialAndCompose({
        lineId,
        origWorkId: cellOrigWorkId,
        ownWorkId: o.ownWorkId,
        ledgerCode: cellLedgerCode,
        name: matName,
        rightsType: "license",
        acquisitionType: "license",
        isRoyaltyBearing: true,
        pickedCode: matCode || undefined,
      });
      count++;
    }

    // 余剰行(LCが減った再保存)を整理。履歴(イベント)/作品構成参照を持つ行は保全。
    if (existing.length > cells.length) {
      const surplus = existing.slice(cells.length).map((x) => x.id);
      await query(
        `DELETE FROM condition_lines cl
          WHERE cl.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.condition_line_id = cl.id)
            AND NOT EXISTS (SELECT 1 FROM work_component_lines w WHERE w.condition_line_id = cl.id)`,
        [surplus]
      );
    }
    return count;
  }

  // 作品管理(WorkGraphPanel)から原作の利用許諾条件を v3 マトリクスで登録する。
  //   文書を介さず、原作の MLC マスター器(MLC-<work_code>)へ v3_conds/v3_lcs を登録。
  //   既存の registerV3MatrixConditions(加算型分解・グローバル素材解決込み)を再利用。
  //   apiRouter は POST /api/v3/* を search-api へ振るため、ここは /api/v3/ を避けた
  //   /api/works/:workId/license-matrix(=worker)に置く。
  app.post(
    "/api/works/:workId/license-matrix",
    express.json(),
    async (req, res) => {
      try {
        const workId = Number(req.params.workId);
        const body = req.body || {};
        const conds = Array.isArray(body.conds) ? body.conds : [];
        const lcs = Array.isArray(body.lcs) ? body.lcs : [];
        if (!Number.isFinite(workId) || workId <= 0) {
          return res.status(400).json({ ok: false, error: "invalid workId" });
        }
        if (conds.length === 0) {
          return res.status(400).json({ ok: false, error: "conds is empty" });
        }
        const wr = await query(
          `SELECT work_code, title, kind FROM works WHERE id = $1 LIMIT 1`,
          [workId]
        );
        const w = wr.rows[0];
        if (!w) return res.status(404).json({ ok: false, error: "work not found" });
        if (w.kind !== "licensed_in") {
          return res
            .status(400)
            .json({ ok: false, error: "原作(licensed_in)のみ対応" });
        }
        const workCode = String(w.work_code);
        const docNo = `MLC-${workCode}`;
        // MLC マスター器を ensure(ensureMasterLicenseCapability 相当のインライン upsert)。
        await query(
          `INSERT INTO contract_capabilities (
             record_type, contract_category, contract_type, contract_title,
             document_number, original_work, work_name, contract_status, source_system
           ) VALUES (
             'license_condition', 'license', 'registered_master', $1,
             $2, $3, $3, 'executed', 'master_register'
           )`,
          [
            `原作利用許諾条件(マスター登録): ${w.title || workCode}`,
            docNo,
            w.title || workCode,
          ]
        );
        const capRes = await query(
          `SELECT id FROM contract_capabilities WHERE document_number = $1 LIMIT 1`,
          [docNo]
        );
        const capId = capRes.rows[0]?.id ? Number(capRes.rows[0].id) : null;
        if (!capId) {
          return res
            .status(500)
            .json({ ok: false, error: "MLC capability の取得に失敗" });
        }
        const linked = await registerV3MatrixConditions({
          capabilityId: capId,
          ledgerCode: workCode, // 原作コード=licensed_in work_code(=ledger_code)
          ownWorkId: null,
          conds,
          lcs,
          anchorMaterialCode: null, // 非加算型は原作本体素材(is_default)へアンカー
        });
        res.json({ ok: true, capability_id: capId, document_number: docNo, linked });
      } catch (error: any) {
        console.error("POST /api/works/:workId/license-matrix failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  /**
   * Phase 22.21.112: 契約マスタの業務明細 (capability_line_items) を
   *   配列で受け取って upsert する。upsertCapabilityFinancialConditions と
   *   同じ semantics:
   *
   *   - raw が undefined → 何もしない (既存明細を保持)
   *   - raw が null or [] → 全件削除
   *   - それ以外 → 配列内の line_no で upsert、含まれていない line_no を削除
   */
  async function upsertCapabilityLineItems(
    capabilityId: number,
    raw: any
  ): Promise<void> {
    if (raw === undefined) return;
    const items: Array<any> = Array.isArray(raw) ? expandLinesWithSchedule(raw) : [];
    const keepNos = items
      .map((c) => Number(c?.line_no))
      .filter((n) => Number.isFinite(n) && n > 0);
    try {
      // 削除/間引き対象の capability_line_items.id を先に把握する
      //   (ミラーした condition_lines を連動削除するため)。
      const removedRes =
        items.length === 0
          ? await query(
              `SELECT id FROM capability_line_items WHERE capability_id = $1`,
              [capabilityId]
            )
          : await query(
              `SELECT id FROM capability_line_items
                WHERE capability_id = $1 AND line_no <> ALL($2::int[])`,
              [capabilityId, keepNos]
            );
      const removedLiIds = removedRes.rows
        .map((r: any) => Number(r.id))
        .filter((n: number) => Number.isFinite(n));

      if (items.length === 0) {
        await query(
          `DELETE FROM capability_line_items WHERE capability_id = $1`,
          [capabilityId]
        );
      } else {
        await query(
          `DELETE FROM capability_line_items
            WHERE capability_id = $1 AND line_no <> ALL($2::int[])`,
          [capabilityId, keepNos]
        );
      }

      // 明細削除に追従して孤児 condition_lines も連動削除(非致命)。
      await safeSync("CL prune(capability)", () =>
        pruneOrphanConditionLines({ query }, removedLiIds)
      );
    } catch (delErr) {
      console.warn(
        "[capability_line_items] prune failed:",
        delErr
      );
    }
    for (const c of items) {
      const lineNo = Number(c?.line_no);
      if (!Number.isFinite(lineNo) || lineNo < 1) continue;
      const numOrNull = (v: any) =>
        v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
      const dateOrNull = (v: any) =>
        v && String(v).length >= 8 ? String(v).substring(0, 10) : null;
      await query(
        `INSERT INTO capability_line_items (
           capability_id, line_no,
           category, item_name, spec,
           calc_method, payment_method, payment_terms,
           quantity, unit_price, amount_ex_tax, rate_pct,
           delivery_date, payment_date,
           cycle, billing_day, term_start, term_end,
           fee_type, royalty_calc_basis, work_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, CURRENT_TIMESTAMP)`,
        [
          capabilityId,
          lineNo,
          c.category || null,
          c.item_name || null,
          c.spec || null,
          c.calc_method || null,
          c.payment_method || null,
          c.payment_terms || null,
          numOrNull(c.quantity),
          numOrNull(c.unit_price),
          numOrNull(c.amount_ex_tax),
          numOrNull(c.rate_pct),
          dateOrNull(c.delivery_date),
          dateOrNull(c.payment_date),
          c.cycle || null,
          numOrNull(c.billing_day),
          dateOrNull(c.term_start),
          dateOrNull(c.term_end),
          c.fee_type || "production",
          c.royalty_calc_basis || null,
          numOrNull(c.work_id),
        ]
      );
    }
    // Phase C-5: 旧明細(capability_line_items)書き込み後、condition_lines にも
    //   非致命で二重書き込み(冪等)。新規/既存契約の保存いずれもここを通る。
    await safeSync("CL(capability)", () =>
      syncConditionLinesForCapability({ query }, capabilityId)
    );
  }

  /**
   * Phase 23.6.14: 契約マスタの経費 (capability_expenses) を配列で受け取って upsert。
   *   upsertCapabilityLineItems と同じ semantics:
   *   - raw === undefined → 何もしない (既存経費を保持)
   *   - raw === null or [] → 全件削除
   *   - それ以外 → line_no で upsert、含まれない line_no を削除
   *   発注書フォーム IV-b. 経費 と同 shape。検収書「ステップ2-b 経費精算」で
   *   親 PO 連動として参照される (税込み額)。
   */
  async function upsertCapabilityExpenses(
    capabilityId: number,
    raw: any
  ): Promise<void> {
    if (raw === undefined) return;
    const rows: Array<any> = Array.isArray(raw) ? raw : [];
    const dateOrNull = (v: any) =>
      v && String(v).length >= 8 ? String(v).substring(0, 10) : null;
    const computed = rows
      .map((e: any, idx: number) => ({
        line_no: Number(e?.line_no) || idx + 1,
        expense_name: e?.expense_name || "",
        spec: e?.spec || "",
        spent_date: dateOrNull(e?.spent_date),
        amount_inc_tax: Number(e?.amount_inc_tax) || 0,
        remarks: e?.remarks || "",
      }))
      .filter((e) => e.expense_name);
    try {
      const keepNos = computed.map((e) => e.line_no).filter((n) => n > 0);
      if (keepNos.length === 0) {
        await query(
          `DELETE FROM capability_expenses WHERE capability_id = $1`,
          [capabilityId]
        );
      } else {
        await query(
          `DELETE FROM capability_expenses
            WHERE capability_id = $1 AND line_no <> ALL($2::int[])`,
          [capabilityId, keepNos]
        );
      }
    } catch (delErr) {
      console.warn("[capability_expenses] prune failed:", delErr);
    }
    for (const e of computed) {
      await query(
        `INSERT INTO capability_expenses (
           capability_id, line_no, expense_name, spec,
           spent_date, amount_inc_tax, remarks, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          capabilityId,
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

  /**
   * Phase 23.6.14: 契約マスタのその他手数料 (capability_other_fees) を upsert。
   *   発注書フォーム IV-a. その他手数料 と同 shape (税抜)。検収書「ステップ2-c
   *   その他手数料」で参照。semantics は upsertCapabilityExpenses と同じ。
   */
  async function upsertCapabilityOtherFees(
    capabilityId: number,
    raw: any
  ): Promise<void> {
    if (raw === undefined) return;
    const rows: Array<any> = Array.isArray(raw) ? raw : [];
    const computed = rows
      .map((f: any, idx: number) => ({
        line_no: Number(f?.line_no) || idx + 1,
        fee_name: f?.fee_name || "",
        amount: Number(f?.amount) || 0,
        remarks: f?.remarks || "",
      }))
      .filter((f) => f.fee_name);
    try {
      const keepNos = computed.map((f) => f.line_no).filter((n) => n > 0);
      if (keepNos.length === 0) {
        await query(
          `DELETE FROM capability_other_fees WHERE capability_id = $1`,
          [capabilityId]
        );
      } else {
        await query(
          `DELETE FROM capability_other_fees
            WHERE capability_id = $1 AND line_no <> ALL($2::int[])`,
          [capabilityId, keepNos]
        );
      }
    } catch (delErr) {
      console.warn("[capability_other_fees] prune failed:", delErr);
    }
    for (const f of computed) {
      await query(
        `INSERT INTO capability_other_fees (
           capability_id, line_no, fee_name, amount, remarks, updated_at
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [capabilityId, f.line_no, f.fee_name, f.amount, f.remarks]
      );
    }
  }

  // データ構造刷新 (設計 第8章): 契約のスコープ(service/license_use)を
  //   contract_scopes に upsert + template_family を設定。基本契約が複数スコープを
  //   持てる (例: ライセンス基本契約＋業務委託)。
  //   - rawScopes 配列があればそれを正に (UI 複数選択)。無ければ contract_category 導出。
  //   - 出版は別スコープでなく license_use + template_family='publication' (設計準拠)。
  //   非致命: 失敗しても契約保存本体は止めない。
  async function upsertContractScopes(
    capabilityId: number,
    rawScopes: any,
    contractCategory: any,
    rawTemplateFamily: any
  ): Promise<void> {
    const cat = String(contractCategory || "").toLowerCase();
    let scopes: string[];
    if (Array.isArray(rawScopes)) {
      scopes = rawScopes
        .map((s) => String(s).trim())
        .filter((s) => s === "service" || s === "license_use");
    } else {
      scopes =
        cat === "service"
          ? ["service"]
          : cat === "license" || cat === "publication"
            ? ["license_use"]
            : cat === "mixed"
              ? ["service", "license_use"]
              : [];
    }
    scopes = [...new Set(scopes)];
    const tf =
      rawTemplateFamily && String(rawTemplateFamily).trim()
        ? String(rawTemplateFamily).trim()
        : cat === "publication"
          ? "publication"
          : cat === "license"
            ? "license"
            : cat === "service"
              ? "service"
              : null;
    try {
      if (scopes.length === 0) {
        await query(`DELETE FROM contract_scopes WHERE capability_id = $1`, [capabilityId]);
      } else {
        await query(
          `DELETE FROM contract_scopes WHERE capability_id = $1 AND scope <> ALL($2::text[])`,
          [capabilityId, scopes]
        );
        for (const s of scopes) {
          await query(
            `INSERT INTO contract_scopes (capability_id, scope) VALUES ($1, $2)
               ON CONFLICT (capability_id, scope) DO NOTHING`,
            [capabilityId, s]
          );
        }
      }
      if (tf) {
        await query(
          `ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS template_family VARCHAR(20)`
        ).catch(() => {});
        await query(
          `UPDATE contract_capabilities SET template_family = $2 WHERE id = $1`,
          [capabilityId, tf]
        );
      }
    } catch (e) {
      console.warn("[contract_scopes] upsert failed (non-fatal):", e);
    }
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
      // Phase 22.21.49: 強制再発番フラグ (admin-ui の「🔄 再発番」ボタン)
      regenerate_document_number,
      // Phase 22.21.52: 原作 (ledger) 紐付け — ILT 採番に使う
      ledger_code,
      // Phase 22.21.91: ライセンス系の金銭条件 (条件 1..3 配列)
      financial_conditions,
      // 請求の方向(in/out)。admin-ui の契約マスター登録フォームの「目的/方向」から。
      //   明示が無くても purpose_code があれば contract_purposes から解決する。
      flow_direction, purpose_code,
      // 成果物の権利帰属(company/counterparty/shared)。複合契約の根拠メタ。
      deliverable_ownership,
      // データ構造刷新: 契約スコープ複数選択 (service / license_use)。
      //   明示があれば正、無ければ contract_category から導出。template_family は
      //   出版/ライセンスの区別 (UI から明示 or category 由来)。
      scopes, template_family,
    } = req.body;
    try {
      const channels = normalizeAlertList(alert_slack_channels);
      const mentions = normalizeAlertList(alert_slack_mentions);
      const ledger = String(ledger_code || "").trim() || null;
      // 方向の確定: 明示 flow_direction を優先、無ければ purpose_code から解決。
      let flowDir: string | null =
        flow_direction === "in" || flow_direction === "out" ? flow_direction : null;
      if (!flowDir && purpose_code) {
        try {
          const pr = await query(
            `SELECT flow_direction FROM contract_purposes WHERE purpose_code = $1`,
            [purpose_code]
          );
          if (pr.rows[0]?.flow_direction) flowDir = pr.rows[0].flow_direction;
        } catch (pdErr) {
          console.warn("[flow_direction] purpose resolve skipped (POST contracts):", pdErr);
        }
      }
      const finalDocNumber = await ensureDocumentNumber(
        document_number,
        contract_type,
        contract_category,
        record_type,
        ledger,
        regenerate_document_number === true || regenerate_document_number === "true"
      );
      // スキーマ単純化 Phase 2: documents 統合＋CL直接書き込み（contract_capabilities 廃止）。
      //   金銭条件/業務明細/経費/手数料を全て CL へ、材料は行指定→既定→原作本体へアンカー。
      const saved = await upsertMasterContract(
        { query },
        {
          document_number: finalDocNumber,
          record_type: record_type || "master_contract",
          contract_category: contract_category || "service",
          contract_type: contract_type || "service_basic",
          contract_title,
          contract_status: contract_status || "executed",
          vendor_id: vendor_id || null,
          effective_date: effective_date || null,
          expiration_date: expiration_date || null,
          flow_direction: flowDir,
          deliverable_ownership: deliverable_ownership || null,
          ledger_code: ledger,
          template_family,
          is_active: is_active === undefined || is_active === null ? true : Boolean(is_active),
          auto_renewal:
            auto_renewal === true || auto_renewal === "t" || auto_renewal === "true" || auto_renewal === 1,
          renewal_notice_months:
            renewal_notice_months != null && renewal_notice_months !== "" ? Number(renewal_notice_months) : null,
          alert_lead_months:
            alert_lead_months != null && alert_lead_months !== "" ? Number(alert_lead_months) : null,
          alert_slack_channels: channels,
          alert_slack_mentions: mentions,
          original_work: original_work || null,
          product_name: product_name || null,
          work_name: work_name || null,
          media: media || null,
          territory: territory || null,
          language: language || null,
          condition_number: condition_number || null,
          document_url: document_url || null,
          default_material_code: req.body?.素材番号 || null,
          condition_material_codes: req.body?.condition_material_codes || {},
          financial_conditions,
          line_items: req.body?.line_items,
          expenses: req.body?.expenses,
          other_fees: req.body?.other_fees,
        }
      );
      const newId = saved.documentId;
      // 契約スコープは Phase 後段で documents へ付替え予定（現状スキップ）。

      // 稟議番号 N:N リンク（documents 行は upsertMasterContract が作成済み）。
      try {
        await linkRingiByDocNumber(
          finalDocNumber,
          Array.isArray(req.body?.ringi_numbers)
            ? req.body.ringi_numbers.join(",")
            : req.body?.ringi_numbers
        );
      } catch (ringiErr: any) {
        console.warn(
          `[master-contract] ringi link failed for ${finalDocNumber}:`,
          ringiErr?.message || ringiErr
        );
      }

      res.json({
        success: true,
        id: newId,
        document_number: finalDocNumber,
        document_number_auto:
          !String(document_number || "").trim() ||
          regenerate_document_number === true ||
          regenerate_document_number === "true",
      });
    } catch (error: any) {
      // Phase 22.21.102: document_number UNIQUE 違反は 409 で返す。
      //   ユーザーが既存番号と同じものを入力したことを明示。
      if (
        error &&
        error.code === "23505" &&
        String(error.constraint || "").includes("doc_num")
      ) {
        return res.status(409).json({
          error:
            `この文書番号は既に登録されています: ${document_number}。` +
            `既存の契約を編集するか、別の番号を指定してください。`,
          code: "DOC_NUMBER_DUPLICATE",
          document_number,
        });
      }
      res.status(500).json({ error: String(error) });
    }
  });

  // 契約状態だけを軽量に更新する PATCH。マスター一覧テーブルからのインライン編集用。
  //   フル PUT は全列を置換するため、状態のみ変えたいときはこちらを使う(他項目を消さない)。
  app.patch("/api/master/contracts/:id/status", express.json(), async (req, res) => {
    const { id } = req.params;
    const { contract_status } = req.body || {};
    const ALLOWED = ["draft", "awaiting_signature", "executed", "expired", "terminated"];
    if (!ALLOWED.includes(String(contract_status))) {
      return res.status(400).json({ ok: false, error: "invalid contract_status" });
    }
    try {
      const r = await query(
        `UPDATE documents
            SET contract_status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        RETURNING id, contract_status`,
        [id, contract_status]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true, id: Number(r.rows[0].id), contract_status: r.rows[0].contract_status });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error) });
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
      // Phase 22.21.49: 強制再発番フラグ
      regenerate_document_number,
      // Phase 22.21.52: 原作 (ledger) 紐付け
      ledger_code,
      // Phase 22.21.91: 金銭条件 (条件 1..3 配列)
      financial_conditions,
      // 請求の方向(in/out)。明示が無ければ purpose_code から解決。
      flow_direction, purpose_code,
      // 成果物の権利帰属(company/counterparty/shared)。
      deliverable_ownership,
      // データ構造刷新: 契約スコープ複数選択 + template_family。
      scopes, template_family,
    } = req.body;
    try {
      const channels = normalizeAlertList(alert_slack_channels);
      const mentions = normalizeAlertList(alert_slack_mentions);
      const ledger = String(ledger_code || "").trim() || null;
      let flowDir: string | null =
        flow_direction === "in" || flow_direction === "out" ? flow_direction : null;
      if (!flowDir && purpose_code) {
        try {
          const pr = await query(
            `SELECT flow_direction FROM contract_purposes WHERE purpose_code = $1`,
            [purpose_code]
          );
          if (pr.rows[0]?.flow_direction) flowDir = pr.rows[0].flow_direction;
        } catch (pdErr) {
          console.warn("[flow_direction] purpose resolve skipped (PUT contracts):", pdErr);
        }
      }

      // Phase 22.21.60: マスター側の番号変更を「正」にするため、変更前の
      // 番号を保持しておき、変更後に documents テーブル側にも伝播させる。
      //   contract_capabilities が UPDATE される前に DB 上の旧番号を取得。
      const existingRow = await query(
        `SELECT document_number FROM documents WHERE id = $1`,
        [id]
      );
      const previousDocNumber = String(
        existingRow.rows[0]?.document_number || ""
      ).trim();

      const finalDocNumber = await ensureDocumentNumber(
        document_number,
        contract_type,
        contract_category,
        record_type,
        ledger,
        regenerate_document_number === true || regenerate_document_number === "true"
      );
      // 番号変更時は既存 documents 行の番号を先に合わせる（upsert キー一致のため）。
      if (previousDocNumber && previousDocNumber !== finalDocNumber) {
        await query(`UPDATE documents SET document_number = $2 WHERE id = $1`, [id, finalDocNumber]);
      }

      // スキーマ単純化 Phase 2: documents 統合＋CL直接書き込みで更新。
      //   明細系が全 undefined のときは既存CLを保持（PUT 既存挙動を踏襲）。
      const saved = await upsertMasterContract(
        { query },
        {
          document_number: finalDocNumber,
          record_type,
          contract_category,
          contract_type,
          contract_title,
          contract_status,
          vendor_id: vendor_id || null,
          effective_date: effective_date || null,
          expiration_date: expiration_date || null,
          flow_direction: flowDir,
          deliverable_ownership: deliverable_ownership || null,
          ledger_code: ledger,
          template_family,
          is_active: is_active === undefined || is_active === null ? true : Boolean(is_active),
          auto_renewal:
            auto_renewal === true || auto_renewal === "t" || auto_renewal === "true" || auto_renewal === 1,
          renewal_notice_months:
            renewal_notice_months != null && renewal_notice_months !== "" ? Number(renewal_notice_months) : null,
          alert_lead_months:
            alert_lead_months != null && alert_lead_months !== "" ? Number(alert_lead_months) : null,
          alert_slack_channels: channels,
          alert_slack_mentions: mentions,
          original_work: original_work || null,
          product_name: product_name || null,
          work_name: work_name || null,
          media: media || null,
          territory: territory || null,
          language: language || null,
          condition_number: condition_number || null,
          document_url: document_url || null,
          default_material_code: req.body?.素材番号 || null,
          condition_material_codes: req.body?.condition_material_codes || {},
          financial_conditions,
          line_items: req.body?.line_items,
          expenses: req.body?.expenses,
          other_fees: req.body?.other_fees,
        }
      );
      void saved;

      // Phase 22.21.115: 稟議番号リンクを更新 (POST と同じパターン)。
      //   ringi_numbers が undefined なら触らない。[] なら全削除。
      if (req.body?.ringi_numbers !== undefined) {
        try {
          // documents 行は upsertMasterContract が作成/更新済み。稟議リンクのみ更新。
          await linkRingiByDocNumber(
            finalDocNumber,
            Array.isArray(req.body.ringi_numbers)
              ? req.body.ringi_numbers.join(",")
              : req.body.ringi_numbers
          );
        } catch (ringiErr: any) {
          console.warn(
            `[master-contract PUT] ringi link failed for ${finalDocNumber}:`,
            ringiErr?.message || ringiErr
          );
        }
      }

      // Phase 22.21.60: 旧 → 新 で document_number が変わったら、
      //   archive (documents) の対応 row も同じ番号にリネームする。
      //   これでマスター側を「正」とし、文書検索 (Phase 22.21.48 search) と
      //   master が常に同期した状態を保つ。
      // Phase 22.21.62: 完全一致 + リビジョン suffix + base_document_number /
      //   superseded_by 参照を一括リネーム。
      let archivePropagation: {
        old: string;
        new: string;
        documents_updated: number;
        documents_revisions_updated: number;
        documents_base_updated: number;
        documents_superseded_updated: number;
        assets_updated: number;
        assets_revisions_updated: number;
        drive_files_renamed: number;
        conflict?: string;
      } | null = null;
      if (
        previousDocNumber &&
        finalDocNumber &&
        previousDocNumber !== finalDocNumber
      ) {
        try {
          const r = await renameArchiveDocumentNumber(
            previousDocNumber,
            finalDocNumber
          );
          archivePropagation = {
            old: previousDocNumber,
            new: finalDocNumber,
            ...r,
          };
          console.log(
            `[contracts] archive renamed: ${previousDocNumber} → ${finalDocNumber} ` +
              `(base=${r.documents_updated}, rev=${r.documents_revisions_updated}, ` +
              `base_ref=${r.documents_base_updated}, superseded=${r.documents_superseded_updated}, ` +
              `assets=${r.assets_updated}+${r.assets_revisions_updated}, ` +
              `drive=${r.drive_files_renamed})`
          );
        } catch (err: any) {
          if (err?.code === "23505") {
            archivePropagation = {
              old: previousDocNumber,
              new: finalDocNumber,
              documents_updated: 0,
              documents_revisions_updated: 0,
              documents_base_updated: 0,
              documents_superseded_updated: 0,
              assets_updated: 0,
              assets_revisions_updated: 0,
              drive_files_renamed: 0,
              conflict:
                "新番号と同じ document_number の archive row が既に存在するため、アーカイブ側のリネームをスキップしました。古い番号の archive row は残っています。",
            };
            console.warn(
              `[contracts] could not rename to ${finalDocNumber} — duplicate exists`
            );
          } else {
            throw err;
          }
        }
      }

      res.json({
        success: true,
        document_number: finalDocNumber,
        document_number_auto:
          !String(document_number || "").trim() ||
          regenerate_document_number === true ||
          regenerate_document_number === "true",
        document_number_regenerated:
          (regenerate_document_number === true ||
            regenerate_document_number === "true") &&
          finalDocNumber !== String(document_number || "").trim(),
        archive_propagation: archivePropagation,
      });
    } catch (error: any) {
      // Phase 22.21.102: 編集時に他レコードと document_number が衝突
      if (
        error &&
        error.code === "23505" &&
        String(error.constraint || "").includes("doc_num")
      ) {
        return res.status(409).json({
          error:
            `この文書番号は別の契約で既に使われています: ${document_number}。` +
            `別の番号を指定するか、既存契約を先に編集/削除してください。`,
          code: "DOC_NUMBER_DUPLICATE",
          document_number,
        });
      }
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Phase 22.21.61: 過去のアーカイブをマスター番号に手動でリネーム。
   *
   *   POST /api/master/contracts/:id/rename-archive
   *   body: { from_document_number: "ARC-ILT-2026-0001" }
   *
   * 動作:
   *   1. contract_capabilities.id でマスター行を引き、現在の document_number
   *      (= "正" の番号) を取得
   *   2. body.from_document_number に対応する documents 行 +
   *      external_assets 行を新番号にリネーム
   *   3. UNIQUE 違反は安全に検知して 409 で返す
   *
   * Phase 22.21.60 (master 保存時の自動同期) でカバーできない「過去ドリフト
   * の手動修復」用エンドポイント。
   */
  app.post(
    "/api/master/contracts/:id/rename-archive",
    express.json(),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        const from = String(req.body?.from_document_number || "").trim();
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ ok: false, error: "invalid id" });
        }
        if (!from) {
          return res
            .status(400)
            .json({ ok: false, error: "from_document_number is required" });
        }
        const master = await query(
          `SELECT document_number FROM contract_capabilities WHERE id = $1`,
          [id]
        );
        const target = String(master.rows[0]?.document_number || "").trim();
        if (!target) {
          return res
            .status(404)
            .json({ ok: false, error: "contract not found or has no document_number" });
        }
        if (from === target) {
          return res.json({
            ok: true,
            already_synced: true,
            from,
            to: target,
            documents_updated: 0,
            assets_updated: 0,
          });
        }

        // Phase 22.21.62: 共通ヘルパで base + リビジョン + 参照すべてを一括リネーム
        let r;
        try {
          r = await renameArchiveDocumentNumber(from, target);
        } catch (err: any) {
          if (err?.code === "23505") {
            return res.status(409).json({
              ok: false,
              error:
                `target document_number "${target}" は既に別 archive 行で使用されています。` +
                ` 衝突 row を削除/別番号化してから再実行してください。`,
              from,
              to: target,
            });
          }
          throw err;
        }
        const totalChanged =
          r.documents_updated +
          r.documents_revisions_updated +
          r.documents_base_updated +
          r.documents_superseded_updated +
          r.assets_updated +
          r.assets_revisions_updated;
        if (totalChanged === 0) {
          return res.status(404).json({
            ok: false,
            error: `from_document_number "${from}" に該当する archive 行が見つかりません`,
          });
        }
        console.log(
          `[contracts] manual archive rename: ${from} → ${target} ` +
            `(base=${r.documents_updated}, rev=${r.documents_revisions_updated}, ` +
            `base_ref=${r.documents_base_updated}, superseded=${r.documents_superseded_updated}, ` +
            `assets=${r.assets_updated}+${r.assets_revisions_updated}, master_id=${id})`
        );
        res.json({
          ok: true,
          from,
          to: target,
          ...r,
          // 後方互換 (旧フィールド名も維持)
          documents_updated:
            r.documents_updated +
            r.documents_revisions_updated +
            r.documents_base_updated +
            r.documents_superseded_updated,
          assets_updated: r.assets_updated + r.assets_revisions_updated,
        });
      } catch (error) {
        console.error("rename-archive failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

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
                default_approval_target, default_approval_timing, division,
                created_at, updated_at
           FROM ledgers
          ORDER BY ledger_code DESC`
      );
      const ids = ledgers.rows.map((l: any) => Number(l.id));
      const matsMap = new Map<number, any[]>();
      if (ids.length > 0) {
        // マテリアル一本化(0089/0090): 子素材は正準表 work_materials から取得。
        //   台帳(ledgers.id) ← works(licensed_in, work_code=ledger_code) ← work_materials。
        const mats = await query(
          `SELECT wm.id, l.id AS ledger_id, wm.material_no, wm.material_code, wm.material_name,
                  wm.material_type, wm.rights_holder_label AS rights_holder, wm.remarks,
                  wm.is_default, TRUE AS is_active, wm.material_role, wm.category_id,
                  mc.genre AS category_genre, mc.name AS category_name, mc.sort_order AS category_sort,
                  COALESCE(NULLIF(trim(wm.rights_holder_label), ''), mc.rights_holder_label) AS effective_rights_holder,
                  wm.created_at, wm.updated_at
             FROM work_materials wm
             JOIN works   w ON w.id = wm.work_id AND w.kind = 'licensed_in'
             JOIN ledgers l ON l.ledger_code = w.work_code
             LEFT JOIN material_categories mc ON mc.id = wm.category_id
            WHERE l.id = ANY($1::int[])
            ORDER BY l.id, COALESCE(mc.sort_order, 99), wm.material_no ASC NULLS LAST`,
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
        // Phase 26: 事業部タグ (BDG / PUB)
        division: Array.isArray(body.division) ? body.division : undefined,
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
           division                 = COALESCE($13, division),
           updated_at               = CURRENT_TIMESTAMP
         WHERE id = $14`,
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
          // Phase 26: 事業部タグ (未指定なら COALESCE で既存維持)
          Array.isArray(body.division) ? body.division : null,
          id,
        ]
      );
      // 統合Phase3b: works(source) ミラーへ同期(同コードの licensed_in)。
      try {
        await query(
          `UPDATE works w SET
              title=$1, title_kana=$2, default_rights_holder=$3,
              default_credit_display=$4, default_work_supplement=$5,
              default_approval_target=$6, default_approval_timing=$7, updated_at=now()
             FROM ledgers l
            WHERE l.id=$8 AND w.kind='licensed_in' AND w.work_code=l.ledger_code`,
          [
            body.title, body.title_kana || null, body.default_rights_holder || null,
            body.default_credit_display || null, body.default_work_supplement || null,
            body.default_approval_target || null, body.default_approval_timing || null, id,
          ]
        );
      } catch (e: any) {
        console.warn(`[ledger] works mirror sync (update) failed:`, e?.message || e);
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("PUT /api/master/ledgers/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.delete("/api/master/ledgers/:id", async (req, res) => {
    const { id } = req.params;
    try {
      // 配下の素材を参照する license 契約があるかチェック
      // Phase 23: license_contracts → contract_capabilities (license)
      const refs = await query(
        `SELECT COUNT(*)::int AS c
           FROM contract_capabilities
          WHERE contract_category = 'license'
            AND record_type IN ('individual_contract', 'master_contract', 'standalone_contract')
            AND ledger_ref_id = $1`,
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
      // マテリアル一本化(0089/0090): 正準表 work_materials を更新(rights_holder_label に統一)。
      // O5: ジャンル正規化 + 役割確定。 Category(2): genre に対応するカテゴリへ付け替え。
      const mt = normalizeGenre(body.material_type);
      const role = normalizeRole(body.material_role, mt, undefined);
      const wmRow = await query(`SELECT work_id FROM work_materials WHERE id = $1`, [id]);
      const wmWorkId = wmRow.rows[0]?.work_id ? Number(wmRow.rows[0].work_id) : null;
      const categoryId = wmWorkId ? await ensureMaterialCategory(wmWorkId, mt) : null;
      await query(
        `UPDATE work_materials SET
           material_name      = $1,
           material_type      = $2,
           material_role      = $6,
           category_id        = $7,
           rights_holder_label = $3,
           remarks            = $4,
           updated_at         = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          body.material_name,
          mt,
          body.rights_holder || null,
          body.remarks || null,
          id,
          role,
          categoryId,
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
        `SELECT is_default FROM work_materials WHERE id = $1`,
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
      // 参照あれば拒否 (Phase 23: license_contracts → contract_capabilities)
      const refs = await query(
        `SELECT COUNT(*)::int AS c
           FROM contract_capabilities
          WHERE contract_category = 'license'
            AND record_type IN ('individual_contract', 'master_contract', 'standalone_contract')
            AND material_ref_id = $1`,
        [id]
      );
      if (Number(refs.rows[0].c) > 0) {
        return res.status(400).json({
          ok: false,
          error: `この素材には ${refs.rows[0].c} 件の契約が紐付いているため削除できません`,
        });
      }
      await query("DELETE FROM work_materials WHERE id = $1", [id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/master/materials/:id failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  // [削除] サブライセンシー マスター(/api/master/sublicensees) は廃止。0113 で DROP。

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
  /**
   * 検収 event 補完リカバリ。delivery_line_items を持つ delivery_event を走査し、
   * 未起票の検収 condition_events を冪等に補完する(C-3 のランタイム版)。
   * 検収書 document の解決に issue_key フォールバックが効くため、過去に保留に
   * なっていた分(form_data に delivery_event_id 不在)もここで成就反映される。
   * body: { dry_run?: boolean }
   */
  app.post("/api/admin/resync-inspection-events", express.json(), async (req, res) => {
    const dryRun = req.body?.dry_run === true;
    try {
      if (dryRun) {
        const pending = await query(
          `SELECT COUNT(DISTINCT de.id)::int AS n
             FROM delivery_events de
             JOIN delivery_line_items dli ON dli.delivery_event_id = de.id
            WHERE NOT EXISTS (
                    SELECT 1 FROM condition_events ce
                     WHERE ce.source_delivery_line_item_id = dli.id)
              AND EXISTS (
                    SELECT 1 FROM condition_lines cl
                     WHERE cl.source_line_item_id = dli.capability_line_item_id)`
        );
        return res.json({ ok: true, dry_run: true, pending_delivery_events: pending.rows[0].n });
      }
      const evs = await query(
        `SELECT DISTINCT de.id
           FROM delivery_events de
           JOIN delivery_line_items dli ON dli.delivery_event_id = de.id
          ORDER BY de.id`
      );
      let added = 0;
      const touched: number[] = [];
      for (const e of evs.rows) {
        const n = await syncInspectionEventsForDelivery({ query }, Number(e.id));
        if (n > 0) { added += n; touched.push(Number(e.id)); }
      }
      res.json({
        ok: true,
        dry_run: false,
        delivery_events_scanned: evs.rows.length,
        events_added: added,
        touched,
      });
    } catch (error) {
      console.error("/api/admin/resync-inspection-events failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 過去分の命名を新ルールに統一する一括 backfill (冪等・dry-run 既定)。
   *
   * body:
   *   - dry_run (default true)   … true なら変更せず計画だけ返す
   *   - scope ("files"|"issues"|"both", default "both")
   *   - limit (number, 0=無制限) … files の処理上限 (段階適用用)
   *
   * files: documents.drive_link を持つ行の Drive ファイル名を
   *        buildDocumentFileName で再計算 (日付 = created_at, JST)。
   *        親番号命名の検収書/利用許諾料計算書は form_data.linked_contract_number を親に使う。
   * issues: Backlog 課題のうち summary が "【契約審査】" で始まるものの prefix だけを
   *        "【文書作成】" に置換 (本文・区切りは温存)。
   */
  app.post("/api/admin/backfill-naming", express.json(), async (req, res) => {
    const dryRun = req.body?.dry_run !== false; // 既定 dry-run
    const scope = String(req.body?.scope || "both");
    const limit = Number(req.body?.limit) || 0;
    const doFiles = scope === "files" || scope === "both";
    const doIssues = scope === "issues" || scope === "both";

    const result: any = { dry_run: dryRun, scope };

    // Backlog 課題一覧は files の取引先補完にも issues の改名にも使うので一度だけ取得。
    let _allIssues: any[] | null = null;
    const loadIssues = async (): Promise<any[]> => {
      if (_allIssues) return _allIssues;
      const acc: any[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await backlogService.searchIssues({ count: 100, offset });
        acc.push(...page);
        if (page.length < 100 || offset > 5000) break; // 安全弁
      }
      _allIssues = acc;
      return acc;
    };
    // "【...】<取引先>｜<文書種別>" の <取引先> を抽出 (全角/半角パイプ両対応)。
    const vendorFromSummary = (summary?: string): string | null => {
      if (typeof summary !== "string") return null;
      const m = summary.match(/】\s*([^｜|]+?)\s*[｜|]/);
      return m ? m[1].trim() || null : null;
    };

    try {
      // ---- 1. Drive ファイル名 ----
      if (doFiles) {
        const docs = await query(
          `SELECT id, document_number, template_type, drive_link, issue_key,
                  vendor_name_snapshot, base_document_number, form_data, created_at
             FROM documents
            WHERE drive_link IS NOT NULL AND drive_link <> ''
            ORDER BY id` + (limit > 0 ? ` LIMIT ${limit}` : "")
        );
        const files = {
          total: docs.rows.length,
          renamed: 0,
          failed: 0,
          skipped_external: 0,
          unresolved_vendor: 0,
          samples: [] as Array<{
            document_number: string;
            template_type: string;
            issue_key: string | null;
            vendor: string | null;
            new_name: string;
          }>,
          unresolved_samples: [] as Array<{
            document_number: string;
            template_type: string;
            issue_key: string | null;
            summary: string | null;
          }>,
          errors: [] as Array<{ document_number: string; error: string }>,
        };
        // issue_key → summary マップ (取引先補完用、遅延構築)。
        let issueMap: Map<string, string> | null = null;
        const ensureIssueMap = async (): Promise<Map<string, string>> => {
          if (!issueMap) {
            issueMap = new Map();
            for (const it of await loadIssues()) {
              if (it?.issueKey) issueMap.set(it.issueKey, it.summary);
            }
          }
          return issueMap;
        };
        for (const d of docs.rows) {
          const fd = d.form_data || {};
          // 取引先名: snapshot → form_data(生成時と同じキー群) → 取引先マスタ →
          //   Backlog 課題タイトルの取引先セグメント、の順で救済。
          let vendorName: string | null =
            d.vendor_name_snapshot ||
            fd.VENDOR_NAME ||
            fd.counterparty ||
            fd["Licensor_名称"] ||
            fd["Licensor_氏名会社名"] ||
            fd.licensor ||
            fd.PARTY_B_NAME ||
            fd.partyBName ||
            null;
          if (!vendorName) {
            // legacy bulk import 分は form_data に取引先が無いので
            // contract_capabilities → vendors を document_number で引いて救済。
            const vr = await query(
              `SELECT COALESCE(NULLIF(v.vendor_name,''), NULLIF(v.trade_name,''),
                               NULLIF(v.pen_name,'')) AS name
                 FROM contract_capabilities cc
                 JOIN vendors v ON v.id = cc.vendor_id
                WHERE cc.document_number = $1
                LIMIT 1`,
              [d.document_number]
            );
            vendorName = vr.rows[0]?.name || null;
          }
          if (!vendorName && d.issue_key) {
            // 最終手段: Backlog 課題タイトル "【…】<取引先>｜…" から抽出。
            const map = await ensureIssueMap();
            vendorName = vendorFromSummary(map.get(d.issue_key)) || null;
          }
          if (
            !vendorName &&
            d.issue_key &&
            String(d.template_type || "").includes("notice")
          ) {
            // 通知書は "[納品報告] <親PO> / <取引先名>" 形式で 】…｜ に合致しない。
            //   タイトル末尾(スラッシュ区切りの最後)を取引先として拾う。
            const s = (await ensureIssueMap()).get(d.issue_key);
            const tail = s && s.includes("/") ? s.split("/").pop()?.trim() : "";
            if (tail) vendorName = tail;
          }
          if (!vendorName) {
            files.unresolved_vendor++;
            if (files.unresolved_samples.length < 20) {
              const map = d.issue_key ? await ensureIssueMap() : null;
              files.unresolved_samples.push({
                document_number: d.document_number,
                template_type: String(d.template_type || ""),
                issue_key: d.issue_key || null,
                summary: (d.issue_key && map?.get(d.issue_key)) || null,
              });
            }
          }
          // 親文書番号(検収書/利用許諾料計算書のみ buildDocumentFileName が使用):
          //   form_data の明示リンク → ORDER_NO 系 → base_document_number。
          const parentDocNumber =
            String(
              fd.linked_contract_number || fd.ORDER_NO || fd.orderNumber || ""
            ).trim() ||
            (d.base_document_number &&
            d.base_document_number !== d.document_number
              ? String(d.base_document_number)
              : null) ||
            null;
          const newName = buildDocumentFileName(d.template_type, {
            documentNumber: d.document_number,
            vendorName,
            parentDocNumber,
            date: d.created_at ? new Date(d.created_at) : new Date(),
          });
          if (files.samples.length < 20)
            files.samples.push({
              document_number: d.document_number,
              template_type: String(d.template_type || ""),
              issue_key: d.issue_key || null,
              vendor: vendorName,
              new_name: newName,
            });
          // LegalOn Cloud 等の外部 SaaS 文書は Drive リネーム対象外。
          //   (drive_link が Google Drive/Docs 以外のホスト)
          const isExternal =
            !!d.drive_link &&
            !/(drive|docs)\.google\.com/.test(String(d.drive_link));
          if (isExternal) files.skipped_external++;
          if (dryRun || isExternal) continue;
          try {
            const r = await googleDriveService.renameFileVerbose(
              d.drive_link,
              newName
            );
            if (r.ok) files.renamed++;
            else {
              files.failed++;
              if (files.errors.length < 40)
                files.errors.push({
                  document_number: d.document_number,
                  error: r.error || "rename returned not-ok",
                });
            }
          } catch (err: any) {
            files.failed++;
            if (files.errors.length < 40)
              files.errors.push({
                document_number: d.document_number,
                error: err?.message || String(err),
              });
          }
        }
        result.files = files;
      }

      // ---- 2. Backlog 課題名 prefix ----
      if (doIssues) {
        const all = await loadIssues();
        const FROM = "【契約審査】";
        const TO = "【文書作成】";
        const targets = all.filter(
          (i: any) => typeof i?.summary === "string" && i.summary.startsWith(FROM)
        );
        const issues = {
          scanned: all.length,
          matched: targets.length,
          updated: 0,
          failed: 0,
          samples: [] as Array<{ key: string; from: string; to: string }>,
          errors: [] as Array<{ key: string; error: string }>,
        };
        for (const it of targets) {
          const newSummary = TO + it.summary.slice(FROM.length);
          if (issues.samples.length < 20)
            issues.samples.push({ key: it.issueKey, from: it.summary, to: newSummary });
          if (dryRun) continue;
          try {
            await backlogService.updateIssue(it.issueKey, { summary: newSummary });
            issues.updated++;
          } catch (err: any) {
            issues.failed++;
            issues.errors.push({ key: it.issueKey, error: err?.message || String(err) });
          }
        }
        result.issues = issues;
      }

      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[backfill-naming] failed:", err);
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

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

          // Phase 17v: form_data に vendor 情報が無い場合は contract_capabilities から拾う。
          //   旧 bulk import で form_data に vendor_code/vendor_name を入れて
          //   いなかったケースを救済する。
          // Phase 23: order_items → contract_capabilities (purchase_order)。
          //   vendor_code は vendor_id 経由で vendors テーブルから引く。
          if ((!vendorCode || vendorCode.toUpperCase() === "UNKNOWN") && !vendorName && d.issue_key) {
            const orderRes = await query(
              `SELECT v.vendor_code
                 FROM contract_capabilities cc
                 LEFT JOIN vendors v ON v.id = cc.vendor_id
                WHERE cc.backlog_issue_key = $1
                  AND cc.record_type = 'purchase_order'
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
          // Phase 25.6: 出版系を最優先で判定 (pub_license_terms は "license" を含む
          //   ため license 判定より前に分岐)。search-api の正仕様に合わせる。
          if (templateType.startsWith("pub_")) {
            recordType = templateType.startsWith("pub_master_")
              ? "master_contract"
              : "publication_condition";
          }
          // Phase 22.21.82: fee_statement テンプレ削除に伴い branch から除去
          else if (
            templateType.includes("license") ||
            templateType.includes("royalty")
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
              vendorId,
              recordType,
              // Phase 25.6: 出版系は publication。pub_license_terms の "license"
              //   含有による誤判定を避けるため startsWith("pub_") を先に評価。
              templateType.startsWith("pub_")
                ? "publication"
                : templateType.includes("license")
                ? "license"
                : "service",
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

  /**
   * F1b: A2 補修(締結文書の条件明細を form_data から再構成)。
   *   final/正本の発注書・条件書で condition_lines が無いものを対象に、
   *   form_data の line_items/items(発注書)・financial_conditions(条件書)を
   *   正準永続化関数 upsertCapabilityLineItems / upsertCapabilityFinancialConditions に
   *   渡す。両者は末尾で syncConditionLinesForCapability を呼ぶため condition_lines が
   *   生成される。capability が無い文書は form_data から最小ヘッダを作ってから永続化。
   *
   *   ※ upsert 系は query(プール)直書きで rollback できないため、dry_run は書き込まない
   *      「浅いプレビュー」(各文書ごとに再構成予定の件数を返す)。冪等(line_no/condition_no
   *      と source_* で二重生成しない)なので apply の再実行も安全。
   *   body: { dry_run?: boolean }  (既定 true)
   */
  app.post("/api/admin/backfill-contract-lines-from-formdata", express.json(), async (req, res) => {
    const dryRun = req.body?.dry_run !== false;
    const CONTRACTING = [
      "purchase_order",
      "intl_purchase_order",
      "individual_license_terms",
      "pub_license_terms",
    ];
    try {
      const docs = await query(
        `SELECT d.id, d.document_number, d.issue_key, d.template_type, d.form_data,
                d.drive_link, d.base_document_number, cc.id AS capability_id
           FROM documents d
           LEFT JOIN contract_capabilities cc
             ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
           LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
          WHERE d.template_type = ANY($1::text[])
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND cl.id IS NULL
          ORDER BY d.created_at DESC NULLS LAST`,
        [CONTRACTING]
      );

      const reconstructed: any[] = [];
      const skipped: any[] = [];
      let conditionLinesTotal = 0;

      for (const d of docs.rows) {
        const fd = d.form_data || {};
        const lineItems =
          Array.isArray(fd.line_items) && fd.line_items.length
            ? fd.line_items
            : Array.isArray(fd.items) && fd.items.length
            ? fd.items
            : null;
        const finConds =
          Array.isArray(fd.financial_conditions) && fd.financial_conditions.length
            ? fd.financial_conditions
            : null;
        // Stage D: v3(マトリクス)文書は financial_conditions ではなく v3_conds を持つ。
        const v3Conds =
          Array.isArray(fd.v3_conds) && fd.v3_conds.length ? fd.v3_conds : null;

        if (!lineItems && !finConds && !v3Conds) {
          skipped.push({
            document_number: d.document_number,
            issue_key: d.issue_key,
            template_type: d.template_type,
            reason: "form_data に line_items/financial_conditions/v3_conds が無い",
          });
          continue;
        }

        if (dryRun) {
          reconstructed.push({
            document_number: d.document_number,
            issue_key: d.issue_key,
            template_type: d.template_type,
            will_create_capability: !d.capability_id,
            line_items: lineItems?.length || 0,
            financial_conditions: finConds?.length || 0,
            v3_conds: v3Conds?.length || 0,
          });
          continue;
        }

        try {
          let capId: number | null = d.capability_id || null;

          // capability が無ければ form_data から最小ヘッダを作る。
          if (!capId) {
            const templateType = String(d.template_type || "");
            const category = templateType.startsWith("pub_")
              ? "publication"
              : templateType.includes("license")
              ? "license"
              : "service";
            const recordType =
              templateType.startsWith("pub_")
                ? "publication_condition"
                : templateType.includes("license")
                ? "license_condition"
                : "purchase_order";
            // capability の document_number は A2 join キー(base 優先)に合わせる。
            const capDocNo =
              d.base_document_number && String(d.base_document_number).trim() !== ""
                ? d.base_document_number
                : d.document_number;

            // vendor 解決(best-effort)。見つからなければ NULL(A4 補完に委ねる)。
            let vendorId: number | null = null;
            const vCode = String(fd.VENDOR_CODE || fd.vendorCode || "").trim();
            const vName = String(
              fd.VENDOR_NAME || fd.PARTY_B_NAME || fd.partyBName || ""
            ).trim();
            if (vCode && vCode.toUpperCase() !== "UNKNOWN") {
              const r = await query(
                "SELECT id FROM vendors WHERE vendor_code = $1 LIMIT 1",
                [vCode]
              );
              if (r.rows[0]) vendorId = Number(r.rows[0].id);
            }
            if (!vendorId && vName) {
              const r = await query(
                "SELECT id FROM vendors WHERE vendor_name = $1 OR trade_name = $1 OR pen_name = $1 LIMIT 1",
                [vName]
              );
              if (r.rows[0]) vendorId = Number(r.rows[0].id);
            }

            const ins = await query(
              `INSERT INTO contract_capabilities
                 (vendor_id, record_type, contract_category, contract_type, contract_title,
                  document_number, base_document_number, backlog_issue_key, contract_status,
                  effective_date, expiration_date, document_url, source_system)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'executed',$9,$10,$11,'f1b-backfill')
               RETURNING id`,
              [
                vendorId,
                recordType,
                category,
                templateType,
                fd.CONTRACT_TITLE || fd.contract_title || fd.summary || fd.PROJECT_TITLE || capDocNo,
                capDocNo,
                d.base_document_number || capDocNo,
                d.issue_key || null,
                fd.EFFECTIVE_DATE || fd.effectiveDate || null,
                fd.EXPIRATION_DATE || fd.expirationDate || null,
                d.drive_link || "",
              ]
            );
            capId = Number(ins.rows[0].id);
          }

          if (lineItems) await upsertCapabilityLineItems(capId!, lineItems);
          if (finConds) await upsertCapabilityFinancialConditions(capId!, finConds);
          // Stage D: v3(マトリクス)文書は登録ロジック(C-2)と同じ経路で
          //   cfc + condition_lines + 作品連動を復元する。ledger_code は capability の
          //   ledger_ref_id から best-effort(取れなくても cfc/condition_lines は作る)。
          if (v3Conds) {
            let ledgerCodeForV3: string | null = null;
            try {
              const lc = await query(
                `SELECT l.ledger_code FROM contract_capabilities cc
                   JOIN ledgers l ON l.id = cc.ledger_ref_id
                  WHERE cc.id = $1 LIMIT 1`,
                [capId]
              );
              ledgerCodeForV3 = lc.rows[0]?.ledger_code || null;
            } catch (e: any) {
              console.warn(`[F1b v3] ledger_code lookup skipped:`, e?.message || e);
            }
            await registerV3MatrixConditions({
              capabilityId: capId!,
              ledgerCode: ledgerCodeForV3,
              ownWorkId:
                fd.linked_work_id != null &&
                String(fd.linked_work_id).trim() !== "" &&
                Number.isFinite(Number(fd.linked_work_id))
                  ? Number(fd.linked_work_id)
                  : null,
              conds: v3Conds,
              lcs: Array.isArray(fd.v3_lcs) ? fd.v3_lcs : [],
              anchorMaterialCode: fd.素材番号 || null,
              conditionMaterialCodes: (fd.condition_material_codes || {}) as Record<
                string,
                string
              >,
            });
          }
          // 念のため condition_lines 同期(各 upsert 内で呼ばれるが冪等)。
          await safeSync("F1b CL", () =>
            syncConditionLinesForCapability({ query }, capId!)
          );

          const cnt = await query(
            `SELECT COUNT(*)::int AS n FROM condition_lines WHERE capability_id = $1`,
            [capId]
          );
          const made = Number(cnt.rows[0]?.n || 0);
          conditionLinesTotal += made;
          reconstructed.push({
            document_number: d.document_number,
            issue_key: d.issue_key,
            template_type: d.template_type,
            capability_id: capId,
            created_capability: !d.capability_id,
            condition_lines: made,
          });
        } catch (e: any) {
          skipped.push({
            document_number: d.document_number,
            issue_key: d.issue_key,
            template_type: d.template_type,
            reason: String(e?.message || e),
          });
        }
      }

      res.json({
        ok: true,
        dry_run: dryRun,
        documents_total: docs.rows.length,
        reconstructed: reconstructed.length,
        skipped: skipped.length,
        condition_lines: conditionLinesTotal,
        detail: { reconstructed, skipped },
      });
    } catch (error: any) {
      console.error("/api/admin/backfill-contract-lines-from-formdata failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  /**
   * 締結明細の「再同期」修復: capability_line_items を失った契約を form_data から
   *   復元する。発注書の reopen 再保存バグ(空プルーンが生 formData.items を見て
   *   capability_line_items を誤削除)で、capability_line_items=0 だが孤児の
   *   condition_lines が残るケースを是正する。
   *
   *   対象: final/正本の締結文書で capability あり・capability_line_items=0・
   *         form_data に line_items/items がある。
   *   手順(各契約): condition_events を持つ明細があれば触らず skip(履歴保全)。
   *         無ければ孤児 condition_lines(events無)を削除してから
   *         upsertCapabilityLineItems で capability_line_items + condition_lines を
   *         クリーンに再生成(重複防止)。
   *   dry_run(既定 true): 書き込まず対象を返す。冪等。
   *   body: { dry_run?: boolean, document_number?: string }(document_number 指定で1件のみ)
   */
  app.post("/api/admin/resync-contract-line-items", express.json(), async (req, res) => {
    const dryRun = req.body?.dry_run !== false;
    const onlyDoc = req.body?.document_number ? String(req.body.document_number).trim() : "";
    const CONTRACTING = [
      "purchase_order",
      "intl_purchase_order",
      "individual_license_terms",
      "pub_license_terms",
    ];
    try {
      const targets = (
        await query(
          `SELECT d.document_number, d.issue_key, d.form_data, cc.id AS capability_id
             FROM documents d
             JOIN contract_capabilities cc
               ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
            WHERE d.template_type = ANY($1::text[])
              AND COALESCE(d.lifecycle_status, 'final') = 'final'
              AND COALESCE(d.is_primary, TRUE) = TRUE
              AND ($2 = '' OR d.document_number = $2)
              -- バルク自動検出(document_number 未指定)時のみ「明細欠落」条件で絞る。
              --   document_number 指定時は強制復旧(下の events 安全弁は維持)。
              AND ($2 <> '' OR NOT EXISTS (SELECT 1 FROM capability_line_items li WHERE li.capability_id = cc.id))
              AND ($2 <> '' OR EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.capability_id = cc.id))
            ORDER BY d.created_at DESC NULLS LAST`,
          [CONTRACTING, onlyDoc]
        )
      ).rows;

      const resynced: any[] = [];
      const skipped: any[] = [];

      for (const t of targets) {
        const fd = t.form_data || {};
        const lineItems =
          Array.isArray(fd.line_items) && fd.line_items.length
            ? fd.line_items
            : Array.isArray(fd.items) && fd.items.length
            ? fd.items
            : null;
        if (!lineItems) {
          skipped.push({ document_number: t.document_number, reason: "form_data に line_items/items 無し" });
          continue;
        }
        // events を持つ明細があるなら履歴保全のため触らない。
        const hasEvents = Number(
          (
            await query(
              `SELECT COUNT(*)::int AS n
                 FROM condition_events ce
                 JOIN condition_lines cl ON cl.id = ce.condition_line_id
                WHERE cl.capability_id = $1 AND ce.voided_at IS NULL`,
              [t.capability_id]
            )
          ).rows[0].n
        );
        if (hasEvents > 0) {
          skipped.push({ document_number: t.document_number, reason: `実績(condition_events)があるため手動対応(events=${hasEvents})` });
          continue;
        }

        if (dryRun) {
          const orphan = Number(
            (await query(`SELECT COUNT(*)::int AS n FROM condition_lines WHERE capability_id = $1`, [t.capability_id])).rows[0].n
          );
          resynced.push({
            document_number: t.document_number,
            issue_key: t.issue_key,
            capability_id: t.capability_id,
            line_items: lineItems.length,
            orphan_condition_lines_to_clear: orphan,
          });
          continue;
        }

        try {
          // 孤児 condition_lines(events無・成果物紐付け無)を削除。
          await query(
            `DELETE FROM condition_lines cl
              WHERE cl.capability_id = $1
                AND NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.condition_line_id = cl.id)
                AND NOT EXISTS (SELECT 1 FROM work_component_lines wcl WHERE wcl.condition_line_id = cl.id)`,
            [t.capability_id]
          );
          // form_data の明細から capability_line_items + condition_lines を再生成。
          await upsertCapabilityLineItems(Number(t.capability_id), lineItems);
          // capability が課題に未連結なら文書の issue_key で補完する。
          //   検収待ち/management line-items 等は cc.backlog_issue_key で絞るため、
          //   未連結だと capability_line_items があっても表示されない。
          await query(
            `UPDATE contract_capabilities
                SET backlog_issue_key = $2, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND NULLIF(backlog_issue_key, '') IS NULL`,
            [t.capability_id, t.issue_key || null]
          );
          const made = Number(
            (await query(`SELECT COUNT(*)::int AS n FROM condition_lines WHERE capability_id = $1`, [t.capability_id])).rows[0].n
          );
          const liCount = Number(
            (await query(`SELECT COUNT(*)::int AS n FROM capability_line_items WHERE capability_id = $1`, [t.capability_id])).rows[0].n
          );
          resynced.push({
            document_number: t.document_number,
            issue_key: t.issue_key,
            capability_id: t.capability_id,
            capability_line_items: liCount,
            condition_lines: made,
          });
        } catch (e: any) {
          skipped.push({ document_number: t.document_number, reason: String(e?.message || e) });
        }
      }

      res.json({
        ok: true,
        dry_run: dryRun,
        documents_total: targets.length,
        resynced: resynced.length,
        skipped: skipped.length,
        detail: { resynced, skipped },
      });
    } catch (error: any) {
      console.error("/api/admin/resync-contract-line-items failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  /**
   * F2b(ハイブリッド・royalty 側のみ): A3 のうち計算書(royalty_statement /
   *   license_calculation_sheet)で condition_events が無いものを form_data から復元。
   *   検収側(inspection_certificate)は delivery_events 再構成が必要で legacy 受容(対象外)。
   *
   *   方式: 対象文書 d.id が既知なので syncRoyaltyCalcEvent の文書解決(form_data の
   *   camelCase キー依存で孤立文書は解決不可)は使わず、
   *     1) form_data.capability_financial_condition_id の財務条件 → 親 capability を
   *        syncConditionLinesForCapability で同期し condition_line を確保、
   *     2) その condition_line に royalty_calc の condition_event を d.id 直結で INSERT。
   *   condition_events.source_royalty_calculation_id は使わず document_id で冪等判定。
   *   重複排除: (財務条件, period, 金額)でグループ化し、同一計算を重複 final 保存した
   *     余剰文書(同 fc/同額/同期で period 無し等)は 1 event に集約、余剰は superseded 化。
   *   dry_run(既定 true): 書き込まず、グループごとの代表/重複/event 予定を返す。
   *   body: { dry_run?: boolean }
   */
  app.post("/api/admin/backfill-royalty-events-from-formdata", express.json(), async (req, res) => {
    const dryRun = req.body?.dry_run !== false;
    const ROYALTY_TEMPLATES = ["royalty_statement", "license_calculation_sheet"];
    const num = (v: any) => {
      if (v == null || v === "") return null;
      const n = Number(String(v).replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    try {
      const docs = await query(
        `SELECT d.id, d.document_number, d.issue_key, d.template_type, d.form_data, d.created_at
           FROM documents d
          WHERE d.template_type = ANY($1::text[])
            AND COALESCE(d.lifecycle_status, 'final') = 'final'
            AND COALESCE(d.is_primary, TRUE) = TRUE
            AND NOT EXISTS (SELECT 1 FROM condition_events ce WHERE ce.document_id = d.id)
          ORDER BY d.created_at DESC NULLS LAST`,
        [ROYALTY_TEMPLATES]
      );

      type RDoc = {
        id: number; document_number: string; issue_key: string | null; created_at: any;
        fcId: number; capId: number; amount: number; period: string | null;
        mg: number | null; ag: number | null;
      };
      const skipped: any[] = [];
      // (財務条件, period, 金額)でグループ化。同一計算の重複文書(同 fc/同額/同期で
      //   period 無し)を 1 event に集約し、重複の余剰文書は superseded 化する。
      const groups = new Map<string, RDoc[]>();
      for (const d of docs.rows) {
        const fd = d.form_data || {};
        const fcId =
          Number(fd.capability_financial_condition_id || fd.capabilityFinancialConditionId || 0) || null;
        if (!fcId) {
          skipped.push({ document_number: d.document_number, issue_key: d.issue_key, reason: "form_data に capability_financial_condition_id が無い" });
          continue;
        }
        const fcRow = (
          await query(`SELECT capability_id FROM capability_financial_conditions WHERE id = $1`, [fcId])
        ).rows[0];
        if (!fcRow) {
          skipped.push({ document_number: d.document_number, issue_key: d.issue_key, reason: `financial_condition ${fcId} が存在しない` });
          continue;
        }
        const amount = num(fd.actualRoyalty ?? fd.actual_royalty) || 0;
        const period = fd.period || null;
        const rd: RDoc = {
          id: d.id, document_number: d.document_number, issue_key: d.issue_key, created_at: d.created_at,
          fcId, capId: Number(fcRow.capability_id), amount, period,
          mg: num(fd.mgAmount ?? fd.mg_consumed_this_time), ag: num(fd.agAmount ?? fd.ag_consumed_this_time),
        };
        const key = `${fcId}|${period || ""}|${amount}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(rd);
      }

      const planned: any[] = [];
      let eventsTotal = 0;
      let dupSuperseded = 0;

      for (const members of groups.values()) {
        // 代表 = created_at 最新(同点は id 最大)。残りは重複。
        members.sort((a, b) => {
          const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tb - ta || b.id - a.id;
        });
        const canonical = members[0];
        const dups = members.slice(1);

        if (dryRun) {
          planned.push({
            canonical: canonical.document_number, issue_key: canonical.issue_key,
            capability_financial_condition_id: canonical.fcId, amount: canonical.amount, period: canonical.period,
            will_create_event: true, duplicates_superseded: dups.map((x) => x.document_number),
          });
          eventsTotal += 1;
          dupSuperseded += dups.length;
          continue;
        }

        try {
          // 1) 財務条件 → condition_line を確保(冪等)。
          await safeSync("F2b CL", () => syncConditionLinesForCapability({ query }, canonical.capId));
          const cl = (
            await query(`SELECT id FROM condition_lines WHERE source_condition_id = $1 ORDER BY id LIMIT 1`, [canonical.fcId])
          ).rows[0];
          if (!cl) {
            skipped.push({ document_number: canonical.document_number, issue_key: canonical.issue_key, reason: `fc ${canonical.fcId} の condition_line を生成できず` });
            continue;
          }

          // 2) 代表文書に royalty_calc event を直結 INSERT(冪等: doc 単位)。
          const already = (await query(`SELECT 1 FROM condition_events WHERE document_id = $1 LIMIT 1`, [canonical.id])).rows[0];
          if (!already) {
            const eventNo = Number(
              (await query(`SELECT COALESCE(MAX(event_no), 0) + 1 AS n FROM condition_events WHERE condition_line_id = $1`, [cl.id])).rows[0].n
            );
            await query(
              `INSERT INTO condition_events
                 (condition_line_id, event_no, event_type, document_id, backlog_issue_key,
                  occurred_at, period, amount_ex_tax, mg_consumed_this_time, ag_consumed_this_time)
               VALUES ($1, $2, 'royalty_calc', $3, $4, $5, $6, $7, $8, $9)`,
              [cl.id, eventNo, canonical.id, canonical.issue_key || null, canonical.created_at, canonical.period, canonical.amount, canonical.mg, canonical.ag]
            );
            eventsTotal += 1;
          }

          // 3) 重複の余剰文書を superseded 化(同 fc/同額/同期の重複と確認済)。
          for (const dup of dups) {
            const r = await query(
              `UPDATE documents
                  SET lifecycle_status = 'superseded', is_primary = FALSE,
                      superseded_by = COALESCE(NULLIF(superseded_by, ''), $2)
                WHERE id = $1 AND COALESCE(lifecycle_status, 'final') = 'final'`,
              [dup.id, canonical.document_number]
            );
            dupSuperseded += r.rowCount || 0;
          }

          planned.push({
            canonical: canonical.document_number, issue_key: canonical.issue_key, condition_line_id: cl.id,
            amount: canonical.amount, duplicates_superseded: dups.map((x) => x.document_number),
          });
        } catch (e: any) {
          skipped.push({ document_number: canonical.document_number, issue_key: canonical.issue_key, reason: String(e?.message || e) });
        }
      }

      res.json({
        ok: true,
        dry_run: dryRun,
        documents_total: docs.rows.length,
        groups: groups.size,
        events: eventsTotal,
        duplicates_superseded: dupSuperseded,
        skipped: skipped.length,
        detail: { planned, skipped },
      });
    } catch (error: any) {
      console.error("/api/admin/backfill-royalty-events-from-formdata failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  /**
   * 検収書の事前 overflow チェック。検収書を確定保存する前に必ず叩く。
   * body:
   *   {
   *     lines: [
   *       { capability_line_item_id (旧 order_line_item_id), inspected_quantity, acceptance_ratio }
   *     ]
   *   }
   * 1 件でも will_overflow_* が true なら、フロントは送信ボタンを
   * 無効化し warning を出す。
   *
   * Phase 23: 旧フィールド名 order_line_item_id も後方互換で受け付ける。
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
   *       { capability_line_item_id (旧 order_line_item_id),
   *         inspected_quantity, acceptance_ratio, rejection_reason }
   *     ]
   *   }
   * 既存の同じ (delivery_event_id, capability_line_item_id) は上書き。
   *
   * Phase 23: order_line_items → capability_line_items にスキーマ移行。
   *   delivery_line_items.order_line_item_id は capability_line_item_id に
   *   切替 (列追加は Phase 23 マイグレーション済)。旧フィールド名も受付。
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
            capability_line_item_id: Number(
              l.capability_line_item_id ?? l.order_line_item_id
            ),
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
          const capLineId = Number(
            l.capability_line_item_id ?? l.order_line_item_id
          );
          const qty = Number(l.inspected_quantity) || 0;
          const ratio =
            l.acceptance_ratio == null ? 1.0 : Number(l.acceptance_ratio);

          // unit_price を引いて金額計算 (Phase E-2: condition_lines 優先 dual-read)
          const econ = await getOrderedLineEconomics(capLineId);
          const unitPrice = econ?.unit_price || 0;
          const amount = calculateInspectedAmount(unitPrice, qty, ratio);

          await query(
            `INSERT INTO delivery_line_items (
               delivery_event_id, capability_line_item_id, inspected_quantity,
               acceptance_ratio, inspected_amount_ex_tax, rejection_reason
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (delivery_event_id, capability_line_item_id) DO UPDATE SET
               inspected_quantity = EXCLUDED.inspected_quantity,
               acceptance_ratio = EXCLUDED.acceptance_ratio,
               inspected_amount_ex_tax = EXCLUDED.inspected_amount_ex_tax,
               rejection_reason = EXCLUDED.rejection_reason`,
            [
              deliveryEventId,
              capLineId,
              qty,
              ratio,
              amount,
              l.rejection_reason || null,
            ]
          );
        }

        // Phase C-5: 新スキーマへ非致命で二重書き込み。
        //   親 capability の condition_lines を用意 → 検収 events を起票。
        //   condition_line / 検収書 document が未解決なら skip (既存挙動に無影響)。
        const capRow = await query(
          "SELECT capability_id FROM delivery_events WHERE id = $1",
          [deliveryEventId]
        );
        const capId = Number(capRow.rows[0]?.capability_id);
        if (capId)
          await safeSync("CL(capability)", () =>
            syncConditionLinesForCapability({ query }, capId)
          );
        await safeSync("inspection events", () =>
          syncInspectionEventsForDelivery({ query }, deliveryEventId)
        );

        res.json({ ok: true, line_count: lines.length });
      } catch (error) {
        console.error("/api/delivery-events/:id/line-items failed:", error);
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
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
    // Phase 22.21.117: legacy 5 桁数字も受け入れて R- / B- にあたる行を探す
    const rawNums = String(ringiNumbersStr)
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => DECISION_NUM_RE.test(s) || RINGI_NUM_RE.test(s));
    if (rawNums.length === 0) return { linked, not_found };
    await query(
      `DELETE FROM ringi_documents WHERE document_id = $1`,
      [documentId]
    );
    for (const num of Array.from(new Set(rawNums))) {
      // 候補リストを構築: 完全一致優先、5 桁数字なら R-/B- 両方試す
      const candidates: string[] = DECISION_NUM_RE.test(num)
        ? [num]
        : [`R-${num}`, `B-${num}`];
      const r = await query(
        `SELECT id, ringi_number FROM ringi_records
          WHERE ringi_number = ANY($1::text[])
          LIMIT 1`,
        [candidates]
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
      linked.push(r.rows[0].ringi_number);
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
  function csvEscape(value: any): string {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(headers: string[], rows: Array<Record<string, any>>): string {
    return [
      headers.map(csvEscape).join(","),
      ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
    ].join("\r\n");
  }

  function parseBoolFlag(raw: any, defaultValue = false): boolean {
    if (raw === undefined || raw === null || raw === "") return defaultValue;
    const s = String(raw).trim().toLowerCase();
    // Phase 22.21.74: 日本語の falsy 値も認識。
    //   manual 上で "作成済" を「PDF 生成をスキップ」と謳っていたが、旧実装では
    //   falsy リストに無く true 判定されていた drift を解消。
    //   他に 済 / 完了 / 不要 / skip / no も追加 (ユーザー入力ゆらぎ対応)。
    return !["false", "no", "0", "off", "done", "created", "skip",
             "作成済", "作成済み", "済", "済み", "完了", "不要", "いいえ"].includes(s);
  }

  async function maybeGeneratePdfForImport(
    templateType: string,
    documentNumber: string,
    issueKey: string,
    rawDataIn: Record<string, any>,
    staffInfo: any
  ): Promise<{ generated: boolean; drive_link: string; error?: string }> {
    try {
      // Step1(SSOT): 別名キーを揃える。発注書PDFは {{#each items}} を読むため、
      //   インポートで line_items しか無い文書でも items を補完して明細表が出るようにする。
      const rawData = normalizeDocumentFormData(templateType, rawDataIn);
      // Phase 17i: 経費合計をサーバ側で再計算 (テンプレ {{expensesTotalIncTax}} 用)
      const bulkExpenses = Array.isArray(rawData?.expenses) ? rawData.expenses : [];
      const bulkExpensesTotal = bulkExpenses.reduce(
        (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
        0
      );

      // 件名(PROJECT_TITLE)と発注日は、インポート文書だと form_data に無く
      //   contract_capabilities 側にあることがあるため、足りなければ DB から補完する。
      const toDateStr = (d: any): string => {
        if (!d) return "";
        if (typeof d === "string") return d.slice(0, 10);
        try {
          return new Date(d).toISOString().slice(0, 10);
        } catch {
          return "";
        }
      };
      let projectTitle =
        rawData.PROJECT_TITLE ||
        rawData.CONTRACT_TITLE ||
        rawData.contract_title ||
        rawData.description ||
        "";
      // 発注日: form_data の 発注日 / order_date を優先、無ければ capability。
      let orderPoDate = toDateStr(rawData["発注日"] || rawData.order_date || "");
      if (!projectTitle || !orderPoDate) {
        try {
          const capT = await query(
            `SELECT contract_title, issue_date_po FROM contract_capabilities
              WHERE document_number = $1 LIMIT 1`,
            [documentNumber]
          );
          if (!projectTitle)
            projectTitle = capT.rows[0]?.contract_title || "";
          if (!orderPoDate)
            orderPoDate = toDateStr(capT.rows[0]?.issue_date_po);
        } catch {
          /* noop: 補完の失敗は PDF 生成自体を止めない */
        }
      }
      // 発行日(ORDER_DATE)は作成日(今日)を既定とする(空だと PDF が空欄になるため)。
      const issueDate = toDateStr(rawData.ORDER_DATE) || toDateStr(new Date());

      const details = {
        ...rawData,
        ...staffInfo,
        expenses: bulkExpenses,
        expensesTotalIncTax: bulkExpensesTotal,
        DOC_NO: documentNumber,
        ORDER_NO: documentNumber,
        PROJECT_TITLE: projectTitle,
        ORDER_DATE: issueDate,
        発注日: orderPoDate,
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

  // -----------------------------------------------------------------
  // Phase 23.0 — 統一インポートAPI (v2)。
  //   全 record_type を 1 つのエンドポイントで受け、contract_capabilities
  //   + capability_line_items + capability_financial_conditions + 経費 +
  //   その他手数料 + documents + external_assets を一括 upsert する。
  //
  //   以下の旧APIは Phase 23.1 で物理削除予定:
  //     - /api/imports/order
  //     - /api/imports/license-contract
  //     - /api/imports/license-master
  //     - /api/imports/service-master
  //     - /api/imports/bulk/order
  //     - /api/imports/bulk/license-contract
  //     - /api/imports/bulk/license-master
  //     - /api/imports/bulk/service-master
  //     - /api/imports/bulk/service-contract
  //     - /api/imports/bulk/nda
  //     - /api/imports/bulk/sales-master
  //   検収書 (inspection) と 稟議 (ringi) のバルクは contract_capabilities
  //   とは別テーブル運用なので legacy のまま維持する。
  // -----------------------------------------------------------------
  registerImportsV2(app, {
    query,
    pool,
    getNewDocumentNumber,
    resolveVendorIdForImport: resolveVendorIdForImport_,
    linkRingiByDocNumber,
    requirePortalSecret,
  });

  // 汎用スキーマ駆動 CSV 取込（全テーブル＋互換ビュー）。/api/imports/tables*
  registerGenericImport(app, { query, requirePortalSecret });

  // データモデル整理: 連結チェック＆修復ツール (整合性点検 / 安全な修復)
  registerDataLinkage(app, { query, pool });

  // 新課題(統一課題)導出API。docs/design/unified-issue-ui-plan.md
  registerUnifiedIssues(app, { query });
  registerMatters(app, { query });

  // 関連当事者取引 判定 (/rpt/*): RPT.gs の書込 (法人/役員/株主構成/議案)。読取は search-API。
  registerRelatedParty(app, { query, pool });

  // C2: search-api からの read 移植(master / backlog / management / 他)を worker に登録。
  registerSharedReads(app, { query, backlogService, requirePortalSecret });
  // C2 batch 3b: backlog form-context / history(byte-exact 移植)。
  registerFormReadRoutes(app, { query, backlogService });

  /**
   * Bulk import: 業務委託基本契約書 (service_master)。
   * 1 行 = 1 doc。
   */
  app.post(
    "/api/imports/bulk/service-master",
    requirePortalSecret,
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
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
   * Phase 22.21.113: 業務委託 個別/単独契約 (= 検収書 自動補完用 業務明細付き)
   * のバルクインポート。1 グループ (import_key) = 1 contract_capabilities +
   * N capability_line_items。
   *
   *   record_type 列で individual_contract / standalone_contract を切替。
   *   parent_master_number 列が入っていれば individual_contract の親紐付け
   *   情報 (master 検索時の hint) として form_data に格納。
   *
   *   後段の検収書フォームは Legal Asset Search で service master を選ぶと
   *   この行の capability_line_items を order_lines_for_inspection に
   *   流し込む。発注書を経由しなくても検収書を出せる。
   */
  app.post(
    "/api/imports/bulk/service-contract",
    requirePortalSecret,
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
            const recordType =
              first.record_type === "individual_contract" ||
              first.record_type === "standalone_contract"
                ? first.record_type
                : "standalone_contract";
            const contractNumber =
              first.contract_number &&
              String(first.contract_number).trim().length > 0
                ? String(first.contract_number).trim()
                : await getNewDocumentNumber("service_master");

            const vendorId = await resolveVendorIdForImport_(
              first.vendor_code,
              first.vendor_name
            );

            // 1) contract_capabilities (service / individual or standalone) を upsert
            const ccRes = await query(
              `INSERT INTO contract_capabilities (
                 vendor_id, record_type, contract_category, contract_type, contract_title,
                 document_number, contract_status, effective_date, expiration_date,
                 auto_renewal, source_system
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               RETURNING id`,
              [
                vendorId,
                recordType,
                "service",
                recordType === "standalone_contract"
                  ? "service_standalone"
                  : "service_individual",
                first.contract_title ||
                  first.item_name ||
                  contractNumber,
                contractNumber,
                "executed",
                first.effective_date || null,
                first.expiration_date || null,
                first.auto_renewal === "true" ||
                  first.auto_renewal === true ||
                  false,
                "import-bulk-service-contract",
              ]
            );
            const capId = Number(ccRes.rows[0].id);

            // 2) capability_line_items を一括 upsert
            // Phase 22.21.114: category / payment_method 列は CSV テンプレから
            //   削除済み。DB schema には列が残っているが空文字で埋める
            //   (発注書 LineItemTable と整合)。
            //   payment_terms は 契約種別 ("請負" or "準委任") のみ受け入れる。
            const lineItems = groupRows
              .filter((r: any) => Number(r.line_no) > 0)
              .map((r: any) => ({
                line_no: Number(r.line_no),
                category: "", // 撤去 — 旧 CSV 互換のため key だけ残す
                item_name: r.item_name || "",
                spec: r.spec || "",
                calc_method: r.calc_method || "FIXED",
                payment_method: "", // 撤去 (deprecated)
                payment_terms:
                  r.payment_terms === "請負" || r.payment_terms === "準委任"
                    ? r.payment_terms
                    : "", // 想定外の値はエラーにせず空に
                quantity: r.quantity,
                unit_price: r.unit_price,
                amount_ex_tax:
                  r.amount_ex_tax ||
                  (Number(r.quantity) && Number(r.unit_price)
                    ? Math.round(Number(r.quantity) * Number(r.unit_price))
                    : null),
                delivery_date: r.delivery_date || null,
                payment_date: r.payment_date || null,
                cycle: r.cycle || null,
                billing_day: r.billing_day || null,
                term_start: r.term_start || null,
                term_end: r.term_end || null,
              }));
            await upsertCapabilityLineItems(capId, lineItems);

            // 3) documents 行も登録 (template_type='service_master' で一覧に出す)
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
                first.issue_key ||
                  `IMPORT-${Date.now()}-${succeeded.length + failed.length}`,
                "service_master",
                JSON.stringify({
                  ...first,
                  record_type: recordType,
                  parent_master_number: first.parent_master_number || "",
                  line_items: lineItems,
                  __imported: true,
                  __bulk: true,
                }),
                first.drive_link || "",
                "import-bulk",
              ]
            );

            // 4) 稟議番号紐付け
            await linkRingiByDocNumber(contractNumber, first.ringi_numbers);

            succeeded.push({
              import_key: importKey,
              capability_id: capId,
              contract_number: contractNumber,
              record_type: recordType,
              line_item_count: lineItems.length,
            });
          } catch (e: any) {
            console.error(
              `/api/imports/bulk/service-contract group=${importKey} failed:`,
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
        console.error("/api/imports/bulk/service-contract failed:", error);
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
    requirePortalSecret,
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
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
    requirePortalSecret,
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
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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

  // Phase 22.21.117: 決裁種別 (ringi / board_resolution) で番号フォーマットを切替。
  //   - 旧: 5 桁数字 ("00001")
  //   - 新: "R-NNNNN" (稟議) / "B-NNNNN" (取締役会)
  //   入力としては legacy 5 桁も受け付け、decision_type に応じて自動プレフィックス。
  const RINGI_NUM_RE = /^[0-9]{5}$/; // legacy 入力検証用
  const DECISION_NUM_RE = /^(R|B)-[0-9]{5}$/;

  // 5 桁数字 or プレフィックス付き どちらでも受け取り、正規化された
  //   "R-NNNNN" / "B-NNNNN" を返す。失敗時は null。
  const normalizeDecisionNumber = (
    raw: string,
    type: "ringi" | "board_resolution" = "ringi"
  ): string | null => {
    const s = String(raw || "").trim().toUpperCase();
    if (DECISION_NUM_RE.test(s)) return s;
    if (RINGI_NUM_RE.test(s)) {
      const prefix = type === "board_resolution" ? "B" : "R";
      return `${prefix}-${s}`;
    }
    return null;
  };

  // 番号から decision_type を推定 (プレフィックス文字から)
  const inferDecisionType = (
    code: string
  ): "ringi" | "board_resolution" | null => {
    const s = String(code || "").trim().toUpperCase();
    if (s.startsWith("R-")) return "ringi";
    if (s.startsWith("B-")) return "board_resolution";
    return null;
  };

  /**
   * 稟議の autocomplete / 検索。
   *   q: 5 桁数字 (前方一致) or title 部分一致
   */
  app.get("/api/ringi/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      // Phase 22.21.116: 検索 endpoint で全フィールド + 紐付き文書数を返す。
      //   旧呼び出し側 (RingiSelector) は ringi_number / title / category /
      //   status / owner_name のみ参照するので互換性あり。
      const sql = q
        ? `SELECT r.id, r.ringi_number, r.decision_type, r.title, r.category, r.owner_name,
                  r.owner_department, r.approved_at, r.backlog_issue_key,
                  r.status, r.total_budget, r.remarks,
                  r.created_at, r.updated_at,
                  COALESCE(
                    (SELECT COUNT(*)::int FROM ringi_documents rd
                      WHERE rd.ringi_id = r.id), 0
                  ) AS linked_document_count
             FROM ringi_records r
            WHERE r.ringi_number ILIKE '%' || $1 || '%'
               OR r.title ILIKE '%' || $1 || '%'
               OR r.owner_name ILIKE '%' || $1 || '%'
               OR r.category ILIKE '%' || $1 || '%'
            ORDER BY r.ringi_number ASC LIMIT $2`
        : `SELECT r.id, r.ringi_number, r.decision_type, r.title, r.category, r.owner_name,
                  r.owner_department, r.approved_at, r.backlog_issue_key,
                  r.status, r.total_budget, r.remarks,
                  r.created_at, r.updated_at,
                  COALESCE(
                    (SELECT COUNT(*)::int FROM ringi_documents rd
                      WHERE rd.ringi_id = r.id), 0
                  ) AS linked_document_count
             FROM ringi_records r
            ORDER BY r.ringi_number DESC LIMIT $1`;
      const params = q ? [q, limit] : [limit];
      const r = await query(sql, params);
      res.json({ ok: true, rows: r.rows });
    } catch (error) {
      console.error("/api/ringi/search failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  // Phase 22.21.116: 稟議の削除。N:N リンク (ringi_documents) は
  //   ON DELETE CASCADE で自動削除される。文書本体は残る。
  app.delete("/api/ringi/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const r = await query(
        "DELETE FROM ringi_records WHERE id = $1 RETURNING ringi_number",
        [id]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "not found" });
      }
      res.json({ ok: true, deleted_ringi_number: r.rows[0].ringi_number });
    } catch (error) {
      console.error("/api/ringi/:id DELETE failed:", error);
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
      // Phase 22.21.117: legacy 5 桁数字でも引けるよう、両方を試す。
      //   R-NNNNN / B-NNNNN の完全一致 → そのまま
      //   5 桁数字 → R- / B- 両方試す
      const tryNumbers: string[] = [];
      tryNumbers.push(num.toUpperCase());
      if (RINGI_NUM_RE.test(num)) {
        tryNumbers.push(`R-${num}`);
        tryNumbers.push(`B-${num}`);
      }
      const r = await query(
        `SELECT id, ringi_number, decision_type, title, category, owner_name, owner_department,
                approved_at, backlog_issue_key, status, total_budget, remarks,
                created_at, updated_at
           FROM ringi_records WHERE ringi_number = ANY($1::text[])
           ORDER BY CASE WHEN ringi_number = $2 THEN 0 ELSE 1 END
           LIMIT 1`,
        [tryNumbers, num.toUpperCase()]
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
      // Phase 22.21.117: decision_type を受け取り、ringi_number を
      //   "R-NNNNN" / "B-NNNNN" に正規化。
      const decisionType =
        b.decision_type === "board_resolution" ? "board_resolution" : "ringi";
      const rawNum = String(b.ringi_number || b.decision_number || "").trim();
      const normalized = normalizeDecisionNumber(rawNum, decisionType);
      if (!normalized) {
        return res.status(400).json({
          ok: false,
          error:
            `決裁番号は "R-NNNNN" / "B-NNNNN" または 5 桁数字で指定してください ` +
            `(received: '${rawNum}')`,
        });
      }
      // プレフィックスから推定した type と decision_type が齟齬なら decision_type を優先するが警告
      const inferredType = inferDecisionType(normalized) || decisionType;
      if (inferredType !== decisionType) {
        console.warn(
          `[/api/ringi] decision_type mismatch: input=${decisionType}, prefix=${inferredType}. Adopting input.`
        );
      }
      if (!b.title || String(b.title).trim().length === 0) {
        return res.status(400).json({ ok: false, error: "title is required" });
      }
      const r = await query(
        `INSERT INTO ringi_records (
           ringi_number, decision_type, title, category, owner_name, owner_department,
           approved_at, backlog_issue_key, status, total_budget, remarks
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (ringi_number) DO UPDATE SET
           decision_type     = EXCLUDED.decision_type,
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
         RETURNING id, ringi_number, decision_type, title`,
        [
          normalized,
          decisionType,
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
      // PDF未作成キューに出す条件:
      //   drive_link が空 (= まだPDFが無い) で、かつ
      //   ・明示フラグ __pdf_pending=true、または
      //   ・v2一括インポートで登録された __imported=true
      //  → v2インポートは __pdf_pending を立てないため、__imported も拾わないと
      //    一括インポートした未発行文書がキューに出てこない。
      let where = `(drive_link IS NULL OR drive_link = '')
                    AND (
                      (form_data->>'__pdf_pending')::text = 'true'
                      OR (form_data->>'__imported')::text = 'true'
                    )`;
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
              fd.VENDOR_NAME || // v2一括インポート
              fd.party_b_name ||
              fd.licensor_name ||
              fd.licensee_name ||
              fd.counterparty ||
              "",
            title:
              fd.description ||
              fd.contract_title ||
              fd.CONTRACT_TITLE || // v2一括インポート
              fd.basic_contract_name ||
              fd.original_work ||
              "",
            staff_email: fd.staff_email || fd.inspectorEmail || "",
            line_count: Array.isArray(fd.items)
              ? fd.items.length
              : Array.isArray(fd.line_items) // v2一括インポート
                ? fd.line_items.length
                : null,
            condition_count: Array.isArray(fd.financial_conditions)
              ? fd.financial_conditions.length
              : null,
            variant: fd.variant || null,
            amount:
              fd.grandTotalExTax ||
              (Array.isArray(fd.line_items)
                ? fd.line_items.reduce(
                    (s: number, l: any) => s + (Number(l.amount_ex_tax) || 0),
                    0
                  )
                : null) ||
              null,
          },
        };
      });

      // テンプレタイプ別 件数も同時に返す (タブの数字バッジ用)
      const countsRes = await query(
        `SELECT template_type, COUNT(*) AS n
           FROM documents
          WHERE (drive_link IS NULL OR drive_link = '')
            AND (
              (form_data->>'__pdf_pending')::text = 'true'
              OR (form_data->>'__imported')::text = 'true'
            )
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
  // ===================================================================
  // Phase 22.21.79: 文書作成 draft (一時保存) API
  //   admin-ui DocumentEditorPage が「閲覧モード ⇄ 編集モード」 トグル時
  //   および手動「一時保存」操作で POST し、「DBSYNC」ボタンで GET する。
  //   storage は document_drafts(issue_key, template_type) UNIQUE で UPSERT。
  //   完成 PDF 発行後の自動削除は今回は実装しない (手動 DELETE のみ提供)。
  //
  //   admin-ui → worker 直叩きなので requirePortalSecret を適用。
  //   apiRouter.ts の WRITE_PATHS_ON_GET に /api/document-drafts を追加して
  //   GET も WRITE_URL (= worker) に routing する設計。
  // ===================================================================

  /** GET /api/document-drafts
   *  Phase 22.21.81: draft 一覧 (admin-ui の DraftsPanel が利用)。
   *  q (部分一致 / 任意) と limit (default 200) をサポート。
   *  form_data 全文は返さない (size_bytes と keys_count の要約だけ)。
   *  詳細は /api/document-drafts/:issueKey?template_type=... を別途叩く。
   */
  app.get("/api/document-drafts", requirePortalSecret, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit || "200"), 10), 1),
        1000
      );
      const params: any[] = [];
      let where = "";
      if (q) {
        params.push(`%${q}%`);
        where = `WHERE issue_key ILIKE $1 OR template_type ILIKE $1 OR COALESCE(updated_by, '') ILIKE $1`;
      }
      params.push(limit);
      const r = await query(
        `SELECT id, issue_key, template_type, document_number, updated_at, updated_by,
                (SELECT COUNT(*) FROM jsonb_object_keys(form_data)) AS keys_count,
                octet_length(form_data::text) AS size_bytes
           FROM document_drafts
           ${where}
          ORDER BY updated_at DESC
          LIMIT $${params.length}`,
        params
      );
      res.json({ ok: true, drafts: r.rows, total: r.rows.length });
    } catch (err: any) {
      console.error("[document-drafts LIST] failed:", err);
      res
        .status(500)
        .json({ ok: false, error: String(err?.message || err) });
    }
  });

  /** GET /api/document-drafts/:issueKey?template_type=...
   *  指定課題 + テンプレの最新 draft を返す。なければ 404 で返す
   *  (admin-ui 側は 404 = "draft 無し → form-context 経路にフォールバック")。
   */
  app.get("/api/document-drafts/:issueKey", requirePortalSecret, async (req, res) => {
    try {
      const issueKey = String(req.params.issueKey || "").trim();
      const templateType = String(req.query.template_type || "").trim();
      if (!issueKey || !templateType) {
        return res.status(400).json({
          ok: false,
          error: "issueKey (path) and template_type (query) are required",
        });
      }
      const r = await query(
        `SELECT id, issue_key, template_type, form_data, document_number, updated_at, updated_by
           FROM document_drafts
          WHERE issue_key = $1 AND template_type = $2
          LIMIT 1`,
        [issueKey, templateType]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "draft not found" });
      }
      // Step1(SSOT): 下書きの form_data も別名キーを揃えて返す。
      //   旧い下書きでも、復元時に items/件名/発注日 が経路非依存で読める。
      const draft = r.rows[0];
      draft.form_data = normalizeDocumentFormData(
        draft.template_type,
        draft.form_data || {}
      );
      res.json({ ok: true, draft });
    } catch (err: any) {
      console.error("[document-drafts GET] failed:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  /** POST /api/document-drafts
   *  body: { issue_key, template_type, form_data, updated_by? }
   *  UPSERT。空の form_data でも明示的に呼ばれれば上書きする
   *  (= 編集モード入り直後に「クリア状態」を保存したい場合もあるため)。
   */
  app.post("/api/document-drafts", requirePortalSecret, express.json({ limit: "5mb" }), async (req, res) => {
    try {
      const issueKey = String(req.body?.issue_key || "").trim();
      const templateType = String(req.body?.template_type || "").trim();
      const formData = req.body?.form_data;
      const updatedBy = req.body?.updated_by ? String(req.body.updated_by).slice(0, 200) : null;
      if (!issueKey || !templateType) {
        return res.status(400).json({
          ok: false,
          error: "issue_key, template_type are required",
        });
      }
      if (formData == null || typeof formData !== "object") {
        return res.status(400).json({
          ok: false,
          error: "form_data must be an object",
        });
      }
      // Step1(SSOT): 下書き保存時も別名キーを揃えてから格納する。
      const normForm = normalizeDocumentFormData(templateType, formData);
      // 発番タイミング: 明示的な「保存」操作 (assign_number=true) のときだけ採番する。
      //   暗黙の保存 (編集モード切替・自動保存) では採番せず form_data だけ更新する。
      //   これにより「編集に入っただけで番号を消費する」のを防ぐ。
      //   既に番号がある場合は維持。form_data 側に番号が来ていればそれを優先採用。
      const assignNumber = req.body?.assign_number === true;
      let assignedDocNumber: string | null = null;
      try {
        const existing = await query(
          `SELECT document_number FROM document_drafts
            WHERE issue_key = $1 AND template_type = $2`,
          [issueKey, templateType]
        );
        const cur = existing.rows[0]?.document_number;
        if (cur && String(cur).trim()) {
          assignedDocNumber = String(cur).trim();
        } else {
          const fromForm =
            typeof (formData as any)?.__draft_doc_number === "string"
              ? String((formData as any).__draft_doc_number).trim()
              : "";
          // 明示保存のときだけ新規採番する。暗黙保存では番号を採らない(null)。
          assignedDocNumber = fromForm || (assignNumber ? await getNewDocumentNumber(templateType) : null);
        }
      } catch (numErr) {
        console.warn("[document-drafts POST] 採番に失敗(番号なしで保存):", numErr);
        assignedDocNumber = null;
      }
      const r = await query(
        `INSERT INTO document_drafts (issue_key, template_type, form_data, document_number, updated_by, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
         ON CONFLICT (issue_key, template_type) DO UPDATE
            SET form_data = EXCLUDED.form_data,
                document_number = COALESCE(document_drafts.document_number, EXCLUDED.document_number),
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
         RETURNING id, issue_key, template_type, form_data, document_number, updated_at, updated_by`,
        [issueKey, templateType, JSON.stringify(normForm), assignedDocNumber, updatedBy]
      );
      res.json({ ok: true, draft: r.rows[0] });
    } catch (err: any) {
      console.error("[document-drafts POST] failed:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  /** DELETE /api/document-drafts/:issueKey?template_type=...
   *  完成 PDF を発行した後等に明示的に呼んで draft を消す。
   *  存在しなくても 200 で OK (冪等)。
   */
  app.delete("/api/document-drafts/:issueKey", requirePortalSecret, async (req, res) => {
    try {
      const issueKey = String(req.params.issueKey || "").trim();
      const templateType = String(req.query.template_type || "").trim();
      if (!issueKey || !templateType) {
        return res.status(400).json({
          ok: false,
          error: "issueKey (path) and template_type (query) are required",
        });
      }
      const r = await query(
        `DELETE FROM document_drafts
          WHERE issue_key = $1 AND template_type = $2`,
        [issueKey, templateType]
      );
      res.json({ ok: true, deleted: r.rowCount || 0 });
    } catch (err: any) {
      console.error("[document-drafts DELETE] failed:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  /** POST /api/document-drafts/bulk-delete
   *  body: { ids: number[] } または { all: true } (= 全削除)
   *  Phase 22.21.81: DraftsPanel から複数選択削除 / 「全部消す」操作用。
   */
  app.post(
    "/api/document-drafts/bulk-delete",
    requirePortalSecret,
    express.json({ limit: "200kb" }),
    async (req, res) => {
      try {
        const all = req.body?.all === true;
        const ids = Array.isArray(req.body?.ids)
          ? req.body.ids
              .map((x: any) => Number(x))
              .filter((n: number) => Number.isFinite(n) && n > 0)
          : [];
        if (!all && ids.length === 0) {
          return res
            .status(400)
            .json({ ok: false, error: "ids[] (1 以上) または all:true が必要" });
        }
        let result: any;
        if (all) {
          result = await query(`DELETE FROM document_drafts`);
        } else {
          result = await query(
            `DELETE FROM document_drafts WHERE id = ANY($1::int[])`,
            [ids]
          );
        }
        res.json({ ok: true, deleted: result.rowCount || 0 });
      } catch (err: any) {
        console.error("[document-drafts BULK-DELETE] failed:", err);
        res
          .status(500)
          .json({ ok: false, error: String(err?.message || err) });
      }
    }
  );

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

      const results: any[] = rows.map((r) => ({
        id: Number(r.id),
        source: "document",
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
      }));

      // include_drafts=1 のとき、作成途中の下書き(document_drafts)も併せて返す。
      //   初回保存で採番済みなので document_number で呼び出せる。source='draft'。
      if (String(req.query.include_drafts || "") === "1") {
        try {
          const dConds: string[] = [];
          const dParams: any[] = [];
          if (q) {
            dParams.push(`%${q}%`);
            const i = dParams.length;
            dConds.push(
              `(COALESCE(document_number,'') ILIKE $${i}
                 OR issue_key ILIKE $${i}
                 OR form_data::text ILIKE $${i})`
            );
          }
          if (templateTypes.length > 0) {
            dParams.push(templateTypes);
            dConds.push(`template_type = ANY($${dParams.length}::text[])`);
          }
          dParams.push(limit);
          const dRes = await query(
            `SELECT id, document_number, issue_key, template_type,
                    form_data, updated_at, updated_by
               FROM document_drafts
               ${dConds.length > 0 ? `WHERE ${dConds.join(" AND ")}` : ""}
              ORDER BY updated_at DESC
              LIMIT $${dParams.length}`,
            dParams
          );
          for (const d of dRes.rows) {
            results.push({
              id: Number(d.id),
              source: "draft",
              document_number: d.document_number || "",
              issue_key: d.issue_key,
              template_type: d.template_type,
              document_category: null,
              form_data: d.form_data || {},
              drive_link: "",
              created_by: d.updated_by,
              created_at: d.updated_at,
              base_document_number: null,
              revision: null,
            });
          }
        } catch (draftErr) {
          console.warn("[documents/search] draft merge skipped:", draftErr);
        }
      }

      res.json({ ok: true, total: results.length, results });
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
        `SELECT d.id, d.document_number, d.issue_key, d.template_type,
                d.document_category, d.form_data, d.drive_link, d.created_by,
                d.created_at, cc.contract_title AS cap_contract_title,
                cc.issue_date_po AS cap_issue_date_po
           FROM documents d
           LEFT JOIN contract_capabilities cc
             ON cc.document_number = d.document_number
          WHERE d.id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "document not found" });
      }
      const r = result.rows[0];
      // インポート由来などで form_data に件名(CONTRACT_TITLE/PROJECT_TITLE)や
      // 発注日が無い場合は、contract_capabilities から補完する。
      const fd = r.form_data || {};
      const capTitle = r.cap_contract_title || "";
      if (capTitle) {
        if (!fd.CONTRACT_TITLE) fd.CONTRACT_TITLE = capTitle;
        if (!fd.PROJECT_TITLE) fd.PROJECT_TITLE = capTitle;
      }
      // 発注日(form_data['発注日']): CSV の issue_date_po を編集画面に反映。
      if (!fd["発注日"] && !fd.order_date && r.cap_issue_date_po) {
        const d = r.cap_issue_date_po;
        fd["発注日"] =
          typeof d === "string"
            ? d.slice(0, 10)
            : (() => {
                try {
                  return new Date(d).toISOString().slice(0, 10);
                } catch {
                  return "";
                }
              })();
      }
      // 検収書: 発注日(orderDate)を親発注書(PO)の issue_date_po から補完。
      if (r.template_type === "inspection_certificate" && !fd.orderDate) {
        try {
          let poDate: any = null;
          if (fd.parent_po_id) {
            const q = await query(
              `SELECT issue_date_po FROM contract_capabilities WHERE id = $1 LIMIT 1`,
              [Number(fd.parent_po_id)]
            );
            poDate = q.rows[0]?.issue_date_po || null;
          }
          if (!poDate && fd.parent_po_issue_key) {
            const q = await query(
              `SELECT issue_date_po FROM contract_capabilities
                WHERE backlog_issue_key = $1 AND record_type = 'purchase_order' LIMIT 1`,
              [String(fd.parent_po_issue_key)]
            );
            poDate = q.rows[0]?.issue_date_po || null;
          }
          if (!poDate && fd.parent_po_number) {
            const q = await query(
              `SELECT cc.issue_date_po
                 FROM documents d
                 JOIN contract_capabilities cc ON cc.backlog_issue_key = d.issue_key
                  AND cc.record_type = 'purchase_order'
                WHERE d.document_number = $1 LIMIT 1`,
              [String(fd.parent_po_number)]
            );
            poDate = q.rows[0]?.issue_date_po || null;
          }
          if (poDate) {
            fd.orderDate =
              typeof poDate === "string"
                ? poDate.slice(0, 10)
                : new Date(poDate).toISOString().slice(0, 10);
          }
        } catch {
          /* noop: 発注日補完の失敗は読込を止めない */
        }
      }
      res.json({
        ok: true,
        id: Number(r.id),
        document_number: r.document_number,
        issue_key: r.issue_key,
        template_type: r.template_type,
        document_category: r.document_category,
        // Step1(SSOT): 別名キー(items/line_items, 件名, 発注日)を揃えて返す。
        //   経路(通常作成/インポート)に依らず編集画面が同じキーで読めるようにする。
        form_data: normalizeDocumentFormData(r.template_type, fd),
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

        // Phase 22.21.80: PDF 発行完了 → document_drafts の draft を冪等削除。
        //   issue_key が synthetic (IMPORT-/MANUAL-) でも draft は付くケースが
        //   あるので、issue_key の文字列をそのまま使って削除する。
        try {
          const delRes = await query(
            `DELETE FROM document_drafts
              WHERE issue_key = $1 AND template_type = $2`,
            [doc.issue_key, doc.template_type]
          );
          if ((delRes.rowCount || 0) > 0) {
            console.log(
              `🗑️ [draft-cleanup] removed draft for ${doc.issue_key} (${doc.template_type}) after regenerate-and-complete`
            );
          }
        } catch (draftErr) {
          console.warn("[draft-cleanup] failed (non-fatal):", draftErr);
          warnings.push({
            step: "draft-cleanup",
            error: String((draftErr as any)?.message || draftErr),
          });
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
   * 複数文書(主に PDF未作成キューの発注書)の発注日 / 担当者 / 支払日 を一括修正し、
   * 備考(自由備考)を一律追記する。納品後に遡って発行する場合など、選択した文書に
   * 同じ値をまとめて適用する用途。
   *
   *   body: {
   *     ids: number[],                     // documents.id
   *     set?: {
   *       "発注日"?: string,               // YYYY-MM-DD (空なら変更しない)
   *       staff_email?: string,            // 担当者(staff.email を解決して STAFF_* を反映)
   *       payment_date?: string,           // 支払日(全明細 + summaryPaymentDate に適用)
   *     },
   *     remarks_append?: string,           // 自由備考(REMARKS_FREE)に追記
   *   }
   *
   * 空欄の項目は変更しない(誤って消さない)。発注日/支払日は capability 側にも反映。
   */
  app.post("/api/documents/bulk-update-fields", express.json(), async (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids)
        ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
        : [];
      if (ids.length === 0) {
        return res.status(400).json({ ok: false, error: "ids[] is required" });
      }
      const set = req.body?.set || {};
      // 発注書(purchase_order)向け
      const orderDate = set["発注日"] != null ? String(set["発注日"]).trim() : "";
      const staffEmail = set.staff_email != null ? String(set.staff_email).trim() : "";
      const paymentDate = set.payment_date != null ? String(set.payment_date).trim() : "";
      // 検収書(inspection_certificate)向け
      const inspectionDate =
        set.inspection_date != null ? String(set.inspection_date).trim() : "";
      const inspectorEmail =
        set.inspector_email != null ? String(set.inspector_email).trim() : "";
      const remarksAppend =
        req.body?.remarks_append != null ? String(req.body.remarks_append).trim() : "";

      if (
        !orderDate &&
        !staffEmail &&
        !paymentDate &&
        !inspectionDate &&
        !inspectorEmail &&
        !remarksAppend
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "更新する項目がありません" });
      }

      // 担当者(発注元) / 検収者 をそれぞれ一度だけ解決
      let staff: { staff_name: string; department: string; email: string; phone: string } | null =
        null;
      if (staffEmail) {
        staff = await lookupStaffByEmail(staffEmail);
      }
      let inspector: { staff_name: string; department: string; email: string; phone: string } | null =
        null;
      if (inspectorEmail) {
        inspector = await lookupStaffByEmail(inspectorEmail);
      }

      const docs = (
        await query(
          `SELECT id, document_number, form_data FROM documents WHERE id = ANY($1::int[])`,
          [ids]
        )
      ).rows;

      let updated = 0;
      for (const d of docs) {
        const fd = d.form_data || {};
        if (orderDate) fd["発注日"] = orderDate;
        if (staff) {
          fd.staff_email = staff.email || staffEmail;
          fd.STAFF_NAME = staff.staff_name || fd.STAFF_NAME || "";
          fd.STAFF_EMAIL = staff.email || staffEmail;
          fd.STAFF_DEPARTMENT = staff.department || fd.STAFF_DEPARTMENT || "";
          fd.STAFF_PHONE = staff.phone || fd.STAFF_PHONE || "";
        } else if (staffEmail) {
          // staff レコードが見つからなくても email だけは反映
          fd.staff_email = staffEmail;
          fd.STAFF_EMAIL = staffEmail;
        }
        if (paymentDate) {
          if (Array.isArray(fd.line_items)) {
            fd.line_items = fd.line_items.map((l: any) => ({
              ...l,
              payment_date: paymentDate,
            }));
          }
          fd.summaryPaymentDate = paymentDate;
        }
        // 検収書: 検収日(検収完了日) / 検収者
        if (inspectionDate) fd.inspectionCompletedAt = inspectionDate;
        if (inspector) {
          fd.inspectorName = inspector.staff_name || fd.inspectorName || "";
          fd.inspectorDept = inspector.department || fd.inspectorDept || "";
          fd.inspectorEmail = inspector.email || inspectorEmail;
        } else if (inspectorEmail) {
          fd.inspectorEmail = inspectorEmail;
        }
        if (remarksAppend) {
          const cur = String(fd.REMARKS_FREE || "");
          fd.REMARKS_FREE = cur ? `${cur}\n${remarksAppend}` : remarksAppend;
        }
        await query(`UPDATE documents SET form_data = $2 WHERE id = $1`, [
          d.id,
          JSON.stringify(fd),
        ]);
        // capability 側にも反映(検収/条件明細・台帳の整合)
        if (orderDate) {
          await query(
            `UPDATE contract_capabilities SET issue_date_po = $2, updated_at = now()
              WHERE document_number = $1`,
            [d.document_number, orderDate]
          );
        }
        if (paymentDate) {
          await query(
            `UPDATE capability_line_items cli SET payment_date = $2, updated_at = now()
               FROM contract_capabilities cc
              WHERE cli.capability_id = cc.id AND cc.document_number = $1`,
            [d.document_number, paymentDate]
          );
        }
        updated++;
      }
      res.json({ ok: true, updated, total: ids.length });
    } catch (error) {
      console.error("/api/documents/bulk-update-fields failed:", error);
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  /**
   * 不要な取り込み文書をまとめて削除する。
   *   主に「不要なものを取り込んでしまった」発注書を PDF未作成キューから
   *   レコードごと削除する用途。
   *
   *   body: { ids: number[] }   // documents.id
   *
   * 安全策(満たさないものはスキップして理由を返す):
   *   - 発行済(drive_link あり)は削除しない
   *   - 検収/納品(delivery_line_items)が紐付くものは削除しない
   *
   * 削除対象: documents + contract_capabilities(子テーブルは ON DELETE CASCADE)
   *           + contracts ミラー(子テーブル CASCADE) + external_assets。
   *   全体を単一トランザクションで実行。スキップは個別に握って継続。
   */
  app.post("/api/documents/bulk-delete", express.json(), async (req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: "ids[] is required" });
    }
    // 強制削除: 発行済(PDFあり)・検収/納品紐付きでも削除する。
    //   検収/納品は delivery_line_items が RESTRICT FK で削除を止めるため、
    //   先に該当 delivery_line_items を削除し、空になった delivery_events も掃除する。
    const force = !!req.body?.force;
    const client = await pool.connect();
    const deleted: string[] = [];
    const skipped: Array<{ document_number: string; reason: string }> = [];
    try {
      await client.query("BEGIN");
      const docs = (
        await client.query(
          `SELECT d.id, d.document_number, d.drive_link, cc.id AS cap_id
             FROM documents d
             LEFT JOIN contract_capabilities cc
               ON cc.document_number = d.document_number
            WHERE d.id = ANY($1::int[])
            FOR UPDATE OF d`,
          [ids]
        )
      ).rows;
      for (const d of docs) {
        if (!force && d.drive_link && String(d.drive_link).trim()) {
          skipped.push({
            document_number: d.document_number,
            reason: "発行済(PDFあり)のため削除しません",
          });
          continue;
        }
        if (d.cap_id) {
          const del = await client.query(
            `SELECT COUNT(*)::int AS n
               FROM delivery_line_items dli
               JOIN capability_line_items cli ON cli.id = dli.capability_line_item_id
              WHERE cli.capability_id = $1`,
            [d.cap_id]
          );
          const hasDelivery = Number(del.rows[0].n) > 0;
          if (hasDelivery && !force) {
            skipped.push({
              document_number: d.document_number,
              reason: "検収/納品が紐付いているため削除しません",
            });
            continue;
          }
          if (hasDelivery && force) {
            // 削除を阻む delivery_line_items を先に除去し、空の delivery_events を掃除
            const ev = await client.query(
              `SELECT DISTINCT dli.delivery_event_id AS eid
                 FROM delivery_line_items dli
                 JOIN capability_line_items cli ON cli.id = dli.capability_line_item_id
                WHERE cli.capability_id = $1`,
              [d.cap_id]
            );
            const eventIds = ev.rows
              .map((r: any) => r.eid)
              .filter((x: any) => x != null);
            await client.query(
              `DELETE FROM delivery_line_items dli
                 USING capability_line_items cli
                WHERE dli.capability_line_item_id = cli.id
                  AND cli.capability_id = $1`,
              [d.cap_id]
            );
            if (eventIds.length > 0) {
              await client.query(
                `DELETE FROM delivery_events de
                  WHERE de.id = ANY($1::int[])
                    AND NOT EXISTS (
                      SELECT 1 FROM delivery_line_items dli
                       WHERE dli.delivery_event_id = de.id
                    )`,
                [eventIds]
              );
            }
          }
          await client.query(
            `DELETE FROM contract_capabilities WHERE id = $1`,
            [d.cap_id]
          );
          await client.query(`DELETE FROM contracts WHERE id = $1`, [d.cap_id]);
        }
        await client.query(`DELETE FROM documents WHERE id = $1`, [d.id]);
        await client.query(
          `DELETE FROM external_assets WHERE asset_number = $1`,
          [d.document_number]
        );
        deleted.push(d.document_number);
      }
      await client.query("COMMIT");
      res.json({
        ok: true,
        deleted: deleted.length,
        deleted_numbers: deleted,
        skipped,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("/api/documents/bulk-delete failed:", error);
      res
        .status(500)
        .json({ ok: false, error: String((error as any)?.message || error) });
    } finally {
      client.release();
    }
  });

  /**
   * Phase 17e: 稟議マスタの一括インポート (ringi_records への upsert)。
   * 文書とのリンクは作らない (これは「マスタ事前登録」のためのもの。
   * 個別文書からのリンクは別経路 bulk/order 等の ringi_numbers 列で行う)。
   */
  app.post(
    "/api/imports/bulk/ringi",
    requirePortalSecret,
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
          // Phase 22.21.117: decision_type 列を尊重しつつ legacy 5 桁数字も自動プレフィックス。
          const decisionType: "ringi" | "board_resolution" =
            r.decision_type === "board_resolution" ? "board_resolution" : "ringi";
          const rawNum = String(r.ringi_number || r.decision_number || "").trim();
          try {
            const normalized = normalizeDecisionNumber(rawNum, decisionType);
            if (!normalized) {
              throw new Error(
                `決裁番号は "R-NNNNN" / "B-NNNNN" または 5 桁数字で指定してください (received: '${rawNum}')`
              );
            }
            const title = String(r.title || "").trim();
            if (!title) {
              throw new Error("title は必須です");
            }
            const result = await query(
              `INSERT INTO ringi_records (
                 ringi_number, decision_type, title, category, owner_name, owner_department,
                 approved_at, backlog_issue_key, status, total_budget, remarks
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (ringi_number) DO UPDATE SET
                 decision_type     = EXCLUDED.decision_type,
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
               RETURNING id, ringi_number, decision_type, title`,
              [
                normalized,
                decisionType,
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
  app.get("/api/imports/bulk/inspection/trigger-waiting.csv", requirePortalSecret, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const triggerWaitingName = "\u30c8\u30ea\u30ac\u30fc\u5f85\u3061";
      const inspectionIssueTypeName = "\u7d0d\u54c1\u30fb\u691c\u53ce";
      const statuses = await backlogService.getStatuses();
      const issueTypes = await backlogService.getIssueTypes();
      const triggerStatus = statuses.find((s: any) => s.name === triggerWaitingName);
      const inspectionType = issueTypes.find((t: any) => t.name === inspectionIssueTypeName);

      if (!triggerStatus) {
        return res.status(404).json({ ok: false, error: `Backlog status not found: ${triggerWaitingName}` });
      }
      if (!inspectionType) {
        return res.status(404).json({ ok: false, error: `Backlog issue type not found: ${inspectionIssueTypeName}` });
      }

      const issues = await backlogService.searchIssues({
        "statusId[]": [Number(triggerStatus.id)],
        "issueTypeId[]": [Number(inspectionType.id)],
        count: limit,
        sort: "updated",
        order: "desc",
      });

      const today = new Date().toISOString().slice(0, 10);
      const outRows: Array<Record<string, any>> = [];

      for (const issue of issues) {
        const issueKey = String(issue.issueKey || "").trim();
        if (!issueKey) continue;

        const lr = await query(
          `SELECT parent_issue_key, counterparty, slack_user_id
             FROM legal_requests
            WHERE backlog_issue_key = $1
            LIMIT 1`,
          [issueKey]
        );
        const lrRow = lr.rows[0] || {};
        let parentKey = String(lrRow.parent_issue_key || "").trim();
        if (!parentKey && issue.description) {
          const matches = String(issue.description).match(/[A-Z][A-Z0-9_]*-\d+/g) || [];
          parentKey = matches.find((m) => m !== issueKey) || "";
        }

        let orderItem: any = null;
        if (parentKey) {
          // Phase 23: order_items → contract_capabilities (record_type='purchase_order')
          //   vendor_code は vendors テーブルから取得。description は contract_title へ。
          const order = await query(
            `SELECT cc.id, cc.backlog_issue_key,
                    cc.contract_title AS description,
                    v.vendor_code,
                    cc.tax_rate, cc.due_date,
                    (SELECT d.document_number FROM documents d
                      WHERE d.issue_key = cc.backlog_issue_key
                        AND d.template_type LIKE '%purchase_order%'
                      ORDER BY d.created_at DESC LIMIT 1) AS parent_po_number,
                    v.vendor_name AS vendor_name
               FROM contract_capabilities cc
               LEFT JOIN vendors v ON v.id = cc.vendor_id
              WHERE cc.backlog_issue_key = $1
                AND cc.record_type = 'purchase_order'
              LIMIT 1`,
            [parentKey]
          );
          orderItem = order.rows[0] || null;
        }

        const baseRow = {
          import_key: issueKey,
          issue_key: issueKey,
          parent_po_issue_key: parentKey,
          parent_po_id: orderItem?.id || "",
          parent_po_number: orderItem?.parent_po_number || "",
          document_number: "",
          document_date: today,
          delivered_at: "",
          inspection_completed_at: "",
          payment_due_date: "",
          staff_email: "",
          counterparty: lrRow.counterparty || orderItem?.vendor_name || "",
          vendor_code: orderItem?.vendor_code || "",
          description: orderItem?.description || issue.summary || "",
          tax_rate: orderItem?.tax_rate || 10,
          delivery_no: "",
          generate_pdf: "\u672a\u4f5c\u6210",
          remarks: "",
          CHANGE_RECORDS: "",
        };

        if (!orderItem?.id) {
          outRows.push({
            ...baseRow,
            row_type: "item",
            line_no: "",
            order_line_item_id: "",
            item_name: "",
            spec: "",
            inspected_quantity: "",
            acceptance_ratio: "1",
          });
          continue;
        }

        const lines = await query(
          `SELECT id, line_no, item_name, spec, unit_price, quantity, amount_ex_tax
             FROM capability_line_items
            WHERE capability_id = $1
            ORDER BY line_no ASC`,
          [Number(orderItem.id)]
        );
        if (lines.rows.length === 0) {
          outRows.push({
            ...baseRow,
            row_type: "item",
            line_no: "",
            order_line_item_id: "",
            item_name: "",
            spec: "",
            inspected_quantity: "",
            acceptance_ratio: "1",
          });
          continue;
        }
        for (const line of lines.rows) {
          const availability = await getCapabilityLineAvailability(Number(line.id));
          const remainingQty = Math.max(Number(availability.remaining_quantity) || 0, 0);
          outRows.push({
            ...baseRow,
            row_type: "item",
            line_no: line.line_no,
            order_line_item_id: line.id,
            item_name: line.item_name || "",
            spec: line.spec || "",
            inspected_quantity: remainingQty || "",
            acceptance_ratio: "1",
          });
        }
      }

      const headers = [
        "import_key",
        "issue_key",
        "parent_po_issue_key",
        "parent_po_id",
        "parent_po_number",
        "document_number",
        "document_date",
        "delivered_at",
        "inspection_completed_at",
        "payment_due_date",
        "staff_email",
        "counterparty",
        "vendor_code",
        "description",
        "tax_rate",
        "delivery_no",
        "generate_pdf",
        "remarks",
        "CHANGE_RECORDS",
        "row_type",
        "line_no",
        "order_line_item_id",
        "item_name",
        "spec",
        "inspected_quantity",
        "acceptance_ratio",
      ];
      const csv = "\uFEFF" + toCsv(headers, outRows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="inspection_trigger_waiting.csv"');
      res.send(csv);
    } catch (error: any) {
      console.error("/api/imports/bulk/inspection/trigger-waiting.csv failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.post("/api/imports/bulk/inspection", requirePortalSecret, express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ ok: false, error: "rows[] is required" });
      }

      const groups = groupByImportKey(rows);
      const succeeded: any[] = [];
      const failed: any[] = [];

      for (const [importKey, groupRows] of groups) {
        // Phase 22.21.69: 1 \u30b0\u30eb\u30fc\u30d7\u306e\u66f8\u8fbc\u307f\u3092 transaction + advisory_xact_lock \u3067
        //   \u6392\u4ed6\u5236\u5fa1\u3002
        //   - BEGIN / COMMIT \u3067 5 \u3064\u306e\u66f8\u8fbc\u307f (delivery_events / delivery_line_items
        //     DELETE+INSERT / documents UPSERT / legal_requests UPSERT) \u3092\u30a2\u30c8\u30df\u30c3\u30af\u5316
        //   - pg_advisory_xact_lock(order_item_id) \u3067\u540c\u4e00 PO \u306b\u5bfe\u3059\u308b\u4e26\u5217 import \u3092
        //     \u76f4\u5217\u5316 \u2192 delivery_no MAX+1 \u3068 previewInspectionOverflow \u306e TOCTOU \u3092\u89e3\u6d88
        //   \u5931\u6557\u6642\u306f ROLLBACK \u3067\u90e8\u5206\u66f8\u8fbc\u307f\u3092\u5dfb\u304d\u623b\u3059\u3002
        //   parent PO \u89e3\u6c7a (orderItemId \u78ba\u5b9a) \u306f\u30c8\u30e9\u30f3\u30b6\u30af\u30b7\u30e7\u30f3\u5916\u3067\u5b9f\u884c
        //   (lock \u3092\u53d6\u308b\u30ad\u30fc\u304c\u5fc5\u8981\u306a\u305f\u3081)\u3002
        const first = groupRows[0];
        const issueKey = String(first.issue_key || first.issueKey || importKey).trim();
        if (!issueKey) {
          failed.push({ import_key: importKey, error: "issue_key is required" });
          continue;
        }

        // \u2500\u2500 parent PO \u89e3\u6c7a (lock \u3092\u53d6\u308b\u524d\u306b orderItemId \u3092\u77e5\u308b\u305f\u3081) \u2500\u2500
        let orderItemId = 0;
        let parentPoIssueKey = String(first.parent_po_issue_key || "").trim();
        try {
          orderItemId = Number(first.parent_po_id) || 0;
          if (!orderItemId && parentPoIssueKey) {
            // Phase 23: order_items → contract_capabilities (purchase_order)
            const r = await query(
              `SELECT id FROM contract_capabilities
                 WHERE backlog_issue_key = $1
                   AND record_type = 'purchase_order'
                 LIMIT 1`,
              [parentPoIssueKey]
            );
            orderItemId = Number(r.rows[0]?.id) || 0;
          }
          if (!orderItemId && first.parent_po_number) {
            const r = await query(
              `SELECT cc.id, cc.backlog_issue_key
                 FROM documents d
                 JOIN contract_capabilities cc
                   ON cc.backlog_issue_key = d.issue_key
                  AND cc.record_type = 'purchase_order'
                WHERE d.document_number = $1
                LIMIT 1`,
              [String(first.parent_po_number).trim()]
            );
            orderItemId = Number(r.rows[0]?.id) || 0;
            parentPoIssueKey = parentPoIssueKey || String(r.rows[0]?.backlog_issue_key || "");
          }
          if (!orderItemId) {
            throw new Error("parent PO not found. parent_po_id, parent_po_issue_key, or parent_po_number is required");
          }
        } catch (e: any) {
          failed.push({ import_key: importKey, error: String(e?.message || e) });
          continue;
        }

        // \u2500\u2500 transaction \u958b\u59cb \u2500\u2500
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // \ud83d\udd12 advisory lock \u2014 \u540c\u3058 order_item_id \u306b\u5bfe\u3059\u308b\u540c\u6642 import \u3092\u76f4\u5217\u5316\u3002
          //   transaction-scoped \u306a\u306e\u3067 COMMIT/ROLLBACK \u3067\u81ea\u52d5\u89e3\u653e\u3002
          await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
            orderItemId,
          ]);

          // Phase 23: order_items → contract_capabilities (purchase_order)
          const orderHeader = await client.query(
            `SELECT cc.id, cc.backlog_issue_key,
                    cc.contract_title AS description,
                    v.vendor_code,
                    cc.tax_rate, cc.due_date, cc.issue_date_po,
                    (SELECT d.document_number FROM documents d
                      WHERE d.issue_key = cc.backlog_issue_key
                        AND d.template_type LIKE '%purchase_order%'
                      ORDER BY d.created_at DESC LIMIT 1) AS parent_po_number,
                    v.vendor_name AS vendor_name
               FROM contract_capabilities cc
               LEFT JOIN vendors v ON v.id = cc.vendor_id
              WHERE cc.id = $1
                AND cc.record_type = 'purchase_order'
              LIMIT 1`,
            [orderItemId]
          );
          const order = orderHeader.rows[0];
          if (!order) throw new Error(`contract_capabilities (purchase_order) not found: ${orderItemId}`);
          parentPoIssueKey = parentPoIssueKey || String(order.backlog_issue_key || "");

          // Phase 23: order_line_items → capability_line_items
          const orderLinesRes = await client.query(
            `SELECT id, line_no, item_name, spec, unit_price, quantity, amount_ex_tax
               FROM capability_line_items
              WHERE capability_id = $1
              ORDER BY line_no ASC`,
            [orderItemId]
          );
          // Phase 22.21.69: pg の client.query は QueryResult<unknown> を返すため、
          //   Map の value 型推論が unknown になる → `line.id` 等のアクセスが
          //   TS エラーになる。明示的に any[] にキャストして従来挙動を維持。
          const orderLines = orderLinesRes.rows as any[];
          const byLineNo = new Map<number, any>(
            orderLines.map((l: any) => [Number(l.line_no), l])
          );
          const byId = new Map<number, any>(
            orderLines.map((l: any) => [Number(l.id), l])
          );

          const incoming = groupRows
            .filter((r) => String(r.row_type || "item").trim().toLowerCase() !== "expense")
            .map((r) => {
              const line: any =
                byId.get(Number(r.order_line_item_id)) ||
                byLineNo.get(Number(r.line_no));
              if (!line) return null;
              const inspectedQuantity = Number(r.inspected_quantity);
              return {
                order_line_item_id: Number(line.id),
                line_no: Number(line.line_no),
                item_name: line.item_name || "",
                spec: line.spec || "",
                unit_price: Number(line.unit_price) || 0,
                ordered_quantity: Number(line.quantity) || 0,
                inspected_quantity: Number.isFinite(inspectedQuantity) ? inspectedQuantity : 0,
                acceptance_ratio:
                  r.acceptance_ratio === undefined || r.acceptance_ratio === ""
                    ? 1
                    : Number(r.acceptance_ratio) || 1,
                rejection_reason: r.rejection_reason || null,
              };
            })
            .filter(Boolean) as Array<any>;

          if (incoming.length === 0) {
            throw new Error("No valid inspection line rows");
          }

          // delivery_no \u306e MAX+1: lock \u53d6\u5f97\u5f8c\u306b\u8aad\u3080\u306e\u3067\u3001\u5225 import \u3068\u306e\u7af6\u5408\u306a\u3057\u3002
          const deliveryNo = Number(first.delivery_no) || Number(
            (
              await client.query(
                // Phase 23: delivery_events.order_item_id → capability_id
                "SELECT COALESCE(MAX(delivery_no), 0) + 1 AS next_no FROM delivery_events WHERE capability_id = $1",
                [orderItemId]
              )
            ).rows[0]?.next_no || 1
          );

          const computedLines = incoming.map((l) => ({
            ...l,
            inspected_amount_ex_tax: calculateInspectedAmount(
              l.unit_price,
              l.inspected_quantity,
              l.acceptance_ratio
            ),
          }));
          const amountExTax = computedLines.reduce(
            (s, l) => s + (Number(l.inspected_amount_ex_tax) || 0),
            0
          );
          const taxRate = Number(first.tax_rate) || Number(order.tax_rate) || 10;
          const tax = calculateTax(amountExTax, taxRate);
          const staff = await lookupStaffByEmail(first.staff_email);
          const docNumber =
            first.document_number && String(first.document_number).trim()
              ? String(first.document_number).trim()
              : await getNewDocumentNumber("inspection_certificate", "\u7d0d\u54c1\u30fb\u691c\u53ce");

          // overflow \u30c1\u30a7\u30c3\u30af\u306f lock \u5185\u3067\u5b9f\u884c\u3002\u4ed6 import \u304c\u540c\u6642\u306b\u66f8\u3044\u3066\u3044\u3066\u3082\u3001
          //   \u305d\u308c\u306f lock \u5f85\u3061\u72b6\u614b\u306a\u306e\u3067\u3001\u3053\u3053\u3067\u8aad\u3080\u72b6\u614b\u306f\u5b89\u5b9a\u3057\u3066\u3044\u308b\u3002
          const preview = await previewInspectionOverflow(
            computedLines.map((l) => ({
              capability_line_item_id: l.order_line_item_id,
              inspected_quantity: l.inspected_quantity,
              acceptance_ratio: l.acceptance_ratio,
            }))
          );
          const blocking = preview.filter((p) => p.will_overflow_amount || p.will_overflow_quantity);
          if (blocking.length > 0) {
            throw new Error(
              "Inspection overflow: " +
                blocking.map((b) => b.capability_line_item_id).join(", ")
            );
          }

          // Phase 23: delivery_events.order_item_id → capability_id
          const delivery = await client.query(
            `INSERT INTO delivery_events
               (backlog_issue_key, capability_id, delivery_no, delivered_at,
                delivered_amount, inspection_deadline, status, note)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
             ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET
               capability_id = EXCLUDED.capability_id,
               delivered_at = EXCLUDED.delivered_at,
               delivered_amount = EXCLUDED.delivered_amount,
               inspection_deadline = EXCLUDED.inspection_deadline,
               note = EXCLUDED.note
             RETURNING id`,
            [
              issueKey,
              orderItemId,
              deliveryNo,
              first.delivered_at || first.deliveredAt || new Date().toISOString().slice(0, 10),
              amountExTax,
              first.inspection_deadline || null,
              first.remarks || "",
            ]
          );
          const deliveryEventId = Number(delivery.rows[0]?.id);
          await client.query("DELETE FROM delivery_line_items WHERE delivery_event_id = $1", [
            deliveryEventId,
          ]);
          for (const l of computedLines) {
            // Phase 23: delivery_line_items.order_line_item_id → capability_line_item_id
            await client.query(
              `INSERT INTO delivery_line_items (
                 delivery_event_id, capability_line_item_id, inspected_quantity,
                 acceptance_ratio, inspected_amount_ex_tax, rejection_reason
               ) VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                deliveryEventId,
                l.order_line_item_id,
                l.inspected_quantity,
                l.acceptance_ratio,
                l.inspected_amount_ex_tax,
                l.rejection_reason,
              ]
            );
          }

          const formData = {
            issueKey,
            parent_po_id: orderItemId,
            parent_po_issue_key: parentPoIssueKey,
            parent_po_number: first.parent_po_number || order.parent_po_number || "",
            documentDate: first.document_date || first.documentDate || new Date().toISOString().slice(0, 10),
            // 発注日: 親発注書(PO)の issue_date_po から補完(検収書テンプレの orderDate)
            orderDate: (() => {
              const d = first.order_date || first.orderDate || order.issue_date_po || "";
              if (!d) return "";
              return typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
            })(),
            deliveredAt: first.delivered_at || first.deliveredAt || "",
            inspectionCompletedAt:
              first.inspection_completed_at || first.inspectionCompletedAt || "",
            paymentDueDate: first.payment_due_date || first.paymentDueDate || "",
            deliveryNo: String(deliveryNo),
            isPartial: deliveryNo > 1 ? "\u5206\u5272" : "\u5b8c\u4e86",
            CHANGE_RECORDS:
              first.CHANGE_RECORDS ||
              first.change_records ||
              first.changeRecords ||
              "",
            counterparty: first.counterparty || order.vendor_name || "",
            VENDOR_CODE: order.vendor_code || first.vendor_code || "",
            inspectorDept: staff?.department || "",
            inspectorName: staff?.staff_name || "",
            inspectorEmail: staff?.email || first.staff_email || "",
            description: first.description || order.description || "",
            taxRate: String(taxRate),
            deliveredAmountStr: amountExTax.toLocaleString("ja-JP"),
            taxAmountStr: tax.taxAmount.toLocaleString("ja-JP"),
            totalAmountStr: tax.amountIncTax.toLocaleString("ja-JP"),
            grandTotalPayable: tax.amountIncTax,
            grandTotalPayableStr: tax.amountIncTax.toLocaleString("ja-JP"),
            order_lines_for_inspection: orderLines,
            delivery_line_items: computedLines,
            __imported: true,
            __bulk: true,
            __pdf_pending: parseBoolFlag(first.generate_pdf, true),
          };

          await client.query(
            `INSERT INTO documents (
               document_number, issue_key, template_type, form_data, drive_link,
               created_by, base_document_number, revision, vendor_name_snapshot, is_primary
             ) VALUES ($1, $2, 'inspection_certificate', $3, '', 'import-bulk-inspection', $1, 0, $4, TRUE)
             ON CONFLICT (document_number) DO UPDATE SET
               issue_key = EXCLUDED.issue_key,
               template_type = EXCLUDED.template_type,
               form_data = EXCLUDED.form_data,
               vendor_name_snapshot = EXCLUDED.vendor_name_snapshot,
               is_primary = TRUE`,
            [
              docNumber,
              issueKey,
              JSON.stringify(formData),
              formData.counterparty || null,
            ]
          );

          await client.query(
            `INSERT INTO legal_requests
               (backlog_issue_key, contract_type, counterparty, summary, parent_issue_key)
             VALUES ($1, 'delivery_inspec', $2, $3, $4)
             ON CONFLICT (backlog_issue_key) DO UPDATE SET
               contract_type = 'delivery_inspec',
               counterparty = COALESCE(NULLIF(EXCLUDED.counterparty, ''), legal_requests.counterparty),
               parent_issue_key = COALESCE(NULLIF(EXCLUDED.parent_issue_key, ''), legal_requests.parent_issue_key)`,
            [
              issueKey,
              formData.counterparty,
              formData.description || `Inspection ${docNumber}`,
              parentPoIssueKey || null,
            ]
          );

          await client.query("COMMIT");

          // Phase C-5: COMMIT 後に新スキーマへ非致命同期 (pool 経由・別接続なので
          //   本体 Tx を汚さない)。orderItemId = capability_id。
          if (orderItemId)
            await safeSync("CL(capability)", () =>
              syncConditionLinesForCapability({ query }, Number(orderItemId))
            );
          await safeSync("inspection events", () =>
            syncInspectionEventsForDelivery({ query }, deliveryEventId)
          );

          succeeded.push({
            import_key: importKey,
            issue_key: issueKey,
            document_number: docNumber,
            delivery_event_id: deliveryEventId,
            line_count: computedLines.length,
            total_ex_tax: amountExTax,
            pdf_pending: formData.__pdf_pending,
          });
        } catch (e: any) {
          await client.query("ROLLBACK").catch(() => { /* noop */ });
          console.error(`/api/imports/bulk/inspection group=${importKey} failed:`, e);
          failed.push({ import_key: importKey, error: String(e?.message || e) });
        } finally {
          client.release();
        }
      }

      res.json({
        ok: true,
        total_rows: rows.length,
        groups: groups.size,
        succeeded,
        failed,
      });
    } catch (error: any) {
      console.error("/api/imports/bulk/inspection failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

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
      inspection: {
        headers: [
          "import_key",
          "issue_key",
          "parent_po_issue_key",
          "parent_po_id",
          "parent_po_number",
          "document_number",
          "document_date",
          "delivered_at",
          "inspection_completed_at",
          "payment_due_date",
          "staff_email",
          "counterparty",
          "vendor_code",
          "description",
          "tax_rate",
          "delivery_no",
          "generate_pdf",
          "remarks",
          "CHANGE_RECORDS",
          "row_type",
          "line_no",
          "order_line_item_id",
          "item_name",
          "spec",
          "inspected_quantity",
          "acceptance_ratio",
        ],
        sample: [
          [
            "INS001",
            "LEGAL-2001",
            "LEGAL-1999",
            "",
            "ARC-PO-2026-0001",
            "",
            "2026-05-24",
            "2026-05-24",
            "2026-05-24",
            "",
            "tanaka@arclight.co.jp",
            "Sample Vendor",
            "V001",
            "Delivery acceptance",
            "10",
            "1",
            "\u672a\u4f5c\u6210",
            "",
            "2026-05-24|検収金額|100000|80000|一部不合格のため減額",
            "item",
            "1",
            "",
            "Deliverable",
            "Spec",
            "1",
            "1",
          ],
        ],
      },
      "license-contract": {
        headers: [
          "import_key",
          "issue_key",
          "contract_number",
          "ledger_id",
          "drive_link",
          // Phase 22.21.113: record_type 列 (individual_contract / standalone_contract)
          //   空欄なら individual_contract (旧 CSV 互換)
          "record_type",
          // Phase 22.21.113: vendor_code を追加 (新スキーマ contract_capabilities の
          //   vendor_id 解決に使う。空でも licensor_name で fallback resolve される)
          "vendor_code",
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
          // Phase 22.21.113: AG (前払い保証) 列 (Phase 22.21.95 で導入)
          //   空欄なら 0。100,000 のように数値を入れると AG として累積消化される。
          "ag_amount",
        ],
        sample: [
          // LIC001: 単独契約 (record_type=standalone_contract)、条件 2 行
          ["LIC001", "", "", "LIC-2024-001", "", "standalone_contract", "V001", "Sample IP Co.", "東京都...", "山田 太郎", "true", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "true", "ボードゲーム『◯◯』", "◯◯ Pocket", "2024-04-01", "基本契約の満了日まで", "", "© Sample IP", "tanaka@arclight.co.jp", "作成済", "00001", "", "1", "国内・日本語", "ROYALTY", "5.0", "上代", "四半期", "JPY", "上代 × 5.0% × 製造数", "四半期報告後の翌月末日払い", "1000000", "0"],
          ["LIC001", "", "", "LIC-2024-001", "", "standalone_contract", "V001", "Sample IP Co.", "東京都...", "山田 太郎", "true", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "true", "ボードゲーム『◯◯』", "◯◯ Pocket", "2024-04-01", "基本契約の満了日まで", "", "© Sample IP", "tanaka@arclight.co.jp", "作成済", "00001", "", "2", "国内・日本語", "ROYALTY", "10.0", "売上", "四半期", "JPY", "売上 × 10.0%", "四半期報告後の翌月末日払い", "0", "0"],
          // LIC002: 個別契約 (record_type=individual_contract)、AG 100 万円
          ["LIC002", "", "", "LIC-2024-002", "", "individual_contract", "V002", "Other IP Co.", "大阪府...", "佐藤 花子", "true", "株式会社アークライト", "東京都千代田区...", "代表取締役 田中 一郎", "true", "ライトノベル『△△』", "△△ Battle", "2024-07-01", "5 年", "", "© Other IP", "tanaka@arclight.co.jp", "作成済", "00002", "", "1", "国内・日本語", "ROYALTY", "8.0", "上代", "半期", "JPY", "上代 × 8.0% × 製造数", "半期報告後 60 日以内", "0", "1000000"],
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
      // Phase 22.21.113: 業務委託 個別/単独契約 (= 検収書 自動補完用の業務明細)
      //   record_type で individual_contract / standalone_contract を切替。
      //   1 グループ (import_key) = 1 contract_capabilities + N capability_line_items。
      // Phase 22.21.114: 発注書 LineItemTable と整合 — category / payment_method 列を削除。
      //   payment_terms は 契約種別 ("請負" or "準委任") のみ受け付ける。
      "service-contract": {
        headers: [
          // === 共通: グループキー + 識別子 ===
          "import_key",
          "issue_key",
          "contract_number",
          "drive_link",
          // record_type: individual_contract (基本契約配下) / standalone_contract (単体)
          "record_type",
          // === 共通: 取引先・案件 ===
          "vendor_code",
          "vendor_name",
          "contract_title",
          "effective_date",
          "expiration_date",
          "auto_renewal",
          // === 親契約 (個別契約の場合のみ意味あり。標準契約 number) ===
          "parent_master_number",
          // === 業務明細 (1 行 = 1 明細) ===
          "line_no",
          "item_name",
          "spec",
          "calc_method",            // FIXED / SUBSCRIPTION / ROYALTY
          "payment_terms",          // 契約種別 (請負 / 準委任)
          "quantity",
          "unit_price",
          "amount_ex_tax",
          "delivery_date",
          "payment_date",
          // === SUBSCRIPTION 専用 (FIXED/ROYALTY 行は空欄で OK) ===
          "cycle",
          "term_start",
          "term_end",
          "billing_day",
          // === メタ ===
          "staff_email",
          "ringi_numbers",
          "remarks",
        ],
        sample: [
          // SVC001: 業務委託 単独契約 (basic なし) + 業務明細 2 行
          ["SVC001", "", "", "", "standalone_contract",
            "V001", "株式会社XYZ", "イラスト制作業務委託契約",
            "2026-04-01", "2026-09-30", "false", "",
            "1", "イラスト制作", "5 点 (キャラクター原画)",
            "FIXED", "請負",
            "5", "30000", "150000", "2026-06-30", "2026-07-31",
            "", "", "", "",
            "tanaka@arclight.co.jp", "00001", "1 期目"],
          ["SVC001", "", "", "", "standalone_contract",
            "V001", "株式会社XYZ", "イラスト制作業務委託契約",
            "2026-04-01", "2026-09-30", "false", "",
            "2", "校正作業", "上記イラスト 5 点の修正対応",
            "FIXED", "請負",
            "1", "20000", "20000", "2026-07-31", "2026-08-31",
            "", "", "", "",
            "tanaka@arclight.co.jp", "00001", ""],
          // SVC002: 業務委託 個別契約 (基本契約 ARC-SVC-2026-0001 配下) + SUBSCRIPTION 1 行
          ["SVC002", "", "", "", "individual_contract",
            "V002", "株式会社ABC", "システム保守業務 (月額)",
            "2026-04-01", "2027-03-31", "true", "ARC-SVC-2026-0001",
            "1", "システム月額保守", "サーバ監視 + 障害対応",
            "SUBSCRIPTION", "準委任",
            "12", "50000", "600000", "", "",
            "monthly", "2026-04-01", "2027-03-31", "25",
            "tanaka@arclight.co.jp", "00002", "12 ヶ月分"],
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
      // Phase 22.21.117: decision_type 列を追加 (ringi / board_resolution)。
      //   ringi_number は 5 桁数字でも "R-NNNNN" / "B-NNNNN" でも OK。
      //   5 桁数字なら decision_type に応じて自動プレフィックス。
      ringi: {
        headers: [
          "import_key",
          "decision_type",
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
          ["RNG001", "ringi", "R-00001", "商品開発稟議 ◯◯シリーズ", "商品開発", "田中 太郎", "商品企画部", "2024-04-01", "ARC-1001", "approved", "5000000", "Phase 1 開発予算"],
          ["RNG002", "ringi", "00002", "ライセンス取得稟議 (海外 IP)", "ライセンス取得", "鈴木 花子", "ライセンス部", "2024-05-15", "ARC-1050", "approved", "3000000", "5 桁数字は ringi なら R- に自動プレフィックス"],
          ["BRD001", "board_resolution", "B-00001", "取締役会決議 — 海外子会社設立", "経営", "高橋 部長", "経営企画部", "2024-04-15", "ARC-2001", "approved", "100000000", "2024 年度第 2 回取締役会"],
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
        // Phase 22.21.91: 契約マスタ (capability) ベースの preview を許容。
        //   license_financial_condition_id が 0/null で capability 側 id があれば
        //   capability_financial_conditions から条件を引く ("what-if" preview)。
        capability_financial_condition_id:
          req.body.capability_financial_condition_id != null
            ? Number(req.body.capability_financial_condition_id)
            : undefined,
        // Phase 28: 製造/印刷契機 (manufacturing) か売上報告ベース
        //   (sales/sublicense) かで gross の算式を切替える。
        calc_type: req.body.calc_type || undefined,
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
        capability_financial_condition_id:
          body.capability_financial_condition_id != null
            ? Number(body.capability_financial_condition_id)
            : undefined,
        unit_price: Number(body.unit_price),
        quantity: Number(body.quantity),
        sample_quantity: Number(body.sample_quantity) || 0,
        tax_rate: body.tax_rate != null ? Number(body.tax_rate) : undefined,
        // Phase 28: 確定保存時も calc_type を反映 (フロント送信値は信用せず再計算)。
        calc_type: body.calc_type || undefined,
      });

      // Phase 23: royalty_calculations.license_contract_id /
      //   license_financial_condition_id → capability_id /
      //   capability_financial_condition_id (FK 列は Phase 23 マイグレーションで追加済)
      const result = await query(
        `INSERT INTO royalty_calculations (
           backlog_issue_key, capability_id, capability_financial_condition_id,
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
      // Phase C-5: 新スキーマへ非致命で二重書き込み (royalty_calc event)。
      //   condition_line / 計算書 document が未解決なら skip。
      await safeSync("royalty_calc event", () =>
        syncRoyaltyCalcEvent({ query }, Number(result.rows[0].id))
      );

      res.json({ ok: true, id: result.rows[0].id, computed });
    } catch (error) {
      console.error("/api/royalty-calculations failed:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // データ構造刷新 Phase E-1: 文書 void。
  //   documents.lifecycle_status='voided' に倒し、同一トランザクションで
  //   その文書に紐づく有効 condition_events の voided_at をセットする。
  //   消化額・MG/AG・残高は導出ビュー / dual-read 集計なので、void と同時に
  //   自動的に復元される (D-3 で実証済み)。Backlog コメントは best-effort。
  // -------------------------------------------------------------------
  app.post("/api/documents/:id/void", express.json(), async (req, res) => {
    const documentId = Number(req.params.id);
    if (!Number.isFinite(documentId)) {
      return res.status(400).json({ ok: false, error: "invalid document id" });
    }
    const reason = String(req.body?.reason || "").trim() || null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const docRes = await client.query(
        `SELECT id, document_number, issue_key, lifecycle_status FROM documents WHERE id = $1`,
        [documentId]
      );
      if (!docRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "document not found" });
      }
      const doc = docRes.rows[0];
      // 文書を void 状態に (lifecycle_status に CHECK は無いので 'voided' を採用。
      //   既存の final フィルタは 'final' 以外を一律除外するため後方互換)。
      await client.query(
        `UPDATE documents SET lifecycle_status = 'voided', is_primary = FALSE WHERE id = $1`,
        [documentId]
      );
      // 紐づく有効実績を取消 (同一 Tx)。
      const ev = await client.query(
        `UPDATE condition_events
            SET voided_at = CURRENT_TIMESTAMP, void_reason = $2
          WHERE document_id = $1 AND voided_at IS NULL
          RETURNING id, condition_line_id`,
        [documentId, reason]
      );
      await client.query("COMMIT");

      if (doc.issue_key) {
        try {
          await backlogService.addComment(
            doc.issue_key,
            `🗑️ 文書を void しました: ${doc.document_number || "(採番なし)"}` +
              (reason ? `\n理由: ${reason}` : "") +
              `\n→ 紐づく実績 ${ev.rowCount} 件を取消し、残高を復元しました。`
          );
        } catch (e) {
          console.warn(`[void] backlog comment failed (${doc.issue_key}):`, e);
        }
      }
      res.json({
        ok: true,
        document_id: documentId,
        document_number: doc.document_number,
        voided_events: ev.rowCount,
        affected_lines: [...new Set(ev.rows.map((r: any) => r.condition_line_id))],
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("/api/documents/:id/void failed:", error);
      res.status(500).json({ error: String(error) });
    } finally {
      client.release();
    }
  });

  // -------------------------------------------------------------------
  // データ構造刷新: 条件明細 read エンドポイント(worker read superset 補完)。
  //   admin-ui は VITE_API_READS_TO_WORKER=1 で GET を worker に寄せるため、
  //   search-api 側に追加した条件明細リードを worker にも実装する(同一SQL)。
  // -------------------------------------------------------------------

  // 課題詳細ページ向け — 1 課題に紐づく文書一覧。
  app.get("/api/issues/:issueKey/documents", async (req, res) => {
    try {
      const issueKey = String(req.params.issueKey || "").trim();
      if (!issueKey) return res.json([]);
      let result: any;
      try {
        result = await query(
          `SELECT id,
                  document_number,
                  template_type,
                  created_at,
                  created_by,
                  drive_link,
                  COALESCE(lifecycle_status, 'final') AS lifecycle_status,
                  COALESCE(is_primary, TRUE)          AS is_primary,
                  base_document_number,
                  COALESCE(revision, 0)               AS revision,
                  (SELECT cl.line_code
                     FROM condition_events ce
                     JOIN condition_lines cl ON cl.id = ce.condition_line_id
                    WHERE ce.document_id = documents.id
                    ORDER BY ce.id LIMIT 1)             AS line_code
             FROM documents
            WHERE issue_key = $1
            ORDER BY created_at DESC`,
          [issueKey]
        );
      } catch (err: any) {
        if (err && (err.code === "42703" || err.code === "42P01")) {
          console.warn(
            "[/api/issues/:issueKey/documents] schema migration 未適用 — legacy 形式で返却"
          );
          result = await query(
            `SELECT id, document_number, template_type, created_at, created_by, drive_link
               FROM documents
              WHERE issue_key = $1
              ORDER BY created_at DESC`,
            [issueKey]
          );
        } else {
          throw err;
        }
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 課題詳細ページ向け — 条件明細を背骨にした循環進捗サマリ。
  app.get("/api/issues/:issueKey/condition-line-summary", async (req, res) => {
    try {
      const issueKey = String(req.params.issueKey || "").trim();
      if (!issueKey) {
        return res.json({ ok: true, summary: { total: 0, open: 0, completed: 0 }, lines: [] });
      }
      try {
        const result = await query(
          `WITH issue_line_refs AS (
             SELECT cl.id AS condition_line_id, 'contracting'::text AS relation
               FROM condition_lines cl
               JOIN contract_capabilities cc ON cc.id = cl.capability_id
              WHERE cc.backlog_issue_key = $1
             UNION ALL
             SELECT ce.condition_line_id, 'payment'::text AS relation
               FROM condition_events ce
              WHERE ce.backlog_issue_key = $1
                AND ce.condition_line_id IS NOT NULL
           ),
           issue_lines AS (
             SELECT condition_line_id,
                    array_agg(DISTINCT relation ORDER BY relation) AS relations
               FROM issue_line_refs
              GROUP BY condition_line_id
           )
           SELECT cl.id,
                  cl.line_code,
                  cl.subject,
                  cl.payment_scheme,
                  cl.amount_ex_tax,
                  cl.currency,
                  cl.delivery_date,
                  cl.term_start,
                  cl.term_end,
                  s.status,
                  s.consumed_amount,
                  s.remaining_amount,
                  s.event_count,
                  s.last_event_at,
                  b.mg_remaining,
                  b.ag_remaining,
                  cc.document_number AS contract_number,
                  cc.backlog_issue_key AS contracting_issue_key,
                  il.relations,
                  CASE
                    WHEN 'contracting' = ANY(il.relations) AND 'payment' = ANY(il.relations) THEN 'mixed'
                    WHEN 'contracting' = ANY(il.relations) THEN 'contracting'
                    WHEN 'payment' = ANY(il.relations) THEN 'payment'
                    ELSE 'unknown'
                  END AS issue_phase,
                  ARRAY(
                    SELECT DISTINCT x.issue_key
                      FROM (
                        SELECT cc2.backlog_issue_key AS issue_key
                          FROM contract_capabilities cc2
                         WHERE cc2.id = cl.capability_id
                        UNION ALL
                        SELECT ce2.backlog_issue_key AS issue_key
                          FROM condition_events ce2
                         WHERE ce2.condition_line_id = cl.id
                           AND ce2.voided_at IS NULL
                      ) x
                     WHERE NULLIF(x.issue_key, '') IS NOT NULL
                     ORDER BY x.issue_key
                  ) AS related_issue_keys,
                  CASE
                    WHEN s.status IN ('fulfilled', 'expired') THEN NULL
                    WHEN cl.payment_scheme IN ('lump_sum', 'per_unit', 'installment') THEN 'inspection_certificate'
                    WHEN cl.payment_scheme IN ('subscription', 'royalty') THEN 'royalty_statement'
                    ELSE NULL
                  END AS next_template_type,
                  (SELECT COUNT(*)::int
                     FROM condition_events ce
                    WHERE ce.condition_line_id = cl.id
                      AND ce.voided_at IS NULL) AS total_event_count,
                  (SELECT COUNT(*)::int
                     FROM condition_events ce
                    WHERE ce.condition_line_id = cl.id
                      AND ce.backlog_issue_key = $1
                      AND ce.voided_at IS NULL) AS issue_event_count,
                  (SELECT COALESCE(json_agg(ev), '[]'::json)
                     FROM (
                       SELECT ce.event_no,
                              ce.event_type,
                              ce.occurred_at,
                              ce.period,
                              ce.amount_ex_tax,
                              ce.backlog_issue_key,
                              d.document_number,
                              d.template_type
                         FROM condition_events ce
                         LEFT JOIN documents d ON d.id = ce.document_id
                        WHERE ce.condition_line_id = cl.id
                          AND ce.voided_at IS NULL
                        ORDER BY ce.occurred_at DESC NULLS LAST, ce.event_no DESC
                        LIMIT 5
                     ) ev) AS recent_events
             FROM issue_lines il
             JOIN condition_lines cl ON cl.id = il.condition_line_id
             LEFT JOIN condition_line_status_v s ON s.id = cl.id
             LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
            ORDER BY cl.line_code NULLS LAST, cl.id`,
          [issueKey]
        );
        const lines = result.rows;
        res.json({
          ok: true,
          summary: {
            total: lines.length,
            open: lines.filter((r: any) => !["fulfilled", "expired"].includes(String(r.status || ""))).length,
            completed: lines.filter((r: any) => ["fulfilled", "expired"].includes(String(r.status || ""))).length,
            next_actions: lines.filter((r: any) => r.next_template_type).length,
          },
          lines,
        });
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          console.warn("[/api/issues/:issueKey/condition-line-summary] 新スキーマ未適用 — 空で返却");
          return res.json({ ok: true, summary: { total: 0, open: 0, completed: 0, next_actions: 0 }, lines: [] });
        }
        throw err;
      }
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  // 条件明細一覧(導出ビュー status/balance/schedule + 契約・取引先 JOIN)。
  app.get("/api/condition-lines", async (req, res) => {
    try {
      const where: string[] = [];
      const params: any[] = [];
      const add = (cond: string, val: any) => {
        params.push(val);
        where.push(cond.replace("?", `$${params.length}`));
      };
      if (req.query.status) add("s.status = ?", String(req.query.status));
      if (req.query.direction) add("cl.direction = ?", String(req.query.direction));
      if (req.query.scheme) add("cl.payment_scheme = ?", String(req.query.scheme));
      if (req.query.vendor_id) add("cc.vendor_id = ?", Number(req.query.vendor_id));
      if (req.query.capability_id) add("cl.capability_id = ?", Number(req.query.capability_id));
      if (req.query.q) {
        params.push(`%${String(req.query.q)}%`);
        where.push(
          `(cl.line_code ILIKE $${params.length} OR cl.subject ILIKE $${params.length} OR cl.condition_name ILIKE $${params.length})`
        );
      }
      // 再発行 (reissue) や差し替えで旧版になった契約/文書は
      //   lifecycle_status が 'reissued' / 'superseded' / 'voided' に倒れる。
      //   condition_lines はバージョン(=capability/document)ごとに作られるため、
      //   旧版の明細を除外しないと、現行版(final)の明細と重複して一覧に出る
      //   (発注書を修正=再発行すると旧明細が残って見える症状の原因)。
      //   親は capability を優先し、無ければ document のライフサイクルを見る。
      //   どちらも解決できない明細(横断検索の未リンク行)は 'final' 扱いで残す。
      //   例外: 旧版でも有効な実績(condition_events)が残る明細は表示を維持する。
      //     再発行時の引き継ぎ(carryOverReissueConsumption)で一意対応できず実績が
      //     旧明細に残ったケースを隠すと残額が消えて見えるため、手動確認できるよう出す。
      //   ?include_superseded=1 で旧版を無条件に含める(監査/履歴用の明示オプトイン)。
      if (String(req.query.include_superseded || "") !== "1") {
        where.push(
          `(COALESCE(cc.lifecycle_status, cd.lifecycle_status, 'final') = 'final'
            OR EXISTS (SELECT 1 FROM condition_events ce
                        WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL))`
        );
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      try {
        // 件名は subject 未設定の明細(Master/文書保存経路は condition_name にのみ
        // 書く)へフォールバック。取引先は 契約の vendor → 明細の相手方
        // (counterparty_vendor_id) → 文書の取引先名スナップショット の順で解決。
        const result = await query(
          `SELECT cl.id, cl.line_code,
                  COALESCE(NULLIF(cl.subject, ''), cl.condition_name) AS subject,
                  cl.payment_scheme, cl.direction,
                  cl.transaction_kind,
                  cl.rights_attribution, cl.capability_id, cl.amount_ex_tax, cl.currency,
                  cl.delivery_date, cl.term_start, cl.term_end,
                  s.status, s.consumed_amount, s.remaining_amount, s.event_count,
                  b.mg_remaining, b.ag_remaining,
                  cc.contract_title, cc.document_number AS contract_number,
                  COALESCE(v.vendor_name, vcp.vendor_name, cd.vendor_name_snapshot) AS vendor_name,
                  COALESCE(v.vendor_code, vcp.vendor_code) AS vendor_code,
                  sch.has_overdue
             FROM condition_lines cl
             LEFT JOIN condition_line_status_v  s ON s.id = cl.id
             LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN vendors v ON v.id = cc.vendor_id
             LEFT JOIN vendors vcp ON vcp.id = cl.counterparty_vendor_id
             LEFT JOIN documents cd ON cd.id = COALESCE(cl.document_id, cl.capability_id)
             LEFT JOIN (
               SELECT condition_line_id, bool_or(overdue AND NOT issued) AS has_overdue
                 FROM condition_line_schedule_v GROUP BY condition_line_id
             ) sch ON sch.condition_line_id = cl.id
             ${whereSql}
            ORDER BY cl.line_code NULLS LAST, cl.id`,
          params
        );
        const rows = result.rows;
        // 送信履歴(メール / CloudSign)を別クエリで付与。失敗してもリストは返す
        //   (列・テーブル未整備でも本体一覧を壊さないため try/catch で分離)。
        try {
          const ids = rows.map((r: any) => r.id).filter((n: any) => Number.isFinite(n));
          if (ids.length) {
            const send = await query(
              `SELECT cl.id,
                 (SELECT MAX(d.email_sent_at) FROM condition_events ce
                    JOIN documents d ON d.id = ce.document_id
                   WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL) AS email_sent_at,
                 (SELECT string_agg(DISTINCT d.email_to, ', ') FROM condition_events ce
                    JOIN documents d ON d.id = ce.document_id
                   WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
                     AND d.email_to IS NOT NULL AND d.email_to <> '') AS email_to,
                 (SELECT MAX(cr.sent_at) FROM cloudsign_requests cr
                   WHERE (cr.document_number = cc.document_number
                          OR cr.document_number IN (
                            SELECT d3.document_number FROM condition_events ce3
                              JOIN documents d3 ON d3.id = ce3.document_id
                             WHERE ce3.condition_line_id = cl.id AND ce3.voided_at IS NULL
                               AND d3.document_number IS NOT NULL))
                     AND cr.sent_at IS NOT NULL) AS cloudsign_sent_at,
                 (SELECT MAX(cr.completed_at) FROM cloudsign_requests cr
                   WHERE (cr.document_number = cc.document_number
                          OR cr.document_number IN (
                            SELECT d3.document_number FROM condition_events ce3
                              JOIN documents d3 ON d3.id = ce3.document_id
                             WHERE ce3.condition_line_id = cl.id AND ce3.voided_at IS NULL
                               AND d3.document_number IS NOT NULL))
                     AND cr.status = 'completed' AND cr.completed_at IS NOT NULL) AS cloudsign_completed_at,
                 (SELECT MAX(cr.created_at) FROM cloudsign_requests cr
                   WHERE (cr.document_number = cc.document_number
                          OR cr.document_number IN (
                            SELECT d3.document_number FROM condition_events ce3
                              JOIN documents d3 ON d3.id = ce3.document_id
                             WHERE ce3.condition_line_id = cl.id AND ce3.voided_at IS NULL
                               AND d3.document_number IS NOT NULL))
                     AND cr.status = 'draft' AND cr.sent_at IS NULL) AS cloudsign_draft_at,
                 (SELECT d.document_number FROM condition_events ce
                    JOIN documents d ON d.id = ce.document_id
                   WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
                     AND (d.template_type ILIKE 'inspection%'
                          OR d.template_type IN ('royalty_statement','license_calculation_sheet'))
                   ORDER BY ce.occurred_at DESC NULLS LAST, ce.event_no DESC
                   LIMIT 1) AS send_doc_number,
                 (SELECT COUNT(*)::int FROM condition_events ce
                    JOIN documents d ON d.id = ce.document_id
                   WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
                     AND ce.event_type = 'inspection') AS inspection_event_count
                 FROM condition_lines cl
                 LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
                WHERE cl.id = ANY($1::int[])`,
              [ids]
            );
            const m = new Map<number, any>(send.rows.map((r: any) => [Number(r.id), r]));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            for (const r of rows) {
              const s = m.get(Number(r.id));
              if (!s) continue;
              r.email_sent_at = s.email_sent_at || null;
              r.email_to = s.email_to || null;
              r.cloudsign_sent_at = s.cloudsign_sent_at || null;
              r.send_doc_number = s.send_doc_number || null;
              // 締結完了日時(締結済 → 「✅ 締結済」表示用)。
              r.cloudsign_completed_at = s.cloudsign_completed_at || null;
              // ②: 未送信の下書き作成日時(下書保存運用で「送信準備中」を可視化)。
              r.cloudsign_draft_at = s.cloudsign_draft_at || null;
              // 表示用の代表値(メール優先 → CloudSign)。
              r.sent_at = s.email_sent_at || s.cloudsign_sent_at || null;
              r.sent_channel = s.email_sent_at ? "メール" : s.cloudsign_sent_at ? "CloudSign" : null;
              // A+C: 検収待ち / 期限超過(検収書の自動課題を廃し、ここで可視化)。
              //   対象: 検収を要する支払明細(一括/従量/分割)で、未成就かつ
              //   inspection イベントが無いもの。利用許諾(royalty)等は計算書管理なので対象外。
              const needsInspection = ["lump_sum", "per_unit", "installment"].includes(
                String(r.payment_scheme || "")
              );
              const unfulfilled = r.status === "open" || r.status === "partially_fulfilled";
              r.inspection_pending = needsInspection && unfulfilled && Number(s.inspection_event_count || 0) === 0;
              r.inspection_overdue =
                r.inspection_pending && !!r.delivery_date && new Date(r.delivery_date) <= today;
            }
          }
        } catch (enrichErr: any) {
          console.warn("[/api/condition-lines] 送信履歴の付与に失敗:", enrichErr?.message || enrichErr);
        }
        res.json(rows);
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          console.warn("[/api/condition-lines] 新スキーマ未適用 — 空配列で返却");
          return res.json([]);
        }
        throw err;
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 条件明細詳細(events / schedule 同梱)。:id/payments と段数が違うため衝突しない。
  app.get("/api/condition-lines/:lineCode", async (req, res) => {
    try {
      const lineCode = String(req.params.lineCode || "").trim();
      if (!lineCode) return res.status(400).json({ ok: false, error: "lineCode required" });
      try {
        // 件名/取引先は一覧と同じフォールバック(subject→condition_name、
        // 契約vendor→明細相手方→文書スナップショット)。cl.* の subject より
        // 後に置いた別名が行オブジェクトで優先される。
        const main = await query(
          `SELECT cl.*, s.status, s.consumed_amount, s.remaining_amount,
                  s.event_count, s.last_event_at,
                  b.mg_consumed, b.mg_remaining, b.ag_consumed, b.ag_remaining,
                  cc.contract_title, cc.document_number AS contract_number,
                  cc.structural_role, cc.parent_capability_id,
                  COALESCE(NULLIF(cl.subject, ''), cl.condition_name) AS subject,
                  COALESCE(v.vendor_name, vcp.vendor_name, cd.vendor_name_snapshot) AS vendor_name,
                  COALESCE(v.vendor_code, vcp.vendor_code) AS vendor_code,
                  w.work_code, w.title AS work_title
             FROM condition_lines cl
             LEFT JOIN condition_line_status_v  s ON s.id = cl.id
             LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN vendors v ON v.id = cc.vendor_id
             LEFT JOIN vendors vcp ON vcp.id = cl.counterparty_vendor_id
             LEFT JOIN documents cd ON cd.id = COALESCE(cl.document_id, cl.capability_id)
             LEFT JOIN works w ON w.id = cl.work_id
            WHERE cl.line_code = $1
            LIMIT 1`,
          [lineCode]
        );
        if (!main.rows.length) {
          return res.status(404).json({ ok: false, error: "condition_line not found" });
        }
        const line = main.rows[0];
        const events = await query(
          `SELECT e.id, e.event_no, e.event_type, e.occurred_at, e.period,
                  e.amount_ex_tax, e.voided_at, e.void_reason, e.backlog_issue_key,
                  e.installment_id,
                  d.document_number, d.lifecycle_status, d.drive_link, d.issue_key,
                  d.email_sent_at, d.email_to,
                  (SELECT MAX(cr.sent_at) FROM cloudsign_requests cr
                    WHERE cr.document_number = d.document_number AND cr.sent_at IS NOT NULL) AS cloudsign_sent_at
             FROM condition_events e
             LEFT JOIN documents d ON d.id = e.document_id
            WHERE e.condition_line_id = $1
            ORDER BY e.occurred_at NULLS LAST, e.event_no`,
          [line.id]
        );
        const schedule = await query(
          `SELECT expected_period, issued, overdue
             FROM condition_line_schedule_v
            WHERE condition_line_id = $1
            ORDER BY expected_period`,
          [line.id]
        );
        res.json({ ok: true, line, events: events.rows, schedule: schedule.rows });
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          return res.status(404).json({ ok: false, error: "新スキーマ未適用" });
        }
        throw err;
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // -------------------------------------------------------------------
  // データ構造刷新 Phase E-3: 条件明細への支払記録イベント。
  //   subscription / installment / 着手金 など「文書を伴わない支払」の記録。
  //   event_type='payment' は document_id を持たない (CHECK ce_document_pairing)。
  // -------------------------------------------------------------------
  app.post(
    "/api/condition-lines/:id/payments",
    express.json(),
    async (req, res) => {
      const conditionLineId = Number(req.params.id);
      if (!Number.isFinite(conditionLineId)) {
        return res
          .status(400)
          .json({ ok: false, error: "invalid condition_line id" });
      }
      const body = req.body || {};
      const amount = Number(body.amount_ex_tax);
      if (!Number.isFinite(amount)) {
        return res
          .status(400)
          .json({ ok: false, error: "amount_ex_tax is required" });
      }
      try {
        const clRes = await query(
          `SELECT id FROM condition_lines WHERE id = $1`,
          [conditionLineId]
        );
        if (!clRes.rows.length) {
          return res
            .status(404)
            .json({ ok: false, error: "condition_line not found" });
        }
        const eventNoRes = await query(
          `SELECT COALESCE(MAX(event_no),0)+1 AS n FROM condition_events WHERE condition_line_id = $1`,
          [conditionLineId]
        );
        const ins = await query(
          `INSERT INTO condition_events
             (condition_line_id, event_no, event_type, installment_id,
              backlog_issue_key, occurred_at, period, amount_ex_tax)
           VALUES ($1,$2,'payment',$3,$4,$5,$6,$7)
           RETURNING id, event_no`,
          [
            conditionLineId,
            Number(eventNoRes.rows[0].n),
            body.installment_id != null ? Number(body.installment_id) : null,
            body.backlog_issue_key ? String(body.backlog_issue_key) : null,
            body.occurred_at || new Date().toISOString(),
            body.period || null,
            amount,
          ]
        );
        res.json({
          ok: true,
          event_id: ins.rows[0].id,
          event_no: ins.rows[0].event_no,
        });
      } catch (error) {
        console.error("/api/condition-lines/:id/payments failed:", error);
        res.status(500).json({ error: String(error) });
      }
    }
  );

  // 複数の条件明細について、成就させた文書(検収書/利用許諾料計算書)の番号を一括取得。
  //   横断検索の「検収書」列表示用。voided でない inspection/royalty_calc イベントの document を返す。
  app.post("/api/condition-lines/inspection-docs", express.json(), async (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids)
        ? req.body.ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
        : [];
      if (!ids.length) return res.json({ ok: true, map: {} });
      const r = await query(
        `SELECT ce.condition_line_id, ce.event_type,
                d.id AS document_id, d.document_number, d.template_type
           FROM condition_events ce
           JOIN documents d ON d.id = ce.document_id
          WHERE ce.condition_line_id = ANY($1::int[])
            AND ce.voided_at IS NULL
            AND ce.event_type IN ('inspection', 'royalty_calc')
          ORDER BY ce.occurred_at DESC`,
        [ids]
      );
      const map: Record<string, any[]> = {};
      for (const row of r.rows) {
        const k = String(row.condition_line_id);
        if (!map[k]) map[k] = [];
        if (!map[k].some((x) => x.document_number === row.document_number))
          map[k].push({
            document_id: row.document_id,
            document_number: row.document_number,
            template_type: row.template_type,
            event_type: row.event_type,
          });
      }
      res.json({ ok: true, map });
    } catch (e: any) {
      console.error("/api/condition-lines/inspection-docs failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 条件明細に「対になる文書(検収書/利用許諾料計算書)」をリンクして実績(condition_events)を
  //   記録する = 検収済化。発注明細の検収管理(手動リンク)用。document_id の種別で
  //   event_type を決める(検収書→inspection / 利用許諾料計算書→royalty_calc)。
  app.post("/api/condition-lines/:id/link-document", express.json(), async (req, res) => {
    try {
      const lineId = Number(req.params.id);
      const documentId = Number(req.body?.document_id);
      if (!Number.isFinite(lineId) || !Number.isFinite(documentId))
        return res.status(400).json({ ok: false, error: "id / document_id required" });

      const lq = await query(`SELECT id, amount_ex_tax FROM condition_lines WHERE id = $1`, [lineId]);
      const line = lq.rows[0];
      if (!line) return res.status(404).json({ ok: false, error: "条件明細が見つかりません" });

      const dq = await query(
        `SELECT id, document_number, template_type, issue_key FROM documents WHERE id = $1`,
        [documentId]
      );
      const doc = dq.rows[0];
      if (!doc) return res.status(404).json({ ok: false, error: "文書が見つかりません" });
      const eventType =
        doc.template_type === "royalty_statement" ? "royalty_calc" : "inspection";

      // 既存の有効実績合計 → 残額。amount 指定が無ければ残額全部。
      const sq = await query(
        `SELECT COALESCE(SUM(amount_ex_tax),0) AS consumed, COALESCE(MAX(event_no),0) AS maxno
           FROM condition_events WHERE condition_line_id = $1 AND voided_at IS NULL`,
        [lineId]
      );
      const consumed = Number(sq.rows[0].consumed) || 0;
      const total = Number(line.amount_ex_tax) || 0;
      const remaining = total - consumed;
      let amount =
        req.body?.amount_ex_tax === undefined || req.body?.amount_ex_tax === null
          ? remaining
          : Number(req.body.amount_ex_tax);
      if (!Number.isFinite(amount) || amount <= 0)
        return res.status(400).json({ ok: false, error: `金額が不正、または残額がありません(残 ${remaining})` });

      const ins = await query(
        `INSERT INTO condition_events
           (condition_line_id, event_no, event_type, document_id, backlog_issue_key, occurred_at, amount_ex_tax)
         VALUES ($1, $2, $3, $4, $5, now(), $6) RETURNING id`,
        [lineId, Number(sq.rows[0].maxno) + 1, eventType, documentId, doc.issue_key || null, amount]
      );
      res.json({
        ok: true,
        event_id: ins.rows[0].id,
        event_type: eventType,
        document_number: doc.document_number,
        amount_ex_tax: amount,
      });
    } catch (e: any) {
      console.error("/api/condition-lines/:id/link-document failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 実績(condition_events)を void = 文書リンク解除(未成就に戻す)。文書自体は残る。
  app.post("/api/condition-events/:id/void", express.json(), async (req, res) => {
    try {
      const eventId = Number(req.params.id);
      if (!Number.isFinite(eventId)) return res.status(400).json({ ok: false, error: "invalid id" });
      const reason = String(req.body?.reason || "").trim() || null;
      const r = await query(
        `UPDATE condition_events
            SET voided_at = CURRENT_TIMESTAMP, void_reason = $2
          WHERE id = $1 AND voided_at IS NULL
          RETURNING id, condition_line_id`,
        [eventId, reason]
      );
      if (!r.rows[0])
        return res.status(404).json({ ok: false, error: "実績が見つからない、または既に void 済み" });
      res.json({ ok: true, event_id: r.rows[0].id, condition_line_id: r.rows[0].condition_line_id });
    } catch (e: any) {
      console.error("/api/condition-events/:id/void failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 統合Phase3c 増分③: 条件明細(エッジ)をグラフのノードへ参照リンクする。
  //   condition_lines を新規作成せず、既存明細の source_work_id / source_material_id /
  //   product_id / counterparty_vendor_id を設定/解除するだけ(参照リンク)。
  //   null を明示指定すると解除。未指定キーは変更しない。
  app.patch("/api/condition-lines/:id/graph-link", express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      const b = req.body || {};
      const sets: string[] = [];
      const vals: any[] = [];
      const put = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
      if ("source_work_id" in b) put("source_work_id", b.source_work_id ?? null);
      if ("source_material_id" in b) put("source_material_id", b.source_material_id ?? null);
      if ("product_id" in b) put("product_id", b.product_id ?? null);
      if ("counterparty_vendor_id" in b) put("counterparty_vendor_id", b.counterparty_vendor_id ?? null);
      if (sets.length === 0) return res.status(400).json({ ok: false, error: "変更項目がありません" });
      vals.push(id);
      const r = await query(
        `UPDATE condition_lines SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING id`,
        vals
      );
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "条件明細が見つかりません" });
      res.json({ ok: true, id });
    } catch (e: any) {
      console.error("/api/condition-lines/:id/graph-link failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 条件明細の手動削除(物理)。重複・誤作成の整理用。
  //   ガード: 検収/計算/支払の実績(condition_events)がある明細は削除しない(履歴保全)。
  //   作品コンポーネント紐付け(work_component_lines)がある場合も拒否。
  //   分割予定(condition_line_installments)は ON DELETE CASCADE で同時削除。
  app.post("/api/condition-lines/:id/delete", express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0)
        return res.status(400).json({ ok: false, error: "invalid id" });
      const ev = await query(
        `SELECT COUNT(*)::int AS n FROM condition_events WHERE condition_line_id = $1`,
        [id]
      );
      if (Number(ev.rows[0]?.n) > 0) {
        return res.status(409).json({
          ok: false,
          error:
            "この明細には実績(検収/計算/支払)があるため削除できません。先に該当実績を取消(void)してください。",
        });
      }
      const wc = await query(
        `SELECT COUNT(*)::int AS n FROM work_component_lines WHERE condition_line_id = $1`,
        [id]
      );
      if (Number(wc.rows[0]?.n) > 0) {
        return res.status(409).json({
          ok: false,
          error: "作品コンポーネントに紐付いているため削除できません。先に紐付けを解除してください。",
        });
      }
      const del = await query(
        `DELETE FROM condition_lines WHERE id = $1 RETURNING line_code`,
        [id]
      );
      if (!del.rows.length)
        return res.status(404).json({ ok: false, error: "明細が見つかりません" });
      res.json({ ok: true, deleted: id, line_code: del.rows[0].line_code || null });
    } catch (e: any) {
      console.error("/api/condition-lines/:id/delete failed:", e?.message || e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });


  /**
   * Phase 23.6.15: 検収書の金額サマリーをサーバ側で一元計算する (適格請求書対応)。
   *
   *   消費税は「検収明細 税抜 + その他手数料 税抜」を合算した課税標準に対して、
   *   税率ごとに 1 回だけ計算する (per-section の二重計上・二重丸めを排除)。
   *   経費 (expenses) は領収書の税込み額をそのまま精算する課税対象外の立替で、
   *   合計には税込のまま加算する。
   *
   *   戻り値は inspection_certificate.html が参照する整形済み文字列群。
   *   preview / generate の両方で details にスプレッドして使う。
   */
  function computeInspectionSummary(formData: any) {
    const isReduced = !!formData?.isReducedTax;
    const taxRate = Number(formData?.taxRate) || (isReduced ? 8 : 10);

    // 検収明細 税抜合計: delivery_line_items[] 優先、無ければ deliveredAmountStr。
    const deliveryLines = Array.isArray(formData?.delivery_line_items)
      ? formData.delivery_line_items
      : [];
    const deliveredExTax =
      deliveryLines.length > 0
        ? deliveryLines.reduce(
            (s: number, l: any) =>
              s +
              (Number(l?.inspected_amount_ex_tax) ||
                Number(l?.amount_ex_tax) ||
                0),
            0
          )
        : Number(
            String(formData?.deliveredAmountStr || "0").replace(/[^0-9.-]+/g, "")
          ) || 0;

    // その他手数料 税抜合計 (課税対象)
    const otherFees = Array.isArray(formData?.other_fees)
      ? formData.other_fees
      : [];
    const otherFeesExTax = otherFees.reduce(
      (s: number, f: any) => s + (Number(f?.amount) || 0),
      0
    );
    const otherFeesTaxable = otherFees.length > 0 && otherFeesExTax > 0;

    // 経費 (税込パススルー・課税対象外)
    const expenses = Array.isArray(formData?.expenses) ? formData.expenses : [];
    const expensesIncTax = expenses.reduce(
      (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
      0
    );

    // 検収単体の税 (手数料が無いときの「源泉徴収税計算前　検収金額(税込)」用)
    const deliveryTaxOnly = Math.ceil((deliveredExTax * taxRate) / 100);
    const deliveryTotalIncTax = deliveredExTax + deliveryTaxOnly;

    // 課税標準 (検収税抜 + 手数料税抜) に対して消費税を 1 回だけ計算
    const taxableBaseExTax = deliveredExTax + otherFeesExTax;
    const combinedTax = Math.ceil((taxableBaseExTax * taxRate) / 100);
    const taxableTotalIncTax = taxableBaseExTax + combinedTax;

    // 総支払額 = 課税分(税込) + 経費(税込)
    const grandTotalPayable = taxableTotalIncTax + expensesIncTax;

    const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");

    // 業績連動型報酬版: 発注者帰属×ROYALTY の明細を抽出。検収書テンプレで
    //   「業績連動報酬（別途算定）」表示・専用条件セクションの出し分けに使う。
    //   (IPは発注者へ譲渡=譲渡型、報酬は業績連動で別途算定・支払。)
    const performanceRoyaltyLines = deliveryLines.filter(
      (l: any) =>
        l?.calc_method === "ROYALTY" && l?.deliverable_ownership === "発注者"
    );
    const hasPerformanceRoyalty = performanceRoyaltyLines.length > 0;

    return {
      // 業績連動型報酬版フラグ・対象行
      hasPerformanceRoyalty,
      performanceRoyaltyLines,
      expenses,
      other_fees: otherFees,
      otherFeesTaxable,
      taxRate,
      // 検収明細
      deliveredAmountStr: yen(deliveredExTax),
      taxAmountStr: yen(deliveryTaxOnly),
      totalAmountStr: yen(deliveryTotalIncTax),
      // その他手数料 (税抜)
      otherFeesTotalStr: yen(otherFeesExTax),
      // 適格請求書サマリー (税率ごとに区分・消費税は 1 回)
      taxableSubtotalExTaxStr: yen(taxableBaseExTax),
      combinedTaxStr: yen(combinedTax),
      taxableTotalIncTaxStr: yen(taxableTotalIncTax),
      // 経費 (税込)
      expensesTotalIncTax: expensesIncTax,
      expensesTotalIncTaxStr: yen(expensesIncTax),
      // 総支払額
      grandTotalPayable,
      grandTotalPayableStr: yen(grandTotalPayable),
    };
  }

  app.post("/api/documents/preview", express.json(), async (req, res) => {
    try {
      const { templateType, formData, issueKey, requesterEmail } = req.body;

      // Phase 17i: 経費合計をサーバ側で再計算
      const previewExpenses = Array.isArray(formData?.expenses) ? formData.expenses : [];
      const previewExpensesTotal = previewExpenses.reduce(
        (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
        0
      );
      // Phase 23.6.15: 検収書系は消費税 1 回計算の適格請求書サマリーで上書き。
      const previewInspectionSummary = String(templateType || "").includes(
        "inspection"
      )
        ? computeInspectionSummary(formData)
        : null;

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
            ...(previewInspectionSummary || {}),
            // 検収書: 明細No 列挙(generate と共通)。
            ...(String(templateType || "").includes("inspection")
              ? computeInspectionItemNo(formData) || {}
              : {}),
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
      const body = req.body || {};
      let data: any;
      if (body && body.formData) {
        // 新経路: 生 formData からバッチと同じ buildFromFormData で構築。
        //   delivery_line_items・税込金額・支払期日(paymentDueDate)・件名=成果物内容 を反映。
        //   旧経路はフロントが空の旧フラット項目(支払内容（i）等)を読んでおり値が入らなかった。
        const templateType = body.templateType || "inspection_certificate";
        const vendor = await resolveVendorForExcel(body.formData);
        data = excelService.buildFromFormData(body.formData, templateType, vendor);
        if (!data) {
          return res
            .status(400)
            .json({ error: "Excel 出力対象の明細が見つかりません(検収内容/明細を入力してください)" });
        }
      } else {
        // 後方互換: 事前構築済み InspectionExcelData をそのまま使う。
        data = body;
      }
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

  // ---------------------------------------------------------------------
  // Phase 24: 会計用 Excel のバッチ出力（担当者 × 支払期日）
  //
  //   PDF 発行と同時に Excel を作るのをやめ、検収書 / 利用許諾料計算書を
  //   「発行済みだが Excel 未発行」(documents.excel_issued_at IS NULL) で
  //   溜め、検収担当者 × 支払期日 でまとめて 1 ファイル (複数行) に出力する。
  // ---------------------------------------------------------------------

  // formData から vendor を解決（旧インライン生成のロジックを踏襲）。
  const resolveVendorForExcel = async (formData: any): Promise<any> => {
    let vendorRow: any = null;

    const masterId = Number(formData?.selected_master_contract_id) || 0;
    if (masterId > 0) {
      const r = await query(
        `SELECT v.vendor_code, v.vendor_name, v.entity_type,
                v.account_holder_kana, v.withholding_enabled,
                v.invoice_registration_number
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
          WHERE cc.id = $1 LIMIT 1`,
        [masterId]
      );
      if (r.rows[0]?.vendor_code) vendorRow = r.rows[0];
    }

    if (!vendorRow) {
      const poId = Number(formData?.parent_po_id) || 0;
      if (poId > 0) {
        const r = await query(
          `SELECT v.vendor_code, v.vendor_name, v.entity_type,
                  v.account_holder_kana, v.withholding_enabled,
                  v.invoice_registration_number
             FROM contract_capabilities cc
             LEFT JOIN vendors v ON v.id = cc.vendor_id
            WHERE cc.id = $1 AND cc.record_type = 'purchase_order'
            LIMIT 1`,
          [poId]
        );
        if (r.rows[0]?.vendor_code) vendorRow = r.rows[0];
      }
    }

    if (!vendorRow) {
      const vcode = (formData?.VENDOR_CODE as string) || "";
      if (vcode) {
        const r = await query(
          `SELECT vendor_code, vendor_name, entity_type,
                  account_holder_kana, withholding_enabled,
                  invoice_registration_number
             FROM vendors WHERE vendor_code = $1 LIMIT 1`,
          [vcode]
        );
        vendorRow = r.rows[0] || null;
      }
    }

    if (!vendorRow) {
      const vname =
        (formData?.VENDOR_NAME as string) ||
        (formData?.counterparty as string) ||
        (formData?.licensor as string) ||
        "";
      if (vname) {
        const r = await query(
          `SELECT vendor_code, vendor_name, entity_type,
                  account_holder_kana, withholding_enabled,
                  invoice_registration_number
             FROM vendors WHERE vendor_name = $1 LIMIT 1`,
          [vname]
        );
        vendorRow = r.rows[0] || null;
      }
    }

    // 個人取引先は withholding_enabled 未設定でも源泉対象とみなす。
    if (vendorRow) {
      const et = String(vendorRow.entity_type || "").toLowerCase();
      const isIndividual = et === "個人" || et === "individual";
      if (isIndividual && vendorRow.withholding_enabled !== true) {
        vendorRow = { ...vendorRow, withholding_enabled: true };
      }
    }
    // formData の VENDOR_WITHHOLDING_ENABLED を最優先で採用（保険）。
    if (formData?.VENDOR_WITHHOLDING_ENABLED === true) {
      vendorRow = vendorRow
        ? { ...vendorRow, withholding_enabled: true }
        : {
            vendor_code: formData.VENDOR_CODE || "",
            vendor_name: formData.licensor || formData.counterparty || "",
            withholding_enabled: true,
          };
    }
    return vendorRow;
  };

  // 検収担当者 / 支払期日 のグルーピングキーを formData から導出。
  //   buildFromFormData の payment_date 算出ロジックと揃える。
  const deriveExcelGroupKey = (templateType: string, fd: any) => {
    const isRoyalty = templateType === "royalty_statement";
    const category = isRoyalty ? "royalty_statement" : "inspection_certificate";
    const inspectorEmail = fd?.inspectorEmail || fd?.STAFF_EMAIL || "";
    const inspectorName =
      fd?.inspectorName || fd?.STAFF_NAME || "(担当者未設定)";
    const rawDate = isRoyalty
      ? fd?.paymentDueDate || fd?.documentDate || ""
      : fd?.paymentDate || fd?.payment_due_date || fd?.documentDate || "";
    const paymentDate = rawDate ? String(rawDate).substring(0, 10) : "";
    return { category, inspectorEmail, inspectorName, paymentDate };
  };

  // 未発行の検収書 / 利用許諾料計算書を 担当者 × 支払期日 × 種別 で集計。
  app.get("/api/excel-batches/pending", async (_req, res) => {
    try {
      const r = await query(
        `SELECT document_number, template_type, form_data, created_at
           FROM documents
          WHERE excel_issued_at IS NULL
            AND is_primary = TRUE
            AND lifecycle_status = 'final'
            AND (template_type LIKE 'inspection_certificate%'
                 OR template_type = 'royalty_statement')
          ORDER BY created_at ASC`
      );
      const groups = new Map<string, any>();
      for (const row of r.rows) {
        const fd = row.form_data || {};
        const { category, inspectorEmail, inspectorName, paymentDate } =
          deriveExcelGroupKey(String(row.template_type || ""), fd);
        const key = `${category}||${inspectorEmail}||${paymentDate}`;
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            category,
            inspectorEmail,
            inspectorName,
            paymentDate,
            count: 0,
            documentNumbers: [] as string[],
            items: [] as any[],
          });
        }
        const g = groups.get(key);
        g.count += 1;
        g.documentNumbers.push(row.document_number);
        // 担当者区切り表示の詳細用: 検収日・件名などを同梱。
        //   検収日 = inspectionCompletedAt(検収完了日) を最優先、無ければ documentDate(発行日)。
        g.items.push({
          document_number: row.document_number,
          inspection_date:
            fd.inspectionCompletedAt || fd.documentDate || fd.deliveredAt || "",
          title:
            fd.description || fd.PROJECT_TITLE || fd.contract_title || "",
          counterparty: fd.counterparty || fd.VENDOR_NAME || "",
        });
      }
      res.json({ success: true, groups: Array.from(groups.values()) });
    } catch (e: any) {
      console.error("[excel-batches/pending] failed:", e);
      res
        .status(500)
        .json({ success: false, error: String(e?.message || e) });
    }
  });

  // 指定した未発行ドキュメント群を 1 ファイル (複数行) で出力 → Drive →
  //   excel_issued_at / excel_link を更新。
  app.post(
    "/api/excel-batches/export",
    express.json(),
    async (req, res) => {
      try {
        const documentNumbers: string[] = Array.isArray(
          req.body?.documentNumbers
        )
          ? req.body.documentNumbers
          : [];
        if (documentNumbers.length === 0) {
          return res
            .status(400)
            .json({ success: false, error: "documentNumbers は必須です" });
        }

        const r = await query(
          `SELECT document_number, template_type, form_data
             FROM documents
            WHERE document_number = ANY($1)
              AND excel_issued_at IS NULL`,
          [documentNumbers]
        );
        if (r.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: "対象の未発行ドキュメントが見つかりません",
          });
        }

        const dataList: any[] = [];
        let category = "inspection_certificate";
        let inspectorName = "";
        let paymentDate = "";
        for (const row of r.rows) {
          const fd = row.form_data || {};
          const vendorRow = await resolveVendorForExcel(fd);
          const xl = excelService.buildFromFormData(
            fd,
            String(row.template_type || ""),
            vendorRow
          );
          if (xl) {
            dataList.push(xl);
            if (row.template_type === "royalty_statement")
              category = "royalty_statement";
            const g = deriveExcelGroupKey(String(row.template_type || ""), fd);
            inspectorName = inspectorName || g.inspectorName;
            paymentDate = paymentDate || g.paymentDate || xl.payment_date || "";
          }
        }
        if (dataList.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Excel データを生成できませんでした",
          });
        }

        const label =
          category === "royalty_statement" ? "利用許諾料計算書" : "検収書";
        const buffer = excelService.generateInspectionExcelBatch(
          dataList,
          label
        );
        const safeName = (inspectorName || "unknown").replace(
          /[\\/:*?"<>|]/g,
          "_"
        );
        const xlsxName = `${label}_${safeName}_${paymentDate || "nodate"}.xlsx`;
        const { Readable } = await import("stream");
        const stream = Readable.from(buffer);
        const link = await googleDriveService.uploadFile(
          stream,
          xlsxName,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        const issuedNumbers = r.rows.map((x: any) => x.document_number);
        await query(
          `UPDATE documents
              SET excel_issued_at = NOW(), excel_link = $2
            WHERE document_number = ANY($1)
              AND excel_issued_at IS NULL`,
          [issuedNumbers, link]
        );

        console.log(
          `[excel-batches/export] ${label} ${safeName} ${paymentDate}: ` +
            `${dataList.length} 件 → ${link}`
        );
        res.json({
          success: true,
          excelLink: link,
          fileName: xlsxName,
          count: dataList.length,
        });
      } catch (e: any) {
        console.error("[excel-batches/export] failed:", e);
        res
          .status(500)
          .json({ success: false, error: String(e?.message || e) });
      }
    }
  );

  app.post("/api/documents/generate", express.json(), async (req, res) => {
    // Phase 23.1: reissue フラグを受け取り、内部修正 (default: false) と
    //   外部要請の再発行 (true) を区別する。
    //   - reissue=false: 同 row UPDATE + Drive PDF 上書き (overwrite=true)
    //   - reissue=true:  revision+1 で新 row + Drive 新規アップロード、
    //                    過去 row は lifecycle_status='reissued' に倒す
    // skipPdf=true (DB登録のみ): PDF 生成 / Drive アップロードを行わず、
    //   採番 + documents/condition_lines 等の DB 登録だけを実行する。
    //   マスター登録と同じ「文書を発行しない登録」を通常フォームから行うモード。
    //   fileLink: skipPdf=true のときのみ有効。既存の締結済み PDF 等の URL を
    //   drive_link として保存する (紙契約のスキャン等を一覧から開けるように)。
    //   recordType: skipPdf=true のときのみ有効。単独契約(親なし)を発注書/ILT
    //   テンプレで代用登録するケース用に、テンプレ由来の record_type を上書きする。
    let { issueKey, templateType, formData, requesterEmail, nextStatusId, existingDocumentNumber, reissue, skipPdf, fileLink, recordType: recordTypeOverride } = req.body;

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
      // Phase 23.1: overwrite=true なら既存 row UPDATE + Drive PDF 上書き経路。
      //   false なら現状通り新規 INSERT + 新規 Drive アップロード。
      let overwrite: boolean;
      if (manualOverride) {
        // 手動上書き: 番号を完全にユーザーが制御
        docNumber = manualOverride;
        baseDocumentNumber = manualOverride;
        revision = 0;
        isReissue = false;
        overwrite = false;
        console.log(
          `📝 [manual-override] ${issueKey} ${templateType}: docNumber=${docNumber}`
        );
      } else {
        const numAssign = await getDocumentNumberForGenerate({
          issueKey,
          templateType,
          issueTypeName: issue.issueType.name,
          existingDocumentNumber,
          reissue: reissue === true,
          // 重複防止: 内容ハッシュで「同一内容の保存し直し」を再採番せず上書きへ寄せる。
          contentHash: computeFormContentHash(formData, templateType),
        });
        docNumber = numAssign.documentNumber;
        baseDocumentNumber = numAssign.baseDocumentNumber;
        revision = numAssign.revision;
        isReissue = numAssign.isReissue;
        overwrite = numAssign.overwrite;
        if (isReissue) {
          console.log(
            `📝 [reissue] ${issueKey} ${templateType}: base=${baseDocumentNumber} rev=${revision} → ${docNumber}`
          );
        } else if (overwrite) {
          console.log(
            `📝 [overwrite] ${issueKey} ${templateType}: docNumber=${docNumber} rev=${revision} (内部修正)`
          );
        }
      }

      // 二重作成ガード: 完全新規(再発行でも内部修正の上書きでもない)で、同一
      //   課題(issue_key)× 同一種別(template_type)の正本(final)が既にある場合は
      //   ブロックし、「修正なら再発行、別物なら許可フラグ」を促す。条件明細
      //   (condition_lines)が重複生成される源流(別 capability の二重作成)を抑止する。
      //   formData.allowDuplicateDocument===true で明示的に上書き許可。
      if (!isReissue && !overwrite && !manualOverride) {
        const allowDup = formData?.allowDuplicateDocument === true;
        const ik = (issueKey || "").trim();
        if (!allowDup && ik && !ik.startsWith("MANUAL-")) {
          const dupCheck = await query(
            `SELECT document_number FROM documents
              WHERE is_primary = TRUE
                AND COALESCE(lifecycle_status, 'final') = 'final'
                AND template_type = $1 AND issue_key = $2
              ORDER BY revision DESC, created_at DESC LIMIT 1`,
            [templateType, ik]
          );
          if (dupCheck.rows.length) {
            return res.status(409).json({
              ok: false,
              error: "duplicate_document",
              existing_document_number: dupCheck.rows[0].document_number,
              message:
                `この課題には既に同種の文書(${dupCheck.rows[0].document_number})が存在します。` +
                `修正する場合は「再発行」を、別物として新規作成する場合は許可(allowDuplicateDocument)を付けて再実行してください。`,
            });
          }
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
          // 台帳ID(LIC-...)は documents.form_data に保持される legacy/hidden 項目。
          //   contract_capabilities に ledger_id 列は無いため、未指定なら新規採番する
          //   (再生成時は formData.ledgerId が form_data から渡るので維持される)。
          resolvedLedgerId = await getNewLedgerId();
          console.log(
            `📒 [ledger-id pre-render] auto-assigned ${resolvedLedgerId} for ${issueKey}`
          );
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
        // 既存 license 契約に紐付き情報があれば取り込む (再発行ケース)
        // Phase 23: license_contracts → contract_capabilities (license)
        if (!preResolvedWorkId) {
          // 注: contract_capabilities に work_id 列は無い。ledger_ref_id のみ既存値を取り込む。
          const existingLc = await query(
            `SELECT ledger_ref_id
               FROM contract_capabilities
              WHERE backlog_issue_key = $1
                AND contract_category = 'license'
                AND record_type IN ('individual_contract', 'master_contract', 'standalone_contract')
              LIMIT 1`,
            [issueKey]
          );
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

      // Part1(共通化): pub_license_terms も共通 FinancialConditionTable
      //   (formData.financial_conditions[]) を採用。HTML テンプレは旧 flat field
      //   ({{紙書籍印税率}} 等) を読むため、ここで条件表→flat field へ逆展開する。
      //   condition_no: 1=紙書籍 / 2=電子書籍 / 3=翻訳・海外版。料率は表を真正として上書き、
      //   計算式は表優先 (空ならテンプレ側の既定文が出る)。
      if (
        templateType === "pub_license_terms" &&
        Array.isArray(formData.financial_conditions) &&
        formData.financial_conditions.length > 0
      ) {
        const byNo: Record<number, any> = {};
        formData.financial_conditions.forEach((c: any) => {
          const n = Number(c.condition_no);
          if (Number.isFinite(n)) byNo[n] = c;
        });
        const rateStr = (c: any) =>
          c &&
          c.rate_pct !== undefined &&
          c.rate_pct !== null &&
          String(c.rate_pct) !== ""
            ? String(c.rate_pct)
            : "";
        const paper = byNo[1];
        const ebook = byNo[2];
        const trans = byNo[3];
        if (paper) {
          formData["紙書籍印税率"] = rateStr(paper);
          formData["紙媒体計算式"] = paper.formula_text || formData["紙媒体計算式"] || "";
        }
        if (ebook) {
          formData["電子書籍印税率"] = rateStr(ebook);
          formData["電子書籍計算式"] = ebook.formula_text || formData["電子書籍計算式"] || "";
        }
        if (trans) {
          formData["翻訳海外版料率"] = rateStr(trans);
          formData["翻訳海外版計算式"] =
            trans.formula_text || formData["翻訳海外版計算式"] || "";
        }
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

      // Phase 23.6.15: 検収書系は適格請求書サマリー (消費税 1 回計算) を
      //   サーバ側で一括計算し、details の末尾でスプレッドして上書きする。
      //   これにより検収明細と「その他手数料」の per-section 二重課税を排除し、
      //   grandTotalPayable に手数料が加算されないバグも同時に解消する。
      const generateInspectionSummary = String(templateType || "").includes(
        "inspection"
      )
        ? computeInspectionSummary(formData)
        : null;

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

      // Phase 22.21.97: 利用許諾料計算書テンプレが参照する licensor_t_number。
      //   - 実 Backlog 課題キーで作成された文書 → そのまま表示
      //   - フォーム経由の合成キー (LEGAL-* / IMPORT-* / DEMO-* / PREVIEW-* /
      //     CRON-* / TIMER-*) → 空文字 (テンプレ側 {{#if}} で非表示になる)
      //   ユーザー要望: 「取引先マスタから引用する際になければ非表示」=
      //   form-only 作成では T番号 が存在しないので出さない。
      const isSyntheticIssueKey =
        !issueKey ||
        /^(LEGAL|IMPORT|DEMO|PREVIEW|CRON|TIMER)-/i.test(String(issueKey));
      const licensorTNumberForTemplate = isSyntheticIssueKey ? "" : issueKey;

      // Phase 25.5: config の dbField==="auto.docNumber" を持つ全フィールドに
      //   採番値を流し込む。従来は CONTRACT_NO / ORDER_NO / DOC_NO の英語キーへ
      //   ハードコードで差していたため、出版テンプレの日本語キー
      //   ({{契約番号}} / {{条件書番号}} / {{追加条件書番号}}) が空欄になっていた。
      //   ユーザーが手入力した値があればそれを優先する。
      const autoNumberFields: Record<string, string> = {};
      try {
        const meta = loadTemplateMetadata();
        const vars = (meta?.[templateType]?.vars || {}) as Record<string, any>;
        for (const [k, def] of Object.entries(vars)) {
          if (def?.dbField === "auto.docNumber") {
            const manual = formData?.[k];
            autoNumberFields[k] =
              manual && String(manual).trim() ? String(manual).trim() : docNumber;
          }
        }
      } catch (metaErr) {
        console.warn("[generate] auto.docNumber field mapping failed:", metaErr);
      }

      const renderDetails: Record<string, any> = {
            ...staffInfo,
            ...formData,
            // Phase 25.5: auto.docNumber フィールド (出版の 契約番号/条件書番号/
            //   追加条件書番号 等) に採番値を反映。...formData の後に置いて空値を上書き。
            ...autoNumberFields,
            // Phase 22.21.97: 合成キーを除外した実 Backlog T番号
            licensor_t_number: licensorTNumberForTemplate,
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
            // Phase 17l / 22.21.65: ORDER_NO の解決ロジック。
            //   テンプレ種別で振る舞いが変わる:
            //   [A] purchase_order 系 (purchase_order / planning_purchase_order /
            //       intl_purchase_order): ORDER_NO は自身の文書番号 (= 発注書 No)。
            //       formData.orderNumber > parentOrderNumber > docNumber の順。
            //   [B] それ以外 (maintenance_spec 等の "別紙" テンプレ):
            //       ORDER_NO は 親発注書の番号 = foreign reference。ユーザーが
            //       フォームで設定した formData.ORDER_NO を最優先する。
            //       Phase 22.21.55 / 64 で maintenance_spec の親 PO 検索ウィジェットが
            //       formData.ORDER_NO に親 PO 番号を入れているため、それを尊重する。
            ORDER_NO: String(templateType || "").includes("purchase_order")
              ? formData.orderNumber || parentOrderNumber || docNumber
              : formData.ORDER_NO || formData.orderNumber || parentOrderNumber || docNumber,
            // Phase 22.15: ライセンス系テンプレが参照する CONTRACT_NO も
            //   自動採番した docNumber を渡す。formData にユーザー手動値が
            //   あればそれを優先 (上書き目的)。これにより license_master.html
            //   の {{CONTRACT_NO}} が空欄になる問題を解消。
            CONTRACT_NO: formData.CONTRACT_NO || docNumber,
            // 海外発注書(intl)ヘッダの Order Form No.。手入力が無ければ採番値を補完。
            OF_NO: formData.OF_NO || docNumber,
            // Issue Date も未入力なら本日。
            OF_DATE: formData.OF_DATE || new Date().toISOString().slice(0, 10),
            hasChangeLogs: !!formData.CHANGE_RECORDS,
            changeLogs: formData.CHANGE_RECORDS
              ? formData.CHANGE_RECORDS.split(";").map((log: string) => {
                  const [changedAt, fieldLabel, beforeValue, afterValue, reason] = log.split("|");
                  return { changedAt, fieldLabel, beforeValue, afterValue, reason };
                })
              : [],
            // Phase 23.6.15: 検収書の金額サマリー (消費税 1 回計算・適格請求書対応)
            //   を最後にスプレッドして deliveredAmountStr / taxAmountStr /
            //   totalAmountStr / otherFeesTotalStr / grandTotalPayable 等を上書き。
            ...(generateInspectionSummary || {}),
      };

      // ── Oversea Purchase Order(intl_purchase_order)を完全英語化 ──
      //   テンプレ本体は英語だが、注入値(自社情報/契約種別/支払条件/サブスク周期)が
      //   日本語のため、海外発注書のときだけ英語へ差し替える。
      if (templateType === "intl_purchase_order") {
        try {
          const en = await query(
            `SELECT key, value FROM app_settings
              WHERE key IN ('COMPANY_NAME_EN','COMPANY_ADDRESS_EN','COMPANY_REPRESENTATIVE_EN')`
          );
          const s: Record<string, string> = {};
          for (const row of en.rows) s[row.key] = row.value;
          if (s.COMPANY_NAME_EN) renderDetails.COMPANY_NAME = s.COMPANY_NAME_EN;
          if (s.COMPANY_ADDRESS_EN) renderDetails.COMPANY_ADDRESS = s.COMPANY_ADDRESS_EN;
          if (s.COMPANY_REPRESENTATIVE_EN) renderDetails.COMPANY_REP = s.COMPANY_REPRESENTATIVE_EN;
        } catch (enErr) {
          console.warn("[intl英語化] company *_EN 取得失敗:", enErr);
        }
        const PT: Record<string, string> = {
          "請負": "Contract for Work (Ukeoi)",
          "準委任": "Quasi-Mandate (Jun-inin)",
        };
        const CAT: Record<string, string> = {
          "業務委託": "Service", "ライセンス": "License", "ライセンス(IN)": "License (In)",
          "ライセンス(OUT)": "License (Out)", "出版": "Publishing", "売買": "Sale",
          "NDA": "NDA", "請負": "Contract for Work", "準委任": "Quasi-Mandate",
        };
        const CYC: Record<string, string> = {
          "MONTHLY": "Monthly", "QUARTERLY": "Quarterly", "SEMIANNUAL": "Semi-annual",
          "ANNUAL": "Annual", "CUSTOM": "Custom",
        };
        const tr = (m: Record<string, string>, v: any) =>
          v == null || v === "" ? v : m[String(v)] ?? v;
        if (Array.isArray(renderDetails.items)) {
          renderDetails.items = renderDetails.items.map((it: any) => ({
            ...it,
            category: tr(CAT, it.category),
            payment_terms: tr(PT, it.payment_terms),
            cycle: tr(CYC, it.cycle),
          }));
        }
        if (renderDetails.PAYMENT_TERMS) renderDetails.PAYMENT_TERMS = tr(PT, renderDetails.PAYMENT_TERMS);
        if (renderDetails.contract_category)
          renderDetails.contract_category = tr(CAT, renderDetails.contract_category);
      }

      // 検収書: 明細No を列挙表示(preview と共通の computeInspectionItemNo)。
      if (String(templateType || "").includes("inspection")) {
        Object.assign(renderDetails, computeInspectionItemNo(formData) || {});
      }

      // DB登録のみ (skipPdf=true): PDF 生成 / Drive アップロードを丸ごと
      //   スキップする。
      //   - 既存 row に drive_link があれば温存 (内容だけ DB 更新)
      //   - 無ければ drive_link 空 + __pdf_pending=true で保存され、
      //     PDF 未作成キューから後日「同じ文書番号のまま」発行できる
      //     (getDocumentNumberForGenerate が drive_link 空 + 同番号を
      //      draft 完成として overwrite 扱いにするため)。
      const dbOnly = skipPdf === true || skipPdf === "true";
      let driveLink: string;
      if (dbOnly) {
        // 優先順: ① フォームで指定されたファイルリンク (既存の締結済み PDF 等)
        //         ② 既存 row の drive_link 温存
        //         ③ 空 (= __pdf_pending で PDF 未作成キューへ)
        const manualFileLink =
          typeof fileLink === "string" ? fileLink.trim() : "";
        const existingRow = await query(
          `SELECT drive_link FROM documents WHERE document_number = $1 LIMIT 1`,
          [docNumber]
        );
        driveLink = manualFileLink || existingRow.rows[0]?.drive_link || "";
        console.log(
          `📝 [db-only] ${issueKey} ${templateType}: docNumber=${docNumber} PDF生成スキップ${
            manualFileLink
              ? " (ファイルリンク指定あり)"
              : driveLink
                ? " (既存 Drive リンク温存)"
                : " (未発行 → PDF未作成キューへ)"
          }`
        );
      } else {
        const { html, fileName } = await documentService.generateDocument(
          {
            issueKey,
            documentNumber: docNumber,
            summary: issue.summary,
            requester: requesterEmail || "Legal Department",
            date: new Date().toLocaleDateString("ja-JP"),
            details: renderDetails,
          },
          templateType,
          {
            vendorName: vendorNameForFile,
            // 親文書番号でファイル名を作るグループ(検収書 / 利用許諾料計算書)。
            //   検収書: 検収書番号_発注書番号_作成日 / 計算書: 計算書番号_親契約番号_作成日。
            parentDocNumber:
              String(templateType || "").includes("inspection") ||
              templateType === "royalty_statement"
                ? String(
                    (formData as any)?.linked_contract_number || parentOrderNumber || ""
                  ).trim() || undefined
                : undefined,
          }
        );

        // Phase 9: PDF に切り替え。従来は uploadHtml で Google Docs に
        // 変換させていたが、CSS が大幅に潰れて template と程遠い見栄えに
        // なるため、Puppeteer で PDF をレンダリングしてそのまま upload する。
        //
        // Phase 23.1: 内部修正 (overwrite=true) のときは既存 fileId に PDF を
        //   上書きアップロードして webViewLink を維持する。Drive 上の URL が
        //   変わらないので、Backlog コメントや Slack 共有 link がそのまま生きる。
        //   - 既存 row の drive_link を取得して overwritePdf を呼ぶ
        //   - 既存 link が無い (DB 不整合) 場合は uploadPdf にフォールバック
        if (overwrite) {
          const existingRow = await query(
            `SELECT drive_link FROM documents WHERE document_number = $1 LIMIT 1`,
            [docNumber]
          );
          const existingLink = existingRow.rows[0]?.drive_link || "";
          if (existingLink) {
            try {
              driveLink = await googleDriveService.overwritePdf(
                existingLink,
                html,
                fileName
              );
              console.log(
                `[overwrite] reused fileId for ${docNumber}: ${driveLink}`
              );
            } catch (overwriteErr: any) {
              console.warn(
                `[overwrite] failed for ${docNumber} (${existingLink}), fallback to upload:`,
                overwriteErr?.message || overwriteErr
              );
              driveLink = await googleDriveService.uploadPdf(html, fileName);
            }
          } else {
            // 既存 link が DB に無い (= 過去の生成失敗で row だけ残った等)。
            // 新規アップロードで補完する。
            driveLink = await googleDriveService.uploadPdf(html, fileName);
          }
        } else {
          driveLink = await googleDriveService.uploadPdf(html, fileName);
        }
      }

      // Phase 24: 会計用 Excel は PDF 発行と同時生成しない。検収書 / 利用許諾料
      //   計算書は「発行済みだが Excel 未発行」(documents.excel_issued_at IS NULL)
      //   の状態で残し、担当者 × 支払期日 のバッチ出力
      //   (POST /api/excel-batches/export) でまとめて生成する。
      //   excelLink はレスポンス互換のため残すが、ここでは常に null。
      const excelLink: string | null = null;

      // Phase 15: 同じ document_number で再生成された場合 (PDF 未作成キュー
      // 由来など) は ON CONFLICT で UPDATE、新規なら INSERT。
      // form_data の __pdf_pending は false にして pending キューから外す。
      // Phase 23.1: lifecycle_status='final' を明示。新規 / 内部修正 / 再発行
      //   いずれもこの行は「現在の正」として書く。過去 row の demote は
      //   isReissue=true のとき markPrimaryDocument 後に別途実行。
      // Step1(SSOT): 別名キーを揃えて保存し、通常作成でも line_items/件名/発注日 が
      //   インポート由来と同じ形で入るようにする(読み手の経路差をなくす)。
      // DB登録のみで PDF 未発行 (drive_link 空) の場合は __pdf_pending=true で
      //   保存して PDF 未作成キューに載せる (バルクインポートと同じ状態)。
      const mergedFormData = normalizeDocumentFormData(templateType, {
        ...(formData || {}),
        __pdf_pending: dbOnly ? !driveLink : false,
      });
      const docContentHash = computeFormContentHash(formData, templateType);
      let docInsert: any;
      try {
        docInsert = await query(
          `INSERT INTO documents (
             document_number, issue_key, template_type, form_data, drive_link, created_by,
             base_document_number, revision, vendor_name_snapshot, content_hash, is_primary, lifecycle_status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 'final')
           ON CONFLICT (document_number) DO UPDATE SET
             form_data            = EXCLUDED.form_data,
             drive_link           = EXCLUDED.drive_link,
             template_type        = EXCLUDED.template_type,
             base_document_number = EXCLUDED.base_document_number,
             revision             = EXCLUDED.revision,
             vendor_name_snapshot = EXCLUDED.vendor_name_snapshot,
             content_hash         = EXCLUDED.content_hash,
             is_primary           = TRUE,
             lifecycle_status     = 'final',
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
            docContentHash,
          ]
        );
      } catch (insErr: any) {
        // 0017 未適用環境(content_hash 列なし)では従来カラムで INSERT。
        if (insErr && insErr.code === "42703") {
          docInsert = await query(
            `INSERT INTO documents (
               document_number, issue_key, template_type, form_data, drive_link, created_by,
               base_document_number, revision, vendor_name_snapshot, is_primary, lifecycle_status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 'final')
             ON CONFLICT (document_number) DO UPDATE SET
               form_data            = EXCLUDED.form_data,
               drive_link           = EXCLUDED.drive_link,
               template_type        = EXCLUDED.template_type,
               base_document_number = EXCLUDED.base_document_number,
               revision             = EXCLUDED.revision,
               vendor_name_snapshot = EXCLUDED.vendor_name_snapshot,
               is_primary           = TRUE,
               lifecycle_status     = 'final',
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
        } else {
          throw insErr;
        }
      }

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

      // Phase 23.1: 再発行 (isReissue=true) のときは、同 base 内の過去 final 行を
      //   lifecycle_status='reissued' に倒す。markPrimaryDocument は is_primary を
      //   倒すが lifecycle_status は触らないので、別途同期する。
      //   contract_capabilities も同 base で同期。
      if (isReissue) {
        try {
          await query(
            `UPDATE documents
                SET lifecycle_status = 'reissued'
              WHERE base_document_number = $1
                AND document_number <> $2
                AND lifecycle_status = 'final'`,
            [baseDocumentNumber, docNumber]
          );
          await query(
            `UPDATE contract_capabilities
                SET lifecycle_status = 'reissued',
                    updated_at       = CURRENT_TIMESTAMP
              WHERE base_document_number = $1
                AND document_number <> $2
                AND lifecycle_status = 'final'`,
            [baseDocumentNumber, docNumber]
          );
          // Phase E-1: 旧版に紐づく有効 condition_events を新版へ付け替える。
          //   「有効実績1件 = final文書1件」の不変条件を維持 (実績は同一内容のまま
          //   現行 final 文書を指す)。void ではなく付け替えなので残高は不変。
          await query(
            `UPDATE condition_events
                SET document_id = (SELECT id FROM documents WHERE document_number = $2)
              WHERE voided_at IS NULL
                AND document_id IN (
                  SELECT id FROM documents
                   WHERE base_document_number = $1 AND document_number <> $2
                )`,
            [baseDocumentNumber, docNumber]
          );
        } catch (reissueErr) {
          console.warn(
            `[reissue-demote] failed for ${docNumber} (base=${baseDocumentNumber}):`,
            reissueErr
          );
        }
      }

      // Phase 17: 稟議リンクを upsert (formData.ringi_numbers が配列なら処理)
      // 既存リンクは削除して入れ直し (送信値を正とする)。
      const documentId = Number(docInsert.rows[0]?.id);

      // 検収書を作成したら、親発注書(parent PO)の条件明細を自動で成就(fulfilled)にする。
      //   キー: フォームの parent_po_id(capability id) / linked_contract_number(親発注書番号)を優先、
      //        無ければ issue 内の最新発注書(parentOrderNumber)。
      //   残額のある明細だけ inspection イベントを入れる(再生成/再発行でも二重成就しない)。
      //   部分検収は条件明細詳細の「調整(手動リンク)」で後から調整可能。
      if (String(templateType || "").includes("inspection")) {
        try {
          const fd: any = mergedFormData || {};
          let poCapId: number | null =
            fd.parent_po_id && Number.isFinite(Number(fd.parent_po_id)) ? Number(fd.parent_po_id) : null;
          if (!poCapId) {
            const poNum = String(fd.linked_contract_number || parentOrderNumber || "").trim();
            if (poNum) {
              const cq = await query(
                `SELECT id FROM contract_capabilities
                  WHERE document_number = $1 AND record_type = 'purchase_order' LIMIT 1`,
                [poNum]
              );
              poCapId = cq.rows[0]?.id ?? null;
            }
          }
          if (poCapId && Number.isFinite(documentId)) {
            const lines = await query(
              `SELECT id, amount_ex_tax FROM condition_lines WHERE capability_id = $1`,
              [poCapId]
            );
            let filled = 0;
            for (const line of lines.rows) {
              const sq = await query(
                `SELECT COALESCE(SUM(amount_ex_tax),0) AS consumed, COALESCE(MAX(event_no),0) AS maxno
                   FROM condition_events WHERE condition_line_id = $1 AND voided_at IS NULL`,
                [line.id]
              );
              const remaining =
                (Number(line.amount_ex_tax) || 0) - (Number(sq.rows[0].consumed) || 0);
              if (remaining <= 0) continue;
              await query(
                `INSERT INTO condition_events
                   (condition_line_id, event_no, event_type, document_id, backlog_issue_key, occurred_at, amount_ex_tax)
                 VALUES ($1, $2, 'inspection', $3, $4, now(), $5)`,
                [line.id, Number(sq.rows[0].maxno) + 1, documentId, issueKey || null, remaining]
              );
              filled++;
            }
            if (filled > 0)
              console.log(`✅ [auto-inspection] ${docNumber}: 親PO cap=${poCapId} の条件明細 ${filled} 件を成就`);
          }
        } catch (autoErr: any) {
          console.warn(`[auto-inspection] failed for ${docNumber}:`, autoErr?.message || autoErr);
        }
      }

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
            // Phase 25: 出版契約の相手方 (許諾者=甲) は VENDOR_NAME ではなく
            //   許諾者法人名 / 許諾者氏名 / 許諾者 で入る。vendor master に
            //   一致するものがあれば紐付け、無ければ vendor_id=null で登録。
            formData["許諾者法人名"] ||
            formData["許諾者氏名"] ||
            formData["許諾者"] ||
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

        // Phase 23.6.7: record_type 分類を正す。
        //   従来は purchase_order / inspection を両方 'individual_contract' に
        //   まとめていたため、発注書 (例: ARC-PO-2026-0019) が
        //   UnifiedContractPicker で「個別契約」として表示され、検収書フォーム
        //   から選択しても明細が出ない事故が発生していた (Phase 23.6.6 で対症
        //   療法を入れたが、ここが根本原因)。
        //
        //   record_type 値域 (db.ts 1300〜参照):
        //     'master_contract'      : 基本契約 (NDA / sales_master 等)
        //     'individual_contract'  : 基本契約あり個別契約
        //     'standalone_contract'  : 基本契約なし単独契約
        //     'purchase_order'       : 発注書
        //     'license_condition'    : 利用許諾 (license / royalty)
        //     'delivery_record'      : 検収書 (mirror 用、picker には載らない)
        let recordType = "master_contract";
        // 方向(in/out)の確定: フォームに方向の明示が無ければ purpose_code から
        //   contract_purposes.flow_direction を解決し formData.FLOW_DIRECTION に載せる。
        //   → admin-ui は「目的(4ジャンル含む)」を選ぶだけでよく、方向の別送が不要。
        //   後段の capability / 明細反映ブロックが formData.FLOW_DIRECTION を拾う。
        if (!formData.FLOW_DIRECTION && !formData["方向"] && !formData.flow_direction) {
          const pc = formData.PURPOSE_CODE || formData.purpose_code || formData["目的"];
          if (pc) {
            try {
              const pr = await query(
                `SELECT flow_direction FROM contract_purposes WHERE purpose_code = $1`,
                [pc]
              );
              if (pr.rows[0]?.flow_direction) formData.FLOW_DIRECTION = pr.rows[0].flow_direction;
            } catch (pdErr) {
              console.warn("[flow_direction] purpose resolve skipped:", pdErr);
            }
          }
        }
        // Phase 25 / 25.6: 出版系を最優先で判定。pub_license_terms は "license" を
        //   含むため、後段の license 判定より前に分岐させないと誤分類になる。
        //   record_type は search-api (contractCheckService) の正仕様に合わせる:
        //     pub_master_*         → master_contract     (出版基本契約 / category=publication)
        //     pub_license_terms    → publication_condition (出版利用許諾条件書)
        //     pub_additional_terms → publication_condition (追加利用許諾条件書)
        //   ※ getPublicationConditions() が record_type='publication_condition' を参照。
        if (templateType.startsWith("pub_")) {
          recordType = templateType.startsWith("pub_master_")
            ? "master_contract"
            : "publication_condition";
        }
        // Phase 22.21.82: fee_statement テンプレ削除に伴い branch から除去
        else if (
          templateType.includes("license") ||
          templateType.includes("royalty")
        ) {
          recordType = "license_condition";
        } else if (templateType.includes("purchase_order")) {
          recordType = "purchase_order";
        } else if (templateType.includes("inspection")) {
          // 検収書は契約ではなく delivery event。picker から除外したい。
          recordType = "delivery_record";
        }

        // DB登録のみ (dbOnly) のときはリクエストで record_type を明示指定できる。
        //   単独契約(親なし)を発注書 / ILT テンプレで代用登録するケース用。
        //   値域は契約系の区分のみ許可 (delivery_record 等の内部区分は不可)。
        //   cc 互換ビューの INSTEAD OF トリガが COALESCE 更新するため、
        //   既存 row の再保存でも上書きされる。
        const RECORD_TYPE_OVERRIDABLE = new Set([
          "standalone_contract",
          "individual_contract",
          "master_contract",
        ]);
        if (
          dbOnly &&
          typeof recordTypeOverride === "string" &&
          RECORD_TYPE_OVERRIDABLE.has(recordTypeOverride)
        ) {
          console.log(
            `📝 [db-only] record_type override: ${recordType} → ${recordTypeOverride} (${docNumber})`
          );
          recordType = recordTypeOverride;
        }

        await query(
          `INSERT INTO contract_capabilities (
            vendor_id, record_type, contract_category, contract_type, contract_title,
            document_number, contract_status, effective_date, expiration_date, auto_renewal,
            original_work, product_name, work_name, media, territory, language, document_url, source_system,
            base_document_number, revision, is_primary,
            ledger_ref_id, ledger_code
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, TRUE, $21, $22)`,
          [
            vendorId,
            recordType,
            // Phase 25: 出版系は publication。pub_license_terms の "license"
            //   含有による誤判定を避けるため startsWith("pub_") を先に評価。
            templateType.startsWith("pub_")
              ? "publication"
              : templateType.includes("license")
              ? "license"
              : "service",
            templateType,
            formData.CONTRACT_TITLE ||
              formData.contract_title ||
              // Phase 25: 出版系は作品名を契約タイトルに採用
              formData["対象出版物名"] ||
              formData["原著作物名"] ||
              issue.summary,
            docNumber,
            "executed",
            formData.EFFECTIVE_DATE || formData.effectiveDate || null,
            formData.EXPIRATION_DATE || formData.expirationDate || null,
            formData.AUTO_RENEWAL === "true" || formData.AUTO_RENEWAL === true || false,
            formData.ORIGINAL_WORK || formData.originalWork || formData["原著作物名"] || "",
            formData.PRODUCT_NAME || formData.productName || formData["対象出版物名"] || "",
            formData.WORK_NAME || formData.workName || "",
            formData.MEDIA || formData.media || "",
            formData.TERRITORY || formData.territory || "",
            formData.LANGUAGE || formData.language || "",
            driveLink,
            "App Document Generator",
            // Phase 22.12: リビジョン情報を contract_capabilities にも同期
            baseDocumentNumber,
            revision,
            // Phase 26: 原作 (ledger) 紐付け。出版利用許諾条件書フォームの原作
            //   ピッカー、または BDG ライセンスフォーム由来の ledger_ref_id/ledger_code
            //   を保存 (未設定なら null → ON CONFLICT COALESCE で既存維持)。
            formData.ledger_ref_id ? Number(formData.ledger_ref_id) : null,
            formData.ledger_code || null,
          ]
        );
        console.log(`✅ Sync to contract_capabilities successful for: ${docNumber}`);

        // 方向(in/out): フォームが指定した場合に capability へ反映。
        //   out(ライセンスアウト/プロダクトアウト)= 当社受領 → 請求台帳へ自動振分け。
        //   列未整備(0027/0028 未適用)でも生成を止めないよう try/catch。
        try {
          const fd = String(
            formData.FLOW_DIRECTION || formData["方向"] || formData.flow_direction || ""
          ).trim();
          const low = fd.toLowerCase();
          const dir = low === "out" || fd === "アウト" ? "out" : low === "in" || fd === "イン" ? "in" : null;
          if (dir) {
            await query(
              `UPDATE contract_capabilities SET flow_direction = $2 WHERE document_number = $1`,
              [docNumber, dir]
            );
          }
        } catch (flowErr) {
          console.warn("[flow_direction] capability update skipped:", flowErr);
        }

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

        // Phase 26.9: 出版等利用許諾条件書の印税率を capability_financial_conditions
        //   に保存し、ライセンス契約と同様に「利用許諾計算書」を発行できる土台を作る。
        //   紙媒体=condition_no 1 / 電子書籍=2 / 翻訳・海外版=3。
        //   「許諾しない」種別は配列に含めないことで、upsertCapabilityFinancialConditions
        //   側の prune により DB からも自動削除される (再生成で許諾を外したケースに対応)。
        if (templateType === "pub_license_terms") {
          try {
            const capRes = await query(
              `SELECT id FROM contract_capabilities WHERE document_number = $1 LIMIT 1`,
              [docNumber]
            );
            const capId = Number(capRes.rows[0]?.id);
            if (capId) {
              const pubConditions = buildPubLicenseConditions(formData);
              await upsertCapabilityFinancialConditions(capId, pubConditions);
              console.log(
                `✅ Saved ${pubConditions.length} publication royalty condition(s) for: ${docNumber}`
              );

              // Stage 2(文書ファースト紐付け): 出版等利用許諾も作品連動 ON のとき原作マテリアルへ
              //   結線し対象作品の構成へ組み込む(共通ヘルパ)。原作は ledger_code / ledger_ref_id で解決。
              //   pubConditions は condition_name を持たないため region_language_label を名称に補完。
              if (formData.is_work_linked !== false) {
                let pubLedgerCode: string | null = formData.ledger_code || null;
                if (!pubLedgerCode && formData.ledger_ref_id) {
                  try {
                    const lr = await query(
                      `SELECT ledger_code FROM ledgers WHERE id = $1`,
                      [Number(formData.ledger_ref_id)]
                    );
                    pubLedgerCode = lr.rows[0]?.ledger_code || null;
                  } catch {
                    /* noop */
                  }
                }
                await safeSync("work-linkage(pub)", () =>
                  linkWorkMaterialsForCapability({
                    capabilityId: capId,
                    ledgerCode: pubLedgerCode,
                    ownWorkId:
                      formData.linked_work_id != null &&
                      String(formData.linked_work_id).trim() !== "" &&
                      Number.isFinite(Number(formData.linked_work_id))
                        ? Number(formData.linked_work_id)
                        : null,
                    conditionMaterialCodes: (formData.condition_material_codes ||
                      {}) as Record<string, string>,
                    financialConditions: pubConditions.map((c) => ({
                      ...c,
                      condition_name: c.condition_name || c.region_language_label,
                    })),
                    defaultMaterialCode: formData.素材番号 || null,
                  })
                );
              }
            }
          } catch (pubFcErr) {
            console.warn(
              "⚠️ Failed to persist publication financial conditions:",
              pubFcErr
            );
          }
        }
      } catch (ccErr) {
        console.warn(
          `⚠️ Failed to sync generated document to contract_capabilities:`,
          ccErr
        );
      }

      // Operational tables: orders / deliveries / license / royalties.
      // Phase 23: order_items の最小限 mirror は contract_capabilities
      //   (record_type='purchase_order') の UPSERT に統合される。本ブロックは
      //   下流の "purchase_order" 分岐 (lines 9530〜) が contract_capabilities
      //   を amount / due_date / 明細込みで永続化するため、ここでは何もしない。
      if (templateType.includes("purchase_order")) {
        // (削除済) 旧 order_items への最小 mirror INSERT は Phase 23 で廃止。
        //   contract_capabilities 側の UPSERT が下の分岐で行われる。
      } else if (templateType.includes("inspection")) {
        // Phase 9f: 複合 UNIQUE で上書き可能に。delivery_no が指定されて
        // いなければ MAX(delivery_no)+1 で自動採番。
        // Phase 23: order_items → contract_capabilities (purchase_order),
        //   delivery_events.order_item_id → capability_id。
        const orderRes = await query(
          `SELECT id FROM contract_capabilities
             WHERE backlog_issue_key = $1
               AND record_type = 'purchase_order'
             LIMIT 1`,
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
               (capability_id, backlog_issue_key, delivered_amount, delivery_no, delivered_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET
               capability_id    = EXCLUDED.capability_id,
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
      // Phase 22.21.82: planning_purchase_order テンプレ削除に伴い分岐を簡素化。
      //   templateType.includes("purchase_order") は intl_purchase_order と
      //   purchase_order を同時にカバー。
      if (templateType.includes("purchase_order")) {
        // Phase 22.21.20: contract_type を必ずセットする。
        //   旧 INSERT は contract_type を入れていなかったため、自動連鎖
        //   (autoChainOnComplete) の `parentRequestType === "purchase_order"`
        //   照合がマッチせず、納品リクエスト子課題が作成されなかった。
        //   - 新規 INSERT: contract_type を 'purchase_order' で挿入
        //   - 既存行: COALESCE で空のときだけ補完 (既存値を上書きしない)
        const poContractType = "purchase_order";
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
        // Phase 23: order_items → contract_capabilities (record_type='purchase_order')
        //   旧 order_items.vendor_code は vendors.vendor_code 経由で vendor_id を引いて保持。
        //   description は contract_title へ、amount は amount_ex_tax へ。
        let vendorIdForPo: number | null = null;
        const vcodeForPo = String(formData.VENDOR_CODE || "").trim();
        if (vcodeForPo && vcodeForPo.toUpperCase() !== "UNKNOWN") {
          const vr = await query(
            "SELECT id FROM vendors WHERE vendor_code = $1 LIMIT 1",
            [vcodeForPo]
          );
          vendorIdForPo = vr.rows[0]?.id ? Number(vr.rows[0].id) : null;
        }
        const orderItemRes = await query(
          `INSERT INTO contract_capabilities
             (legal_request_id, vendor_id, contract_title, amount_ex_tax,
              due_date, backlog_issue_key, record_type, contract_category,
              contract_type, document_number)
           VALUES ($1, $2, $3, $4, $5, $6, 'purchase_order', 'service',
                   'purchase_order', $7)
           RETURNING id`,
          [
            lrId,
            vendorIdForPo,
            formData.summary || issue.summary,
            amount,
            formData.DELIVERY_DATE || formData.due_date || null,
            issueKey,
            docNumber,
          ]
        );
        const orderItemId = orderItemRes.rows[0]?.id;

        // 明細は正規化済み mergedFormData を見る。フォームが line_items のみ
        //   (items 空)で送ってきても、capability_line_items を正しく作る/誤って
        //   消さないため。mergedFormData は normalizeDocumentFormData で
        //   items↔line_items を揃え済み。
        //   ※ 旧実装は生 formData.items を見ていたため、line_items のみ送信の
        //     発注書で「明細が作られない」「再保存で既存明細が消える」不具合があった。
        const poItems: any[] = Array.isArray((mergedFormData as any).items)
          ? (mergedFormData as any).items
          : Array.isArray((mergedFormData as any).line_items)
          ? (mergedFormData as any).line_items
          : [];

        // 明細が空配列で送信された(= 全明細削除)場合は capability_line_items を
        //   全削除し、ミラーした condition_lines も連動削除する。旧来は下の
        //   length>0 ガードで素通りして capability_line_items が残り、condition_lines
        //   も孤児化して横断検索に未了行が居座る原因になっていた。
        if (orderItemId && poItems.length === 0) {
          try {
            const removedRes = await query(
              `SELECT id FROM capability_line_items WHERE capability_id = $1`,
              [orderItemId]
            );
            const removedLiIds = removedRes.rows
              .map((r: any) => Number(r.id))
              .filter((n: number) => Number.isFinite(n));
            await query(
              `DELETE FROM capability_line_items WHERE capability_id = $1`,
              [orderItemId]
            );
            await recalculateCapabilityTotal(orderItemId, Number(formData.taxRate) || 10);
            await safeSync("CL prune(order empty)", () =>
              pruneOrphanConditionLines({ query }, removedLiIds)
            );
          } catch (e) {
            console.warn("[order line items] empty prune skipped:", e);
          }
        }

        // Phase 7b: 発注書フォームから items[] が送信されていれば
        // capability_line_items を upsert し, recalculateCapabilityTotal で
        // ヘッダ総額を「明細合計」と整合させる。
        // Phase 23: order_line_items → capability_line_items
        if (orderItemId && poItems.length > 0) {
          const taxRate = Number(formData.taxRate) || 10;
          // 成果物帰属で振り分け: 発注者帰属=業務委託明細(capability_line_items),
          //   受注者帰属=利用許諾料(capability_financial_conditions)。
          const allFormItems = poItems;
          // 受注者帰属でも「業務報酬(執筆料等)」が有る行は確定額として line_items に入れる。
          //   ただし業務報酬0(=利用許諾料のみ)の受注者行は検収対象にならない(0円明細が
          //   検収待ちに居座る不具合の原因)ため line_items には作らない。利用許諾料(料率/
          //   MG/AG)は下の licenseItems で financial_conditions へ振り分ける。
          // 3b: 利用許諾(ROYALTY)明細を共通条件 sync のゲートにする。帰属では
          //   なく支払方法で駆動するため、②発注者×ROYALTY も条件を持てる。
          const licenseItems = allFormItems.filter(
            (it) => it?.calc_method === "ROYALTY"
          );
          // 全明細を capability_line_items に保存する。受注者帰属で業務報酬0
          //   (=利用許諾料に含む)の明細も検収書に「利用許諾料に含む」として出すため
          //   line_items に作る。検収待ち判定(unissued_line_count)は amount>0 のみを
          //   数えるので、0円明細が検収待ちに居座ることはない。確定額(業務委託小計)も
          //   0円明細は 0 加算で総額に影響しない。
          const lineItemsSource = allFormItems;
          // サブスクの支払スケジュールを支払予定日ごとの行に展開してミラー。
          const incomingLines = expandLinesWithSchedule(lineItemsSource);
          const keepNos = incomingLines
            .map((l, i) => Number(l.line_no) || i + 1)
            .filter((n) => n > 0);

          // 間引きで削除される capability_line_items.id を把握しておき、
          //   後段でミラーした condition_lines を連動削除する(孤児化防止)。
          let removedLiIds: number[] = [];
          if (keepNos.length > 0) {
            const removedRes = await query(
              `SELECT id FROM capability_line_items
                WHERE capability_id = $1
                  AND line_no NOT IN (${keepNos.map((_, i) => `$${i + 2}`).join(",")})`,
              [orderItemId, ...keepNos]
            );
            removedLiIds = removedRes.rows
              .map((r: any) => Number(r.id))
              .filter((n: number) => Number.isFinite(n));
            await query(
              `DELETE FROM capability_line_items
                WHERE capability_id = $1
                  AND line_no NOT IN (${keepNos.map((_, i) => `$${i + 2}`).join(",")})`,
              [orderItemId, ...keepNos]
            );
          }

          for (let i = 0; i < incomingLines.length; i++) {
            const l = incomingLines[i];
            const lineNo = Number(l.line_no) || i + 1;
            const unit = Number(l.unit_price) || 0;
            const qty = Number(l.quantity) || 0;
            const ratePct = Number(l.rate_pct) || 0;
            // ROYALTY は 単価×数量×料率%(切上げ)。フォーム計算値があればそれを優先。
            const lineAmt =
              l.amount_ex_tax != null && l.amount_ex_tax !== ""
                ? Number(l.amount_ex_tax) || 0
                : l.calc_method === "ROYALTY"
                  ? Math.ceil((unit * qty * ratePct) / 100)
                  : calculateOrderLineAmount(unit, qty);
            // Phase 13: calc_method + payment_terms 統一
            const payTerms = l.payment_terms || l.payment_method || null;
            const calcMethod = l.calc_method || "FIXED";
            await query(
              `INSERT INTO capability_line_items (
                 capability_id, line_no, item_name, spec,
                 unit_price, quantity, amount_ex_tax, rate_pct,
                 calc_method, payment_terms,
                 payment_method, payment_date, delivery_date,
                 deliverable_ownership, royalty_calc_basis, work_id,
                 cycle, billing_day, term_start, term_end, updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP)`,
              [
                orderItemId,
                lineNo,
                l.item_name || "",
                l.spec || "",
                unit,
                qty,
                lineAmt,
                ratePct || null,
                calcMethod,
                payTerms,
                payTerms, // legacy mirror
                l.payment_date || null,
                l.delivery_date || null, // Phase 17h
                l.deliverable_ownership || "発注者",
                l.royalty_calc_basis || null,
                // 明細ごとの成果物作品(作品1:文書N:明細N)。未指定は NULL。
                l.work_id != null && String(l.work_id).trim() !== ""
                  ? Number(l.work_id)
                  : null,
                // 継続(SUBSCRIPTION)の役務提供期間を構造化保存。form_data には既に入るが、
                //   納期/期間を capability_line_items から直読みするレポート系にも載せる。
                l.cycle || l.subscription_cycle || null,
                l.billing_day != null && String(l.billing_day).trim() !== ""
                  ? Number(l.billing_day)
                  : null,
                l.term_start || null,
                l.term_end || null,
              ]
            );
          }
          // Phase 23: recalculateOrderTotal → recalculateCapabilityTotal
          //   (発注者帰属=確定額のみ。受注者帰属は line_items に入れていないため不算入。)
          await recalculateCapabilityTotal(orderItemId, taxRate);

          // 明細を間引いた場合、孤児 condition_lines も連動削除(非致命)。
          await safeSync("CL prune(order)", () =>
            pruneOrphanConditionLines({ query }, removedLiIds)
          );

          // 利用許諾条件を capability_financial_conditions へ保存。
          //   新方式: 発注書フォームの「利用許諾条件（共通）」= formData.financial_conditions
          //     を 1 本以上の共通条件として保存する(受注者帰属の成果物に一括適用)。
          //   旧方式(後方互換): 共通条件が無ければ、受注者帰属明細ごとの per-line 条件を
          //     そのまま振り分ける(過去発注書の再保存・既存挙動の維持)。
          const commonConds: any[] = Array.isArray(formData.financial_conditions)
            ? (formData.financial_conditions as any[]).filter(
                (c) =>
                  c &&
                  (c.calc_type ||
                    c.condition_name ||
                    c.rate_pct != null ||
                    c.applies_scope ||
                    c.region_language_label)
              )
            : [];
          const deriveCalcMethod = (ct: any, fallback: any) =>
            ct === "FIXED"
              ? "FIXED"
              : ct === "SUBSCRIPTION"
                ? "SUBSCRIPTION"
                : ct === "BASE_QTY_RATE" || ct === "BASE_RATE"
                  ? "ROYALTY"
                  : fallback || null;
          // Stage 2: 作品連動で原作マテリアルへ結線する、実際に保存した利用許諾条件の集合。
          let poLinkConds: any[] = [];
          if (commonConds.length > 0 && licenseItems.length > 0) {
            const mappedCommon = commonConds.map((c: any, i: number) => ({
              condition_no: Number(c.condition_no) || i + 1,
              condition_name: c.condition_name || null,
              region_territory: c.region_territory || null,
              region_language: c.region_language || null,
              region_language_label: c.region_language_label || null,
              calc_type: c.calc_type || null,
              calc_method: c.calc_method || deriveCalcMethod(c.calc_type, null),
              rate_pct: c.rate_pct ?? null,
              base_price_label: c.base_price_label || null,
              fixed_kind: c.fixed_kind || null,
              subscription_cycle: c.subscription_cycle || null,
              unit_amount: c.unit_amount ?? null,
              guarantee_type: c.guarantee_type || null,
              mg_amount: c.mg_amount ?? 0,
              ag_amount: c.ag_amount ?? 0,
              formula_text: c.formula_text || null,
              payment_terms: c.payment_terms || null,
              applies_scope: c.applies_scope || null,
              calc_period: c.calc_period || null,
              calc_period_kind: c.calc_period_kind || null,
              calc_period_close_month: c.calc_period_close_month ?? null,
              currency: c.currency || "JPY",
              // 条件ごとの作品(作品1:文書N:明細N)。未指定は NULL。
              work_id: c.work_id ?? null,
            }));
            try {
              await upsertCapabilityFinancialConditions(orderItemId, mappedCommon);
              poLinkConds = mappedCommon;
            } catch (condErr) {
              console.warn("[license] 共通利用許諾条件 sync skipped:", condErr);
            }
          } else if (licenseItems.length > 0) {
            const mappedConds = licenseItems.map((it: any, i: number) => ({
              condition_no: Number(it.line_no) || i + 1,
              condition_name: it.condition_name || it.item_name || null,
              region_territory: it.region_territory || null,
              region_language: it.region_language || null,
              region_language_label: it.region_language_label || null,
              calc_type: it.calc_type || null,
              // 利用許諾条件の calc_method は計算式タイプから導出(業務報酬の FIXED とは別)。
              calc_method: deriveCalcMethod(it.calc_type, it.calc_method),
              rate_pct: it.rate_pct ?? null,
              base_price_label: it.base_price_label || null,
              fixed_kind: it.fixed_kind || null,
              subscription_cycle: it.subscription_cycle || null,
              unit_amount: it.unit_amount ?? null,
              guarantee_type: it.guarantee_type || null,
              mg_amount: it.mg_amount ?? 0,
              ag_amount: it.ag_amount ?? 0,
              formula_text: it.formula_text || null,
              // 利用許諾条件の支払条件 → 利用許諾料計算書の支払条件に引用される。
              payment_terms: it.payment_terms || null,
              currency: "JPY",
              // D2: 受注者帰属明細の作品を、対応する利用許諾条件へ自動継承
              //   (condition_no=line_no で 1:1)。明細側の作品割当だけで連動する。
              work_id: it.work_id ?? null,
            }));
            try {
              await upsertCapabilityFinancialConditions(orderItemId, mappedConds);
              poLinkConds = mappedConds;
            } catch (condErr) {
              console.warn(
                "[deliverable_ownership] 受注者帰属→金銭条件 sync skipped:",
                condErr
              );
            }
          }

          // Stage 2(文書ファースト紐付け): 発注書も作品連動 ON のとき原作マテリアルへ結線し
          //   対象作品の構成へ組み込む。原作は capability の ledger_code で解決。best-effort。
          if (formData.is_work_linked !== false && orderItemId) {
            const poOwnWorkId =
              formData.linked_work_id != null &&
              String(formData.linked_work_id).trim() !== "" &&
              Number.isFinite(Number(formData.linked_work_id))
                ? Number(formData.linked_work_id)
                : null;
            // (a) 受注者帰属=利用許諾条件 → 相手方帰属マテリアル(rights_type=license)。
            if (poLinkConds.length > 0) {
              await safeSync("work-linkage(order)", () =>
                linkWorkMaterialsForCapability({
                  capabilityId: orderItemId,
                  ledgerCode: formData.ledger_code || null,
                  ownWorkId: poOwnWorkId,
                  conditionMaterialCodes: (formData.condition_material_codes || {}) as Record<
                    string,
                    string
                  >,
                  financialConditions: poLinkConds,
                  defaultMaterialCode: formData.素材番号 || null,
                })
              );
            }
            // (b) 買切(発注者帰属)の業務委託明細 → 当社保有マテリアル(rights_type=owned)。
            //   買切も業務委託の条件明細を持つので構成に入る(ロイヤリティ計算は走らない)。
            //   純買取(金銭条件ブランチ未実行)でも line_item の condition_line が在るよう、
            //   先に冪等 sync を保証してから結線する。
            await safeSync("CL(capability/buyout-ensure)", () =>
              syncConditionLinesForCapability({ query }, orderItemId)
            );
            await safeSync("work-linkage(order-buyout)", () =>
              linkBuyoutMaterialsForCapability({
                capabilityId: orderItemId,
                ledgerCode: formData.ledger_code || null,
                ownWorkId: poOwnWorkId,
              })
            );
          }

          // 方向(in/out)を明細にも反映(capability と揃える)。out は請求台帳へ自動取込。
          try {
            const fd = String(
              formData.FLOW_DIRECTION || formData["方向"] || formData.flow_direction || ""
            ).trim();
            const low = fd.toLowerCase();
            const dir = low === "out" || fd === "アウト" ? "out" : low === "in" || fd === "イン" ? "in" : null;
            if (dir) {
              await query(
                `UPDATE capability_line_items SET flow_direction = $2 WHERE capability_id = $1`,
                [orderItemId, dir]
              );
            }
          } catch (flowErr) {
            console.warn("[flow_direction] line items update skipped:", flowErr);
          }
        }

        // Phase 17i: 経費 (交通費等・税込み額) を upsert
        // Phase 23: order_expenses → capability_expenses
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
              `DELETE FROM capability_expenses
                WHERE capability_id = $1
                  AND line_no NOT IN (${keepExpenseNos.map((_, i) => `$${i + 2}`).join(",")})`,
              [orderItemId, ...keepExpenseNos]
            );
          } else {
            await query("DELETE FROM capability_expenses WHERE capability_id = $1", [orderItemId]);
          }

          for (const e of computedExpenses) {
            await query(
              `INSERT INTO capability_expenses (
                 capability_id, line_no, expense_name, spec,
                 spent_date, amount_inc_tax, remarks, updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
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

        // Phase 23.6.13: その他手数料 (other_fees) も capability_other_fees に
        //   永続化する。従来は formData.other_fees が documents.form_data の
        //   JSON にだけ残って DB のテーブルには書かれていなかったため、
        //   検収書フォームの親 PO 連動でその他手数料が出てこない事故が起きていた。
        //   expenses (line 9725〜) と同じ DELETE→UPSERT パターン。
        if (orderItemId && Array.isArray(formData.other_fees)) {
          const incomingFees = formData.other_fees as Array<any>;
          const computedFees = incomingFees
            .map((f: any, idx: number) => ({
              line_no: Number(f.line_no) || idx + 1,
              fee_name: f.fee_name || "",
              amount: Number(f.amount) || 0,
              remarks: f.remarks || "",
            }))
            .filter((f) => f.fee_name);

          const keepFeeNos = computedFees.map((f) => f.line_no).filter((n) => n > 0);
          if (keepFeeNos.length > 0) {
            await query(
              `DELETE FROM capability_other_fees
                WHERE capability_id = $1
                  AND line_no NOT IN (${keepFeeNos.map((_, i) => `$${i + 2}`).join(",")})`,
              [orderItemId, ...keepFeeNos]
            );
          } else {
            await query(
              "DELETE FROM capability_other_fees WHERE capability_id = $1",
              [orderItemId]
            );
          }

          for (const f of computedFees) {
            await query(
              `INSERT INTO capability_other_fees (
                 capability_id, line_no, fee_name, amount, remarks, updated_at
               ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
              [orderItemId, f.line_no, f.fee_name, f.amount, f.remarks]
            );
          }
        }

        // データ構造刷新: 発注書生成ミラーの子テーブル書込後、condition_lines にも
        //   非致命で同期する。登録エンドポイント(upsertCapabilityLineItems)は
        //   safeSync を呼ぶが、この発注書生成ミラーは直接 INSERT で safeSync を
        //   通っていなかったため、新規発注書が条件明細に出ない不具合があった。
        //   orderItemId = capability_id。冪等。
        if (orderItemId) {
          await safeSync("CL(capability/po-mirror)", () =>
            syncConditionLinesForCapability({ query }, Number(orderItemId))
          );
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
        // 無ければこの issue 自体の contract_capabilities (purchase_order) を見る。
        // Phase 23: order_items → contract_capabilities
        let orderItemId: number | null = null;
        if (formData.parent_po_id) {
          orderItemId = Number(formData.parent_po_id);
        } else {
          const orderItemResult = await query(
            `SELECT id FROM contract_capabilities
              WHERE backlog_issue_key = $1
                AND record_type = 'purchase_order'`,
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
            // Phase 23: delivery_events.order_item_id → capability_id
            const maxRes = await query(
              `SELECT COALESCE(MAX(delivery_no), 0) AS max_no
                 FROM delivery_events
                WHERE capability_id = $1`,
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

        // Phase 23: delivery_events.order_item_id → capability_id
        const deliveryUpsert = await query(
          `INSERT INTO delivery_events
             (backlog_issue_key, capability_id, delivery_no, delivered_at,
              delivered_amount, inspection_deadline, status, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (backlog_issue_key, delivery_no) DO UPDATE SET
             capability_id       = EXCLUDED.capability_id,
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
          // Phase 23: order_line_item_id → capability_line_item_id (フィールド名は
          //   フロント互換のため formData では旧名のまま受ける)。
          const incoming = (formData.delivery_line_items as Array<any>).map(
            (l) => ({
              capability_line_item_id: Number(
                l.capability_line_item_id ?? l.order_line_item_id
              ),
              inspected_quantity: Number(l.inspected_quantity) || 0,
              acceptance_ratio:
                l.acceptance_ratio == null ? 1.0 : Number(l.acceptance_ratio),
              rejection_reason: l.rejection_reason || null,
            })
          );
          // サーバ側 overflow チェック (二重防衛)。フロントの数字を信用しない。
          const preview = await previewInspectionOverflow(
            incoming.map((l) => ({
              capability_line_item_id: l.capability_line_item_id,
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
                JSON.stringify(blocking.map((b) => b.capability_line_item_id))
            );
          }

          for (const l of incoming) {
            // Phase E-2: condition_lines 優先 dual-read
            const econ = await getOrderedLineEconomics(l.capability_line_item_id);
            const unitPrice = econ?.unit_price || 0;
            const amt = calculateInspectedAmount(
              unitPrice,
              l.inspected_quantity,
              l.acceptance_ratio
            );
            // Phase 23: delivery_line_items.order_line_item_id → capability_line_item_id
            await query(
              `INSERT INTO delivery_line_items (
                 delivery_event_id, capability_line_item_id, inspected_quantity,
                 acceptance_ratio, inspected_amount_ex_tax, rejection_reason
               ) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (delivery_event_id, capability_line_item_id) DO UPDATE SET
                 inspected_quantity      = EXCLUDED.inspected_quantity,
                 acceptance_ratio        = EXCLUDED.acceptance_ratio,
                 inspected_amount_ex_tax = EXCLUDED.inspected_amount_ex_tax,
                 rejection_reason        = EXCLUDED.rejection_reason`,
              [
                deliveryEventId,
                l.capability_line_item_id,
                l.inspected_quantity,
                l.acceptance_ratio,
                amt,
                l.rejection_reason,
              ]
            );
          }

          // フラグ駆動制御: 完全検収(残額0)になった明細は「検収書発行済」として
          //   status_flags.inspection_issued を自動 ON。手動で立てた分は維持(上書きしない)。
          //   検収済は delivery_line_items の SUM(=確定値)で判定する。
          const inspectedLineIds = incoming
            .map((l) => l.capability_line_item_id)
            .filter((n) => Number.isFinite(n) && n > 0);
          if (inspectedLineIds.length > 0) {
            await query(
              `UPDATE capability_line_items cli
                  SET status_flags = COALESCE(cli.status_flags, '{}'::jsonb)
                                     || jsonb_build_object('inspection_issued', true)
                WHERE cli.id = ANY($1::int[])
                  AND cli.amount_ex_tax IS NOT NULL AND cli.amount_ex_tax > 0
                  AND COALESCE(cli.status_flags->>'inspection_issued','') <> 'true'
                  AND COALESCE((
                        SELECT SUM(dli.inspected_amount_ex_tax)
                          FROM delivery_line_items dli
                         WHERE dli.capability_line_item_id = cli.id
                      ), 0) >= cli.amount_ex_tax - 0.5`,
              [inspectedLineIds]
            );
          }
        }
      } else if (templateType === "license_master") {
        // Phase 23: license_contracts → contract_capabilities (license, master_contract)
        //   ON CONFLICT は document_number (contract_capabilities の UNIQUE) に変更。
        // contract_capabilities は汎用レジストリ。ライセンサー名・台帳ID 等の
        //   license 固有値は列が無く documents.form_data に保持されPDFはそこから描画。
        //   ここでは実在列(原作名/文書番号/種別/タイトル)のみを登録する。
        await query(
          `INSERT INTO contract_capabilities
             (backlog_issue_key, original_work,
              document_number, record_type, contract_category, contract_type, contract_title)
           VALUES ($1, $2, $3, 'master_contract', 'license', 'license_basic', $4)`,
          [
            issueKey,
            formData.WORK_TITLE || "",
            docNumber,
            formData.WORK_TITLE || formData.LICENSOR_NAME || docNumber,
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
          // contract_capabilities に ledger_id 列は無い。未指定なら新規採番
          //   (再生成は formData.ledgerId が form_data から渡るので維持)。
          resolvedLedgerId = await getNewLedgerId();
          console.log(
            `📒 [ledger-id] auto-assigned ${resolvedLedgerId} for ${issueKey}`
          );
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

        // 既存 license 契約に紐付き情報があれば取り込む (再発行ケース)
        // Phase 23: license_contracts → contract_capabilities (license)
        // 注: contract_capabilities に work_id 列は無い(work_name のみ)。
        //   ledger_ref_id / material_ref_id は実在列なので既存値を引き継ぐ。
        const existingLcRow = await query(
          `SELECT ledger_ref_id, material_ref_id
             FROM contract_capabilities
            WHERE backlog_issue_key = $1
              AND contract_category = 'license'
              AND record_type IN ('individual_contract', 'master_contract', 'standalone_contract')
            LIMIT 1`,
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
            `SELECT material_code, material_name, rights_holder_label AS rights_holder, is_default
               FROM work_materials WHERE id = $1`,
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

        // Phase 23: license_contracts → contract_capabilities (license, individual_contract)
        //   旧 license_contracts の license_* 列は Phase 23 マイグレーションで
        //   contract_capabilities に ALTER ADD COLUMN 済みの想定。
        //   ON CONFLICT は document_number (UNIQUE INDEX) に変更。
        //   contract_title は original_work (なければ docNumber) で補完。
        // contract_capabilities は汎用レジストリ。licensor_*/licensee_*/台帳ID/監修者/
        //   クレジット/許諾期間注記/work_id 等の license 固有値は列が無く、
        //   documents.form_data(JSON) に保持されPDFはそこから描画される。
        //   ここでは実在列のみ登録(原作名/対象製品/許諾開始日/原作・素材参照/種別/タイトル/文書番号)。
        // スキーマ単純化 Phase 2: documents 統合＋CL直接書き込み（contract_capabilities 廃止）。
        //   金銭条件(flat) と v3 マトリクスの双方を CL へ。材料は行指定→既定→原作本体。
        //   ※ documents 行(生成文書)は別途 INSERT 済のため、ここでは契約メタを upsert し
        //     form_data/drive_link は温存（upsertMasterContract が ON CONFLICT で除外）。
        const v3CondInputs =
          Array.isArray(formData.v3_conds) && formData.v3_conds.length > 0
            ? mapV3MatrixToConditions(
                formData.v3_conds,
                Array.isArray(formData.v3_lcs) ? formData.v3_lcs : [],
                formData.素材番号 || null
              )
            : undefined;
        const lcSaved = await upsertMasterContract(
          { query },
          {
            document_number: docNumber,
            issue_key: issueKey,
            template_type: "individual_license_terms",
            record_type: "individual_contract",
            contract_category: "license",
            contract_type: "license_basic",
            contract_title: formData.原著作物名 || formData.基本契約名 || null,
            original_work: formData.原著作物名 || null,
            product_name: formData.対象製品予定名 || null,
            effective_date: formData.許諾開始日 || null,
            ledger_code: ledgerCodeForWork || null,
            ledger_ref_id: resolvedLedgerRefId || null,
            material_ref_id: resolvedMaterialRefId || null,
            default_material_code: formData.素材番号 || null,
            condition_material_codes: (formData.condition_material_codes ||
              {}) as Record<string, string>,
            financial_conditions: Array.isArray(formData.financial_conditions)
              ? formData.financial_conditions
              : undefined,
            extra_conditions: v3CondInputs,
          }
        );
        const lcId = lcSaved.documentId;
        // 作品連動(work_material_uses への組み込み)は Phase 後段で対応（CLの原作結線は済）。

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

      // 再発行(isReissue)時: 旧版明細に紐づく実績(検収/計算)を新版明細へ引き継ぐ。
      //   全 condition_lines を書き終えた後に実行する。一意に対応付けできる明細
      //   だけを付け替え、内容編集で曖昧になった明細は触らず警告に留める
      //   (取り違えるくらいなら何もしない)。非致命: 失敗しても発行自体は止めない。
      if (isReissue) {
        try {
          const co = await carryOverReissueConsumption(
            { query },
            baseDocumentNumber,
            docNumber
          );
          if (co.carried > 0) {
            console.log(
              `[reissue-carryover] ${docNumber}: ${co.carried} 明細 / ${co.movedEvents} 実績を新版へ引き継ぎ`
            );
          }
          if (co.skipped.length > 0) {
            console.warn(
              `[reissue-carryover] ${docNumber}: 一意対応できず未引き継ぎ ${co.skipped.length} 明細 ` +
                `(要手動確認: ${co.skipped
                  .map((s) => `${s.lineCode || s.oldLineId}[${s.reason}]`)
                  .join(", ")})`
            );
          }
        } catch (coErr) {
          console.warn("[reissue-carryover] skipped (non-fatal):", coErr);
        }
      }

      // Slack notification with the Drive link.
      //   DB登録のみ (dbOnly) のときは文書を発行していないので通知しない。
      if (slackWebClient && !dbOnly) {
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

      // 自己修復(冪等): 上の post-document sync が途中で例外を投げると、
      //   contract_capabilities 同期(record_type/contract_category 付与)や
      //   出版印税条件(cfc)の作成がスキップされ、documents 行だけが残って
      //   「条件明細に出ない・ピッカーに載らない」半端な状態になる
      //   (ユーザーには success を返すため気付けない)。ここで独立の try に
      //   分離し、契約系文書は最低限の属性と条件を必ず確定させる。
      //   COALESCE / NOT EXISTS でガードするため、正常同期済みの文書には無害。
      try {
        if (documentId) {
          // (1) record_type / contract_category / source_system を確定。
          const rt = templateType.startsWith("pub_master_")
            ? "master_contract"
            : templateType.startsWith("pub_")
            ? "publication_condition"
            : templateType.includes("license") || templateType.includes("royalty")
            ? "license_condition"
            : templateType.includes("purchase_order")
            ? "purchase_order"
            : templateType.includes("inspection")
            ? "delivery_record"
            : "master_contract";
          const cat = templateType.startsWith("pub_")
            ? "publication"
            : templateType.includes("license")
            ? "license"
            : "service";
          await query(
            `UPDATE documents SET
               record_type       = COALESCE(NULLIF(record_type, ''), $2),
               contract_category = COALESCE(NULLIF(contract_category, ''), $3),
               source_system     = COALESCE(NULLIF(source_system, ''), 'App Document Generator'),
               contract_title    = COALESCE(NULLIF(contract_title, ''), NULLIF($4, '')),
               is_active         = COALESCE(is_active, TRUE)
             WHERE id = $1`,
            [
              documentId,
              rt,
              cat,
              String(
                formData.CONTRACT_TITLE ||
                  formData.contract_title ||
                  formData["対象出版物名"] ||
                  formData["原著作物名"] ||
                  ""
              ),
            ]
          );

          // (2) 出版利用許諾条件書で cfc 条件が1件も無ければ form_data から作成。
          if (templateType === "pub_license_terms") {
            const hasCfc = await query(
              `SELECT 1 FROM condition_lines
                WHERE document_id = $1 AND legacy_role = 'cfc' LIMIT 1`,
              [documentId]
            );
            if (hasCfc.rows.length === 0) {
              await upsertCapabilityFinancialConditions(
                documentId,
                buildPubLicenseConditions(formData)
              );
              console.log(
                `🔧 [self-heal] ${docNumber}: 出版印税条件を form_data から復元`
              );
            }
          }
        }
      } catch (healErr: any) {
        console.warn("[self-heal] capability/condition ensure failed (non-fatal):", healErr);
        syncWarnings.push({
          step: "self_heal",
          error: String(healErr?.message || healErr),
        });
      }

      // Phase 22.21.80: 文書発行が成功したら document_drafts の draft を消す。
      //   PDF が完成 = draft の役目終了。残すとフォームを再オープンした時に
      //   古い入力で上書き復元されて混乱する。冪等 (無くてもエラーにしない)。
      //   syncWarnings には積むが、HTTP は成功扱いで返す。
      try {
        const delRes = await query(
          `DELETE FROM document_drafts
            WHERE issue_key = $1 AND template_type = $2`,
          [issueKey, templateType]
        );
        if ((delRes.rowCount || 0) > 0) {
          console.log(
            `🗑️ [draft-cleanup] removed draft for ${issueKey} (${templateType})`
          );
        }
      } catch (draftErr) {
        console.warn("[draft-cleanup] failed (non-fatal):", draftErr);
        syncWarnings.push({
          step: "draft_cleanup",
          error: String((draftErr as any)?.message || draftErr),
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
        // Phase 22.21.104: 検収書 / 利用許諾料計算書のみ Excel リンクも返す
        // (それ以外の templateType では null)
        excelLink,
        documentNumber: docNumber,
        templateType,
        // DB登録のみモードで処理した場合 true (フロントの完了表示切替用)
        dbOnly,
        warnings: syncWarnings,
      });
    } catch (error) {
      console.error("Error in /api/documents/generate:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/test-generate", async (req, res) => {
    try {
      // Phase 22.21.82: 削除済みテンプレ (legal_request / contract /
      //   planning_purchase_order / payment_notice / fee_statement /
      //   license_report) 用の分岐を撤去。デフォルトを purchase_order に。
      const type = (req.query.type as any) || "purchase_order";

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
      } else if (type === "nda") {
        demoData.summary = "NDA (秘密保持契約書)";
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

  function loadTemplateMetadata(): Record<string, any> {
    const configPath = path.join(process.cwd(), "templates_config.json");
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  function sampleValueForTemplateField(fieldId: string, meta: any): any {
    const id = String(fieldId || "");
    const upper = id.toUpperCase();
    const label = String(meta?.label || "");
    const placeholder = String(meta?.placeholder || "");
    if (meta?.type === "boolean") return true;
    if (meta?.type === "number") {
      if (upper.includes("DAYS")) return 10;
      if (upper.includes("YEARS")) return 5;
      if (upper.includes("RATE")) return 10;
      if (upper.includes("AMOUNT") || upper.includes("TOTAL") || label.includes("金額")) return 100000;
      return 1;
    }
    if (meta?.type === "select" && Array.isArray(meta.options) && meta.options.length > 0) {
      return meta.options[0];
    }
    if (upper.includes("CONTRACT_NO") || upper.includes("ORDER_NO")) return "SAMPLE-2026-0001";
    if (upper.includes("CONTRACT_DATE_FORMATTED")) return "2026年5月24日";
    if (upper.includes("DATE")) return "2026-05-24";
    if (upper.includes("PARTY_B_NAME") || upper.includes("VENDOR_NAME")) return "サンプル株式会社";
    if (upper.includes("ADDRESS")) return "東京都千代田区サンプル1-2-3";
    if (upper.includes("REPRESENTATIVE") || upper.includes("_REP")) return "代表取締役 山田 太郎";
    if (upper.includes("EMAIL")) return "sample@example.com";
    if (upper.includes("PHONE") || upper.includes("TEL")) return "03-1234-5678";
    if (upper.includes("JURISDICTION")) return "東京地方裁判所";
    if (upper.includes("CONFIDENTIALITY_YEARS")) return 5;
    if (upper.includes("BREACH_CURE_DAYS")) return 14;
    if (upper.includes("PAYMENT")) return "月末締め翌月末日払い";
    if (upper.includes("DELIVERY_LOCATION")) return "甲指定倉庫";
    if (upper.includes("PRODUCT_SCOPE")) return "アナログゲーム製品および関連商品";
    if (upper.includes("WARRANTY_PERIOD")) return "引渡し後1年";
    if (upper.includes("SPECIAL_TERMS") || upper.includes("REMARKS") || upper.includes("NOTES")) {
      return "本欄はサンプル表示です。実運用では案件に応じて編集してください。";
    }
    if (placeholder) return placeholder.replace(/^例[:：]\s*/, "");
    if (label) return `${label}サンプル`;
    return `[${id}]`;
  }

  // Phase 25.7: 出版テンプレ用のサンプルデータ。汎用ヒューリスティックだと
  //   日本語キーが「ラベルサンプル」になり、boolean が全て true になって
  //   全条件ブロック (全類型テーブル / 再発行バナー) が表示される「中途半端」な
  //   プレビューになるため、現実的な記入例で上書きする (booleanは代表的な mix)。
  const PUBLICATION_SAMPLE_COMMON: Record<string, any> = {
    アークライト住所: "東京都千代田区神田小川町1-2 風雲堂ビル2階",
    アークライト代表者氏名: "青柳 昌行",
    振込先銀行名: "三井住友銀行", 支店名: "大泉支店", 口座種別: "普通",
    口座番号: "0947408", 口座名義カナ: "ボウケンシエン（カ",
    インボイス登録状況: "登録済", インボイス登録番号: "T5011601007991",
    再発行フラグ: false,
  };
  const PUBLICATION_SAMPLE_OVERRIDES: Record<string, Record<string, any>> = {
    pub_master_corporate: {
      ...PUBLICATION_SAMPLE_COMMON,
      契約番号: "ARC-PUB-2026-0001", 契約締結日: "2026年6月1日",
      許諾者住所: "東京都練馬区東大泉3-29-21", 許諾者法人名: "冒険支援株式会社",
      代表者職名: "代表取締役", 代表者氏名: "伊藤 公之",
      担当者氏名: "鈴木 一郎", 担当者電話番号: "03-1234-5678", 担当者メール: "suzuki@example.co.jp",
      特記事項: "本基本契約には二次利用（商品化・映像化・デジタルゲーム化）の権利メニューを含む。具体的条件は追加利用許諾条件書による。",
    },
    pub_master_individual: {
      ...PUBLICATION_SAMPLE_COMMON,
      契約番号: "ARC-PUB-2026-0002", 契約締結日: "2026年6月1日",
      許諾者住所: "東京都杉並区高円寺南4-5-6", 許諾者氏名: "山田 太郎",
      許諾者電話番号: "090-1234-5678", 許諾者メール: "taro.yamada@example.com",
      特記事項: "本著作物のイラスト原画の所有権は許諾者に留保される。",
    },
    pub_license_terms: {
      ...PUBLICATION_SAMPLE_COMMON,
      条件書番号: "ARC-PUBT-2026-0001", 基本契約番号: "ARC-PUB-2026-0001",
      締結日: "2026年6月10日", 基本契約締結日: "2026年6月1日", 許諾者種別: "法人",
      許諾者: "冒険支援株式会社", 許諾者住所: "東京都練馬区東大泉3-29-21",
      許諾開始日: "2026-07-01", 許諾終了日: "2031-06-30",
      自動更新有無: "あり", 更新単位: "1年", 終了通知期限: "期間満了の3か月前",
      原著作物名: "冒険者たちの物語", 対象出版物名: "冒険者たちの物語 完全版",
      著作者名: "山田 太郎", 著作権者: "冒険支援株式会社",
      共同著作第三者権利有無: "なし", 権利関係備考: "単独著作。第三者権利の混入なし。",
      電子書籍配信許諾有無: "許諾する", 電子書籍配信条件: "主要電子書籍ストアにて配信。DRM 適用。",
      翻訳海外版許諾有無: "許諾しない", 翻訳海外版対象地域言語: "—",
      発行予定日: "2026-09-01", 刊行期限: "2027-03-31",
      許諾地域: "日本国内", 許諾言語: "日本語",
      販売形態: "紙書籍／電子書籍／EC販売", 定価又は基準価格: "本体2,000円（税抜）",
      紙媒体計算式: "税抜定価 × 印税対象部数 × 印税率", 紙書籍印税率: "10",
      紙媒体印税対象部数区分: "実売部数", 電子書籍計算式: "アークライト受領額 × 印税率",
      電子書籍印税率: "25", 翻訳海外版計算式: "—", 翻訳海外版料率: "—",
      報告明細: "利用形態別の数量・単価・金額を記載した報告書を提出",
      消費税区分: "外税10%", 源泉徴収有無: "なし", 第三者IP関与有無: "なし",
      著作権表示: "© 2026 山田太郎 / 冒険支援株式会社", 表示位置補足: "奥付に記載",
      旧合意過去利用取扱い: "該当なし", 特記事項: "初版発行部数は5,000部を予定。",
    },
    pub_additional_terms: {
      ...PUBLICATION_SAMPLE_COMMON,
      追加条件書番号: "ARC-PUBA-2026-0001", 基本契約番号: "ARC-PUB-2026-0001",
      通常条件書番号: "ARC-PUBT-2026-0001", 対象出版物名: "冒険者たちの物語 完全版",
      締結日: "2026年8月1日", 効力発生日: "2026-08-01",
      基本契約締結日: "2026年6月1日", 通常条件書締結日: "2026年6月10日",
      許諾者: "冒険支援株式会社", 許諾者住所: "東京都練馬区東大泉3-29-21",
      追加許諾開始日: "2026-08-01", 追加許諾終了日: "2031-06-30",
      自動更新有無: "あり", 更新単位: "1年", 終了通知期限: "期間満了の3か月前",
      原著作物名: "冒険者たちの物語", 対象キャラクター設定等: "主人公「アレン」および仲間キャラクター5名のデザイン・設定",
      著作者名: "山田 太郎", 著作権者: "冒険支援株式会社",
      第三者権利有無: "なし", 第三者権利備考: "—",
      // boolean は代表的な mix (商品化=ON / 映像化=OFF / ゲーム化=ON)
      商品化: true, 映像化: false, デジタルゲーム化: true, その他追加利用: false, その他利用類型: "",
      独占非独占区分: "非独占", 追加利用許諾地域: "全世界", 追加利用許諾言語: "日本語・英語",
      再許諾可否: "可（事前承認制）", 委託先利用可否: "可", 承認済再許諾先委託先: "株式会社グッズワークス（商品化）",
      商品化対象商品: "アクリルスタンド／クリアファイル／Tシャツ", 商品化製造販売条件: "製造数量・販売チャネルは事前協議。販売開始2026年12月予定。",
      商品化監修承認条件: "商品仕様・サンプル・パッケージを事前確認", 商品化サンプル条件: "各商品3点を献本",
      ゲーム化対象プラットフォーム: "iOS／Android／Steam", ゲーム化対象ゲーム機能: "RPG（本編シナリオ＋DLC追加シナリオ）",
      ゲーム化運営条件: "配信開始2027年予定。サービス終了時は3か月前告知。", ゲーム化監修承認条件: "主要キャラ表現・世界観改変は事前承認",
      監修対象: "商品仕様・ゲーム内容・広告宣伝物・著作権表示", 監修提出物: "仕様書・サンプル・スクリーンショット",
      承認期限: "提出後10営業日以内", 承認方法: "メールによる書面承認",
      禁止事項制限事項: "著作者の名誉・声望を害する利用、公序良俗に反する利用は不可",
      派生素材権利帰属: "新規制作物の権利は制作主体に帰属。原著作物の権利は許諾者に留保。",
      追加利用著作権表示: "© 2026 山田太郎 / 冒険支援株式会社",
      対価区分固定: false, 対価区分売上連動: true, 対価区分ライセンス収益分配: false, 対価区分MG前払: true, 対価区分無償: false,
      商品化対価計算式: "卸売額 × 8%", 映像化対価計算式: "—", ゲーム化対価計算式: "純売上 × 5%",
      控除項目為替条件: "プラットフォーム手数料控除後。為替はTTM適用。",
      MG前払金条件: "ゲーム化につきMG 1,000,000円", MG前払金充当方法: "ロイヤリティから充当",
      報告対象期間: "四半期", 報告期限: "各四半期末から45日以内", 支払期日: "報告後 翌月末日",
      報告明細: "商品別・タイトル別の数量・金額", 消費税区分: "外税10%", 源泉徴収有無: "なし",
      終了後処理: "未販売在庫は終了後6か月間に限り販売可。配信中ゲームは別途協議。",
      特記事項: "映像化は本条件書の対象外（選択していない）。",
    },
  };

  function buildSampleDocumentData(type: string) {
    // v3 マトリクステンプレのプレビューは専用サンプル（取引形態×構成要素LC、跨ぎ原作）。
    //   renderHtml が type=individual_license_terms_v3 で v3 context を適用するため、
    //   top-level に v3_conds/v3_lcs ＋ ヘッダ日本語キーを持たせる。
    if (type === "individual_license_terms_v3") {
      return {
        issueKey: "SAMPLE-1",
        documentNumber: "LIC-LO-2026-0015-ILT-0001",
        summary: "個別利用許諾条件書 v3（マトリクス）サンプル",
        requester: "LegalBridge Sample",
        date: new Date().toLocaleDateString("ja-JP"),
        ...v3SampleFormData(),
        details: {},
      };
    }
    const metadata = loadTemplateMetadata();
    const vars = metadata[type]?.vars || {};
    const templateVars = documentService.getTemplateVariables(type as any);
    const details: Record<string, any> = {};
    const fieldIds = new Set<string>([...Object.keys(vars), ...templateVars]);
    for (const fieldId of fieldIds) {
      details[fieldId] = sampleValueForTemplateField(fieldId, vars[fieldId]);
    }

    Object.assign(details, {
      CONTRACT_NO: details.CONTRACT_NO || "SAMPLE-2026-0001",
      ORDER_NO: details.ORDER_NO || "SAMPLE-2026-0001",
      DOC_NO: details.DOC_NO || "SAMPLE-2026-0001",
      issueKey: "SAMPLE-1",
      items: [
        { item_name: "サンプル品目A", spec: "仕様A", quantity: 10, unit_price: 10000, amount: 100000, remarks: "サンプル明細" },
        { item_name: "サンプル品目B", spec: "仕様B", quantity: 5, unit_price: 20000, amount: 100000, remarks: "" },
      ],
      order_lines: [
        { line_no: 1, item_name: "サンプル品目A", spec: "仕様A", quantity: 10, unit_price: 10000, amount_ex_tax: 100000 },
        { line_no: 2, item_name: "サンプル品目B", spec: "仕様B", quantity: 5, unit_price: 20000, amount_ex_tax: 100000 },
      ],
      order_lines_for_inspection: [
        { id: 1, line_no: 1, item_name: "サンプル成果物A", spec: "仕様A", quantity: 10, unit_price: 10000, amount_ex_tax: 100000 },
      ],
      delivery_line_items: [
        { line_no: 1, item_name: "サンプル成果物A", spec: "仕様A", inspected_quantity: 10, acceptance_ratio: 1, inspected_amount_ex_tax: 100000 },
      ],
      expenses: [
        { line_no: 1, expense_name: "サンプル経費", spent_date: "2026-05-24", amount_inc_tax: 11000, remarks: "交通費" },
      ],
      other_fees: [
        { line_no: 1, fee_name: "サンプル手数料", amount: 10000, remarks: "任意手数料" },
      ],
      // 個別利用許諾条件書ほか financial_conditions[] を描画するテンプレ用の金銭条件サンプル。
      financial_conditions: [
        {
          condition_no: 1, condition_name: "自社製造・直接販売",
          region_territory: "日本国内", region_language: "日本語", region_language_label: "日本国内・日本語",
          calc_type: "BASE_QTY_RATE", calc_method: "基準価格 × 個数 × 料率",
          base_price_label: "上代（MSRP）", rate_pct: 5, mg_amount: 100000, ag_amount: 0, currency: "JPY",
          payment_terms: "毎四半期末締め翌月末日払い", formula_text: "基準価格 × 個数 × 5%",
        },
        {
          condition_no: 2, condition_name: "国内・海外展開（ライセンスアウト型）",
          region_territory: "全世界", region_language: "全言語", region_language_label: "全世界・全言語",
          calc_type: "BASE_RATE", calc_method: "受領ライセンス料 × 料率",
          base_price_label: "受領サブライセンス料", rate_pct: 50, mg_amount: 0, ag_amount: 0, currency: "JPY",
          payment_terms: "毎半期末締め翌月末日払い", formula_text: "受領サブライセンス料 × 50%",
        },
      ],
      CHANGE_RECORDS: details.CHANGE_RECORDS || "2026-05-24|検収金額|100000|80000|一部不合格のため減額",
    });

    // Phase 25.7: 出版テンプレは現実的な記入例で上書き (ヒューリスティック値・
    //   全 boolean=true を整理)。
    const pubOverride = PUBLICATION_SAMPLE_OVERRIDES[type];
    if (pubOverride) Object.assign(details, pubOverride);

    const documentNumber = String(
      details.契約番号 ||
        details.条件書番号 ||
        details.追加条件書番号 ||
        details.CONTRACT_NO ||
        details.ORDER_NO ||
        details.DOC_NO ||
        "SAMPLE-2026-0001"
    );
    return {
      issueKey: "SAMPLE-1",
      documentNumber,
      summary: `${metadata[type]?.label || type} サンプル`,
      requester: "LegalBridge Sample",
      date: new Date().toLocaleDateString("ja-JP"),
      details,
    };
  }

  app.get("/api/templates/:type/sample-preview", (req, res) => {
    try {
      const { type } = req.params;
      const html = documentService.renderHtml(buildSampleDocumentData(type), type as any);
      res.type("html").send(html);
    } catch (error) {
      res.status(500).type("text/plain").send(String(error));
    }
  });

  app.get("/api/templates/:type/sample.pdf", async (req, res) => {
    try {
      const { type } = req.params;
      const html = documentService.renderHtml(buildSampleDocumentData(type), type as any);
      const pdf = await renderHtmlToPdf(html);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sanitizeForFilename(type)}_sample.pdf"`
      );
      res.send(pdf);
    } catch (error) {
      res.status(500).type("text/plain").send(String(error));
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
