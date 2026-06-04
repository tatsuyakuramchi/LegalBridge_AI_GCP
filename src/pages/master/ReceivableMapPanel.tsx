import * as React from "react"
import { Search, ArrowRight, ChevronDown, Plus } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"

// 統合 P3-4: 分配構造マップ(作品中心) — search-api 専用だった /master/receivable-map を移植。
//   上流(当社が分配) ← 当社 ← 下流(当社が受領) の3層フローを系譜段で表示 + 別名名寄せ。

const KIND: Record<string, string> = {
  sublicense: "サブライセンス",
  publication: "出版印税",
  license_out: "ライセンスアウト",
  service: "役務・その他",
  other: "その他",
}
const DERIV: Record<string, string> = {
  translation: "翻訳",
  edition: "版",
  title_change: "改題",
  localization: "地域化",
  adaptation: "翻案",
}
const VIA: Record<string, string> = { title: "正式", alternative_title: "別タイトル", alias: "名寄せ別名" }

type Row = Record<string, any>
const yen = (n: any) => {
  const v = Number(n)
  return isFinite(v) ? v.toLocaleString("ja-JP") : ""
}
const workLabel = (w: Row) => (w.work_code ? w.work_code + " : " : "") + (w.title || "")

const jget = async (u: string) => {
  const r = await fetch(u)
  if (!r.ok) throw new Error("HTTP " + r.status)
  return r.json()
}

