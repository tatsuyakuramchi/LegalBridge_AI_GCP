/**
 * SublicenseConditionPanel — 再許諾条件 一覧（作品 × 再許諾先・閲覧専用）。
 *
 * 編集入口の一本化: 再許諾(sublicense_out)条件の作成・修正は「再許諾条件書」文書作成
 * フォーム(template=sublicense_out_terms)に一本化した。本画面は登録済み条件の
 * 閲覧に専念し、作成/修正は文書フォームへ誘導する（データの唯一の入力口＝文書作成）。
 *
 * 参照する API(読取りのみ):
 *   - GET /api/v3/works/:id/conditions  (condition_kind='sublicense_out' を抽出)
 * 既存の契約無し条件(document_id 無し)は legacy として引き続き表示される（共存）。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Coins, Loader2, Search, Building2, FileText, ExternalLink } from "lucide-react"

import { EntitySearchSelect, type EntityOption } from "@/src/components/search/EntitySearch"
import { V3_CALC_MODELS } from "@/src/components/document/V3LicenseMatrix"

type CondRow = {
  id: number
  document_id?: number | null
  document_number?: string | null
  parent_license_condition_id?: number | null
  calc_type?: string | null
  condition_name?: string | null
  base_price_label?: string | null
  rate_pct?: any
  mg_amount?: any
  ag_amount?: any
  currency?: string | null
  region_language_label?: string | null
  term_start?: string | null
  term_end?: string | null
}

const calcLabel = (v?: string | null) =>
  V3_CALC_MODELS.find((m) => m.value === v)?.label || v || "—"
const fmtDate = (v?: string | null) => (v ? String(v).slice(0, 10) : "")
const fmtRange = (a?: string | null, b?: string | null) => {
  const s = fmtDate(a), e = fmtDate(b)
  if (!s && !e) return "期間の定めなし"
  return `${s || "—"} 〜 ${e || "—"}`
}

export function SublicenseConditionPanel() {
  const navigate = useNavigate()

  const [work, setWork] = React.useState<EntityOption | null>(null)
  const workId = work?.id || ""
  const [vendor, setVendor] = React.useState<EntityOption | null>(null)
  const vendorId = vendor?.id || ""

  const [rows, setRows] = React.useState<CondRow[]>([])
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async (wid: string, vid: string) => {
    if (!wid || !vid) { setRows([]); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(wid)}/conditions`)
      const data = await r.json()
      const arr: any[] = Array.isArray(data) ? data : []
      setRows(
        arr
          .filter(
            (c) =>
              c.condition_kind === "sublicense_out" &&
              String(c.counterparty_vendor_id ?? "") === String(vid)
          )
          .map((c) => ({
            id: Number(c.id),
            document_id: c.document_id != null ? Number(c.document_id) : null,
            document_number: c.document_number ?? null,
            parent_license_condition_id:
              c.parent_license_condition_id != null ? Number(c.parent_license_condition_id) : null,
            calc_type: c.calc_type || null,
            condition_name: c.condition_name || null,
            base_price_label: c.base_price_label || null,
            rate_pct: c.rate_pct,
            mg_amount: c.mg_amount,
            ag_amount: c.ag_amount,
            currency: c.currency || "JPY",
            region_language_label: c.region_language_label || null,
            term_start: c.term_start || null,
            term_end: c.term_end || null,
          }))
      )
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load(workId, vendorId)
  }, [workId, vendorId, load])

  // 文書作成フォーム(再許諾条件書)へ、作品・再許諾先を引き継いで遷移。
  const createViaDocument = () => {
    const prefill = {
      template: "sublicense_out_terms",
      formData: {
        ...(workId ? { 対象作品ID: workId, source_work_id: workId, 対象作品名: work?.label || "" } : {}),
        ...(vendorId
          ? { 被許諾者取引先ID: vendorId, counterparty_vendor_id: vendorId, 被許諾者名: vendor?.label || "" }
          : {}),
      },
    }
    try {
      sessionStorage.setItem("lb_material_prefill", JSON.stringify(prefill))
    } catch {
      /* noop */
    }
    navigate("/documents/new?template=sublicense_out_terms&prefill_material=1")
  }

  const openSourceDoc = (docId: number) => {
    navigate(`/documents/new?reopen=${encodeURIComponent(String(docId))}`)
  }

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-6">
      <header className="border-b border-border pb-5">
        <p className="retro-tag mb-1.5">Master · 再許諾（閲覧）</p>
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Coins className="h-6 w-6 text-muted-foreground" /> 再許諾条件 一覧
        </h2>
        <p className="text-[13px] text-muted-foreground mt-1.5">
          再許諾（②権利許諾）／自社製造他社販売（③プロダクトアウト）の条件は、
          <strong>「再許諾条件書」文書作成フォームで作成・修正</strong>します（データの唯一の入力口）。
          本画面は登録済み条件の閲覧用です。
        </p>
        <button
          type="button"
          onClick={createViaDocument}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-mono px-3 py-1.5 rounded-md bg-foreground text-background"
        >
          <FileText className="h-3.5 w-3.5" /> 再許諾条件書を作成（文書フォーム）
        </button>
      </header>

      {/* STEP 1: 作品 */}
      <section className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> 1. 作品（自社作品）を選ぶ
        </div>
        <EntitySearchSelect entity="work" value={work?.id ?? null} onSelect={setWork} placeholder="作品を検索（コード / タイトル）" />
      </section>

      {/* STEP 2: 再許諾先 */}
      {workId && (
        <section className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> 2. 再許諾先を選ぶ
          </div>
          <EntitySearchSelect entity="vendor" value={vendor?.id ?? null} onSelect={setVendor} placeholder="再許諾先（取引先）を検索（名称 / コード）" />
        </section>
      )}

      {/* STEP 3: 条件（閲覧） */}
      {workId && vendorId && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-info" /> 3. 登録済みの再許諾条件
            </div>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          {rows.length === 0 ? (
            <p className="text-[12px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-6 text-center">
              この作品 × 再許諾先の再許諾条件はまだありません。上の「再許諾条件書を作成」から文書フォームで登録してください。
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((c, i) => (
                <div key={c.id} className="rounded-xl border border-border border-t-[3px] border-t-violet-500 bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-info">条件 #{i + 1} (id:{c.id})</span>
                    {c.document_id ? (
                      <button
                        type="button"
                        onClick={() => openSourceDoc(c.document_id!)}
                        className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                      >
                        <ExternalLink className="h-3 w-3" /> 元文書を開く（{c.document_number || `id:${c.document_id}`}）
                      </button>
                    ) : (
                      <span className="ml-auto text-[10px] text-muted-foreground/70">旧・契約無し条件（文書なし）</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[12px] font-mono">
                    <Cell label="計算モデル" value={calcLabel(c.calc_type)} />
                    <Cell label="条件名" value={c.condition_name || "—"} />
                    <Cell label="基準価格" value={c.base_price_label || "—"} />
                    <Cell label="通貨" value={c.currency || "JPY"} />
                    <Cell label="料率(%)" value={c.rate_pct != null ? String(c.rate_pct) : "—"} />
                    <Cell label="MG" value={c.mg_amount != null && Number(c.mg_amount) > 0 ? String(c.mg_amount) : "—"} />
                    <Cell label="AG" value={c.ag_amount != null && Number(c.ag_amount) > 0 ? String(c.ag_amount) : "—"} />
                    <Cell label="親ライセンス" value={c.parent_license_condition_id ? `id:${c.parent_license_condition_id}` : "未リンク"} />
                    <Cell label="許諾地域・言語" value={c.region_language_label || "—"} className="col-span-2" />
                    <Cell label="適用期間" value={fmtRange(c.term_start, c.term_end)} className="col-span-2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md border border-success/40 bg-success/10 dark:bg-success px-3 py-2.5 text-[11px] font-mono leading-relaxed text-success dark:text-success">
            <strong>この条件が再許諾料の源泉です。</strong> 作成・修正は「再許諾条件書」文書フォームで行い、
            再許諾料のライブ計算・受領記録・分配は請求テーブル画面で行います。
          </div>
        </section>
      )}
    </div>
  )
}

const Cell: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className }) => (
  <div className={className}>
    <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
    <div className="text-foreground break-words">{value}</div>
  </div>
)
