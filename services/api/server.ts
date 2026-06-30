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
import { registerContractsV2 } from "./src/routes/contractsV2.ts";
// 新スキーマ(work-centric)read API。/api/v3/*。
import { registerWorkModelRoutes } from "./src/routes/workModel.ts";
import { registerRelatedPartyReads } from "./src/routes/relatedPartyReads.ts";
import * as contractCheckService from "./src/services/contractCheckService.ts";
import {
  listPage as renderListPage,
  detailPage as renderDetailPage,
  errorPage as renderErrorPage,
  ringiPage as renderRingiPage,
} from "./src/views/contractSearchHtml.ts";
// B5b: search-api ローカルレンダリング(② サンプルプレビュー)。共有モジュール
//   (canonical: shared/rendering/render.mjs を同期コピー)で worker と同一出力。
import Handlebars from "handlebars";
import {
  registerHelpers as registerRenderHelpers,
  buildSampleData,
  renderTemplate as renderSharedTemplate,
} from "./src/lib/shared-rendering.mjs";
// 個別利用許諾 v3 マトリクスの雛形プレビュー用（worker と同一の純関数・サンプル）。
import {
  buildIndividualLicenseV3Context,
  v3SampleFormData,
} from "./src/lib/individualLicenseV3Context.ts";
// B5b: プレビュー PDF をローカル生成(worker proxy 撤去)。chromium 同梱(Dockerfile)。
import { renderHtmlToPdf } from "./src/services/pdfRenderer.ts";

/**
 * Phase E-2: 検収フォーム向け発注明細を coverage-gated dual-read で取得。
 *   condition_lines が当該 capability の line_item 由来明細を完全カバー(件数一致)
 *   する場合のみ condition_lines(faithful superset) から読む。1件でも欠ければ /
 *   未作成なら capability_line_items にフォールバック → 無回帰。
 *   id = source_line_item_id (= 旧 capability_line_item_id) なので、
 *   delivery_line_items 経由の検収累計(inspMap)参照もそのまま機能する。
 */
async function readCapabilityLinesForInspectionDisplay(
  capabilityId: number
): Promise<any[]> {
  try {
    const cl = await query(
      `SELECT source_line_item_id AS id,
              COALESCE(source_seq_no, line_no) AS line_no, subject AS item_name, spec,
              unit_price, quantity, amount_ex_tax, calc_method, payment_terms,
              payment_method, payment_date, delivery_date,
              cycle, term_start, term_end, billing_day
         FROM condition_lines
        WHERE capability_id = $1 AND source_line_item_id IS NOT NULL
        ORDER BY COALESCE(source_seq_no, line_no) ASC`,
      [capabilityId]
    );
    const oldCount = await query(
      `SELECT COUNT(*)::int AS c FROM capability_line_items WHERE capability_id = $1`,
      [capabilityId]
    );
    if (cl.rows.length > 0 && cl.rows.length === Number(oldCount.rows[0].c)) {
      return cl.rows;
    }
  } catch (err: any) {
    if (!err || (err.code !== "42P01" && err.code !== "42703")) throw err;
  }
  const li = await query(
    `SELECT id, line_no, item_name, spec, unit_price, quantity, amount_ex_tax,
            calc_method, payment_terms, payment_method, payment_date, delivery_date,
            cycle, term_start, term_end, billing_day
       FROM capability_line_items
      WHERE capability_id = $1
      ORDER BY line_no ASC`,
    [capabilityId]
  );
  return li.rows;
}

/**
 * Phase E-2: 利用許諾条件(財務条件)の表示行を coverage-gated dual-read で取得 (api)。
 *   worker/formReadRoutes の同名ヘルパーと対称。A案で暗黙 terms に切り出された分も
 *   source_condition_id 経由で連結し、condition_no は source_seq_no で faithful 復元。
 *   完全カバー時のみ condition_lines、欠ければ capability_financial_conditions。
 */
async function readCapabilityFinancialRowsForDisplay(
  capabilityId: number
): Promise<any[]> {
  try {
    const cl = await query(
      `SELECT cl.source_condition_id AS id, cl.source_seq_no AS condition_no,
              cl.subject AS region_language_label, cl.calc_method, cl.rate_pct,
              cl.base_price_label, cl.calc_period, cl.currency, cl.formula_text,
              cl.payment_terms, cl.mg_amount, COALESCE(cl.ag_amount, 0) AS ag_amount,
              cl.calc_period_kind, cl.calc_period_close_month
         FROM condition_lines cl
        WHERE cl.source_condition_id IN (
                SELECT id FROM capability_financial_conditions WHERE capability_id = $1)
        ORDER BY cl.source_seq_no ASC NULLS LAST, cl.id`,
      [capabilityId]
    );
    const oldCount = await query(
      `SELECT COUNT(*)::int AS c FROM capability_financial_conditions WHERE capability_id = $1`,
      [capabilityId]
    );
    if (cl.rows.length > 0 && cl.rows.length === Number(oldCount.rows[0].c)) {
      return cl.rows;
    }
  } catch (err: any) {
    if (!err || (err.code !== "42P01" && err.code !== "42703")) throw err;
  }
  try {
    return (
      await query(
        `SELECT id, condition_no, region_language_label, calc_method, rate_pct,
                base_price_label, calc_period, currency, formula_text, payment_terms,
                mg_amount, COALESCE(ag_amount, 0) AS ag_amount,
                calc_period_kind, calc_period_close_month
           FROM capability_financial_conditions
          WHERE capability_id = $1
          ORDER BY condition_no ASC`,
        [capabilityId]
      )
    ).rows;
  } catch (e2: any) {
    if (e2 && e2.code === "42703") {
      return (
        await query(
          `SELECT id, condition_no, region_language_label, calc_method, rate_pct,
                  base_price_label, calc_period, currency, formula_text, payment_terms,
                  mg_amount, COALESCE(ag_amount, 0) AS ag_amount
             FROM capability_financial_conditions
            WHERE capability_id = $1
            ORDER BY condition_no ASC`,
          [capabilityId]
        )
      ).rows;
    }
    throw e2;
  }
}

// 雛形プレビューで非表示にするテンプレ（一覧・直リンク描画ともに遮断）。
//   個別利用許諾の旧フラット版は v3（individual_license_terms_v3）へ置換。
//   ※ 生成（後方互換）には影響しない（worker は disk フォールバックで継続）。
const HIDDEN_PREVIEW_TYPES = new Set<string>(["individual_license_terms"]);

