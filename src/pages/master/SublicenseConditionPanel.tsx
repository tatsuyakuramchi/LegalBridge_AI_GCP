/**
 * SublicenseConditionPanel — 再許諾条件登録（作品 × 再許諾先）。
 *
 * 自社作品を再許諾（②権利許諾）／自社製造他社販売（③プロダクトアウト）する条件を、
 * 作品 × 再許諾先ごとに登録する専用画面。ここは「条件登録」に専念し、再許諾料の
 * ライブ計算・受領記録・分配表示は請求テーブル画面で行う（この条件が源泉）。
 *
 * 計算モデル: 基準価格 × 個数 × 料率 を軸に、実効料率／固定額／サブスク／供給価格 も選択可
 * (V3_CALC_MODELS)。権利許諾は個数=1、1個あたり固定額は「基準価格=固定額・料率100%」で表現。
 *
 * 保存は既存の sublicense_out 条件 API をそのまま利用(バックエンド追加なし):
 *   - GET    /api/v3/works/:id/conditions           (kind='sublicense_out' を抽出)
 *   - POST   /api/v3/works/:id/conditions           (condition_kind='sublicense_out', counterparty_vendor_id)
 *   - PUT    /api/v3/work-conditions/:cid
 *   - DELETE /api/v3/work-conditions/:cid
 */
