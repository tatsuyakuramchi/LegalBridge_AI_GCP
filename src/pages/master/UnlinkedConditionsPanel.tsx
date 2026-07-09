/**
 * UnlinkedConditionsPanel — 未リンク利用許諾CL 棚卸し 専用画面。
 *
 * 発注書(受託者帰属の成果物)などを作成した際、原作台帳/素材番号が無いと利用許諾条件(CL)は
 * condition_lines として保存されるが source_material_id が付かず「素材未リンク」のまま残る
 * (lc-candidates にも出ない)。本画面はそれを全文書横断で棚卸しし、原作マテリアルへまとめて
 * 後付けリンク(新規作成しない＝二重CLを作らない)する。
 *
 *   - 一覧   : GET  /api/v3/unlinked-license-conditions?q=      (source_material_id IS NULL の license CL)
 *   - リンク : POST /api/v3/source-ips/:id/materials/:mid/link-conditions { condition_line_ids }
 *              既存CLに source_material_id/source_work_id を後付け(新規作成なし)。
 */
import * as React from "react"
import { Link2, Loader2, Search, RefreshCw, FileText } from "lucide-react"

import { cn } from "@/lib/utils"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import { EntitySearchSelect, type EntityOption } from "@/src/components/search/EntitySearch"

type UnlinkedCL = {
  id: number
  subject: string | null
  payment_scheme: string | null
  rate_pct: number | null
  mg_amount: number | null
  ag_amount: number | null
  base_price_label: string | null
  calc_method: string | null
  currency: string | null
  region_language_label: string | null
  document_number: string | null
  contract_title: string | null
  record_type: string | null
}

const summarize = (c: UnlinkedCL): string => {
  const p: string[] = []
  if (c.rate_pct != null) p.push(`料率 ${c.rate_pct}%`)
  if (c.mg_amount) p.push(`MG ¥${Number(c.mg_amount).toLocaleString("ja-JP")}`)
  if (c.ag_amount) p.push(`AG ¥${Number(c.ag_amount).toLocaleString("ja-JP")}`)
  if (c.base_price_label) p.push(String(c.base_price_label))
  if (c.region_language_label) p.push(String(c.region_language_label))
  if (c.payment_scheme && c.payment_scheme !== "royalty") p.push(String(c.payment_scheme))
  return p.join(" / ") || "(条件詳細なし)"
}