export function ReceivableMapPanel() {
  const { showNotification } = useAppData()
  const [works, setWorks] = React.useState<Row[]>([])
  const [workId, setWorkId] = React.useState("")
  const [data, setData] = React.useState<Row | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    ;(async () => {
      try {
        const d = await jget("/api/receivable-map/works")
        setWorks(d.rows || [])
      } catch {
        /* noop */
      }
    })()
  }, [])

  const loadMap = React.useCallback(async (id: string) => {
    if (!id) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const d = await jget("/api/receivable-map/lineage?work=" + encodeURIComponent(id))
      setData(d)
    } catch (e: any) {
      setError(e?.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const selectWork = (id: string) => {
    setWorkId(id)
    loadMap(id)
  }

  // ── 他社/改題タイトル → 作品 解決 (debounce) ──
  const [resolveQ, setResolveQ] = React.useState("")
  const [resolveRows, setResolveRows] = React.useState<Row[] | null>(null)
  React.useEffect(() => {
    if (!resolveQ.trim()) {
      setResolveRows(null)
      return
    }
    const t = setTimeout(async () => {
      try {
        const d = await jget("/api/receivable-map/resolve?q=" + encodeURIComponent(resolveQ.trim()))
        setResolveRows(d.rows || [])
      } catch {
        setResolveRows(null)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [resolveQ])

  const chain: Row[] = data?.chain || []
  const totals: Row = data?.totals || {}
  const anyRateUnknown = chain.some((n) => (n.upstream || []).some((u: Row) => u.rate_pct == null))

  return (
    <div className="space-y-4">
      {/* ピッカー */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono font-bold uppercase tracking-[0.12em] text-muted-foreground">作品:</span>
        <div className="min-w-[260px]">
          <NativeSelect value={workId} onChange={(e) => selectWork(e.target.value)}>
            <option value="">— 作品を選択 —</option>
            {works.map((w) => (
              <option key={w.id} value={w.id}>
                {workLabel(w)} ({w.deal_count}件)
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 min-w-[240px]"
            placeholder="他社/改題タイトルで作品検索…"
            value={resolveQ}
            onChange={(e) => setResolveQ(e.target.value)}
          />
          {resolveRows && (
            <div className="absolute z-30 top-10 left-0 min-w-[300px] max-h-[280px] overflow-auto bg-popover border border-border rounded-lg shadow-lg">
              {resolveRows.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">該当作品なし</div>
              ) : (
                resolveRows.map((r) => (
                  <button
                    key={r.id}
                    className="block w-full text-left px-3 py-2 text-xs border-b border-border hover:bg-muted/50"
                    onClick={() => {
                      selectWork(String(r.id))
                      setResolveQ("")
                      setResolveRows(null)
                    }}
                  >
                    {workLabel(r)}
                    <span className="ml-1.5 text-[10px] font-bold text-violet-600">
                      {VIA[r.matched_via] || r.matched_via}
                      {r.matched_via !== "title" && r.matched_text ? ": " + r.matched_text : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          受領のある作品を選ぶと系譜(上流分配←当社←下流受領)を表示。改題タイトルでも検索できます。
        </span>
      </div>

      {/* マップ */}
      {!workId ? (
        <div className="p-12 text-center text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground border border-dashed border-border rounded-lg">
          作品を選択してください。
        </div>
      ) : loading ? (
        <div className="p-12 text-center text-sm text-muted-foreground">読み込み中…</div>
      ) : error ? (
        <div className="p-12 text-center text-sm text-destructive">読み込み失敗: {error}</div>
      ) : chain.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">作品が見つかりません。</div>
      ) : (
        <div className="space-y-0">
          {/* 系譜合計 */}
          <div className="flex gap-6 flex-wrap rounded-2xl px-5 py-3 mb-4 text-white bg-gradient-to-br from-violet-500 to-violet-400">
            <Total k="系譜合計 受領" v={`¥${yen(totals.received)}`} />
            <Total k="上流へ分配" v={`− ¥${yen(totals.distributed)}`} />
            <Total k="当社 留保" v={`¥${yen(totals.retained)}`} />
          </div>

          {chain.map((n, i) => {
            const isSel = String(n.work?.id) === String(data?.selected_work_id)
            return (
              <React.Fragment key={n.work?.id ?? i}>
                <Tier n={n} isSel={isSel} />
                {i < chain.length - 1 && (
                  <div className="flex flex-col items-center text-violet-500 py-1.5">
                    <ChevronDown className="h-5 w-5" />
                    <span className="text-[10.5px] text-muted-foreground font-bold">
                      派生: {DERIV[chain[i + 1].derivation_type] || chain[i + 1].derivation_type || "派生"}
                    </span>
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {/* 子(派生)リンク */}
          {(data?.children || []).length > 0 && (
            <div className="mt-3.5 bg-card border border-border rounded-xl px-3.5 py-2.5">
              <b className="text-xs">この作品の派生(下位): </b>
              {data!.children.map((c: Row) => (
                <button
                  key={c.id}
                  className="inline-block mr-1.5 my-0.5 text-xs font-bold text-violet-600 bg-violet-50 rounded-xl px-2.5 py-0.5 hover:bg-violet-100"
                  onClick={() => selectWork(String(c.id))}
                >
                  {workLabel(c)}
                  {c.derivation_type ? ` (${DERIV[c.derivation_type] || c.derivation_type})` : ""}
                </button>
              ))}
            </div>
          )}

          {anyRateUnknown && (
            <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-3 py-2 text-xs">
              一部の上流で分配料率が未設定です。利用許諾/出版条件の金銭条件に料率を入れると分配額が自動算定されます。
            </div>
          )}

          {/* 別名名寄せ */}
          <AliasPanel workId={workId} showNotification={showNotification} />
        </div>
      )}
    </div>
  )
}

function Total({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] opacity-90">{k}</div>
      <div className="text-lg font-bold">{v}</div>
    </div>
  )
}

function Tier({ n, isSel }: { n: Row; isSel: boolean }) {
  const w = n.work || {}
  const ups: Row[] = n.upstream || []
  const downs: Row[] = n.downstream || []
  const deriv = n.derivation_type ? DERIV[n.derivation_type] || n.derivation_type : w.is_original ? "原版" : null
  const retained = (n.cascade_base || n.received || 0) - (n.distributed || 0)
  return (
    <div className={`rounded-2xl px-3.5 py-3 bg-card/60 border ${isSel ? "border-violet-500 ring-2 ring-violet-500/20" : "border-border"}`}>
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="font-bold text-sm">{workLabel(w)}</span>
        {deriv && <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{deriv}</Badge>}
        {isSel && <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">選択中</Badge>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_44px_1fr_44px_1fr] gap-3 items-stretch">
        {/* 上流 */}
        <div className="flex flex-col gap-3 min-w-0">
          <h3 className="text-xs font-bold text-muted-foreground">⬆ 上流(当社が分配)</h3>
          {ups.length ? ups.map((u, i) => <React.Fragment key={i}><NodeUp u={u} /></React.Fragment>) : <Empty>上流(license-in)なし</Empty>}
        </div>
        <Arrow label="分配" />
        {/* 当社 */}
        <div className="flex flex-col gap-3 min-w-0">
          <h3 className="text-xs font-bold text-muted-foreground">● 当社</h3>
          <div className="rounded-2xl p-3.5 text-white bg-gradient-to-br from-violet-500 to-violet-400 shadow-lg shadow-violet-500/30">
            <div className="font-bold text-sm">当社</div>
            <BigRow k="受領(直接)" v={`¥${yen(n.received)}`} />
            {(n.cascade_base || 0) > (n.received || 0) && <BigRow k="分配基礎(累計)" v={`¥${yen(n.cascade_base)}`} />}
            <BigRow k="上流へ分配" v={`− ¥${yen(n.distributed)}`} />
            <div className="flex justify-between gap-2.5 mt-1.5 pt-1.5 border-t border-white/35">
              <span className="text-xs">留保</span>
              <b className="text-base">¥{yen(retained)}</b>
            </div>
            {(n.all_received || 0) > (n.received || 0) && (
              <div className="text-[11px] opacity-85 mt-1.5">※ 全受領 ¥{yen(n.all_received)}</div>
            )}
          </div>
        </div>
        <Arrow label="受領" />
        {/* 下流 */}
        <div className="flex flex-col gap-3 min-w-0">
          <h3 className="text-xs font-bold text-muted-foreground">⬇ 下流(当社が受領)</h3>
          {downs.length ? downs.map((r, i) => <React.Fragment key={i}><NodeDown r={r} /></React.Fragment>) : <Empty>受領(下流)なし</Empty>}
        </div>
      </div>
    </div>
  )
}

function NodeUp({ u }: { u: Row }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-3.5 border-l-4 border-l-orange-400 shadow-sm">
      <div className="font-bold text-sm">{u.licensor_name || "(ライセンサー未設定)"}</div>
      <div className="text-[11.5px] text-muted-foreground mt-0.5">
        {u.source_ip_title ? `原作: ${u.source_ip_title} ` : ""}
        {u.document_number ? `· ${u.document_number}` : ""}
      </div>
      <div className="text-[11.5px] mt-0.5">
        {u.rate_pct == null ? (
          <span className="text-amber-700 bg-amber-50 rounded-lg px-1.5 font-bold">料率未設定</span>
        ) : (
          <span className="text-amber-700 bg-amber-50 rounded-lg px-1.5 font-bold">
            料率 {u.rate_pct}%{u.rate_basis ? <span className="text-muted-foreground font-normal"> ({u.rate_basis})</span> : null}
          </span>
        )}
      </div>
      <div className="font-bold mt-2 text-[15px] tabular-nums">
        分配 {u.inherited ? <small className="text-muted-foreground font-semibold text-[11px]">上位段で計上済</small> : u.distribute_amount == null ? <small className="text-muted-foreground font-semibold text-[11px]">(料率未設定のため算定不可)</small> : `¥${yen(u.distribute_amount)}`}
      </div>
    </div>
  )
}

function NodeDown({ r }: { r: Row }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-3.5 border-l-4 border-l-emerald-400 shadow-sm">
      <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
        {r.sublicensee_name || "(相手方未設定)"}
        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{KIND[r.receivable_kind] || r.receivable_kind}</Badge>
      </div>
      {r.source_contract_number && <div className="text-[11.5px] text-muted-foreground mt-0.5">{r.source_contract_number}</div>}
      <div className="font-bold mt-2 text-[15px] tabular-nums">受領 {r.currency} {yen(r.received)}</div>
    </div>
  )
}

function BigRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2.5 mt-2 text-[13px]">
      <span>{k}</span>
      <b className="text-base">{v}</b>
    </div>
  )
}
function Arrow({ label }: { label: string }) {
  return (
    <div className="hidden lg:flex flex-col items-center justify-center text-violet-500">
      <ArrowRight className="h-6 w-6" />
      <span className="text-[10px] text-muted-foreground mt-1">{label}</span>
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground text-xs p-2">{children}</div>
}

function AliasPanel({
  workId,
  showNotification,
}: {
  workId: string
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}) {
  const [rows, setRows] = React.useState<Row[]>([])
  const [title, setTitle] = React.useState("")
  const [ctx, setCtx] = React.useState("")

  const reload = React.useCallback(async () => {
    try {
      const d = await jget("/api/works/" + encodeURIComponent(workId) + "/aliases")
      setRows(d.rows || [])
    } catch {
      setRows([])
    }
  }, [workId])

  React.useEffect(() => {
    reload()
  }, [reload])

  const add = async () => {
    if (!title.trim()) {
      showNotification("別名を入力してください", "error")
      return
    }
    try {
      const res = await fetch("/api/works/" + encodeURIComponent(workId) + "/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias_title: title.trim(), context: ctx.trim() || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || "HTTP " + res.status)
      setTitle("")
      setCtx("")
      reload()
    } catch (e: any) {
      showNotification(`追加に失敗: ${e?.message || e}`, "error")
    }
  }
  const del = async (id: number) => {
    if (!confirm("この別名を削除しますか?")) return
    try {
      const res = await fetch("/api/work-aliases/" + id, { method: "DELETE" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || "HTTP " + res.status)
      reload()
    } catch (e: any) {
      showNotification(`削除に失敗: ${e?.message || e}`, "error")
    }
  }

  return (
    <div className="mt-4 bg-card border border-border rounded-2xl px-4 py-3.5 shadow-sm">
      <h3 className="text-[13px] font-bold mb-2">📝 タイトル別名(他社/改題タイトルの名寄せ)</h3>
      {rows.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          別名は未登録です。他社が付けた改題タイトル等を登録すると、その名称で作品を検索できます。
        </div>
      ) : (
        rows.map((a) => (
          <div key={a.id} className="flex items-center gap-2 py-1.5 border-b border-border text-xs flex-wrap">
            <b>{a.alias_title}</b>
            {a.party_name && <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{a.party_name}</Badge>}
            {a.context && <span className="text-muted-foreground text-[11px]">{a.context}</span>}
            <span className="flex-1" />
            <button className="text-pink-600 font-bold" onClick={() => del(a.id)}>
              削除
            </button>
          </div>
        ))
      )}
      <div className="flex gap-2 mt-2.5 flex-wrap">
        <Input className="min-w-[220px] flex-1" placeholder="別名(例: K社の出版タイトル)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input className="min-w-[200px] flex-1" placeholder="文脈(例: K社 海外出版版)" value={ctx} onChange={(e) => setCtx(e.target.value)} />
        <Button size="sm" onClick={add}>
          <Plus />
          別名を追加
        </Button>
      </div>
    </div>
  )
}