import * as React from "react"
import { Coins, Loader2, Search, Trash2, Plus, Save, Building2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { NativeSelect } from "@/components/ui/native-select"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { EntitySearchSelect, type EntityOption } from "@/src/components/search/EntitySearch"
import { V3_CALC_MODELS } from "@/src/components/document/V3LicenseMatrix"

type CondDraft = {
  key: string
  id?: number
  /** 分配計算の源泉となる親ライセンスイン条件(capability_financial_conditions.id)。 */
  parent_license_condition_id?: number
  calc_type: string
  condition_name: string
  base_price_label: string
  rate_pct: string
  mg_amount: string
  ag_amount: string
  currency: string
  region_language_label: string
  term_start: string
  term_end: string
}

let _seq = 0
const blankDraft = (): CondDraft => ({
  key: `c${++_seq}`,
  calc_type: "BASE_QTY_RATE",
  condition_name: "",
  base_price_label: "",
  rate_pct: "",
  mg_amount: "",
  ag_amount: "",
  currency: "JPY",
  region_language_label: "",
  term_start: "",
  term_end: "",
})

// 計算モデルごとの基準価格プレースホルダ。
const basePriceHint: Record<string, string> = {
  BASE_QTY_RATE: "上代/卸値（1個あたり）",
  BASE_RATE: "許諾収入（基準額）",
  FIXED: "固定額（例: 500,000）",
  SUBSCRIPTION: "月額 / 年額",
  SUPPLY_QTY: "供給価格（1個あたり）",
}
// 供給/製造モデルは製造ベース、それ以外は売上ベースとして basis を導出。
const basisForCalc = (calc: string) => (calc === "SUPPLY_QTY" ? "manufacturing" : "sales")

const num = (v: string) => (v == null || v.trim() === "" ? null : Number(v))

export function SublicenseConditionPanel() {
  const { push } = useToast()

  const [work, setWork] = React.useState<EntityOption | null>(null)
  const workId = work?.id || ""
  const [vendor, setVendor] = React.useState<EntityOption | null>(null)
  const vendorId = vendor?.id || ""

  const [drafts, setDrafts] = React.useState<CondDraft[]>([])
  const [loading, setLoading] = React.useState(false)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)

  // 分配の料率元: 源泉ライセンスイン原作 と その license_in 条件(親候補)。
  const [sourceIp, setSourceIp] = React.useState<EntityOption | null>(null)
  const [licenseInConds, setLicenseInConds] = React.useState<any[]>([])
  const loadLicenseIn = React.useCallback(async (sid: string) => {
    if (!sid) { setLicenseInConds([]); return }
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(sid)}/conditions`)
      const rows = await r.json()
      setLicenseInConds((Array.isArray(rows) ? rows : []).filter((c) => c.condition_kind === "license_in"))
    } catch {
      setLicenseInConds([])
    }
  }, [])
  const licenseInLabel = (c: any) =>
    `${c.condition_name || c.calc_type || `条件#${c.id}`}${c.rate_pct != null ? ` ・ ${c.rate_pct}%` : ""}${c.region_language_label ? ` ・ ${c.region_language_label}` : ""}`

  // 選択中の作品×再許諾先の sublicense_out 条件を読み込む。
  const load = React.useCallback(async (wid: string, vid: string) => {
    if (!wid || !vid) { setDrafts([]); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(wid)}/conditions`)
      const rows = await r.json()
      const arr: any[] = Array.isArray(rows) ? rows : []
      const mine = arr.filter(
        (c) => c.condition_kind === "sublicense_out" && String(c.counterparty_vendor_id ?? "") === String(vid)
      )
      setDrafts(
        mine.map((c) => ({
          key: `c${++_seq}`,
          id: Number(c.id),
          parent_license_condition_id: c.parent_license_condition_id != null ? Number(c.parent_license_condition_id) : undefined,
          calc_type: c.calc_type || "BASE_QTY_RATE",
          condition_name: c.condition_name || "",
          base_price_label: c.base_price_label || "",
          rate_pct: c.rate_pct != null ? String(c.rate_pct) : "",
          mg_amount: c.mg_amount != null && Number(c.mg_amount) > 0 ? String(c.mg_amount) : "",
          ag_amount: c.ag_amount != null && Number(c.ag_amount) > 0 ? String(c.ag_amount) : "",
          currency: c.currency || "JPY",
          region_language_label: c.region_language_label || "",
          term_start: c.term_start ? String(c.term_start).slice(0, 10) : "",
          term_end: c.term_end ? String(c.term_end).slice(0, 10) : "",
        }))
      )
    } catch {
      setDrafts([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load(workId, vendorId)
  }, [workId, vendorId, load])

  const patch = (key: string, p: Partial<CondDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)))
  const addRow = () => setDrafts((ds) => [...ds, blankDraft()])

  const bodyOf = (d: CondDraft) => ({
    condition_kind: "sublicense_out",
    counterparty_vendor_id: Number(vendorId),
    parent_license_condition_id: d.parent_license_condition_id ?? null,
    calc_type: d.calc_type,
    calc_method: "ROYALTY",
    basis: basisForCalc(d.calc_type),
    condition_name: d.condition_name.trim() || null,
    base_price_label: d.base_price_label.trim() || null,
    rate_pct: num(d.rate_pct),
    mg_amount: num(d.mg_amount) ?? 0,
    ag_amount: num(d.ag_amount) ?? 0,
    currency: d.currency || "JPY",
    region_language_label: d.region_language_label.trim() || null,
    term_start: d.term_start || null,
    term_end: d.term_end || null,
  })

  const saveRow = async (d: CondDraft) => {
    if (!workId || !vendorId) return
    setBusyKey(d.key)
    try {
      const url = d.id ? `/api/v3/work-conditions/${d.id}` : `/api/v3/works/${encodeURIComponent(workId)}/conditions`
      const r = await fetch(url, {
        method: d.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyOf(d)),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      push(d.id ? "条件を更新しました" : "条件を登録しました", "success")
      await load(workId, vendorId)
    } catch (e: any) {
      push(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setBusyKey(null)
    }
  }

  const removeRow = async (d: CondDraft) => {
    if (!d.id) { setDrafts((ds) => ds.filter((x) => x.key !== d.key)); return }
    if (!window.confirm("この再許諾条件を削除しますか？")) return
    setBusyKey(d.key)
    try {
      const r = await fetch(`/api/v3/work-conditions/${d.id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      push("条件を削除しました", "success")
      await load(workId, vendorId)
    } catch (e: any) {
      push(`削除に失敗: ${e?.message || e}`, "error")
    } finally {
      setBusyKey(null)
    }
  }

  const inputCls = "h-8 text-[12px]"
  const selCls = "h-8 text-[12px]"

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-6">
      <header className="border-b border-border pb-5">
        <p className="retro-tag mb-1.5">Master · 再許諾</p>
        <h2 className="text-2xl font-mono font-bold tracking-tight flex items-center gap-2">
          <Coins className="h-6 w-6 text-muted-foreground" /> 再許諾条件登録
        </h2>
        <p className="text-[13px] font-mono text-muted-foreground mt-1.5">
          自社作品を再許諾（②権利許諾）／自社製造他社販売（③プロダクトアウト）する条件を、作品 × 再許諾先ごとに登録します。
          再許諾料のライブ計算・受領・分配は請求テーブル画面で行い、ここで登録した条件が源泉になります。
        </p>
      </header>

      {/* STEP 1: 作品 */}
      <section className="space-y-2">
        <div className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> 1. 作品（自社作品）を選ぶ
        </div>
        <EntitySearchSelect entity="work" value={work?.id ?? null} onSelect={setWork} placeholder="作品を検索（コード / タイトル）" />
      </section>

      {/* STEP 2: 再許諾先 */}
      {workId && (
        <section className="space-y-2">
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> 2. 再許諾先を選ぶ
          </div>
          <EntitySearchSelect entity="vendor" value={vendor?.id ?? null} onSelect={setVendor} placeholder="再許諾先（取引先）を検索（名称 / コード）" />
        </section>
      )}

      {/* STEP 3: 条件 */}
      {workId && vendorId && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-violet-600" /> 3. 再許諾条件を登録
            </div>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={addRow}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-md border border-violet-400 text-violet-700 hover:bg-violet-50"
            >
              <Plus className="h-3 w-3" /> 条件を追加
            </button>
          </div>

          {/* 分配の料率元(任意): 源泉ライセンスイン原作を選ぶと、その license_in 条件を各行の親に紐づけできる。 */}
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
              分配の料率元 — 源泉ライセンスイン原作（任意）
            </div>
            <EntitySearchSelect
              entity="source_ip"
              value={sourceIp?.id ?? null}
              onSelect={(o) => { setSourceIp(o); void loadLicenseIn(o?.id || "") }}
              placeholder="源泉のライセンスイン原作を検索（LO-コード / タイトル）"
            />
            <p className="text-[10px] font-mono text-muted-foreground/70">
              選ぶと各条件の「親ライセンスイン条件」で料率元を指定できます（分配＝基準×個数×ライセンスイン料率の源泉）。未指定でも条件は登録可。
              {licenseInConds.length > 0 && <>（license_in 条件 {licenseInConds.length} 件）</>}
            </p>
          </div>

          {drafts.length === 0 ? (
            <p className="text-[12px] font-mono text-muted-foreground border border-dashed border-border rounded-md px-3 py-6 text-center">
              この作品 × 再許諾先の再許諾条件はまだありません。「条件を追加」で登録してください。
            </p>
          ) : (
            <div className="space-y-3">
              {drafts.map((d, i) => (
                <div key={d.key} className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-violet-700">条件 #{i + 1}{d.id ? ` (登録済 id:${d.id})` : "（新規）"}</span>
                    <button
                      type="button"
                      onClick={() => void removeRow(d)}
                      disabled={busyKey === d.key}
                      className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" /> 削除
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">計算モデル</span>
                      <NativeSelect value={d.calc_type} onChange={(e) => patch(d.key, { calc_type: e.target.value })} className={selCls}>
                        {V3_CALC_MODELS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">条件名（版・区分）</span>
                      <Input value={d.condition_name} onChange={(e) => patch(d.key, { condition_name: e.target.value })} placeholder="例: 通常版 / デジタル" className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">通貨</span>
                      <NativeSelect value={d.currency} onChange={(e) => patch(d.key, { currency: e.target.value })} className={selCls}>
                        {["JPY", "USD", "EUR", "GBP", "CNY"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </NativeSelect>
                    </label>

                    <label className="space-y-1 md:col-span-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">基準価格の定義</span>
                      <Input value={d.base_price_label} onChange={(e) => patch(d.key, { base_price_label: e.target.value })} placeholder={basePriceHint[d.calc_type] || "基準価格"} className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">料率 (%)</span>
                      <Input type="number" value={d.rate_pct} onChange={(e) => patch(d.key, { rate_pct: e.target.value })} placeholder={d.calc_type === "FIXED" ? "100" : "例: 12"} className={inputCls} />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">MG（ミニマムギャランティ）</span>
                      <Input type="number" value={d.mg_amount} onChange={(e) => patch(d.key, { mg_amount: e.target.value })} placeholder="0" className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">AG（アドバンス）</span>
                      <Input type="number" value={d.ag_amount} onChange={(e) => patch(d.key, { ag_amount: e.target.value })} placeholder="0" className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">地域・言語</span>
                      <Input value={d.region_language_label} onChange={(e) => patch(d.key, { region_language_label: e.target.value })} placeholder="例: 北米・英語 / 全世界" className={inputCls} />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">適用開始</span>
                      <Input type="date" value={d.term_start} onChange={(e) => patch(d.key, { term_start: e.target.value })} className={inputCls} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">適用終了</span>
                      <Input type="date" value={d.term_end} onChange={(e) => patch(d.key, { term_end: e.target.value })} className={inputCls} />
                    </label>

                    <label className="space-y-1 md:col-span-3">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">親ライセンスイン条件（分配の料率元・任意）</span>
                      <NativeSelect
                        value={d.parent_license_condition_id != null ? String(d.parent_license_condition_id) : ""}
                        onChange={(e) => patch(d.key, { parent_license_condition_id: e.target.value ? Number(e.target.value) : undefined })}
                        className={selCls}
                      >
                        <option value="">— 未リンク（上で源泉ライセンスイン原作を選ぶと候補表示）—</option>
                        {licenseInConds.map((c) => (
                          <option key={c.id} value={c.id}>{licenseInLabel(c)}</option>
                        ))}
                        {d.parent_license_condition_id != null &&
                          !licenseInConds.some((c) => Number(c.id) === d.parent_license_condition_id) && (
                            <option value={d.parent_license_condition_id}>リンク済 条件 id:{d.parent_license_condition_id}</option>
                          )}
                      </NativeSelect>
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveRow(d)}
                      disabled={busyKey === d.key}
                      className="inline-flex items-center gap-1.5 text-[12px] font-mono px-3 py-1.5 rounded-md bg-foreground text-background disabled:opacity-50"
                    >
                      {busyKey === d.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {d.id ? "更新" : "登録"}
                    </button>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {d.calc_type === "SUPPLY_QTY" ? "③自社製造他社販売（製造ベース）" : d.calc_type === "BASE_RATE" ? "②権利許諾（実効料率）" : d.calc_type === "FIXED" ? "固定額（料率100%で表現可）" : "基準価格 × 個数 × 料率"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 px-3 py-2.5 text-[11px] font-mono leading-relaxed text-emerald-900 dark:text-emerald-200">
            <strong>この条件が再許諾料の源泉です。</strong> 再許諾料のライブ計算・受領記録・分配（ライセンサーへ支払 = 基準額 × 個数 × ライセンスイン料率）は請求テーブル画面で行います。
          </div>
        </section>
      )}
    </div>
  )
}
