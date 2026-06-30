import * as React from "react"
import { Input } from "@/components/ui/input"

type StaffLite = { staff_name?: string; email?: string; department?: string }

// 社内署名者を「検索して追加」するピッカー。プルダウンが長くて選びにくい問題の解消用。
//   氏名 / メール / 部署 で部分一致。候補をクリックで onPick。
export function StaffPicker({
  staff,
  exclude = [],
  onPick,
  placeholder = "社内署名者を検索して追加（氏名 / メール / 部署）",
}: {
  staff: StaffLite[]
  exclude?: string[]
  onPick: (s: StaffLite) => void
  placeholder?: string
}) {
  const [q, setQ] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const matches = React.useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return (staff || [])
      .filter(
        (x) =>
          x.email &&
          !exclude.includes(x.email) &&
          `${x.staff_name || ""} ${x.email} ${x.department || ""}`.toLowerCase().includes(s)
      )
      .slice(0, 8)
  }, [q, staff, exclude])
  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && matches.length > 0 && (
        <div className="lb-overlay absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-md">
          {matches.map((s) => (
            <button
              key={s.email}
              type="button"
              className="block w-full text-left px-2.5 py-1.5 text-xs font-mono hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault() // onBlur より先に確定させる
                onPick(s)
                setQ("")
                setOpen(false)
              }}
            >
              {s.staff_name || "(名前なし)"}（{s.email}）
              {s.department ? <span className="text-muted-foreground"> · {s.department}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
