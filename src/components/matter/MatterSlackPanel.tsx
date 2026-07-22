import * as React from "react"
import { MessagesSquare, Send, RefreshCw, Loader2, Hash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { matterClient } from "@/src/lib/api/matterClient"

type SlackMessage = { ts: string; user?: string; text: string; bot?: boolean }
type SlackThread = { channel_id: string; thread_ts: string; root_text?: string; created_at?: string }

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
    if (!body) return
    setSending(true)
    try {
      const r: any = await matterClient.slackSendMessage(matterId, body)
      if (r?.ok) {
        setText("")
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
            <Button size="sm" onClick={send} disabled={sending || !text.trim()}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default MatterSlackPanel
