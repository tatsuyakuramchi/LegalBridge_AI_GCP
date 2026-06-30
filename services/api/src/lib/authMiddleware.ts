/**
 * /search/* HTML ルート用の認可ミドルウェア (Phase 17s)
 *
 * 2 層構造:
 *   - IAP (defense in depth, optional): x-goog-iap-jwt-assertion を再検証
 *   - HMAC 短期署名: ?exp=&sig= を verify
 *
 * 移行期間中は legacy `?token=<LB_PORTAL_SECRET>` / `X-LB-Portal-Secret`
 * ヘッダも受け入れる (dual-accept)。legacy 経由のアクセスには warn ログを
 * 出して deprecation を可視化。
 *
 * 設計方針:
 *   - 認可失敗は HTTP 401 + シンプルな HTML エラーページで返す
 *   - 監査ログは 1 行 JSON で console.log (Cloud Logging で構造化検索)
 *   - 各ルートが自身の resourceId をミドルウェア生成時に渡す
 *     例: requireSignedUrl((req) => `vendor:${req.params.vendorId}`)
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verify as verifySig, hasSigningSecret } from "./signedUrl.ts";
import { verifyIap, isIapEnforced } from "./iap.ts";
import { query } from "./db.ts";
// 外部アドレス許可リスト(DB, 管理画面で編集)。env LB_ROLE_ALLOWLIST_EMAILS と併用。
import { isEmailAllowlisted } from "../services/accessAllowlistService.ts";
import type { Role, ScreenKey } from "./screens.ts";
import { screenByKey, roleAtLeast } from "./screens.ts";

type ResourceIdGetter = (req: Request) => string;

/**
 * `req.user` に乗せる正規化済みアイデンティティ (Phase 17z-2)。
 *
 * source の意味:
 *   - "iap_jwt"       : x-goog-iap-jwt-assertion を verify した結果 (最も信頼)
 *   - "iap_header"    : x-goog-authenticated-user-email (IAP が前段にいる前提)
 *   - "portal_secret" : LB_PORTAL_SECRET 一致 (admin-ui からの直接呼び出し用、Phase 22 で追加)
 *   - "dev_env"       : DEV_AS_USER (ローカル開発専用)
 *   - "anonymous"     : 認証なしで通過 (IAP_ENFORCE=false のとき)
 */
export type ReqUser = {
  email: string | null;
  source: "iap_jwt" | "iap_header" | "portal_secret" | "dev_env" | "anonymous";
};

interface Options {
  /** リソース ID をどう組み立てるか (例: req → "vendor:123") */
  resourceId: ResourceIdGetter;
  /** 認可失敗時の HTML レンダラー (server.ts 側の renderErrorPage を渡す) */
  renderErrorPage?: (title: string, message: string, status: number) => string;
}

/**
 * 構造化監査ログ。Cloud Logging で `evt:"search_access"` で絞り込み可能。
 */
function logAccess(
  req: Request,
  outcome: "allow_signed" | "allow_legacy_token" | "deny",
  extra: Record<string, any> = {}
): void {
  try {
    const line = {
      evt: "search_access",
      outcome,
      method: req.method,
      path: req.path,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
      ua: req.header("user-agent") || null,
      iapEmail: req.header("x-goog-authenticated-user-email") || null,
      ts: new Date().toISOString(),
      ...extra,
    };
    console.log(JSON.stringify(line));
  } catch {
    /* logging must never throw */
  }
}

function checkLegacyToken(req: Request): boolean {
  const expected = process.env.LB_PORTAL_SECRET;
  if (!expected) return false;
  const header = req.headers["x-lb-portal-secret"];
  const token = req.query.token;
  return header === expected || token === expected;
}

