/**
 * WorkGraphPanel — 統合 Phase3c: 3カード統合エディタ（増分①: ビュー）。
 *
 * 作品(own)を選ぶと、権利フローを3カードで表示する:
 *   右 = 原作 / 素材調達（支払エッジ: ライセンスイン原作・委託素材）
 *   中 = 作品（own）＋ 素材 ＋ 製品
 *   左 = 受取（受取エッジ: ライセンスアウト派生物・物販アウト）
 *
 * カード間のエッジ = condition_lines（向き × 取引種別）。本増分は読み取り表示のみ。
 * 編集（ノード/エッジの作成・紐付け）は後続増分で追加する。
 */
import * as React from "react"
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
  source_work_code?: string | null
  source_work_title?: string | null
  source_material_code?: string | null
  source_material_name?: string | null
  product_code?: string | null
  product_name?: string | null
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

function EdgeRow({ e, side }: { e: Edge; side: "up" | "down" }) {
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
      {e.document_number && (
        <div className="text-[10px] text-muted-foreground/70 truncate">{e.document_number}</div>
      )}
    </div>
  )
}

export function WorkGraphPanel() {
  const [works, setWorks] = React.useState<any[]>([])
  const [workId, setWorkId] = React.useState<string>("")
  const [graph, setGraph] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  // 増分②: 中カードからの素材追加。
  const [matName, setMatName] = React.useState("")
  const [matType, setMatType] = React.useState("illustration")
  const [adding, setAdding] = React.useState(false)

  const loadGraph = React.useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
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

  React.useEffect(() => {
    fetch("/api/v3/works")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : []
        setWorks(list)
        if (list.length && !workId) setWorkId(String(list[0].id))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    void loadGraph(workId)
  }, [workId, loadGraph])

  const work = graph?.work
  const upstream: Edge[] = graph?.upstream || []
  const downstream: Edge[] = graph?.downstream || []
  const materials: any[] = graph?.materials || []
  const products: any[] = graph?.products || []

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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr,1fr] gap-3 items-start">
          {/* 左 = 受取（派生物 / 物販アウト）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">◀ 受取（派生物 / 卸）</h3>
                <Badge variant="outline" className="border-emerald-300 text-emerald-700">受取 {downstream.length}</Badge>
              </div>
              {downstream.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">受取エッジはありません。</p>
              ) : (
                downstream.map((e) => <React.Fragment key={e.id}><EdgeRow e={e} side="down" /></React.Fragment>)
              )}
            </CardContent>
          </Card>

          {/* 中 = 作品（own）*/}
          <Card className="border-foreground/30">
            <CardContent className="px-3.5 py-3 space-y-2">
              <h3 className="text-sm font-mono font-bold">作品（own）</h3>
              <div className="text-[11px] font-mono">
                <div className="font-bold">{work.work_code}</div>
                <div>{work.title}</div>
              </div>
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
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右 = 原作 / 素材調達（支払）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">原作 / 調達（支払）▶</h3>
                <Badge variant="outline" className="border-amber-300 text-amber-700">支払 {upstream.length}</Badge>
              </div>
              {upstream.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">支払エッジはありません。</p>
              ) : (
                upstream.map((e) => <React.Fragment key={e.id}><EdgeRow e={e} side="up" /></React.Fragment>)
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
