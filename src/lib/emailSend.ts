// 検収書 / 利用許諾料計算書 を取引先へメール送信する共通ヘルパー。
//   宛先は prompt で上書き可(空欄なら取引先の主担当)。結果は alert で通知。
//   送信できたら true を返す(呼び出し側が表示を更新するため)。
export async function promptAndSendDocumentEmail(
  documentNumber: string,
): Promise<boolean> {
  const to = window.prompt(
    "送信先メール（空欄なら取引先の主担当）。複数はカンマ区切り:",
    "",
  )
  if (to === null) return false // キャンセル
  try {
    const res = await fetch(
      `/api/documents/${encodeURIComponent(documentNumber)}/email/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(to.trim() ? { to: to.trim() } : {}),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
    window.alert(
      `送信しました: ${(data.to || []).join(", ")}${data.attached ? "（PDF添付）" : "（本文リンクのみ）"}`,
    )
    return true
  } catch (e: any) {
    window.alert(`メール送信に失敗: ${e?.message || e}`)
    return false
  }
}
