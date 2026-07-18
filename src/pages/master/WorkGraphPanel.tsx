/**
 * WorkGraphPanel — 統合 Phase3c: 3カード統合エディタ（増分①: ビュー）。
 *
 * 作品(own)を選ぶと、権利フローを3カードで表示する:
 *   左 = 原作 / 素材調達（支払エッジ: ライセンスイン原作・委託素材）
 *   中 = 作品（own）＋ 素材 ＋ 製品
 *   右 = 受取（受取エッジ: ライセンスアウト派生物・物販アウト）
 *
 * カード間のエッジ = condition_lines（向き × 取引種別）。本増分は読み取り表示のみ。
 * 編集（ノード/エッジの作成・紐付け）は後続増分で追加する。
 */
import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { RightsTreePanel } from "./RightsTreePanel"
import { Globe } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import { useDocumentSession } from "@/src/context/AppDataContext"
import { conditionClient } from "@/src/lib/api/conditionClient"
import {
  FinancialConditionTable,
  calcMethodFromType,
  buildFormulaText,
  type FinancialCondition,
  type CalcType,
} from "@/src/components/document/FinancialConditionTable"
import { WorkAttributionsPanel } from "@/src/components/work/WorkAttributionsPanel"
import { WorkPicker, toWorkPickerItem } from "@/src/components/work/WorkPicker"

// 条件明細(condition_lines) → FinancialCondition(利用許諾明細入力の行)へ逆マップ。
//   __clid に condition_line.id を退避し保存時の upsert キーにする(FinancialCondition には無い項目)。
function clToFc(c: any): any {
  const scheme = c.payment_scheme
  const royalty = scheme === "royalty"
  const calc_type: CalcType = royalty ? "BASE_QTY_RATE" : scheme === "subscription" ? "SUBSCRIPTION" : "FIXED"
  return {
    __clid: c.id,
    condition_no: c.source_seq_no ?? undefined,
    condition_name: c.subject ?? "",
    region_territory: c.region_territory ?? "",
    region_language: c.region_language ?? "",
    region_language_label: c.region_language_label ?? "",
    calc_type,
    calc_method: c.calc_method ?? calcMethodFromType(calc_type),
    fixed_kind: scheme === "installment" ? "INSTALLMENT" : "LUMP",
    unit_amount: !royalty && c.amount_ex_tax != null ? Number(c.amount_ex_tax) : undefined,
    guarantee_type: c.mg_amount ? "MG" : c.ag_amount ? "AG" : "NONE",
    rate_pct: c.rate_pct != null ? Number(c.rate_pct) : undefined,
    base_price_label: c.base_price_label ?? "",
    calc_period: c.calc_period ?? "",
    calc_period_kind: c.calc_period_kind ?? undefined,
    calc_period_close_month: c.calc_period_close_month ?? undefined,
    currency: c.currency ?? "JPY",
    formula_text: c.formula_text ?? "",
    mg_amount: c.mg_amount != null ? Number(c.mg_amount) : undefined,
    ag_amount: c.ag_amount != null ? Number(c.ag_amount) : undefined,
    payment_terms: c.payment_terms ?? "",
  }
}

// FinancialCondition → 一括保存用の行(condition_lines フィールド)へ順マップ。
function fcToRow(fc: any): Record<string, any> {
  const ct: CalcType | undefined = fc.calc_type
  const royalty = ct === "BASE_QTY_RATE" || ct === "BASE_RATE"
  const scheme = royalty ? "royalty" : ct === "SUBSCRIPTION" ? "subscription" : fc.fixed_kind === "INSTALLMENT" ? "installment" : "lump_sum"
  return {
    __clid: fc.__clid ?? null,
    source_seq_no: fc.condition_no ?? null,
    subject: fc.condition_name || fc.region_language_label || null,
    payment_scheme: scheme,
    rate_pct: royalty ? fc.rate_pct ?? null : null,
    mg_amount: royalty ? fc.mg_amount ?? null : null,
    ag_amount: royalty ? fc.ag_amount ?? null : null,
    amount_ex_tax: !royalty ? fc.unit_amount ?? null : null,
    base_price_label: royalty ? fc.base_price_label ?? null : null,
    calc_method: fc.calc_method ?? calcMethodFromType(ct),
    calc_period: fc.calc_period ?? null,
    calc_period_kind: fc.calc_period_kind ?? null,
    calc_period_close_month: fc.calc_period_close_month ?? null,
    currency: fc.currency ?? "JPY",
    formula_text: fc.formula_text || buildFormulaText(fc) || null,
    payment_terms: fc.payment_terms ?? null,
    region_territory: fc.region_territory || null,
    region_language: fc.region_language || null,
  }
}

type Edge = {
  id: number
  line_code: string | null
  subject: string | null
  transaction_kind: string | null
  direction: string | null
  payment_scheme: string | null
  amount_ex_tax: string | null
  rate_pct: string | null
  mg_amount: string | null
  document_number: string | null
  contract_title: string | null
  counterparty: string | null
  source_work_id?: number | null
  source_material_id?: number | null
  product_id?: number | null
  counterparty_vendor_id?: number | null
  source_work_code?: string | null
  source_work_title?: string | null
  source_material_code?: string | null
  source_material_name?: string | null
  product_code?: string | null
  product_name?: string | null
  // ④' 許諾地域(条件明細から引用)。region_language_label 等から合成した表示用ラベル。
  region_territory?: string | null
  region_language?: string | null
  region_language_label?: string | null
  territory_label?: string | null
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  license: { label: "利用許諾", cls: "border-sky-300 text-sky-700" },
  product: { label: "物販", cls: "border-violet-300 text-violet-700" },
  service: { label: "委託", cls: "border-amber-300 text-amber-700" },
}
const KindBadge = ({ kind }: { kind: string | null }) => {
  const m = kind ? KIND_META[kind] : null
  return m ? <Badge variant="outline" className={m.cls}>{m.label}</Badge> : null
}
const yen = (v: any) => (v == null || v === "" ? "" : `¥${Number(v).toLocaleString("ja-JP")}`)

// マテリアル表示名: 「{コード} {原作名}　{マテリアル名}」。原作名が無い文脈では「{コード} {マテリアル名}」。
//   例: LO-2026-0015-001 ＜原作名＞　原作ゲームデザイン
const matDisplay = (code?: string | null, srcTitle?: string | null, name?: string | null) =>
  (srcTitle
    ? `${code || "—"} ${srcTitle}　${name || ""}`
    : `${code || "—"} ${name || ""}`
  ).trimEnd()


// 増分⑤: 中カードの作品(own)基本情報インライン編集の選択肢(WorkModelPanel と同一)。
const WORK_TYPES = ["board_game", "trpg_book", "supplement", "digital"]
const WORK_STATUS = ["planning", "in_production", "released", "suspended", "discontinued"]

