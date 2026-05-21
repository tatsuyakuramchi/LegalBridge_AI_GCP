/**
 * DocumentNumberLookup — Phase 22.21 / Phase 22.21.48 (partial search)
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
}

// Phase 22.21.2: テンプレ種別ごとの「契約類型名」前置ラベル。
const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  license_master: "ライセンス基本契約書",
  service_master: "業務委託基本契約",
  sales_master_buyer: "売買基本契約 (買手)",
  sales_master_credit: "売買基本契約 (信用)",
  sales_master_standard: "売買基本契約",
  individual_license_terms: "個別利用許諾条件書",
  nda: "NDA (機密保持契約)",
  purchase_order: "発注書",
  planning_purchase_order: "企画発注書",
  intl_purchase_order: "国際発注書",
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

export const DocumentNumberLookup: React.FC<Props> = ({
  placeholder = "文書番号 / タイトル / 取引先名 で部分検索 (空欄で最新一覧)",
  label = "アーカイブから検索",
  filterTemplateTypes,
  onApply,
  initialQuery = "",
  disabled = false,
  limit = 20,
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
        const params = new URLSearchParams()
        if (q) params.set("q", q)
        if (filterTemplateTypes && filterTemplateTypes.length > 0) {
          params.set("template_types", filterTemplateTypes.join(","))
        }
        params.set("limit", String(limit))
        const url = `/api/documents/search?${params.toString()}`

        const res = await fetch(url)
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        const rows: any[] = Array.isArray(data?.results) ? data.results : []
        const mapped: LookedUpDocument[] = rows.map((r) => {
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
            derived_title: deriveTitle(r.template_type, fd, r.document_number),
          }
        })
        setResults(mapped)
        setHasSearched(true)
      } catch (e: any) {
        setError(e?.message || String(e))
        setResults([])
        setHasSearched(true)
      } finally {
        setSearching(false)
      }
    },
    [filterTemplateTypes, limit]
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
                : `${results.length} 件 ${
                    query
                      ? `(部分一致: "${query}")`
                      : `(最新${limit}件)`
                  }`}
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
                  key={doc.id}
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
                        <span className="text-foreground truncate">
                          {doc.document_number}
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
                        種別: {doc.template_type}
                        {doc.issue_key && ` / ${doc.issue_key}`} /{" "}
                        {new Date(doc.created_at).toLocaleDateString("ja-JP")}
                      </div>
                    </div>
                    {doc.drive_link && (
                      <a
                        href={doc.drive_link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground text-[9px] font-mono uppercase tracking-wider flex items-center gap-0.5 flex-shrink-0"
                        title="PDF を開く"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        PDF
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
