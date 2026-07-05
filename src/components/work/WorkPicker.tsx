import * as React from "react"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

// 作品/原作 検索ピッカー。プルダウン(<select>)は件数が増えると
//   検索不能・取り違えが起きるため、IssuePicker と同型の
//   インクリメンタル検索型に置き換える(文書作成・3カードエディタで使用)。
//   - コード / タイトル / keywords(かな・別名 alternative_titles) で部分一致
//   - 別名・かなでヒットしたときは候補行にヒット根拠を表示(名寄せ検索)
export type WorkPickerItem = {
  id: string
  code?: string // work_code / ledger_code / source_code
  title: string
  sub?: string // 補足表示(事業部・権利者 等)
  keywords?: string[] // 非表示の検索対象(title_kana / alternative_titles 等)
}

interface Props {
  items: WorkPickerItem[]
  value?: string // 選択中の id
  onSelect: (item: WorkPickerItem | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

const norm = (s: any) => String(s ?? "").toLowerCase()

export const WorkPicker: React.FC<Props> = ({
  items,
  value,
  onSelect,
  placeholder = "コード / タイトル / 別名 で検索",
  className,
  disabled,
}) => {
  const [q, setQ] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const selected = React.useMemo(
    () => (value ? items.find((i) => i.id === value) ?? null : null),
    [items, value]
  )

  // 各候補に「どこでヒットしたか」を持たせる。別名/かなヒットは根拠を出す。
  const filtered = React.useMemo(() => {
    const term = norm(q.trim())
    const list = Array.isArray(items) ? items : []
    if (!term) return list.slice(0, 50).map((item) => ({ item, via: null as string | null }))
    const out: Array<{ item: WorkPickerItem; via: string | null }> = []
    for (const item of list) {
      const direct = [item.code, item.title, item.sub].filter(Boolean).some((s) => norm(s).includes(term))
      if (direct) {
        out.push({ item, via: null })
      } else {
        const hit = (item.keywords || []).find((k) => norm(k).includes(term))
        if (hit) out.push({ item, via: hit })
      }
      if (out.length >= 100) break
    }
    return out
  }, [items, q])

  if (selected || (value && !selected)) {
    // 選択済み表示(一覧未ロードで item 未解決でも id は出す)。X で解除。
    return (
      <div className={cn("flex items-center gap-2 min-h-8 px-2.5 py-1 border border-border rounded-md text-[12px]", className)}>
        {selected?.code && <span className="font-mono text-sky-700 shrink-0">[{selected.code}]</span>}
        <span className="truncate font-mono">{selected?.title ?? `#${value}`}</span>
        {selected?.sub && <span className="text-[10px] text-muted-foreground truncate shrink-0">{selected.sub}</span>}
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => onSelect(null)}
          disabled={disabled}
          title="選択を解除して選び直す"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
          // Enter でフォーム送信されるのを防ぎ、候補が1件ならそのまま採用。
          if (e.key === "Enter") {
            e.preventDefault()
            if (filtered.length === 1) {
              onSelect(filtered[0].item)
              setQ("")
              setOpen(false)
            }
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="pl-8 h-8 text-[12px]"
      />
      {open && (
        // bg-popover はこのテーマで透過になるため hsl() を明示。
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-[hsl(var(--popover))] shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] font-mono text-muted-foreground">該当なし</div>
          ) : (
            filtered.map(({ item, via }) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onSelect(item)
                  setQ("")
                  setOpen(false)
                }}
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-muted/60"
              >
                {item.code && <span className="font-mono text-sky-700 shrink-0">[{item.code}]</span>}
                <span className="truncate">{item.title}</span>
                {item.sub && <span className="text-[10px] text-muted-foreground truncate shrink-0">{item.sub}</span>}
                {via && <span className="ml-auto text-[10px] text-amber-700 shrink-0">別名: {via}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// 一覧APIの行(works / source-ips / ledgers)を WorkPickerItem へ整形する共通ヘルパ。
//   title_kana / alternative_titles(TEXT[]) を keywords に畳んで名寄せ検索を効かせる。
export function toWorkPickerItem(row: any, opts?: { code?: string; sub?: string }): WorkPickerItem {
  return {
    id: String(row.id),
    code: opts?.code ?? (row.work_code || row.source_code || row.ledger_code || undefined),
    title: String(row.title ?? ""),
    sub: opts?.sub,
    keywords: [row.title_kana, ...(Array.isArray(row.alternative_titles) ? row.alternative_titles : [])].filter(Boolean),
  }
}
