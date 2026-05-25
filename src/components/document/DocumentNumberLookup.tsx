/**
 * DocumentNumberLookup — Phase 22.21 / Phase 22.21.48 (partial search) /
 *                        Phase 22.21.76 (Master 横断検索)
 *
 * 文書アーカイブを検索してフォームに反映する小型 widget。
 * 個別利用許諾条件書の「基本契約名」欄に親 license_master を引っ張ってきたり、
 * 発注書フォームから親 service_master を選んだりする用途。
 *
 * Phase 22.21.48 で **部分検索 + 一覧選択モード** をデフォルトに変更:
 *   - 旧: 文書番号を完全一致で 1 件取得 (`/api/documents/by-number/<n>`)
 *   - 新: タイトル / 取引先名 / 文書番号 のいずれかを部分一致
 *         (`/api/documents/search?q=&template_types=`)
 *         + 空検索で最新一覧を提示
 *
 * Phase 22.21.76: includeMaster=true で Master (契約マスタ) も並列検索。
 *   /api/documents/search (アーカイブ) と /api/master/contracts (Master)
 *   を並列 fetch して結果をマージ。Master 行は document_url を drive_link に
 *   adapt し、source='master' バッジで区別する。発注書フォームのように
 *   「基本契約はそもそも Master に登録されているだけで PDF アーカイブが
 *   無いケース」をカバーするための拡張。
 *
 * NFKC 正規化で全角/半角の差を吸収するためサーバ側も Phase 22.21.47 で対応済み。
 */

import * as React from "react"
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type LookedUpDocument = {
  id: number
  document_number: string
  base_document_number?: string
  revision?: number
  template_type: string
  form_data: Record<string, any>
  drive_link: string
  issue_key: string
  created_at: string
  // 派生タイトル: form_data から無理やり拾った "それっぽい" 表示用文字列。
  // 個別利用許諾条件書の「基本契約名」等に流し込みやすいよう前処理しておく。
  derived_title: string
  // Phase 22.21.76: 'archive' = /api/documents/search 由来 (PDF アーカイブ),
  //                 'master'  = /api/master/contracts 由来 (Master 契約マスタ)
  source: "archive" | "master"
  // Phase 22.21.76: Master 行のみ。Vendor 名等の補足情報を表示するため保持。
  master_meta?: {
    vendor_name?: string
    contract_status?: string
    contract_category?: string
    contract_type?: string
    record_type?: string
    effective_date?: string
    expiration_date?: string
  }
}

interface Props {
  /** 入力欄のプレースホルダ */
  placeholder?: string
  /** 見出し小ラベル (デフォルト: 「アーカイブから検索」) */
  label?: string
  /** 受け入れるテンプレ種別 (例: ["license_master"]) - 未指定なら全テンプレ受け付け */
  filterTemplateTypes?: string[]
  /** 行クリック (= 適用) 時に呼ばれる */
  onApply: (doc: LookedUpDocument) => void
  /** 検索開始時の初期値 */
  initialQuery?: string
  /** disabled */
  disabled?: boolean
  /** 最大表示件数 (default 20) */
  limit?: number
  /**
   * Phase 22.21.76: true なら /api/master/contracts も並列検索して
   * 結果をマージする。発注書フォームのように「PDF アーカイブが無くても
   * Master 契約番号で参照したい」ケース向け。
   */
  includeMaster?: boolean
}

// Phase 22.21.2: テンプレ種別ごとの「契約類型名」前置ラベル。
// Phase 22.21.82: planning_purchase_order テンプレ削除に伴いラベルから除去
const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  license_master: "ライセンス基本契約書",
  service_master: "業務委託基本契約",
  sales_master_buyer: "売買基本契約 (買手)",
  sales_master_credit: "売買基本契約 (信用)",
  sales_master_standard: "売買基本契約",
  individual_license_terms: "個別利用許諾条件書",
  nda: "NDA (機密保持契約)",
  purchase_order: "発注書",
  intl_purchase_order: "国際発注書",
  inspection_certificate: "検収書",
  royalty_statement: "利用許諾料計算書",
  maintenance_spec: "システム保守仕様書",
  legal_response: "法務回答書", // Phase 22.21.83
}

