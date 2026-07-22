import * as React from "react"
import { Search, Download, X } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { conditionClient } from "@/src/lib/api/conditionClient"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { DataTableShell } from "@/src/components/form"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

// 統合 P3-2: 条件明細(capability_line_items)横断検索。
//   search-api 専用だった /master/conditions を React へ移植。
//   検索 + CSV + 紐付け編集(原作/作品/基本契約/稟議/状態/方向)を網羅。

const STATUS_DEFS: { key: string; label: string }[] = [
  { key: "po_signed", label: "発注書締結済" },
  { key: "inspection_issued", label: "検収書発行済" },
  { key: "payment_exported", label: "支払申請ファイル出力済" },
]

const CAT_LABEL: Record<string, string> = {
  service: "業務委託",
  license: "ライセンス",
  license_in: "ライセンス(IN)",
  license_out: "ライセンス(OUT)",
  publication: "出版",
  sales: "売買",
  nda: "NDA",
}

const emptyFilters = {
  payment_from: "",
  payment_to: "",
  delivery_from: "",
  delivery_to: "",
  category: "",
  vendor: "",
  owner: "",
  q: "",
  include_all: false,
}

type Filters = typeof emptyFilters
type Row = Record<string, any>
type PickItem = Record<string, any>

const yen = (n: any) => {
  if (n == null || n === "") return ""
  const v = Number(n)
  return isFinite(v) ? v.toLocaleString("ja-JP") : String(n)
}
const catLabel = (c: string) => CAT_LABEL[c] || c || "—"

// 経理照合: 成就/未了(二値中心)。一部は未了寄りの中間色で示す。
const FULFILL: Record<string, { label: string; cls: string }> = {
  fulfilled: { label: "成就", cls: "bg-success/10 text-success hover:bg-success/10" },
  partially_fulfilled: { label: "一部", cls: "bg-warning/10 text-warning hover:bg-warning/10" },
  open: { label: "未了", cls: "bg-slate-100 text-slate-600 hover:bg-slate-100" },
}
const fulfillOf = (s: any) => FULFILL[String(s || "open")] || FULFILL.open

