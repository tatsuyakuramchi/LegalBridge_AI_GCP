/**
 * DeliverableCards — 発注書「成果物（明細）」の帰属駆動エディタ。
 *
 * 汎用 LineItemTable の代替として、同じ formData.items(LineItem[]) を編集する。
 * 目的は「テンプレートの値制御を確実にする」こと。成果物の帰属(発注者/受注者)を選ぶと、
 * 下請法(取適法)対応に必要な値が自動で決まり、テンプレの分岐へ正しい値だけが渡る。
 *
 *   発注者帰属(譲渡型) → calc_method=FIXED(確定額) or ROYALTY(計算方法=執筆料)。金額>0 必須。
 *   受注者帰属(利用許諾型) → calc_method=ROYALTY / amount_ex_tax=0 固定 →「利用許諾料に含む」。
 *                            支払日は「利用許諾料計算書の通り」。料率・素材は下の利用許諾条件で登録。
 *   納期(delivery_date)は常に必須。
 *
 * formData キー・LineItem 構造・PDF テンプレは不変。集計(合計/納期/支払日)は親の onChange が担う。
 */
import * as React from "react"
import { Plus, Trash2, Package, AlertTriangle, ArrowRightLeft, Coins } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LineItem, WorkOption } from "./LineItemTable"

interface Props {
  items: LineItem[]
  onChange: (items: LineItem[]) => void
  works?: WorkOption[]
}

const blankItem = (): LineItem => ({
  item_name: "",
  unit_price: 0,
  quantity: 1,
  amount_ex_tax: 0,
  calc_method: "FIXED",
  deliverable_ownership: "発注者",
})

const yen = (n: number) => `¥${(Number(n) || 0).toLocaleString("ja-JP")}`

const labelCls = "text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground"
const inputCls =
  "w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground transition-colors"

// 業務委託の契約類型(請負/準委任)。payment_terms として保持し、PDF の
//   「支払方法：FIXED（請負）」等（テンプレの payment_terms）に反映する。
//   請負=仕事の完成が対価(民632条) / 準委任=事務処理の遂行が対価(民656条)。
const CONTRACT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "— 契約種別 —" },
  { value: "請負", label: "請負（成果物の完成）" },
  { value: "準委任", label: "準委任（役務の遂行）" },
]

