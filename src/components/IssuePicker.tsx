import * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

// Request(Backlog課題)検索ピッカー。useAppData().issues を渡して使う。
//   コード / 件名 で絞り込み → onSelect(issue) → 呼び出し側が backlog_issue_key を採用。
type IssueLike = { issueKey: string; summary?: string; description?: string; status?: any }

interface Props {
  issues: IssueLike[]
  value?: string // 選択中の issueKey
  onSelect: (issue: IssueLike | null) => void
  placeholder?: string
  className?: string
}

export const IssuePicker: React.FC<Props> = ({
  issues,
  value,
  onSelect,
  placeholder = "Request を検索 (課題キー / 件名)",
  className,
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

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = Array.isArray(issues) ? issues : []
    if (!term) return list.slice(0, 50)
    return list
      .filter((i) => {
        const f = [i.issueKey, i.summary].filter(Boolean).map((s) => String(s).toLowerCase())
        return f.some((x) => x.includes(term))
      })
      .slice(0, 100)
  }, [issues, q])

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      {value ? (
        <div className="flex items-center gap-2 h-8 px-2.5 border border-border rounded-md text-[12px]">
          <span className="font-mono text-sky-700">{value}</span>
          <button className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onSelect(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="pl-8 h-8 text-[12px]"
          />
          {/* bg-popover はこのテーマで透過になるため hsl() を明示(重なった要素が透けるのを防ぐ) */}
          {open && filtered.length > 0 && (
            <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-[hsl(var(--popover))] shadow-md">
              {filtered.map((i) => (
                <button
                  key={i.issueKey}
                  onClick={() => {
                    onSelect(i)
                    setQ("")
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-muted/60"
                >
                  <span className="font-mono text-sky-700 shrink-0">{i.issueKey}</span>
                  <span className="text-muted-foreground truncate">{i.summary || ""}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
