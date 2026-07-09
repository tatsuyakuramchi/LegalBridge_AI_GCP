/**
 * BillingTablePanel — 請求・分配テーブル（再許諾の受領記録＋ライセンサーへの分配）。
 *
 * 作品を選ぶ → その再許諾条件(sublicense_out)ごとに、受領記録(condition_receipts)を
 * 一覧・追加する。各受領には次の2つの計算が載る:
 *   受領再許諾料 = basis=manufacturing ? 報告数量×単価×料率 : 報告売上×料率  （当社が受け取る）
 *   ライセンサーへ支払(分配) = 基準額 × 個数 × 親ライセンスイン料率              （当社が上流へ払う）
 * 親ライセンスイン条件は condition_lines.parent_license_condition_id(0114) で辿る。
 * 保存すると、受領→入金台帳(payments inbound)、分配→出金台帳(payments outbound) に同期される。
 *
 *   条件一覧 : GET  /api/v3/works/:id/sublicense-conditions
 *   受領一覧 : GET  /api/v3/work-conditions/:cid/receipts
 *   受領追加 : POST /api/v3/work-conditions/:cid/receipts
 *   受領削除 : DELETE /api/v3/condition-receipts/:rid
 */
import * as React from "react"
import { Loader2, Plus, Trash2, Coins, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import { EntitySearchSelect, type EntityOption } from "@/src/components/search/EntitySearch"

const yen = (n: any, cur = "JPY") =>
  n == null || n === "" ? "—" : `${cur === "JPY" ? "¥" : cur + " "}${Number(n).toLocaleString("ja-JP")}`
const num = (v: any) => (v == null || v === "" ? null : Number(v))

// 数量ベース(プロダクトアウト)判定。basis は cfc VIEW で NULL のため calc_type で判定。
const isQtyBased = (cond: any) =>
  ["BASE_QTY_RATE", "SUPPLY_QTY"].includes(String(cond?.calc_type || "").toUpperCase()) ||
  cond?.basis === "manufacturing"

// クライアント側プレビュー計算（サーバの computeRoyalty / 分配式のミラー）。
const previewRoyalty = (cond: any, sales: any, qty: any) => {
  const rate = Number(cond?.rate_pct) || 0
  const base = isQtyBased(cond) ? (Number(qty) || 0) * (Number(cond?.unit_price) || 0) : Number(sales) || 0
  return Math.round(base * (rate / 100) * 100) / 100
}
const previewDistribution = (cond: any, royalty: number, _sales: any, qty: any, baseOv: any, qtyOv: any) => {
  const parentRate = cond?.parent_rate_pct != null ? Number(cond.parent_rate_pct) : null
  if (parentRate == null) return null
  let base = num(baseOv)
  let q = num(qtyOv)
  if (base == null) {
    if (isQtyBased(cond)) { base = Number(cond?.unit_price) || 0; if (q == null) q = Number(qty) || 1 }
    else { base = royalty || 0; if (q == null) q = 1 }
  }
  if (q == null) q = 1
  return Math.round(base * q * (parentRate / 100) * 100) / 100
}

const blankDraft = () => ({ period: "", reported_sales: "", reported_quantity: "", received_amount: "", received_date: "", distribution_base: "", distribution_qty: "", note: "" })

const inputCls = "w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
const labelCls = "text-[9px] font-mono font-bold uppercase tracking-[0.12em] text-muted-foreground"

const ConditionCard: React.FC<{ cond: any; push: (m: string, v?: any) => void }> = ({ cond, push }) => {
  const cid = cond.id
  const [receipts, setReceipts] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(blankDraft())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v3/work-conditions/${cid}/receipts`)
      const d = await r.json()
      setReceipts(Array.isArray(d) ? d : [])
    } catch { setReceipts([]) } finally { setLoading(false) }
  }, [cid])
  React.useEffect(() => { void load() }, [load])

  const hasParent = cond.parent_license_condition_id != null
  const draftRoyalty = previewRoyalty(cond, draft.reported_sales, draft.reported_quantity)
  const draftDist = previewDistribution(cond, draftRoyalty, draft.reported_sales, draft.reported_quantity, draft.distribution_base, draft.distribution_qty)

  const add = async () => {
    if (!draft.period && !draft.reported_sales && !draft.reported_quantity && !draft.received_amount) {
      push("期間か報告値/受領額を入力してください", "error"); return
    }
    setSaving(true)
    try {
      const body: any = {
        period: draft.period || null,
        period_date: draft.period ? `${draft.period}-01` : null,
        reported_sales: num(draft.reported_sales),
        reported_quantity: num(draft.reported_quantity),
        received_amount: num(draft.received_amount),
        received_date: draft.received_date || null,
        distribution_base: num(draft.distribution_base),
        distribution_qty: num(draft.distribution_qty),
        note: draft.note || null,
      }
      const r = await fetch(`/api/v3/work-conditions/${cid}/receipts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setDraft(blankDraft())
      await load()
      push("受領記録を追加しました（受領→入金台帳 / 分配→出金台帳へ同期）", "success")
    } catch (e: any) {
      push(`追加に失敗しました: ${String(e?.message || e)}`, "error")
    } finally { setSaving(false) }
  }

  const del = async (rid: number) => {
    try {
      const r = await fetch(`/api/v3/condition-receipts/${rid}`, { method: "DELETE" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await load()
      push("受領記録を削除しました（台帳も掃除）", "success")
    } catch (e: any) { push(`削除に失敗: ${String(e?.message || e)}`, "error") }
  }

  const totalRecv = receipts.reduce((s, x) => s + (Number(x.computed_royalty_ex_tax) || 0), 0)
  const totalDist = receipts.reduce((s, x) => s + (Number(x.computed_distribution_ex_tax) || 0), 0)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/40 border-b border-border space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Coins className="h-3.5 w-3.5 text-amber-600" />
          <span className="font-mono text-[11px] font-bold">
            再許諾条件 #{cond.condition_no ?? cid}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {cond.counterparty_name || "（再許諾先未設定）"} / 料率 {cond.rate_pct ?? "—"}%
            {isQtyBased(cond) ? ` / 卸値 ${yen(cond.unit_price, cond.currency)}×数量` : " / 売上×料率"}
            {cond.region_language_label ? ` / ${cond.region_language_label}` : ""}
          </span>
        </div>
        <div className="font-mono text-[10px]">
          {hasParent ? (
            <span className="text-emerald-700">
              親ライセンスイン: {cond.licensor_name || "（ライセンサー未設定）"} 料率 {cond.parent_rate_pct ?? "—"}%
              {cond.licensor_work_title ? `（源泉: ${cond.licensor_work_title}）` : ""} → 分配算出可
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-3 w-3" /> 親ライセンスイン条件が未リンク → 分配は算出されません（再許諾条件登録で料率元を紐づけてください）
            </span>
          )}
        </div>
      </div>

      <div className="p-3 overflow-x-auto">
        {loading ? (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 受領記録を読み込み中…
          </div>
        ) : (
          <table className="w-full text-[10.5px] font-mono border-collapse min-w-[820px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left font-bold py-1 pr-2">期間</th>
                <th className="text-right font-bold py-1 px-2">報告売上</th>
                <th className="text-right font-bold py-1 px-2">報告数量</th>
                <th className="text-right font-bold py-1 px-2 text-sky-700">受領再許諾料</th>
                <th className="text-right font-bold py-1 px-2">受領額</th>
                <th className="text-left font-bold py-1 px-2">受領日</th>
                <th className="text-right font-bold py-1 px-2">分配基準額</th>
                <th className="text-right font-bold py-1 px-2">個数</th>
                <th className="text-right font-bold py-1 px-2 text-rose-700">→ライセンサー支払</th>
                <th className="py-1 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((x) => (
                <tr key={x.id} className="border-b border-border/60">
                  <td className="py-1 pr-2">{x.period || "—"}</td>
                  <td className="text-right py-1 px-2">{yen(x.reported_sales, cond.currency)}</td>
                  <td className="text-right py-1 px-2">{x.reported_quantity ?? "—"}</td>
                  <td className="text-right py-1 px-2 font-bold text-sky-700">{yen(x.computed_royalty_ex_tax, cond.currency)}</td>
                  <td className="text-right py-1 px-2">{yen(x.received_amount, cond.currency)}</td>
                  <td className="py-1 px-2">{x.received_date || "—"}</td>
                  <td className="text-right py-1 px-2">{yen(x.distribution_base, cond.currency)}</td>
                  <td className="text-right py-1 px-2">{x.distribution_qty ?? "—"}</td>
                  <td className="text-right py-1 px-2 font-bold text-rose-700">{yen(x.computed_distribution_ex_tax, cond.currency)}</td>
                  <td className="py-1 pl-2 text-right">
                    <button type="button" onClick={() => void del(x.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && (
                <tr><td colSpan={10} className="text-center text-muted-foreground py-2">受領記録なし</td></tr>
              )}
              {receipts.length > 0 && (
                <tr className="border-t border-border font-bold">
                  <td className="py-1 pr-2" colSpan={3}>合計</td>
                  <td className="text-right py-1 px-2 text-sky-700">{yen(totalRecv, cond.currency)}</td>
                  <td colSpan={4}></td>
                  <td className="text-right py-1 px-2 text-rose-700">{yen(totalDist, cond.currency)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* 受領記録の追加 */}
        <div className="mt-3 pt-3 border-t border-dashed border-border">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
            <div><label className={labelCls}>期間(YYYY-MM)</label><input className={inputCls} value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })} placeholder="2026-03" /></div>
            <div><label className={labelCls}>報告売上</label><input className={inputCls} type="number" value={draft.reported_sales} onChange={(e) => setDraft({ ...draft, reported_sales: e.target.value })} disabled={isQtyBased(cond)} /></div>
            <div><label className={labelCls}>報告数量</label><input className={inputCls} type="number" value={draft.reported_quantity} onChange={(e) => setDraft({ ...draft, reported_quantity: e.target.value })} /></div>
            <div><label className={cn(labelCls, "text-sky-700")}>受領再許諾料(計算)</label><div className="text-[11px] font-mono font-bold text-sky-700 py-1">{yen(draftRoyalty, cond.currency)}</div></div>
            <div><label className={labelCls}>受領額</label><input className={inputCls} type="number" value={draft.received_amount} onChange={(e) => setDraft({ ...draft, received_amount: e.target.value })} /></div>
            <div><label className={labelCls}>受領日</label><input className={inputCls} type="date" value={draft.received_date} onChange={(e) => setDraft({ ...draft, received_date: e.target.value })} /></div>
            <div><label className={labelCls}>分配基準額(既定上書)</label><input className={inputCls} type="number" value={draft.distribution_base} onChange={(e) => setDraft({ ...draft, distribution_base: e.target.value })} placeholder={isQtyBased(cond) ? "既定=卸値" : "既定=受領料"} /></div>
            <div><label className={labelCls}>個数(既定上書)</label><input className={inputCls} type="number" value={draft.distribution_qty} onChange={(e) => setDraft({ ...draft, distribution_qty: e.target.value })} placeholder={isQtyBased(cond) ? "既定=数量" : "既定=1"} /></div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="font-mono text-[10px] text-rose-700">
              → ライセンサー支払(分配)予測: <b>{draftDist == null ? "（親未リンク）" : yen(draftDist, cond.parent_currency || cond.currency)}</b>
            </span>
            <button type="button" onClick={() => void add()} disabled={saving}
              className="ml-auto inline-flex items-center gap-1.5 bg-foreground text-background rounded px-3 py-1.5 font-mono text-[10px] font-bold hover:opacity-90 disabled:opacity-40">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} 受領記録を追加
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BillingTablePanel() {
  const { push } = useToast()
  const [work, setWork] = React.useState<EntityOption | null>(null)
  const [conds, setConds] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)

  const workId = work?.id || ""
  React.useEffect(() => {
    if (!workId) { setConds([]); return }
    let alive = true
    setLoading(true)
    fetch(`/api/v3/works/${encodeURIComponent(workId)}/sublicense-conditions`)
      .then((r) => r.json())
      .then((d) => { if (alive) setConds(Array.isArray(d) ? d : []) })
      .catch(() => { if (alive) setConds([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [workId])

  return (
    <div className="space-y-5">
      <div>
        <p className="retro-tag mb-1.5">MST · BILLING</p>
        <h3 className="text-lg font-mono font-bold tracking-tight">請求・分配テーブル（再許諾）</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1 leading-snug">
          作品の<b>再許諾条件（sublicense_out）</b>ごとに、受領記録を入力します。
          <span className="inline-flex items-center gap-1 mx-1"><ArrowDownToLine className="h-3 w-3 text-sky-700" />受領再許諾料</span>（当社が受領）と、
          <span className="inline-flex items-center gap-1 mx-1"><ArrowUpFromLine className="h-3 w-3 text-rose-700" />ライセンサーへ支払（分配＝基準額×個数×親ライセンスイン料率）</span>
          をライブ計算し、入金/出金台帳（payments）へ同期します。
        </p>
      </div>

      <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
        <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">対象作品</div>
        <EntitySearchSelect entity="work" value={work?.id ?? null} onSelect={(o) => setWork(o)} placeholder="作品を検索（コード / タイトル）" />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> 再許諾条件を読み込み中…
        </div>
      ) : !workId ? (
        <div className="font-mono text-[11px] text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          作品を選択してください。
        </div>
      ) : conds.length === 0 ? (
        <div className="font-mono text-[11px] text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          この作品に再許諾条件（sublicense_out）はありません。「再許諾条件登録」で登録してください。
        </div>
      ) : (
        <div className="space-y-3">
          {conds.map((c) => <ConditionCard key={c.id} cond={c} push={push} />)}
        </div>
      )}
    </div>
  )
}
