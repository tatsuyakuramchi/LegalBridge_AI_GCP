/**
 * MaterialEntryPanel — 原作マテリアル(work_materials)の登録フォーム。
 *
 * 設計(モック master_forms_mock.html ③)に沿った「解説付き・外部キーは ID 検索」の入力欄。
 * 原作マテリアルは金銭条件を付帯必須とし、取引形態は利用許諾条件書と同じ固定3種
 * (V3_FIXED_DEALS)から選ぶ(＝軸を揃える→過去条件の引用・A+B 合算が成立)。
 *
 * マテリアル登録 ≒ 文書作成。「文書」欄は以下の優先で器(capability)を決める:
 *   ① 既存文書を検索(DocumentNumberLookup)     → その文書番号の器へ
 *   ③ 文書リンク(従前の締結済み契約 URL)        → ARC-ILT を発番し document_url に保存
 *   ② 発番トグル                                → ARC-ILT を発番(DB登録のみ・PDFなし)
 *   ④ いずれも空                                → 原作ごとの MLC- 器(マスター登録)
 * ①〜③は任意。空入力でも ④ に落ちて必ず登録できる。
 *
 * 金銭条件は先頭行の POST 応答で capability_id を受け取り、残り行は同 capability_id で
 * 送って「1マテリアル=1文書」を守る(発番の重複を防ぐ)。
 */

import * as React from "react"
import { Loader2, Plus, Trash2, FileText } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorkPicker, toWorkPickerItem, type WorkPickerItem } from "@/src/components/work/WorkPicker"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { DocumentNumberLookup, type LookedUpDocument } from "@/src/components/document/DocumentNumberLookup"
import { V3_FIXED_DEALS, V3_CALC_MODELS } from "@/src/components/document/V3LicenseMatrix"

// ── 選択肢(モック③に準拠) ──────────────────────────────────────────────
const MATERIAL_TYPES = ["illustration", "scenario", "design", "music", "text"]
const MATERIAL_ROLES: Array<{ v: string; label: string }> = [
  { v: "core_logic", label: "core_logic（中核）" },
  { v: "sub_component", label: "sub_component（構成要素）" },
]
const RIGHTS_TYPES = ["owned", "copyright_assignment", "license", "joint"]
const ACQUISITION_TYPES = ["", "license", "buyout_commission", "in_house"]

// 取引形態(固定3種)の calc_type → 支払方式。固定3種はいずれも料率モデル(royalty)。
const calcLabel = (t?: string) => V3_CALC_MODELS.find((m) => m.value === t)?.label || t || ""

// 金銭条件1行(固定3種のいずれかを選び、料率/MG/AG/通貨/地域/言語を持つ)。
type CondRow = {
  key: string
  dealId: number // V3_FIXED_DEALS.id (1/2/3)
  rate_pct: string
  mg_amount: string
  ag_amount: string
  currency: string
  region_territory: string
  region_language: string
}
let _rowSeq = 0
const newCondRow = (dealId = 1): CondRow => ({
  key: `c${++_rowSeq}`,
  dealId,
  rate_pct: "",
  mg_amount: "",
  ag_amount: "",
  currency: "JPY",
  region_territory: "全世界",
  region_language: "全言語",
})

