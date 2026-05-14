/**
 * IAP (Identity-Aware Proxy) JWT 検証 (Phase 17s)
 *
 * Cloud Run を HTTPS LB + IAP の背後に置く構成での「アプリ側独立検証」用。
 * 多層防御 (defense in depth):
 *   - インフラ層: IAP が Workspace SSO で本人確認
 *   - アプリ層 : 本モジュールが x-goog-iap-jwt-assertion を再検証
 *
 * 通常 IAP が前段で守ってくれるが、誤設定や経路漏れ (Cloud Run の
 * 直 *.run.app URL が叩かれる、内部 LB のバイパス等) が起きると素通し
 * になる。アプリ側にも独立の検証を入れておくと、ログから事故を検知
 * できる。
 *
 * 環境変数:
 *   - GCP_PROJECT_NUMBER   : numeric project number (= /projects/<N>)
 *   - IAP_BACKEND_SERVICE_ID: numeric backend service ID
 *   - IAP_AUDIENCE         : audience 文字列を直書きしたい場合 (上 2 つの代わり)
 *   - IAP_ENFORCE          : "true" のとき検証失敗で 401。falsy のときは
 *                            warn ログのみで先へ通す (移行期向け)。
 *
 * audience 形式:
 *   `/projects/${GCP_PROJECT_NUMBER}/global/backendServices/${IAP_BACKEND_SERVICE_ID}`
 *
 * 上記が未設定の場合、verifyIap() は { ok: false, reason: "not_configured" }
 * を返し、middleware は素通し (= IAP 検証は無効化されている扱い)。
 */

import type { Request } from "express";

type IapVerifyResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: string };

let _client: any = null;
let _clientInitFailed = false;

/**
 * google-auth-library を遅延 require する (起動失敗を回避)。
 * 依存が無い環境では IAP 検証を素通しにする。
 */
async function getClient(): Promise<any | null> {
  if (_client) return _client;
  if (_clientInitFailed) return null;
  try {
    const mod = await import("google-auth-library");
    const Ctor = (mod as any).OAuth2Client;
    _client = new Ctor();
    return _client;
  } catch (err) {
    console.warn(
      "[iap] google-auth-library not installed — IAP JWT verification disabled.",
      err
    );
    _clientInitFailed = true;
    return null;
  }
}

function getAudience(): string | null {
  if (process.env.IAP_AUDIENCE) return process.env.IAP_AUDIENCE;
  const num = process.env.GCP_PROJECT_NUMBER;
  const bs = process.env.IAP_BACKEND_SERVICE_ID;
  if (!num || !bs) return null;
  return `/projects/${num}/global/backendServices/${bs}`;
}

/**
 * リクエストから IAP JWT を検証して、本人 email を返す。
 *
 * 戻り値:
 *   - { ok: true, email }       : 検証成功 (email は IAP が解決した本人)
 *   - { ok: false, reason }     : 検証失敗
 *
 * reason が "not_configured" の場合は、middleware は素通しにすべき
 * (= IAP がまだ前段に設定されていない / もしくは意図的に無効化)。
 */
export async function verifyIap(req: Request): Promise<IapVerifyResult> {
  const audience = getAudience();
  if (!audience) return { ok: false, reason: "not_configured" };

  const jwt = req.header("x-goog-iap-jwt-assertion");
  if (!jwt) return { ok: false, reason: "missing_header" };

  const client = await getClient();
  if (!client) return { ok: false, reason: "lib_unavailable" };

  try {
    // Phase 17y-6 修正:
    //   getIapPublicKeysAsync() は { pubkeys, res } 形式のレスポンスを返す。
    //   verifySignedJwtWithCertsAsync は pubkeys 単独を期待しているので、
    //   .pubkeys を取り出して渡す必要がある。
    //   旧実装は response 全体を渡してしまっていて常に検証失敗していた。
    const pubKeysResponse = await client.getIapPublicKeysAsync();
    const pubKeys = (pubKeysResponse && pubKeysResponse.pubkeys)
      ? pubKeysResponse.pubkeys
      : pubKeysResponse;
    const ticket = await client.verifySignedJwtWithCertsAsync(
      jwt,
      pubKeys,
      audience,
      ["https://cloud.google.com/iap"]
    );
    const payload = ticket?.getPayload?.() || {};
    return { ok: true, email: payload.email || null };
  } catch (err) {
    return { ok: false, reason: `verify_error: ${(err as Error)?.message || err}` };
  }
}

/**
 * IAP が前段に居る本番想定で、検証必須かどうかの判定。
 * 環境変数 IAP_ENFORCE=true のときだけ middleware は 401 を返す。
 * 移行期は false (= warn ログのみ) で運用すると安全に切り替えできる。
 */
export function isIapEnforced(): boolean {
  return String(process.env.IAP_ENFORCE || "").toLowerCase() === "true";
}