function defaultErrorHtml(title: string, message: string, _status: number): string {
  // 最小限のフォールバック。server.ts が renderErrorPage を渡してきたら
  // そちらを優先する (見た目を統一)。
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;padding:40px;max-width:600px;margin:0 auto;color:#111}
h1{font-size:18px;border-left:4px solid #c00;padding-left:8px}
p{color:#444;line-height:1.6}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`;
}

/**
 * `/search/*` 用のミドルウェアを生成する。
 *
 * @param opts.resourceId       URL の path から resourceId を組み立てる関数
 * @param opts.renderErrorPage  401 時の HTML レンダラー (任意)
 */
export function requireSignedUrl(opts: Options): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;

  return async (req: Request, res: Response, next: NextFunction) => {
    // ─── 0. IAP 検証 (best-effort, IAP_ENFORCE=true なら必須) ──────
    if (isIapEnforced()) {
      const iap = await verifyIap(req);
      if (iap.ok === false) {
        logAccess(req, "deny", { layer: "iap", reason: iap.reason });
        return res
          .status(401)
          .type("html")
          .send(
            renderErr(
              "Unauthorized",
              "IAP 認証に失敗しました。社内アカウントで再ログインしてください。",
              401
            )
          );
      }
      // payload の email は監査ログで使う
      (req as any).iapEmail = iap.email || null;
    }

    // ─── 1. HMAC 署名検証 (主経路) ────────────────────────────────
    let resourceId = "";
    try {
      resourceId = opts.resourceId(req);
    } catch {
      resourceId = "";
    }

    if (resourceId && hasSigningSecret()) {
      const result = verifySig(
        resourceId,
        req.query.exp as any,
        req.query.sig as any
      );
      if (result.ok) {
        logAccess(req, "allow_signed", { resourceId });
        return next();
      }
      // 失敗時はまだ legacy フォールバックを試す (移行期)。
      // ただし reason は監査用に控える。
      (req as any).__sigDenyReason = result.reason;
    }

    // ─── 2. Legacy token フォールバック (Phase 17s 移行期間用) ────
    if (checkLegacyToken(req)) {
      logAccess(req, "allow_legacy_token", {
        resourceId,
        deprecated: true,
        sigDenyReason: (req as any).__sigDenyReason || null,
      });
      console.warn(
        `[auth] LEGACY token used for ${req.path}. Migrate caller to HMAC signed URL.`
      );
      return next();
    }

    // ─── 3. 全て不可 → 401 ────────────────────────────────────────
    logAccess(req, "deny", {
      resourceId,
      sigDenyReason: (req as any).__sigDenyReason || "missing",
      hasSigningSecret: hasSigningSecret(),
      hasLegacySecret: !!process.env.LB_PORTAL_SECRET,
    });
    return res
      .status(401)
      .type("html")
      .send(
        renderErr(
          "Unauthorized",
          "アクセス URL が無効か期限切れです。Slack /法務検索 から再度開いてください。",
          401
        )
      );
  };
}

// ====================================================================
// Phase 25: 署名URL OR IAP ログイン の二系統許可
//
//   /search/* は元々 Slack ディープリンク用に HMAC 署名URL必須だったが、
//   admin-ui のサイドバーから「検索」をログインユーザーが直接踏めるよう、
//   IAP 認証済みユーザー(Workspace ログイン)も許可する。
//     - 署名URL有効 (Slack 経由)        → 通過 (従来どおり)
//     - legacy token                    → 通過
//     - IAP / dev / portal_secret 本人  → 通過 (サイドバー経由)
//     - IAP 非強制環境では anonymous     → 通過
//     - いずれも無し                    → 401
//   req.user を必ずセットするので、後段に attachAppRole を繋げてサイドバーを
//   役割で出し分けられる。
// ====================================================================
export function requireSignedUrlOrIap(opts: Options): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;

  return async (req: Request, res: Response, next: NextFunction) => {
    // 1) 署名URL (Slack ディープリンク主経路)
    let resourceId = "";
    try {
      resourceId = opts.resourceId(req);
    } catch {
      resourceId = "";
    }
    if (resourceId && hasSigningSecret()) {
      const r = verifySig(resourceId, req.query.exp as any, req.query.sig as any);
      if (r.ok) {
        (req as any).user = { email: null, source: "anonymous" } as ReqUser;
        logAccess(req, "allow_signed", { resourceId, via: "signed" });
        return next();
      }
    }

    // 2) legacy token
    if (checkLegacyToken(req)) {
      (req as any).user = { email: null, source: "portal_secret" } as ReqUser;
      logAccess(req, "allow_legacy_token", { resourceId, deprecated: true });
      return next();
    }

    // 3) IAP 本人 (サイドバー経由のログインユーザー)
    try {
      const iap = await verifyIap(req);
      if (iap.ok) {
        (req as any).user = { email: iap.email || null, source: "iap_jwt" } as ReqUser;
        logAccess(req, "allow_signed", { resourceId, via: "iap_jwt" });
        return next();
      }
    } catch {
      /* fall through */
    }
    const emailHdr = req.header("x-goog-authenticated-user-email") || "";
    const m = emailHdr.match(/^accounts\.google\.com:(.+)$/);
    if (m && m[1]) {
      (req as any).user = { email: m[1], source: "iap_header" } as ReqUser;
      logAccess(req, "allow_signed", { resourceId, via: "iap_header" });
      return next();
    }
    if (process.env.DEV_AS_USER) {
      (req as any).user = {
        email: process.env.DEV_AS_USER,
        source: "dev_env",
      } as ReqUser;
      return next();
    }

    // 4) IAP 非強制 → anonymous で通過
    if (!isIapEnforced()) {
      (req as any).user = { email: null, source: "anonymous" } as ReqUser;
      return next();
    }

    // 5) 全て不可 → 401
    logAccess(req, "deny", { resourceId, layer: "signed_or_iap" });
    return res
      .status(401)
      .type("html")
      .send(
        renderErr(
          "Unauthorized",
          "アクセス URL が無効か期限切れです。Workspace でログインするか、" +
            "Slack /法務検索 から再度開いてください。",
          401
        )
      );
  };
}

