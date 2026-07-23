import * as React from "react"
import { MessagesSquare, Send, RefreshCw, Loader2, Hash, AtSign, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { matterClient } from "@/src/lib/api/matterClient"

type SlackMessage = { ts: string; user?: string; text: string; bot?: boolean }
type SlackThread = { channel_id: string; thread_ts: string; root_text?: string; created_at?: string }
type MentionCandidate = { id: string; name: string }
type SlackDoc = { id: number; document_number?: string; template_type?: string; drive_link?: string }

// ひな形定義。0 は自由入力。1:クラウドサイン送信 / 2:文書作成完了 / 3:評価完了。
const TEMPLATES = [
  { id: 0 as const, label: "自由入力" },
  { id: 1 as const, label: "クラウドサイン送信" },
  { id: 2 as const, label: "文書作成完了" },
  { id: 3 as const, label: "評価完了" },
]

/** メンション複数選択(社内 Slack)。開閉・検索は内部状態、選択リストは親が保持。 */
function MentionPicker({
  label,
  candidates,
  selected,
  onToggle,
}: {
  label: string
  candidates: MentionCandidate[]
  selected: MentionCandidate[]
  onToggle: (c: MentionCandidate) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? candidates.filter((c) => c.name.toLowerCase().includes(s)) : candidates
  }, [q, candidates])
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
            setQ("")
          }}
          className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"
        >
          <AtSign className="h-3 w-3" />
          {label}
        </button>
        {selected.map((m) => (
          <span
            key={m.id}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px]"
          >
            @{m.name}
            <button type="button" onClick={() => onToggle(m)} title="外す">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-1.5">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前で検索…"
            autoFocus
            className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-1 py-0.5">該当なし</p>
            ) : (
              filtered.map((c) => {
                const on = selected.some((m) => m.id === c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onToggle(c)}
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 案件×Slack パネル — 固定「法務相談」チャンネルに案件スレッドを立て、
 *   自由入力送信・ひな形送信(定型文＋メンション＋閲覧リンク)・スレッド会話取得を行う。
 *   Slack 未設定(SLACK_BOT_TOKEN/チャンネル未設定)時は enabled=false で導線を隠す。
 */
export function MatterSlackPanel({ matterId, documents = [] }: { matterId: number; documents?: SlackDoc[] }) {
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
  const [cc, setCc] = React.useState<MentionCandidate[]>([])
  const [template, setTemplate] = React.useState<0 | 1 | 2 | 3>(0)
  const [docId, setDocId] = React.useState<number | null>(null)

  const docsWithLink = React.useMemo(() => documents.filter((d) => !!d.drive_link), [documents])

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

  // テンプレ2/3 に切替時、未選択なら最初の閲覧リンク付き文書を既定選択。
  React.useEffect(() => {
    if ((template === 2 || template === 3) && docId == null && docsWithLink.length > 0) {
      setDocId(docsWithLink[0].id)
    }
  }, [template, docId, docsWithLink])

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<MentionCandidate[]>>) => (c: MentionCandidate) => {
    setter((prev) => (prev.some((m) => m.id === c.id) ? prev.filter((m) => m.id !== c.id) : [...prev, c]))
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

  // 自由入力送信(テンプレ0)。選択メンションを本文冒頭に <@ID> 前置。
  const sendFree = async () => {
    const body = text.trim()
    if (!body && mentions.length === 0) return
    const prefix = mentions.map((m) => `<@${m.id}>`).join(" ")
    const composed = prefix ? (body ? `${prefix} ${body}` : prefix) : body
    if (!composed) return
    setSending(true)
    try {
      const r: any = await matterClient.slackSendMessage(matterId, composed)
      if (r?.ok) {
        setText("")
        setMentions([])
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

  // ひな形送信(テンプレ1/2/3)。合成・閲覧権限付与・投稿はサーバ側で実施。
  const sendTemplate = async () => {
    if (mentions.length === 0) {
      push("メンション先を1名以上選択してください", "error")
      return
    }
    setSending(true)
    try {
      const r: any = await matterClient.slackTemplate(matterId, {
        template,
        mentions: mentions.map((m) => m.id),
        cc: cc.map((m) => m.id),
        documentId: template === 2 || template === 3 ? docId : null,
      })
      if (r?.ok) {
        const failed = Array.isArray(r?.grant?.failed) ? r.grant.failed.length : 0
        if (failed > 0) push(`送信しました(${failed}名は閲覧権限付与に失敗)`, "success")
        else push("送信しました", "success")
        setMentions([])
        setCc([])
        setTemplate(0)
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

  // 送信前プレビュー(実際の投稿は @名前 が <@ID> に置き換わる)。
  const preview = React.useMemo(() => {
    const to = mentions.map((m) => `@${m.name}`)
    if (template === 1) {
      const toPart = to.join(" → ")
      const ccPart = cc.length ? `  CC: ${cc.map((m) => `@${m.name}`).join(" ")}` : ""
      return `クラウドサインで送信しました。 ${toPart}${toPart ? " → " : ""}相手方${ccPart}`.trim()
    }
    const lead = template === 2 ? "文書作成が完了しました。" : "評価が完了しました。"
    const doc = docsWithLink.find((d) => d.id === docId)
    const linkLine = doc?.drive_link ? `\n閲覧リンク: ${doc.drive_link}` : ""
    return `${lead} ${to.join(" ")}${linkLine}`.trim()
  }, [template, mentions, cc, docId, docsWithLink])

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

          {/* ひな形セレクタ */}
          <div className="flex flex-wrap gap-1">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                className={
                  "rounded-md px-2 py-0.5 text-[11px] border " +
                  (template === t.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input text-muted-foreground hover:bg-muted/50")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {template === 0 ? (
            <>
              {/* 自由入力: メンション＋本文 */}
              {candidates.length > 0 && (
                <MentionPicker label="メンション" candidates={candidates} selected={mentions} onToggle={toggleIn(setMentions)} />
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendFree()
                  }}
                  placeholder="スレッドへ送信（⌘/Ctrl+Enter で送信）"
                  rows={2}
                  className="flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" onClick={sendFree} disabled={sending || (!text.trim() && mentions.length === 0)}>
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* ひな形1/2/3: メンション(＋CC / 文書選択)＋プレビュー */}
              <MentionPicker
                label={template === 1 ? "メンション(TO)" : "メンション"}
                candidates={candidates}
                selected={mentions}
                onToggle={toggleIn(setMentions)}
              />
              {template === 1 && (
                <MentionPicker label="CC" candidates={candidates} selected={cc} onToggle={toggleIn(setCc)} />
              )}
              {(template === 2 || template === 3) && (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">閲覧リンク付与する文書</label>
                  {docsWithLink.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">閲覧リンク付きの文書がありません(リンクなしで送信されます)。</p>
                  ) : (
                    <select
                      value={docId ?? ""}
                      onChange={(e) => setDocId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {docsWithLink.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.document_number || `#${d.id}`}
                          {d.template_type ? `（${d.template_type}）` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                <p className="text-[10px] text-muted-foreground mb-1">プレビュー</p>
                <p className="text-[12px] whitespace-pre-wrap break-words">{preview}</p>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={sendTemplate} disabled={sending || mentions.length === 0}>
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  この内容で送信
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default MatterSlackPanel
