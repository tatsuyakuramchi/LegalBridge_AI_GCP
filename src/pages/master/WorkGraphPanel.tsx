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
import { Globe } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"

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
      const r = await fetch(`/api/condition-lines/${edgeId}/graph-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
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
  React.useEffect(() => {
    fetch("/api/v3/source-ips")
      .then((r) => r.json())
      .then((d) => setSourceWorks(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

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
  }, [workId, loadGraph])

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
        <div className="mt-3 max-w-md">
          <NativeSelect value={workId} onChange={(e) => setWorkId(e.target.value)}>
            <option value="">— 作品を選択 —</option>
            {works.map((w) => (
              <option key={w.id} value={w.id}>
                {w.work_code} · {w.title}
              </option>
            ))}
          </NativeSelect>
        </div>
      </header>

      {loading ? (
        <div className="text-xs font-mono text-muted-foreground py-8 text-center">読み込み中…</div>
      ) : !work ? (
        <div className="text-xs font-mono text-muted-foreground py-8 text-center">作品を選択してください。</div>
      ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr,1fr] gap-3 items-start">
          {/* 左 = 原作 / 素材調達（支払）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">原作 / 調達（支払）▶</h3>
                <Badge variant="outline" className="border-amber-300 text-amber-700">支払 {upstream.length}</Badge>
              </div>
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
              {materials.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">素材</div>
                  {materials.map((m) => (
                    <div key={m.id} className="text-[11px] font-mono border border-border/60 rounded px-2 py-1">
                      <span className="font-semibold">{m.material_code || "—"}</span>{" "}
                      {m.material_name}
                      {m.is_default && <Badge variant="outline" className="ml-1 border-emerald-300 text-emerald-700">本体</Badge>}
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
        {/* 増分⑧: 個別条件書から condition_lines をこの作品へ参照リンク(§3.6/§10.7: 明細は新規作成しない) */}
        <div className="rounded-md border border-dashed border-input p-3 space-y-2">
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
            ＋ 条件明細をこの作品に追加（個別条件書から参照）
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
