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

type ResourceIdGetter = (req: Request) => string;

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
      if (!iap.ok) {
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
