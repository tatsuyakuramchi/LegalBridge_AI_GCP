/**
 * PubLicenseEntryPanel — 出版利用許諾条件(出版等利用許諾条件書 / ARC-PUBT)の登録・編集。
 *
 * 「出版ファースト」の入れやすい入力フォーム。原作 → 対象出版物(素材) → 許諾者・出版条件 を
 * 1画面で入力し、実在の出版等利用許諾条件書(ARC-PUBT)＋条件明細を作る。
 *
 * マスター入力との整合:
 *   - 原作      : /api/v3/source-ips  (works kind='licensed_in')  ← Works(作品/原作)登録と同一
 *   - 対象出版物: /api/v3/works/:id/materials (work_materials)     ← 原作素材(Materials)登録と同一
 *   - 許諾者    : 取引先マスタ(vendors)
 * これにより「出版条件書の原作/素材」と「マスター登録の原作/素材」が常に同一レコードを指す。
 *
 * 出力:
 *   - PDF出力あり : 出版等利用許諾条件書フォームへ prefill 遷移し PDF を生成(番号は生成時採番)。
 *   - DB登録のみ  : condition-lines API で ARC-PUBT を発番し 紙/電子 の印税条件(cfc)を作成(PDFなし)。
 * どちらも worker の buildPubLicenseConditions と同じ 紙=condition_no 1 / 電子=2 の形に揃える。
 *
 * 翻訳版・海外版は二次的著作物として本条件書の対象外(別途 発注書由来)。海外はテリトリー(許諾地域)で制御。
 */

import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Plus, Trash2, FileText, Pencil, X, Search, FileOutput } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorkPicker, toWorkPickerItem, type WorkPickerItem } from "@/src/components/work/WorkPicker"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { DocumentNumberLookup, type LookedUpDocument } from "@/src/components/document/DocumentNumberLookup"

const selCls =
  "w-full h-8 rounded-md border border-border bg-background px-2.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"