export function ConditionsPanel() {
  const { showNotification } = useAppData()
  const [filters, setFilters] = React.useState<Filters>(emptyFilters)
  const [rows, setRows] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  // 経理照合: 成就/未了の絞り込み(読込済みページに対するクライアントフィルタ)。
  const [fulfill, setFulfill] = React.useState<"" | "open" | "partially_fulfilled" | "fulfilled">("")
  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  const buildParams = (f: Filters) => {
    const p = new URLSearchParams()
    ;(
      ["payment_from", "payment_to", "delivery_from", "delivery_to", "category", "vendor", "owner", "q"] as const
    ).forEach((k) => {
      const v = (f[k] || "").toString().trim()
      if (v) p.set(k, v)
    })
    if (f.include_all) p.set("include_all", "1")
    return p
  }

  const load = async (f: Filters = filters) => {
    setLoading(true)
    setError(null)
    try {
      const data: any = await conditionClient.search(buildParams(f))
      const list: Row[] = data.rows || []
      setRows(list)
      setTotal(typeof data.total === "number" ? data.total : null)
      setSelected(new Set())
      // 成就させた検収書/利用許諾料計算書の文書番号は listConditions が
      //   fulfilling_doc_number として行に同梱して返すため、別途取得は不要。
    } catch (e: any) {
      setError(e?.message || String(e))
      setRows([])
      setTotal(null)
    } finally {
      setLoading(false)
    }
  }

  // 初回ロード
  React.useEffect(() => {
    load(emptyFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    setFilters(emptyFilters)
    load(emptyFilters)
  }

  const toggle = (id: number) => {
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  const toggleAll = () => {
    setSelected((s) =>
      s.size === rows.length ? new Set() : new Set(rows.map((r) => Number(r.id)))
    )
  }

  // CSV: admin-ui 同一オリジンへの直リンクは 410 になるため、fetch(→apiRouter で
  //   search-api へ) の blob をダウンロードする。
  const csvExport = async (ids?: number[]) => {
    const p = buildParams(filters)
    if (ids?.length) p.set("ids", ids.join(","))
    try {
      const res = await fetch("/api/conditions/export?" + p.toString())
      if (!res.ok) throw new Error("HTTP " + res.status)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `conditions_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showNotification(`CSV出力に失敗しました: ${e?.message || e}`, "error")
    }
  }

  // ── 紐付け編集モーダル ───────────────────────────────────────
  const [editing, setEditing] = React.useState<Row | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)
  const pickRef = React.useRef<{
    source: PickItem[]
    works: PickItem[]
    masters: PickItem[]
    ringi: PickItem[]
  } | null>(null)
  const [, forcePick] = React.useState(0)

  const loadPickers = React.useCallback(async () => {
    if (pickRef.current) return
    const get = (u: string) =>
      fetch(u).then((x) => (x.ok ? x.json() : [])).catch(() => [])
    const [s, w, c, g] = await Promise.all([
      get("/api/v3/source-ips"),
      get("/api/v3/works"),
      get("/api/v3/contracts"),
      get("/api/conditions/ringi-options"),
    ])
    pickRef.current = {
      source: Array.isArray(s) ? s : [],
      works: Array.isArray(w) ? w : [],
      masters: (Array.isArray(c) ? c : []).filter((x: any) => {
        const lv = x.contract_level || ""
        return lv === "master" || lv === ""
      }),
      ringi: Array.isArray(g) ? g : [],
    }
    forcePick((n) => n + 1)
  }, [])

  const openEdit = async (row: Row) => {
    setEditing(row)
    const dir =
      row.flow_direction === "in" || row.flow_direction === "out"
        ? row.flow_direction
        : row.is_inbound
        ? "out"
        : ""
    setForm({
      source_ip_id: row.source_ip_id ?? "",
      work_id: row.work_id ?? "",
      master_contract_id: row.master_contract_id ?? "",
      ringi_id: row.ringi_id ?? "",
      flow_direction: dir,
      status_flags: { ...(row.status_flags || {}) },
    })
    await loadPickers()
  }

  const saveLinks = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const toNull = (v: any) => (v === "" || v == null ? null : Number(v))
      const res = await fetch(
        `/api/conditions/${encodeURIComponent(editing.id)}/links`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_ip_id: toNull(form.source_ip_id),
            work_id: toNull(form.work_id),
            master_contract_id: toNull(form.master_contract_id),
            ringi_id: toNull(form.ringi_id),
            status_flags: form.status_flags || {},
            flow_direction: form.flow_direction,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false)
        throw new Error(data.error || "HTTP " + res.status)
      showNotification("紐付けを保存しました", "success")
      setEditing(null)
      await load()
    } catch (e: any) {
      showNotification(`保存に失敗しました: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const pick = pickRef.current

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-4">
      {/* フィルタ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border border-border rounded-lg bg-card/50">
        <Field label="支払日">
          <div className="flex items-center gap-1">
            <Input type="date" value={filters.payment_from} onChange={(e) => setF({ payment_from: e.target.value })} />
            <span className="text-muted-foreground text-xs">〜</span>
            <Input type="date" value={filters.payment_to} onChange={(e) => setF({ payment_to: e.target.value })} />
          </div>
        </Field>
        <Field label="納期">
          <div className="flex items-center gap-1">
            <Input type="date" value={filters.delivery_from} onChange={(e) => setF({ delivery_from: e.target.value })} />
            <span className="text-muted-foreground text-xs">〜</span>
            <Input type="date" value={filters.delivery_to} onChange={(e) => setF({ delivery_to: e.target.value })} />
          </div>
        </Field>
        <Field label="種類">
          <NativeSelect value={filters.category} onChange={(e) => setF({ category: e.target.value })}>
            <option value="">全種類</option>
            <option value="service">業務委託</option>
            <option value="license">ライセンス</option>
            <option value="publication">出版</option>
            <option value="sales">売買</option>
            <option value="nda">NDA</option>
          </NativeSelect>
        </Field>
        <Field label="取引先 (名称 / コード)">
          <Input value={filters.vendor} placeholder="例: 株式会社X / V-001" onChange={(e) => setF({ vendor: e.target.value })} onKeyDown={(e) => e.key === "Enter" && load()} />
        </Field>
        <Field label="担当 (作成者 / 氏名)">
          <Input value={filters.owner} placeholder="例: 山田 / メール" onChange={(e) => setF({ owner: e.target.value })} onKeyDown={(e) => e.key === "Enter" && load()} />
        </Field>
        <Field label="キーワード (品目 / 仕様 / 契約名 / 文書番号)">
          <Input value={filters.q} placeholder="フリーワード" onChange={(e) => setF({ q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && load()} />
        </Field>
        <div className="flex items-end gap-2">
          <Button onClick={load} disabled={loading}>
            <Search />
            検索
          </Button>
          <Button variant="outline" onClick={clear} disabled={loading}>
            クリア
          </Button>
        </div>
        <label className="flex items-end gap-2 text-xs text-muted-foreground cursor-pointer pb-2">
          <input type="checkbox" className="h-4 w-4" checked={filters.include_all} onChange={(e) => setF({ include_all: e.target.checked })} />
          古い版・重複も表示
        </label>
      </div>

      {/* ツールバー */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[12px] text-muted-foreground">
          {loading ? "検索中…" : `${rows.length} 件${total && total > rows.length ? ` / 全 ${total} 件` : ""}`}
        </span>
        <span className="text-xs text-muted-foreground">行をクリックで紐付けを編集</span>
        {/* 経理照合: 成就/未了の絞り込み(読込済みページ) */}
        <div className="flex items-center gap-1 text-[11px] font-mono">
          {([
            { k: "", label: "すべて" },
            { k: "open", label: "未了" },
            { k: "partially_fulfilled", label: "一部" },
            { k: "fulfilled", label: "成就" },
          ] as const).map((b) => {
            const n =
              b.k === ""
                ? rows.length
                : rows.filter((r) => (r.fulfillment_status || "open") === b.k).length
            const on = fulfill === b.k
            return (
              <button
                key={b.k || "all"}
                type="button"
                onClick={() => setFulfill(b.k as any)}
                className={`px-2 py-0.5 rounded-full border ${
                  on ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground"
                }`}
              >
                {b.label} ({n})
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => csvExport(Array.from(selected))} disabled={selected.size === 0}>
          <Download />
          選択をCSV ({selected.size})
        </Button>
        <Button size="sm" onClick={() => csvExport()}>
          <Download />
          全件CSV
        </Button>
      </div>

      {/* テーブル（共通シェル DataTableShell 採用。列描画・行クリック編集は不変） */}
      {error ? (
        <div className="border border-border rounded-lg p-8 text-center text-sm text-destructive">読み込みに失敗しました: {error}</div>
      ) : (
        <DataTableShell
          rowKey={(r: any) => Number(r.id)}
          onRowClick={(r: any) => openEdit(r)}
          loading={loading}
          emptyTitle="該当する条件明細がありません"
          rows={fulfill ? rows.filter((r) => (r.fulfillment_status || "open") === fulfill) : rows}
          columns={[
            {
              key: "sel",
              header: <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />,
              className: "w-8",
              render: (r: any) => (
                <span onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(Number(r.id))} onChange={() => toggle(Number(r.id))} />
                </span>
              ),
            },
            { key: "payment_date", header: "支払日", className: "whitespace-nowrap", render: (r: any) => r.payment_date || "—" },
            { key: "delivery_date", header: "納期", className: "whitespace-nowrap", render: (r: any) => r.delivery_date || "—" },
            {
              key: "category", header: "種類", className: "whitespace-nowrap",
              render: (r: any) => {
                const dir = r.flow_direction === "in" || r.flow_direction === "out" ? r.flow_direction : r.is_inbound ? "out" : ""
                return (
                  <>
                    <Badge className="bg-info/10 text-info hover:bg-info/10">{catLabel(r.contract_category)}</Badge>
                    {dir === "out" ? (
                      <Badge className="ml-1 bg-success/10 text-success hover:bg-success/10">アウト(受領)</Badge>
                    ) : dir === "in" ? (
                      <Badge variant="outline" className="ml-1">イン(支払)</Badge>
                    ) : null}
                    {r.contract_type && <div className="text-[10px] text-muted-foreground mt-0.5">{r.contract_type}</div>}
                  </>
                )
              },
            },
            {
              key: "vendor", header: "取引先", className: "min-w-[120px]",
              render: (r: any) => (
                <>
                  {r.vendor_name || "—"}
                  {r.vendor_code && <div className="text-[10px] text-muted-foreground">{r.vendor_code}</div>}
                </>
              ),
            },
            { key: "owner", header: "担当", className: "whitespace-nowrap", render: (r: any) => r.owner_name || "—" },
            {
              key: "item", header: "品目", className: "min-w-[140px]",
              render: (r: any) => (
                <>
                  <div>{r.item_name || "—"}</div>
                  {r.spec && <div className="text-[10px] text-muted-foreground">{r.spec}</div>}
                </>
              ),
            },
            {
              key: "calc", header: "計算", className: "whitespace-nowrap",
              render: (r: any) => (
                <>
                  {r.calc_method || ""}
                  {r.payment_terms && <div className="text-[10px] text-muted-foreground">{r.payment_terms}</div>}
                </>
              ),
            },
            { key: "qty", header: "数量", align: "right", className: "whitespace-nowrap", render: (r: any) => r.quantity ?? "" },
            { key: "unit", header: "単価", align: "right", className: "whitespace-nowrap", render: (r: any) => yen(r.unit_price) },
            { key: "amt", header: "発注額(税抜)", align: "right", className: "whitespace-nowrap font-mono", render: (r: any) => yen(r.amount_ex_tax) },
            { key: "consumed", header: "検収額", align: "right", className: "whitespace-nowrap text-muted-foreground", render: (r: any) => (r.consumed_amount != null ? yen(r.consumed_amount) : "—") },
            {
              key: "fulfill_status", header: "成就/未了", className: "whitespace-nowrap",
              render: (r: any) => {
                const fb = fulfillOf(r.fulfillment_status)
                return <Badge className={fb.cls}>{fb.label}</Badge>
              },
            },
            { key: "docnum", header: "文書番号", className: "whitespace-nowrap", render: (r: any) => r.document_number || "—" },
            {
              key: "fulfilldoc", header: "検収書", className: "whitespace-nowrap",
              render: (r: any) => {
                const doc = (r as any).fulfilling_doc_number || ""
                const cnt = Number((r as any).fulfilling_doc_count) || 0
                if (!doc) return "—"
                return <span onClick={(e) => e.stopPropagation()}>{cnt > 1 ? `${doc} 他${cnt - 1}件` : doc}</span>
              },
            },
            {
              key: "contract", header: "契約名 / 課題", className: "min-w-[140px]",
              render: (r: any) => (
                <>
                  {r.contract_title || "—"}
                  {r.issue_key && <div className="text-[10px] text-muted-foreground">{r.issue_key}</div>}
                </>
              ),
            },
            {
              key: "links", header: "紐付け", className: "min-w-[160px]",
              render: (r: any) => (
                <div className="flex flex-wrap gap-1">
                  {r.work_title && <LinkPill tone="work">作 {r.work_title}</LinkPill>}
                  {r.source_ip_title && <LinkPill tone="ip">原 {r.source_ip_title}</LinkPill>}
                  {(r.master_contract_title || r.master_contract_number) && (
                    <LinkPill tone="master">基 {r.master_contract_title || r.master_contract_number}</LinkPill>
                  )}
                  {(r.ringi_number || r.ringi_title) && (
                    <LinkPill tone="ringi">
                      稟 {r.ringi_number ? `${r.ringi_number}${r.ringi_title ? " " + r.ringi_title : ""}` : r.ringi_title}
                    </LinkPill>
                  )}
                  {!r.work_title && !r.source_ip_title && !r.master_contract_title && !r.master_contract_number && !r.ringi_number && !r.ringi_title && (
                    <span className="text-muted-foreground">＋ 未設定</span>
                  )}
                </div>
              ),
            },
            {
              key: "status", header: "状態", className: "min-w-[120px]",
              render: (r: any) => {
                const sf = r.status_flags || {}
                return (
                  <div className="flex flex-wrap gap-1">
                    {STATUS_DEFS.filter((d) => sf[d.key]).map((d) => (
                      <React.Fragment key={d.key}>
                        <LinkPill tone="status">{d.label}</LinkPill>
                      </React.Fragment>
                    ))}
                    {!STATUS_DEFS.some((d) => sf[d.key]) && <span className="text-muted-foreground">—</span>}
                  </div>
                )
              },
            },
          ]}
        />
      )}

      {/* 紐付け編集モーダル */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>紐付けを編集</DialogTitle>
          </DialogHeader>
          {editing && form && (
            <DialogBody className="space-y-3">
              <div className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-md p-2.5 leading-relaxed">
                品目: <b className="text-foreground">{editing.item_name || "—"}</b>
                <br />
                文書: {editing.document_number || "—"} / 取引先: {editing.vendor_name || "—"} / 支払日: {editing.payment_date || "—"}
              </div>
              <Field label="原作 (source IP)">
                <NativeSelect value={form.source_ip_id} onChange={(e) => setForm({ ...form, source_ip_id: e.target.value })}>
                  <option value="">— なし —</option>
                  {(pick?.source || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.source_code ? s.source_code + " : " : "") + (s.title || "#" + s.id)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="作品 (work)">
                <NativeSelect value={form.work_id} onChange={(e) => setForm({ ...form, work_id: e.target.value })}>
                  <option value="">— なし —</option>
                  {(pick?.works || []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {(w.work_code ? w.work_code + " : " : "") + (w.title || "#" + w.id)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="マスター契約 (基本契約 / 作品モデル v3)">
                <NativeSelect value={form.master_contract_id} onChange={(e) => setForm({ ...form, master_contract_id: e.target.value })}>
                  <option value="">— なし —</option>
                  {(pick?.masters || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.document_number ? c.document_number + " : " : "") + (c.contract_title || "#" + c.id)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="稟議 (ringi)">
                <NativeSelect value={form.ringi_id} onChange={(e) => setForm({ ...form, ringi_id: e.target.value })}>
                  <option value="">— なし —</option>
                  {(pick?.ringi || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {(g.ringi_number ? g.ringi_number + " : " : "") + (g.title || "#" + g.id)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="状態">
                <div className="flex flex-col gap-2">
                  {STATUS_DEFS.map((d) => (
                    <label key={d.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={!!form.status_flags?.[d.key]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            status_flags: { ...form.status_flags, [d.key]: e.target.checked },
                          })
                        }
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="方向 (in/out)">
                <NativeSelect value={form.flow_direction} onChange={(e) => setForm({ ...form, flow_direction: e.target.value })}>
                  <option value="">(未設定)</option>
                  <option value="in">イン — 当社が支払う(ライセンスイン/プロダクトイン・仕入)</option>
                  <option value="out">アウト — 当社が受領する(ライセンスアウト/プロダクトアウト)</option>
                </NativeSelect>
                <p className="text-[11px] text-muted-foreground mt-1">
                  「アウト」にすると当社の受領明細として「請求権台帳(受領予定)」へ自動取込されます。
                </p>
              </Field>
            </DialogBody>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              <X />
              キャンセル
            </Button>
            <Button onClick={saveLinks} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function LinkPill({ tone, children }: { tone: "work" | "ip" | "master" | "ringi" | "status"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    work: "bg-primary/10 text-primary",
    ip: "bg-success/10 text-success",
    master: "bg-warning/10 text-warning",
    ringi: "bg-destructive/10 text-destructive",
    status: "bg-teal-100 text-teal-700",
  }
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  )
}
