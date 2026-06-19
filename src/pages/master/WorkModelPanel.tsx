import * as React from "react"
import { Link } from "react-router-dom"
import { RefreshCw, Plus, Upload, Pencil } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

// 統合 P3-5: 作品モデル(work-centric / v3) — search-api 専用だった /work-model を移植。
//   原作IP・自社作品・契約を作品軸で 閲覧 + CRUD + CSV取込。スキーマ駆動フォーム。

type EntityType = "source-ips" | "works" | "contracts"
const API: Record<EntityType, string> = {
  "source-ips": "/api/v3/source-ips",
  works: "/api/v3/works",
  contracts: "/api/v3/contracts",
}
const LABEL: Record<EntityType, string> = { "source-ips": "原作IP", works: "自社作品", contracts: "契約" }

const DERIV_CHOICES: [string, string][] = [
  ["", "(なし・原版)"],
  ["translation", "翻訳"],
  ["edition", "版"],
  ["title_change", "改題"],
  ["localization", "地域化"],
  ["adaptation", "翻案"],
]

type FieldDef = {
  name: string
  label: string
  type: "text" | "textarea" | "date" | "bool" | "array" | "number" | "select" | "options" | "work-select" | "vendor-select"
  required?: boolean
  hint?: string
  options?: string[]
  choices?: "DERIV"
  group?: string
}

// ③ kindで1フォーム化: 原作IP(licensed_in)と自社作品(own)のフィールドを単一定義に統合し、
//   kind で出し分ける。SCHEMA はここから生成(定義の重複を解消)。
//   入力しやすさのため group でセクション分け(検索側 vanilla と同一構成)。
type WorkKind = "own" | "licensed_in"
const WORK_FIELDS: Array<FieldDef & { kinds: WorkKind[] }> = [
  { name: "title", label: "タイトル", type: "text", required: true, group: "基本情報", kinds: ["own", "licensed_in"] },
  { name: "title_kana", label: "タイトル(カナ)", type: "text", group: "基本情報", kinds: ["own", "licensed_in"] },
  { name: "alternative_titles", label: "別タイトル(, 区切り)", type: "array", group: "基本情報", kinds: ["own", "licensed_in"] },
  { name: "division", label: "区分(, 区切り)", type: "array", hint: "例: BDG, PUB", group: "基本情報", kinds: ["own", "licensed_in"] },
  { name: "work_type", label: "作品種別", type: "select", options: ["", "board_game", "trpg_book", "supplement", "digital"], group: "区分・状態", kinds: ["own"] },
  { name: "status", label: "ステータス", type: "select", options: ["", "planning", "in_production", "released", "suspended", "discontinued"], group: "区分・状態", kinds: ["own"] },
  { name: "rights_holder_vendor_id", label: "権利者(取引先)", type: "vendor-select", hint: "取引先を名称/コードで検索して選択", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "original_publisher", label: "原作出版社", type: "text", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "default_rights_holder", label: "既定権利者", type: "text", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "default_credit_display", label: "クレジット表記", type: "text", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "default_work_supplement", label: "作品補足", type: "textarea", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "default_approval_target", label: "承認対象", type: "text", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "default_approval_timing", label: "承認タイミング", type: "text", group: "権利・既定値", kinds: ["licensed_in"] },
  { name: "parent_work_id", label: "派生元(系譜)", type: "work-select", hint: "翻訳版・改題版などの派生元を選ぶ(原作IPは A原作→B翻訳 等)", group: "系譜・備考", kinds: ["own", "licensed_in"] },
  { name: "derivation_type", label: "派生種別", type: "options", choices: "DERIV", group: "系譜・備考", kinds: ["own", "licensed_in"] },
  { name: "remarks", label: "備考", type: "textarea", group: "系譜・備考", kinds: ["own", "licensed_in"] },
]
const kindOfType = (t: EntityType): WorkKind => (t === "source-ips" ? "licensed_in" : "own")

const SCHEMA: Record<EntityType, FieldDef[]> = {
  "source-ips": WORK_FIELDS.filter((f) => f.kinds.includes("licensed_in")),
  works: WORK_FIELDS.filter((f) => f.kinds.includes("own")),
  contracts: [
    { name: "contract_title", label: "契約名", type: "text", required: true, group: "基本情報" },
    { name: "contract_level", label: "契約レベル", type: "select", options: ["", "master", "individual", "standalone"], group: "基本情報" },
    { name: "contract_category", label: "契約カテゴリ", type: "text", hint: "license_in / license_out / service / publication / sales / nda", group: "基本情報" },
    { name: "contract_type", label: "契約類型", type: "text", group: "基本情報" },
    { name: "lifecycle_stage", label: "ライフサイクル", type: "text", hint: "requested / under_review / executed 等", group: "基本情報" },
    { name: "primary_vendor_id", label: "主取引先", type: "vendor-select", hint: "取引先を名称/コードで検索して選択", group: "当事者・期間" },
    { name: "effective_date", label: "発効日", type: "date", group: "当事者・期間" },
    { name: "expiration_date", label: "満了日", type: "date", group: "当事者・期間" },
    { name: "auto_renewal", label: "自動更新", type: "bool", group: "当事者・期間" },
  ],
}

// フォーム項目を group ごとに分割(定義順を維持)。group 未指定はまとめて末尾の "" に。
const groupFields = (fields: FieldDef[]): Array<[string, FieldDef[]]> => {
  const order: string[] = []
  const map = new Map<string, FieldDef[]>()
  fields.forEach((f) => {
    const g = f.group || ""
    if (!map.has(g)) { map.set(g, []); order.push(g) }
    map.get(g)!.push(f)
  })
  return order.map((g) => [g, map.get(g)!])
}

const SUBKEYS: Record<EntityType, [string, string][]> = {
  "source-ips": [["materials", "素材 / 権利者台帳"]],
  works: [["products", "製品"], ["contracts", "紐づく契約"], ["payment_summary", "支払集計"]],
  contracts: [["works", "対象作品 / IP"], ["parties", "当事者"], ["financial_terms", "財務条件"], ["line_items", "明細"], ["royalty_statements", "ロイヤリティ"]],
}

type Row = Record<string, any>

const cardOf = (type: EntityType, x: Row) => {
  if (type === "source-ips")
    return { id: x.id, name: x.title || "#" + x.id, badge: x.source_code, sub: `権利者: ${x.default_rights_holder || "—"} / 素材 ${x.material_count || 0}` }
  if (type === "works")
    return { id: x.id, name: x.title || "#" + x.id, badge: x.work_code, sub: `${x.work_type || "—"} / ${x.status || "—"} / 製品 ${x.product_count || 0}` }
  return {
    id: x.id,
    name: x.contract_title || x.document_number || "#" + x.id,
    badge: x.contract_level || "—",
    sub: `${x.contract_category || "—"} / ${x.primary_vendor || "—"} / ${x.lifecycle_stage || "—"} / 条件 ${x.term_count || 0}`,
  }
}