const deriveTitle = (
  templateType: string,
  fd: Record<string, any>,
  fallback: string
): string => {
  const typeLabel = TEMPLATE_TYPE_LABELS[templateType] || ""
  let parties = ""

  if (templateType === "license_master") {
    parties = [fd.VENDOR_NAME, fd.PARTY_A_NAME].filter(Boolean).join(" × ")
  } else if (templateType === "individual_license_terms") {
    parties =
      fd.基本契約名 ||
      fd.対象製品予定名 ||
      fd.原著作物名 ||
      fd.Licensor_氏名会社名 ||
      fd.Licensor_名称 ||
      ""
  } else if (templateType === "service_master") {
    parties = [fd.PARTY_A_NAME, fd.VENDOR_NAME].filter(Boolean).join(" × ")
  } else if (templateType.startsWith("sales_master")) {
    parties = [fd.PARTY_A_NAME, fd.PARTY_B_NAME].filter(Boolean).join(" × ")
  } else if (templateType.startsWith("purchase_order")) {
    parties = [fd.VENDOR_NAME, fd.PROJECT_TITLE].filter(Boolean).join(" / ")
  } else if (templateType === "nda") {
    parties =
      [fd.PARTY_A_NAME, fd.PARTY_B_NAME].filter(Boolean).join(" × ") ||
      fd.summary ||
      ""
  } else {
    parties = fd.summary || fd.PROJECT_TITLE || fd.VENDOR_NAME || fd.title || ""
  }

  if (typeLabel && parties) return `${typeLabel} - ${parties}`
  if (typeLabel) return typeLabel
  if (parties) return parties
  return fallback
}

// Phase 22.21.76: filterTemplateTypes (= template_type 配列) を
//   Master 側の contract_category にマップするためのヘルパー。
//   Master の record_type は master_contract / individual_contract /
//   standalone_contract / license_condition の 4 種で、template_type
//   とは直接対応しない。category だけ大雑把に絞り込んで残りはテキスト
//   一致で拾わせる。
// Phase 22.21.82: planning_purchase_order テンプレ削除に伴いマップから除去
const TEMPLATE_TYPE_TO_MASTER_CATEGORY: Record<string, string> = {
  license_master: "license",
  individual_license_terms: "license",
  service_master: "service",
  sales_master_buyer: "service",
  sales_master_credit: "service",
  sales_master_standard: "service",
  purchase_order: "service",
  intl_purchase_order: "service",
}

const filterTypesToMasterCategories = (
  types: string[] | undefined
): Set<string> | null => {
  if (!types || types.length === 0) return null
  const cats = new Set<string>()
  for (const t of types) {
    const c = TEMPLATE_TYPE_TO_MASTER_CATEGORY[t]
    if (c) cats.add(c)
  }
  return cats.size > 0 ? cats : null
}

// Phase 22.21.76: NFKC 正規化 + 小文字化で全角/半角・大文字小文字を吸収。
//   サーバ側 (worker) は既に Phase 22.21.47 で対応済みだが Master は
//   クライアント側でフィルタするので同等の正規化を行う。
const normalize = (s: any): string =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()

// Phase 22.21.76: Master 行 (contract_capabilities の 1 レコード) を
//   LookedUpDocument シェイプに正規化する。document_url → drive_link,
//   contract_title → derived_title (vendor_name 併記)。
const masterRowToLookup = (r: any): LookedUpDocument => {
  const vendor = r.vendor_name || ""
  const title = r.contract_title || ""
  const derived = vendor && title ? `${vendor} / ${title}` : title || vendor || r.document_number || ""
  return {
    id: Number(r.id),
    document_number: r.document_number || "",
    base_document_number: undefined,
    revision: undefined,
    template_type: `master:${r.contract_category || "unknown"}_${r.record_type || "unknown"}`,
    form_data: {},
    drive_link: r.document_url || "",
    issue_key: "",
    created_at: r.updated_at || r.created_at || new Date().toISOString(),
    derived_title: derived,
    source: "master",
    master_meta: {
      vendor_name: vendor,
      contract_status: r.contract_status,
      contract_category: r.contract_category,
      contract_type: r.contract_type,
      record_type: r.record_type,
      effective_date: r.effective_date,
      expiration_date: r.expiration_date,
    },
  }
}

