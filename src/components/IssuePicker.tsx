import * as React from "react"
import { Search, X, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

// Request(Backlog課題)検索ピッカー。useAppData().issues を渡して使う。
//   インラインのドロップダウンだと件名が見切れて選びにくいため、
//   ポップアップ(ダイアログ)型に変更。右下ドラッグでサイズ変更可。
//   コード / 件名 / 本文 + ステータスで絞り込み → 行クリックで onSelect(issue)。
type IssueLike = {
  issueKey: string
  summary?: string
  description?: string
  status?: any
  registeredUser?: string
}

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
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [status, setStatus] = React.useState("")

  const list = Array.isArray(issues) ? issues : []
  const selected = value ? list.find((i) => i.issueKey === value) : undefined

  const statusNames = React.useMemo(() => {
    const c = new Map<string, number>()
    for (const i of list) {
      const n = String(i?.status?.name || "").trim() || "未設定"
      c.set(n, (c.get(n) || 0) + 1)
    }
    return Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
  }, [list])

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    let r = list
    if (status) r = r.filter((i) => (String(i?.status?.name || "").trim() || "未設定") === status)
    if (term)
      r = r.filter((i) =>
        [i.issueKey, i.summary, i.description]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(term))
      )
    return r.slice(0, 200)
  }, [list, q, status])

  const pick = (i: IssueLike) => {
    onSelect(i)
    setOpen(false)
    setQ("")
  }

  return (
    <>
      {value ? (
        <div
          className={cn(
            "flex items-center gap-2 h-8 px-2.5 border border-border rounded-md text-[12px] cursor-pointer hover:border-foreground/60 transition-colors",
            className
          )}
          onClick={() => setOpen(true)}
          title="クリックで変更"
        >
          <span className="font-mono text-sky-700 shrink-0">{value}</span>
          <span className="text-muted-foreground truncate">{selected?.summary || ""}</span>
          <button
            className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(null)
            }}
            title="選択を解除"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex items-center gap-2 h-8 px-2.5 w-full border border-border rounded-md text-[12px] text-muted-foreground hover:border-foreground/60 hover:text-foreground transition-colors",
            className
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{placeholder}</span>
        </button>
      )}

      <Dialog open={open} onOpenChange={(v: boolean) => !v && setOpen(false)}>
        <DialogContent
          className="max-w-none"
          style={{ width: 680, height: 540, maxWidth: "95vw", minWidth: 420, minHeight: 320, resize: "both" }}
        >
          <DialogHeader>
            <DialogTitle>Request（Backlog課題）を選択</DialogTitle>
            <div className="flex items-center gap-2 pt-1">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="課題キー / 件名 / 本文で検索"
                  className="pl-8 h-8 text-[12px]"
                />
              </div>
              <NativeSelect
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="h-8 text-[12px] w-40"
                title="ステータスで絞り込み"
              >
                <option value="">全ステータス</option>
                {statusNames.map(([n, c]) => (
                  <option key={n} value={n}>
                    {n} ({c})
                  </option>
                ))}
              </NativeSelect>
            </div>
          </DialogHeader>
          <DialogBody className="flex-1 p-0">
            {filtered.length === 0 ? (
              <p className="px-6 py-8 text-center text-[12px] text-muted-foreground">
                該当する Request がありません。
              </p>
            ) : (
              filtered.map((i) => {
                const active = i.issueKey === value
                return (
                  <button
                    key={i.issueKey}
                    onClick={() => pick(i)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-4 py-2 text-left text-[12px] border-b border-border/40 hover:bg-muted/60 transition-colors",
                      active && "bg-muted/60"
                    )}
                  >
                    <span className="font-mono text-sky-700 shrink-0 pt-px">{i.issueKey}</span>
                    {i.status?.name && (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {i.status.name}
                      </Badge>
                    )}
                    <span className="text-foreground/90 leading-snug line-clamp-2 flex-1">
                      {i.summary || <span className="text-muted-foreground">（件名なし）</span>}
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 mt-0.5" />}
                  </button>
                )
              })
            )}
          </DialogBody>
          <DialogFooter className="py-2.5">
            <span className="mr-auto text-[10px] text-muted-foreground">
              {filtered.length} 件表示{filtered.length === 200 ? "（先頭200件。検索で絞り込んでください）" : ""} · 右下の角をドラッグでウィンドウを拡大できます
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