// ====================================================================
//
// 目的:
//   - HMAC 短期 URL の代わりに「IAP 認証ユーザー == 社内 Workspace 本人」を
//     アプリ側でも安価に取り出せるようにする
//   - /master/vendors のような検索系ページは IAP のみで「恒久 URL」化
//   - /imports/legalon のような書き込み系は staff_master の部署照会で
//     役割制御の土台を作る (現段階では soft mode、後で enforce ON)
// ====================================================================

/**
 * IAP が injection した本人情報を req.user に attach するミドルウェア。
 *
 * 多層検証:
 *   1. x-goog-iap-jwt-assertion (Google 署名済み JWT) を OAuth2Client で verify
 *   2. 失敗 / 未設定なら x-goog-authenticated-user-email ヘッダで補完
 *      (これは IAP が必ずセットするが署名はない。LB 経由前提でのみ信頼)
 *   3. ローカル開発用に DEV_AS_USER env を見る
 *   4. すべて駄目 & IAP_ENFORCE=true → 401。そうでなければ anonymous で通過。
 *
 * 上位 (server.ts) では `(req as any).user.email` で参照する想定。
 */
export function requireIapUser(opts: {
  renderErrorPage?: (title: string, message: string, status: number) => string;
} = {}): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;

  return async (req: Request, res: Response, next: NextFunction) => {
    // 0) LB_PORTAL_SECRET fallback (Phase 22 で追加):
    //    admin-ui のような別 Cloud Run サービスから search-api を直接 *.run.app
    //    URL で叩く経路は IAP を通らないため、共有シークレット (= 既存の
    //    LB_PORTAL_SECRET) を持っていれば素通しする。
    //    X-LB-PORTAL-SECRET ヘッダ or ?token= の query で受け取り、
    //    timing-safe で比較。req.user.source は "portal_secret"。
    if (checkLegacyToken(req)) {
      (req as any).user = {
        email: null,
        source: "portal_secret",
      } as ReqUser;
      logAccess(req, "allow_legacy_token", { layer: "iap_user" });
      return next();
    }

    // 1) Try IAP JWT
    try {
      const result = await verifyIap(req);
      if (result.ok) {
        (req as any).user = {
          email: result.email || null,
          source: "iap_jwt",
        } as ReqUser;
        return next();
      }
    } catch {
      /* fall through */
    }

    // 2) Fallback to IAP header (unsigned, but trustworthy when behind LB)
    const emailHdr = req.header("x-goog-authenticated-user-email") || "";
    const m = emailHdr.match(/^accounts\.google\.com:(.+)$/);
    if (m && m[1]) {
      (req as any).user = { email: m[1], source: "iap_header" } as ReqUser;
      return next();
    }

    // 3) Dev override
    if (process.env.DEV_AS_USER) {
      (req as any).user = {
        email: process.env.DEV_AS_USER,
        source: "dev_env",
      } as ReqUser;
      return next();
    }

    // 4) IAP not enforced → allow anonymous
    if (!isIapEnforced()) {
      (req as any).user = { email: null, source: "anonymous" } as ReqUser;
      return next();
    }

    // 5) IAP enforced and we have no identity → reject
    logAccess(req, "deny", { layer: "iap_user", reason: "no_identity" });
    return res
      .status(401)
      .type("html")
      .send(
        renderErr(
          "Unauthorized",
          "ログイン情報を確認できませんでした。Workspace アカウントで再ログインしてください。",
          401
        )
      );
  };
}

