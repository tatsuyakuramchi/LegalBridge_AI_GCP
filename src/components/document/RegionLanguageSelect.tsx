/**
 * RegionLanguageSelect — 許諾地域(国名) / 許諾言語 の複数選択(1対N)ピッカー。
 *
 * 条件明細フォームで、フリーテキストの代わりに選択式で複数の国 / 言語を選ぶ。
 *   - 選択済みは削除可能なチップ表示。
 *   - 検索ボックスで候補を絞り込み、クリックで追加(code で重複排除)。
 *   - 地域プリセット(北米/欧州…)は配下国を一括追加。
 *   - 特別値(全世界/全言語)は単独選択(選ぶと他をクリア、他を足すと特別値は外れる)。
 */
import * as React from "react"
import { X, ChevronDown } from "lucide-react"
import type { Opt } from "@/src/lib/regionLanguageMaster"
import { presetOptions } from "@/src/lib/regionLanguageMaster"

export function RegionLanguageSelect({
  value,
  onChange,
  options,
  presets,
  special,
  placeholder,
  disabled,
}: {
  value: Opt[]
  onChange: (next: Opt[]) => void
  options: Opt[]
  presets?: { label: string; codes: string[] }[]
  special?: Opt
  placeholder?: string
  disabled?: boolean
}) {
  const [q, setQ] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const has = (code: string) => value.some((v) => v.code === code)
  const isSpecial = !!special && value.length === 1 && value[0].code === special.code

  const add = (opts: Opt[]) => {
    // 特別値を選んだら単独、通常値を足したら特別値は外す。
    let base = special ? value.filter((v) => v.code !== special.code) : value.slice()
    for (const o of opts) if (!base.some((v) => v.code === o.code)) base.push(o)
    onChange(base)
  }
  const addSpecial = () => { if (special) onChange([special]) }
  const remove = (code: string) => onChange(value.filter((v) => v.code !== code))

  const filtered = options.filter(
    (o) => !has(o.code) && (!q.trim() || o.name.includes(q.trim()) || o.code.toLowerCase().includes(q.trim().toLowerCase()))
  )

  return (
    <div ref={boxRef} className="relative min-w-[180px] flex-1">
      {/* 選択チップ(プルダウンと分かるよう不透明背景＋右端に▾) */}
      <div
        className={`flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 pr-6 min-h-[30px] ${disabled ? "opacity-60" : "cursor-pointer hover:border-foreground/50"}`}
        onClick={() => !disabled && setOpen(true)}
      >
        <ChevronDown
          className={`pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
        {value.map((v) => (
          <span
            key={v.code}
            className={`inline-flex items-center gap-1 text-[10.5px] font-mono px-1.5 py-0.5 rounded ${
              special && v.code === special.code
                ? "bg-info/10 text-info dark:bg-info dark:text-info"
                : "bg-muted text-foreground"
            }`}
          >
            {v.name}
            {!disabled && (
              <button type="button" onClick={(e) => { e.stopPropagation(); remove(v.code) }} className="hover:text-destructive" title="外す">
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={value.length ? "" : placeholder || "選択…"}
            className="flex-1 min-w-[70px] bg-transparent text-[11px] py-0.5 px-1 focus:outline-none placeholder:text-muted-foreground/70 placeholder:text-[10.5px]"
          />
        )}
      </div>

      {/* ドロップダウン */}
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-w-[320px] rounded-md border border-border bg-popover shadow-lg p-2 space-y-2">
          {(presets?.length || special) && (
            <div className="flex flex-wrap gap-1 pb-1.5 border-b border-border">
              {special && (
                <button
                  type="button"
                  onClick={addSpecial}
                  className={`text-[10.5px] px-2 py-0.5 rounded border ${isSpecial ? "bg-info text-white border-info" : "border-info/40 text-info dark:text-info hover:bg-info/10 dark:hover:bg-info"}`}
                >
                  {special.name}
                </button>
              )}
              {presets?.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => add(presetOptions(p.codes))}
                  className="text-[10.5px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted"
                  title={`${p.label}の国を一括追加`}
                >
                  ＋{p.label}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-1 py-2">候補なし</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  onClick={() => { add([o]); setQ("") }}
                  className="block w-full text-left text-[11.5px] px-2 py-1 rounded hover:bg-muted"
                >
                  {o.name} <span className="text-[9px] text-muted-foreground/60">{o.code}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
