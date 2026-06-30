/**
 * accessAllowlistService — 外部アドレス許可リスト(アプリ側)。
 *
 * portal_access_allowlist を管理(一覧/追加/削除)し、auth の email allowlist 判定に
 * 使う。auth はホットパスのため、有効メールの集合を短時間キャッシュする(TTL 60s)。
 *
 * 注: これはアプリのロール審査用 allowlist。IAP(GCP エッジ)のドメイン制限は別途
 *     IAM での許可が必要(本サービスは IAP を制御しない)。
 */

import { query } from "../lib/db.ts";

export interface AllowedEmailRow {
  email: string;
  note: string | null;
  isActive: boolean;
  createdAt: string | null;
  createdBy: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TTL_MS = 60_000;
let cache: { at: number; set: Set<string> } | null = null;

function invalidate(): void {
  cache = null;
}

/** 有効な許可メール集合(小文字)をキャッシュ付きで返す。auth から使う。 */
export async function getAllowlistedEmailSet(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set;
  try {
    const { rows } = await query(
      `SELECT LOWER(email) AS email FROM portal_access_allowlist WHERE is_active = TRUE`
    );
    cache = { at: Date.now(), set: new Set(rows.map((r: any) => r.email)) };
  } catch {
    // テーブル未作成等のときは空集合(env 側 allowlist は別途効く)。
    cache = { at: Date.now(), set: new Set() };
  }
  return cache.set;
}

/** email が許可リストにあるか(キャッシュ参照)。 */
export async function isEmailAllowlisted(email: string): Promise<boolean> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return false;
  return (await getAllowlistedEmailSet()).has(e);
}

/** 管理用: 全件(無効含む)を新しい順で。 */
export async function listAllowedEmails(): Promise<AllowedEmailRow[]> {
  const { rows } = await query(
    `SELECT email, note, is_active, created_at, created_by
       FROM portal_access_allowlist
      ORDER BY created_at DESC, id DESC`
  );
  return rows.map((r: any) => ({
    email: r.email,
    note: r.note ?? null,
    isActive: !!r.is_active,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    createdBy: r.created_by ?? null,
  }));
}

/** 追加(または再有効化)。 */
export async function addAllowedEmail(
  email: string,
  note?: string | null,
  createdBy?: string | null
): Promise<void> {
  const e = (email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error("メールアドレスの形式が不正です");
  await query(
    `INSERT INTO portal_access_allowlist (email, note, created_by, is_active)
     VALUES ($1,$2,$3, TRUE)
     ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note, is_active = TRUE`,
    [e, note || null, createdBy || "admin"]
  );
  invalidate();
}

/** 削除。 */
export async function removeAllowedEmail(email: string): Promise<void> {
  const e = (email || "").trim().toLowerCase();
  const res = await query(`DELETE FROM portal_access_allowlist WHERE email = $1`, [e]);
  if (res.rowCount === 0) throw new Error(`'${e}' は許可リストにありません`);
  invalidate();
}