/**
 * 役割ベース認可 middleware factory (Phase 17z-2)。
 *
 * staff テーブルを email で引いて department を確認する。許可リスト:
 *   - allowedEmails       : 明示メールアドレス allowlist (staff 未登録でも通す)
 *   - allowedDepartments  : staff.department が含まれていれば通す
 *
 * 動作モード (env で切替):
 *   - LB_ROLE_ENFORCE=true  : 不適合は 403
 *   - LB_ROLE_ENFORCE!=true : warn ログのみで通過 (= soft mode, デフォルト)
 *
 * soft mode は staff_master を埋めながら段階的に厳格化する移行期向け。
 * Cloud Logging で `evt:"search_access" outcome:"allow_role_soft"` を
 * monitor すれば「もし enforce にしたら deny になる」アクセスが見える。
 */
export function requireDepartmentRole(opts: {
  resourceLabel: string;
  allowedEmails?: string[];
  allowedDepartments?: string[];
  renderErrorPage?: (title: string, message: string, status: number) => string;
}): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;
  const allowedEmails = (opts.allowedEmails || []).map((e) =>
    e.trim().toLowerCase()
  );
  const allowedDepartments = (opts.allowedDepartments || []).map((d) =>
    d.trim()
  );

  return async (req: Request, res: Response, next: NextFunction) => {
    const enforce =
      String(process.env.LB_ROLE_ENFORCE || "").toLowerCase() === "true";

    const user: ReqUser | undefined = (req as any).user;
    const email = (user?.email || "").trim().toLowerCase();

    // 0) Portal-secret 経由 (admin-ui の内部呼び出し) は部署ロール審査を
    //    スキップして通過させる。requireAppRole と同じ扱い。admin-ui は
    //    portal_secret で email を持たないため、ここで通さないと取引先保存等が
    //    LB_ROLE_ENFORCE=true 環境で 403 になる (Phase 25.1)。
    if (user?.source === "portal_secret") {
      logAccess(req, "allow_signed", {
        layer: "role",
        resource: opts.resourceLabel,
        reason: "portal_secret",
      });
      return next();
    }

    // 1) Explicit email allowlist (opts / env / DB)。
    //    DB(portal_access_allowlist)は管理画面 /admin/access で編集、TTLキャッシュ参照。
    const envEmails = (process.env.LB_ROLE_ALLOWLIST_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (
      email &&
      (allowedEmails.includes(email) ||
        envEmails.includes(email) ||
        (await isEmailAllowlisted(email)))
    ) {
      logAccess(req, "allow_signed", {
        layer: "role",
        resource: opts.resourceLabel,
        reason: "email_allowlist",
        email,
      });
      return next();
    }

    // 2) Lookup staff.department
    let dept: string | null = null;
    if (email) {
      try {
        const r = await query(
          "SELECT department FROM staff WHERE LOWER(email) = $1 LIMIT 1",
          [email]
        );
        dept = (r.rows[0]?.department as string) || null;
      } catch (err) {
        console.warn(
          `[role] staff lookup failed for ${email} on ${opts.resourceLabel}:`,
          err
        );
      }
    }

    const envDepartments = (process.env.LB_ROLE_ALLOWLIST_DEPARTMENTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const deptAllowed = !!(
      dept &&
      (allowedDepartments.includes(dept) || envDepartments.includes(dept))
    );

    if (deptAllowed) {
      logAccess(req, "allow_signed", {
        layer: "role",
        resource: opts.resourceLabel,
        reason: "dept_allowlist",
        email,
        dept,
      });
      return next();
    }

    // 3) Not allowed
    if (enforce) {
      logAccess(req, "deny", {
        layer: "role",
        resource: opts.resourceLabel,
        email,
        dept,
      });
      const wantsJson = (req.headers.accept || "").includes("application/json");
      if (wantsJson) {
        return res
          .status(403)
          .json({ ok: false, error: "Forbidden (role)" });
      }
      return res
        .status(403)
        .type("html")
        .send(
          renderErr(
            "Forbidden",
            // Phase 22.21.39: \n -> <br> 変換に対応
            "この機能は権限が付与されたユーザーのみ利用できます。\n" +
              "部署マスター (staff) で部署を「経営管理本部」「法務」などの" +
              "許可対象に登録してから再度お試しください。\n" +
              "\n" +
              `email: ${email || "(unknown)"}    dept: ${
                dept || "(unregistered)"
              }`,
            403
          )
        );
    }

    // soft mode: warn + allow (collecting telemetry phase)
    console.warn(
      `[role] SOFT-DENY ${opts.resourceLabel} email=${email || "?"} dept=${
        dept || "?"
      } — would be 403 when LB_ROLE_ENFORCE=true`
    );
    logAccess(req, "allow_signed", {
      layer: "role",
      resource: opts.resourceLabel,
      reason: "soft_mode",
      email,
      dept,
    });
    return next();
  };
}

/**
 * Phase 22.21.36: アプリ内ロール (staff.app_role) ベースの認可ミドルウェア。
 *
 *   - requireIapUser の後段で使う前提 (req.user.email 必須)
 *   - staff.app_role を引いて allowedRoles に含まれていれば next、
 *     そうでなければ 403。
 *   - 明示的に LB_APP_ADMIN_EMAILS env (カンマ区切り) に列挙された人は
 *     DB を引かず無条件に admin 扱い (= bootstrap / 緊急時のための bypass)。
 *   - portal_secret ソース (admin-ui からの内部呼び出し) も無条件通過。
 *
 *   使い方:
 *     requireAppRole({
 *       resourceLabel: "admin:dashboard",
 *       allowedRoles: ["admin"],
 *       renderErrorPage,
 *     })
 *
 *   応答:
 *     - HTML routes: renderErrorPage で 403 ページ
 *     - API routes:  JSON { ok:false, error: "forbidden" }
 */
export function requireAppRole(opts: {
  resourceLabel: string;
  allowedRoles: string[]; // 例: ["admin"]
  renderErrorPage?: (title: string, message: string, status: number) => string;
}): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;
  const allowed = new Set(opts.allowedRoles.map((r) => r.trim().toLowerCase()));

  return async (req: Request, res: Response, next: NextFunction) => {
    const user: ReqUser | undefined = (req as any).user;
    const email = (user?.email || "").trim().toLowerCase();
    const acceptsJson =
      String(req.headers["accept"] || "").includes("application/json") ||
      req.path.startsWith("/api/");
    const sendForbidden = (msg: string, currentRole: string | null) => {
      if (acceptsJson) {
        return res.status(403).json({ ok: false, error: msg });
      }
      return res
        .status(403)
        .type("html")
        .send(
          renderErr(
            "Forbidden",
            // Phase 22.21.39: errorPage が \n → <br> 変換するようになったため
            //   HTML タグは使わず plain text + 改行 で組み立てる。
            "この機能は管理者ロール (app_role=admin) を持つユーザーのみ利用できます。\n" +
              "管理者にロール付与を依頼してください。\n" +
              "\n" +
              `email: ${email || "(unknown)"}    role: ${
                currentRole || "(none)"
              }`,
            403
          )
        );
    };

    // 1) Portal-secret 経由 (admin-ui の内部呼び出し) は無条件通過
    if (user?.source === "portal_secret") {
      logAccess(req, "allow_signed", {
        layer: "app_role",
        resource: opts.resourceLabel,
        reason: "portal_secret",
      });
      return next();
    }

    // 2) Bootstrap allowlist (env)
    const bootstrapAdmins = (process.env.LB_APP_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (email && bootstrapAdmins.includes(email) && allowed.has("admin")) {
      logAccess(req, "allow_signed", {
        layer: "app_role",
        resource: opts.resourceLabel,
        reason: "bootstrap_admin",
        email,
      });
      return next();
    }

    if (!email) {
      return sendForbidden("認証情報が不明です", null);
    }

    // 3) staff.app_role を引く
    let role: string | null = null;
    try {
      const r = await query(
        "SELECT app_role FROM staff WHERE LOWER(email) = $1 LIMIT 1",
        [email]
      );
      role = ((r.rows[0]?.app_role as string) || "").trim().toLowerCase() || null;
    } catch (err) {
      console.warn(
        `[app_role] staff lookup failed for ${email} on ${opts.resourceLabel}:`,
        err
      );
    }

    if (role && allowed.has(role)) {
      logAccess(req, "allow_signed", {
        layer: "app_role",
        resource: opts.resourceLabel,
        reason: "db_role",
        email,
        role,
      });
      return next();
    }

    logAccess(req, "deny", {
      layer: "app_role",
      resource: opts.resourceLabel,
      email,
      role,
    });
    return sendForbidden(
      `app_role=${role || "viewer"} は ${opts.resourceLabel} へのアクセス権がありません`,
      role
    );
  };
}

// ====================================================================
// Phase 25: 役割解決 + 画面レジストリ連動ガード
//
//   - resolveAppRole : req.user から app_role を "admin"/"viewer" に正規化。
//   - attachAppRole  : 上記を req.userRole に載せる middleware。サイドバーを
//                      役割で出し分けるため、各 HTML 画面ルートに付ける。
//   - requireScreen  : screens.ts の minRole で 403 判定する画面ガード。
//
//   役割は staff.app_role に一本化。department ベースの soft-role は廃止方針。
// ====================================================================

/**
 * req.user から実効ロールを解決する。requireAppRole と同じ優先順位:
 *   portal_secret → admin / bootstrap email → admin / DB app_role / 既定 viewer。
 */
export async function resolveAppRole(req: Request): Promise<Role> {
  const user: ReqUser | undefined = (req as any).user;

  // 既に解決済みなら再利用 (二重 DB 参照を避ける)
  const cached = (req as any).userRole as Role | undefined;
  if (cached) return cached;

  // admin-ui からの内部呼び出し (portal_secret) は admin 扱い
  if (user?.source === "portal_secret") return "admin";

  const email = (user?.email || "").trim().toLowerCase();

  const bootstrapAdmins = (process.env.LB_APP_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && bootstrapAdmins.includes(email)) return "admin";

  if (!email) return "viewer";

  try {
    const r = await query(
      "SELECT app_role FROM staff WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );
    const role = ((r.rows[0]?.app_role as string) || "").trim().toLowerCase();
    return role === "admin" ? "admin" : "viewer";
  } catch (err) {
    console.warn(`[app_role] resolveAppRole lookup failed for ${email}:`, err);
    return "viewer";
  }
}

/**
 * req.userRole に実効ロールを attach する。requireIapUser の後段で使う。
 * サイドバーを役割で絞るため、HTML 画面ルート全てに付与する。
 */
export function attachAppRole(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userRole = await resolveAppRole(req);
    next();
  };
}

/**
 * ログイン者の部署コード(staff.department_code)を解決する。
 *   email が無い/未登録なら null。結果は req.userDeptCode にキャッシュ。
 */
export async function resolveDepartmentCode(
  req: Request
): Promise<string | null> {
  const cached = (req as any).userDeptCode;
  if (cached !== undefined) return cached as string | null;

  const user: ReqUser | undefined = (req as any).user;
  const email = (user?.email || "").trim().toLowerCase();
  let code: string | null = null;
  if (email) {
    try {
      const r = await query(
        "SELECT department_code FROM staff WHERE LOWER(email) = $1 LIMIT 1",
        [email]
      );
      code = ((r.rows[0]?.department_code as string) || "").trim() || null;
    } catch (err) {
      console.warn(`[dept] resolveDepartmentCode lookup failed for ${email}:`, err);
    }
  }
  (req as any).userDeptCode = code;
  return code;
}

/**
 * admin、または指定部署コードを持つユーザーのみ通すルートガード。
 *   - app_role=admin は常に通過。
 *   - それ以外は staff.department_code が departments に含まれれば通過。
 *   - 不足なら 403 (HTML or JSON)。条件明細など「部署限定の閲覧」に使う。
 * requireIapUser → requireAdminOrDepartment の順で使う(role/dept を attach する)。
 */
export function requireAdminOrDepartment(opts: {
  departments: string[];
  renderErrorPage?: (title: string, message: string, status: number) => string;
}): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;
  const allow = opts.departments.map((d) => d.trim()).filter(Boolean);
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = await resolveAppRole(req);
    (req as any).userRole = role;
    const dept = await resolveDepartmentCode(req);

    if (role === "admin" || (dept && allow.includes(dept))) {
      logAccess(req, "allow_signed", {
        layer: "department",
        resource: allow.join(","),
        role,
      });
      return next();
    }

    logAccess(req, "deny", {
      layer: "department",
      resource: allow.join(","),
      role,
    });
    const acceptsJson =
      String(req.headers["accept"] || "").includes("application/json") ||
      req.path.startsWith("/api/");
    if (acceptsJson) {
      return res.status(403).json({ ok: false, error: "forbidden (department)" });
    }
    return res
      .status(403)
      .type("html")
      .send(
        renderErr(
          "Forbidden",
          `この画面は ${allow.join(" / ")} 部署のメンバーのみ閲覧できます。`,
          403
        )
      );
  };
}