export const DocumentNumberLookup: React.FC<Props> = ({
  placeholder = "文書番号 / タイトル / 取引先名 で部分検索 (空欄で最新一覧)",
  label = "アーカイブから検索",
  filterTemplateTypes,
  onApply,
  initialQuery = "",
  disabled = false,
  limit = 20,
  includeMaster = false,
}) => {
  const [query, setQuery] = React.useState(initialQuery)
  const [searching, setSearching] = React.useState(false)
  const [results, setResults] = React.useState<LookedUpDocument[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [hasSearched, setHasSearched] = React.useState(false)

  // Debounce 用 timer ref
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = React.useCallback(
    async (q: string) => {
      setSearching(true)
      setError(null)
      try {
        // 1) Archive 検索 (worker /api/documents/search)
        const params = new URLSearchParams()
        if (q) params.set("q", q)
        if (filterTemplateTypes && filterTemplateTypes.length > 0) {
          params.set("template_types", filterTemplateTypes.join(","))
        }
        params.set("limit", String(limit))
        const archiveUrl = `/api/documents/search?${params.toString()}`

        // 2) Master 検索 (search-api /api/master/contracts)
        //    includeMaster=true のときだけ。Master 側は GET 全件返却なので
        //    クライアント側でテキスト + category フィルタする。
        const archivePromise = fetch(archiveUrl)
          .then((r) => r.json().catch(() => ({})))
          .then((data) => {
            if (data?.ok === false)
              throw new Error(data?.error || "archive search failed")
            const rows: any[] = Array.isArray(data?.results) ? data.results : []
            return rows.map<LookedUpDocument>((r) => {
              const fd = r.form_data || {}
              return {
                id: Number(r.id),
                document_number: r.document_number,
                base_document_number: r.base_document_number || undefined,
                revision: r.revision != null ? Number(r.revision) : undefined,
                template_type: r.template_type,
                form_data: fd,
                drive_link: r.drive_link || "",
                issue_key: r.issue_key || "",
                created_at: r.created_at,
                derived_title: deriveTitle(
                  r.template_type,
                  fd,
                  r.document_number
                ),
                source: "archive",
              }
            })
          })

        const masterPromise: Promise<LookedUpDocument[]> = includeMaster
          ? fetch("/api/master/contracts")
              .then((r) => r.json().catch(() => []))
              .then((rows: any) => {
                if (!Array.isArray(rows)) return []
                const wantedCats = filterTypesToMasterCategories(
                  filterTemplateTypes
                )
                const nq = normalize(q)
                const filtered = rows.filter((row: any) => {
                  // is_active = false の Master は除外 (使われていない契約)
                  if (row.is_active === false) return false
                  // category 絞り込み (filterTemplateTypes が指定されている時のみ)
                  if (
                    wantedCats &&
                    row.contract_category &&
                    !wantedCats.has(String(row.contract_category))
                  ) {
                    return false
                  }
                  // テキスト一致 (q が空なら全件通す)
                  if (!nq) return true
                  const hay = [
                    row.document_number,
                    row.contract_title,
                    row.vendor_name,
                    row.original_work,
                    row.product_name,
                    row.work_name,
                  ]
                    .map(normalize)
                    .join(" ")
                  return hay.includes(nq)
                })
                return filtered.slice(0, limit).map(masterRowToLookup)
              })
              .catch((e: any) => {
                console.warn("[DocumentNumberLookup] master fetch failed:", e)
                return []
              })
          : Promise.resolve<LookedUpDocument[]>([])

        const [archiveResults, masterResults] = await Promise.all([
          archivePromise,
          masterPromise,
        ])

        // Master を上に表示 (基本契約候補としては Master の方が信頼度が高い)。
        // 同じ document_number が両方に存在する場合は Master 側を優先 (重複除去)。
        const seenDocNums = new Set<string>()
        const merged: LookedUpDocument[] = []
        for (const d of masterResults) {
          if (d.document_number) seenDocNums.add(d.document_number)
          merged.push(d)
        }
        for (const d of archiveResults) {
          if (d.document_number && seenDocNums.has(d.document_number)) continue
          merged.push(d)
        }
        setResults(merged)
        setHasSearched(true)
      } catch (e: any) {
        setError(e?.message || String(e))
        setResults([])
        setHasSearched(true)
      } finally {
        setSearching(false)
      }
    },
    [filterTemplateTypes, limit, includeMaster]
  )

  // 初回マウントで一度走らせる (initialQuery 有無に関わらず一覧を出す)。
  // Phase 22.21.48: 空欄でも「最新 N 件」を見せたい要件への対応。
  React.useEffect(() => {
    runSearch(initialQuery.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 入力時の debounce 検索。
  const handleChange = (v: string) => {
    setQuery(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      runSearch(v.trim())
    }, 300)
  }

  const handleManualSearch = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    runSearch(query.trim())
  }

  const handleClear = () => {
    setQuery("")
    if (timerRef.current) clearTimeout(timerRef.current)
    runSearch("")
  }

  return (
    <div className="space-y-1.5 rounded-sm border border-input bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5">
        <Search className="w-3 h-3 text-muted-foreground" />
        <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              handleManualSearch()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 px-1",
            "focus:outline-none focus:border-foreground",
            "placeholder:text-muted-foreground/40"
          )}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled || searching}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider",
              "border border-input rounded-sm hover:bg-muted text-muted-foreground",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="絞り込みをクリア"
          >
            <X className="h-3 w-3" />
            クリア
          </button>
        )}
        <button
          type="button"
          onClick={handleManualSearch}
          disabled={disabled || searching}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider",
            "border border-foreground/40 rounded-sm hover:bg-muted",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {searching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Search className="h-3 w-3" />
          )}
          検索
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-sm bg-destructive/10 border border-destructive/30 text-destructive text-[10px] font-mono">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 検索結果リスト。空 q でも一覧を見せる。
          スクロール可能な固定高さで、長い候補もはみ出さないように。 */}
      {hasSearched && !error && (
        <>
          <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-muted-foreground px-1">
            <span>
              {results.length === 0
                ? "該当なし"
                : (() => {
                    // Phase 22.21.76: source 内訳を表示
                    const ma = results.filter((d) => d.source === "master").length
                    const ar = results.length - ma
                    const breakdown = includeMaster
                      ? ` [Master ${ma} / Archive ${ar}]`
                      : ""
                    return `${results.length} 件${breakdown} ${
                      query
                        ? `(部分一致: "${query}")`
                        : `(最新${limit}件)`
                    }`
                  })()}
            </span>
            {searching && (
              <span className="flex items-center gap-1 text-foreground/60">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                検索中
              </span>
            )}
          </div>
          {results.length > 0 && (
            <div className="max-h-[260px] overflow-y-auto rounded-sm border border-input bg-background divide-y divide-input">
              {results.map((doc) => (
                <button
                  key={`${doc.source}:${doc.id}`}
                  type="button"
                  onClick={() => onApply(doc)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 hover:bg-emerald-50/60 transition-colors",
                    "group focus:outline-none focus:bg-emerald-50/60"
                  )}
                  title="クリックでフォームに適用"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold">
                        <CheckCircle2 className="h-3 w-3 text-emerald-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                        {/* Phase 22.21.76: source バッジ。Master 行は青、
                            Archive 行はグレーで一目で区別できるように。 */}
                        <span
                          className={cn(
                            "text-[8px] font-mono px-1 py-px rounded uppercase tracking-wider border",
                            doc.source === "master"
                              ? "bg-sky-50 border-sky-300 text-sky-800"
                              : "bg-muted/60 border-input text-muted-foreground"
                          )}
                          title={
                            doc.source === "master"
                              ? "契約マスタ (Master) 由来"
                              : "PDF アーカイブ (Archive) 由来"
                          }
                        >
                          {doc.source === "master" ? "Master" : "Archive"}
                        </span>
                        <span className="text-foreground truncate">
                          {doc.document_number || "(番号未設定)"}
                        </span>
                        {doc.revision != null && doc.revision > 0 && (
                          <span className="text-muted-foreground/70 text-[9px]">
                            (Rev. {doc.revision})
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-foreground/80 truncate pl-4">
                        {doc.derived_title}
                      </div>
                      <div className="text-[9px] font-mono text-muted-foreground pl-4 truncate">
                        {doc.source === "master" ? (
                          <>
                            {doc.master_meta?.contract_category &&
                              `${doc.master_meta.contract_category}`}
                            {doc.master_meta?.record_type &&
                              ` / ${doc.master_meta.record_type}`}
                            {doc.master_meta?.contract_status &&
                              ` / ${doc.master_meta.contract_status}`}
                            {doc.master_meta?.effective_date &&
                              ` / ${doc.master_meta.effective_date}`}
                            {doc.master_meta?.expiration_date &&
                              `–${doc.master_meta.expiration_date}`}
                          </>
                        ) : (
                          <>
                            種別: {doc.template_type}
                            {doc.issue_key && ` / ${doc.issue_key}`} /{" "}
                            {new Date(doc.created_at).toLocaleDateString("ja-JP")}
                          </>
                        )}
                      </div>
                    </div>
                    {doc.drive_link && (
                      <a
                        href={doc.drive_link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground text-[9px] font-mono uppercase tracking-wider flex items-center gap-0.5 flex-shrink-0"
                        title={
                          doc.source === "master"
                            ? "Master 登録のリンクを開く"
                            : "PDF を開く"
                        }
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        {doc.source === "master" ? "Link" : "PDF"}
                      </a>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