const fmtVal = (v: any) => {
  if (v == null || v === "") return "—"
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—"
  if (typeof v === "boolean") return v ? "はい" : "いいえ"
  if (typeof v === "string" && v.length >= 10 && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
  return String(v)
}

const getJson = async (u: string) => {
  const r = await fetch(u)
  if (!r.ok) throw new Error(u + " → HTTP " + r.status)
  return r.json()
}
const sendJson = async (method: string, url: string, body: any) => {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  let data: any = null
  try {
    data = await r.json()
  } catch {
    /* noop */
  }
  if (!r.ok) throw new Error((data && (data.error || data.message)) || `${method} ${url} → HTTP ${r.status}`)
  return data
}

export function WorkModelPanel() {
  const { showNotification } = useAppData()
  const [lists, setLists] = React.useState<Record<EntityType, Row[]>>({ "source-ips": [], works: [], contracts: [] })
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ips, works, contracts] = await Promise.all([getJson(API["source-ips"]), getJson(API.works), getJson(API.contracts)])
      setLists({ "source-ips": ips || [], works: works || [], contracts: contracts || [] })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // ── モーダル状態 ──
  type Modal =
    | { kind: "detail"; type: EntityType; id: number }
    | { kind: "form"; type: EntityType; mode: "new" | "edit"; data: Row }
    | { kind: "import"; type: EntityType }
    | null
  const [modal, setModal] = React.useState<Modal>(null)
  // #2: 派生元(親作品)をインラインで素早く設定するクイックダイアログ対象。
  const [quickParent, setQuickParent] = React.useState<Row | null>(null)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw />
          更新
        </Button>
        {loading && <span className="text-xs text-muted-foreground">読み込み中…</span>}
        {error && <span className="text-xs text-destructive">読み込み失敗: {error}</span>}
      </div>

      {(["source-ips", "works", "contracts"] as EntityType[]).map((type) => (
        <section key={type} className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-mono font-bold uppercase tracking-[0.12em]">
              {type === "source-ips" ? "📚 原作IP" : type === "works" ? "🎲 自社作品" : "📜 契約"}
            </h2>
            <span className="text-xs font-mono text-muted-foreground">({lists[type].length})</span>
            <div className="flex-1" />
            {type === "source-ips" ? (
              // Phase 0(統合): 原作の新規登録は原作マスター(Ledgers, LO-)へ一本化。
              //   ここは閲覧専用にし、誤登録(IP-採番)を防ぐ。
              <Link
                to="/master/ledgers"
                className="text-[11px] font-mono px-3 py-1.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-50"
              >
                原作の新規登録は「原作マスター (Ledgers)」へ →
              </Link>
            ) : (
              <>
                <Button size="sm" onClick={() => setModal({ kind: "form", type, mode: "new", data: {} })}>
                  <Plus />
                  新規
                </Button>
                <Button variant="outline" size="sm" onClick={() => setModal({ kind: "import", type })}>
                  <Upload />
                  CSV取込
                </Button>
              </>
            )}
          </div>
          {type === "source-ips" && (
            <div className="text-[11px] font-mono text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              原作の登録先は <Link to="/master/ledgers" className="underline font-bold">原作マスター (Ledgers)</Link> に一本化しました（採番 <code>LO-</code>）。ここは<strong>閲覧専用</strong>です。既存の <code>IP-</code> 原作は今後の統合で移行対象になります。
            </div>
          )}
          {type === "works" ? (
            <>
              {/* #3: 作品は親→派生のツリー表示。各ノードに #2 派生元設定の導線。 */}
              {lists.works.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">データがありません</div>
              ) : (
                <WorkTree
                  works={lists.works}
                  onOpenDetail={(id) => setModal({ kind: "detail", type: "works", id })}
                  onQuickParent={(w) => setQuickParent(w)}
                />
              )}
            </>
          ) : (
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
              {lists[type].length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">データがありません</div>
              ) : (
                lists[type].map((x) => {
                  const c = cardOf(type, x)
                  return (
                    <div
                      key={c.id}
                      className="bg-card border border-border rounded-lg px-3.5 py-3 cursor-pointer hover:border-foreground hover:shadow-sm transition-all"
                      onClick={() => setModal({ kind: "detail", type, id: c.id })}
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="font-semibold text-sm">{c.name}</div>
                        {c.badge && <Badge variant="outline" className="font-mono">{c.badge}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{c.sub}</div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </section>
      ))}

      {modal?.kind === "detail" && (
        <DetailModal
          type={modal.type}
          id={modal.id}
          sourceIps={lists["source-ips"]}
          onClose={() => setModal(null)}
          onEdit={(obj) => setModal({ kind: "form", type: modal.type, mode: "edit", data: obj })}
        />
      )}
      {modal?.kind === "form" && (
        <FormModal
          type={modal.type}
          mode={modal.mode}
          data={modal.data}
          works={lists.works}
          sourceIps={lists["source-ips"]}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await load()
          }}
          showNotification={showNotification}
        />
      )}
      {modal?.kind === "import" && (
        <ImportModal type={modal.type} onClose={() => setModal(null)} onImported={load} />
      )}
      {quickParent && (
        <QuickParentModal
          work={quickParent}
          works={lists.works}
          onClose={() => setQuickParent(null)}
          onSaved={async () => {
            setQuickParent(null)
            await load()
          }}
          showNotification={showNotification}
        />
      )}
    </div>
  )
}

const DERIV_LABEL: Record<string, string> = Object.fromEntries(DERIV_CHOICES)

// #3: 親→派生のツリー。parent_work_id が同リストに居るものは子として入れ子表示。
function WorkTree({
  works,
  onOpenDetail,
  onQuickParent,
}: {
  works: Row[]
  onOpenDetail: (id: number) => void
  onQuickParent: (w: Row) => void
}) {
  const byId = new Map<number, Row>(works.map((w) => [Number(w.id), w]))
  const children = new Map<number, Row[]>()
  const roots: Row[] = []
  for (const w of works) {
    const pid = w.parent_work_id != null ? Number(w.parent_work_id) : null
    if (pid != null && byId.has(pid)) {
      const arr = children.get(pid) || []
      arr.push(w)
      children.set(pid, arr)
    } else {
      roots.push(w)
    }
  }
  const sortFn = (a: Row, b: Row) => String(a.work_code || "").localeCompare(String(b.work_code || ""))
  roots.sort(sortFn)
  const seen = new Set<number>()
  const render = (w: Row, depth: number): React.ReactNode => {
    const id = Number(w.id)
    if (seen.has(id)) return null
    seen.add(id)
    const kids = (children.get(id) || []).sort(sortFn)
    return (
      <React.Fragment key={id}>
        <WorkNode w={w} depth={depth} onOpenDetail={onOpenDetail} onQuickParent={onQuickParent} />
        {kids.map((k) => render(k, depth + 1))}
      </React.Fragment>
    )
  }
  return <div className="space-y-1.5">{roots.map((r) => render(r, 0))}</div>
}

function WorkNode({
  w,
  depth,
  onOpenDetail,
  onQuickParent,
}: {
  w: Row
  depth: number
  onOpenDetail: (id: number) => void
  onQuickParent: (w: Row) => void
}) {
  const deriv = w.derivation_type ? DERIV_LABEL[w.derivation_type] || w.derivation_type : w.is_original === false ? "派生" : null
  return (
    <div style={{ marginLeft: depth * 22 }} className="flex items-start gap-1.5">
      {depth > 0 && <span className="mt-3 text-muted-foreground select-none text-xs">↳</span>}
      <div
        className="flex-1 bg-card border border-border rounded-lg px-3 py-2 cursor-pointer hover:border-foreground hover:shadow-sm transition-all"
        onClick={() => onOpenDetail(Number(w.id))}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">{w.title || "#" + w.id}</div>
          <div className="flex items-center gap-1.5">
            {deriv && <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{deriv}</Badge>}
            {w.work_code && <Badge variant="outline" className="font-mono">{w.work_code}</Badge>}
          </div>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {(w.work_type || "—") + " / " + (w.status || "—") + " / 製品 " + (w.product_count || 0)}
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
          <Link to={`/master/receivable-map?work=${w.id}`} className="inline-block text-[11px] font-bold text-violet-600 bg-violet-50 rounded px-2 py-0.5 hover:bg-violet-100">
            🔀 分配マップ
          </Link>
          <button
            type="button"
            onClick={() => onQuickParent(w)}
            className="inline-block text-[11px] font-bold text-slate-600 bg-slate-100 rounded px-2 py-0.5 hover:bg-slate-200"
          >
            🧬 派生元を設定
          </button>
        </div>
      </div>
    </div>
  )
}

// #2: 派生元(親作品)をインラインで設定。既存の作品行をそのまま PUT で全置換し、
//   parent_work_id / derivation_type / is_original のみ更新する(他項目は維持)。
function QuickParentModal({
  work,
  works,
  onClose,
  onSaved,
  showNotification,
}: {
  work: Row
  works: Row[]
  onClose: () => void
  onSaved: () => void
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}) {
  const [parentId, setParentId] = React.useState<any>(work.parent_work_id ?? "")
  const [deriv, setDeriv] = React.useState<string>(work.derivation_type || "")
  const [saving, setSaving] = React.useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const hasParent = String(parentId ?? "") !== ""
      const body = {
        ...work,
        parent_work_id: hasParent ? Number(parentId) : null,
        derivation_type: deriv || null,
        // 親を設定したら派生品(is_original=false)。親を外したら従来値を維持。
        is_original: hasParent ? false : work.is_original,
        title: work.title,
      }
      const res = await fetch(`/api/v3/works/${work.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || "HTTP " + res.status)
      showNotification(hasParent ? "派生元を設定しました" : "派生元を解除しました", "success")
      onSaved()
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>派生元を設定 — {work.title || "#" + work.id}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">派生元の作品 (親)</Label>
            <WorkSelectField value={parentId} works={works} editId={Number(work.id)} onChange={setParentId} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">派生種別</Label>
            <NativeSelect value={deriv} onChange={(e) => setDeriv(e.target.value)}>
              {DERIV_CHOICES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            親作品を設定すると派生品(is_original=false)になります。原作は親作品経由でチェーンするため、ここで原作を直接紐づける必要はありません。
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SubTable({ label, rows }: { label: string; rows: any }) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const cols = Object.keys(rows[0]).filter((k) => k !== "id").slice(0, 8)
  return (
    <div>
      <div className="text-xs font-bold mt-4 mb-1.5">{label} ({rows.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>{cols.map((c) => <th key={c} className="border border-border bg-muted/50 px-1.5 py-1 text-left whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((rw: Row, i: number) => (
              <tr key={i}>{cols.map((c) => <td key={c} className="border border-border px-1.5 py-1 align-top">{fmtVal(rw[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DetailModal({ type, id, sourceIps, onClose, onEdit }: { type: EntityType; id: number; sourceIps: Row[]; onClose: () => void; onEdit: (obj: Row) => void }) {
  const [obj, setObj] = React.useState<Row | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    ;(async () => {
      try {
        setObj(await getJson(API[type] + "/" + id))
      } catch (e: any) {
        setErr(e?.message || String(e))
      }
    })()
  }, [type, id])
  const codeKey = type === "source-ips" ? "source_code" : type === "works" ? "work_code" : "document_number"
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader><DialogTitle>{LABEL[type]} 詳細</DialogTitle></DialogHeader>
        <DialogBody>
          {err ? (
            <div className="text-sm text-destructive">取得失敗: {err}</div>
          ) : !obj ? (
            <div className="text-sm text-muted-foreground">読み込み中…</div>
          ) : (
            <>
              <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-xs text-muted-foreground">コード</dt>
                <dd className="text-[13px] break-words">{obj[codeKey] || "—"}</dd>
                {SCHEMA[type].map((f) => (
                  <React.Fragment key={f.name}>
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="text-[13px] break-words">{fmtVal(obj[f.name])}</dd>
                  </React.Fragment>
                ))}
              </dl>
              {SUBKEYS[type].map(([k, lbl]) => <React.Fragment key={k}><SubTable label={lbl} rows={obj[k]} /></React.Fragment>)}
              {/* モデル(A): 自社作品に「利用許諾条件(条件明細・契約レス可)」を直接ぶら下げて
                  原作IPと料率を紐付ける。作品先行→後から紐付けの実務フローに対応。 */}
              {/* モデル(あ): 素材(マテリアル)は原作IPに帰属。原作IP詳細に素材エディタ。
                  条件明細は原作IP・自社作品どちらにも持てる(原作IP＋素材を参照)。 */}
              {type === "source-ips" && (
                <>
                  <MaterialsEditor workId={id} />
                  {/* 原作IP = 利用許諾条件(IN): 原作IPを借りる条件(我々が支払う料率)。 */}
                  <WorkConditionsEditor workId={id} sourceIps={sourceIps} kind="license_in" />
                </>
              )}
              {type === "works" && (
                <>
                  {/* 当社帰属(業務委託成果物=マテリアル)の置き場。検収済の業務委託明細から生成。 */}
                  <MaterialsEditor workId={id} />
                  {/* 自社作品 = サブライセンス条件(OUT): 作品を再許諾する条件(我々が受け取る料率)。 */}
                  <WorkConditionsEditor workId={id} sourceIps={sourceIps} kind="sublicense_out" />
                  {/* 条件(OUT) → 受領記録: 報告売上/数量から料率計算し受領を記録。 */}
                  <ReceiptsEditor workId={id} />
                </>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {obj && <Button onClick={() => onEdit(obj)}><Pencil />編集</Button>}
          <Button variant="outline" onClick={onClose}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// モデル(あ): 作品のマテリアル(翻訳/イラスト/原作素材…)。帰属(rights_type)で
//   相手方(license/joint)=利用許諾条件にリンク、当社(owned/譲渡)=業務委託(後続)。
const MATERIAL_TYPES: [string, string][] = [
  ["", "(種別)"], ["translation", "翻訳"], ["illustration", "イラスト"],
  ["scenario", "シナリオ"], ["design", "デザイン"], ["music", "音楽"],
  ["text", "テキスト"], ["data", "データ"], ["other", "その他"],
]
const RIGHTS_TYPES: [string, string][] = [
  ["", "(帰属)"], ["license", "相手方(許諾)"], ["joint", "共有"],
  ["owned", "当社保有"], ["copyright_assignment", "譲渡(当社へ)"],
]
const isCounterpartyRights = (rt: string) => rt === "license" || rt === "joint"
// 検収状況ラベル(業務委託明細): accepted=検収済 / partial=一部検収 / pending=未検収
const inspLabel = (status?: string | null): string =>
  status === "accepted" ? "✅ 検収済" : status === "partial" ? "🟡 一部検収" : status === "pending" ? "⬜ 未検収" : ""

function MaterialsEditor({ workId }: { workId: number }) {
  const { showNotification } = useAppData()
  const [rows, setRows] = React.useState<Row[] | null>(null)
  const [conds, setConds] = React.useState<Row[]>([])
  const blank = { id: 0, material_name: "", material_type: "", rights_type: "", rights_holder_vendor_id: "", is_royalty_bearing: false, license_condition_id: "", service_line_item_id: "" }
  const [form, setForm] = React.useState<Row>(blank)
  const [busy, setBusy] = React.useState(false)
  const [svc, setSvc] = React.useState<Row[]>([])
  const [svcq, setSvcq] = React.useState("")

  const load = React.useCallback(async () => {
    try { setRows(await getJson(`/api/v3/works/${workId}/materials`)) } catch { setRows([]) }
    try { setConds(await getJson(`/api/v3/works/${workId}/conditions`)) } catch { setConds([]) }
  }, [workId])
  React.useEffect(() => { load() }, [load])

  // 当社帰属(owned/譲渡)選択時に業務委託明細候補を取得(検索語変化でも再取得)
  const ownSelected = !!form.rights_type && !isCounterpartyRights(form.rights_type)
  React.useEffect(() => {
    if (!ownSelected) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await getJson(`/api/v3/service-line-items?q=${encodeURIComponent(svcq)}`)
        if (!cancelled) setSvc(Array.isArray(d) ? d : [])
      } catch { if (!cancelled) setSvc([]) }
    })()
    return () => { cancelled = true }
  }, [ownSelected, svcq])

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))
  const reset = () => setForm(blank)
  const save = async () => {
    setBusy(true)
    try {
      const cp = isCounterpartyRights(form.rights_type)
      const body = {
        material_name: form.material_name || null,
        material_type: form.material_type || null,
        rights_type: form.rights_type || null,
        rights_holder_vendor_id: form.rights_holder_vendor_id ? Number(form.rights_holder_vendor_id) : null,
        is_royalty_bearing: !!form.is_royalty_bearing,
        license_condition_id: cp && form.license_condition_id ? Number(form.license_condition_id) : null,
        service_line_item_id: !cp && form.rights_type && form.service_line_item_id ? Number(form.service_line_item_id) : null,
      }
      if (form.id) await sendJson("PUT", `/api/v3/work-materials/${form.id}`, body)
      else await sendJson("POST", `/api/v3/works/${workId}/materials`, body)
      showNotification(form.id ? "マテリアルを更新しました" : "マテリアルを追加しました", "success")
      reset(); await load()
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally { setBusy(false) }
  }
  const del = async (mid: number) => {
    if (!window.confirm("このマテリアルを削除しますか？")) return
    try { await sendJson("DELETE", `/api/v3/work-materials/${mid}`, {}); await load() }
    catch (e: any) { showNotification(`削除に失敗: ${e?.message || e}`, "error") }
  }
  const condLabel = (c: Row) => `#${c.condition_no} ${c.source_work_title ? c.source_work_title : ""}${c.rate_pct != null ? ` (${c.rate_pct}%)` : ""}`
  const rtLabel = (rt: string) => RIGHTS_TYPES.find(([v]) => v === rt)?.[1] || rt || "—"
  const mtLabel = (mt: string) => MATERIAL_TYPES.find(([v]) => v === mt)?.[1] || mt || "—"

  return (
    <div className="mt-4 border-t pt-3 space-y-2">
      <div className="text-xs font-bold">マテリアル（翻訳・イラスト・原作素材 等）</div>
      {rows === null ? (
        <div className="text-xs text-muted-foreground">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">まだありません。下のフォームで追加してください。</div>
      ) : (
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-muted-foreground text-left [&>th]:py-1 [&>th]:pr-2">
              <th>名称</th><th>種別</th><th>帰属</th><th>権利者</th><th>つなぎ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-border/40 [&>td]:py-1 [&>td]:pr-2 align-top">
                <td className="min-w-[100px]">{m.material_name || "—"}</td>
                <td>{mtLabel(m.material_type)}</td>
                <td>{rtLabel(m.rights_type)}</td>
                <td className="min-w-[100px]">{m.rights_holder_name || (m.rights_holder_vendor_id ? `#${m.rights_holder_vendor_id}` : "—")}</td>
                <td className="text-[10px]">
                  {m.license_condition_id
                    ? `利用許諾 #${m.license_condition_no ?? m.license_condition_id}`
                    : m.service_line_item_id
                      ? <>
                          {`業務委託 ${m.service_doc_number || ""}${m.service_line_name ? "/" + m.service_line_name : ""}`}
                          {m.service_inspection_status ? <span className="ml-1">{inspLabel(m.service_inspection_status)}</span> : null}
                        </>
                      : isCounterpartyRights(m.rights_type) ? "(条件未設定)" : "(業務委託未設定)"}
                </td>
                <td className="whitespace-nowrap text-right">
                  <button className="text-[10px] underline mr-2" onClick={() => setForm({ id: m.id, material_name: m.material_name || "", material_type: m.material_type || "", rights_type: m.rights_type || "", rights_holder_vendor_id: m.rights_holder_vendor_id || "", is_royalty_bearing: !!m.is_royalty_bearing, license_condition_id: m.license_condition_id || "", service_line_item_id: m.service_line_item_id || "" })}>編集</button>
                  <button className="text-[10px] underline text-destructive" onClick={() => del(Number(m.id))}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="rounded-sm border border-input bg-muted/20 p-2 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {form.id ? `マテリアル #${form.id} を編集` : "マテリアルを追加"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">名称</span>
            <Input value={form.material_name} onChange={(e) => set("material_name", e.target.value)} placeholder="例: 日本語翻訳 / 表紙イラスト" className="h-7 text-xs" />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">種別</span>
            <NativeSelect value={form.material_type} onChange={(e) => set("material_type", e.target.value)} className="h-7 text-xs">
              {MATERIAL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">帰属</span>
            <NativeSelect value={form.rights_type} onChange={(e) => set("rights_type", e.target.value)} className="h-7 text-xs">
              {RIGHTS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">権利者(取引先)</span>
            <VendorSelectField value={form.rights_holder_vendor_id} onChange={(v) => set("rights_holder_vendor_id", v)} />
          </label>
        </div>
        {isCounterpartyRights(form.rights_type) ? (
          <label className="block space-y-0.5">
            <span className="text-[10px] text-muted-foreground">つなぐ利用許諾条件（相手方帰属）</span>
            <NativeSelect value={form.license_condition_id} onChange={(e) => set("license_condition_id", e.target.value)} className="h-7 text-xs">
              <option value="">(未設定)</option>
              {conds.map((c) => <option key={c.id} value={c.id}>{condLabel(c)}</option>)}
            </NativeSelect>
            {conds.length === 0 && <span className="text-[10px] text-amber-600">先に「利用許諾条件」を追加してください。</span>}
          </label>
        ) : form.rights_type ? (
          <label className="block space-y-0.5">
            <span className="text-[10px] text-muted-foreground">つなぐ業務委託明細（当社帰属＝制作対価）</span>
            <Input placeholder="発注書番号・取引先・品目で検索…" value={svcq} onChange={(e) => setSvcq(e.target.value)} className="h-7 text-xs" />
            <NativeSelect value={form.service_line_item_id} onChange={(e) => {
              const v = e.target.value
              // 成果物→マテリアル生成: 業務委託明細を選んだら、名称が空なら品目名で補完。
              const picked = svc.find((s) => String(s.id) === v)
              setForm((f) => ({ ...f, service_line_item_id: v, material_name: f.material_name?.trim() ? f.material_name : (picked?.item_name || f.material_name) }))
            }} className="h-7 text-xs">
              <option value="">(未設定)</option>
              {svc.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.document_number || "—"} / ${s.item_name || "明細#" + s.id}${s.vendor_name ? " / " + s.vendor_name : ""}${s.amount_ex_tax != null ? " / ¥" + Number(s.amount_ex_tax).toLocaleString("ja-JP") : ""}${s.inspection_status ? " / " + inspLabel(s.inspection_status) : ""}`}
                </option>
              ))}
            </NativeSelect>
            {svc.length === 0 && <span className="text-[10px] text-amber-600">候補がありません（発注書/業務委託明細を先に作成）。</span>}
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" className="h-3 w-3" checked={!!form.is_royalty_bearing} onChange={(e) => set("is_royalty_bearing", e.target.checked)} />
          ロイヤリティ対象
        </label>
        <div className="flex justify-end gap-2">
          {form.id ? <Button variant="outline" size="sm" onClick={reset} disabled={busy}>キャンセル</Button> : null}
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "保存中…" : form.id ? "更新" : "＋追加"}</Button>
        </div>
      </div>
    </div>
  )
}

// モデル(A): 作品 → 条件明細(契約レス可) → 原作IP の紐付けエディタ。
//   /api/v3/works/:id/conditions と /api/v3/work-conditions/:cid を使用。
function WorkConditionsEditor({ workId, sourceIps, kind }: { workId: number; sourceIps: Row[]; kind: "license_in" | "sublicense_out" }) {
  const isIn = kind === "license_in"
  // 方向で見出し・補足を出し分け。利用許諾(IN)=原作IPを借りる / サブライセンス(OUT)=作品を再許諾。
  const sectionTitle = isIn ? "利用許諾条件（IN・原作IPからの許諾）" : "サブライセンス条件（OUT・自社作品の再許諾）"
  const sectionNote = isIn
    ? "原作IPを借りる条件（当社が支払う料率）。原作IP＋素材を参照します。"
    : "自社作品を第三者へ再許諾する条件（当社が受け取る料率）。原資となる原作IP＋素材も任意で参照できます。"
  const { showNotification } = useAppData()
  const [rows, setRows] = React.useState<Row[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  // 新規/編集フォーム(インライン)
  const blank = { id: 0, source_work_id: "", source_material_id: "", rate_pct: "", base_price_label: "", calc_method: "ROYALTY", formula_text: "", region_language_label: "", counterparty_vendor_id: "", basis: "sales", unit_price: "" }
  const [form, setForm] = React.useState<Row>(blank)
  const [ipq, setIpq] = React.useState("")
  // 選択した原作IPの素材(マテリアル)候補
  const [srcMats, setSrcMats] = React.useState<Row[]>([])
  // 複数選択まとめて追加
  const [sel, setSel] = React.useState<Set<number>>(new Set())
  const [bulk, setBulk] = React.useState({ rate_pct: "", base_price_label: "", calc_method: "ROYALTY", formula_text: "" })
  const [bulkBusy, setBulkBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      setRows(await getJson(`/api/v3/works/${workId}/conditions`))
    } catch (e: any) {
      showNotification(`条件明細の取得に失敗: ${e?.message || e}`, "error")
      setRows([])
    }
  }, [workId, showNotification])
  React.useEffect(() => { load() }, [load])

  // 選択中の原作IP(source_work_id)の素材一覧を取得 → source_material_id 選択用
  React.useEffect(() => {
    const sid = Number(form.source_work_id)
    if (!sid) { setSrcMats([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const d = await getJson(`/api/v3/works/${sid}/materials`)
        if (!cancelled) setSrcMats(Array.isArray(d) ? d : [])
      } catch { if (!cancelled) setSrcMats([]) }
    })()
    return () => { cancelled = true }
  }, [form.source_work_id])

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))
  const reset = () => { setForm(blank); setIpq("") }

  const save = async () => {
    setBusy(true)
    try {
      const body = {
        condition_kind: kind,
        source_work_id: form.source_work_id ? Number(form.source_work_id) : null,
        source_material_id: form.source_material_id ? Number(form.source_material_id) : null,
        rate_pct: form.rate_pct === "" ? null : Number(form.rate_pct),
        base_price_label: form.base_price_label || null,
        calc_method: form.calc_method || "ROYALTY",
        formula_text: form.formula_text || null,
        region_language_label: form.region_language_label || null,
        // OUT(サブライセンス)の受領計算用。IN(利用許諾)では送らない。
        ...(isIn ? {} : {
          counterparty_vendor_id: form.counterparty_vendor_id ? Number(form.counterparty_vendor_id) : null,
          basis: form.basis || "sales",
          unit_price: form.unit_price === "" ? null : Number(form.unit_price),
        }),
      }
      if (form.id) await sendJson("PUT", `/api/v3/work-conditions/${form.id}`, body)
      else await sendJson("POST", `/api/v3/works/${workId}/conditions`, body)
      showNotification(form.id ? "条件明細を更新しました" : "条件明細を追加しました", "success")
      reset()
      await load()
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setBusy(false)
    }
  }
  // 複数の原作IPを選んで、共通条件で一括追加(1原作IP=1条件明細)
  const bulkAdd = async () => {
    if (sel.size === 0) return
    setBulkBusy(true)
    try {
      for (const ipId of sel) {
        await sendJson("POST", `/api/v3/works/${workId}/conditions`, {
          condition_kind: kind,
          source_work_id: ipId,
          rate_pct: bulk.rate_pct === "" ? null : Number(bulk.rate_pct),
          base_price_label: bulk.base_price_label || null,
          calc_method: bulk.calc_method || "ROYALTY",
          formula_text: bulk.formula_text || null,
        })
      }
      showNotification(`${sel.size}件の条件明細を追加しました`, "success")
      setSel(new Set())
      setBulk({ rate_pct: "", base_price_label: "", calc_method: "ROYALTY", formula_text: "" })
      setIpq("")
      await load()
    } catch (e: any) {
      showNotification(`一括追加に失敗: ${e?.message || e}`, "error")
    } finally {
      setBulkBusy(false)
    }
  }
  const toggleSel = (id: number) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const del = async (cid: number) => {
    if (!window.confirm("この条件明細を削除しますか？")) return
    try {
      await sendJson("DELETE", `/api/v3/work-conditions/${cid}`, {})
      await load()
    } catch (e: any) {
      showNotification(`削除に失敗: ${e?.message || e}`, "error")
    }
  }

  const ipLabel = (id: any) => {
    const o = sourceIps.find((s) => String(s.id) === String(id))
    return o ? `${o.source_code ? o.source_code + " : " : ""}${o.title || "#" + id}` : (id ? `#${id}` : "—")
  }
  const kw = ipq.trim().toLowerCase()
  const ipList = (kw
    ? sourceIps.filter((s) => `${s.source_code || ""} ${s.title || ""}`.toLowerCase().includes(kw))
    : sourceIps
  ).slice(0, 50)

  return (
    <div className="mt-4 border-t pt-3 space-y-2">
      <div className="text-xs font-bold">
        {sectionTitle}
        <span className={`ml-2 align-middle text-[9px] font-mono px-1.5 py-0.5 rounded-sm ${isIn ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
          {isIn ? "IN" : "OUT"}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">{sectionNote}</p>
      {rows === null ? (
        <div className="text-xs text-muted-foreground">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">まだありません。下のフォームで追加してください。</div>
      ) : (
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-muted-foreground text-left [&>th]:py-1 [&>th]:pr-2">
              <th>#</th><th>原作IP</th><th>料率%</th><th>基準価格</th><th>計算式</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-border/40 [&>td]:py-1 [&>td]:pr-2 align-top">
                <td>{c.condition_no}</td>
                <td className="min-w-[120px]">
                  {c.source_work_title ? `${c.source_work_code ? c.source_work_code + " : " : ""}${c.source_work_title}` : ipLabel(c.source_work_id)}
                  {c.source_material_name ? <span className="text-muted-foreground"> / {c.source_material_name}</span> : null}
                </td>
                <td>{c.rate_pct ?? "—"}</td>
                <td>{c.base_price_label || "—"}</td>
                <td className="max-w-[200px] truncate">{c.formula_text || "—"}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="text-[10px] underline mr-2" onClick={() => { setForm({ id: c.id, source_work_id: c.source_work_id || "", source_material_id: c.source_material_id || "", rate_pct: c.rate_pct ?? "", base_price_label: c.base_price_label || "", calc_method: c.calc_method || "ROYALTY", formula_text: c.formula_text || "", region_language_label: c.region_language_label || "", counterparty_vendor_id: c.counterparty_vendor_id || "", basis: c.basis || "sales", unit_price: c.unit_price ?? "" }) }}>編集</button>
                  <button className="text-[10px] underline text-destructive" onClick={() => del(Number(c.id))}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* 複数選択まとめて追加(原作IPを複数選んで1原作=1条件で一括作成) */}
      {!form.id && (
        <div className="rounded-sm border border-dashed border-input bg-muted/10 p-2 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            複数の原作IPをまとめて条件追加（A原作＋B翻訳など）
          </div>
          <Input placeholder="原作IPを検索…" value={ipq} onChange={(e) => setIpq(e.target.value)} className="h-7 text-xs" />
          <div className="max-h-36 overflow-y-auto border border-input rounded-sm bg-card">
            {ipList.length === 0 ? (
              <div className="px-2 py-2 text-[10px] text-muted-foreground">該当なし</div>
            ) : (
              ipList.map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-muted/40 cursor-pointer">
                  <input type="checkbox" className="h-3 w-3" checked={sel.has(Number(s.id))} onChange={() => toggleSel(Number(s.id))} />
                  <span className="truncate">{(s.source_code ? s.source_code + " : " : "") + (s.title || "#" + s.id)}</span>
                </label>
              ))
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" step="0.0001" placeholder="料率% (共通)" value={bulk.rate_pct} onChange={(e) => setBulk((x) => ({ ...x, rate_pct: e.target.value }))} className="h-7 text-xs" />
            <Input placeholder="基準価格 (共通)" value={bulk.base_price_label} onChange={(e) => setBulk((x) => ({ ...x, base_price_label: e.target.value }))} className="h-7 text-xs" />
            <Input placeholder="計算式 (共通)" value={bulk.formula_text} onChange={(e) => setBulk((x) => ({ ...x, formula_text: e.target.value }))} className="h-7 text-xs" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={bulkAdd} disabled={bulkBusy || sel.size === 0}>
              {bulkBusy ? "追加中…" : `選択 ${sel.size} 件をまとめて追加`}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">各原作IPごとに1条件を作成（料率等は後から個別調整可）。</p>
        </div>
      )}

      {/* 追加/編集フォーム(単一) */}
      <div className="rounded-sm border border-input bg-muted/20 p-2 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {form.id ? `条件 #${form.id} を編集` : "条件明細を1件追加"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">原作IP</span>
            <Input placeholder="原作IPを検索…" value={ipq} onChange={(e) => setIpq(e.target.value)} className="h-7 text-xs" />
            <NativeSelect value={form.source_work_id} onChange={(e) => { set("source_work_id", e.target.value); set("source_material_id", "") }} className="h-7 text-xs">
              <option value="">(なし)</option>
              {ipList.map((s) => <option key={s.id} value={s.id}>{(s.source_code ? s.source_code + " : " : "") + (s.title || "#" + s.id)}</option>)}
            </NativeSelect>
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">素材（原作IPの）</span>
            <NativeSelect value={form.source_material_id} onChange={(e) => set("source_material_id", e.target.value)} disabled={!form.source_work_id} className="h-7 text-xs">
              <option value="">{form.source_work_id ? "(指定なし)" : "(先に原作IPを選択)"}</option>
              {srcMats.map((m) => <option key={m.id} value={m.id}>{m.material_name || ("素材#" + m.id)}{m.material_type ? ` (${m.material_type})` : ""}</option>)}
            </NativeSelect>
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">料率 (%)</span>
            <Input type="number" step="0.0001" value={form.rate_pct} onChange={(e) => set("rate_pct", e.target.value)} className="h-7 text-xs" />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">基準価格</span>
            <Input value={form.base_price_label} onChange={(e) => set("base_price_label", e.target.value)} placeholder="上代 / 税抜定価 等" className="h-7 text-xs" />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">計算式</span>
            <Input value={form.formula_text} onChange={(e) => set("formula_text", e.target.value)} placeholder="上代 × 料率 × 製造数 等" className="h-7 text-xs" />
          </label>
        </div>
        {/* OUT(サブライセンス)のみ: 受領先・計算根拠・単価。受領記録の計算に使う。 */}
        {!isIn && (
          <div className="grid grid-cols-3 gap-2 border-t border-border/40 pt-2">
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">受領先(取引先)</span>
              <VendorSelectField value={form.counterparty_vendor_id} onChange={(v) => set("counterparty_vendor_id", v)} />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">計算根拠</span>
              <NativeSelect value={form.basis} onChange={(e) => set("basis", e.target.value)} className="h-7 text-xs">
                <option value="sales">報告売上 × 料率</option>
                <option value="manufacturing">報告数量 × 単価 × 料率</option>
              </NativeSelect>
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">単価(数量基準時)</span>
              <Input type="number" step="0.01" value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} disabled={form.basis !== "manufacturing"} className="h-7 text-xs" />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {form.id ? <Button variant="outline" size="sm" onClick={reset} disabled={busy}>キャンセル</Button> : null}
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "保存中…" : form.id ? "更新" : "＋追加"}</Button>
        </div>
      </div>
    </div>
  )
}

// サブライセンス受領記録(OUT)。自社作品配下の sublicense_out 条件ごとに、
//   期(period)単位で「報告売上/数量 → 料率計算 → 受領額」を入力(数字計算のみ・文書発行なし)。
function ReceiptsEditor({ workId }: { workId: number }) {
  const { showNotification } = useAppData()
  const [conds, setConds] = React.useState<Row[]>([])
  const [receipts, setReceipts] = React.useState<Row[] | null>(null)
  const [forms, setForms] = React.useState<Record<number, Row>>({})
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const cs = await getJson(`/api/v3/works/${workId}/conditions`)
      setConds((Array.isArray(cs) ? cs : []).filter((c: Row) => c.condition_kind === "sublicense_out"))
    } catch { setConds([]) }
    try { setReceipts(await getJson(`/api/v3/works/${workId}/receipts`)) } catch { setReceipts([]) }
  }, [workId])
  React.useEffect(() => { load() }, [load])

  const fset = (cid: number, k: string, v: any) => setForms((f) => ({ ...f, [cid]: { ...(f[cid] || {}), [k]: v } }))
  const yen = (n: any) => "¥" + (Number(n) || 0).toLocaleString("ja-JP")
  const preview = (cond: Row, f: Row) => {
    const rate = Number(cond.rate_pct) || 0
    const base = cond.basis === "manufacturing"
      ? (Number(f?.reported_quantity) || 0) * (Number(cond.unit_price) || 0)
      : (Number(f?.reported_sales) || 0)
    return Math.round(base * rate / 100 * 100) / 100
  }
  const add = async (cid: number) => {
    const f = forms[cid] || {}
    setBusy(true)
    try {
      await sendJson("POST", `/api/v3/work-conditions/${cid}/receipts`, {
        period: f.period || null,
        period_date: f.period_date || null,
        reported_sales: f.reported_sales === "" || f.reported_sales == null ? null : Number(f.reported_sales),
        reported_quantity: f.reported_quantity === "" || f.reported_quantity == null ? null : Number(f.reported_quantity),
        received_amount: f.received_amount === "" || f.received_amount == null ? null : Number(f.received_amount),
        received_date: f.received_date || null,
        note: f.note || null,
      })
      showNotification("受領記録を追加しました", "success")
      setForms((x) => ({ ...x, [cid]: {} }))
      await load()
    } catch (e: any) { showNotification(`追加に失敗: ${e?.message || e}`, "error") }
    finally { setBusy(false) }
  }
  const del = async (rid: number) => {
    if (!window.confirm("この受領記録を削除しますか？")) return
    try { await sendJson("DELETE", `/api/v3/condition-receipts/${rid}`, {}); await load() }
    catch (e: any) { showNotification(`削除に失敗: ${e?.message || e}`, "error") }
  }
  const byCond = (cid: number) => (receipts || []).filter((r) => Number(r.condition_id) === cid)
  const condLabel = (c: Row) => `条件#${c.condition_no ?? c.id}${c.region_language_label ? " " + c.region_language_label : ""}`

  return (
    <div className="mt-4 border-t pt-3 space-y-3">
      <div className="text-xs font-bold">
        サブライセンス受領記録（OUT・数字計算）
        <span className="ml-2 align-middle text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-700">受領</span>
      </div>
      {conds.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">先に「サブライセンス条件（OUT）」を追加してください。</p>
      ) : receipts === null ? (
        <div className="text-xs text-muted-foreground">読み込み中…</div>
      ) : conds.map((c) => {
        const f = forms[c.id] || {}
        const rows = byCond(c.id)
        const isMfg = c.basis === "manufacturing"
        return (
          <div key={c.id} className="rounded-sm border border-input">
            <div className="px-2 py-1.5 bg-muted/30 text-[11px] flex items-center gap-2 flex-wrap">
              <span className="font-bold">{condLabel(c)}</span>
              <span className="text-muted-foreground">
                料率 {c.rate_pct ?? "—"}% / {isMfg ? "数量×単価" : "売上"}基準{c.counterparty_name ? " / 受領先 " + c.counterparty_name : ""}
              </span>
            </div>
            <div className="p-2 space-y-2">
              {rows.length > 0 && (
                <table className="w-full text-[11px] border-collapse">
                  <thead><tr className="text-muted-foreground text-left [&>th]:py-1 [&>th]:pr-2">
                    <th>期</th><th>{isMfg ? "報告数量" : "報告売上"}</th><th>計算(税抜)</th><th>受領額</th><th>受領日</th><th></th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border/40 [&>td]:py-1 [&>td]:pr-2">
                        <td>{r.period || (r.period_date ? String(r.period_date).slice(0, 10) : "—")}</td>
                        <td>{isMfg ? (r.reported_quantity ?? "—") : yen(r.reported_sales)}</td>
                        <td className="font-bold">{yen(r.computed_royalty_ex_tax)}</td>
                        <td>{r.received_amount != null ? yen(r.received_amount) : "—"}</td>
                        <td>{r.received_date ? String(r.received_date).slice(0, 10) : "—"}</td>
                        <td className="text-right"><button className="text-[10px] underline text-destructive" onClick={() => del(Number(r.id))}>削除</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="grid grid-cols-5 gap-1.5 items-end">
                <Input placeholder="期(例 2026-Q1)" value={f.period || ""} onChange={(e) => fset(c.id, "period", e.target.value)} className="h-7 text-xs" />
                {isMfg
                  ? <Input type="number" placeholder="報告数量" value={f.reported_quantity || ""} onChange={(e) => fset(c.id, "reported_quantity", e.target.value)} className="h-7 text-xs" />
                  : <Input type="number" placeholder="報告売上(税抜)" value={f.reported_sales || ""} onChange={(e) => fset(c.id, "reported_sales", e.target.value)} className="h-7 text-xs" />}
                <Input type="number" placeholder="受領額(任意)" value={f.received_amount || ""} onChange={(e) => fset(c.id, "received_amount", e.target.value)} className="h-7 text-xs" />
                <Input type="date" value={f.received_date || ""} onChange={(e) => fset(c.id, "received_date", e.target.value)} className="h-7 text-xs" />
                <Button size="sm" onClick={() => add(c.id)} disabled={busy}>＋計算 {yen(preview(c, f))}</Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FormModal({
  type,
  mode,
  data,
  works,
  sourceIps,
  onClose,
  onSaved,
  showNotification,
}: {
  type: EntityType
  mode: "new" | "edit"
  data: Row
  works: Row[]
  sourceIps: Row[]
  onClose: () => void
  onSaved: () => void
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}) {
  const editId = mode === "edit" ? data.id : null
  // (B) 契約フォームの対象作品(contract_works)。{ kind, id, role }[]
  const [contractWorks, setContractWorks] = React.useState<
    Array<{ kind: "work" | "source_ip"; id: number; role: string }>
  >([])
  // 編集時は詳細を取得して既存の対象作品を prefill。
  React.useEffect(() => {
    if (type !== "contracts" || mode !== "edit" || !editId) return
    ;(async () => {
      try {
        const d = await getJson(`/api/v3/contracts/${editId}`)
        const rows = Array.isArray(d?.works) ? d.works : []
        setContractWorks(
          rows
            .map((w: any) =>
              w.work_id
                ? {
                    // P2-5: 原作IPも works(licensed_in)。work_kind で種別を判定。
                    kind: (w.work_kind === "licensed_in" ? "source_ip" : "work") as
                      | "work"
                      | "source_ip",
                    id: Number(w.work_id),
                    role: w.role || "",
                  }
                : w.source_ip_id
                  ? { kind: "source_ip" as const, id: Number(w.source_ip_id), role: w.role || "" }
                  : null
            )
            .filter(Boolean)
        )
      } catch {
        /* prefill 失敗は無視(空で開始) */
      }
    })()
  }, [type, mode, editId])
  const [form, setForm] = React.useState<Row>(() => {
    const init: Row = {}
    SCHEMA[type].forEach((f) => {
      let v = data[f.name]
      if (f.type === "array") v = Array.isArray(v) ? v.join(", ") : v || ""
      else if (f.type === "bool") v = !!v
      else if (f.type === "date") v = v ? String(v).slice(0, 10) : ""
      else v = v == null ? "" : v
      init[f.name] = v
    })
    return init
  })
  const [saving, setSaving] = React.useState(false)
  const set = (name: string, v: any) => setForm((f) => ({ ...f, [name]: v }))

  const gather = () => {
    const out: Row = {}
    SCHEMA[type].forEach((f) => {
      const v = form[f.name]
      if (f.type === "bool") out[f.name] = !!v
      else if (f.type === "array") out[f.name] = String(v || "").split(/[,、]/).map((s) => s.trim()).filter(Boolean)
      else if (f.type === "number" || f.type === "work-select" || f.type === "vendor-select") {
        const n = String(v ?? "").trim()
        out[f.name] = n === "" ? null : Number(n)
      } else {
        const s = String(v ?? "").trim()
        out[f.name] = s === "" ? null : s
      }
    })
    return out
  }

  const save = async () => {
    const payload = gather()
    const titleField = type === "contracts" ? "contract_title" : "title"
    if (!payload[titleField]) {
      showNotification(`${type === "contracts" ? "契約名" : "タイトル"}は必須です`, "error")
      return
    }
    // (B)/(P2-5) 契約の対象作品(contract_works)。原作IPも works(licensed_in)に統合済みのため
    //   作品・原作IP いずれも work_id で送る(id は works.id)。
    if (type === "contracts") {
      payload.works = contractWorks.map((r) => ({
        work_id: r.id,
        source_ip_id: null,
        role: r.role.trim() || null,
      }))
    }
    setSaving(true)
    try {
      if (mode === "edit") await sendJson("PUT", API[type] + "/" + editId, payload)
      else await sendJson("POST", API[type], payload)
      showNotification(mode === "edit" ? "更新しました" : "登録しました", "success")
      onSaved()
    } catch (e: any) {
      showNotification(`保存に失敗: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader><DialogTitle>{mode === "edit" ? "✎ 編集" : "＋ 新規"} — {LABEL[type]}</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          {/* 入力しやすさのため group ごとにセクション見出しを付けて並べる。 */}
          {groupFields(SCHEMA[type]).map(([groupName, fields]) => (
            <div key={groupName} className="space-y-3">
              {groupName && (
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground border-b border-border/60 pb-1">
                  {groupName}
                </div>
              )}
              {fields.map((f) => (
                <div key={f.name} className="space-y-1">
                  <Label className="text-xs">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </Label>
                  <FieldInput f={f} value={form[f.name]} works={type === "source-ips" ? sourceIps : works} editId={editId} onChange={(v) => set(f.name, v)} />
                  {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
          ))}
          {type === "contracts" && (
            <ContractWorksPicker
              works={works}
              sourceIps={sourceIps}
              rows={contractWorks}
              onChange={setContractWorks}
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldInput({ f, value, works, editId, onChange }: { f: FieldDef; value: any; works: Row[]; editId: number | null; onChange: (v: any) => void }) {
  if (f.type === "textarea") return <Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} />
  if (f.type === "bool")
    return <input type="checkbox" className="h-4 w-4" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  if (f.type === "number") return <Input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
  if (f.type === "date") return <Input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} />
  if (f.type === "select")
    return (
      <NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {(f.options || []).map((o) => <option key={o} value={o}>{o === "" ? "(未設定)" : o}</option>)}
      </NativeSelect>
    )
  if (f.type === "options") {
    const choices = f.choices === "DERIV" ? DERIV_CHOICES : []
    return (
      <NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {choices.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </NativeSelect>
    )
  }
  if (f.type === "work-select")
    return <WorkSelectField value={value} works={works} editId={editId} onChange={onChange} />
  if (f.type === "vendor-select")
    return <VendorSelectField value={value} onChange={onChange} />
  // text / array
  return <Input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
}

// 派生元(親作品)ピッカー。全作品の素のドロップダウンだと親を探しにくいので、
//   コード/タイトルで絞り込める検索ボックスを付ける。選択中の作品は常に表示。
function WorkSelectField({ value, works, editId, onChange }: { value: any; works: Row[]; editId: number | null; onChange: (v: any) => void }) {
  const [q, setQ] = React.useState("")
  const opts = works.filter((w) => !(editId && String(w.id) === String(editId)))
  const kw = q.trim().toLowerCase()
  const filtered = kw
    ? opts.filter((w) => `${w.work_code || ""} ${w.title || ""}`.toLowerCase().includes(kw))
    : opts
  // 選択中の作品が絞り込みから外れても option を残す(値が消えないように)。
  const selected = value ? opts.find((w) => String(w.id) === String(value)) : null
  const list = selected && !filtered.some((w) => String(w.id) === String(selected.id))
    ? [selected, ...filtered]
    : filtered
  const label = (w: Row) => (w.work_code ? w.work_code + " : " : "") + (w.title || "#" + w.id)
  return (
    <div className="space-y-1">
      <Input
        placeholder="親作品を検索 (コード / タイトル)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">(なし)</option>
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {label(w)}
          </option>
        ))}
      </NativeSelect>
      {kw && (
        <p className="text-[10px] font-mono text-muted-foreground">
          {filtered.length} 件ヒット{filtered.length === 0 ? " — 別のキーワードで検索" : ""}
        </p>
      )}
    </div>
  )
}

// 取引先ピッカー(名称/コードで検索して vendor_id を選ぶ)。
//   従来は ID 手入力だったのを検索選択に置換((A))。/api/master/vendors を一度取得。
type VendorOpt = { id: number; vendor_code: string; vendor_name: string }
let __vendorCache: VendorOpt[] | null = null
function VendorSelectField({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [vendors, setVendors] = React.useState<VendorOpt[]>(__vendorCache || [])
  const [q, setQ] = React.useState("")
  React.useEffect(() => {
    if (__vendorCache) return
    ;(async () => {
      try {
        const r = await fetch("/api/master/vendors")
        if (!r.ok) return
        const rows = await r.json()
        const opts: VendorOpt[] = (Array.isArray(rows) ? rows : [])
          .filter((v: any) => v?.id)
          .map((v: any) => ({
            id: Number(v.id),
            vendor_code: v.vendor_code || "",
            vendor_name: v.vendor_name || "",
          }))
        __vendorCache = opts
        setVendors(opts)
      } catch {
        /* 取得失敗時は空(手入力フォールバックは下のID直接欄) */
      }
    })()
  }, [])
  const kw = q.trim().toLowerCase()
  const filtered = kw
    ? vendors.filter((v) => `${v.vendor_code} ${v.vendor_name}`.toLowerCase().includes(kw))
    : vendors
  const selected = value ? vendors.find((v) => String(v.id) === String(value)) : null
  // 選択中が絞り込みから外れても候補に残す(値が消えないように)
  const list = selected && !filtered.some((v) => String(v.id) === String(selected.id))
    ? [selected, ...filtered.slice(0, 50)]
    : filtered.slice(0, 50)
  const label = (v: VendorOpt) => (v.vendor_code ? v.vendor_code + " : " : "") + (v.vendor_name || "#" + v.id)
  return (
    <div className="space-y-1">
      <Input
        placeholder="取引先を検索 (名称 / コード)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">(なし)</option>
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {label(v)}
          </option>
        ))}
      </NativeSelect>
      {vendors.length === 0 && (
        <p className="text-[10px] font-mono text-muted-foreground">
          取引先一覧を取得できませんでした。ID直接入力:{" "}
          <input
            type="number"
            className="border-b border-input bg-transparent w-24 px-1 text-xs"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </p>
      )}
    </div>
  )
}

// (B) 契約フォームの「対象作品 / 原作IP」ピッカー。
//   contract_works を作る。自社作品(work)または原作IP(source_ip)を検索選択して行追加。
type CWRow = { kind: "work" | "source_ip"; id: number; role: string }
function ContractWorksPicker({
  works,
  sourceIps,
  rows,
  onChange,
}: {
  works: Row[]
  sourceIps: Row[]
  rows: CWRow[]
  onChange: (rows: CWRow[]) => void
}) {
  const [kind, setKind] = React.useState<"work" | "source_ip">("work")
  const [pick, setPick] = React.useState("")
  const [q, setQ] = React.useState("")
  const pool = kind === "work" ? works : sourceIps
  const codeKey = kind === "work" ? "work_code" : "source_code"
  const kw = q.trim().toLowerCase()
  const filtered = (kw
    ? pool.filter((p) => `${p[codeKey] || ""} ${p.title || ""}`.toLowerCase().includes(kw))
    : pool
  ).slice(0, 50)
  const labelOf = (kind: "work" | "source_ip", id: number) => {
    const src = kind === "work" ? works : sourceIps
    const ck = kind === "work" ? "work_code" : "source_code"
    const o = src.find((x) => String(x.id) === String(id))
    return o ? `${o[ck] ? o[ck] + " : " : ""}${o.title || "#" + id}` : `#${id}`
  }
  const add = () => {
    const id = Number(pick)
    if (!id) return
    if (rows.some((r) => r.kind === kind && r.id === id)) return
    onChange([...rows, { kind, id, role: "" }])
    setPick("")
    setQ("")
  }
  const removeAt = (i: number) => onChange(rows.filter((_, idx) => idx !== i))
  const setRole = (i: number, role: string) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, role } : r)))
  return (
    <div className="space-y-2 border-t pt-3">
      <Label className="text-xs font-bold">対象作品 / 原作IP（契約の紐付け）</Label>
      {rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 text-xs">
              <Badge variant="outline">{r.kind === "work" ? "作品" : "原作IP"}</Badge>
              <span className="flex-1 min-w-0 truncate">{labelOf(r.kind, r.id)}</span>
              <Input
                className="w-28 h-7 text-xs"
                placeholder="役割(任意)"
                value={r.role}
                onChange={(e) => setRole(i, e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={() => removeAt(i)}>削除</Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 flex-wrap">
        <NativeSelect
          className="w-24"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as "work" | "source_ip")
            setPick("")
            setQ("")
          }}
        >
          <option value="work">作品</option>
          <option value="source_ip">原作IP</option>
        </NativeSelect>
        <div className="flex-1 min-w-[180px] space-y-1">
          <Input
            placeholder={`${kind === "work" ? "作品" : "原作IP"}を検索 (コード/タイトル)…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">(選択)</option>
            {filtered.map((p) => (
              <option key={p.id} value={p.id}>
                {(p[codeKey] ? p[codeKey] + " : " : "") + (p.title || "#" + p.id)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="outline" size="sm" onClick={add} disabled={!pick}>＋追加</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        契約が対象とする自社作品・原作IPを紐付けます（contract_works）。役割は任意（例: 原作 / 翻訳 等）。
      </p>
    </div>
  )
}

function ImportModal({ type, onClose, onImported }: { type: EntityType; onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = React.useState("")
  const [dry, setDry] = React.useState(true)
  const [dup, setDup] = React.useState("overwrite")
  const [result, setResult] = React.useState<any>(null)
  const [running, setRunning] = React.useState(false)
  const { showNotification } = useAppData()

  const onFile = (file?: File) => {
    if (!file) return
    const rd = new FileReader()
    rd.onload = () => setCsv(String(rd.result || ""))
    rd.readAsText(file, "UTF-8")
  }
  const downloadTemplate = async () => {
    try {
      const res = await fetch(`/api/v3/import/${type}/template.csv`)
      if (!res.ok) throw new Error("HTTP " + res.status)
      const blob = await res.blob()
      const u = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = u
      a.download = `${type}_template.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(u)
    } catch (e: any) {
      showNotification(`サンプル取得に失敗: ${e?.message || e}`, "error")
    }
  }
  const run = async () => {
    if (!csv.trim()) {
      showNotification("CSV が空です", "error")
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const r = await sendJson("POST", `/api/v3/import/${type}`, { csv, dry_run: dry, duplicate_mode: dup })
      setResult(r)
      if (!r.dry_run && r.succeeded > 0) onImported()
    } catch (e: any) {
      setResult({ error: e?.message || String(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader><DialogTitle>⇪ CSV取込 — {LABEL[type]}</DialogTitle></DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>⬇ サンプルCSVをダウンロード</Button>
            <p className="text-[11px] text-muted-foreground mt-1">UTF-8。日本語/英語ヘッダ対応。コード列が空なら自動採番されます。</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CSVファイル</Label>
            <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">または CSV を貼り付け</Label>
            <Textarea className="min-h-[120px] font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
          </div>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={dry} onChange={(e) => setDry(e.target.checked)} />
              ドライラン(検証のみ・書込なし)
            </label>
            <label className="flex items-center gap-2">
              重複時:
              <NativeSelect className="w-auto" value={dup} onChange={(e) => setDup(e.target.value)}>
                <option value="overwrite">上書き</option>
                <option value="skip">スキップ</option>
                <option value="fill_only">空欄のみ補完</option>
              </NativeSelect>
            </label>
          </div>
          {result && <ImportResult r={result} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>閉じる</Button>
          <Button onClick={run} disabled={running}>{running ? "処理中…" : "実行"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportResult({ r }: { r: any }) {
  if (r.error) return <div className="text-sm text-destructive">取込に失敗しました: {r.error}</div>
  return (
    <div>
      <div className={`text-xs mb-2 ${r.dry_run ? "text-amber-600" : "text-emerald-600"}`}>
        {r.dry_run ? "🧪 ドライラン結果(DBには書き込んでいません)。問題なければドライランを外して再実行してください。" : "✅ 取込完了。"}
      </div>
      <div className="flex gap-4 flex-wrap text-xs mb-2">
        <span>総数 <b>{r.total}</b></span>
        <span className="text-emerald-600">成功 <b>{r.succeeded}</b></span>
        <span className="text-amber-600">スキップ <b>{r.skipped}</b></span>
        <span className="text-destructive">失敗 <b>{r.failed}</b></span>
        {r.parent_unresolved > 0 && (
          <span className="text-amber-700">親未解決 <b>{r.parent_unresolved}</b></span>
        )}
      </div>
      {r.parent_unresolved > 0 && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mb-2">
          親(派生元)が見つからなかった行が {r.parent_unresolved} 件あります（下表「親解決=未解決✗」）。
          親はコード(parent_work_code)または作品名(parent_work_title)で指定できます。
          その行は親未紐付けで取り込まれます。親作品を先に取り込む／コード・作品名を確認のうえ、再取込や「🧬 派生元を設定」で紐付けてください。
        </div>
      )}
      {r.errors?.length > 0 && (
        <div>
          <div className="text-xs font-bold mt-2 mb-1">エラー</div>
          <table className="w-full text-xs border-collapse">
            <thead><tr><th className="border border-border bg-muted/50 px-1.5 py-1 text-left">行</th><th className="border border-border bg-muted/50 px-1.5 py-1 text-left">内容</th></tr></thead>
            <tbody>{r.errors.map((e: any, i: number) => <tr key={i}><td className="border border-border px-1.5 py-1">{e.row}</td><td className="border border-border px-1.5 py-1">{e.message}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {r.preview?.length > 0 && <SubTable label="プレビュー" rows={r.preview} />}
    </div>
  )
}