/**
 * 画面レジストリ(screens.ts)の minRole に基づくルートガード。
 *   - role >= screen.minRole なら通過。
 *   - 不足なら 403 (HTML or JSON)。
 * requireIapUser → (attachAppRole) → requireScreen の順で使う。
 */
export function requireScreen(opts: {
  key: ScreenKey;
  renderErrorPage?: (title: string, message: string, status: number) => string;
}): RequestHandler {
  const renderErr = opts.renderErrorPage || defaultErrorHtml;
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = await resolveAppRole(req);
    (req as any).userRole = role;

    const screen = screenByKey(opts.key);
    const minRole: Role = screen?.minRole || "admin";

    if (roleAtLeast(role, minRole)) {
      logAccess(req, "allow_signed", {
        layer: "screen",
        resource: opts.key,
        role,
      });
      return next();
    }

    logAccess(req, "deny", { layer: "screen", resource: opts.key, role });
    const acceptsJson =
      String(req.headers["accept"] || "").includes("application/json") ||
      req.path.startsWith("/api/");
    if (acceptsJson) {
      return res.status(403).json({ ok: false, error: "forbidden (screen)" });
    }
    return res
      .status(403)
      .type("html")
      .send(
        renderErr(
          "Forbidden",
          `この画面 (${opts.key}) は ${minRole} 以上の権限が必要です。\n` +
            "管理者にロール付与 (app_role=admin) を依頼してください。\n" +
            "\n" +
            `現在のロール: ${role}`,
          403
        )
      );
  };
}
