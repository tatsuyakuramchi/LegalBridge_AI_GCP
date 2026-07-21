/**
 * WorkDetailContext — 作品詳細 8タブの共有 state 基盤（設計 §10.4 / 8タブ移行 Phase 5）。
 *
 * これまで WorkGraphPanel（3カード・1866行）が単一コンポーネント内に同居させていた
 * state / effect / handler / 派生値を、Context へ「持ち上げ」て各タブ section から
 * 共有できるようにする。これにより ②作品系譜・③マテリアル・④権利根源・⑥製品 等の
 * ブロックを物理的に別 section（別タブ）へ切り出せる。
 *
 * 重要（§20）: API の呼び方・保存ペイロード・DQ 発火は WorkGraphPanel 時代から一切
 * 変えない。本 Context は「同じロジックを別の場所で共有する」だけの構造変更である。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { evaluateEntity } from "@/src/lib/api/dataQualityClient"
import { useDocumentSession } from "@/src/context/AppDataContext"
import { conditionClient } from "@/src/lib/api/conditionClient"
import { toWorkPickerItem, type WorkPickerItem } from "@/src/components/work/WorkPicker"

// エッジ（condition_lines を向き×取引種別で表現）。旧 WorkGraphPanel の Edge 型を移設。
export type Edge = {
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
  region_territory?: string | null
  region_language?: string | null
  region_language_label?: string | null
  territory_label?: string | null
}

export interface ConsumedGroup {
  workId?: number | null
  workCode?: string | null
  workTitle?: string | null
  matCode?: string | null
  matName?: string | null
  edges: Edge[]
}

export interface WorkDetailModel {
  // 選択・グラフ本体
  works: any[]
  workId: string
  setWorkId: React.Dispatch<React.SetStateAction<string>>
  graph: any
  loading: boolean
  work: any
  upstream: Edge[]
  downstream: Edge[]
  materials: any[]
  products: any[]
  isSource: boolean
  navigate: ReturnType<typeof useNavigate>

  // 素材追加（③）
  matName: string
  setMatName: React.Dispatch<React.SetStateAction<string>>
  matType: string
  setMatType: React.Dispatch<React.SetStateAction<string>>
  adding: boolean
  addMaterial: () => Promise<void>

  // 基本情報インライン編集（①）
  editing: boolean
  setEditing: React.Dispatch<React.SetStateAction<boolean>>
  form: Record<string, string>
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>
  saving: boolean
  saveErr: string | null
  startEdit: () => void
  saveEdit: () => Promise<void>

  // 原作（source）関連（②/④）
  sourceWorks: any[]
  uses: any[]
  newOwnTitle: string
  setNewOwnTitle: React.Dispatch<React.SetStateAction<string>>
  creatingOwn: boolean
  createOwnFromSource: () => Promise<void>
  showNewSource: boolean
  setShowNewSource: React.Dispatch<React.SetStateAction<boolean>>
  newSourceTitle: string
  setNewSourceTitle: React.Dispatch<React.SetStateAction<string>>
  creatingSource: boolean
  createSource: () => Promise<void>
  createLicenseDocForSource: () => void

  // 製品（⑥）
  vendors: any[]
  prodName: string
  setProdName: React.Dispatch<React.SetStateAction<string>>
  prodFormat: string
  setProdFormat: React.Dispatch<React.SetStateAction<string>>
  prodMsrp: string
  setProdMsrp: React.Dispatch<React.SetStateAction<string>>
  addingProduct: boolean
  addProduct: () => Promise<void>
  // ⑥製品 編集/削除
  editingProductId: number | null
  productForm: Record<string, string>
  setProductForm: React.Dispatch<React.SetStateAction<Record<string, string>>>
  productSaving: boolean
  productErr: string | null
  startEditProduct: (p: any) => void
  cancelEditProduct: () => void
  saveProduct: () => Promise<void>
  deleteProduct: (p: any) => Promise<void>

  // エッジのノード参照リンク
  linkEdge: (edgeId: number, patch: any) => Promise<void>

  // 個別条件書からの参照リンク（⑤・増分⑧）
  edgeDoc: string
  setEdgeDoc: React.Dispatch<React.SetStateAction<string>>
  edgeLines: any[]
  edgeSearching: boolean
  edgeSearched: boolean
  searchEdges: () => Promise<void>
  attachEdge: (lineId: number, toWorkId: number | null) => Promise<void>
  newDocTemplate: string
  setNewDocTemplate: React.Dispatch<React.SetStateAction<string>>
  issueNewConditionDoc: () => void

  // 原作起点ピッカー（⑤・N:N 結線）
  pickerSource: string
  setPickerSource: React.Dispatch<React.SetStateAction<string>>
  pickerLines: any[]
  pickerLoading: boolean
  pickerMaterials: any[]
  pickerLineMat: Record<number, string>
  setPickerLineMat: React.Dispatch<React.SetStateAction<Record<number, string>>>
  loadPicker: (sourceId: string, curWorkId: string) => Promise<void>
  addComponentLine: (line: any) => Promise<void>
  removeComponentLine: (line: any) => Promise<void>
  pickerGroups: { mat: any | null; lines: any[] }[]
  pickerSrcTitle: string | null

  // マテリアル単位の条件パネル（③/④）
  matCondOpen: number | null
  setMatCondOpen: React.Dispatch<React.SetStateAction<number | null>>
  toggleMatCond: (mid: number) => void
  openMatEditor: (mid: number) => void
  matEditId: number | null
  setMatEditId: React.Dispatch<React.SetStateAction<number | null>>
  matEditForm: Record<string, string>
  setMatEditForm: React.Dispatch<React.SetStateAction<Record<string, string>>>
  matEditSaving: boolean
  matEditErr: string | null
  startEditCond: (c: any) => void
  saveEditCond: (mid: number) => Promise<void>
  deleteCond: (c: any, mid: number) => Promise<void>
  matRecallDoc: string
  setMatRecallDoc: React.Dispatch<React.SetStateAction<string>>
  matRecallLines: any[]
  matRecallLoading: boolean
  recallByDoc: () => Promise<void>
  assignRecalled: (mid: number, line: any, assign: boolean) => Promise<void>
  srcMatConds: Record<number, any[]>

  // ② 作品系譜（work_relations 多対多）
  relations: { parents: any[]; children: any[] }
  relationsLoading: boolean
  loadRelations: () => Promise<void>
  relForm: Record<string, string>
  setRelForm: React.Dispatch<React.SetStateAction<Record<string, string>>>
  addingRelation: boolean
  relationErr: string | null
  addRelation: () => Promise<void>
  deleteRelation: (relationId: number) => Promise<void>

  // 派生値
  consumedGroups: ConsumedGroup[]
  parentCandidates: WorkPickerItem[]

  loadGraph: (id: string) => Promise<void>
}

/**
 * useWorkDetailModel — 旧 WorkGraphPanel の全ロジック（state/effect/handler/memo）。
 *   routeId = 作品詳細ルートの :id。未指定時は先頭作品にフォールバック（旧挙動）。
 */