export const DeliverableCards: React.FC<Props> = ({ items, onChange, works = [] }) => {
  const patch = (idx: number, p: Partial<LineItem>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)))
  const add = () => onChange([...(Array.isArray(items) ? items : []), blankItem()])
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx))

  // 金額(税抜)を1本の値として扱う(unit_price=金額 / quantity=1 / amount_ex_tax=金額)。
  //   確定額(FIXED)以外(計算方法/継続/利用許諾料)は単価=金額・個数1の従来挙動。
  const setAmount = (idx: number, v: number) =>
    patch(idx, { unit_price: v, quantity: 1, amount_ex_tax: v })

  // 確定額(FIXED)は「単価 × 個数」で金額を算出する(検収は 単価×個数×歩留率 で消化)。
  //   個数未設定は 1 とみなす。金額は四捨五入で整数化(税抜円)。
  const setUnit = (idx: number, unit: number) => {
    const q = Number(items[idx]?.quantity) || 1
    patch(idx, { unit_price: unit, quantity: q, amount_ex_tax: Math.round(unit * q) })
  }
  const setQty = (idx: number, q: number) => {
    const u = Number(items[idx]?.unit_price) || Number(items[idx]?.amount_ex_tax) || 0
    patch(idx, { unit_price: u, quantity: q, amount_ex_tax: Math.round(u * q) })
  }

  const setOwnership = (idx: number, owner: "発注者" | "受注者") => {
    if (owner === "受注者") {
      // 利用許諾型: 確定額外(0) / calc_method=ROYALTY 固定 →「利用許諾料に含む」。
      patch(idx, { deliverable_ownership: "受注者", calc_method: "ROYALTY", unit_price: 0, quantity: 1, amount_ex_tax: 0 })
    } else {
      // 譲渡型: 既定は確定額(FIXED)。ROYALTY のままだと amount=0 で「含む」表示になり譲渡型と矛盾するため FIXED へ。
      patch(idx, { deliverable_ownership: "発注者", calc_method: items[idx]?.calc_method === "SUBSCRIPTION" ? "SUBSCRIPTION" : "FIXED" })
    }
  }

  // 発注者帰属の報酬の決め方: 確定額(FIXED) / 計算方法(ROYALTY=執筆料) / 継続(SUBSCRIPTION=役務提供)。
  const setFeeMode = (idx: number, mode: "fixed" | "calc" | "subscription") => {
    if (mode === "fixed") patch(idx, { calc_method: "FIXED", rate_pct: undefined })
    else if (mode === "calc") patch(idx, { calc_method: "ROYALTY" })
    else patch(idx, { calc_method: "SUBSCRIPTION", rate_pct: undefined })
  }

  const list = Array.isArray(items) ? items : []

  return (
    <div className="col-span-full space-y-3">
      {list.length === 0 && (
        <p className="text-center text-[11px] font-mono text-muted-foreground py-6">
          成果物がありません。「＋成果物を追加」から入力してください。
        </p>
      )}

      {list.map((it, idx) => {
        const isContractor = it.deliverable_ownership === "受注者"
        const feeMode: "fixed" | "calc" | "subscription" =
          it.calc_method === "ROYALTY" ? "calc" : it.calc_method === "SUBSCRIPTION" ? "subscription" : "fixed"
        const amount = Number(it.amount_ex_tax) || 0
        // 固定報酬(確定額)の名称。既定「執筆料」。案件により制作報酬/監修報酬等へ自由入力。
        const rewardLabel = (it.reward_label || "").trim() || "執筆料"
        // 当社帰属(発注者)×ROYALTY は「インセンティブ報酬」、受注者帰属は「利用許諾料」。
        const royaltyLabel = isContractor ? "利用許諾料" : "インセンティブ報酬"
        // 下請法(取適法)ガード: 品目・納期は必須。発注者帰属は 金額(>0) or 計算方法(料率+固定報酬>0)。
        //   継続(サブスク)は納期の代わりに役務提供期間(term_start)を必須とする。
        const errs: string[] = []
        if (!String(it.item_name || "").trim()) errs.push("品目名")
        if (feeMode === "subscription") {
          if (!it.term_start) errs.push("役務提供期間(開始)")
        } else if (!it.delivery_date) {
          errs.push("納期")
        }
        if (!isContractor && amount <= 0) errs.push(feeMode === "calc" ? `${rewardLabel}の金額` : "金額")

        return (
          <div
            key={idx}
            className={cn(
              "relative rounded-lg border p-3 space-y-3 group",
              isContractor ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/10" : "border-border bg-card"
            )}
          >
            <button
              type="button"
              onClick={() => remove(idx)}
              className="absolute -right-2.5 -top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow opacity-0 group-hover:opacity-100 hover:scale-110 transition-all z-10"
              aria-label="この成果物を削除"
            >
              <Trash2 className="h-3 w-3" />
            </button>

            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-mono font-bold text-muted-foreground">成果物 #{idx + 1}</span>
              {errs.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-mono px-1.5 py-0.5 rounded-sm bg-red-50 border border-red-300 text-red-700">
                  <AlertTriangle className="h-3 w-3" /> 未入力: {errs.join("・")}
                </span>
              )}
            </div>

            {/* 品目名 / 納期 / (作品) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={labelCls}>品目名 *</label>
                <input
                  type="text"
                  value={it.item_name || ""}
                  onChange={(e) => patch(idx, { item_name: e.target.value })}
                  className={inputCls}
                  placeholder="成果物の名称（例: 〇〇用イラスト）"
                />
              </div>
              {feeMode === "subscription" ? (
                <div className="space-y-1">
                  <label className={labelCls}>役務提供期間（下の「継続」で入力）</label>
                  <div className="text-[11px] font-mono text-muted-foreground py-1.5">
                    継続課金のため、納期の代わりに役務提供期間を使用します。
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className={cn(labelCls, !it.delivery_date && "text-red-600")}>納期 *（成果物には納期が必要）</label>
                  <input
                    type="date"
                    value={it.delivery_date || ""}
                    onChange={(e) => patch(idx, { delivery_date: e.target.value })}
                    className={inputCls}
                  />
                </div>
              )}
            </div>

            {works.length > 0 && (
              <div className="space-y-1">
                <label className={labelCls}>対象作品（任意・明細ごと）</label>
                <select
                  value={it.work_id != null ? String(it.work_id) : ""}
                  onChange={(e) => patch(idx, { work_id: e.target.value ? Number(e.target.value) : undefined })}
                  className={inputCls}
                >
                  <option value="">— 文書単位の作品にフォールバック —</option>
                  {works.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.work_code ? `[${w.work_code}] ` : ""}
                      {w.title || `作品#${w.id}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 帰属 */}
            <div className="space-y-1">
              <label className={labelCls}>成果物の帰属（IP帰属）</label>
              <div role="tablist" className="flex p-0.5 gap-0.5 bg-muted/40 rounded-sm border border-border w-fit">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isContractor}
                  onClick={() => setOwnership(idx, "発注者")}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold rounded-sm transition-all",
                    !isContractor ? "bg-card text-foreground shadow-xs border border-border" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ArrowRightLeft className="h-3 w-3" /> 発注者帰属（譲渡型）
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isContractor}
                  onClick={() => setOwnership(idx, "受注者")}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold rounded-sm transition-all",
                    isContractor ? "bg-card text-amber-800 shadow-xs border border-amber-300" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Coins className="h-3 w-3" /> 受注者帰属（利用許諾型）
                </button>
              </div>
            </div>

            {/* 帰属駆動: 報酬 */}
            {isContractor ? (
              <div className="rounded-sm border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={labelCls}>固定報酬（税抜・任意）</label>
                    <input
                      type="number"
                      value={amount || ""}
                      onChange={(e) => setAmount(idx, Number(e.target.value) || 0)}
                      className={inputCls}
                      placeholder="0 または空欄＝利用許諾料に含む"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>支払日（固定報酬がある場合）</label>
                    <input
                      type="date"
                      value={it.payment_date || ""}
                      onChange={(e) => patch(idx, { payment_date: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
                {amount > 0 && (
                  <div className="space-y-1">
                    <label className={labelCls}>固定報酬の名称（PDF表記・既定「執筆料」）</label>
                    <input
                      type="text"
                      value={it.reward_label || ""}
                      onChange={(e) => patch(idx, { reward_label: e.target.value })}
                      className={inputCls}
                      placeholder="執筆料（例: 制作報酬 / 監修報酬）"
                    />
                  </div>
                )}
                <p className="text-[10px] font-mono text-amber-800/80 leading-snug">
                  {amount > 0 ? (
                    <>PDF表記：「<b>{yen(amount)} {rewardLabel}（{royaltyLabel}は別途）</b>」。この固定報酬は確定額に算入されます。</>
                  ) : (
                    <>固定報酬なし → PDF表記：「<b>報酬は利用許諾料に含む</b>」（支払日＝利用許諾料計算書の通り）。</>
                  )}
                  {" "}利用許諾料（料率）と原作素材は、下の<b>「利用許諾条件（共通）」</b>で登録してください（取適法の「計算方法の記載」を担保）。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className={labelCls}>報酬の決め方（取適法：金額 or 計算方法の記載が必要）</label>
                  <div role="tablist" className="flex p-0.5 gap-0.5 bg-muted/40 rounded-sm border border-border w-fit">
                    <button
                      type="button"
                      aria-selected={feeMode === "fixed"}
                      onClick={() => setFeeMode(idx, "fixed")}
                      className={cn(
                        "px-3 py-1 text-[10px] font-mono font-bold rounded-sm transition-all",
                        feeMode === "fixed" ? "bg-card text-foreground shadow-xs border border-border" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      確定額
                    </button>
                    <button
                      type="button"
                      aria-selected={feeMode === "calc"}
                      onClick={() => setFeeMode(idx, "calc")}
                      className={cn(
                        "px-3 py-1 text-[10px] font-mono font-bold rounded-sm transition-all",
                        feeMode === "calc" ? "bg-card text-foreground shadow-xs border border-border" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      計算方法（料率・執筆料）
                    </button>
                    <button
                      type="button"
                      aria-selected={feeMode === "subscription"}
                      onClick={() => setFeeMode(idx, "subscription")}
                      className={cn(
                        "px-3 py-1 text-[10px] font-mono font-bold rounded-sm transition-all",
                        feeMode === "subscription" ? "bg-card text-foreground shadow-xs border border-border" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      継続（サブスク）
                    </button>
                  </div>
                </div>

                {/* 契約種別（請負/準委任）— 業務委託の類型。payment_terms に保持し PDF に反映。 */}
                <div className="space-y-1">
                  <label className={labelCls}>契約種別（業務委託の類型）</label>
                  <select
                    value={it.payment_terms === "請負" || it.payment_terms === "準委任" ? it.payment_terms : ""}
                    onChange={(e) => patch(idx, { payment_terms: e.target.value, payment_method: e.target.value })}
                    className={inputCls}
                  >
                    {CONTRACT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {feeMode === "subscription" && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <label className={labelCls}>課金周期</label>
                      <select
                        value={it.subscription_cycle || "MONTHLY"}
                        onChange={(e) => patch(idx, { subscription_cycle: e.target.value as "MONTHLY" | "ANNUAL" })}
                        className={inputCls}
                      >
                        <option value="MONTHLY">月額</option>
                        <option value="ANNUAL">年額</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className={cn(labelCls, !it.term_start && "text-red-600")}>期間 開始 *</label>
                      <input type="date" value={it.term_start || ""} onChange={(e) => patch(idx, { term_start: e.target.value })} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>期間 終了</label>
                      <input type="date" value={it.term_end || ""} onChange={(e) => patch(idx, { term_end: e.target.value })} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                      <label className={cn(labelCls, amount <= 0 && "text-red-600")}>1周期の金額(税抜) *</label>
                      <input type="number" value={amount || ""} onChange={(e) => setAmount(idx, Number(e.target.value) || 0)} className={inputCls} placeholder="0 以外" />
                    </div>
                  </div>
                )}

                {feeMode === "calc" && (
                  <div className="space-y-1">
                    <label className={labelCls}>固定報酬の名称（PDF表記・既定「執筆料」）</label>
                    <input
                      type="text"
                      value={it.reward_label || ""}
                      onChange={(e) => patch(idx, { reward_label: e.target.value })}
                      className={inputCls}
                      placeholder="執筆料（例: 制作報酬 / 監修報酬）"
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {feeMode === "calc" && (
                    <div className="space-y-1">
                      <label className={labelCls}>料率(%)</label>
                      <input
                        type="number"
                        value={it.rate_pct ?? ""}
                        onChange={(e) => patch(idx, { rate_pct: e.target.value === "" ? undefined : Number(e.target.value) })}
                        className={inputCls}
                        placeholder="例: 10"
                      />
                    </div>
                  )}
                  {feeMode === "fixed" ? (
                    <>
                      {/* 確定額: 単価 × 個数。金額はその積(検収は 単価×個数×歩留率 で消化)。 */}
                      <div className="space-y-1">
                        <label className={cn(labelCls, amount <= 0 && "text-red-600")}>単価(税抜) *</label>
                        <input
                          type="number"
                          value={(Number(it.unit_price) || amount) || ""}
                          onChange={(e) => setUnit(idx, Number(e.target.value) || 0)}
                          className={inputCls}
                          placeholder="0 以外"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className={labelCls}>個数</label>
                        <input
                          type="number"
                          value={Number(it.quantity) || 1}
                          onChange={(e) => setQty(idx, Number(e.target.value) || 0)}
                          className={inputCls}
                          placeholder="1"
                          step="1"
                          min="0"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1">
                      <label className={cn(labelCls, amount <= 0 && "text-red-600")}>
                        {feeMode === "calc" ? `${rewardLabel}の金額(税抜) *` : "金額(税抜) *"}
                      </label>
                      <input
                        type="number"
                        value={amount || ""}
                        onChange={(e) => setAmount(idx, Number(e.target.value) || 0)}
                        className={inputCls}
                        placeholder="0 以外"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className={labelCls}>支払日</label>
                    <input
                      type="date"
                      value={it.payment_date || ""}
                      onChange={(e) => patch(idx, { payment_date: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
                {feeMode === "fixed" && (Number(it.quantity) || 1) !== 1 && (
                  <p className="text-[10px] font-mono text-muted-foreground/70">
                    金額(税抜) = 単価 {yen(Number(it.unit_price) || 0)} × 個数 {Number(it.quantity) || 1} = <b>{yen(amount)}</b>
                  </p>
                )}
                {feeMode === "calc" && (
                  <p className="text-[10px] font-mono text-muted-foreground/70">
                    PDF表記：「{yen(amount)} {rewardLabel}（{royaltyLabel}は別途）」。{royaltyLabel}（料率）の算定条件は下の<b>「利用許諾条件（共通）」</b>に記載されます。
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-foreground text-background text-[10px] font-mono font-bold uppercase tracking-[0.14em] rounded-sm hover:opacity-90 transition-all"
        >
          <Plus className="h-3 w-3" /> 成果物を追加
        </button>
      </div>
    </div>
  )
}
