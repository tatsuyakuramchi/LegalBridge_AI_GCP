import * as React from "react"
import { MessagesSquare, Send, RefreshCw, Loader2, Hash, AtSign, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { matterClient } from "@/src/lib/api/matterClient"

type SlackMessage = { ts: string; user?: string; text: string; bot?: boolean }
type SlackThread = { channel_id: string; thread_ts: string; root_text?: string; created_at?: string }
type MentionCandidate = { id: string; name: string }

/**
 * 案件×Slack パネル — 固定「法務相談」チャンネルに案件スレッドを立て、
 *   メッセージ送信とスレッド会話(オンデマンド取得)を行う。
 *   Slack 未設定(SLACK_BOT_TOKEN/チャンネル未設定)時は enabled=false で導線を隠す。
 */
export function MatterSlackPanel({ matterId }: { matterId: number }) {
  const { push } = useToast()
  const [enabled, setEnabled] = React.useState(true)
  const [thread, setThread] = React.useState<SlackThread | null>(null)
  const [messages, setMessages] = React.useState<SlackMessage[]>([])
  const [loading, setLoading] = React.useState(true)
  const [creating, setCreating] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [text, setText] = React.useState("")
  const [candidates, setCandidates] = React.useState<MentionCandidate[]>([])
  const [mentions, setMentions] = React.useState<MentionCandidate[]>([])
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState("")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r: any = await matterClient.slackReplies(matterId)
      setEnabled(r?.enabled !== false)
      setThread(r?.thread ?? null)
      setMessages(Array.isArray(r?.messages) ? r.messages : [])
    } catch (e: any) {
      // 取得失敗は致命ではない(パネルは残す)。
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [matterId])

  React.useEffect(() => {
    void load()
  }, [load])

  // メンション候補(staff の slack_user_id 保有者)を一度だけ取得。失敗は無視。
  React.useEffect(() => {
    let alive = true
    matterClient
      .slackMentionCandidates()
      .then((r: any) => {
        if (alive && Array.isArray(r?.candidates)) setCandidates(r.candidates)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const toggleMention = (c: MentionCandidate) => {
    setMentions((prev) =>
      prev.some((m) => m.id === c.id) ? prev.filter((m) => m.id !== c.id) : [...prev, c]
    )
  }

  const createThread = async () => {
    setCreating(true)
    try {
      const r: any = await matterClient.slackCreateThread(matterId)
      if (r?.ok) {
        push(r.created ? "法務相談スレッドを作成しました" : "既存スレッドに接続しました", "success")
        await load()
      } else {
        push(r?.error || "スレッド作成に失敗しました", "error")
      }
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setCreating(false)
    }
  }

  const send = async () => {
    const body = text.trim()
    if (!body && mentions.length === 0) return
    // 選択したメンションを本文冒頭に <@ID> として前置。
    const prefix = mentions.map((m) => `<@${m.id}>`).join(" ")
    const composed = prefix ? (body ? `${prefix} ${body}` : prefix) : body
    if (!composed) return
    setSending(true)
    try {
      const r: any = await matterClient.slackSendMessage(matterId, composed)
      if (r?.ok) {
        setText("")
        setMentions([])
        setPickerOpen(false)
        await load()
      } else {
        push(r?.error || "送信に失敗しました", "error")
      }
    } catch (e: any) {
      push(String(e?.message || e), "error")
    } finally {
      setSending(false)
    }
  }

  if (!enabled) return null

  return (
    <div className="border border-border/60 rounded-sm p-3 space-y-3">
      <div className="flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">法務相談スレッド (Slack)</span>
        {thread && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Hash className="h-3 w-3" />
            {thread.channel_id}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {thread && (
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} title="会話を更新">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {loading && !thread ? (
        <p className="text-[12px] text-muted-foreground">読み込み中…</p>
      ) : !thread ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            この案件専用の相談スレッドを「法務相談」チャンネルに立てます。
          </p>
          <Button size="sm" onClick={createThread} disabled={creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <MessagesSquare className="h-3.5 w-3.5 mr-1" />}
            法務相談スレッドを立てる
          </Button>
        </div>
      ) : (
        <>
          <div className="max-h-64 overflow-y-auto space-y-2 rounded-sm bg-muted/20 p-2">
            {messages.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">まだ返信がありません。</p>
            ) : (
              messages.map((m) => (
                <div key={m.ts} className="text-[12px] leading-relaxed">
                  <span className="text-[10px] font-mono text-muted-foreground mr-1.5">
                    {m.bot ? "bot" : m.user || "user"}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{m.text}</span>
                </div>
              ))
            )}
          </div>
          {/* メンション選択: staff の slack_user_id 保有者から選び、送信時に <@ID> を本文冒頭へ付与。 */}
          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen((v) => !v)
                    setMentionQuery("")
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"
                >
                  <AtSign className="h-3 w-3" />
                  メンション
                </button>
                {mentions.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px]"
                  >
                    @{m.name}
                    <button type="button" onClick={() => toggleMention(m)} title="外す">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              {pickerOpen && (
                <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-1.5">
                  <input
                    type="text"
                    value={mentionQuery}
                    onChange={(e) => setMentionQuery(e.target.value)}
                    placeholder="名前で検索…"
                    autoFocus
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                    {(() => {
                      const q = mentionQuery.trim().toLowerCase()
                      const filtered = q
                        ? candidates.filter((c) => c.name.toLowerCase().includes(q))
                        : candidates
                      if (filtered.length === 0)
                        return <p className="text-[11px] text-muted-foreground px-1 py-0.5">該当なし</p>
                      return filtered.map((c) => {
                        const on = mentions.some((m) => m.id === c.id)
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleMention(c)}
                            className={
                              "rounded-full px-2 py-0.5 text-[11px] border " +
                              (on
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-input text-muted-foreground hover:bg-muted/50")
                            }
                          >
                            @{c.name}
                          </button>
                        )
                      })
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send()
              }}
              placeholder="スレッドへ送信（⌘/Ctrl+Enter で送信）"
              rows={2}
              className="flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" onClick={send} disabled={sending || (!text.trim() && mentions.length === 0)}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default MatterSlackPanel