function useWorkDetailModel(routeId?: string): WorkDetailModel {
  const navigate = useNavigate()
  // 個別条件書の起票へ遷移する際、ドキュメントセッションをクリーン初期化する。
  const { setSelectedIssue, setFormData: setDocFormData } = useDocumentSession()
  const [works, setWorks] = React.useState<any[]>([])
  const [workId, setWorkId] = React.useState<string>(routeId ?? "")
  const [graph, setGraph] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  // 素材追加
  const [matName, setMatName] = React.useState("")
  const [matType, setMatType] = React.useState("illustration")
  const [adding, setAdding] = React.useState(false)
  // 基本情報インライン編集
  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [saveErr, setSaveErr] = React.useState<string | null>(null)
  // 原作リンク + 原作中心ビュー
  const [sourceWorks, setSourceWorks] = React.useState<any[]>([])
  const [uses, setUses] = React.useState<any[]>([])
  const [newOwnTitle, setNewOwnTitle] = React.useState("")
  const [creatingOwn, setCreatingOwn] = React.useState(false)
  const [showNewSource, setShowNewSource] = React.useState(false)
  const [newSourceTitle, setNewSourceTitle] = React.useState("")
  const [creatingSource, setCreatingSource] = React.useState(false)
  // 製品(SKU)追加 + 受取先リンク
  const [vendors, setVendors] = React.useState<any[]>([])
  const [prodName, setProdName] = React.useState("")
  const [prodFormat, setProdFormat] = React.useState("")
  const [prodMsrp, setProdMsrp] = React.useState("")
  const [addingProduct, setAddingProduct] = React.useState(false)
  // ⑥製品 インライン編集/削除
  const [editingProductId, setEditingProductId] = React.useState<number | null>(null)
  const [productForm, setProductForm] = React.useState<Record<string, string>>({})
  const [productSaving, setProductSaving] = React.useState(false)
  const [productErr, setProductErr] = React.useState<string | null>(null)
  // 個別条件書からの参照リンク
  const [edgeDoc, setEdgeDoc] = React.useState("")
  const [edgeLines, setEdgeLines] = React.useState<any[]>([])
  const [edgeSearching, setEdgeSearching] = React.useState(false)
  const [edgeSearched, setEdgeSearched] = React.useState(false)
  const [newDocTemplate, setNewDocTemplate] = React.useState("individual_license_terms")
  // 原作起点ピッカー
  const [pickerSource, setPickerSource] = React.useState("")
  const [pickerLines, setPickerLines] = React.useState<any[]>([])
  const [pickerLoading, setPickerLoading] = React.useState(false)
  const [pickerMaterials, setPickerMaterials] = React.useState<any[]>([])
  const [pickerLineMat, setPickerLineMat] = React.useState<Record<number, string>>({})
  // マテリアル単位の条件パネル
  const [matCondOpen, setMatCondOpen] = React.useState<number | null>(null)
  const [matEditId, setMatEditId] = React.useState<number | null>(null)
  const [matEditForm, setMatEditForm] = React.useState<Record<string, string>>({})
  const [matEditSaving, setMatEditSaving] = React.useState(false)
  const [matEditErr, setMatEditErr] = React.useState<string | null>(null)
  const [matRecallDoc, setMatRecallDoc] = React.useState("")
  const [matRecallLines, setMatRecallLines] = React.useState<any[]>([])
  const [matRecallLoading, setMatRecallLoading] = React.useState(false)
  const [srcMatConds, setSrcMatConds] = React.useState<Record<number, any[]>>({})
  // ② 作品系譜（work_relations 多対多）
  const [relations, setRelations] = React.useState<{ parents: any[]; children: any[] }>({ parents: [], children: [] })
  const [relationsLoading, setRelationsLoading] = React.useState(false)
  const [relForm, setRelForm] = React.useState<Record<string, string>>({})
  const [addingRelation, setAddingRelation] = React.useState(false)
  const [relationErr, setRelationErr] = React.useState<string | null>(null)

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
      console.error("addMaterial failed", e)
    } finally {
      setAdding(false)
    }
  }

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

  // ⑥製品 編集: 名称/形態/希望小売価格を更新(PUT /api/v3/works/:id/products/:productId)。
  const startEditProduct = (p: any) => {
    setEditingProductId(p.id)
    setProductErr(null)
    setProductForm({
      product_name: p.product_name ?? "",
      format: p.format ?? "",
      msrp: p.msrp != null ? String(p.msrp) : "",
    })
  }
  const cancelEditProduct = () => {
    setEditingProductId(null)
    setProductErr(null)
  }
  const saveProduct = async () => {
    if (editingProductId == null || !workId) return
    if (!productForm.product_name?.trim()) {
      setProductErr("製品名は必須です")
      return
    }
    setProductSaving(true)
    setProductErr(null)
    try {
      const r = await fetch(
        `/api/v3/works/${encodeURIComponent(workId)}/products/${editingProductId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_name: productForm.product_name.trim(),
            format: productForm.format || null,
            msrp: productForm.msrp.trim() ? Number(productForm.msrp) : null,
          }),
        }
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEditingProductId(null)
      await loadGraph(workId)
    } catch (e: any) {
      setProductErr(`保存に失敗しました（${e?.message || "unknown"}）`)
    } finally {
      setProductSaving(false)
    }
  }
  // ⑥製品 削除: 既定 safe。受取エッジ紐付けがあれば 409→確認のうえ force で紐付けを外して削除。
  const deleteProduct = async (p: any) => {
    if (!workId) return
    const label = p.product_name || p.product_code || `#${p.id}`
    if (!window.confirm(`製品「${label}」を削除しますか？`)) return
    try {
      let r = await fetch(
        `/api/v3/works/${encodeURIComponent(workId)}/products/${p.id}`,
        { method: "DELETE" }
      )
      if (r.status === 409) {
        const info = await r.json().catch(() => ({} as any))
        if (
          !window.confirm(
            `この製品は受取エッジ ${info.links ?? 0} 件に紐付いています。\n紐付けを外して削除しますか？`
          )
        )
          return
        r = await fetch(
          `/api/v3/works/${encodeURIComponent(workId)}/products/${p.id}?force=true`,
          { method: "DELETE" }
        )
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as any))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      await loadGraph(workId)
    } catch (e: any) {
      window.alert(`削除に失敗: ${String(e?.message || e)}`)
    }
  }

  // ② 作品系譜: 派生元(親)/派生物(子)の関係を取得。
  const loadRelations = React.useCallback(async () => {
    if (!workId) { setRelations({ parents: [], children: [] }); return }
    setRelationsLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/relations`)
      const d = await r.json()
      setRelations({
        parents: Array.isArray(d?.parents) ? d.parents : [],
        children: Array.isArray(d?.children) ? d.children : [],
      })
    } catch {
      setRelations({ parents: [], children: [] })
    } finally {
      setRelationsLoading(false)
    }
  }, [workId])

  // ② 派生元(親)関係を追加。追加後は関係とグラフ(主たる親ミラー反映)を再取得。
  const addRelation = async () => {
    if (!workId || !relForm.parent_work_id) {
      setRelationErr("派生元を選択してください")
      return
    }
    setAddingRelation(true)
    setRelationErr(null)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_work_id: Number(relForm.parent_work_id),
          relation_type: relForm.relation_type || null,
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as any))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      setRelForm({})
      await Promise.all([loadRelations(), loadGraph(workId)])
    } catch (e: any) {
      setRelationErr(String(e?.message || e))
    } finally {
      setAddingRelation(false)
    }
  }

  // ② 関係を削除。主たる親ミラーが変わり得るのでグラフも再取得。
  const deleteRelation = async (relationId: number) => {
    if (!workId) return
    try {
      const r = await fetch(
        `/api/v3/works/${encodeURIComponent(workId)}/relations/${relationId}`,
        { method: "DELETE" }
      )
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as any))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      await Promise.all([loadRelations(), loadGraph(workId)])
    } catch (e: any) {
      window.alert(`関係の削除に失敗: ${String(e?.message || e)}`)
    }
  }

  // graph 変化(作品切替/保存)に追従して関係を再取得。
  React.useEffect(() => {
    void loadRelations()
  }, [loadRelations, graph])

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

  React.useEffect(() => {
    fetch("/api/v3/vendors")
      .then((r) => r.json())
      .then((d) => setVendors(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // ルートの :id 変更に追従（一覧から別作品を開いたとき）。
  React.useEffect(() => {
    if (routeId) setWorkId(routeId)
  }, [routeId])

  React.useEffect(() => {
    void loadGraph(workId)
    setPickerSource("")
    setPickerLines([])
    setPickerMaterials([])
    setPickerLineMat({})
    setMatCondOpen(null)
    setMatRecallLines([])
    setMatRecallDoc("")
    setMatEditId(null)
  }, [workId, loadGraph])

  const createLicenseDocForSource = () => {
    setSelectedIssue("")
    setDocFormData({
      サブライセンシー一覧: [],
      ...(workId ? { ledger_ref_id: workId } : {}),
    } as any)
    navigate(`/documents/new?template=individual_license_terms`)
  }

  // 原作(licensed_in)を開いたら「利用している自社作品」を逆引き。
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
  const isSource = work?.kind === "licensed_in"

  const consumedGroups = React.useMemo(() => {
    const groups = new Map<string, ConsumedGroup>()
    for (const e of upstream) {
      if (e.source_work_id == null && e.source_material_id == null) continue
      const key = `${e.source_work_id ?? "?"}::${e.source_material_id ?? "?"}`
      const g = groups.get(key)
      if (g) g.edges.push(e)
      else groups.set(key, { workId: e.source_work_id, workCode: e.source_work_code, workTitle: e.source_work_title, matCode: e.source_material_code, matName: e.source_material_name, edges: [e] })
    }
    return Array.from(groups.values())
  }, [upstream])

  // 表示中マテリアルの条件明細を一括取得（graph 依存で自動更新）。
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

  const pickerSrcTitle = React.useMemo(
    () => sourceWorks.find((s: any) => String(s.id) === String(pickerSource))?.title || null,
    [sourceWorks, pickerSource]
  )

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

  const loadPicker = React.useCallback(async (sourceId: string, curWorkId: string) => {
    if (!sourceId) { setPickerLines([]); setPickerMaterials([]); setPickerLineMat({}); return }
    setPickerLoading(true)
    try {
      const q = curWorkId ? `?work_id=${encodeURIComponent(curWorkId)}` : ""
      const [lr, sr] = await Promise.all([
        fetch(`/api/v3/source-ips/${encodeURIComponent(sourceId)}/condition-lines${q}`),
        fetch(`/api/v3/source-ips/${encodeURIComponent(sourceId)}`),
      ])
      const lines = await lr.json()
      const src = await sr.json()
      const arr = Array.isArray(lines) ? lines : []
      setPickerLines(arr)
      setPickerMaterials(Array.isArray(src?.materials) ? src.materials : [])
      const init: Record<number, string> = {}
      for (const l of arr) if (l.source_material_id != null) init[l.id] = String(l.source_material_id)
      setPickerLineMat(init)
    } catch {
      setPickerLines([]); setPickerMaterials([]); setPickerLineMat({})
    } finally {
      setPickerLoading(false)
    }
  }, [])

  const addComponentLine = async (line: any) => {
    if (!workId) return
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

  const toggleMatCond = (mid: number) => {
    if (matCondOpen === mid) { setMatCondOpen(null); return }
    setMatCondOpen(mid)
    setMatRecallDoc("")
    setMatRecallLines([])
    setMatEditId(null)
  }
  const openMatEditor = (mid: number) => {
    if (matCondOpen !== mid) toggleMatCond(mid)
    setTimeout(() => {
      document.getElementById(`srcmat-${mid}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 60)
  }
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
  const assignRecalled = async (mid: number, line: any, assign: boolean) => {
    try {
      const body = assign
        ? { source_work_id: Number(workId), source_material_id: mid }
        : { source_material_id: null }
      await conditionClient.setGraphLink(line.id, body)
      await Promise.all([loadGraph(workId), recallByDoc()])
    } catch (e) {
      console.error("assignRecalled failed", e)
    }
  }

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
      await evaluateEntity("condition", matEditId)
      setMatEditId(null)
      await loadGraph(workId)
    } catch (e: any) {
      setMatEditErr(String(e?.message || e))
    } finally {
      setMatEditSaving(false)
    }
  }

  const deleteCond = async (c: any, _mid: number) => {
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
      await loadGraph(workId)
    } catch (e: any) {
      window.alert(`削除に失敗: ${String(e?.message || e)}`)
    }
  }

  const issueNewConditionDoc = () => {
    setSelectedIssue("")
    setDocFormData({ サブライセンシー一覧: [] })
    navigate(`/documents/new?template=${encodeURIComponent(newDocTemplate)}`)
  }

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

  const startEdit = () => {
    if (!work) return
    setForm({
      title: work.title ?? "",
      title_kana: work.title_kana ?? "",
      work_type: work.work_type ?? "",
      status: work.status ?? "",
      division: Array.isArray(work.division) ? work.division.join(", ") : (work.division ?? ""),
      remarks: work.remarks ?? "",
      parent_work_id: work.parent_work_id != null ? String(work.parent_work_id) : "",
      derivation_type: work.derivation_type ?? "",
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
        parent_work_id: form.parent_work_id ? Number(form.parent_work_id) : null,
        derivation_type: form.derivation_type || null,
      }
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await evaluateEntity("work", workId)
      setEditing(false)
      await loadGraph(workId)
    } catch (e: any) {
      setSaveErr(`保存に失敗しました（${e?.message || "unknown"}）`)
    } finally {
      setSaving(false)
    }
  }

  // 派生元(親)の候補。自社作品(own)＋原作(licensed_in)から自分自身を除外。
  const parentCandidates = [...works, ...sourceWorks]
    .filter((w: any) => !work || String(w.id) !== String(work.id))
    .map((w: any) => toWorkPickerItem(w))

  return {
    works, workId, setWorkId, graph, loading, work, upstream, downstream, materials, products, isSource, navigate,
    matName, setMatName, matType, setMatType, adding, addMaterial,
    editing, setEditing, form, setForm, saving, saveErr, startEdit, saveEdit,
    sourceWorks, uses, newOwnTitle, setNewOwnTitle, creatingOwn, createOwnFromSource,
    showNewSource, setShowNewSource, newSourceTitle, setNewSourceTitle, creatingSource, createSource, createLicenseDocForSource,
    vendors, prodName, setProdName, prodFormat, setProdFormat, prodMsrp, setProdMsrp, addingProduct, addProduct,
    editingProductId, productForm, setProductForm, productSaving, productErr, startEditProduct, cancelEditProduct, saveProduct, deleteProduct,
    linkEdge,
    edgeDoc, setEdgeDoc, edgeLines, edgeSearching, edgeSearched, searchEdges, attachEdge, newDocTemplate, setNewDocTemplate, issueNewConditionDoc,
    pickerSource, setPickerSource, pickerLines, pickerLoading, pickerMaterials, pickerLineMat, setPickerLineMat, loadPicker, addComponentLine, removeComponentLine, pickerGroups, pickerSrcTitle,
    matCondOpen, setMatCondOpen, toggleMatCond, openMatEditor,
    matEditId, setMatEditId, matEditForm, setMatEditForm, matEditSaving, matEditErr, startEditCond, saveEditCond, deleteCond,
    matRecallDoc, setMatRecallDoc, matRecallLines, matRecallLoading, recallByDoc, assignRecalled, srcMatConds,
    relations, relationsLoading, loadRelations, relForm, setRelForm, addingRelation, relationErr, addRelation, deleteRelation,
    consumedGroups, parentCandidates,
    loadGraph,
  }
}

const WorkDetailCtx = React.createContext<WorkDetailModel | null>(null)

export function WorkDetailProvider({
  routeId,
  children,
}: {
  routeId?: string
  children: React.ReactNode
}) {
  const model = useWorkDetailModel(routeId)
  return <WorkDetailCtx.Provider value={model}>{children}</WorkDetailCtx.Provider>
}

export function useWorkDetail(): WorkDetailModel {
  const v = React.useContext(WorkDetailCtx)
  if (!v) throw new Error("useWorkDetail must be used within <WorkDetailProvider>")
  return v
}
