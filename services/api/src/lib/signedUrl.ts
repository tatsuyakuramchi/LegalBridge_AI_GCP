/**
 * HMAC-SHA256 短期署名 URL (Phase 17s)
 *
 * 用途:
 *   Slack /法務検索 から返る「Web で詳細を見る」ボタン用の URL を、
 *   恒久キー (LB_PORTAL_SECRET) ではなく、リソース ID + 期限 + HMAC で
 *   都度署名された短命 URL に置き換える。
 *
 * 署名 payload:
 *   `${resourceId}.${exp}` を LB_SIGNING_SECRET で HMAC-SHA256 し、
 *   base64url で吐く。
 *
 * resourceId の規約:
 *   - "list"            → /search/vendor (一覧、query は payload に含めない)
 *   - "vendor:<id>"     → /search/vendor/:vendorId (詳細)
 *   - "ringi:<num>"     → /search/ringi/:number    (稟議)
 *
 * 一つの署名はその resourceId 限定。vendor:123 の署名で vendor:456 は
 * 開けない。
 *
 * フェイルクローズ: LB_SIGNING_SECRET が未設定の場合、sign() / verify()
 * とも例外を投げる。caller (middleware) はこれを catch して legacy
 * token 経路へフォールバックする実装になっている。
 */

import crypto from "node:crypto";

const SECRET_ENV = "LB_SIGNING_SECRET";

/** runtime に毎回 process.env を読みに行く (dotenv / secret manager 反映用) */
function getSecret(): string | null {
  return process.env[SECRET_ENV] || null;
}

/**
 * LB_SIGNING_SECRET が設定済みか。middleware がフォールバック判断に使う。
 */
export function hasSigningSecret(): boolean {
  return Boolean(getSecret());
}

/**
 * Base64url encode (RFC 4648 §5). Node 16+ supports "base64url" directly.
 */
function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * resourceId の正規化。値そのものではなく形式を統一しておくことで、
 * GAS 側と worker 側で食い違いが起きないようにする。
 */
function normalizeResourceId(resourceId: string): string {
  return String(resourceId).trim();
}

/**
 * 指定リソースに対する短期署名を作る。
 *
 * @param resourceId 例: "vendor:123", "ringi:00001", "list"
 * @param ttlSec     有効期限 (秒)。デフォルト 10 分。
 * @returns          { exp: number (UNIX秒), sig: base64url 文字列 }
 */
export function sign(
  resourceId: string,
  ttlSec: number = 600
): { exp: number; sig: string } {
  const secret = getSecret();
  if (!secret) {
    throw new Error(`${SECRET_ENV} is not set`);
  }
  const id = normalizeResourceId(resourceId);
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSec));
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${id}.${exp}`)
    .digest();
  return { exp, sig: b64url(mac) };
}

/**
 * クエリパラメータの ?exp=...&sig=... を検証。
 * 有効期限切れ / 改ざん / フォーマット不正は false。
 *
 * @param resourceId 検証したい resourceId (URL 側の path から自分で組み立てる)
 * @param exp        ?exp= の値 (string)
 * @param sig        ?sig= の値 (string)
 */
export function verify(
  resourceId: string,
  exp: string | number | undefined | null,
  sig: string | undefined | null
): { ok: boolean; reason?: string } {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: "secret_unset" };

  if (!exp || !sig) return { ok: false, reason: "missing_params" };

  const expNum =
    typeof exp === "number" ? exp : Number(String(exp).trim());
  if (!Number.isFinite(expNum) || expNum <= 0) {
    return { ok: false, reason: "bad_exp" };
  }
  if (Math.floor(Date.now() / 1000) > expNum) {
    return { ok: false, reason: "expired" };
  }

  const id = normalizeResourceId(resourceId);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${id}.${expNum}`)
    .digest();

  let actual: Buffer;
  try {
    actual = Buffer.from(String(sig).trim(), "base64url");
  } catch {
    return { ok: false, reason: "bad_sig_format" };
  }
  if (actual.length !== expected.length) {
    return { ok: false, reason: "len_mismatch" };
  }
  try {
    if (crypto.timingSafeEqual(actual, expected)) {
      return { ok: true };
    }
    return { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "timingsafe_error" };
  }
}

/**
 * URL のクエリ文字列 (`exp=...&sig=...`) を組み立てるヘルパー。
 * view 層から `signLinkQs("vendor:123")` のように呼ぶ。
 *
 * 先頭の `?` や `&` は付けないので、呼び出し側で `?` または `&` を
 * 必要に応じて prepend する。
 */
export function signLinkQs(resourceId: string, ttlSec?: number): string {
  const { exp, sig } = sign(resourceId, ttlSec);
  return `exp=${exp}&sig=${encodeURIComponent(sig)}`;
}
