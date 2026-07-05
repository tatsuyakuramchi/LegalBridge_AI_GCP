import type { Staff } from "@/src/context/AppDataContext"

// Slack 起案 (GAS) の Backlog 課題本文には「依頼者: <@U…>」の形で
// Slack ユーザー ID だけが埋め込まれる (gas/Code.gs の description 組み立て参照)。
// 管理 UI では誰の依頼か分からないため、スタッフマスタ (staff テーブル,
// /api/master/staff) の slack_user_id で名前・メールアドレスへ解決する。

// Slack のユーザー ID は U または W 始まりの英数字。
const MENTION_RE = /<@([UW][A-Z0-9]+)>/g

/** 課題本文から依頼者の Slack ユーザー ID を取り出す。見つからなければ null。 */
export function extractRequesterSlackId(description?: string | null): string | null {
  const text = String(description || "")
  // 「依頼者: <@U…>」の行を優先し、無ければ本文中の最初のメンションを拾う。
  const line = text.match(/依頼者[:：]\s*<@([UW][A-Z0-9]+)>/)
  if (line) return line[1]
  const any = text.match(/<@([UW][A-Z0-9]+)>/)
  return any ? any[1] : null
}

/** slack_user_id でスタッフマスタを引く。 */
export function findStaffBySlackId(
  staffList: Staff[] | undefined,
  slackId: string | null | undefined
): Staff | undefined {
  if (!slackId) return undefined
  return (staffList || []).find((s) => s.slack_user_id === slackId)
}

/** 表示用ラベル: 「山田 太郎 <yamada@example.com>」/ 未登録なら ID をそのまま。 */
export function formatStaffLabel(staff: Staff | undefined, slackId: string): string {
  if (!staff) return `${slackId}（スタッフ未登録）`
  return staff.email ? `${staff.staff_name} <${staff.email}>` : staff.staff_name
}

/**
 * 本文中の <@U…> メンションをスタッフ名 (+メール) に置換して返す。
 * スタッフマスタに居ない ID はそのまま残す。
 */
export function resolveSlackMentions(
  description: string | null | undefined,
  staffList: Staff[] | undefined
): string {
  const text = String(description || "")
  if (!text) return ""
  return text.replace(MENTION_RE, (raw, id: string) => {
    const staff = findStaffBySlackId(staffList, id)
    if (!staff) return raw
    return staff.email ? `${staff.staff_name} <${staff.email}>` : staff.staff_name
  })
}