export function UnlinkedConditionsPanel() {
  const { push } = useToast()

  const [q, setQ] = React.useState("")
  const [rows, setRows] = React.useState<UnlinkedCL[]>([])
  const [loading, setLoading] = React.useState(false)
  const [checked, setChecked] = React.useState<Set<number>>(new Set())

  // リンク先: 原作(source_ip) → 素材
  const [sip, setSip] = React.useState<EntityOption | null>(null)
  const [materials, setMaterials] = React.useState<any[]>([])
  const [matId, setMatId] = React.useState<string>("")
  const [matLoading, setMatLoading] = React.useState(false)
  const [linking, setLinking] = React.useState(false)

  const load = React.useCallback(async (query: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v3/unlinked-license-conditions${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      const d = await r.json()
      setRows(Array.isArray(d) ? d : [])
      setChecked(new Set())
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const t = setTimeout(() => void load(q), 300)
    return () => clearTimeout(t)
  }, [q, load])

  // 原作を選んだら素材一覧を取得
  React.useEffect(() => {
    const id = sip?.id
    if (!id) { setMaterials([]); setMatId(""); return }
    let alive = true
    setMatLoading(true)
    fetch(`/api/v3/works/${encodeURIComponent(id)}/materials`)
      .then((r) => r.json())
      .then((d) => { if (alive) setMaterials(Array.isArray(d) ? d : []) })
      .catch(() => { if (alive) setMaterials([]) })
      .finally(() => { if (alive) setMatLoading(false) })
    return () => { alive = false }
  }, [sip?.id])

  const toggle = (id: number) =>
    setChecked((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })

  const toggleDoc = (docNo: string | null, on: boolean) =>
    setChecked((prev) => {
      const n = new Set(prev)
      for (const r of rows) {
        if ((r.document_number || "") === (docNo || "")) {
          if (on) n.add(r.id); else n.delete(r.id)
        }
      }
      return n
    })

  const linkSelected = async () => {
    if (!sip?.id) { push("リンク先の原作を選んでください", "error"); return }
    if (!matId) { push("リンク先の原作マテリアルを選んでください", "error"); return }
    if (checked.size === 0) { push("リンクするCLを選択してください", "error"); return }
    setLinking(true)
    try {
      const ids = [...checked]
      const r = await fetch(
        `/api/v3/source-ips/${encodeURIComponent(sip.id)}/materials/${encodeURIComponent(matId)}/link-conditions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ condition_line_ids: ids }) }
      )
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const linkedIds = new Set<number>((j.ids || []).map((x: any) => Number(x)))
      setRows((cs) => cs.filter((x) => !linkedIds.has(x.id)))
      setChecked(new Set())
      const mat = materials.find((m) => String(m.id) === String(matId))
      push(`${j.linked} 件のCLを ${mat?.material_code || "素材"} にリンクしました（新規作成なし＝二重化なし）`, "success")
    } catch (e: any) {
      push(`リンクに失敗しました: ${String(e?.message || e)}`, "error")
    } finally {
      setLinking(false)
    }
  }

  // 文書ごとにグルーピング
  const groups = React.useMemo(() => {
    const m = new Map<string, UnlinkedCL[]>()
    for (const r of rows) {
      const k = r.document_number || "(番号なし)"
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()]
  }, [rows])

  const inputCls =
    "w-full text-xs font-mono bg-transparent border border-input rounded px-2 py-1.5 focus:outline-none focus:border-foreground transition-colors"

  return (
    <div className="space-y-5">
      <div>
        <p className="retro-tag mb-1.5">MST · UNLINKED CL</p>
        <h3 className="text-lg font-mono font-bold tracking-tight">未リンク利用許諾CL 棚卸し</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1 leading-snug">
          発注書(受託者帰属)などで発生した「素材未割当の利用許諾条件(CL)」を、原作マテリアルへ
          まとめて後付けリンクします。<b>新規作成しない＝二重CLを作りません</b>。リンクすると
          原作ビュー・利用許諾料計算書・条件引用(lc-candidates)に正しく出るようになります。
        </p>
      </div>

      {/* リンク先の指定 */}
      <div className="rounded-md border border-border bg-muted/20 px-3 py-3 space-y-2">
        <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
          リンク先 — 原作 / 原作マテリアル
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <EntitySearchSelect
            entity="source_ip"
            value={sip?.id ?? null}
            onSelect={(o) => setSip(o)}
            placeholder="原作を検索（LO-コード / タイトル）"
          />
          <div>
            <NativeSelect value={matId} onChange={(e) => setMatId(e.target.value)} disabled={!sip || matLoading}>
              <option value="">
                {!sip ? "先に原作を選択" : matLoading ? "読込中…" : materials.length === 0 ? "素材なし" : "リンク先の素材を選択"}
              </option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.material_code}] {m.material_name || "(無題)"}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      {/* 検索 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="文書番号 / 件名で絞り込み（例: ARC-PO-2026-0083）"
            className={cn(inputCls, "pl-8")}
          />
        </div>
        <button
          type="button"
          onClick={() => void load(q)}
          className="inline-flex items-center gap-1.5 border border-border rounded px-3 py-1.5 font-mono text-[11px] hover:bg-muted"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 再読込
        </button>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…
        </div>
      ) : rows.length === 0 ? (
        <div className="font-mono text-[11px] text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          未リンクの利用許諾CLはありません。
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([docNo, list]) => {
            const allOn = list.every((r) => checked.has(r.id))
            return (
              <div key={docNo} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => toggleDoc(list[0]?.document_number ?? null, e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <FileText className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="font-mono text-[11px] font-bold">{docNo}</span>
                  {list[0]?.contract_title && (
                    <span className="font-mono text-[10px] text-muted-foreground truncate">{list[0].contract_title}</span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{list.length} 件</span>
                </div>
                <ul className="divide-y divide-border">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                      <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} className="h-3.5 w-3.5" />
                      <div className="min-w-0 flex-1 font-mono text-[10.5px]">
                        <span className="font-bold">CL #{c.id}</span>
                        {c.subject ? ` / ${c.subject}` : ""}
                        <span className="text-muted-foreground"> — {summarize(c)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {/* フッタ: 一括リンク */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background/95 backdrop-blur px-1 py-3">
        <span className="font-mono text-[11px] text-muted-foreground">
          選択 {checked.size} 件
          {sip && matId && (
            <> → <b>{materials.find((m) => String(m.id) === String(matId))?.material_code || "素材"}</b> へ</>
          )}
        </span>
        <button
          type="button"
          onClick={() => void linkSelected()}
          disabled={linking || checked.size === 0 || !sip || !matId}
          className="ml-auto inline-flex items-center gap-1.5 bg-foreground text-background rounded px-4 py-2 font-mono text-[11px] font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          選択したCLを素材にリンク
        </button>
      </div>
    </div>
  )
}