// 小さなラベル+解説の共通ラッパ。
function Field(props: { label: string; col?: string; help?: string; req?: boolean; auto?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <label className="font-mono text-[11px] font-bold">{props.label}</label>
        {props.req && <span className="text-[10px] font-mono font-bold text-rose-600">*必須</span>}
        {props.col && (
          <span className="font-mono text-[8.5px] text-muted-foreground border border-border rounded px-1 bg-muted/40">{props.col}</span>
        )}
        {props.auto && (
          <span className="font-mono text-[8.5px] text-amber-600 border border-amber-500 rounded px-1">自動採番</span>
        )}
      </div>
      {props.help && <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">{props.help}</p>}
      {props.children}
    </div>
  )
}

const selCls =
  "w-full h-8 rounded-md border border-border bg-background px-2.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"

export function MaterialEntryPanel() {
  const { vendors, showNotification } = useAppData() as any

  // 原作(source-ips = works kind='licensed_in')。金銭条件の器は原作配下に作るため原作限定。
  const [sources, setSources] = React.useState<any[]>([])
  const [workId, setWorkId] = React.useState<string>("")

  // 属性
  const [materialName, setMaterialName] = React.useState("")
  const [materialType, setMaterialType] = React.useState("illustration")
  const [materialRole, setMaterialRole] = React.useState("sub_component")
  const [rightsType, setRightsType] = React.useState("license")
  const [acquisitionType, setAcquisitionType] = React.useState("")
  const [rightsVendorCode, setRightsVendorCode] = React.useState("")
  const [rightsVendorId, setRightsVendorId] = React.useState<number | null>(null)
  const [rightsHolderLabel, setRightsHolderLabel] = React.useState("")
  const [isRoyaltyBearing, setIsRoyaltyBearing] = React.useState(true)
  const [scope, setScope] = React.useState("")
  const [remarks, setRemarks] = React.useState("")

  // 金銭条件(固定3種)。付帯必須のため既定で1行。
  const [conds, setConds] = React.useState<CondRow[]>([newCondRow(1)])

  // 文書欄(①検索 / ②発番 / ③リンク / ④空)
  const [pickedDoc, setPickedDoc] = React.useState<LookedUpDocument | null>(null)
  const [issueToggle, setIssueToggle] = React.useState(false)
  const [fileLink, setFileLink] = React.useState("")

  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    fetch("/api/v3/source-ips")
      .then((r) => r.json())
      .then((d) => setSources(Array.isArray(d) ? d : []))
      .catch(() => setSources([]))
  }, [])

  const pickerItems: WorkPickerItem[] = React.useMemo(
    () =>
      sources.map((s) =>
        toWorkPickerItem(s, {
          code: s.source_code || s.work_code,
          sub: "原作",
        })
      ),
    [sources]
  )
  const selectedSource = React.useMemo(() => sources.find((s) => String(s.id) === workId) || null, [sources, workId])

  const addCond = () => setConds((cs) => [...cs, newCondRow(1)])
  const removeCond = (key: string) => setConds((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.key !== key)))
  const patchCond = (key: string, patch: Partial<CondRow>) =>
    setConds((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  const resetForm = () => {
    setMaterialName("")
    setMaterialType("illustration")
    setMaterialRole("sub_component")
    setRightsType("license")
    setAcquisitionType("")
    setRightsVendorCode("")
    setRightsVendorId(null)
    setRightsHolderLabel("")
    setIsRoyaltyBearing(true)
    setScope("")
    setRemarks("")
    setConds([newCondRow(1)])
    setPickedDoc(null)
    setIssueToggle(false)
    setFileLink("")
  }

  // 文書欄→condition-lines の器指定 payload(先頭行のみ渡す)。
  const docPayload = (): Record<string, any> => {
    if (pickedDoc?.document_number) return { document_number: pickedDoc.document_number }
    const link = fileLink.trim()
    if (link) return { issue_document: true, file_link: link }
    if (issueToggle) return { issue_document: true }
    return {} // ④ MLC フォールバック
  }

  const submit = async () => {
    if (!workId) return showNotification?.("所属する原作を選択してください。", "error")
    if (!materialName.trim()) return showNotification?.("素材名を入力してください。", "error")
    const link = fileLink.trim()
    if (link && !/^https:\/\//i.test(link)) {
      return showNotification?.("文書リンクは https:// で始まる URL を入力してください。", "error")
    }
    setSaving(true)
    try {
      // 1) マテリアル作成 → material_code / id
      const mRes = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_name: materialName.trim(),
          material_type: materialType,
          material_role: materialRole,
          rights_type: rightsType,
          acquisition_type: acquisitionType || undefined,
          rights_holder_vendor_id: rightsVendorId ?? undefined,
          rights_holder_label: rightsHolderLabel.trim() || undefined,
          is_royalty_bearing: isRoyaltyBearing,
          scope: scope.trim() || undefined,
          remarks: remarks.trim() || undefined,
        }),
      })
      if (!mRes.ok) {
        const e = await mRes.json().catch(() => ({}))
        throw new Error(e?.error || `マテリアル作成に失敗 (HTTP ${mRes.status})`)
      }
      const material = await mRes.json()
      const mid = material.id as number
      const materialCode = material.material_code as string

      // 2) 金銭条件を登録。先頭行で器を決め(発番/検索/リンク/MLC)、返却 capability_id を残り行で再利用。
      let capabilityId: number | null = null
      let docNumber = ""
      for (let i = 0; i < conds.length; i++) {
        const c = conds[i]
        const deal = V3_FIXED_DEALS.find((d) => d.id === c.dealId) || V3_FIXED_DEALS[0]
        const body: Record<string, any> = {
          payment_scheme: "royalty", // 固定3種はいずれも料率モデル
          subject: deal.name, // condition_name = 取引形態名
          rate_pct: c.rate_pct || null,
          mg_amount: c.mg_amount || null,
          ag_amount: c.ag_amount || null,
          region_territory: c.region_territory || null,
          region_language: c.region_language || null,
          notes: `取引形態: ${deal.name} / 計算モデル: ${calcLabel(deal.calc_type)}`,
        }
        if (i === 0) Object.assign(body, docPayload())
        else if (capabilityId != null) body.capability_id = capabilityId

        const r = await fetch(
          `/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/condition-lines`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        )
        if (!r.ok) {
          const e = await r.json().catch(() => ({}))
          throw new Error(e?.error || `金銭条件 #${i + 1} の登録に失敗 (HTTP ${r.status})`)
        }
        const j = await r.json()
        if (i === 0) {
          capabilityId = j.capability_id ?? null
          docNumber = j.document_number || ""
        }
      }

      showNotification?.(
        `マテリアルを登録しました: ${materialCode}（金銭条件 ${conds.length} 件 / 文書: ${docNumber || "MLC マスター登録"}）`,
        "success"
      )
      resetForm()
    } catch (e: any) {
      showNotification?.(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="retro-tag mb-1.5">MST · MATERIAL ENTRY</p>
        <h3 className="text-lg font-mono font-bold">原作マテリアル 登録（work_materials）</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          原作にぶら下がる素材。金銭条件を付帯必須で登録し、結合キー material_code は自動採番。
        </p>
      </div>

      {/* 属性 */}
      <div className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-5 space-y-4">
        <Field
          label="所属する原作"
          col="work_id → works.id"
          req
          help="この素材が属する原作(licensed_in)を検索。material_code の接頭辞になる。金銭条件は原作配下の器に登録する。"
        >
          <WorkPicker
            items={pickerItems}
            value={workId}
            onSelect={(it) => setWorkId(it?.id || "")}
            placeholder="原作コード / タイトル / 別名 で検索"
          />
        </Field>

        <Field label="素材コード" col="material_code" auto help="〈原作コード〉-NNN で登録時に自動採番。手入力不可。">
          <div className={`${selCls} flex items-center text-muted-foreground`}>
            {selectedSource
              ? `（登録時に自動: ${selectedSource.source_code || selectedSource.work_code}-NNN）`
              : "（原作を選ぶと採番プレビュー）"}
          </div>
        </Field>

        <Field label="素材名" col="material_name" req>
          <Input value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder="例: New ito 用イラスト" className="h-8 text-[12px]" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="種別（ジャンル）" col="material_type">
            <select className={selCls} value={materialType} onChange={(e) => setMaterialType(e.target.value)}>
              {MATERIAL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="役割" col="material_role" help="core_logic=中核 / sub_component=構成要素">
            <select className={selCls} value={materialRole} onChange={(e) => setMaterialRole(e.target.value)}>
              {MATERIAL_ROLES.map((r) => (
                <option key={r.v} value={r.v}>{r.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="権利区分" col="rights_type">
            <select className={selCls} value={rightsType} onChange={(e) => setRightsType(e.target.value)}>
              {RIGHTS_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="取得経路" col="acquisition_type" help="未指定で rights_type から自動推定。">
            <select className={selCls} value={acquisitionType} onChange={(e) => setAcquisitionType(e.target.value)}>
              {ACQUISITION_TYPES.map((t) => (
                <option key={t || "auto"} value={t}>{t || "（自動推定）"}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="権利元（取引先）" col="rights_holder_vendor_id" help="権利者を取引先マスタから ID 検索。未登録なら下のラベルで手書き。">
          <VendorSearchSelect
            vendors={vendors || []}
            selectedCode={rightsVendorCode}
            onSelect={(v) => {
              setRightsVendorCode(v?.vendor_code || "")
              setRightsVendorId(v?.id ?? null)
            }}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="権利元ラベル" col="rights_holder_label" help="vendor 未登録時の表記(任意)。">
            <Input value={rightsHolderLabel} onChange={(e) => setRightsHolderLabel(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
          </Field>
          <Field label="ロイヤリティ対象" col="is_royalty_bearing">
            <label className="flex items-center gap-2 h-8 font-mono text-[11px]">
              <input type="checkbox" checked={isRoyaltyBearing} onChange={(e) => setIsRoyaltyBearing(e.target.checked)} />
              {isRoyaltyBearing ? "対象（ロイヤリティあり）" : "対象外"}
            </label>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="利用範囲" col="scope">
            <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
          </Field>
          <Field label="備考" col="remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
          </Field>
        </div>
      </div>

      {/* 金銭条件(固定3種) */}
      <div className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-5 space-y-4">
        <div>
          <h4 className="font-mono text-[13px] font-bold text-violet-600">金銭条件（この素材の初回登録＝L1）</h4>
          <p className="font-mono text-[9.5px] text-muted-foreground leading-snug mt-1">
            素材には金銭条件を<b>付帯必須</b>。取引形態は利用許諾条件書と<b>同じ固定3種</b>から選ぶ(＝軸を揃える)。
            素材が関わる取引形態ごとに1行。固定3種はいずれも料率モデル(royalty)。
          </p>
        </div>

        {/* 文書欄 */}
        <div className="rounded-lg border border-dashed border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-2">
          <Field
            label="文書（この素材の利用許諾条件書）"
            col="capability_id / document_number"
            help="マテリアル登録＝文書作成。既存があれば検索して紐づけ、無ければ ARC-ILT を発番して新規登録(DB登録のみ・PDFなし)。空なら原作ごとの MLC- 器に登録。"
          >
            <DocumentNumberLookup
              filterTemplateTypes={["individual_license_terms"]}
              onApply={(d) => setPickedDoc(d)}
              placeholder="ARC-ILT / 件名 で検索"
              includeMaster
            />
          </Field>
          {pickedDoc && (
            <div className="flex items-center gap-2 font-mono text-[11px] bg-background border border-border rounded px-2 py-1">
              <FileText className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span className="font-bold">{pickedDoc.document_number}</span>
              <span className="text-muted-foreground truncate">{pickedDoc.derived_title}</span>
              <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setPickedDoc(null)}>
                解除
              </button>
            </div>
          )}
          {!pickedDoc && (
            <>
              <label className="flex items-center gap-2 font-mono text-[10px]">
                <input type="checkbox" checked={issueToggle} onChange={(e) => setIssueToggle(e.target.checked)} />
                見つからなければ <b>ARC-ILT を発番して登録</b>（documents 器 + condition_lines を作成）
              </label>
              <Field label="文書リンク（従前の締結済み契約 PDF・任意）" col="file_link → document_url" help="従前に契約がある場合、締結済み PDF/Drive の URL を貼ると新規 PDF を作らずそのリンクで登録(https:// 始まり)。">
                <Input
                  value={fileLink}
                  onChange={(e) => setFileLink(e.target.value)}
                  placeholder="https://drive.google.com/…（任意）"
                  className="h-8 text-[12px]"
                />
              </Field>
            </>
          )}
        </div>

        {/* 条件行 */}
        {conds.map((c, idx) => {
          const deal = V3_FIXED_DEALS.find((d) => d.id === c.dealId) || V3_FIXED_DEALS[0]
          return (
            <div key={c.key} className="rounded-lg border border-violet-400 bg-violet-50/40 dark:bg-violet-950/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9.5px] font-bold text-violet-600">条件 #{idx + 1}</span>
                {conds.length > 1 && (
                  <button type="button" className="text-rose-600 hover:text-rose-700" onClick={() => removeCond(c.key)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="取引形態" col="固定3種">
                  <select
                    className={selCls}
                    value={c.dealId}
                    onChange={(e) => patchCond(c.key, { dealId: Number(e.target.value) })}
                  >
                    {V3_FIXED_DEALS.map((d, i) => (
                      <option key={d.id} value={d.id}>
                        {["①", "②", "③"][i] || ""} {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="計算モデル" help="取引形態に紐づき自動。">
                  <div className={`${selCls} flex items-center text-emerald-600 font-bold`}>{calcLabel(deal.calc_type)}</div>
                </Field>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="料率(%)" col="rate_pct">
                  <Input value={c.rate_pct} onChange={(e) => patchCond(c.key, { rate_pct: e.target.value })} placeholder="5" className="h-8 text-[12px]" />
                </Field>
                <Field label="MG" col="mg_amount">
                  <Input value={c.mg_amount} onChange={(e) => patchCond(c.key, { mg_amount: e.target.value })} placeholder="0" className="h-8 text-[12px]" />
                </Field>
                <Field label="AG" col="ag_amount">
                  <Input value={c.ag_amount} onChange={(e) => patchCond(c.key, { ag_amount: e.target.value })} placeholder="0" className="h-8 text-[12px]" />
                </Field>
                <Field label="通貨" col="currency">
                  <Input value={c.currency} onChange={(e) => patchCond(c.key, { currency: e.target.value })} placeholder="JPY" className="h-8 text-[12px]" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="地域" col="region_territory">
                  <Input value={c.region_territory} onChange={(e) => patchCond(c.key, { region_territory: e.target.value })} placeholder="全世界" className="h-8 text-[12px]" />
                </Field>
                <Field label="言語" col="region_language">
                  <Input value={c.region_language} onChange={(e) => patchCond(c.key, { region_language: e.target.value })} placeholder="全言語" className="h-8 text-[12px]" />
                </Field>
              </div>
            </div>
          )
        })}

        <Button variant="outline" size="sm" onClick={addCond} className="font-mono text-[11px]">
          <Plus className="h-3.5 w-3.5" />
          金銭条件を追加
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={resetForm} disabled={saving} className="font-mono text-[11px]">
          クリア
        </Button>
        <Button size="sm" onClick={submit} disabled={saving} className="font-mono text-[11px]">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          マテリアルを登録
        </Button>
      </div>
    </div>
  )
}

export default MaterialEntryPanel