function EdgeRow({
  e,
  side,
  materials,
  products,
  sourceWorks,
  vendors,
  onLink,
}: {
  e: Edge
  side: "up" | "down"
  materials: any[]
  products: any[]
  sourceWorks: any[]
  vendors: any[]
  onLink: (edgeId: number, patch: any) => void
}) {
  const node =
    side === "up"
      ? e.source_material_code
        ? `${e.source_material_code} ${e.source_material_name || ""}`
        : e.source_work_code
          ? `${e.source_work_code} ${e.source_work_title || ""}`
          : ""
      : e.product_code
        ? `${e.product_code} ${e.product_name || ""}`
        : ""
  return (
    <div className="border border-border rounded-md px-2.5 py-2 text-[11px] font-mono space-y-1 bg-card">
      <div className="flex items-center gap-1.5 flex-wrap">
        <KindBadge kind={e.transaction_kind} />
        <span className="font-semibold truncate">{e.subject || e.line_code || `#${e.id}`}</span>
      </div>
      {node && <div className="text-muted-foreground truncate">◦ {node}</div>}
      <div className="flex items-center gap-2 text-muted-foreground">
        {e.counterparty && <span className="truncate">{e.counterparty}</span>}
        {e.payment_scheme === "royalty"
          ? e.rate_pct && <span>{e.rate_pct}%</span>
          : e.amount_ex_tax && <span>{yen(e.amount_ex_tax)}</span>}
      </div>
      {/* ④' 許諾地域: 個別条件書の condition_line から引用(読み取り専用)。外部ライセンス派生で特に重要。 */}
      {e.territory_label && (
        <div
          className="flex items-center gap-1 text-[10px] text-muted-foreground/80"
          title="許諾地域・言語（個別条件書の条件明細から引用）"
        >
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{e.territory_label}</span>
        </div>
      )}
      {e.document_number && (
        <div className="text-[10px] text-muted-foreground/70 truncate">{e.document_number}</div>
      )}
      {/* 増分③/⑥: エッジをノードへ参照リンク(支払→原作/素材 / 受取→製品) */}
      {side === "up" ? (
        <div className="space-y-1">
          {/* 増分⑥: 支払エッジを原作(source_work_id)へ参照リンク */}
          <select
            value={e.source_work_id ?? ""}
            onChange={(ev) => onLink(e.id, { source_work_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この支払を原作に紐付け"
          >
            <option value="">— 原作に紐付け —</option>
            {sourceWorks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.source_code || s.work_code || "—"} {s.title}
              </option>
            ))}
          </select>
          <select
            value={e.source_material_id ?? ""}
            onChange={(ev) => onLink(e.id, { source_material_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この支払を素材に紐付け"
          >
            <option value="">— 素材に紐付け —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.material_code || "—"} {m.material_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1">
          {/* 増分⑦: 受取エッジを受取先(取引先)へ参照リンク */}
          <select
            value={e.counterparty_vendor_id ?? ""}
            onChange={(ev) => onLink(e.id, { counterparty_vendor_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この受取を受取先(取引先)に紐付け"
          >
            <option value="">— 受取先に紐付け —</option>
            {vendors.map((vd) => (
              <option key={vd.id} value={vd.id}>
                {vd.vendor_code || "—"} {vd.vendor_name}
              </option>
            ))}
          </select>
          <select
            value={e.product_id ?? ""}
            onChange={(ev) => onLink(e.id, { product_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この受取を製品に紐付け"
          >
            <option value="">— 製品に紐付け —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.product_code || "—"} {p.product_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

export function WorkGraphPanel() {
  // 作品統合 増分④: /works/:id から作品IDを受け取り初期選択する。
  //   :id 無し(旧 /master/work-graph 直叩き等)のときは先頭作品にフォールバック。
  const { id: routeId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  // (B) A1-軽量: 個別条件書の起票(既存の文書作成フロー)へ遷移する際、ドキュメントセッションを
  //   クリーン初期化するために使う(IssueDetailPage.createDocument と同思想)。
  const { setSelectedIssue, setFormData: setDocFormData } = useDocumentSession()
  const [works, setWorks] = React.useState<any[]>([])
  const [workId, setWorkId] = React.useState<string>(routeId ?? "")
  const [graph, setGraph] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  // 増分②: 中カードからの素材追加。
  const [matName, setMatName] = React.useState("")
  const [matType, setMatType] = React.useState("illustration")
  const [adding, setAdding] = React.useState(false)
  // 増分⑤: 中カード=作品(own)の基本情報インライン編集。
  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [saveErr, setSaveErr] = React.useState<string | null>(null)
  // 増分⑥: 原作リンク(source_work_id 参照) + 原作中心ビュー(§3.4)。
  const [sourceWorks, setSourceWorks] = React.useState<any[]>([])
  const [uses, setUses] = React.useState<any[]>([])
  const [newOwnTitle, setNewOwnTitle] = React.useState("")
  const [creatingOwn, setCreatingOwn] = React.useState(false)
  // 増分⑥+(§3.2「+原作を参照/新規」/決定§8.2): 左カードから原作をその場で新規登録。
  const [showNewSource, setShowNewSource] = React.useState(false)
  const [newSourceTitle, setNewSourceTitle] = React.useState("")
  const [creatingSource, setCreatingSource] = React.useState(false)
  // 増分⑦: 製品(SKU)追加 + 受取先(取引先)リンク。
  const [vendors, setVendors] = React.useState<any[]>([])
  const [prodName, setProdName] = React.useState("")
  const [prodFormat, setProdFormat] = React.useState("")
  const [prodMsrp, setProdMsrp] = React.useState("")
  const [addingProduct, setAddingProduct] = React.useState(false)
  // 増分⑧: 個別条件書から condition_lines を参照リンク(work_id 結合)。
  const [edgeDoc, setEdgeDoc] = React.useState("")
  const [edgeLines, setEdgeLines] = React.useState<any[]>([])
  const [edgeSearching, setEdgeSearching] = React.useState(false)
  const [edgeSearched, setEdgeSearched] = React.useState(false)
  // (B) A1-軽量: エディタから起票する個別条件書のテンプレ種別。
  const [newDocTemplate, setNewDocTemplate] = React.useState("individual_license_terms")
  // N:N活性化 Stage3: 原作起点ピッカー — 原作を選ぶ→その利用許諾条件明細を共有結線。
  const [pickerSource, setPickerSource] = React.useState("")
  const [pickerLines, setPickerLines] = React.useState<any[]>([])
  const [pickerLoading, setPickerLoading] = React.useState(false)
  // ピッカー強化: 選んだ原作のマテリアル候補と、明細ごとに選んだ原作マテリアル(lineId→material_id)。
  const [pickerMaterials, setPickerMaterials] = React.useState<any[]>([])
  const [pickerLineMat, setPickerLineMat] = React.useState<Record<number, string>>({})
  // マテリアル単位 利用許諾条件 登録(原作ビュー): 開いているマテリアルと既存条件・入力フォーム。
  const [matCondOpen, setMatCondOpen] = React.useState<number | null>(null)
  const [matConds, setMatConds] = React.useState<any[]>([])
  const [matForm, setMatForm] = React.useState<Record<string, string>>({ payment_scheme: "royalty" })
  const [matSaving, setMatSaving] = React.useState(false)
  const [matErr, setMatErr] = React.useState<string | null>(null)
  // 利用許諾条件書(契約マスター)候補 — 登録時に文書を選んで補完するため。
  const [licenseCaps, setLicenseCaps] = React.useState<any[]>([])
  // 利用許諾明細(FinancialConditionTable)で編集する行と保存状態。
  const [matFcRows, setMatFcRows] = React.useState<any[]>([])
  const [matFcCap, setMatFcCap] = React.useState("")
  const [matFcSaving, setMatFcSaving] = React.useState(false)
  const [matFcErr, setMatFcErr] = React.useState<string | null>(null)
  // 登録済み条件の編集(インライン)。
  const [matEditId, setMatEditId] = React.useState<number | null>(null)
  const [matEditForm, setMatEditForm] = React.useState<Record<string, string>>({})
  const [matEditSaving, setMatEditSaving] = React.useState(false)
  const [matEditErr, setMatEditErr] = React.useState<string | null>(null)
  // 文書番号から既存の金銭条件(condition_lines)を呼び出してマテリアルへ紐づける。
  const [matRecallDoc, setMatRecallDoc] = React.useState("")
  const [matRecallLines, setMatRecallLines] = React.useState<any[]>([])
  const [matRecallLoading, setMatRecallLoading] = React.useState(false)
  // 本丸(原作ビュー): 原作 → マテリアル → 条件明細(1:N:N)を常時ツリー表示するため、
  //   各マテリアルの条件明細をまとめて取得して保持する(materialId → 条件明細[])。
  const [srcMatConds, setSrcMatConds] = React.useState<Record<number, any[]>>({})

  const loadGraph = React.useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    setEditing(false) // 作品を切り替えたら編集モードを抜ける
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(id)}/graph`)
      const d = await r.json()
      setGraph(d && !d.error ? d : null)
    } catch {
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const linkEdge = async (edgeId: number, patch: any) => {
    try {
      await conditionClient.setGraphLink(edgeId, patch)
      await loadGraph(workId)
    } catch (e) {
      console.error("linkEdge failed", e)
    }
  }

  const addMaterial = async () => {
    if (!workId || !matName.trim()) return
    setAdding(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_name: matName.trim(), material_type: matType, rights_type: "owned" }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setMatName("")
      await loadGraph(workId)
    } catch (e) {
      // 失敗時は静かに(エディタ増分。詳細通知は後続)
      console.error("addMaterial failed", e)
    } finally {
      setAdding(false)
    }
  }

  // 増分⑦: 製品(SKU)を追加。product_code は API 側で {work_code}-P-NNN 採番。
  const addProduct = async () => {
    if (!workId || !prodName.trim()) return
    setAddingProduct(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: prodName.trim(),
          format: prodFormat || null,
          msrp: prodMsrp.trim() ? Number(prodMsrp) : null,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setProdName("")
      setProdFormat("")
      setProdMsrp("")
      await loadGraph(workId)
    } catch (e) {
      console.error("addProduct failed", e)
    } finally {
      setAddingProduct(false)
    }
  }

  React.useEffect(() => {
    fetch("/api/v3/works")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : []
        setWorks(list)
        if (list.length && !routeId && !workId) setWorkId(String(list[0].id))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 増分⑥: 原作(source)候補一覧。左カードの「原作に紐付け」select に使う。
  //   その場新規(createSource)後にも再取得するため callback に切り出す。
  const loadSourceWorks = React.useCallback(async () => {
    try {
      const r = await fetch("/api/v3/source-ips")
      const d = await r.json()
      setSourceWorks(Array.isArray(d) ? d : [])
    } catch {
      /* noop */
    }
  }, [])

  React.useEffect(() => {
    void loadSourceWorks()
  }, [loadSourceWorks])

  // 増分⑦: 受取先(取引先)候補一覧。右カードの「受取先に紐付け」select に使う。
  React.useEffect(() => {
    fetch("/api/v3/vendors")
      .then((r) => r.json())
      .then((d) => setVendors(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // ルートの :id 変更に追従(一覧から別作品を開いたとき)。
  React.useEffect(() => {
    if (routeId) setWorkId(routeId)
  }, [routeId])

  React.useEffect(() => {
    void loadGraph(workId)
    // Stage3: 作品を切り替えたら原作ピッカーをリセット(別作品の明細が残らないように)。
    setPickerSource("")
    setPickerLines([])
    setPickerMaterials([])
    setPickerLineMat({})
    setMatCondOpen(null)
    setMatConds([])
    setMatRecallLines([])
    setMatRecallDoc("")
    setMatEditId(null)
  }, [workId, loadGraph])

  // 設計 v1.4 Phase C(UIC-02): WorkGraph の V3LicenseMatrix 直接保存(旧 license-matrix API)を
  //   撤去。原作(licensed_in)の利用許諾条件は「個別利用許諾条件書」文書フォームで起票する
  //   (条件明細の唯一の書込み口＝Document Command)。原作(ledger_ref_id)= この source-ip の id を
  //   引き継いで、文書フォームへ遷移する。既存の issueNewConditionDoc と同じ document-session 経路。
  const createLicenseDocForSource = () => {
    setSelectedIssue("")
    setDocFormData({
      サブライセンシー一覧: [],
      // 原作(Ledger)を事前選択。licensed_in の workId は source-ip id で、individual_license_terms の
      //   ledger_ref_id と同じ id 空間(GET /api/v3/source-ips)。
      ...(workId ? { ledger_ref_id: workId } : {}),
    } as any)
    navigate(`/documents/new?template=individual_license_terms`)
  }

  // 増分⑥(§3.4): 原作(licensed_in)を開いたら「利用している自社作品」を逆引き。
  React.useEffect(() => {
    const w = graph?.work
    if (w?.kind === "licensed_in" && w?.id) {
      fetch(`/api/v3/source-ips/${w.id}/uses`)
        .then((r) => r.json())
        .then((d) => setUses(Array.isArray(d) ? d : []))
        .catch(() => setUses([]))
    } else {
      setUses([])
    }
  }, [graph])

  const work = graph?.work
  const upstream: Edge[] = graph?.upstream || []
  const downstream: Edge[] = graph?.downstream || []
  const materials: any[] = graph?.materials || []
  const products: any[] = graph?.products || []
  // 増分⑥: 開いているノードが原作(source)か。原作中心ビューに切替える。
  const isSource = work?.kind === "licensed_in"

  // 関係の明確化: この作品が利用する原作マテリアル別に、履行すべき利用許諾条件(支払エッジ)をまとめる。
  //   作品G が 原作A のマテリアルC・D を使う → C・D の条件が履行義務、という連鎖を一目で示すための再表示。
  //   元データ(upstream)は壊さず、マテリアル単位にグルーピングするだけの読み取り専用ビュー。
  const consumedGroups = React.useMemo(() => {
    const groups = new Map<string, { workId?: number | null; workCode?: string | null; workTitle?: string | null; matCode?: string | null; matName?: string | null; edges: Edge[] }>()
    for (const e of upstream) {
      if (e.source_work_id == null && e.source_material_id == null) continue
      const key = `${e.source_work_id ?? "?"}::${e.source_material_id ?? "?"}`
      const g = groups.get(key)
      if (g) g.edges.push(e)
      else groups.set(key, { workId: e.source_work_id, workCode: e.source_work_code, workTitle: e.source_work_title, matCode: e.source_material_code, matName: e.source_material_name, edges: [e] })
    }
    return Array.from(groups.values())
  }, [upstream])

  // 本丸(原作ビュー): 原作 → マテリアル → 条件明細(1:N:N)を一目で見せるため、表示中マテリアルの
  //   条件明細を一括取得。graph 依存にすることで、条件の登録/編集後(loadGraph 再取得)に自動更新される。
  React.useEffect(() => {
    if (!isSource || !workId || materials.length === 0) {
      setSrcMatConds({})
      return
    }
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        materials.map(async (m: any) => {
          try {
            const r = await fetch(
              `/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${m.id}/condition-lines`
            )
            const d = await r.json()
            return [m.id, Array.isArray(d) ? d : []] as const
          } catch {
            return [m.id, [] as any[]] as const
          }
        })
      )
      if (!cancelled) setSrcMatConds(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSource, workId, graph])

  // item2(作品ビュー): 原作ピッカーをツリー化 — 条件明細を「原作マテリアル」でグルーピング。
  //   マテリアル確定済み(source_material_id あり)を上に、未割当を末尾に。
  const pickerGroups = React.useMemo(() => {
    const byMat = new Map<string, { mat: any | null; lines: any[] }>()
    for (const l of pickerLines) {
      const mid = l.source_material_id != null ? String(l.source_material_id) : ""
      if (!byMat.has(mid)) {
        const mat = mid
          ? pickerMaterials.find((m: any) => String(m.id) === mid) || {
              material_code: l.material_code,
              material_name: l.material_name,
              rights_holder_name: null,
            }
          : null
        byMat.set(mid, { mat, lines: [] })
      }
      byMat.get(mid)!.lines.push(l)
    }
    return Array.from(byMat.values()).sort((a, b) => (a.mat ? 0 : 1) - (b.mat ? 0 : 1))
  }, [pickerLines, pickerMaterials])

  // ピッカーで選択中の原作の名称(マテリアル表示名「コード 原作名　マテリアル名」用)。
  const pickerSrcTitle = React.useMemo(
    () => sourceWorks.find((s: any) => String(s.id) === String(pickerSource))?.title || null,
    [sourceWorks, pickerSource]
  )

  // 増分⑥(§3.4): 原作中心ビューから自社作品を新規作成 → そのエディタへ遷移。
  //   原作→作品の実リンク(支払エッジの source_work_id)は、作成後その作品の
  //   支払エッジで「原作に紐付け」して張る(§3.6: エディタは condition_line を新規作成しない)。
  const createOwnFromSource = async () => {
    if (!newOwnTitle.trim()) return
    setCreatingOwn(true)
    try {
      const r = await fetch("/api/v3/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newOwnTitle.trim() }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const created = await r.json()
      setNewOwnTitle("")
      if (created?.id) navigate(`/works/${created.id}`)
    } catch (e) {
      console.error("createOwnFromSource failed", e)
    } finally {
      setCreatingOwn(false)
    }
  }

  // 増分⑥+(§3.2): 左カードから原作(source)をその場で新規登録。POST /api/v3/source-ips は
  //   works(licensed_in)+ledgers(LO)+素材-001 を原子的に作成(LO- 採番)。作成後は候補一覧を
  //   再取得し、各支払エッジの「原作に紐付け」から選べるようにする(エディタは condition_line を作らない)。
  const createSource = async () => {
    if (!newSourceTitle.trim()) return
    setCreatingSource(true)
    try {
      const r = await fetch("/api/v3/source-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newSourceTitle.trim() }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setNewSourceTitle("")
      setShowNewSource(false)
      await loadSourceWorks()
    } catch (e) {
      console.error("createSource failed", e)
    } finally {
      setCreatingSource(false)
    }
  }

  // N:N活性化 Stage3: 選んだ原作にぶら下がる利用許諾条件明細を取得(現作品への結線済みフラグ付き)。
  const loadPicker = React.useCallback(async (sourceId: string, curWorkId: string) => {
    if (!sourceId) { setPickerLines([]); setPickerMaterials([]); setPickerLineMat({}); return }
    setPickerLoading(true)
    try {
      const q = curWorkId ? `?work_id=${encodeURIComponent(curWorkId)}` : ""
      // 明細(条件)と原作マテリアル候補を同時取得。GET /source-ips/:id は materials を返す。
      const [lr, sr] = await Promise.all([
        fetch(`/api/v3/source-ips/${encodeURIComponent(sourceId)}/condition-lines${q}`),
        fetch(`/api/v3/source-ips/${encodeURIComponent(sourceId)}`),
      ])
      const lines = await lr.json()
      const src = await sr.json()
      const arr = Array.isArray(lines) ? lines : []
      setPickerLines(arr)
      setPickerMaterials(Array.isArray(src?.materials) ? src.materials : [])
      // 各明細のマテリアル選択を、既存の source_material_id で初期化(あれば)。
      const init: Record<number, string> = {}
      for (const l of arr) if (l.source_material_id != null) init[l.id] = String(l.source_material_id)
      setPickerLineMat(init)
    } catch {
      setPickerLines([]); setPickerMaterials([]); setPickerLineMat({})
    } finally {
      setPickerLoading(false)
    }
  }, [])

  // N:N活性化 Stage3: 原作の利用許諾条件明細を、この作品へ加算結線(共有=他作品の結線は消えない)。
  const addComponentLine = async (line: any) => {
    if (!workId) return
    // 行で選んだ原作マテリアル(無ければ既存 source_material_id)を橋に使う。N:N の単位はマテリアル。
    const matId = pickerLineMat[line.id] || (line.source_material_id != null ? String(line.source_material_id) : "")
    if (!matId) return
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/component-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition_line_id: line.id, source_material_id: Number(matId) }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      await Promise.all([loadGraph(workId), loadPicker(pickerSource, workId)])
    } catch (e) {
      console.error("addComponentLine failed", e)
    }
  }

  // N:N活性化 Stage3: この作品ぶんの結線だけ解除(共有他作品は残る)。
  const removeComponentLine = async (line: any) => {
    if (!workId) return
    try {
      const r = await fetch(
        `/api/v3/works/${encodeURIComponent(workId)}/component-lines/${encodeURIComponent(line.id)}`,
        { method: "DELETE" }
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await Promise.all([loadGraph(workId), loadPicker(pickerSource, workId)])
    } catch (e) {
      console.error("removeComponentLine failed", e)
    }
  }

  // マテリアル単位 利用許諾条件 登録: 原作マテリアルの既存条件を取得。
  const loadMatConds = async (mid: number) => {
    try {
      const r = await fetch(`/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/condition-lines`)
      const d = await r.json()
      const arr = Array.isArray(d) ? d : []
      setMatConds(arr)
      setMatFcRows(arr.map(clToFc)) // 利用許諾明細入力(表)用に逆マップ
    } catch {
      setMatConds([])
      setMatFcRows([])
    }
  }
  // 利用許諾明細(表)を condition_lines へ一括保存(upsert/delete)。
  const saveMatFc = async (mid: number) => {
    setMatFcSaving(true)
    setMatFcErr(null)
    try {
      const rows = (matFcRows || []).map(fcToRow)
      const r = await fetch(`/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/conditions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability_id: matFcCap || null, rows }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      await Promise.all([loadMatConds(mid), loadGraph(workId)])
    } catch (e: any) {
      setMatFcErr(String(e?.message || e))
    } finally {
      setMatFcSaving(false)
    }
  }
  // マテリアルをクリック→登録パネルを開閉。開いたら既存条件を読み込む。
  const toggleMatCond = (mid: number) => {
    if (matCondOpen === mid) { setMatCondOpen(null); return }
    setMatCondOpen(mid)
    setMatForm({ payment_scheme: "royalty" })
    setMatErr(null)
    setMatConds([])
    setMatRecallDoc("")
    setMatRecallLines([])
    setMatEditId(null)
    void loadMatConds(mid)
    // 利用許諾条件書候補を一度だけ取得(登録時に文書を選んで紐づけるため)。
    if (licenseCaps.length === 0) {
      fetch("/api/v3/license-capabilities")
        .then((r) => r.json())
        .then((d) => setLicenseCaps(Array.isArray(d) ? d : []))
        .catch(() => {})
    }
  }
  // 構成ツリー(原作ビュー)から、そのマテリアルの条件編集パネルを開いて中カードへスクロール。
  const openMatEditor = (mid: number) => {
    if (matCondOpen !== mid) toggleMatCond(mid)
    setTimeout(() => {
      document.getElementById(`srcmat-${mid}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 60)
  }
  // 文書番号から既存金銭条件を呼び出す(by-document)。1文書=複数明細(金銭条件 n,n+1,…)。
  const recallByDoc = async () => {
    if (!matRecallDoc.trim()) return
    setMatRecallLoading(true)
    try {
      const r = await fetch(`/api/v3/condition-lines/by-document?document_number=${encodeURIComponent(matRecallDoc.trim())}`)
      const d = await r.json()
      setMatRecallLines(Array.isArray(d) ? d : [])
    } catch {
      setMatRecallLines([])
    } finally {
      setMatRecallLoading(false)
    }
  }
  // 呼び出した金銭条件を このマテリアルへ紐づけ/解除(source_work_id=原作 / source_material_id=mid)。
  //   既存 worker graph-link を流用。複数件を個別に紐づけられる(金銭条件 n,n+1,…)。
  const assignRecalled = async (mid: number, line: any, assign: boolean) => {
    try {
      const body = assign
        ? { source_work_id: Number(workId), source_material_id: mid }
        : { source_material_id: null }
      await conditionClient.setGraphLink(line.id, body)
      await Promise.all([loadMatConds(mid), loadGraph(workId), recallByDoc()])
    } catch (e) {
      console.error("assignRecalled failed", e)
    }
  }

  // 登録済み条件の編集を開始(プリフィル)。
  const startEditCond = (c: any) => {
    setMatEditId(c.id)
    setMatEditErr(null)
    setMatEditForm({
      subject: c.subject ?? "",
      payment_scheme: c.payment_scheme ?? "royalty",
      rate_pct: c.rate_pct != null ? String(c.rate_pct) : "",
      mg_amount: c.mg_amount != null ? String(c.mg_amount) : "",
      ag_amount: c.ag_amount != null ? String(c.ag_amount) : "",
      amount_ex_tax: c.amount_ex_tax != null ? String(c.amount_ex_tax) : "",
      rights_attribution: c.rights_attribution ?? "",
      term_start: c.term_start ? String(c.term_start).slice(0, 10) : "",
      term_end: c.term_end ? String(c.term_end).slice(0, 10) : "",
      region_territory: c.region_territory ?? "",
      region_language: c.region_language ?? "",
      notes: c.notes ?? "",
    })
  }
  // 編集を保存(PATCH master-condition)。
  const saveEditCond = async (mid: number) => {
    if (matEditId == null) return
    setMatEditSaving(true)
    setMatEditErr(null)
    try {
      const f = matEditForm
      const body: Record<string, any> = {
        payment_scheme: f.payment_scheme,
        subject: f.subject || null,
        rights_attribution: f.rights_attribution || null,
        term_start: f.term_start || null,
        term_end: f.term_end || null,
        region_territory: f.region_territory || null,
        region_language: f.region_language || null,
        notes: f.notes || null,
      }
      if (f.payment_scheme === "royalty") {
        body.rate_pct = f.rate_pct || null
        body.mg_amount = f.mg_amount || null
        body.ag_amount = f.ag_amount || null
      } else if (f.payment_scheme !== "subscription") {
        body.amount_ex_tax = f.amount_ex_tax || null
      }
      const r = await fetch(`/api/v3/condition-lines/${matEditId}/master-condition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      setMatEditId(null)
      await Promise.all([loadMatConds(mid), loadGraph(workId)])
    } catch (e: any) {
      setMatEditErr(String(e?.message || e))
    } finally {
      setMatEditSaving(false)
    }
  }

  // 条件明細レコードの削除(データ整理用)。既定は safe(実績/構成リンクがあれば 409→強制確認)。
  const deleteCond = async (c: any, mid: number) => {
    const label = c.subject || c.line_code || `#${c.id}`
    if (!window.confirm(`条件「${label}」を削除しますか？`)) return
    try {
      let r = await fetch(`/api/v3/condition-lines/${c.id}`, { method: "DELETE" })
      if (r.status === 409) {
        const info = await r.json().catch(() => ({} as any))
        const msg =
          `この条件には支払実績 ${info.events ?? 0} 件・作品構成リンク ${info.links ?? 0} 件があります。\n` +
          `強制削除（関連レコードも一緒に削除＝不可逆）しますか？`
        if (!window.confirm(msg)) return
        r = await fetch(`/api/v3/condition-lines/${c.id}?force=true`, { method: "DELETE" })
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as any))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      await Promise.all([loadMatConds(mid), loadGraph(workId)])
    } catch (e: any) {
      window.alert(`削除に失敗: ${String(e?.message || e)}`)
    }
  }

  // 利用許諾条件を登録(原作の器 capability 配下に condition_line 生成)。
  const saveMatCond = async (mid: number) => {
    setMatSaving(true)
    setMatErr(null)
    try {
      const f = matForm
      const body: Record<string, any> = {
        capability_id: f.capability_id || null,
        payment_scheme: f.payment_scheme,
        subject: f.subject || null,
        rights_attribution: f.rights_attribution || null,
        term_start: f.term_start || null,
        term_end: f.term_end || null,
        region_territory: f.region_territory || null,
        region_language: f.region_language || null,
        notes: f.notes || null,
      }
      if (f.payment_scheme === "royalty") {
        body.rate_pct = f.rate_pct || null
        body.mg_amount = f.mg_amount || null
        body.ag_amount = f.ag_amount || null
      } else if (f.payment_scheme !== "subscription") {
        body.amount_ex_tax = f.amount_ex_tax || null
      }
      const r = await fetch(`/api/v3/source-ips/${encodeURIComponent(workId)}/materials/${mid}/condition-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      setMatForm({ payment_scheme: "royalty" })
      await Promise.all([loadMatConds(mid), loadGraph(workId)])
    } catch (e: any) {
      setMatErr(String(e?.message || e))
    } finally {
      setMatSaving(false)
    }
  }

  // (B) A1-軽量(§10.7「将来オプション: このエディタから個別条件書を起票→その場で条件明細を作る」):
  //   既存の文書作成フロー(/documents/new)を再利用して個別条件書を起票する。明細は文書(capability)
  //   配下に作る invariant を維持(condition_lines.capability_id は NOT NULL)。文書を保存すると既存
  //   フローで condition_lines が生成され、エディタに戻って下の⑧(文書番号で検索→結合)で参照リンクする。
  const issueNewConditionDoc = () => {
    // 新規起票は必ずクリーンな状態で開始(stale な下書き識別子による別文書上書き事故を防ぐ)。
    setSelectedIssue("")
    setDocFormData({ サブライセンシー一覧: [] })
    // 課題コンテキストが無いので prefill は付けない(テンプレ事前選択は template パラメータのみで効く。
    //   prefill=1 の自動プリフィルは purchase_order/inspection_certificate かつ課題ありの時だけ作動)。
    navigate(`/documents/new?template=${encodeURIComponent(newDocTemplate)}`)
  }

  // 増分⑧: 文書番号で個別条件書の condition_lines を検索。
  const searchEdges = async () => {
    if (!edgeDoc.trim()) return
    setEdgeSearching(true)
    setEdgeSearched(false)
    try {
      const r = await fetch(`/api/v3/condition-lines/by-document?document_number=${encodeURIComponent(edgeDoc.trim())}`)
      const d = await r.json()
      setEdgeLines(Array.isArray(d) ? d : [])
    } catch (e) {
      console.error("searchEdges failed", e)
      setEdgeLines([])
    } finally {
      setEdgeSearching(false)
      setEdgeSearched(true)
    }
  }
  // 増分⑧: condition_line をこの作品へ参照リンク / 解除(work_id 結合のみ)。
  const attachEdge = async (lineId: number, toWorkId: number | null) => {
    try {
      const r = await fetch(`/api/v3/condition-lines/${lineId}/attach-work`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_id: toWorkId }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await Promise.all([loadGraph(workId), searchEdges()])
    } catch (e) {
      console.error("attachEdge failed", e)
    }
  }

  // 増分⑤: 作品(own)の基本情報をインライン編集。
  const startEdit = () => {
    if (!work) return
    setForm({
      title: work.title ?? "",
      title_kana: work.title_kana ?? "",
      work_type: work.work_type ?? "",
      status: work.status ?? "",
      division: Array.isArray(work.division) ? work.division.join(", ") : (work.division ?? ""),
      remarks: work.remarks ?? "",
    })
    setSaveErr(null)
    setEditing(true)
  }
  const saveEdit = async () => {
    if (!form.title?.trim()) {
      setSaveErr("タイトルは必須です")
      return
    }
    setSaving(true)
    setSaveErr(null)
    try {
      // PUT は alternative_titles / parent_work_id / derivation_type も無条件に上書きするため、
      //   編集対象外の既存値を保持して送る(データ消失防止)。
      const body = {
        title: form.title.trim(),
        title_kana: form.title_kana?.trim() || null,
        work_type: form.work_type || null,
        status: form.status || null,
        division: form.division
          ? form.division.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        remarks: form.remarks?.trim() || null,
        alternative_titles: work.alternative_titles ?? null,
        parent_work_id: work.parent_work_id ?? null,
        derivation_type: work.derivation_type ?? null,
      }
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEditing(false)
      await loadGraph(workId)
    } catch (e: any) {
      setSaveErr(`保存に失敗しました（${e?.message || "unknown"}）`)
    } finally {
      setSaving(false)
    }
  }
  const inputCls =
    "w-full text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-5">
      <header className="border-b border-border pb-5">
        <p className="retro-tag mb-1.5">WORK · GRAPH</p>
        <h2 className="text-2xl font-mono font-bold tracking-tight">権利フロー（3カード）</h2>
        <p className="text-xs font-mono text-muted-foreground mt-1.5">
          原作 → 作品 → 派生物 を 向き×種別の条件明細でつなぐグラフ表示（統合Phase3c・ビュー）。
        </p>
        {/* 関係の明確化: 原作=マテリアルの集合 / 許諾はマテリアル単位 / 作品=必要マテリアルを選んで構成。
            利用者のメンタルモデル（作品G→C,D→条件）をそのまま図示して 3者の関係を伝える。 */}
        <details className="mt-3 rounded-md border border-border bg-muted/30 text-[11px] font-mono">
          <summary className="cursor-pointer px-3 py-1.5 font-bold text-foreground/90 select-none">
            ℹ️ 原作・原作マテリアル・作品の関係（クリックで開く）
          </summary>
          <div className="px-3 pb-2.5 pt-0.5 space-y-1.5 text-muted-foreground leading-relaxed">
            <p>
              <span className="font-bold text-sky-700">原作</span> は1つ以上の{" "}
              <span className="font-bold text-emerald-700">原作マテリアル</span>{" "}
              で構成されます（マテリアルごとに権利者が異なる場合があります）。
              <span className="font-bold">利用許諾条件はマテリアル単位</span>でぶら下がります。
            </p>
            <p>
              <span className="font-bold text-violet-700">作品</span> は原作から
              <span className="font-bold">必要なマテリアルだけを選んで</span>構成します。
              選んだマテリアルの条件が、この作品の<span className="font-bold">履行義務（支払う利用料）</span>になります。
            </p>
            <div className="rounded border border-border bg-card px-2.5 py-1.5 text-[10px]">
              例: 原作A（マテリアル B / C / D / F）から <span className="font-bold text-emerald-700">C・D</span> を使う作品G
              → 作品Gの利用許諾条件書に載るのは <span className="font-bold text-emerald-700">C・D の条件</span>。
            </div>
          </div>
        </details>
        <div className="mt-3 max-w-md">
          {/* 作品数の増加に耐えるよう検索型ピッカー(かな・別名でもヒット)。 */}
          <WorkPicker
            items={works.map((w: any) => toWorkPickerItem(w))}
            value={workId || undefined}
            onSelect={(w) => setWorkId(w ? String(w.id) : "")}
            placeholder="作品を検索 (コード / タイトル / 別名)"
          />
        </div>
      </header>

      {/* 契約・権利ツリー（金銭イン/アウト・買い切り・許諾地域サマリー）。 */}
      {workId ? <RightsTreePanel workId={workId} /> : null}

      {loading ? (
        <div className="text-xs font-mono text-muted-foreground py-8 text-center">読み込み中…</div>
      ) : !work ? (
        <div className="text-xs font-mono text-muted-foreground py-8 text-center">作品を選択してください。</div>
      ) : (
        <>
        {/* PLW-D: 作品1:文書N:明細N — この作品に明細単位で帰属する文書/明細/条件を集約。 */}
        <WorkAttributionsPanel workId={workId} />
        {/* 関係の明確化: 作品(own)が「どの原作のどのマテリアルを利用し、何を履行するか」をマテリアル単位でまとめて先頭に表示。
            これがこの作品の利用許諾条件書に載る条件（=支払う利用料）の実体であることを明示する。 */}
        {!isSource && consumedGroups.length > 0 && (
          <div className="rounded-md border border-sky-300 bg-sky-50/40 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-sky-700">
                この作品が利用する原作マテリアル／履行する利用許諾条件
              </span>
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                マテリアル {consumedGroups.length}
              </Badge>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              下のマテリアルの条件を履行（利用料を支払う）ことで、この作品を販売できます。これがこの作品の利用許諾条件書に記載される条件です。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {consumedGroups.map((g, gi) => (
                <div key={gi} className="rounded border border-border bg-card px-2.5 py-2 text-[11px] font-mono space-y-1">
                  {g.workId != null ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/works/${g.workId}`)}
                      className="block w-full text-left text-[10px] text-sky-700 truncate hover:underline"
                      title="この原作を開く"
                    >
                      <span className="font-bold">原作 ↗</span>{" "}
                      {g.workCode || ""} {g.workTitle || (g.workCode ? "" : "—")}
                    </button>
                  ) : (
                    <div className="text-[10px] text-muted-foreground truncate">
                      <span className="text-sky-700 font-bold">原作</span>{" "}
                      {g.workCode || ""} {g.workTitle || (g.workCode ? "" : "—")}
                    </div>
                  )}
                  <div className="font-semibold truncate">
                    <span className="text-emerald-700">◦ マテリアル</span>{" "}
                    {g.matCode || ""} {g.matName || (g.matCode ? "" : "（未設定）")}
                  </div>
                  <div className="space-y-1 pt-0.5 border-t border-border/50">
                    {g.edges.map((e) => (
                      <div key={e.id} className="space-y-0.5">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate">{e.subject || e.line_code || `条件#${e.id}`}</span>
                          <span className="shrink-0 font-semibold text-foreground/80">
                            {e.payment_scheme === "royalty"
                              ? e.rate_pct != null ? `${e.rate_pct}%` : "—"
                              : e.amount_ex_tax != null ? yen(e.amount_ex_tax) : "—"}
                          </span>
                        </div>
                        {/* 相手方(支払先の取引先)。誰に利用料を払うかを明示し、3者の関係を補強する。 */}
                        <div className="text-[10px] text-amber-700 truncate">
                          相手方: {e.counterparty || "（未設定）"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* 本丸(原作ビュー): 原作 → マテリアル(権利者) → 条件明細(算定) の 1原作:N材料:N条件 を
            一目で見せる構成ツリー。クリックせずに全体構造が把握できる(下の中カードで編集)。 */}
        {isSource && (
          <div className="rounded-md border border-sky-300 bg-sky-50/40 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-sky-700">
                原作の構成（マテリアル → 条件明細）
              </span>
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                マテリアル {materials.length}
              </Badge>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              原作は複数の原作マテリアルで構成され（権利者が異なる場合あり）、各マテリアルに複数の条件明細（直販／サブライセンス等の算定）がぶら下がります（1原作 : N材料 : N条件）。
            </p>
            {/* 原作⇄作品の往復: この原作を利用している自社作品へのクイックリンク（原作→作品）。 */}
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
              <span className="text-muted-foreground">この原作を利用する作品:</span>
              {uses.length === 0 ? (
                <span className="text-muted-foreground/70">まだありません</span>
              ) : (
                uses.map((u: any) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => navigate(`/works/${u.id}`)}
                    className="text-violet-700 hover:underline"
                    title="この作品を開く"
                  >
                    {u.work_code || `#${u.id}`} {u.title} ↗
                  </button>
                ))
              )}
            </div>
            {materials.length === 0 ? (
              <p className="text-[11px] font-mono text-muted-foreground">
                まだマテリアルがありません。下の中カードの「素材を追加」から登録してください。
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {materials.map((m: any) => {
                  const conds = srcMatConds[m.id] || []
                  return (
                    <div key={m.id} className="rounded border border-border bg-card px-2.5 py-2 text-[11px] font-mono space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold truncate">
                          <span className="text-emerald-700">◦ マテリアル</span>{" "}
                          {matDisplay(m.material_code, work?.title, m.material_name)}
                          {m.is_default && (
                            <Badge variant="outline" className="ml-1 border-emerald-300 text-emerald-700">本体</Badge>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => openMatEditor(m.id)}
                          className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-sky-400 text-sky-700 hover:bg-sky-50"
                          title="このマテリアルの条件明細を編集/追加"
                        >
                          条件編集 ▾
                        </button>
                      </div>
                      {m.rights_holder && (
                        <div className="text-[10px] text-amber-700 truncate">権利者: {m.rights_holder}</div>
                      )}
                      <div className="space-y-0.5 pt-0.5 border-t border-border/50">
                        {conds.length === 0 ? (
                          <div className="text-[10px] text-muted-foreground">条件明細なし</div>
                        ) : (
                          conds.map((c: any) => {
                            const isMlc =
                              c.source_system === "master_register" ||
                              String(c.document_number || "").startsWith("MLC-")
                            const editing = matEditId === c.id
                            const ecls =
                              "w-full text-[10px] font-mono bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
                            return (
                              <div key={c.id} className="space-y-1 border-b border-border/30 last:border-0 pb-1 last:pb-0">
                                <div className="flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
                                  <span className="truncate flex items-center gap-1 min-w-0">
                                    <span
                                      className={`shrink-0 text-[8px] font-mono px-1 py-0.5 rounded-sm border ${
                                        isMlc
                                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                          : "border-sky-300 bg-sky-50 text-sky-700"
                                      }`}
                                      title={isMlc ? "原作マスター(MLC)登録条件" : `文書由来: ${c.document_number || ""}`}
                                    >
                                      {isMlc ? "MLC" : (c.document_number || "文書")}
                                    </span>
                                    <span className="truncate">{c.subject || c.line_code || `条件#${c.id}`}</span>
                                  </span>
                                  <span className="shrink-0 flex items-center gap-1">
                                    <span className="font-semibold text-foreground/80">
                                      {c.payment_scheme === "royalty"
                                        ? c.rate_pct != null ? `${c.rate_pct}%` : "—"
                                        : c.amount_ex_tax != null ? yen(c.amount_ex_tax) : (c.payment_scheme || "—")}
                                    </span>
                                    <button type="button" onClick={() => startEditCond(c)}
                                      className="text-[9px] font-mono px-1 py-0.5 rounded border border-border hover:border-foreground/40" title="編集">編集</button>
                                    <button type="button" onClick={() => void deleteCond(c, m.id)}
                                      className="text-[9px] font-mono px-1 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" title="削除">削除</button>
                                  </span>
                                </div>
                                {editing && (
                                  <div className="rounded border border-sky-200 bg-sky-50/40 p-1.5 space-y-1 text-[10px]">
                                    {!isMlc && (
                                      <p className="text-[9px] text-amber-700">⚠ 文書由来の条件です。編集は文書側の表示と差異が出る場合があります。</p>
                                    )}
                                    <div className="grid grid-cols-2 gap-1">
                                      <label className="space-y-0.5"><span className="text-muted-foreground">名称</span>
                                        <input className={ecls} value={matEditForm.subject || ""} onChange={(e) => setMatEditForm({ ...matEditForm, subject: e.target.value })} /></label>
                                      <label className="space-y-0.5"><span className="text-muted-foreground">支払方式</span>
                                        <select className={ecls} value={matEditForm.payment_scheme || "royalty"} onChange={(e) => setMatEditForm({ ...matEditForm, payment_scheme: e.target.value })}>
                                          <option value="royalty">royalty(料率)</option>
                                          <option value="lump_sum">lump_sum(固定)</option>
                                          <option value="per_unit">per_unit</option>
                                          <option value="installment">installment</option>
                                          <option value="subscription">subscription</option>
                                        </select></label>
                                    </div>
                                    {matEditForm.payment_scheme === "royalty" ? (
                                      <div className="grid grid-cols-3 gap-1">
                                        <label className="space-y-0.5"><span className="text-muted-foreground">料率%</span><input className={ecls} value={matEditForm.rate_pct || ""} onChange={(e) => setMatEditForm({ ...matEditForm, rate_pct: e.target.value })} /></label>
                                        <label className="space-y-0.5"><span className="text-muted-foreground">MG</span><input className={ecls} value={matEditForm.mg_amount || ""} onChange={(e) => setMatEditForm({ ...matEditForm, mg_amount: e.target.value })} /></label>
                                        <label className="space-y-0.5"><span className="text-muted-foreground">AG</span><input className={ecls} value={matEditForm.ag_amount || ""} onChange={(e) => setMatEditForm({ ...matEditForm, ag_amount: e.target.value })} /></label>
                                      </div>
                                    ) : matEditForm.payment_scheme !== "subscription" ? (
                                      <label className="block space-y-0.5"><span className="text-muted-foreground">金額(税抜)</span><input className={ecls} value={matEditForm.amount_ex_tax || ""} onChange={(e) => setMatEditForm({ ...matEditForm, amount_ex_tax: e.target.value })} /></label>
                                    ) : null}
                                    <div className="grid grid-cols-2 gap-1">
                                      <label className="space-y-0.5"><span className="text-muted-foreground">地域</span><input className={ecls} value={matEditForm.region_territory || ""} onChange={(e) => setMatEditForm({ ...matEditForm, region_territory: e.target.value })} /></label>
                                      <label className="space-y-0.5"><span className="text-muted-foreground">言語</span><input className={ecls} value={matEditForm.region_language || ""} onChange={(e) => setMatEditForm({ ...matEditForm, region_language: e.target.value })} /></label>
                                    </div>
                                    {matEditErr && <p className="text-[9px] text-red-600">{matEditErr}</p>}
                                    <div className="flex justify-end gap-1">
                                      <button type="button" onClick={() => setMatEditId(null)} className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">取消</button>
                                      <button type="button" onClick={() => void saveEditCond(m.id)} disabled={matEditSaving} className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500 bg-sky-50 text-sky-700 font-bold disabled:opacity-50">{matEditSaving ? "保存中…" : "保存"}</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })
                        )}
                        <div className="text-[9px] text-muted-foreground/60">条件 {conds.length}件</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr,1fr] gap-3 items-start">
          {/* 左 = 原作 / 素材調達（支払）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">原作 / 調達（支払）▶</h3>
                <Badge variant="outline" className="border-amber-300 text-amber-700">支払 {upstream.length}</Badge>
              </div>
              {/* 増分⑥+(§3.2/決定§8.2): 原作をその場で新規登録 → 候補一覧に追加し各支払エッジで選択可に */}
              {!isSource && (
                <div className="border-b border-border/60 pb-2">
                  {!showNewSource ? (
                    <button
                      type="button"
                      onClick={() => setShowNewSource(true)}
                      className="text-[11px] font-mono px-2 py-0.5 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                    >
                      ＋ 原作を新規
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={newSourceTitle}
                          onChange={(e) => setNewSourceTitle(e.target.value)}
                          placeholder="原作タイトル *"
                          autoFocus
                          className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                        />
                        <button
                          type="button"
                          onClick={createSource}
                          disabled={creatingSource || !newSourceTitle.trim()}
                          className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {creatingSource ? "作成中…" : "作成"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowNewSource(false); setNewSourceTitle("") }}
                          className="text-[11px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                        >
                          取消
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">
                        作成後、各支払エッジの「原作に紐付け」から選べます（LO- 採番）。
                      </p>
                    </div>
                  )}
                </div>
              )}
              {upstream.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">支払エッジはありません。</p>
              ) : (
                upstream.map((e) => (
                  <React.Fragment key={e.id}>
                    <EdgeRow e={e} side="up" materials={materials} products={products} sourceWorks={sourceWorks} vendors={vendors} onLink={linkEdge} />
                  </React.Fragment>
                ))
              )}
            </CardContent>
          </Card>

          {/* 中 = 作品（own） / 原作（source, 増分⑥）*/}
          <Card className="border-foreground/30">
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">{isSource ? "原作（source）" : "作品（own）"}</h3>
                {!editing && !isSource && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  >
                    編集
                  </button>
                )}
              </div>
              {editing ? (
                /* 増分⑤: 基本情報インライン編集 */
                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono font-bold">{work.work_code}</div>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="タイトル *"
                    className={inputCls}
                  />
                  <input
                    value={form.title_kana}
                    onChange={(e) => setForm((f) => ({ ...f, title_kana: e.target.value }))}
                    placeholder="タイトル(カナ)"
                    className={inputCls}
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={form.work_type}
                      onChange={(e) => setForm((f) => ({ ...f, work_type: e.target.value }))}
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1"
                    >
                      <option value="">種別 —</option>
                      {WORK_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1"
                    >
                      <option value="">状態 —</option>
                      {WORK_STATUS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={form.division}
                    onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))}
                    placeholder="区分(, 区切り) 例: BDG, PUB"
                    className={inputCls}
                  />
                  <textarea
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    placeholder="備考"
                    rows={2}
                    className="w-full text-[11px] font-mono border border-input rounded bg-transparent px-2 py-1 focus:outline-none focus:border-foreground"
                  />
                  {saveErr && <p role="alert" className="text-[10px] font-mono text-red-600">{saveErr}</p>}
                  <div className="flex items-center justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={saving || !form.title?.trim()}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      {saving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] font-mono">
                  <div className="font-bold">{work.work_code}</div>
                  <div>{work.title}</div>
                  {work.title_kana && <div className="text-muted-foreground">{work.title_kana}</div>}
                  {(work.work_type || work.status) && (
                    <div className="text-muted-foreground">
                      {work.work_type || "—"} / {work.status || "—"}
                    </div>
                  )}
                </div>
              )}
              {/* 増分⑥(§3.4): 原作中心ビュー — この原作を利用している自社作品 + 新規作成 */}
              {isSource && (
                <div className="border-t border-border/60 pt-2 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    この原作を利用している自社作品
                  </div>
                  {uses.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">まだありません。</p>
                  ) : (
                    uses.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => navigate(`/works/${u.id}`)}
                        className="block w-full text-left text-[11px] font-mono border border-border/60 rounded px-2 py-1 hover:border-foreground/40"
                      >
                        <span className="font-semibold">{u.work_code}</span> {u.title}
                      </button>
                    ))
                  )}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      value={newOwnTitle}
                      onChange={(e) => setNewOwnTitle(e.target.value)}
                      placeholder="この原作から作品を新規作成"
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={createOwnFromSource}
                      disabled={creatingOwn || !newOwnTitle.trim()}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      {creatingOwn ? "作成中…" : "作成"}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    作成後、その作品の支払エッジで「原作に紐付け」するとリンクされます。
                  </p>
                </div>
              )}

              {/* 設計 v1.4 Phase C(UIC-02): 原作の利用許諾条件は「個別利用許諾条件書」文書フォームで起票。
                  旧 v3 ライセンスマトリクス(直接保存する license-matrix API)は撤去し、
                  条件明細の唯一の書込み口＝Document Command へ一本化した。既存条件は下の素材一覧で閲覧。 */}
              {isSource && materials.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-indigo-200 bg-indigo-50/30 px-2.5 py-2">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-indigo-700">
                    利用許諾条件（原作マスター）
                  </div>
                  <p className="text-[9px] text-muted-foreground/70">
                    この原作の素材ごとの取引形態・料率は<strong>「個別利用許諾条件書」文書フォーム</strong>で登録・修正します（データの唯一の入力口＝文書作成）。
                    登録済みの条件は下の「素材（クリックで条件明細を確認）」で閲覧できます。
                  </p>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={createLicenseDocForSource}
                      className="text-[10px] font-mono px-2.5 py-1 rounded border border-indigo-500 bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100"
                    >
                      文書フォームで条件を登録（個別利用許諾条件書）
                    </button>
                  </div>
                </div>
              )}

              {materials.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    素材{isSource && "（クリックで条件明細を確認）"}
                  </div>
                  {materials.map((m) => (
                    <div key={m.id} id={`srcmat-${m.id}`} className="text-[11px] font-mono border border-border/60 rounded overflow-hidden scroll-mt-20">
                      {isSource ? (
                        <button
                          type="button"
                          onClick={() => toggleMatCond(m.id)}
                          className="w-full text-left px-2 py-1 hover:bg-muted/40 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            <span className="font-semibold">{m.material_code || "—"}</span>{work?.title ? ` ${work.title}　` : " "}{m.material_name}
                            {m.is_default && <Badge variant="outline" className="ml-1 border-emerald-300 text-emerald-700">本体</Badge>}
                            {m.rights_holder && <span className="text-[10px] text-amber-700"> · 権利者: {m.rights_holder}</span>}
                          </span>
                          <span className="text-[10px] text-sky-700 shrink-0">
                            {matCondOpen === m.id ? "▲ 閉じる" : "利用許諾条件 ▾"}
                          </span>
                        </button>
                      ) : (
                        <div className="px-2 py-1">
                          <span className="font-semibold">{m.material_code || "—"}</span> {m.material_name}
                          {m.is_default && <Badge variant="outline" className="ml-1 border-emerald-300 text-emerald-700">本体</Badge>}
                          {m.rights_holder && <span className="text-[10px] text-amber-700"> · 権利者: {m.rights_holder}</span>}
                        </div>
                      )}
                      {isSource && matCondOpen === m.id && (
                        <div className="border-t border-border/60 p-2 space-y-2 bg-muted/20">
                          {/* 条件の追加・編集は「個別利用許諾条件書」文書フォームに一本化。
                              ここは既存条件の確認＋文書由来条件の紐づけ(下の details)のみ。 */}
                          <div className="space-y-1">
                            <p className="text-[10px] font-mono text-muted-foreground">
                              条件の追加・編集は上の
                              <strong className="text-indigo-700">「文書フォームで条件を登録（個別利用許諾条件書）」</strong>
                              から行います（データの唯一の入力口＝文書作成）。この素材はその原作の構成要素として扱われます。
                            </p>
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => setMatCondOpen(null)}
                                className="text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                              >
                                閉じる
                              </button>
                            </div>
                          </div>

                          {/* 上級(任意): 既存の金銭条件を文書番号で呼び出してこのマテリアルへ紐づける(複数可) */}
                          <details className="rounded border border-sky-200">
                            <summary className="cursor-pointer px-1.5 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-sky-700 select-none">
                              ▶ 既存の金銭条件を文書番号から呼び出して紐づける（任意）
                            </summary>
                            <div className="p-1.5 space-y-1.5 border-t border-sky-200">
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={matRecallDoc}
                                  onChange={(e) => setMatRecallDoc(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") void recallByDoc() }}
                                  placeholder="文書番号 (例: LIC-... / ARC-...)"
                                  className="flex-1 text-[10px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                                />
                                <button type="button" onClick={() => void recallByDoc()} disabled={matRecallLoading || !matRecallDoc.trim()} className="text-[10px] font-mono px-2 py-1 rounded border border-border hover:border-foreground/40 disabled:opacity-50">
                                  {matRecallLoading ? "呼出中…" : "呼び出す"}
                                </button>
                              </div>
                              {matRecallLines.map((l) => {
                                const here = String(l.source_material_id ?? "") === String(m.id)
                                return (
                                  <div key={l.id} className="flex items-center justify-between gap-2 text-[10px] border border-border/50 rounded px-1.5 py-1">
                                    <div className="min-w-0">
                                      <span className="font-semibold">金銭条件{l.source_seq_no ?? "—"}</span>{" · "}
                                      {l.subject || l.line_code}{" · "}
                                      {l.payment_scheme === "royalty"
                                        ? `${l.rate_pct ?? "—"}%${l.mg_amount ? ` MG${yen(l.mg_amount)}` : ""}${l.ag_amount ? ` AG${yen(l.ag_amount)}` : ""}`
                                        : yen(l.amount_ex_tax) || l.payment_scheme}
                                      {l.region_language_label && <span className="text-muted-foreground">{" · 🌐 "}{l.region_language_label}</span>}
                                      {!here && l.source_material_id != null && <span className="text-amber-600">{" · 他素材に紐付け済"}</span>}
                                    </div>
                                    {here ? (
                                      <button type="button" onClick={() => void assignRecalled(m.id, l, false)} className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground">外す</button>
                                    ) : (
                                      <button type="button" onClick={() => void assignRecalled(m.id, l, true)} className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-sky-400 text-sky-700 hover:bg-sky-50">紐づける</button>
                                    )}
                                  </div>
                                )
                              })}
                              {matRecallLines.length > 0 && (
                                <p className="text-[9px] text-muted-foreground/70">複数の金銭条件(n, n+1, …)をそれぞれこのマテリアルに紐づけられます。</p>
                              )}
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* 増分②: 素材を追加(work_material)。{work_code}-NNN を自動採番。 */}
              <div className="border-t border-border/60 pt-2 space-y-1.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">素材を追加</div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={matName}
                    onChange={(e) => setMatName(e.target.value)}
                    placeholder="素材名 (例: カバーイラスト)"
                    className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                  />
                  <select
                    value={matType}
                    onChange={(e) => setMatType(e.target.value)}
                    className="text-[11px] font-mono border-b border-input bg-transparent py-1"
                  >
                    <option value="original">原作</option>
                    <option value="translation">翻訳</option>
                    <option value="illustration">イラスト</option>
                    <option value="scenario">シナリオ</option>
                    <option value="design">デザイン</option>
                    <option value="music">音楽</option>
                  </select>
                  <button
                    type="button"
                    onClick={addMaterial}
                    disabled={adding || !matName.trim()}
                    className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {adding ? "追加中…" : "追加"}
                  </button>
                </div>
              </div>
              {products.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">製品(SKU)</div>
                  {products.map((p) => (
                    <div key={p.id} className="text-[11px] font-mono border border-border/60 rounded px-2 py-1">
                      <span className="font-semibold">{p.product_code || "—"}</span> {p.product_name}
                      {p.format && <span className="text-muted-foreground"> · {p.format}</span>}
                      {p.msrp != null && <span className="text-muted-foreground"> · {yen(p.msrp)}</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* 増分⑦: 製品(SKU)を追加(own のみ)。product_code は API で {work_code}-P-NNN 採番。 */}
              {!isSource && (
                <div className="border-t border-border/60 pt-2 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">製品を追加</div>
                  <input
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="製品名 (例: 通常版)"
                    className={inputCls}
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={prodFormat}
                      onChange={(e) => setProdFormat(e.target.value)}
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1"
                    >
                      <option value="">形態 —</option>
                      <option value="physical">physical</option>
                      <option value="ebook">ebook</option>
                      <option value="print_on_demand">print_on_demand</option>
                    </select>
                    <input
                      value={prodMsrp}
                      onChange={(e) => setProdMsrp(e.target.value)}
                      inputMode="numeric"
                      placeholder="希望小売価格"
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={addProduct}
                      disabled={addingProduct || !prodName.trim()}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      {addingProduct ? "追加中…" : "追加"}
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右 = 受取（派生物 / 物販アウト）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">◀ 受取（派生物 / 卸）</h3>
                <Badge variant="outline" className="border-emerald-300 text-emerald-700">受取 {downstream.length}</Badge>
              </div>
              {downstream.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">受取エッジはありません。</p>
              ) : (
                downstream.map((e) => (
                  <React.Fragment key={e.id}>
                    <EdgeRow e={e} side="down" materials={materials} products={products} sourceWorks={sourceWorks} vendors={vendors} onLink={linkEdge} />
                  </React.Fragment>
                ))
              )}
            </CardContent>
          </Card>
        </div>
        {/* N:N活性化 Stage3: 原作起点ピッカー — 原作を選ぶ→その利用許諾条件明細を共有結線 */}
        {!isSource && (
          <div className="rounded-md border border-dashed border-sky-300 p-3 space-y-2">
            <div className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-sky-700">
              ＋ 原作のマテリアル条件から、この作品で使うものを選ぶ
            </div>
            <p className="text-[10px] font-mono text-muted-foreground -mt-1">
              原作を選ぶ→各条件に「利用するマテリアル」を指定→「この作品に追加」。追加した条件がこの作品の履行義務（上のサマリー）になります。
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">原作:</span>
              {/* 原作数の増加に耐えるよう検索型ピッカー(かな・別名でもヒット)。 */}
              <WorkPicker
                items={sourceWorks.map((s: any) => toWorkPickerItem(s))}
                value={pickerSource || undefined}
                onSelect={(s) => {
                  const id = s ? String(s.id) : ""
                  setPickerSource(id)
                  void loadPicker(id, workId)
                }}
                placeholder="原作を検索 (コード / タイトル / 別名)"
                className="min-w-[16rem] flex-1 max-w-md"
              />
              {pickerLoading && <span className="text-[10px] text-muted-foreground">読込中…</span>}
            </div>
            {pickerSource && !pickerLoading && pickerLines.length === 0 && (
              <p className="text-[11px] font-mono text-muted-foreground">
                この原作に紐づく利用許諾条件明細がありません（明細の出所原作が未設定の可能性）。
              </p>
            )}
            {/* ツリー: 原作 → マテリアル → 条件明細。マテリアル確定済みはヘッダ配下に束ね、
                未割当グループは各条件でマテリアルを選んでから追加する。 */}
            {pickerGroups.map((g, gi) => (
              <div key={gi} className="space-y-1 border border-border/50 rounded-md p-2">
                <div className="text-[10px] font-mono font-bold flex items-center gap-1.5 flex-wrap">
                  {g.mat ? (
                    <>
                      <span className="text-emerald-700">◦ マテリアル</span>
                      <span>{matDisplay(g.mat.material_code, pickerSrcTitle, g.mat.material_name)}</span>
                      {g.mat.rights_holder_name && (
                        <span className="text-amber-700">（権利者: {g.mat.rights_holder_name}）</span>
                      )}
                      <span className="text-muted-foreground/60">· 条件 {g.lines.length}件</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">（マテリアル未割当 — 各条件で選択して追加）</span>
                  )}
                </div>
                {g.lines.map((l: any) => {
                  const knownMat = !!g.mat
                  return (
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-2 text-[11px] font-mono border border-border/60 rounded px-2 py-1.5 ml-2"
                    >
                      <div className="min-w-0 space-y-0.5 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <KindBadge kind={l.transaction_kind} />
                          <span className="font-semibold truncate">{l.subject || l.line_code || `#${l.id}`}</span>
                          {l.payment_scheme === "royalty"
                            ? l.rate_pct != null && <span className="text-muted-foreground">{l.rate_pct}%</span>
                            : l.amount_ex_tax != null && <span className="text-muted-foreground">{yen(l.amount_ex_tax)}</span>}
                          {l.counterparty && <span className="text-[10px] text-amber-700">相手方: {l.counterparty}</span>}
                          {l.linked_here && <span className="text-[10px] text-emerald-700">✓ 利用中</span>}
                        </div>
                        {!knownMat && !l.linked_here && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground shrink-0">利用するマテリアル:</span>
                            <NativeSelect
                              value={pickerLineMat[l.id] ?? ""}
                              onChange={(e) => setPickerLineMat((prev) => ({ ...prev, [l.id]: e.target.value }))}
                              className="h-6 text-[10px] py-0 min-w-[10rem]"
                            >
                              <option value="">— マテリアルを選択 —</option>
                              {pickerMaterials.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {matDisplay(m.material_code, pickerSrcTitle, m.material_name)}{m.rights_holder_name ? `（権利者: ${m.rights_holder_name}）` : ""}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                        )}
                        {l.document_number && (
                          <div className="text-[10px] text-muted-foreground/70 truncate">{l.document_number}</div>
                        )}
                      </div>
                      {l.linked_here ? (
                        <button
                          type="button"
                          onClick={() => void removeComponentLine(l)}
                          className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                        >
                          外す
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void addComponentLine(l)}
                          disabled={!(pickerLineMat[l.id] || l.source_material_id != null)}
                          title={!(pickerLineMat[l.id] || l.source_material_id != null) ? "原作マテリアルを選択してください" : undefined}
                          className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-sky-400 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                        >
                          この作品に追加
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground/70">
              ※ 各明細に「原作素材」を選んでこの作品へ結線します（条件はマテリアルにぶら下がる）。同じ明細を複数の作品で共有でき（N:N）、「外す」はこの作品ぶんだけ解除します。明細が出ない場合は、支払エッジの「原作に紐付け」で出所原作を設定してください。
            </p>
          </div>
        )}
        {/* 増分⑧: 個別条件書から condition_lines をこの作品へ参照リンク(§3.6/§10.7: 明細は新規作成しない) */}
        <div className="rounded-md border border-dashed border-input p-3 space-y-2">
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
            ＋ 条件明細をこの作品に追加（個別条件書から参照）
          </div>
          {/* (B) A1-軽量(§10.7): ここから個別条件書を起票 → 保存で明細生成 → 戻って下の検索で結合 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">新規に起票:</span>
            <NativeSelect
              value={newDocTemplate}
              onChange={(e) => setNewDocTemplate(e.target.value)}
              className="h-7 text-[11px]"
            >
              <option value="individual_license_terms">個別利用許諾条件書</option>
              <option value="pub_license_terms">出版等利用許諾条件書</option>
            </NativeSelect>
            <button
              type="button"
              onClick={issueNewConditionDoc}
              className="text-[11px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
            >
              個別条件書を起票 ↗
            </button>
            <span className="text-[10px] text-muted-foreground/70">作成後、下の文書番号で検索して結合</span>
          </div>
          <div className="flex items-center gap-1.5 max-w-md">
            <input
              value={edgeDoc}
              onChange={(e) => setEdgeDoc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void searchEdges()
              }}
              placeholder="文書番号 (例: LIC-... / ARC-...)"
              className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => void searchEdges()}
              disabled={edgeSearching || !edgeDoc.trim()}
              className="text-[11px] font-mono px-2 py-1 rounded border border-border hover:border-foreground/40 disabled:opacity-50"
            >
              {edgeSearching ? "検索中…" : "検索"}
            </button>
          </div>
          {edgeSearched && edgeLines.length === 0 && (
            <p className="text-[11px] font-mono text-muted-foreground">該当する条件明細がありません。</p>
          )}
          {edgeLines.map((l) => {
            const linkedHere = String(l.work_id ?? "") === String(workId)
            return (
              <div
                key={l.id}
                className="flex items-center justify-between gap-2 text-[11px] font-mono border border-border/60 rounded px-2 py-1.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <KindBadge kind={l.transaction_kind} />
                    <span className="font-semibold truncate">{l.subject || l.line_code || `#${l.id}`}</span>
                    <span className="text-muted-foreground">{l.direction === "payable" ? "支払" : "受取"}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 truncate">
                    {l.document_number}
                    {l.current_work_code && !linkedHere && ` · 紐付け済: ${l.current_work_code}`}
                  </div>
                </div>
                {linkedHere ? (
                  <button
                    type="button"
                    onClick={() => void attachEdge(l.id, null)}
                    className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    外す
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void attachEdge(l.id, Number(workId))}
                    className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                  >
                    {l.work_id ? "付替えて追加" : "追加"}
                  </button>
                )}
              </div>
            )
          })}
          <p className="text-[10px] text-muted-foreground/70">
            ※ 明細の作成は個別条件書フローで。ここでは既存明細をこの作品へ結び付け（参照リンク）し、direction に応じて支払/受取カードに表示します。
          </p>
        </div>
        </>
      )}
    </div>
  )
}