function Field(props: { label: string; col?: string; help?: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <label className="font-mono text-[11px] font-bold">{props.label}</label>
        {props.req && <span className="text-[10px] font-mono font-bold text-rose-600">*必須</span>}
        {props.col && (
          <span className="font-mono text-[8.5px] text-muted-foreground border border-border rounded px-1 bg-muted/40">{props.col}</span>
        )}
      </div>
      {props.help && <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">{props.help}</p>}
      {props.children}
    </div>
  )
}

const jpToday = () => {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function PubLicenseEntryPanel() {
  const { vendors, showNotification } = useAppData() as any
  const navigate = useNavigate()

  // 検索ゲート: 原作選択 → 一覧(対象出版物=素材を選ぶ) / 新規。
  const [view, setView] = React.useState<"gate" | "form">("gate")

  const [sources, setSources] = React.useState<any[]>([])
  const [workId, setWorkId] = React.useState<string>("")

  // 対象出版物(work_material)。既存を選ぶか、新規作成(素材名=対象出版物名)。
  const [materialId, setMaterialId] = React.useState<number | null>(null)
  const [materialCode, setMaterialCode] = React.useState<string>("")
  const [pubTitle, setPubTitle] = React.useState("") // 対象出版物名 = material_name

  // 許諾者(甲)
  const [licensorVendorCode, setLicensorVendorCode] = React.useState("")
  const [licensorVendorId, setLicensorVendorId] = React.useState<number | null>(null)
  const [licensorLabel, setLicensorLabel] = React.useState("") // vendor 未登録時の表記
  const [licensorType, setLicensorType] = React.useState<"個人" | "法人">("個人")

  // 契約情報
  const [conclDate, setConclDate] = React.useState("") // 締結日(和暦表記の任意文字列)
  const [startDate, setStartDate] = React.useState("") // 許諾開始日
  const [territory, setTerritory] = React.useState("全世界") // 許諾地域
  const [language, setLanguage] = React.useState("全言語") // 許諾言語
  const [pubBaseDoc, setPubBaseDoc] = React.useState<LookedUpDocument | null>(null)
  const [pubBaseType, setPubBaseType] = React.useState<"individual" | "corporate">("individual")

  // 出版条件(紙 / 電子)
  const [paperRate, setPaperRate] = React.useState("") // 紙書籍印税率(%)
  const [paperQtyKind, setPaperQtyKind] = React.useState("実売部数") // 紙媒体印税対象部数区分
  const [paperFormula, setPaperFormula] = React.useState("") // 紙媒体計算式(任意)
  const [ebookOn, setEbookOn] = React.useState(false) // 電子書籍配信許諾有無
  const [ebookRate, setEbookRate] = React.useState("") // 電子書籍印税率(%)
  const [ebookFormula, setEbookFormula] = React.useState("") // 電子書籍計算式(任意)

  // 出力モード
  const [pdfOutput, setPdfOutput] = React.useState(true)

  const [saving, setSaving] = React.useState(false)

  // 一覧
  const [materials, setMaterials] = React.useState<any[]>([])
  const [listLoading, setListLoading] = React.useState(false)

  React.useEffect(() => {
    fetch("/api/v3/source-ips")
      .then((r) => r.json())
      .then((d) => setSources(Array.isArray(d) ? d : []))
      .catch(() => setSources([]))
  }, [])

  const pickerItems: WorkPickerItem[] = React.useMemo(
    () => sources.map((s) => toWorkPickerItem(s, { code: s.source_code || s.work_code, sub: "原作" })),
    [sources]
  )
  const selectedSource = React.useMemo(() => sources.find((s) => String(s.id) === workId) || null, [sources, workId])

  const clearFields = () => {
    setMaterialId(null); setMaterialCode(""); setPubTitle("")
    setLicensorVendorCode(""); setLicensorVendorId(null); setLicensorLabel(""); setLicensorType("個人")
    setConclDate(""); setStartDate(""); setTerritory("全世界"); setLanguage("全言語")
    setPubBaseDoc(null); setPubBaseType("individual")
    setPaperRate(""); setPaperQtyKind("実売部数"); setPaperFormula("")
    setEbookOn(false); setEbookRate(""); setEbookFormula("")
    setPdfOutput(true)
  }

  const loadMaterials = React.useCallback(async (wid: string) => {
    if (!wid) { setMaterials([]); return }
    setListLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(wid)}/materials`)
      const rows = await r.json()
      setMaterials(Array.isArray(rows) ? rows : [])
    } catch {
      setMaterials([])
    } finally {
      setListLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setView("gate")
    clearFields()
    loadMaterials(workId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, loadMaterials])

  const startNew = () => { clearFields(); setView("form") }

  const startFromMaterial = (m: any) => {
    clearFields()
    setMaterialId(m.id)
    setMaterialCode(m.material_code || "")
    setPubTitle(m.material_name || "")
    if (m.rights_holder_vendor_id != null) setLicensorVendorId(m.rights_holder_vendor_id)
    setView("form")
  }

  const backToGate = () => { clearFields(); setView("gate") }

  // 対象出版物(work_material)を確定。既存があればそれ、無ければ原作配下に新規作成。
  const ensureMaterial = async (): Promise<{ id: number; material_code: string; material_name: string }> => {
    if (materialId) {
      return { id: materialId, material_code: materialCode, material_name: pubTitle.trim() }
    }
    const attrs = {
      material_name: pubTitle.trim(),
      material_type: "text",
      material_role: "core_logic",
      rights_type: "license",
      rights_holder_vendor_id: licensorVendorId ?? undefined,
      rights_holder_label: licensorLabel.trim() || undefined,
      is_royalty_bearing: true,
    }
    const mRes = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attrs),
    })
    if (!mRes.ok) {
      const e = await mRes.json().catch(() => ({}))
      throw new Error(e?.error || `対象出版物(素材)の作成に失敗 (HTTP ${mRes.status})`)
    }
    return await mRes.json()
  }

  // 出版条件の共通 formData(PDF prefill / 参照)を組み立てる。worker/修復と同じキー名に揃える。
  const buildFormData = (material: { material_code: string; material_name: string }) => {
    const src = selectedSource || {}
    return {
      原著作物名: src.title || "",
      対象出版物名: pubTitle.trim() || material.material_name || src.title || "",
      素材番号: material.material_code,
      ledger_code: src.source_code || src.work_code || "",
      is_work_linked: true,
      許諾者: licensorLabel.trim() || undefined,
      許諾者種別: licensorType,
      vendor_code: licensorVendorCode || undefined,
      締結日: conclDate.trim() || jpToday(),
      許諾開始日: startDate.trim() || "",
      基本契約番号: pubBaseDoc?.document_number || "",
      許諾地域: territory.trim() || "",
      許諾言語: language.trim() || "",
      紙書籍印税率: paperRate.trim(),
      紙媒体印税対象部数区分: paperQtyKind.trim() || "",
      紙媒体計算式: paperFormula.trim() || "",
      電子書籍配信許諾有無: ebookOn ? "許諾する" : "許諾しない",
      電子書籍印税率: ebookOn ? ebookRate.trim() : "",
      電子書籍計算式: ebookOn ? ebookFormula.trim() : "",
    }
  }

  // DB登録のみ: condition-lines API で ARC-PUBT を発番し 紙/電子 の印税条件(cfc)を作成。
  //   worker buildPubLicenseConditions と同じ 紙=BASE_QTY_RATE/税抜定価, 電子=BASE_QTY_RATE/被許諾者受領額。
  const postConditionsDbOnly = async (mid: number): Promise<string> => {
    const rows: Array<Record<string, any>> = [
      { subject: "紙書籍出版", base_price_label: "税抜定価", rate_pct: paperRate.trim() || null },
    ]
    if (ebookOn) rows.push({ subject: "電子書籍配信", base_price_label: "被許諾者受領額", rate_pct: ebookRate.trim() || null })

    let capabilityId: number | null = null
    let docNumber = ""
    for (let i = 0; i < rows.length; i++) {
      const body: Record<string, any> = {
        payment_scheme: "royalty",
        calc_type: "BASE_QTY_RATE",
        region_territory: territory.trim() || null,
        region_language: language.trim() || null,
        currency: "JPY",
        ...rows[i],
      }
      if (i === 0) body.doc_kind = "publication"
      else if (capabilityId != null) body.capability_id = capabilityId

      const r = await fetch(`/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/condition-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `印税条件 #${i + 1} の登録に失敗 (HTTP ${r.status})`)
      }
      const j = await r.json()
      if (i === 0) { capabilityId = j.capability_id ?? null; docNumber = j.document_number || "" }
    }
    return docNumber
  }

  // 出版等許諾基本契約書(ARC-PUB)を先に作成する導線。
  const handoffToBaseContract = () => {
    if (!licensorVendorCode) {
      return showNotification?.("基本契約書の作成には、先に許諾者を取引先マスタから選択してください。", "error")
    }
    const template = pubBaseType === "corporate" ? "pub_master_corporate" : "pub_master_individual"
    const prefill = { template, formData: { vendor_code: licensorVendorCode, 契約締結日: jpToday() } }
    sessionStorage.setItem("lb_material_prefill", JSON.stringify(prefill))
    showNotification?.("出版等許諾基本契約書の作成フォームへ移動します。生成後、その番号で条件書を作成してください。", "success")
    navigate(`/documents/new?template=${encodeURIComponent(template)}&prefill_material=1`)
  }

  const validate = (): string | null => {
    if (!workId) return "原作を選択してください。"
    if (!pubTitle.trim()) return "対象出版物名を入力してください。"
    if (!paperRate.trim()) return "紙書籍印税率(%)を入力してください。"
    if (ebookOn && !ebookRate.trim()) return "電子書籍配信を許諾する場合は電子書籍印税率(%)を入力してください。"
    return null
  }

  const submit = async () => {
    const err = validate()
    if (err) return showNotification?.(err, "error")
    setSaving(true)
    try {
      const material = await ensureMaterial()
      if (pdfOutput) {
        const prefill = { template: "pub_license_terms", formData: buildFormData(material) }
        sessionStorage.setItem("lb_material_prefill", JSON.stringify(prefill))
        showNotification?.(
          `対象出版物 ${material.material_code} を登録しました。条件書フォームで内容を確認し PDF を作成してください。`,
          "success"
        )
        navigate(`/documents/new?template=pub_license_terms&prefill_material=1`)
        return
      }
      const docNumber = await postConditionsDbOnly(material.id)
      showNotification?.(
        `出版利用許諾条件を登録しました: ${docNumber || "自動発番"}（対象出版物 ${material.material_code} / 紙${ebookOn ? "・電子" : ""}）`,
        "success"
      )
      await loadMaterials(workId)
      backToGate()
    } catch (e: any) {
      showNotification?.(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="retro-tag mb-1.5">MST · PUB LICENSE</p>
        <h3 className="text-lg font-mono font-bold">出版利用許諾条件 登録（ARC-PUBT）</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          原作を選ぶ → 対象出版物(素材)を選ぶ/新規 → 許諾者・出版条件(紙/電子印税率)を入力。実在の出版等利用許諾条件書と条件明細を作成します。
          原作・素材はマスター登録(Works / Materials)と同一レコードを参照します。
        </p>
      </div>

      {/* 原作セレクタ(入口の検索) */}
      <div className="rounded-xl border border-border bg-card p-4">
        <Field
          label="原作"
          col="work_id → works(licensed_in)"
          req
          help="この出版物の原作(licensed_in)を検索。Works(作品/原作)登録と同じ一覧。素材コードの接頭辞になる。"
        >
          <WorkPicker
            items={pickerItems}
            value={workId}
            onSelect={(it) => setWorkId(it?.id || "")}
            placeholder="原作コード / タイトル / 別名 で検索"
            disabled={view === "form" && !!materialId}
          />
        </Field>
      </div>

      {!workId ? (
        <p className="font-mono text-[11px] text-muted-foreground py-4">まず原作を選択してください。</p>
      ) : view === "gate" ? (
        <div className="rounded-xl border border-border border-t-[3px] border-t-sky-500 bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-mono text-[13px] font-bold text-sky-600">対象出版物(既存の原作素材)</h4>
            <Button size="sm" onClick={startNew} className="font-mono text-[11px]">
              <Plus className="h-3.5 w-3.5" />
              新規で出版条件を作成
            </Button>
          </div>
          <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">
            既存の原作素材を対象出版物として選ぶと、その素材に出版条件を紐づけます。無ければ「新規で出版条件を作成」から対象出版物(素材)ごと作れます。
          </p>
          {listLoading ? (
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 読み込み中…
            </div>
          ) : materials.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground py-4">この原作に素材はありません。「新規で出版条件を作成」から登録してください。</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full font-mono text-[10.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground">
                    <th className="text-left px-2 py-1.5 font-semibold">素材コード</th>
                    <th className="text-left px-2 py-1.5 font-semibold">名称(=対象出版物名)</th>
                    <th className="text-right px-2 py-1.5 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="px-2 py-1.5 text-sky-700">{m.material_code || `#${m.id}`}</td>
                      <td className={`px-2 py-1.5 ${!m.material_name ? "text-rose-600" : ""}`}>{m.material_name || "（名称なし）"}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button type="button" className="inline-flex items-center gap-1 border border-sky-500 text-sky-600 rounded px-1.5 py-0.5 hover:bg-sky-500/10" onClick={() => startFromMaterial(m)}>
                          <Pencil className="h-3 w-3" /> この出版物で条件作成
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px]">
            {materialId ? <Pencil className="h-3.5 w-3.5 text-sky-600" /> : <Plus className="h-3.5 w-3.5 text-emerald-600" />}
            {materialId ? <>対象出版物: <b>{materialCode}</b>（既存素材に条件を紐づけ）</> : <>新規の出版条件を作成（対象出版物=素材も同時に作成）</>}
            <button type="button" className="ml-auto text-muted-foreground hover:text-destructive inline-flex items-center gap-1" onClick={backToGate}>
              <Search className="h-3.5 w-3.5" /> 一覧に戻る
            </button>
          </div>

          {/* 対象出版物 / 許諾者 */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-sky-500 bg-card p-5 space-y-4">
            <Field label="対象出版物名" col="material_name / 対象出版物名" req help="出版する書名。新規時は原作配下に素材(work_material)として作成されます。">
              <Input value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} placeholder="例: New ito 公式ガイドブック" className="h-8 text-[12px]" disabled={!!materialId} />
              {materialId && <p className="font-mono text-[9px] text-muted-foreground">既存素材のため名称は変更しません（素材コード {materialCode} 固定）。</p>}
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="許諾者（取引先）" col="vendor" help="許諾者(甲)を取引先マスタから検索。氏名/住所/口座は生成時に vendor から解決。">
                <VendorSearchSelect
                  vendors={vendors || []}
                  selectedCode={licensorVendorCode}
                  onSelect={(v) => { setLicensorVendorCode(v?.vendor_code || ""); setLicensorVendorId(v?.id ?? null) }}
                />
              </Field>
              <Field label="許諾者 種別" col="許諾者種別" help="法人=支払日 末日 / 個人=20日。署名欄の個人/法人 出し分けにも使用。">
                <select className={selCls} value={licensorType} onChange={(e) => setLicensorType(e.target.value as any)}>
                  <option value="個人">個人</option>
                  <option value="法人">法人</option>
                </select>
              </Field>
            </div>

            <Field label="許諾者 名称（取引先未登録時）" col="許諾者" help="取引先マスタに無い許諾者はここに氏名/法人名を記入(任意)。">
              <Input value={licensorLabel} onChange={(e) => setLicensorLabel(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
            </Field>
          </div>

          {/* 契約情報 */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-sky-500 bg-card p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="締結日" col="締結日" help="空欄なら本日。">
                <Input value={conclDate} onChange={(e) => setConclDate(e.target.value)} placeholder={jpToday()} className="h-8 text-[12px]" />
              </Field>
              <Field label="許諾開始日" col="許諾開始日">
                <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="許諾地域" col="許諾地域" help="海外出版はここで制御(翻訳版は二次的著作物として別途)。">
                <Input value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="全世界" className="h-8 text-[12px]" />
              </Field>
              <Field label="許諾言語" col="許諾言語">
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="全言語" className="h-8 text-[12px]" />
              </Field>
            </div>

            {/* 出版基本契約書(ARC-PUB) */}
            <div className="rounded-md border border-sky-500 bg-sky-500/10 p-2.5 space-y-2">
              <div className="font-mono text-[10px] font-bold text-sky-700">出版等許諾基本契約書（ARC-PUB）</div>
              <p className="font-mono text-[9px] text-muted-foreground leading-snug">
                条件書は基本契約に紐づきます。既存を検索して番号を引き継ぐか、無ければ先に作成してください（任意）。
              </p>
              <DocumentNumberLookup
                filterTemplateTypes={["pub_master_individual", "pub_master_corporate"]}
                onApply={(d) => setPubBaseDoc(d)}
                placeholder="ARC-PUB / 件名 で基本契約を検索"
                includeMaster
              />
              {pubBaseDoc ? (
                <div className="flex items-center gap-2 font-mono text-[11px] bg-background border border-border rounded px-2 py-1">
                  <FileText className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                  <span className="font-bold">{pubBaseDoc.document_number}</span>
                  <span className="text-muted-foreground truncate">{pubBaseDoc.derived_title}</span>
                  <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setPubBaseDoc(null)}><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[9px] text-muted-foreground">基本契約書が無い場合:</span>
                  <select className="h-7 rounded border border-border bg-background px-1.5 text-[10px] font-mono" value={pubBaseType} onChange={(e) => setPubBaseType(e.target.value as any)}>
                    <option value="individual">個人版</option>
                    <option value="corporate">法人版</option>
                  </select>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 border border-sky-500 text-sky-600 rounded px-2 py-1 font-mono text-[10px] hover:bg-sky-500/10"
                    onClick={handoffToBaseContract}
                  >
                    <FileOutput className="h-3 w-3" /> 基本契約書を先に作成
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 出版条件(紙 / 電子) */}
          <div className="rounded-xl border border-border border-t-[3px] border-t-sky-500 bg-card p-5 space-y-4">
            <div>
              <h4 className="font-mono text-[13px] font-bold text-sky-600">出版条件（印税）</h4>
              <p className="font-mono text-[9.5px] text-muted-foreground leading-snug mt-1">
                紙書籍=条件1(常に)、電子書籍=条件2(許諾する時のみ)。翻訳版・海外版は二次的著作物として本条件書の対象外。
              </p>
            </div>

            {/* 紙書籍 */}
            <div className="rounded-lg border border-sky-400 bg-sky-50/40 dark:bg-sky-950/20 p-3 space-y-3">
              <span className="font-mono text-[9.5px] font-bold text-sky-600">条件1 · 紙書籍出版</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="紙書籍 印税率(%)" col="紙書籍印税率" req>
                  <Input value={paperRate} onChange={(e) => setPaperRate(e.target.value)} placeholder="10" className="h-8 text-[12px]" />
                </Field>
                <Field label="印税対象部数区分" col="紙媒体印税対象部数区分">
                  <Input value={paperQtyKind} onChange={(e) => setPaperQtyKind(e.target.value)} placeholder="実売部数 / 刷部数" className="h-8 text-[12px]" />
                </Field>
                <Field label="計算式(任意)" col="紙媒体計算式" help="空欄なら「税抜定価 × 印税対象部数 × 印税率」。">
                  <Input value={paperFormula} onChange={(e) => setPaperFormula(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
                </Field>
              </div>
            </div>

            {/* 電子書籍 */}
            <div className="rounded-lg border border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-3">
              <label className="flex items-center gap-2 font-mono text-[10.5px]">
                <input type="checkbox" checked={ebookOn} onChange={(e) => setEbookOn(e.target.checked)} />
                <b className="text-indigo-700">条件2 · 電子書籍配信を許諾する</b>
              </label>
              {ebookOn && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="電子書籍 印税率/料率(%)" col="電子書籍印税率" req>
                    <Input value={ebookRate} onChange={(e) => setEbookRate(e.target.value)} placeholder="20" className="h-8 text-[12px]" />
                  </Field>
                  <Field label="計算式(任意)" col="電子書籍計算式" help="空欄なら「被許諾者の受領額 × 料率」。">
                    <Input value={ebookFormula} onChange={(e) => setEbookFormula(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
                  </Field>
                </div>
              )}
            </div>

            {/* 出力モード */}
            <label className="flex items-center gap-2 font-mono text-[10.5px] rounded-md border border-emerald-500 bg-emerald-500/10 px-2.5 py-2">
              <input type="checkbox" checked={pdfOutput} onChange={(e) => setPdfOutput(e.target.checked)} />
              <b className="text-emerald-700">PDF出力あり</b>
              <span className="text-muted-foreground">— 条件書フォームへ遷移し、ここの内容を反映して PDF を生成（オフ＝DB登録のみ・条件明細だけ作成）</span>
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={backToGate} disabled={saving} className="font-mono text-[11px]">キャンセル</Button>
            <Button size="sm" onClick={submit} disabled={saving} className="font-mono text-[11px]">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pdfOutput ? <FileOutput className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {pdfOutput ? "登録して条件書フォームへ（PDF作成）" : "出版条件を登録（DB登録のみ）"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default PubLicenseEntryPanel
