import * as React from "react"
import { Copy, Check, Plus, Pencil, Trash2, Loader2 } from "lucide-react"

// 定型文言(ひな形)ライブラリ。発注書の「特約・備考」「業務明細(成果物)」等でよく使う
//   文言を登録しておき、このページで一覧表示して コピー → フォームへ貼り付け(末尾追記)する
//   簡易運用。文書作成フォームから別タブで開く想定(/text-snippets)。

type Snippet = {
  id: number
  category: string
  title: string
  body: string
  sort_order: number
  is_active?: boolean
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: "special_terms", label: "特約・備考" },
  { key: "work_item", label: "業務明細（成果物）" },
  { key: "other", label: "その他" },
]
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label || k

export default function TextSnippetsPage() {
  const [rows, setRows] = React.useState<Snippet[]>([])
  const [loading, setLoading] = React.useState(true)
  const [copiedId, setCopiedId] = React.useState<number | null>(null)
  const [q, setQ] = React.useState("")

  // 追加/編集フォーム。id が null なら新規。
  const [editId, setEditId] = React.useState<number | null>(null)
  const [fCat, setFCat] = React.useState("special_terms")
  const [fTitle, setFTitle] = React.useState("")
  const [fBody, setFBody] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/master/text-snippets")
      const d = await r.json().catch(() => [])
      setRows(Array.isArray(d) ? d : [])
    } catch {
      /* noop */
    } finally {
      setLoading(false)
    }
  }, [])
  React.useEffect(() => {
    void load()
  }, [load])

  const copy = async (s: Snippet) => {
    try {
      await navigator.clipboard.writeText(s.body || "")
      setCopiedId(s.id)
      window.setTimeout(() => setCopiedId((v) => (v === s.id ? null : v)), 1500)
    } catch {
      window.alert("クリップボードにコピーできませんでした。手動で選択してコピーしてください。")
    }
  }

  const resetForm = () => {
    setEditId(null)
    setFCat("special_terms")
    setFTitle("")
    setFBody("")
  }
  const startEdit = (s: Snippet) => {
    setEditId(s.id)
    setFCat(s.category)
    setFTitle(s.title)
    setFBody(s.body)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const save = async () => {
    if (!fTitle.trim()) return
    setSaving(true)
    try {
      const r = await fetch("/api/master/text-snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editId ?? undefined,
          category: fCat,
          title: fTitle.trim(),
          body: fBody,
          sort_order: 0,
        }),
      })
      if (!r.ok) {
        const t = await r.text().catch(() => "")
        window.alert(`保存に失敗しました\n${t}`)
        return
      }
      resetForm()
      await load()
    } finally {
      setSaving(false)
    }
  }
  const remove = async (s: Snippet) => {
    if (!window.confirm(`「${s.title}」を削除します。よろしいですか？`)) return
    await fetch(`/api/master/text-snippets/${s.id}`, { method: "DELETE" })
    if (editId === s.id) resetForm()
    await load()
  }

  const filtered = rows.filter((s) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return `${s.title} ${s.body}`.toLowerCase().includes(t)
  })

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-lg font-bold">文言集（ひな形）</h1>
        <p className="text-xs text-muted-foreground mt-1">
          よく使う文言を登録しておき、<b>コピー</b>して発注書などの「特約・備考」「業務明細」へ貼り付け（末尾追記）してください。
        </p>
      </div>

      {/* 追加 / 編集フォーム */}
      <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
        <div className="text-[11px] font-bold text-muted-foreground">
          {editId ? "文言を編集" : "文言を追加"}
        </div>
        <div className="flex gap-2">
          <select
            value={fCat}
            onChange={(e) => setFCat(e.target.value)}
            className="text-xs bg-background border border-input rounded-sm px-2 py-1 [&>option]:bg-background"
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={fTitle}
            onChange={(e) => setFTitle(e.target.value)}
            placeholder="見出し（例: 秘密保持）"
            className="flex-1 text-xs bg-background border border-input rounded-sm px-2 py-1"
          />
        </div>
        <textarea
          value={fBody}
          onChange={(e) => setFBody(e.target.value)}
          rows={4}
          placeholder="本文（貼り付ける文言）"
          className="w-full text-xs font-mono bg-background border border-input rounded-sm px-2 py-1 resize-y"
        />
        <div className="flex items-center gap-2 justify-end">
          {editId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-[11px] px-2 py-1 rounded border border-input hover:bg-muted"
            >
              キャンセル
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !fTitle.trim()}
            className="text-[11px] px-3 py-1 rounded bg-foreground text-background font-bold disabled:opacity-50 inline-flex items-center gap-1"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {editId ? "更新" : "追加"}
          </button>
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="文言を検索（見出し / 本文）"
        className="w-full text-xs bg-background border border-input rounded-sm px-2 py-1.5"
      />

      {loading ? (
        <div className="text-xs text-muted-foreground py-8 text-center">読み込み中…</div>
      ) : (
        CATEGORIES.map((c) => {
          const items = filtered.filter((s) => s.category === c.key)
          if (items.length === 0) return null
          return (
            <div key={c.key} className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
                {c.label}（{items.length}）
              </div>
              {items.map((s) => (
                <div key={s.id} className="rounded-md border border-border p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold">{s.title}</div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void copy(s)}
                        className="text-[11px] px-2 py-0.5 rounded border border-foreground/30 hover:bg-muted inline-flex items-center gap-1"
                        title="本文をコピー"
                      >
                        {copiedId === s.id ? (
                          <>
                            <Check className="h-3 w-3 text-success" /> コピー済
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> コピー
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="編集"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(s)}
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="削除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-muted-foreground leading-relaxed">
                    {s.body}
                  </pre>
                </div>
              ))}
            </div>
          )
        })
      )}
      {!loading && filtered.length === 0 && (
        <div className="text-xs text-muted-foreground py-8 text-center">
          文言がありません。上の「追加」から登録してください。
        </div>
      )}
    </div>
  )
}