// helper は起動時 1 回、partial は DB から遅延ロードして専用インスタンスに登録。
const previewHb = Handlebars.create();
registerRenderHelpers(previewHb);
let previewPartialsLoaded = false;
async function ensurePreviewPartials(): Promise<void> {
  if (previewPartialsLoaded) return;
  const r = await query(
    `SELECT dt.template_key, v.html_source
       FROM document_templates dt
       JOIN document_template_versions v ON v.id = dt.current_version_id
      WHERE dt.kind = 'partial' AND dt.is_active = true`
  );
  for (const row of r.rows as any[]) previewHb.registerPartial(row.template_key, row.html_source);
  previewPartialsLoaded = true;
}
// TEMPLATE_SOURCE=db のとき、DB のテンプレ + サンプルデータでローカルレンダリング。
async function renderSamplePreviewFromDb(type: string): Promise<string | null> {
  const r = await query(
    `SELECT dt.label, v.html_source, v.field_schema
       FROM document_templates dt
       JOIN document_template_versions v ON v.id = dt.current_version_id
      WHERE dt.template_key = $1 AND dt.kind = 'document' AND dt.is_active = true`,
    [type]
  );
  if (r.rows.length === 0) return null;
  await ensurePreviewPartials();
  const row = r.rows[0] as any;
  // v3 マトリクステンプレは専用サンプル＋ context builder で描画（worker と同一出力）。
  //   汎用 buildSampleData は conds/lcs を生成できないため、跨ぎ原作の取引形態×LC を明示。
  if (type === "individual_license_terms_v3") {
    const sample = v3SampleFormData();
    const v3Data = { ...sample, ...buildIndividualLicenseV3Context(sample) };
    return renderSharedTemplate(previewHb, row.html_source, v3Data);
  }
  const data = buildSampleData(row.field_schema || [], row.html_source, row.label || type);
  return renderSharedTemplate(previewHb, row.html_source, data);
}
// Phase 17s: HMAC 短期署名 URL + IAP 2 層防御。
// Phase 22.21.36: requireAppRole を追加 (staff.app_role ベース)。
// Phase 17z-2: requireIapUser / requireDepartmentRole を追加 (恒久 URL 対応)。
import {
  requireSignedUrl,
  requireSignedUrlOrIap,
  requireIapUser,
  requireDepartmentRole,
  requireAppRole,
  attachAppRole,
  requireScreen,
  requireAdminOrDepartment,
  resolveDepartmentCode,
} from "./src/lib/authMiddleware.ts";
import type { Role } from "./src/lib/screens.ts";
import { signLinkQs, hasSigningSecret } from "./src/lib/signedUrl.ts";
// Phase 17x: LegalOn 契約台帳 CSV 取り込み (search-api 内に閉じた書き込み機能)。
import { legalonImportPage } from "./src/views/legalonImportHtml.ts";
import {
  parseCsv as parseLegalonCsv,
  importLegalOnRows,
  getSampleCsv as getLegalonSampleCsv,
} from "./src/services/legalonImportService.ts";
// Phase 17z: 取引先マスター CRUD (search-api 側がメイン、worker 側は既存維持の
// バックアップ位置付け)。同じ vendors テーブルに対する upsert。
import { vendorMasterPage } from "./src/views/vendorMasterHtml.ts";
// Phase 22.21.35: 取引先 CSV 取り込み UI を search-api に集約 (保守対象統一)。
//   admin-ui (React) から直接アクセスせず、本ページ /imports/vendor で完結。
import { vendorImportPage } from "./src/views/vendorImportHtml.ts";
// Phase 22.21.36: 管理者ダッシュボード。インポート機能 + ユーザー権限管理。
import { adminDashboardPage } from "./src/views/adminDashboardHtml.ts";
import { adminStaffPage } from "./src/views/adminStaffHtml.ts";
// Phase 22.21.37: viewer 用ルート案内ページ。
import { loginPage, viewerHomePage } from "./src/views/landingHtml.ts";
// 法務ポータル(GAS 移植・DB 化): ガイド配信ビュー + 管理一覧 + 読取サービス。
//   設計: legalbridge-portal-migration。書込(差し替え)は worker(release/worker)。
import {
  portalPage as renderPortalPage,
  categoryPage as renderCategoryPage,
  notReadyPage as renderNotReadyPage,
  guideNotFoundPage,
} from "./src/views/guidePortalHtml.ts";
import { adminGuidesPage } from "./src/views/adminGuidesHtml.ts";
import { adminCategoriesPage } from "./src/views/adminCategoriesHtml.ts";
import {
  listCategories as listGuideCategories,
  listGuides as listPortalGuides,
  guidesInCategory as guidesInGuideCategory,
  getGuideByKey as getPortalGuideByKey,
  renderGuideHtml as renderPortalGuideHtml,
  listGuidesForAdmin as listPortalGuidesForAdmin,
  listCategoriesForAdmin as listPortalCategoriesForAdmin,
  createCategory as createPortalCategory,
  updateCategory as updatePortalCategory,
  deleteCategory as deletePortalCategory,
  updateGuide as updatePortalGuide,
} from "./src/services/portalGuideService.ts";
import {
  listVendors,
  getVendor,
  upsertVendor,
  parseVendorCsv,
  importVendorRows,
  getVendorSampleCsv,
  getVendorExportCsv,
  deleteVendorForce,
  listVendorOrphans,
  attachVendorOrphan,
} from "./src/services/vendorMasterService.ts";
// Phase 17z-4: Staff マスター + Contracts (LegalOn 取込) を Master タブ群に統合。
import { staffMasterPage } from "./src/views/staffMasterHtml.ts";
import { masterContractsPage } from "./src/views/masterContractsHtml.ts";
import { templatePreviewPage } from "./src/views/templatePreviewHtml.ts";
// B1: 作品中心モデルの閲覧ページ(admin-ui の WorkModelPage を Search へ移設)。
import { workModelEmbedPage } from "./src/views/workModelHtml.ts";
import { conditionsPage } from "./src/views/conditionsHtml.ts";
import {
  getWorkDistribution,
  getWorkLineage,
  listMappableWorks,
  listWorkAliases,
  addWorkAlias,
  deleteWorkAlias,
  resolveWorksByTitle,
} from "./src/services/receivableMapService.ts";
import { receivableMapPage } from "./src/views/receivableMapHtml.ts";
import {
  listConditions,
  updateConditionLinks,
  autoLinkConditions,
  autoStatusConditions,
  listRingiOptions,
  exportConditionsCsv,
} from "./src/services/conditionsService.ts";
import {
  listStaff,
  getStaff,
  upsertStaff,
  parseStaffCsv,
  importStaffRows,
  getStaffSampleCsv,
} from "./src/services/staffMasterService.ts";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;
  const DOCUMENT_WORKER_URL =
    process.env.LB_WORKER_BASE_URL ||
    process.env.DOCUMENT_WORKER_URL ||
    "https://legalbridge-document-worker-988056987352.asia-northeast1.run.app";
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

  // 統合 Phase 2: admin-ui ホスト(IAP配下)が IAP メールの app_role を解決するための
  //   内部エンドポイント。portal_secret で保護。admin-ui を admin 限定にするゲートと
  //   /whoami 表示に使う。{ email, role } を返す。
  app.get("/api/staff/role", requirePortalSecret, async (req, res) => {
    try {
      const email = String(req.query.email || "").trim().toLowerCase();
      if (!email) return res.json({ email: null, role: "viewer" });
      const bootstrap = (process.env.LB_APP_ADMIN_EMAILS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (bootstrap.includes(email)) return res.json({ email, role: "admin" });
      let role = "viewer";
      try {
        const r = await query(
          "SELECT app_role FROM staff WHERE LOWER(email) = $1 LIMIT 1",
          [email]
        );
        const v = ((r.rows[0]?.app_role as string) || "").trim().toLowerCase();
        role = v === "admin" ? "admin" : "viewer";
      } catch (lookupErr) {
        console.warn("[/api/staff/role] lookup failed:", lookupErr);
      }
      res.json({ email, role });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -------------------------------------------------------------------
  // /search/* — Web 詳細ページ (Phase 12)
  //
  // Slack /法務検索 から「Web で詳細」ボタン経由でアクセス。
  //
  // Phase 17s: HMAC 短期署名 URL に移行。互換のため legacy LB_PORTAL_SECRET
  // (?token= or X-LB-Portal-Secret) も dual-accept (移行期間)。最終的に
  // legacy 経路は撤去予定。
  // -------------------------------------------------------------------

  /**
   * 各 view 関数に渡す HMAC 署名URL生成関数。LB_SIGNING_SECRET が
   * 未設定の場合は legacy token をそのまま返す (= 旧挙動を維持)。
   */
  function makeSignLink(req: express.Request): ((resourceId: string) => string) | string {
    if (hasSigningSecret()) {
      return (resourceId: string) => signLinkQs(resourceId);
    }
    // legacy mode: token を view にそのまま渡す
    return String(req.query.token || "");
  }

  app.get(
    "/search/vendor",
    requireSignedUrlOrIap({ resourceId: () => "list", renderErrorPage }),
    attachAppRole(),
    async (req, res) => {
    try {
      const role = (req as any).userRole as Role;
      const deptCode = await resolveDepartmentCode(req);
      const query = String(req.query.q || "").trim();
      const auth = makeSignLink(req);
      if (!query) {
        return res.type("html").send(renderListPage("", [], auth, role, deptCode));
      }
      // 単一候補のときも一覧経由で見せる (UX 一貫性)。検索 -> リスト -> 詳細
      // の階層をユーザーに常に提示するため。
      const summary = await contractCheckService.searchContractStatus({
        counterpartyName: query,
        purposeCode: "",
      } as any);
      let results: any[] = [];
      if (Array.isArray((summary as any)?.results)) {
        results = (summary as any).results;
      } else if ((summary as any)?.counterparty) {
        results = [summary];
      }
      res.type("html").send(renderListPage(query, results, auth, role, deptCode));
    } catch (error) {
      console.error("/search/vendor failed:", error);
      res
        .status(500)
        .type("html")
        .send(renderErrorPage("Server Error", String(error), 500));
    }
  });

  // Phase 17d: documentsByCategory に Backlog status を埋め込む共通 helper。
  async function enrichWithBacklogStatus(payload: any) {
    const cat = payload?.documentsByCategory;
    if (!cat) return payload;
    const allKeys = new Set<string>();
    ["basic", "individual", "inspection", "other"].forEach((k) => {
      (cat[k] || []).forEach((d: any) => {
        if (d?.issue_key) allKeys.add(d.issue_key);
      });
    });
    if (allKeys.size === 0) return payload;
    const statusMap = await contractCheckService.fetchBacklogStatuses(
      backlogService,
      Array.from(allKeys)
    );
    ["basic", "individual", "inspection", "other"].forEach((k) => {
      (cat[k] || []).forEach((d: any) => {
        if (d.issue_key && statusMap[d.issue_key]) {
          d.backlog_status = statusMap[d.issue_key];
        }
      });
    });
    return payload;
  }

  // Phase 17c: 稟議番号 (5 桁数字) で詳細ページを開く
  //   Phase 17s: /search/ringi/00001?exp=...&sig=...
  app.get(
    "/search/ringi/:number",
    requireSignedUrlOrIap({
      resourceId: (req) => `ringi:${String(req.params.number || "").trim()}`,
      renderErrorPage,
    }),
    attachAppRole(),
    async (req, res) => {
    try {
      const role = (req as any).userRole as Role;
      const num = String(req.params.number || "").trim();
      const auth = makeSignLink(req);
      if (!/^[0-9]{5}$/.test(num)) {
        return res
          .status(400)
          .type("html")
          .send(renderErrorPage("Bad Request", "稟議番号は 5 桁数字で指定してください", 400));
      }
      const payload = await contractCheckService.searchByRingiNumber(num);
      if (!payload?.ringi) {
        return res
          .status(404)
          .type("html")
          .send(renderErrorPage("Not Found", `稟議 ${num} が見つかりませんでした`, 404));
      }
      // Phase 17d: Backlog ステータスを enrich
      await enrichWithBacklogStatus(payload);
      const deptCode = await resolveDepartmentCode(req);
      res.type("html").send(renderRingiPage(payload, auth, role, deptCode));
    } catch (error) {
      console.error("/search/ringi/:number failed:", error);
      res
        .status(500)
        .type("html")
        .send(renderErrorPage("Server Error", String(error), 500));
    }
  });

  app.get(
    "/search/vendor/:vendorId",
    requireSignedUrlOrIap({
      resourceId: (req) => `vendor:${String(req.params.vendorId || "").trim()}`,
      renderErrorPage,
    }),
    attachAppRole(),
    async (req, res) => {
    try {
      const role = (req as any).userRole as Role;
      const vendorId = Number(req.params.vendorId);
      const auth = makeSignLink(req);
      const backQuery = String(req.query.q || "");
      if (!Number.isFinite(vendorId) || vendorId <= 0) {
        return res
          .status(400)
          .type("html")
          .send(renderErrorPage("Bad Request", "vendor id が不正です", 400));
      }
      // searchContractStatus({ vendorId }) で詳細を構築
      const payload: any = await contractCheckService.searchContractStatus({
        counterpartyName: "",
        purposeCode: "",
        vendorId,
      } as any);
      if (!payload?.counterparty) {
        return res
          .status(404)
          .type("html")
          .send(renderErrorPage("Not Found", "取引先が見つかりませんでした", 404));
      }
      const deptCode = await resolveDepartmentCode(req);
      res.type("html").send(renderDetailPage(payload, backQuery, auth, role, deptCode));
    } catch (error) {
      console.error("/search/vendor/:vendorId failed:", error);
      res
        .status(500)
        .type("html")
        .send(renderErrorPage("Server Error", String(error), 500));
    }
  });

  // -------------------------------------------------------------------
  // /imports/legalon — LegalOn 契約台帳の CSV 取り込み (Phase 17x → 17z-2)
  //
  // search-api は本来 read-only だが、Phase 17t-w の Option A に従って
  // ここだけ書き込みエンドポイントを開ける (contract_capabilities への
  // upsert のみ、ほかのテーブルは触らない)。
  //
  // 認可 (Phase 17z-2 で恒久 URL + 役割制御に切替):
  //   - requireIapUser          : IAP で本人特定 (Workspace ログイン必須)
  //   - requireDepartmentRole   : staff_master の部署照会で書き込み許可を判定
  //                                 現在 soft mode (warn ログのみ通過)、
  //                                 LB_ROLE_ENFORCE=true で enforce 403。
  //
  // 同じ judgement を GET (UI ページ) と POST (実行) の両方に適用する。
  // -------------------------------------------------------------------
  app.get(
    "/imports/legalon",
    requireIapUser({ renderErrorPage }),
    // Phase 22.21.36: requireDepartmentRole → requireAppRole に変更。
    //   個人単位の admin 権限で制御 (staff.app_role)。
    //   後方互換: bootstrap 期間中は LB_APP_ADMIN_EMAILS env でも通過。
    requireAppRole({
      resourceLabel: "imports:legalon",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    (req, res) => {
      try {
        // 恒久 URL: HMAC 不要 (null 渡し)。fetch は IAP セッションを継承。
        res.type("html").send(legalonImportPage(null, "admin"));
      } catch (error) {
        console.error("/imports/legalon failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // -------------------------------------------------------------------
  // Phase 22.21.37: ルートパス / の振る舞い。
  //   IAP 認証後、staff.app_role を参照して:
  //     - admin → /admin に 302 リダイレクト
  //     - viewer (or no DB record) → /search/* の使い方案内 HTML を表示
  //   旧挙動 (Cannot GET /) は単に Express 404 だったが、誤って Cloud Run
  //   URL のルートに来たユーザーへの導線として機能する。
  // -------------------------------------------------------------------
  app.get(
    "/",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const user = (req as any).user as
          | { email?: string | null; source?: string }
          | undefined;
        const email = (user?.email || "").trim().toLowerCase();

        // #5: 未認証(anonymous かつ email 無し) → ブランドログインゲート。
        //   IAP 配下なら通常ここに到達しない(IAP が前段でログインさせる)が、
        //   非強制環境でも美しい入口を出す。
        if (!email) {
          return res.type("html").send(loginPage({ continueUrl: "/" }));
        }

        // admin が viewer ホームを確認するためのプレビュー(?preview=viewer)。
        const previewViewer =
          String(req.query.preview || "").toLowerCase() === "viewer";

        // 実効ロール判定(bootstrap env or staff.app_role)。
        const bootstrapAdmins = (process.env.LB_APP_ADMIN_EMAILS || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        let role: string | null = bootstrapAdmins.includes(email) ? "admin" : null;
        if (!role) {
          try {
            const r = await query(
              "SELECT COALESCE(app_role, 'viewer') AS app_role FROM staff WHERE LOWER(email) = $1 LIMIT 1",
              [email]
            );
            role = (r.rows[0]?.app_role as string) || "viewer";
          } catch {
            role = "viewer";
          }
        }

        // admin ログイン後の入口は React admin-ui に一本化(ADMIN_UI_URL があれば
        //   そこへ、無ければ従来の管理ダッシュボード)。preview=viewer 指定時は除外。
        if (role === "admin" && !previewViewer) {
          const adminUi = (process.env.ADMIN_UI_URL || "").replace(/\/+$/, "");
          return res.redirect(302, adminUi || "/admin");
        }

        // viewer or unregistered(or admin の preview) → 法務ガイドポータルをトップに。
        //   (旧: 検索ポータルホーム viewerHomePage。検索は guide portal の「調べる」
        //    カテゴリ → 法務データ検索ガイド(/search/vendor リンク)からも辿れる。)
        const isAdmin = role === "admin";
        const [cats, pguides] = await Promise.all([
          listGuideCategories(),
          listPortalGuides(),
        ]);
        const countByCat: Record<string, number> = {};
        for (const pg of pguides) {
          if (pg.isOverview || !pg.categoryKey) continue;
          countByCat[pg.categoryKey] = (countByCat[pg.categoryKey] || 0) + 1;
        }
        res.type("html").send(renderPortalPage(cats, countByCat, isAdmin));
      } catch (error) {
        console.error("/ failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // -------------------------------------------------------------------
  // Phase 22.21.36: /admin ダッシュボード
  //   staff.app_role='admin' (or LB_APP_ADMIN_EMAILS) のみアクセス可能。
  //   ユーザー権限管理 + データ取込ショートカット + マスター CRUD リンク。
  // -------------------------------------------------------------------
  app.get(
    "/admin",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "admin:dashboard",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    (req, res) => {
      try {
        const user = (req as any).user as { email?: string | null } | undefined;
        res
          .type("html")
          .send(adminDashboardPage({ currentEmail: user?.email || null }));
      } catch (error) {
        console.error("/admin failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // -------------------------------------------------------------------
  // Phase 22.21.42: /admin/staff スタッフ権限管理サブページ
  //   /admin から 1 ステップ挟んで開く。staff 一覧 + admin/viewer 切替。
  // -------------------------------------------------------------------
  app.get(
    "/admin/staff",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "admin:staff",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    (req, res) => {
      try {
        const user = (req as any).user as { email?: string | null } | undefined;
        res
          .type("html")
          .send(adminStaffPage({ currentEmail: user?.email || null }));
      } catch (error) {
        console.error("/admin/staff failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // Phase 22.21.36: app_role 切替エンドポイント (admin 限定)
  //   PATCH /api/master/staff/:email/role
  //   body: { app_role: "admin" | "viewer" }
  //   自分自身を viewer に降格しようとしている場合 (= admin が 0 人になる懸念)
  //   は警告を出すが許可。緊急時は LB_APP_ADMIN_EMAILS env で bypass 可能。
  async function fetchWorker(path: string): Promise<Response> {
    const base = DOCUMENT_WORKER_URL.replace(/\/+$/, "");
    return fetch(`${base}${path}`);
  }

  app.get(
    "/templates/preview",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    async (req, res) => {
      try {
        const deptCode = await resolveDepartmentCode(req);
        res.type("html").send(templatePreviewPage((req as any).userRole as Role, deptCode));
      } catch (error) {
        console.error("/templates/preview failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  app.get(
    "/api/template-preview/list",
    requireIapUser({ renderErrorPage }),
    async (_req, res) => {
      try {
        // 非表示テンプレ（HIDDEN_PREVIEW_TYPES）はモジュール先頭で定義（一覧・直リンク共用）。
        // config(metadata) に載せない DB-only テンプレの表示名（proxy モードで型名直出しを防ぐ）。
        //   v3 は作成可能フォーム型として誤出現させないため config 非掲載 → ここで表示名を補う。
        const LABEL_OVERRIDES: Record<string, { label: string; category: string }> = {
          individual_license_terms_v3: { label: "個別利用許諾条件書（v3 マトリクス）", category: "License" },
        };

        // Phase 2 / B2: TEMPLATE_SOURCE=db で worker proxy を撤去し
        //   document_templates を DB 直読(Search 独立)。既定は従来 proxy=可逆。
        if (process.env.TEMPLATE_SOURCE === "db") {
          const result = await query(
            `SELECT template_key AS type, label, category
               FROM document_templates
              WHERE kind = 'document' AND is_active = true
              ORDER BY template_key`
          );
          const templates = result.rows
            .map((r: any) => ({
              type: r.type,
              label: r.label || "",
              category: r.category || "",
            }))
            .filter((t: any) => !HIDDEN_PREVIEW_TYPES.has(t.type));
          res.json({ ok: true, templates });
          return;
        }

        const [templatesRes, metadataRes] = await Promise.all([
          fetchWorker("/api/templates"),
          fetchWorker("/api/templates/config/metadata"),
        ]);
        if (!templatesRes.ok) throw new Error(`worker /api/templates HTTP ${templatesRes.status}`);
        const templateTypes = (await templatesRes.json()) as string[];
        const metadata = metadataRes.ok ? ((await metadataRes.json()) as Record<string, any>) : {};
        const templates = templateTypes
          .filter((type) => !type.includes("/") && !type.startsWith("partials"))
          .filter((type) => !HIDDEN_PREVIEW_TYPES.has(type))
          .sort((a, b) => a.localeCompare(b))
          .map((type) => ({
            type,
            label: metadata[type]?.label || LABEL_OVERRIDES[type]?.label || "",
            category: metadata[type]?.category || LABEL_OVERRIDES[type]?.category || "",
          }));
        res.json({ ok: true, templates });
      } catch (error) {
        console.error("/api/template-preview/list failed:", error);
        res.status(500).json({ ok: false, error: String(error) });
      }
    }
  );

  // Phase 2 / B5b: html プレビュー・PDF とも search-api ローカルレンダリング
  //   (TEMPLATE_SOURCE=db)。PDF は chromium 同梱(Dockerfile)+ puppeteer-core。
  //   既定は従来 worker proxy = 可逆。
  app.get(
    "/api/template-preview/:type/html",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const typeRaw = String(req.params.type || "");
        // 非表示テンプレは直リンクでも描画しない（一覧非表示と整合）。
        if (HIDDEN_PREVIEW_TYPES.has(typeRaw)) {
          res.status(404).type("text/plain").send(`Template not available: ${typeRaw}`);
          return;
        }

        if (process.env.TEMPLATE_SOURCE === "db") {
          const html = await renderSamplePreviewFromDb(typeRaw);
          if (html === null) {
            res.status(404).type("text/plain").send(`Template not found: ${typeRaw}`);
            return;
          }
          res.type("html");
          if (String(req.query.download || "") === "1") {
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${typeRaw.replace(/[^A-Za-z0-9_.-]+/g, "_")}_sample.html"`
            );
          }
          res.send(html);
          return;
        }

        const type = encodeURIComponent(typeRaw);
        const upstream = await fetchWorker(`/api/templates/${type}/sample-preview`);
        const body = await upstream.text();
        res.status(upstream.status);
        res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/html; charset=utf-8");
        if (String(req.query.download || "") === "1") {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${typeRaw.replace(/[^A-Za-z0-9_.-]+/g, "_")}_sample.html"`
          );
        }
        res.send(body);
      } catch (error) {
        console.error("/api/template-preview/:type/html failed:", error);
        res.status(500).type("text/plain").send(String(error));
      }
    }
  );

  app.get(
    "/api/template-preview/:type/pdf",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const typeRaw = String(req.params.type || "");
        // 非表示テンプレは直リンクでも PDF 化しない（一覧非表示と整合）。
        if (HIDDEN_PREVIEW_TYPES.has(typeRaw)) {
          res.status(404).type("text/plain").send(`Template not available: ${typeRaw}`);
          return;
        }

        // B5b: TEMPLATE_SOURCE=db のとき、html プレビューと同じローカルレンダリングで
        //   HTML を作り、chromium(puppeteer-core)で PDF 化。worker proxy を使わない。
        //   既定は従来 worker proxy = 可逆。
        if (process.env.TEMPLATE_SOURCE === "db") {
          const html = await renderSamplePreviewFromDb(typeRaw);
          if (html === null) {
            res.status(404).type("text/plain").send(`Template not found: ${typeRaw}`);
            return;
          }
          const pdf = await renderHtmlToPdf(html);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${typeRaw.replace(/[^A-Za-z0-9_.-]+/g, "_")}_sample.pdf"`
          );
          res.send(pdf);
          return;
        }

        const type = encodeURIComponent(typeRaw);
        const upstream = await fetchWorker(`/api/templates/${type}/sample.pdf`);
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.status(upstream.status);
        res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/pdf");
        res.setHeader(
          "Content-Disposition",
          upstream.headers.get("content-disposition") ||
            `attachment; filename="${typeRaw.replace(/[^A-Za-z0-9_.-]+/g, "_")}_sample.pdf"`
        );
        res.send(buffer);
      } catch (error) {
        console.error("/api/template-preview/:type/pdf failed:", error);
        res.status(500).type("text/plain").send(String(error));
      }
    }
  );

  // Phase 22.21.36: app_role 切替エンドポイント (admin 限定)
  //   PATCH /api/master/staff/:email/role
  //   body: { app_role: "admin" | "viewer" }
  app.patch(
    "/api/master/staff/:email/role",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "admin:staff-role",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "10kb" }),
    async (req, res) => {
      try {
        const targetEmail = String(req.params.email || "").trim().toLowerCase();
        const newRole = String(req.body?.app_role || "").trim().toLowerCase();
        if (!targetEmail) {
          return res.status(400).json({ ok: false, error: "email is required" });
        }
        if (!["admin", "viewer"].includes(newRole)) {
          return res
            .status(400)
            .json({ ok: false, error: "app_role must be 'admin' or 'viewer'" });
        }
        const result = await query(
          `UPDATE staff
              SET app_role = $1
            WHERE LOWER(email) = $2
            RETURNING id, email, staff_name, app_role`,
          [newRole, targetEmail]
        );
        if (result.rows.length === 0) {
          return res
            .status(404)
            .json({ ok: false, error: `staff not found: ${targetEmail}` });
        }
        const actor = ((req as any).user?.email || "?").toString();
        console.log(
          JSON.stringify({
            evt: "staff_role_change",
            actor,
            target_email: targetEmail,
            new_role: newRole,
            ts: new Date().toISOString(),
          })
        );
        res.json({ ok: true, staff: result.rows[0] });
      } catch (error: any) {
        console.error("PATCH /api/master/staff/:email/role failed:", error);
        res
          .status(500)
          .json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // -------------------------------------------------------------------
  // /imports/vendor — 取引先マスター CSV 取り込み (Phase 22.21.35)
  //
  // search-api 側に集約する方針 (保守対象統一)。admin-ui 側からは
  // 「CSV 一括取込」ボタンが新タブで本 URL を開く形に変更。
  // 認可は legalon と同じ「経営管理本部」「法務」の役割制御。
  // -------------------------------------------------------------------
  app.get(
    "/imports/vendor",
    requireIapUser({ renderErrorPage }),
    // Phase 22.21.36: admin ロールのみ
    requireAppRole({
      resourceLabel: "imports:vendor",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    (req, res) => {
      try {
        res.type("html").send(vendorImportPage(null, "admin"));
      } catch (error) {
        console.error("/imports/vendor failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // サンプル CSV ダウンロード (Phase 17x)
  //   UI の「サンプル CSV をダウンロード」ボタンから呼ばれる。
  //   ヘッダ + 5 行のサンプルデータ (うち 1 行は 3 者契約) を返す。
  //   署名 URL は不要にしておく (テンプレ自体はセンシティブ情報ゼロ)。
  app.get("/api/imports/legalon-csv/template", (_req, res) => {
    const csv = getLegalonSampleCsv();
    // Excel が UTF-8 を自動認識できるよう BOM を先頭に付ける
    const body = "﻿" + csv;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="legalon_sample.csv"'
    );
    res.send(body);
  });

  app.post(
    "/api/imports/legalon-csv",
    requireIapUser({ renderErrorPage }),
    // Phase 22.21.36: admin ロールのみ書き込み可
    requireAppRole({
      resourceLabel: "imports:legalon",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "20mb" }),
    async (req, res) => {
      try {
        const csv = String(req.body?.csv || "");
        if (!csv) {
          return res
            .status(400)
            .json({ ok: false, error: "csv body field is required" });
        }
        const dryRun = req.body?.dry_run === true;
        const duplicateMode = req.body?.duplicate_mode || "overwrite";
        if (!["overwrite", "skip", "fill_only"].includes(duplicateMode)) {
          return res.status(400).json({
            ok: false,
            error: "duplicate_mode must be one of: overwrite | skip | fill_only",
          });
        }

        const rows = parseLegalonCsv(csv);
        const result = await importLegalOnRows(rows, {
          dry_run: dryRun,
          duplicate_mode: duplicateMode as any,
        });

        console.log(
          JSON.stringify({
            evt: "legalon_import",
            dry_run: dryRun,
            duplicate_mode: duplicateMode,
            total: result.total,
            succeeded: result.succeeded,
            failed: result.failed,
            skipped: result.skipped,
            multi_party: result.multi_party_count,
            unresolved_vendors: result.unresolved_vendor_count,
            ts: new Date().toISOString(),
          })
        );

        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("/api/imports/legalon-csv failed:", error);
        res
          .status(500)
          .json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // -------------------------------------------------------------------
  // /master/vendors — 取引先マスター CRUD (Phase 17z)
  //
  // 役割の整理:
  //   - メイン (= 保守対象) : 本ルート群 (search-api)
  //   - サブ (= 既存維持)   : services/worker の /api/master/vendors
  //   どちらも同じ vendors テーブルを upsert する。
  //
  // 認可 (Phase 17z-2 で恒久 URL 化):
  //   - 読み取り (GET): requireIapUser のみ — Workspace ログインしていれば誰でも
  //     参照可能。URL に exp/sig 不要なので bookmark 可能。
  //   - 書き込み (POST): requireIapUser + requireDepartmentRole
  //     現在 soft mode (warn ログのみ)、LB_ROLE_ENFORCE=true で enforce。
  //     許可部署は LB_ROLE_ALLOWLIST_DEPARTMENTS env で上書き可能。
  // -------------------------------------------------------------------
  app.get(
    "/master/vendors",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    requireScreen({ key: "vendors", renderErrorPage }),
    (req, res) => {
      try {
        // 恒久 URL 化のため HMAC は付けない (null で渡す)。
        // 同一オリジン内の fetch は IAP セッションを継承するので、API も
        // 認証付き状態で叩ける。
        res.type("html").send(vendorMasterPage(null, (req as any).userRole as Role));
      } catch (error) {
        console.error("/master/vendors failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // GET /api/master/vendors?q=... — 一覧 (検索)
  app.get(
    "/api/master/vendors",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const q = String(req.query.q || "").trim();
        const limit = Number(req.query.limit) || undefined;
        const offset = Number(req.query.offset) || undefined;
        const result = await listVendors({ q, limit, offset });
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("GET /api/master/vendors failed:", error);
        res
          .status(500)
          .json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // GET /api/master/vendors/template.csv - sample CSV download (no auth)
  // Keep this before /api/master/vendors/:code; otherwise "template.csv" is treated as a code.
  app.get("/api/master/vendors/template.csv", (_req, res) => {
    const csv = getVendorSampleCsv();
    const body = "\uFEFF" + csv;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="vendor_sample.csv"');
    res.send(body);
  });

  // GET /api/master/vendors/export.csv \u2014 \u65E2\u5B58\u30C7\u30FC\u30BF\u3092\u53D6\u8FBC\u30C6\u30F3\u30D7\u30EC\u5F62\u5F0F\u3067\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u3002
  //   DL\u2192\u4FEE\u6B63\u2192/api/master/vendors/import-csv \u3067\u4E00\u62EC\u66F4\u65B0(\u30E9\u30A6\u30F3\u30C9\u30C8\u30EA\u30C3\u30D7)\u3002
  //   ":code" \u30EB\u30FC\u30C8\u3088\u308A\u524D\u306B\u7F6E\u304F(\u3067\u306A\u3044\u3068 "export.csv" \u304C code \u6271\u3044\u306B\u306A\u308B)\u3002
  app.get(
    "/api/master/vendors/export.csv",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        // ?codes=A,B,C で対象取引先を絞り込み(空なら全件)。
        const codes = String((req.query as any).codes || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const csv = await getVendorExportCsv(codes);
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="vendors_export_${stamp}.csv"`
        );
        res.send("\uFEFF" + csv);
      } catch (error: any) {
        console.error("GET /api/master/vendors/export.csv failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // GET /api/master/vendors/:code
  app.get(
    "/api/master/vendors/:code",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const code = String(req.params.code || "").trim();
        if (!code) {
          return res.status(400).json({ ok: false, error: "code is required" });
        }
        const v = await getVendor(code);
        if (!v) {
          return res
            .status(404)
            .json({ ok: false, error: `vendor not found: ${code}` });
        }
        res.json(v);
      } catch (error: any) {
        console.error("GET /api/master/vendors/:code failed:", error);
        res
          .status(500)
          .json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // POST /api/master/vendors — upsert (書き込み: 役割チェック土台あり)
  app.post(
    "/api/master/vendors",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "master:vendors:write",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "1mb" }),
    async (req, res) => {
      try {
        const payload = req.body || {};
        const saved = await upsertVendor(payload);
        res.json({ ok: true, vendor: saved });
      } catch (error: any) {
        console.error("POST /api/master/vendors failed:", error);
        const msg = String(error?.message || error);
        // バリデーションエラーは 400 で返す
        const status = /必須|invalid|required/i.test(msg) ? 400 : 500;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );


  // POST /api/master/vendors/import-csv — 一括取込
  app.post(
    "/api/master/vendors/import-csv",
    requireIapUser({ renderErrorPage }),
    // Phase 22.21.36: admin ロールのみ書き込み可
    requireAppRole({
      resourceLabel: "master:vendors:import",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "20mb" }),
    async (req, res) => {
      try {
        const csv = String(req.body?.csv || "");
        if (!csv) {
          return res.status(400).json({ ok: false, error: "csv body field is required" });
        }
        const dupMode = req.body?.duplicate_mode || "overwrite";
        if (!["overwrite", "skip", "fill_only"].includes(dupMode)) {
          return res.status(400).json({
            ok: false,
            error: "duplicate_mode must be one of: overwrite | skip | fill_only",
          });
        }
        const rows = parseVendorCsv(csv);
        const result = await importVendorRows(rows, {
          dry_run: req.body?.dry_run === true,
          duplicate_mode: dupMode,
        });

        console.log(
          JSON.stringify({
            evt: "vendor_csv_import",
            dry_run: req.body?.dry_run === true,
            duplicate_mode: dupMode,
            total: result.total,
            succeeded: result.succeeded,
            failed: result.failed,
            skipped: result.skipped,
            user: (req as any).user?.email || null,
            ts: new Date().toISOString(),
          })
        );

        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("POST /api/master/vendors/import-csv failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // POST /api/master/vendors/bulk-delete — 複数取引先を一括削除(admin)。
  //   body: { codes: string[] }。住所/口座/担当(1:N)は ON DELETE CASCADE で自動削除。
  //   文書/契約/作品等から参照中の取引先は FK 制約で削除不可 → スキップして報告。
  app.post(
    "/api/master/vendors/bulk-delete",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "master:vendors:delete",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "256kb" }),
    async (req, res) => {
      try {
        const codes: string[] = Array.isArray(req.body?.codes)
          ? req.body.codes.map((c: any) => String(c).trim()).filter(Boolean)
          : [];
        if (codes.length === 0) {
          return res.status(400).json({ ok: false, error: "codes[] is required" });
        }
        // mode: "skip"(既定/安全) = 参照中はスキップ。"force" = 参照をNULL(NOT NULL
        //   参照行は削除)してから削除し、NULLにした参照は孤立ログに記録(後で再アタッチ可)。
        const force = String(req.body?.mode || "").toLowerCase() === "force";
        const deleted: string[] = [];
        const skipped: { code: string; reason: string }[] = [];
        let nulledTotal = 0,
          removedTotal = 0,
          orphanTotal = 0;
        for (const code of codes) {
          try {
            if (force) {
              const r = await deleteVendorForce(code);
              if (r.deleted) {
                deleted.push(code);
                nulledTotal += r.nulled;
                removedTotal += r.removed;
                orphanTotal += r.orphans;
              } else {
                skipped.push({ code, reason: "見つかりません" });
              }
            } else {
              const r = await query(
                "DELETE FROM vendors WHERE vendor_code = $1 RETURNING vendor_code",
                [code]
              );
              if (r.rows.length > 0) deleted.push(code);
              else skipped.push({ code, reason: "見つかりません" });
            }
          } catch (e: any) {
            if (!force && e && e.code === "23503") {
              skipped.push({
                code,
                reason: "文書・契約・作品などから参照されているため削除できません",
              });
            } else {
              skipped.push({ code, reason: String(e?.message || e) });
            }
          }
        }
        console.log(
          JSON.stringify({
            evt: "vendor_bulk_delete",
            mode: force ? "force" : "skip",
            requested: codes.length,
            deleted: deleted.length,
            skipped: skipped.length,
            nulled: nulledTotal,
            removed: removedTotal,
            orphans: orphanTotal,
            user: (req as any).user?.email || null,
            ts: new Date().toISOString(),
          })
        );
        res.json({
          ok: true,
          deleted,
          skipped,
          nulled: nulledTotal,
          removed: removedTotal,
          orphans: orphanTotal,
        });
      } catch (error: any) {
        console.error("POST /api/master/vendors/bulk-delete failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // GET /api/master/vendor-orphans — 強制削除で取引先参照を失った(NULL化された)
  //   レコード一覧。再アタッチ(救済)の対象。
  app.get(
    "/api/master/vendor-orphans",
    requireIapUser({ renderErrorPage }),
    async (_req, res) => {
      try {
        res.json({ ok: true, rows: await listVendorOrphans() });
      } catch (error: any) {
        console.error("GET /api/master/vendor-orphans failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // POST /api/master/vendor-orphans/attach — 孤立レコードに取引先を再アタッチ(admin)。
  //   body: { id, vendor_code }
  app.post(
    "/api/master/vendor-orphans/attach",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "master:vendor-orphans:attach",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "16kb" }),
    async (req, res) => {
      try {
        const id = Number(req.body?.id);
        const vendorCode = String(req.body?.vendor_code || "").trim();
        if (!Number.isFinite(id) || !vendorCode) {
          return res.status(400).json({ ok: false, error: "id と vendor_code は必須です" });
        }
        await attachVendorOrphan(id, vendorCode);
        res.json({ ok: true });
      } catch (error: any) {
        console.error("POST /api/master/vendor-orphans/attach failed:", error);
        const msg = String(error?.message || error);
        res.status(/見つから|不正|解決済/.test(msg) ? 400 : 500).json({ ok: false, error: msg });
      }
    }
  );

  app.get(
    "/master/staff",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    requireScreen({ key: "staff", renderErrorPage }),
    (req, res) => {
    try {
      res.type("html").send(staffMasterPage((req as any).userRole as Role));
    } catch (error) {
      console.error("/master/staff failed:", error);
      res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
    }
  });

  app.get(
    "/api/master/staff",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const q = String(req.query.q || "").trim();
        const limit = Number(req.query.limit) || undefined;
        const offset = Number(req.query.offset) || undefined;
        const result = await listStaff({ q, limit, offset });
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("GET /api/master/staff failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  app.get(
    "/api/master/staff/:id",
    requireIapUser({ renderErrorPage }),
    async (req, res) => {
      try {
        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "id is required" });
        const s = await getStaff(id);
        if (!s) return res.status(404).json({ ok: false, error: `staff not found: ${id}` });
        res.json(s);
      } catch (error: any) {
        console.error("GET /api/master/staff/:id failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  app.post(
    "/api/master/staff",
    requireIapUser({ renderErrorPage }),
    requireAppRole({
      resourceLabel: "master:staff:write",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "1mb" }),
    async (req, res) => {
      try {
        const payload = req.body || {};
        const saved = await upsertStaff(payload);
        res.json({ ok: true, staff: saved });
      } catch (error: any) {
        console.error("POST /api/master/staff failed:", error);
        const msg = String(error?.message || error);
        const status = /必須|invalid|required/i.test(msg) ? 400 : 500;
        res.status(status).json({ ok: false, error: msg });
      }
    }
  );

  app.get("/api/master/staff/template.csv", (_req, res) => {
    const csv = getStaffSampleCsv();
    const body = "﻿" + csv;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="staff_sample.csv"');
    res.send(body);
  });

  app.post(
    "/api/master/staff/import-csv",
    requireIapUser({ renderErrorPage }),
    // Phase 22.21.36: admin ロールのみ書き込み可
    requireAppRole({
      resourceLabel: "master:staff:import",
      allowedRoles: ["admin"],
      renderErrorPage,
    }),
    express.json({ limit: "20mb" }),
    async (req, res) => {
      try {
        const csv = String(req.body?.csv || "");
        if (!csv) {
          return res.status(400).json({ ok: false, error: "csv body field is required" });
        }
        const dupMode = req.body?.duplicate_mode || "overwrite";
        if (!["overwrite", "skip", "fill_only"].includes(dupMode)) {
          return res.status(400).json({
            ok: false,
            error: "duplicate_mode must be one of: overwrite | skip | fill_only",
          });
        }
        const rows = parseStaffCsv(csv);
        const result = await importStaffRows(rows, {
          dry_run: req.body?.dry_run === true,
          duplicate_mode: dupMode,
        });

        console.log(
          JSON.stringify({
            evt: "staff_csv_import",
            dry_run: req.body?.dry_run === true,
            duplicate_mode: dupMode,
            total: result.total,
            succeeded: result.succeeded,
            failed: result.failed,
            skipped: result.skipped,
            user: (req as any).user?.email || null,
            ts: new Date().toISOString(),
          })
        );

        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("POST /api/master/staff/import-csv failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // -------------------------------------------------------------------
  // /master/contracts — Contracts master タブ (LegalOn 一括取込を内包)
  //
  // 旧 /imports/legalon と機能は同一だが、Arcs Legal OS の Master Systems
  // タブ群と一体化させたページ。旧 URL もそのまま残し、後方互換を維持。
  // -------------------------------------------------------------------
  app.get(
    "/master/contracts",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    requireScreen({ key: "contracts", renderErrorPage }),
    (req, res) => {
      try {
        res.type("html").send(masterContractsPage((req as any).userRole as Role));
      } catch (error) {
        console.error("/master/contracts failed:", error);
        res
          .status(500)
          .type("html")
          .send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

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
        // Phase 17d: 稟議モード + 候補単体結果に Backlog status を enrich
        if ((result as any)?.documentsByCategory) {
          await enrichWithBacklogStatus(result);
        }
        if (Array.isArray((result as any)?.results)) {
          for (const r of (result as any).results) {
            if (r?.documentsByCategory) await enrichWithBacklogStatus(r);
          }
        }
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
          // Phase E-2: condition_lines 優先の coverage-gated dual-read
          const lines = {
            rows: await readCapabilityLinesForInspectionDisplay(orderItemId),
          };
          context["items"] = lines.rows.map((r: any) => ({
            line_no: Number(r.line_no),
            item_name: r.item_name || "",
            spec: r.spec || "",
            unit_price: Number(r.unit_price) || 0,
            quantity: Number(r.quantity) || 0,
            amount_ex_tax: Number(r.amount_ex_tax) || 0,
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
              // Phase E-2: condition_lines 優先の coverage-gated dual-read
              const lines = {
                rows: await readCapabilityLinesForInspectionDisplay(poId),
              };
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
                `SELECT document_number, form_data FROM documents
                  WHERE issue_key = $1
                    AND template_type LIKE '%purchase_order%'
                  ORDER BY created_at DESC LIMIT 1`,
                [parentKey]
              );
              const parentPoNumber = docRow.rows[0]?.document_number || "";
              const parentPoForm = docRow.rows[0]?.form_data || {};
              const poRow = poHeader.rows[0];
              const firstLine = lines.rows[0];

              context["parent_po_issue_key"] = parentKey;
              context["parent_po_id"] = poId;
              context["parent_po_number"] = parentPoNumber;
              // 件名: 発注書フォームで入力した件名(PROJECT_TITLE)を優先。無ければ contract_title。
              context["projectTitle"] =
                parentPoForm?.PROJECT_TITLE || poRow.contract_title || "";
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
            // Phase E-2: condition_lines 優先の coverage-gated dual-read
            const conds = {
              rows: await readCapabilityFinancialRowsForDisplay(lcId),
            };
            context["financial_conditions"] = conds.rows.map((r: any) => ({
              id: Number(r.id),
              condition_no: Number(r.condition_no),
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
              payment_terms: r.payment_terms || "",
              mg_amount: r.mg_amount !== null ? Number(r.mg_amount) : 0,
            }));

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

  // Phase A (データ構造刷新): 課題詳細ページ向け — 1 課題に紐づく文書一覧。
  //   form_data は重く UI で不要なため返さない。lifecycle/採番系の列は
  //   worker initDb で追加されるため、未適用環境では 42703 フォールバックする
  //   (/api/management/assets と同じ流儀)。
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
                  -- Phase F: 文書 → condition_events → condition_line.line_code を解決
                  --   (課題詳細から「条件明細を見る」リンクに使う)。
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
        // 42703=列未追加(lifecycle_status 等) / 42P01=Phase F テーブル未作成
        //   (condition_events/condition_lines サブクエリ)。どちらの移行ウィンドウでも
        //   documents 単独の legacy 応答にフォールバックする。
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

  // -------------------------------------------------------------------
  // データ構造刷新 Phase F: 条件明細管理 UI 向け API。
  //   導出ビュー(condition_line_status_v / _balance_v / _schedule_v)+ 契約・
  //   取引先 JOIN。新スキーマ未適用環境では undefined_table(42P01)を空配列で返す。
  // -------------------------------------------------------------------
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
          `(cl.line_code ILIKE $${params.length} OR cl.subject ILIKE $${params.length})`
        );
      }
      // 重複対策(読取ガード): 既定は正本(is_primary)かつ final の契約の明細のみ返す。
      //   再発行で残る旧版(非正本/reissued)capability の condition_lines を隠し、
      //   Cockpit の重複表示を防ぐ(横断検索と同じ絞り込み)。include_history=1 で旧版も表示。
      if (String(req.query.include_history || "") !== "1") {
        where.push(`COALESCE(cc.is_primary, TRUE) = TRUE`);
        where.push(`COALESCE(cc.lifecycle_status, 'final') = 'final'`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      try {
        const result = await query(
          `SELECT cl.id, cl.line_code, cl.subject, cl.payment_scheme, cl.direction,
                  cl.rights_attribution, cl.capability_id, cl.amount_ex_tax, cl.currency,
                  cl.delivery_date, cl.term_start, cl.term_end,
                  s.status, s.consumed_amount, s.remaining_amount, s.event_count,
                  b.mg_remaining, b.ag_remaining,
                  cc.contract_title, cc.document_number AS contract_number,
                  v.vendor_name, v.vendor_code,
                  sch.has_overdue,
                  (SELECT d.document_number
                     FROM condition_events ce JOIN documents d ON d.id = ce.document_id
                    WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
                    ORDER BY ce.occurred_at DESC NULLS LAST, ce.event_no DESC
                    LIMIT 1) AS fulfilling_doc_number,
                  (SELECT COUNT(*)::int FROM condition_events ce
                    WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
                      AND ce.document_id IS NOT NULL) AS fulfilling_doc_count
             FROM condition_lines cl
             LEFT JOIN condition_line_status_v  s ON s.id = cl.id
             LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN vendors v ON v.id = cc.vendor_id
             LEFT JOIN (
               SELECT condition_line_id, bool_or(overdue AND NOT issued) AS has_overdue
                 FROM condition_line_schedule_v GROUP BY condition_line_id
             ) sch ON sch.condition_line_id = cl.id
             ${whereSql}
            ORDER BY cl.line_code NULLS LAST, cl.id`,
          params
        );
        res.json(result.rows);
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

  app.get("/api/condition-lines/:lineCode", async (req, res) => {
    try {
      const lineCode = String(req.params.lineCode || "").trim();
      if (!lineCode) return res.status(400).json({ ok: false, error: "lineCode required" });
      try {
        const main = await query(
          `SELECT cl.*, s.status, s.consumed_amount, s.remaining_amount,
                  s.event_count, s.last_event_at,
                  b.mg_consumed, b.mg_remaining, b.ag_consumed, b.ag_remaining,
                  cc.contract_title, cc.document_number AS contract_number,
                  cc.structural_role, cc.parent_capability_id,
                  cc.record_type AS contract_record_type,
                  cc.drive_url AS contract_drive_link,
                  pcc.contract_title  AS parent_contract_title,
                  pcc.document_number AS parent_contract_number,
                  pcc.record_type     AS parent_record_type,
                  pcc.drive_url       AS parent_drive_link,
                  v.vendor_name, v.vendor_code,
                  w.work_code, w.title AS work_title
             FROM condition_lines cl
             LEFT JOIN condition_line_status_v  s ON s.id = cl.id
             LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
             LEFT JOIN contract_capabilities cc ON cc.id = cl.capability_id
             LEFT JOIN contract_capabilities pcc ON pcc.id = cc.parent_capability_id
             LEFT JOIN vendors v ON v.id = cc.vendor_id
             LEFT JOIN works w ON w.id = cl.work_id
            WHERE cl.line_code = $1
            LIMIT 1`,
          [lineCode]
        );
        if (!main.rows.length) {
          return res.status(404).json({ ok: false, error: "condition_line not found" });
        }
        const line = main.rows[0];
        // 有効/取消含む全イベント + 対の文書。
        const events = await query(
          `SELECT e.id, e.event_no, e.event_type, e.occurred_at, e.period,
                  e.amount_ex_tax, e.voided_at, e.void_reason, e.backlog_issue_key,
                  e.installment_id,
                  d.document_number, d.lifecycle_status, d.drive_link, d.issue_key
             FROM condition_events e
             LEFT JOIN documents d ON d.id = e.document_id
            WHERE e.condition_line_id = $1
            ORDER BY e.occurred_at NULLS LAST, e.event_no`,
          [line.id]
        );
        // 当期スケジュール(継続型のみ)。
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

  app.get("/api/management/assets", async (req, res) => {
    try {
      // Phase 22.12: documents の base_document_number / revision / is_primary を JOIN。
      // Phase 22.21.66: contract_capabilities.contract_status / expiration_date も
      //   同時に JOIN し、Archive UI で 2 軸バッジ (★真 + 契約ステータス) を出せるように。
      //   asset_number = contract_capabilities.document_number で string match。
      // Phase 22.12.1: schema migration 未適用環境でも落ちないよう undefined_column フォールバック。
      let result: any;
      // Phase 23.1: include_history=1 で archived_draft / reissued も含める。
      //   default は documents.lifecycle_status='final' のみ。
      const includeHistory = String(req.query.include_history || "") === "1";
      try {
        result = await query(
          `SELECT ea.*,
                  d.base_document_number,
                  COALESCE(d.revision, 0) AS revision,
                  COALESCE(d.is_primary, TRUE) AS is_primary,
                  COALESCE(d.lifecycle_status, 'final') AS lifecycle_status,
                  d.superseded_by,
                  cc.contract_status,
                  cc.expiration_date  AS cc_expiration_date,
                  cc.effective_date   AS cc_effective_date
             FROM external_assets ea
             LEFT JOIN documents d
               ON d.document_number = ea.asset_number
             LEFT JOIN contract_capabilities cc
               ON cc.document_number = ea.asset_number
                  OR cc.document_number = COALESCE(d.base_document_number, ea.asset_number)
            WHERE ${
              includeHistory
                ? "TRUE"
                : "COALESCE(d.lifecycle_status, 'final') = 'final'"
            }
            ORDER BY ea.created_at DESC`
        );
      } catch (err: any) {
        if (err && err.code === "42703") {
          console.warn(
            "[/api/management/assets] schema migration 未適用 — legacy 形式で返却"
          );
          result = await query(
            "SELECT * FROM external_assets ORDER BY created_at DESC"
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
      // Phase 22.21.91: 金銭条件 (capability_financial_conditions) を
      //   JSON 集約で同梱。worker 未デプロイで テーブルが無い環境では
      //   42P01 を握り潰してフォールバック SELECT に切り替える。
      let result: any;
      try {
        result = await query(
          `SELECT cc.*, v.vendor_name,
                  v.vendor_code AS vendor_code,
                  v.entity_type AS vendor_entity_type,
                  v.bank_name AS vendor_bank_name,
                  v.branch_name AS vendor_branch_name,
                  v.account_type AS vendor_account_type,
                  v.account_number AS vendor_account_number,
                  v.account_holder_kana AS vendor_account_holder_kana,
                  v.invoice_registration_number AS vendor_invoice_registration_number,
                  v.withholding_enabled AS vendor_withholding_enabled,
                  COALESCE(
                    (
                      SELECT array_agg(rr.ringi_number ORDER BY rr.ringi_number)
                        FROM documents d
                        JOIN ringi_documents rd ON rd.document_id = d.id
                        JOIN ringi_records rr ON rr.id = rd.ringi_id
                       WHERE d.document_number = cc.document_number
                    ),
                    '{}'::text[]
                  ) AS ringi_numbers,
                  -- データ構造刷新: 契約スコープ(複数可)。UI の複数選択チェックボックスが復元に使う。
                  COALESCE(
                    (SELECT array_agg(s.scope ORDER BY s.scope)
                       FROM contract_scopes s WHERE s.capability_id = cc.id),
                    '{}'::text[]
                  ) AS scopes,
                  -- Phase E-2: 純表示(status非依存) json_agg を condition_lines 優先の
                  --   coverage-gated dual-source 化 (sharedReads と対称)。新 json_agg は
                  --   「移行済み件数 = 旧件数 かつ >0」のときだけ行を返し、でなければ NULL→
                  --   COALESCE で旧 json_agg にフォールバック。
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cl.source_condition_id,
                                 'condition_no', cl.source_seq_no,
                                 'region_language_label', cl.subject,
                                 'calc_method', cl.calc_method,
                                 'rate_pct', cl.rate_pct,
                                 'base_price_label', cl.base_price_label,
                                 'calc_period', cl.calc_period,
                                 'calc_period_kind', cl.calc_period_kind,
                                 'calc_period_close_month', cl.calc_period_close_month,
                                 'currency', cl.currency,
                                 'formula_text', cl.formula_text,
                                 'payment_terms', cl.payment_terms,
                                 'mg_amount', cl.mg_amount,
                                 'ag_amount', COALESCE(cl.ag_amount, 0)
                               )
                               ORDER BY cl.source_seq_no ASC
                             )
                        FROM condition_lines cl
                       WHERE cl.source_condition_id IN (
                               SELECT id FROM capability_financial_conditions WHERE capability_id = cc.id)
                         AND (SELECT COUNT(*) FROM condition_lines x
                               WHERE x.source_condition_id IN (
                                 SELECT id FROM capability_financial_conditions WHERE capability_id = cc.id))
                             = (SELECT COUNT(*) FROM capability_financial_conditions y WHERE y.capability_id = cc.id)
                         AND (SELECT COUNT(*) FROM capability_financial_conditions y WHERE y.capability_id = cc.id) > 0
                    ),
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cfc.id,
                                 'condition_no', cfc.condition_no,
                                 'region_language_label', cfc.region_language_label,
                                 'calc_method', cfc.calc_method,
                                 'rate_pct', cfc.rate_pct,
                                 'base_price_label', cfc.base_price_label,
                                 'calc_period', cfc.calc_period,
                                 'calc_period_kind', cfc.calc_period_kind,
                                 'calc_period_close_month', cfc.calc_period_close_month,
                                 'currency', cfc.currency,
                                 'formula_text', cfc.formula_text,
                                 'payment_terms', cfc.payment_terms,
                                 'mg_amount', cfc.mg_amount,
                                 'ag_amount', COALESCE(cfc.ag_amount, 0)
                               )
                               ORDER BY cfc.condition_no ASC
                             )
                        FROM capability_financial_conditions cfc
                       WHERE cfc.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS financial_conditions,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cl.source_line_item_id,
                                 'line_no', COALESCE(cl.source_seq_no, cl.line_no),
                                 'category', cl.category,
                                 'item_name', cl.subject,
                                 'spec', cl.spec,
                                 'calc_method', cl.calc_method,
                                 'payment_method', cl.payment_method,
                                 'payment_terms', cl.payment_terms,
                                 'quantity', cl.quantity,
                                 'unit_price', cl.unit_price,
                                 'amount_ex_tax', cl.amount_ex_tax,
                                 'delivery_date', cl.delivery_date,
                                 'payment_date', cl.payment_date,
                                 'cycle', cl.cycle,
                                 'billing_day', cl.billing_day,
                                 'term_start', cl.term_start,
                                 'term_end', cl.term_end,
                                 'fee_type', cl.fee_type
                               )
                               ORDER BY COALESCE(cl.source_seq_no, cl.line_no) ASC
                             )
                        FROM condition_lines cl
                       WHERE cl.capability_id = cc.id AND cl.source_line_item_id IS NOT NULL
                         AND (SELECT COUNT(*) FROM condition_lines x
                               WHERE x.capability_id = cc.id AND x.source_line_item_id IS NOT NULL)
                             = (SELECT COUNT(*) FROM capability_line_items y WHERE y.capability_id = cc.id)
                         AND (SELECT COUNT(*) FROM capability_line_items y WHERE y.capability_id = cc.id) > 0
                    ),
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cli.id,
                                 'line_no', cli.line_no,
                                 'category', cli.category,
                                 'item_name', cli.item_name,
                                 'spec', cli.spec,
                                 'calc_method', cli.calc_method,
                                 'payment_method', cli.payment_method,
                                 'payment_terms', cli.payment_terms,
                                 'quantity', cli.quantity,
                                 'unit_price', cli.unit_price,
                                 'amount_ex_tax', cli.amount_ex_tax,
                                 'delivery_date', cli.delivery_date,
                                 'payment_date', cli.payment_date,
                                 'cycle', cli.cycle,
                                 'billing_day', cli.billing_day,
                                 'term_start', cli.term_start,
                                 'term_end', cli.term_end,
                                 'fee_type', cli.fee_type
                               )
                               ORDER BY cli.line_no ASC
                             )
                        FROM capability_line_items cli
                       WHERE cli.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS line_items,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', ce.id,
                                 'line_no', ce.line_no,
                                 'expense_name', ce.expense_name,
                                 'spec', ce.spec,
                                 'spent_date', ce.spent_date,
                                 'amount_inc_tax', ce.amount_inc_tax,
                                 'remarks', ce.remarks
                               )
                               ORDER BY ce.line_no ASC
                             )
                        FROM capability_expenses ce
                       WHERE ce.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS expenses,
                  COALESCE(
                    (
                      SELECT json_agg(
                               json_build_object(
                                 'id', cof.id,
                                 'line_no', cof.line_no,
                                 'fee_name', cof.fee_name,
                                 'amount', cof.amount,
                                 'remarks', cof.remarks
                               )
                               ORDER BY cof.line_no ASC
                             )
                        FROM capability_other_fees cof
                       WHERE cof.capability_id = cc.id
                    ),
                    '[]'::json
                  ) AS other_fees
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON cc.vendor_id = v.id
           ORDER BY cc.id DESC`
        );
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          console.warn(
            "[/api/master/contracts] capability_financial_conditions テーブル未追加。" +
              "worker を再デプロイして migration を実行してください。フォールバックで空配列を返します。"
          );
          result = await query(
            `SELECT cc.*, v.vendor_name,
                    v.vendor_code AS vendor_code,
                    v.entity_type AS vendor_entity_type,
                    v.bank_name AS vendor_bank_name,
                    v.branch_name AS vendor_branch_name,
                    v.account_type AS vendor_account_type,
                    v.account_number AS vendor_account_number,
                    v.account_holder_kana AS vendor_account_holder_kana,
                    v.invoice_registration_number AS vendor_invoice_registration_number,
                    v.withholding_enabled AS vendor_withholding_enabled,
                    '[]'::json AS financial_conditions,
                    '[]'::json AS line_items,
                    '[]'::json AS expenses,
                    '[]'::json AS other_fees
             FROM contract_capabilities cc
             LEFT JOIN vendors v ON cc.vendor_id = v.id
             ORDER BY cc.id DESC`
          );
        } else {
          throw err;
        }
      }
      // データ構造刷新: 契約スコープ(複数可)を別クエリで付与。UI の複数選択
      //   チェックボックスの復元に使う。optional な contract_scopes を本体 SELECT に
      //   インライン化すると、未追加環境(42P01)で契約本体まで degraded fallback に
      //   巻き込まれ財務条件等が空になる。そのため独立クエリにし、テーブル不在時は
      //   scopes だけを空配列にして契約データは保持する。
      try {
        const sc = await query(
          `SELECT capability_id, array_agg(scope ORDER BY scope) AS scopes
             FROM contract_scopes GROUP BY capability_id`
        );
        const scopeMap = new Map<number, string[]>(
          sc.rows.map((r: any) => [Number(r.capability_id), r.scopes])
        );
        for (const row of result.rows) row.scopes = scopeMap.get(Number(row.id)) || [];
      } catch (scErr: any) {
        if (scErr && (scErr.code === "42P01" || scErr.code === "42703")) {
          for (const row of result.rows) row.scopes = [];
        } else {
          throw scErr;
        }
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Phase 22.21.91: 契約マスタ (contract_capabilities) の金銭条件だけを返す
  //   読み取り専用エンドポイント。利用許諾計算書フォームから master を
  //   選んだときに条件 1..3 を引いて financial_conditions[] に流し込む用途。
  //   応答 shape は /api/license-contracts/:id/financial-conditions と
  //   同じになるよう source='capability' を付与。
  app.get(
    "/api/master/contracts/:id/financial-conditions",
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "invalid id" });
        }
        // Phase E-2: condition_lines 優先の coverage-gated dual-read
        const result = {
          rows: await readCapabilityFinancialRowsForDisplay(id),
        };
        // source='capability' をつけることで、フロント側の radio handler が
        // license_financial_condition_id ではなく capability_financial_condition_id
        // を formData にセットできるようにする。
        res.json(
          result.rows.map((r: any) => ({
            ...r,
            id: Number(r.id),
            condition_no: Number(r.condition_no),
            rate_pct: r.rate_pct != null ? Number(r.rate_pct) : null,
            mg_amount: r.mg_amount != null ? Number(r.mg_amount) : 0,
            ag_amount: r.ag_amount != null ? Number(r.ag_amount) : 0,
            calc_period_close_month:
              r.calc_period_close_month != null
                ? Number(r.calc_period_close_month)
                : null,
            source: "capability",
          }))
        );
      } catch (err: any) {
        if (err && (err.code === "42P01" || err.code === "42703")) {
          // テーブル未追加 (worker 未デプロイ) なら空で返す
          return res.json([]);
        }
        console.error(
          "/api/master/contracts/:id/financial-conditions failed:",
          err
        );
        res.status(500).json({ error: String(err) });
      }
    }
  );

  // Phase 22.18: 原作 (ledgers) + 配下の素材 (materials) を 1 つの payload で返す。
  //   worker と同じ shape を出力するため、worker 未デプロイ環境では undefined_table
  //   で落ちる可能性があるが、その場合は空配列で返す (Slack 検索を巻き込まない)。
  app.get("/api/master/ledgers", async (_req, res) => {
    try {
      // Phase 22.20 / 22.21.7: default_rights_holder / default_credit_display /
      //   default_work_supplement / default_approval_target / default_approval_timing
      //   も含める。worker 未デプロイ環境で 42703 ならフォールバックを 2 段階で実行。
      let ledgers: any;
      try {
        ledgers = await query(
          `SELECT id, ledger_code, title, title_kana, alternative_titles,
                  creator_name, publisher_name, remarks, is_active,
                  default_rights_holder, default_credit_display, default_work_supplement,
                  default_approval_target, default_approval_timing, division,
                  created_at, updated_at
             FROM ledgers
            ORDER BY ledger_code DESC`
        );
      } catch (err: any) {
        if (err && err.code === "42703") {
          // Phase 22.20 列はあるが 22.21.7 列がないケース → 22.20 SELECT に fallback
          try {
            ledgers = await query(
              `SELECT id, ledger_code, title, title_kana, alternative_titles,
                      creator_name, publisher_name, remarks, is_active,
                      default_rights_holder, default_credit_display, default_work_supplement,
                      created_at, updated_at
                 FROM ledgers
                ORDER BY ledger_code DESC`
            );
          } catch (err2: any) {
            if (err2 && err2.code === "42703") {
              // legacy 環境 (Phase 22.20 列もない)
              ledgers = await query(
                `SELECT id, ledger_code, title, title_kana, alternative_titles,
                        creator_name, publisher_name, remarks, is_active,
                        created_at, updated_at
                   FROM ledgers
                  ORDER BY ledger_code DESC`
              );
            } else {
              throw err2;
            }
          }
        } else {
          throw err;
        }
      }
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
                  COALESCE(NULLIF(trim(wm.rights_holder_label), ''), mc.rights_holder_label) AS effective_rights_holder
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
    } catch (err: any) {
      if (err && (err.code === "42703" || err.code === "42P01")) {
        console.warn(
          "[/api/master/ledgers] ledgers / materials テーブル未追加。" +
            "worker サービスを再デプロイして migration を実行してください。"
        );
        res.json([]); // フォールバック空
        return;
      }
      console.error("GET /api/master/ledgers failed:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Phase 22.20-C: サブライセンシー マスター (read mirror)
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
    } catch (err: any) {
      if (err && (err.code === "42703" || err.code === "42P01")) {
        console.warn(
          "[/api/master/sublicensees] テーブル未追加。worker サービスを再デプロイしてください。"
        );
        res.json([]);
        return;
      }
      console.error("GET /api/master/sublicensees failed:", err);
      res.status(500).json({ error: String(err) });
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

  // -----------------------------------------------------------------
  // Phase 23.0 — 統一検索API (v2)。
  //   GET /api/contracts/search — フォームの親 picker 用 (record_types フィルタ)
  //   GET /api/contracts/:id    — 詳細 (line_items, financial_conditions,
  //                                expenses, other_fees, vendor, 検収集計)
  //
  //   Phase 23.1 で /api/order-items/* および /api/license-contracts/*
  //   の read-only mirror endpoints (list / by-issue / availability /
  //   royalty-history) は物理削除済み。新規実装は /api/contracts/* を使うこと。
  //   form-context など server 内部の SELECT 参照は Phase 23.6.2 で別途整理。
  // -----------------------------------------------------------------
  registerContractsV2(app, { query, requirePortalSecret });
  // 関連当事者取引(RPT)の読取 (/api/rpt/*)。書込は worker /rpt/*。
  registerRelatedPartyReads(app, { query, requirePortalSecret });
  // 新スキーマ(work-centric)read/write API。/api/v3/*。
  //   B3: 書込は IAP + admin ロール必須(D1: Search がマスター/新プラットフォーム所有)。
  registerWorkModelRoutes(app, {
    query,
    requireWrite: [
      requireIapUser({ renderErrorPage }),
      requireAppRole({ resourceLabel: "v3:write", allowedRoles: ["admin"], renderErrorPage }),
    ],
    // B1: read は IAP 認証で固める(全社参照だが要ログイン)。
    requireRead: [requireIapUser({ renderErrorPage })],
  });

  // B1: 作品中心モデルの閲覧ページ(Search 専用フロント)。/api/v3 を同一オリジンで読む。
  app.get("/work-model", requireIapUser({ renderErrorPage }), attachAppRole(), requireScreen({ key: "work-model", renderErrorPage }), (req, res) => {
    try {
      // 統合: admin-ui の作品モデル(React)を iframe で埋め込む(ADMIN_UI_URL 未設定なら旧コンソール)
      res.type("html").send(workModelEmbedPage((req as any).userRole as Role));
    } catch (error) {
      console.error("/work-model failed:", error);
      res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
    }
  });

  // 条件明細(capability_line_items)の横断一覧・検索ページ。
  app.get("/master/conditions", requireIapUser({ renderErrorPage }), attachAppRole(), requireScreen({ key: "conditions", renderErrorPage }), (req, res) => {
    try {
      res.type("html").send(conditionsPage((req as any).userRole as Role));
    } catch (error) {
      console.error("/master/conditions failed:", error);
      res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
    }
  });

  // 条件明細(閲覧専用)。VIEW 側に公開しつつ、部署コード FIN(+admin)のみ閲覧可。
  //   編集(紐付け)は無効化し、検索・CSV のみ。
  app.get(
    "/view/conditions",
    requireIapUser({ renderErrorPage }),
    requireAdminOrDepartment({ departments: ["FIN"], renderErrorPage }),
    async (req, res) => {
      try {
        const role = (req as any).userRole as Role;
        const deptCode = await resolveDepartmentCode(req);
        res
          .type("html")
          .send(
            conditionsPage(role, {
              active: "conditions-fin",
              deptCode,
              canEdit: false,
            })
          );
      } catch (error) {
        console.error("/view/conditions failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // GET /api/conditions/search — 条件明細の検索 (支払日/納期/種類/取引先/担当/キーワード)
  //   admin または FIN 部署のみ(VIEW 側の閲覧専用ビューと整合)。
  app.get("/api/conditions/search", requireIapUser({ renderErrorPage }), requireAdminOrDepartment({ departments: ["FIN"], renderErrorPage }), async (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const result = await listConditions({
        payment_from: q.payment_from,
        payment_to: q.payment_to,
        delivery_from: q.delivery_from,
        delivery_to: q.delivery_to,
        category: q.category,
        vendor: q.vendor,
        owner: q.owner,
        q: q.q,
        include_all: q.include_all === "1" || q.include_all === "true",
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      console.error("/api/conditions/search failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // PUT /api/conditions/:id/links — 明細行の 原作/作品/マスター契約 紐付けを更新
  //   書き込みは admin 専用(FIN viewer の閲覧専用ビューからは編集不可)。
  app.put(
    "/api/conditions/:id/links",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    requireScreen({ key: "conditions", renderErrorPage }),
    express.json(),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ ok: false, error: "invalid id" });
        }
        const b = req.body || {};
        const toIdOrNull = (v: any) =>
          v == null || v === "" ? null : Number(v);
        await updateConditionLinks(id, {
          source_ip_id: toIdOrNull(b.source_ip_id),
          work_id: toIdOrNull(b.work_id),
          master_contract_id: toIdOrNull(b.master_contract_id),
          ringi_id: toIdOrNull(b.ringi_id),
          status_flags:
            b.status_flags && typeof b.status_flags === "object" ? b.status_flags : null,
          is_inbound: typeof b.is_inbound === "boolean" ? b.is_inbound : null,
          flow_direction: b.flow_direction === undefined ? undefined : (b.flow_direction || ""),
        });
        res.json({ ok: true });
      } catch (error: any) {
        console.error("/api/conditions/:id/links failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // POST /api/conditions/auto-link — 原作/作品/基本契約/稟議 を自動推定して紐付け。
  //   admin 専用(書込)。body: { ids?:number[], dryRun?:boolean(既定true), overwrite?:boolean }
  //   dryRun=true は提案のみ(書込なし)。既定は空欄のみ補完(手動設定を温存)。
  app.post(
    "/api/conditions/auto-link",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    requireScreen({ key: "conditions", renderErrorPage }),
    express.json(),
    async (req, res) => {
      try {
        const b = req.body || {};
        const ids = Array.isArray(b.ids)
          ? b.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
          : undefined;
        const result = await autoLinkConditions({
          ids,
          overwrite: b.overwrite === true,
          dryRun: b.dryRun !== false,
        });
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("/api/conditions/auto-link failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // POST /api/conditions/auto-status — 状態フラグを実データから自動判定(完全同期)。
  //   admin 専用。body: { ids?:number[], dryRun?:boolean(既定true) }
  //   po_signed=締結済 / inspection_issued=検収満額 / payment_exported=Excel出力済。
  app.post(
    "/api/conditions/auto-status",
    requireIapUser({ renderErrorPage }),
    attachAppRole(),
    requireScreen({ key: "conditions", renderErrorPage }),
    express.json(),
    async (req, res) => {
      try {
        const b = req.body || {};
        const ids = Array.isArray(b.ids)
          ? b.ids.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
          : undefined;
        const result = await autoStatusConditions({ ids, dryRun: b.dryRun !== false });
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("/api/conditions/auto-status failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // GET /api/conditions/ringi-options — 稟議ピッカー用一覧
  app.get(
    "/api/conditions/ringi-options",
    requireIapUser({ renderErrorPage }),
    async (_req, res) => {
      try {
        res.json(await listRingiOptions());
      } catch (error: any) {
        console.error("/api/conditions/ringi-options failed:", error);
        res.status(500).json({ ok: false, error: String(error?.message || error) });
      }
    }
  );

  // GET /api/conditions/export — 条件明細を CSV 出力(全件 or ?ids=1,2,3 の選択)
  //   admin または FIN 部署のみ。
  app.get("/api/conditions/export", requireIapUser({ renderErrorPage }), requireAdminOrDepartment({ departments: ["FIN"], renderErrorPage }), async (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const ids = q.ids
        ? String(q.ids).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
        : undefined;
      const csv = await exportConditionsCsv({
        payment_from: q.payment_from,
        payment_to: q.payment_to,
        delivery_from: q.delivery_from,
        delivery_to: q.delivery_to,
        category: q.category,
        vendor: q.vendor,
        owner: q.owner,
        q: q.q,
        ids,
        include_all: q.include_all === "1" || q.include_all === "true",
      });
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="conditions_${stamp}.csv"`
      );
      res.send(csv);
    } catch (error: any) {
      console.error("/api/conditions/export failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // ── 分配構造マップ(作品中心)──────────────────────────────────
  app.get("/master/receivable-map", requireIapUser({ renderErrorPage }), attachAppRole(), requireScreen({ key: "receivable-map", renderErrorPage }), (req, res) => {
    try {
      res.type("html").send(receivableMapPage((req as any).userRole as Role));
    } catch (error) {
      console.error("/master/receivable-map failed:", error);
      res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
    }
  });
  app.get("/api/receivable-map/works", requireIapUser({ renderErrorPage }), async (_req, res) => {
    try {
      res.json({ ok: true, rows: await listMappableWorks() });
    } catch (error: any) {
      console.error("/api/receivable-map/works failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });
  app.get("/api/receivable-map", requireIapUser({ renderErrorPage }), async (req, res) => {
    try {
      const workId = Number((req.query as any).work);
      if (!Number.isFinite(workId)) return res.status(400).json({ ok: false, error: "work required" });
      res.json({ ok: true, ...(await getWorkDistribution(workId)) });
    } catch (error: any) {
      console.error("/api/receivable-map failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });
  // 派生系譜(多段)マップ
  app.get("/api/receivable-map/lineage", requireIapUser({ renderErrorPage }), async (req, res) => {
    try {
      const workId = Number((req.query as any).work);
      if (!Number.isFinite(workId)) return res.status(400).json({ ok: false, error: "work required" });
      res.json({ ok: true, ...(await getWorkLineage(workId)) });
    } catch (error: any) {
      console.error("/api/receivable-map/lineage failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });
  // タイトル(他社/改題)→作品 解決(利用報告の名寄せ)
  app.get("/api/receivable-map/resolve", requireIapUser({ renderErrorPage }), async (req, res) => {
    try {
      res.json({ ok: true, rows: await resolveWorksByTitle(String((req.query as any).q || "")) });
    } catch (error: any) {
      console.error("/api/receivable-map/resolve failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });
  // 作品タイトル別名(名寄せ)CRUD
  app.get("/api/works/:id/aliases", requireIapUser({ renderErrorPage }), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      res.json({ ok: true, rows: await listWorkAliases(id) });
    } catch (error: any) {
      console.error("/api/works/:id/aliases GET failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });
  app.post("/api/works/:id/aliases", requireIapUser({ renderErrorPage }), express.json(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      if (!Number.isFinite(id) || !b.alias_title) return res.status(400).json({ ok: false, error: "id and alias_title required" });
      const aliasId = await addWorkAlias(id, String(b.alias_title), b.party_vendor_id, b.context);
      res.json({ ok: true, id: aliasId });
    } catch (error: any) {
      console.error("/api/works/:id/aliases POST failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });
  app.delete("/api/work-aliases/:id", requireIapUser({ renderErrorPage }), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "invalid id" });
      await deleteWorkAlias(id);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("/api/work-aliases/:id DELETE failed:", error);
      res.status(500).json({ ok: false, error: String(error?.message || error) });
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

  // ===================================================================
  // 法務ポータル(GAS 移植・DB 化)
  //   viewer 可: /portal /guide /c/:cat /g/:key /exec(browse)
  //   admin   : /admin/guides /api/portal/*(console)
  //   各ガイド本文(/g/:key)は DB の現行版を portalRender で変換して配信。
  //   差し替え(版追加・公開切替)は worker(release/worker)が所有(pass2)。
  // ===================================================================

  // ポータルトップ(カテゴリ一覧 + 入口)
  app.get(
    "/portal",
    requireIapUser({ renderErrorPage }),
    requireScreen({ key: "guide-portal", renderErrorPage }),
    async (req, res) => {
      try {
        const [cats, guides] = await Promise.all([
          listGuideCategories(),
          listPortalGuides(),
        ]);
        const countByCat: Record<string, number> = {};
        for (const g of guides) {
          if (g.isOverview || !g.categoryKey) continue;
          countByCat[g.categoryKey] = (countByCat[g.categoryKey] || 0) + 1;
        }
        const isAdmin = (req as any).userRole === "admin";
        res.type("html").send(renderPortalPage(cats, countByCat, isAdmin));
      } catch (error) {
        console.error("/portal failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // ご利用案内(overview)
  app.get(
    "/guide",
    requireIapUser({ renderErrorPage }),
    requireScreen({ key: "guide-portal", renderErrorPage }),
    async (req, res) => {
      try {
        const html = await renderPortalGuideHtml("guide");
        if (html) return res.type("html").send(html);
        const g = await getPortalGuideByKey("guide");
        if (!g) return res.status(404).type("html").send(guideNotFoundPage());
        const isAdmin = (req as any).userRole === "admin";
        return res.status(404).type("html").send(renderNotReadyPage(g, null, isAdmin));
      } catch (error) {
        console.error("/guide failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // カテゴリページ
  app.get(
    "/c/:cat",
    requireIapUser({ renderErrorPage }),
    requireScreen({ key: "guide-portal", renderErrorPage }),
    async (req, res) => {
      try {
        const cats = await listGuideCategories();
        const cat = cats.find((c) => c.catKey === req.params.cat);
        if (!cat) return res.status(404).type("html").send(guideNotFoundPage());
        const guides = await guidesInGuideCategory(cat.catKey);
        const isAdmin = (req as any).userRole === "admin";
        res.type("html").send(renderCategoryPage(cat, guides, isAdmin));
      } catch (error) {
        console.error("/c/:cat failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // 各ガイド(本文)
  app.get(
    "/g/:key",
    requireIapUser({ renderErrorPage }),
    requireScreen({ key: "guide-portal", renderErrorPage }),
    async (req, res) => {
      try {
        const key = String(req.params.key);
        const html = await renderPortalGuideHtml(key);
        if (html) return res.type("html").send(html);
        const g = await getPortalGuideByKey(key);
        if (!g) return res.status(404).type("html").send(guideNotFoundPage());
        if (g.linkPath) return res.redirect(302, g.linkPath); // リンク型ガイド(検索等)
        const cats = await listGuideCategories();
        const cat = cats.find((c) => c.catKey === g.categoryKey) || null;
        const isAdmin = (req as any).userRole === "admin";
        return res.status(404).type("html").send(renderNotReadyPage(g, cat, isAdmin));
      } catch (error) {
        console.error("/g/:key failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // 旧 GAS 互換: /exec?page=KEY → /g/KEY(page=portal/未指定は /portal)
  app.get("/exec", (req, res) => {
    const key = String(req.query.page || "").trim();
    if (!key || key === "portal") return res.redirect(302, "/portal");
    return res.redirect(302, `/g/${encodeURIComponent(key)}`);
  });

  // 管理: ガイド一覧(read)。差し替えは pass2(worker)で本画面を編集可能化。
  app.get(
    "/admin/guides",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "admin:guides", allowedRoles: ["admin"], renderErrorPage }),
    async (_req, res) => {
      try {
        const [rows, categories] = await Promise.all([
          listPortalGuidesForAdmin(),
          listGuideCategories(),
        ]);
        res.type("html").send(adminGuidesPage({ rows, categories }));
      } catch (error) {
        console.error("/admin/guides failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // 管理読取 API(将来の編集 UI / admin-ui 連携用)
  app.get(
    "/api/portal/categories",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "api:portal:categories", allowedRoles: ["admin"], renderErrorPage }),
    async (_req, res) => {
      try {
        res.json(await listGuideCategories());
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );
  app.get(
    "/api/portal/guides",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "api:portal:guides", allowedRoles: ["admin"], renderErrorPage }),
    async (_req, res) => {
      try {
        res.json(await listPortalGuidesForAdmin());
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  // ガイドのメタ更新(admin): カテゴリ付け替え・並び順。
  app.patch(
    "/api/portal/guides/:key",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "api:portal:guides:update", allowedRoles: ["admin"], renderErrorPage }),
    express.json(),
    async (req, res) => {
      try {
        await updatePortalGuide(String(req.params.key), req.body || {});
        res.json({ ok: true });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || String(error) });
      }
    }
  );

  // 管理: カテゴリ管理ページ(admin)
  app.get(
    "/admin/guides/categories",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "admin:guide-categories", allowedRoles: ["admin"], renderErrorPage }),
    async (_req, res) => {
      try {
        const categories = await listPortalCategoriesForAdmin();
        res.type("html").send(adminCategoriesPage({ categories }));
      } catch (error) {
        console.error("/admin/guides/categories failed:", error);
        res.status(500).type("html").send(renderErrorPage("Server Error", String(error), 500));
      }
    }
  );

  // カテゴリ 書込 API(admin)。search-api 内で直接 DB 書込(vendor 取込等と同様)。
  app.post(
    "/api/portal/categories",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "api:portal:categories:create", allowedRoles: ["admin"], renderErrorPage }),
    express.json(),
    async (req, res) => {
      try {
        await createPortalCategory(req.body || {});
        res.json({ ok: true });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || String(error) });
      }
    }
  );
  app.patch(
    "/api/portal/categories/:catKey",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "api:portal:categories:update", allowedRoles: ["admin"], renderErrorPage }),
    express.json(),
    async (req, res) => {
      try {
        await updatePortalCategory(String(req.params.catKey), req.body || {});
        res.json({ ok: true });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || String(error) });
      }
    }
  );
  app.delete(
    "/api/portal/categories/:catKey",
    requireIapUser({ renderErrorPage }),
    requireAppRole({ resourceLabel: "api:portal:categories:delete", allowedRoles: ["admin"], renderErrorPage }),
    async (req, res) => {
      try {
        await deletePortalCategory(String(req.params.catKey));
        res.json({ ok: true });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || String(error) });
      }
    }
  );

  app.listen(PORT, () => {
    console.log(`[search-api] listening on :${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal error starting search-api:", err);
  process.exit(1);
});
