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
  type: "text" | "textarea" | "date" | "bool" | "array" | "number" | "select" | "options" | "work-select"
  required?: boolean
  hint?: string
  options?: string[]
  choices?: "DERIV"
}

const SCHEMA: Record<EntityType, FieldDef[]> = {
  "source-ips": [
    { name: "title", label: "タイトル", type: "text", required: true },
    { name: "title_kana", label: "タイトル(カナ)", type: "text" },
    { name: "alternative_titles", label: "別タイトル(, 区切り)", type: "array" },
    { name: "original_publisher", label: "原作出版社", type: "text" },
    { name: "default_rights_holder", label: "既定権利者", type: "text" },
    { name: "default_credit_display", label: "クレジット表記", type: "text" },
    { name: "default_work_supplement", label: "作品補足", type: "textarea" },
    { name: "default_approval_target", label: "承認対象", type: "text" },
    { name: "default_approval_timing", label: "承認タイミング", type: "text" },
    { name: "rights_holder_vendor_id", label: "権利者 取引先ID", type: "number", hint: "取引先マスタの内部ID(任意)" },
    { name: "remarks", label: "備考", type: "textarea" },
  ],
  works: [
    { name: "title", label: "タイトル", type: "text", required: true },
    { name: "title_kana", label: "タイトル(カナ)", type: "text" },
    { name: "alternative_titles", label: "別タイトル(, 区切り)", type: "array" },
    { name: "division", label: "区分(, 区切り)", type: "array", hint: "例: BDG, PUB" },
    { name: "work_type", label: "作品種別", type: "select", options: ["", "board_game", "trpg_book", "supplement", "digital"] },
    { name: "status", label: "ステータス", type: "select", options: ["", "planning", "in_production", "released", "suspended", "discontinued"] },
    { name: "is_original", label: "完全オリジナル", type: "bool" },
    { name: "publisher_vendor_id", label: "出版社 取引先ID", type: "number" },
    { name: "parent_work_id", label: "派生元の作品(系譜)", type: "work-select", hint: "翻訳版・改題版などは派生元の自社作品を選ぶ" },
    { name: "derivation_type", label: "派生種別", type: "options", choices: "DERIV" },
    { name: "remarks", label: "備考", type: "textarea" },
  ],
  contracts: [
    { name: "contract_title", label: "契約名", type: "text", required: true },
    { name: "contract_level", label: "契約レベル", type: "select", options: ["", "master", "individual", "standalone"] },
    { name: "contract_category", label: "契約カテゴリ", type: "text", hint: "license_in / license_out / service / publication / sales / nda" },
    { name: "contract_type", label: "契約類型", type: "text" },
    { name: "lifecycle_stage", label: "ライフサイクル", type: "text", hint: "requested / under_review / executed 等" },
    { name: "primary_vendor_id", label: "主取引先ID", type: "number" },
    { name: "effective_date", label: "発効日", type: "date" },
    { name: "expiration_date", label: "満了日", type: "date" },
    { name: "auto_renewal", label: "自動更新", type: "bool" },
  ],
}

const SUBKEYS: Record<EntityType, [string, string][]> = {
  "source-ips": [["materials", "素材 / 権利者台帳"]],
  works: [["products", "製品"], ["rights", "権利台帳"], ["contracts", "紐づく契約"], ["payment_summary", "支払集計"]],
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
            <Button size="sm" onClick={() => setModal({ kind: "form", type, mode: "new", data: {} })}>
              <Plus />
              新規
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal({ kind: "import", type })}>
              <Upload />
              CSV取込
            </Button>
          </div>
          {type === "works" ? (
            // #3: 作品は親→派生のツリー表示。各ノードに #2 派生元設定の導線。
            lists.works.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">データがありません</div>
            ) : (
              <WorkTree
                works={lists.works}
                onOpenDetail={(id) => setModal({ kind: "detail", type: "works", id })}
                onQuickParent={(w) => setQuickParent(w)}
              />
            )
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
          <Link to={`/master/sublicense?deal_work=${w.id}`} className="inline-block text-[11px] font-bold text-amber-700 bg-amber-50 rounded px-2 py-0.5 hover:bg-amber-100">
            💴 受領条件を作成
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

function DetailModal({ type, id, onClose, onEdit }: { type: EntityType; id: number; onClose: () => void; onEdit: (obj: Row) => void }) {
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

function FormModal({
  type,
  mode,
  data,
  works,
  onClose,
  onSaved,
  showNotification,
}: {
  type: EntityType
  mode: "new" | "edit"
  data: Row
  works: Row[]
  onClose: () => void
  onSaved: () => void
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}) {
  const editId = mode === "edit" ? data.id : null
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
      else if (f.type === "number" || f.type === "work-select") {
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
        <DialogBody className="space-y-3">
          {SCHEMA[type].map((f) => (
            <div key={f.name} className="space-y-1">
              <Label className="text-xs">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </Label>
              <FieldInput f={f} value={form[f.name]} works={works} editId={editId} onChange={(v) => set(f.name, v)} />
              {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
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
