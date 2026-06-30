/**
 * RingiSelector — 文書フォーム上部に表示する 稟議番号 マルチセレクタ。
 *
 * 機能:
 *   1. 既存稟議の検索 (5 桁数字前方一致 or title 部分一致)
 *   2. chip 形式で複数稟議を文書にぶら下げる (N:N 関連)
 *   3. 未登録の番号を入力したときは「+ 新規登録」ダイアログを表示
 *
 * 値の流れ:
 *   formData.ringi_numbers: string[]  (5 桁数字の配列)
 *   ↓
 *   onChange で親に伝達 → /api/documents/generate へ送られる
 *   ↓
 *   worker 側で ringi_documents (N:N) に upsert
 */

import * as React from "react"
import { Search, X, Plus, FileText, Loader2, AlertTriangle, Check } from "lucide-react"
import { cn } from "@/lib/utils"

type RingiHint = {
  id: number
  ringi_number: string
  decision_type?: "ringi" | "board_resolution"
  title: string
  category?: string
  status?: string
  owner_name?: string
}

interface Props {
  /** 5 桁数字の配列。例: ["00001","00023"] */
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

// Phase 22.21.117: 番号形式は "R-NNNNN" / "B-NNNNN" (新) または 5 桁数字 (legacy 入力)
const RINGI_RE = /^((R|B)-[0-9]{5}|[0-9]{5})$/i

export const RingiSelector: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [q, setQ] = React.useState("")
  const [hints, setHints] = React.useState<RingiHint[]>([])
  const [chipLabels, setChipLabels] = React.useState<Record<string, string>>(
    {}
  )
  const [showDropdown, setShowDropdown] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createDraft, setCreateDraft] = React.useState({
    decision_type: "ringi" as "ringi" | "board_resolution",
    ringi_number: "",
    title: "",
    category: "",
    owner_name: "",
    owner_department: "",
    remarks: "",
  })
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  // 値の正規化: 5 桁数字でないものは除外
  const normalized = React.useMemo(
    () =>
      Array.from(
        new Set((value || []).map((v) => String(v).trim()).filter((v) => RINGI_RE.test(v)))
      ),
    [value]
  )

  // 既存 chip の title を fetch して labelMap に格納 (表示用)
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      const need = normalized.filter((n) => !chipLabels[n])
      if (need.length === 0) return
      for (const n of need) {
        try {
          const r = await fetch(`/api/ringi/${encodeURIComponent(n)}`)
          if (!r.ok) continue
          const j = await r.json()
          if (cancelled) return
          if (j?.ringi?.title) {
            setChipLabels((m) => ({ ...m, [n]: j.ringi.title }))
          }
        } catch {
          /* 無視 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized.join(",")])

  // q が変わるたびに autocomplete (300ms debounce)
  React.useEffect(() => {
    if (!showDropdown) return
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/ringi/search?q=${encodeURIComponent(q)}&limit=10`
        )
        if (!r.ok) return
        const j = await r.json()
        if (Array.isArray(j?.rows)) setHints(j.rows)
      } catch {}
    }, 250)
    return () => window.clearTimeout(t)
  }, [q, showDropdown])

  const addChip = (num: string) => {
    if (!RINGI_RE.test(num)) return
    if (normalized.includes(num)) return
    onChange([...normalized, num])
    setQ("")
    setShowDropdown(false)
  }

  const removeChip = (num: string) => {
    onChange(normalized.filter((n) => n !== num))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const trimmed = q.trim()
      if (RINGI_RE.test(trimmed)) {
        // ヒントから完全一致を探す。なければ未登録として確認
        const found = hints.find((h) => h.ringi_number === trimmed)
        if (found) {
          addChip(trimmed)
        } else {
          // 未登録 → 新規登録ダイアログを開いてその番号を default 入力
          setCreateDraft({
            decision_type: trimmed.toUpperCase().startsWith("B-")
              ? "board_resolution"
              : "ringi",
            ringi_number: trimmed.toUpperCase(),
            title: "",
            category: "",
            owner_name: "",
            owner_department: "",
            remarks: "",
          })
          setCreateError(null)
          setCreateOpen(true)
        }
      }
    } else if (e.key === "Backspace" && q === "" && normalized.length > 0) {
      // 末尾の chip を削除
      removeChip(normalized[normalized.length - 1])
    }
  }

  const submitCreate = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      if (!RINGI_RE.test(createDraft.ringi_number)) {
        throw new Error("稟議番号は 5 桁数字で指定してください")
      }
      if (!createDraft.title.trim()) {
        throw new Error("タイトルは必須です")
      }
      const r = await fetch("/api/ringi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createDraft),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${r.status}`)
      }
      setChipLabels((m) => ({
        ...m,
        [j.ringi.ringi_number]: j.ringi.title,
      }))
      addChip(j.ringi.ringi_number)
      setCreateOpen(false)
    } catch (e: any) {
      setCreateError(String(e?.message || e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="border border-input rounded-sm bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          稟議番号
          {/* Phase 22.21.118: 任意項目であることを明示 */}
          <span className="text-[11px] opacity-70">
            (任意 / R-NNNNN・B-NNNNN・5 桁数字 / 複数登録可)
          </span>
        </div>
        {normalized.length > 0 ? (
          <span className="text-[11px] font-mono text-emerald-700">
            {normalized.length} 件 紐付け済み
          </span>
        ) : (
          <span className="text-[11px] font-mono text-muted-foreground opacity-70">
            未入力でも保存可
          </span>
        )}
      </div>

      {/* 入力 + chip */}
      <div className="flex flex-wrap items-center gap-1.5 border border-border bg-background rounded-sm px-2 py-1.5 min-h-[40px] focus-within:border-foreground">
        {normalized.map((num) => (
          <span
            key={num}
            className="inline-flex items-center gap-1 text-[10px] font-mono bg-foreground text-background rounded-sm px-2 py-0.5"
          >
            <span className="font-bold">{num}</span>
            {chipLabels[num] && (
              <span className="opacity-80 max-w-[140px] truncate">
                · {chipLabels[num]}
              </span>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeChip(num)}
                className="opacity-60 hover:opacity-100"
                title="このリンクを外す"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        ))}
        <div className="relative flex-1 min-w-[140px]">
          <input
            type="text"
            inputMode="numeric"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            onKeyDown={handleKeyDown}
            placeholder={
              normalized.length === 0
                ? "稟議番号を入力 (例: 00001) / Enter で紐付け"
                : "+ 別の稟議を追加"
            }
            disabled={disabled}
            className="w-full text-[11px] font-mono bg-transparent focus:outline-none placeholder:text-muted-foreground/40 placeholder:text-[10px]"
          />
          {showDropdown && hints.length > 0 && (
            <div className="lb-overlay absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-sm shadow-lg z-20 max-h-[280px] overflow-y-auto">
              {hints.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addChip(h.ringi_number)
                  }}
                  className="w-full text-left px-2 py-1.5 hover:bg-muted text-[11px] font-mono flex items-center gap-2 border-b border-border/30 last:border-b-0"
                >
                  {/* Phase 22.21.117: decision_type バッジ */}
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1 rounded-sm border",
                      h.decision_type === "board_resolution"
                        ? "bg-purple-50 border-purple-300 text-purple-800"
                        : "bg-sky-50 border-sky-300 text-sky-800"
                    )}
                  >
                    {h.decision_type === "board_resolution" ? "取締役会" : "稟議"}
                  </span>
                  <span className="font-bold w-20">{h.ringi_number}</span>
                  <span className="flex-1 truncate">{h.title}</span>
                  {h.status && (
                    <span className="text-[11px] opacity-60">{h.status}</span>
                  )}
                </button>
              ))}
              {RINGI_RE.test(q.trim()) &&
                !hints.find((h) => h.ringi_number === q.trim()) && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setCreateDraft({
                        ringi_number: q.trim(),
                        title: "",
                        category: "",
                        owner_name: "",
                        owner_department: "",
                        remarks: "",
                      })
                      setCreateError(null)
                      setCreateOpen(true)
                    }}
                    className="w-full text-left px-2 py-2 hover:bg-emerald-50 text-[11px] font-mono flex items-center gap-2 bg-emerald-50/50 text-emerald-800 font-bold"
                  >
                    <Plus className="w-3 h-3" />
                    <span>稟議「{q.trim()}」を新規登録...</span>
                  </button>
                )}
            </div>
          )}
        </div>
      </div>

      {/* 新規登録ダイアログ (簡易版) */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !creating && setCreateOpen(false)}
        >
          <div
            className="lb-overlay bg-card border border-border rounded-sm shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-muted/30 border-b border-border px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider font-bold">
                稟議を新規登録
              </span>
              <button
                type="button"
                onClick={() => !creating && setCreateOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {/* Phase 22.21.117: 決裁種別 */}
              <label className="space-y-1 block">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  決裁種別 (必須)
                </div>
                <select
                  value={createDraft.decision_type}
                  onChange={(e) =>
                    setCreateDraft({
                      ...createDraft,
                      decision_type: e.target.value as
                        | "ringi"
                        | "board_resolution",
                    })
                  }
                  className="w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 focus:outline-none focus:border-foreground"
                >
                  <option value="ringi">稟議 (R-NNNNN)</option>
                  <option value="board_resolution">取締役会 (B-NNNNN)</option>
                </select>
              </label>
              <RingiField
                label="決裁番号 (R-NNNNN / B-NNNNN / 5 桁数字, 必須)"
                value={createDraft.ringi_number}
                onChange={(v) =>
                  setCreateDraft({ ...createDraft, ringi_number: v.toUpperCase() })
                }
                placeholder="R-00001 or 00001"
                inputMode="text"
                maxLength={8}
              />
              <RingiField
                label="タイトル (必須)"
                value={createDraft.title}
                onChange={(v) =>
                  setCreateDraft({ ...createDraft, title: v })
                }
                placeholder="例: 商品開発稟議 ◯◯シリーズ"
              />
              <RingiField
                label="カテゴリ"
                value={createDraft.category}
                onChange={(v) =>
                  setCreateDraft({ ...createDraft, category: v })
                }
                placeholder="例: 商品開発 / 業務委託 / ライセンス取得"
              />
              <div className="grid grid-cols-2 gap-3">
                <RingiField
                  label="起案者"
                  value={createDraft.owner_name}
                  onChange={(v) =>
                    setCreateDraft({ ...createDraft, owner_name: v })
                  }
                  placeholder="山田 太郎"
                />
                <RingiField
                  label="部署"
                  value={createDraft.owner_department}
                  onChange={(v) =>
                    setCreateDraft({ ...createDraft, owner_department: v })
                  }
                  placeholder="法務部"
                />
              </div>
              <RingiField
                label="備考"
                value={createDraft.remarks}
                onChange={(v) =>
                  setCreateDraft({ ...createDraft, remarks: v })
                }
                placeholder="任意"
              />
              {createError && (
                <div className="border border-red-200 bg-red-50 rounded-sm px-2 py-1.5 flex items-start gap-1.5 text-[10px] font-mono text-red-800">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  {createError}
                </div>
              )}
            </div>
            <div className="bg-muted/30 border-t border-border px-4 py-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={creating}
                className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-4 py-1.5 hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
              >
                {creating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                登録して紐付け
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const RingiField: React.FC<{
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: "text" | "numeric"
  maxLength?: number
}> = ({ label, value, onChange, placeholder, inputMode = "text", maxLength }) => (
  <label className="space-y-1 block">
    <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      className="w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 focus:outline-none focus:border-foreground"
    />
  </label>
)
