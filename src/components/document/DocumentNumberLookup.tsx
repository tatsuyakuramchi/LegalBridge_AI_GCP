/**
 * DocumentNumberLookup — Phase 22.21
 *
 * 文書番号で archived document を検索し、見つかった内容をフォームに反映する小型 widget。
 * 個別利用許諾条件書の「基本契約名」欄に親 license_master を引っ張ってきたり、
 * 検収書の親 PO を手動指定したりする用途に使う汎用部品。
 *
 * GET /api/documents/by-number/<n> を叩いて document_number, template_type,
 * form_data, drive_link, issue_key, created_at を取得。
 *
 * Props:
 *   placeholder: 入力欄プレースホルダ
 *   onApply(payload): 「適用」クリック時のコールバック (見つかった document の正規化 payload)
 *   filterTemplateTypes?: 受け入れるテンプレ種別 (例: ["license_master"])
 */

import * as React from "react"
import { Search, CheckCircle2, AlertTriangle, Loader2, ExternalLink } from "lucide-react"
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
  /** 見出し小ラベル (デフォルト: 「文書番号でアーカイブ検索」) */
  label?: string
  /** 受け入れるテンプレ種別 (例: ["license_master"]) - 未指定なら全テンプレ受け付け */
  filterTemplateTypes?: string[]
  /** 「適用」クリック時に呼ばれる */
  onApply: (doc: LookedUpDocument) => void
  /** 検索開始時の初期値 (例: 既に formData に基本契約番号が入っている場合) */
  initialQuery?: string
  /** disabled */
  disabled?: boolean
}

const deriveTitle = (
  templateType: string,
  fd: Record<string, any>,
  fallback: string
): string => {
  // テンプレ別に最も人間可読な title 候補を組み立てる。
  if (templateType === "license_master") {
    return (
      [fd.VENDOR_NAME, fd.PARTY_A_NAME].filter(Boolean).join(" × ") ||
      fd.CONTRACT_NO ||
      fallback
    )
  }
  if (templateType === "individual_license_terms") {
    return (
      fd.基本契約名 ||
      fd.対象製品予定名 ||
      fd.原著作物名 ||
      fd.Licensor_氏名会社名 ||
      fd.Licensor_名称 ||
      fallback
    )
  }
  if (templateType === "service_master") {
    return (
      [fd.PARTY_A_NAME, fd.VENDOR_NAME].filter(Boolean).join(" × ") ||
      fallback
    )
  }
  if (templateType.startsWith("purchase_order")) {
    return (
      [fd.VENDOR_NAME, fd.PROJECT_TITLE].filter(Boolean).join(" / ") ||
      fallback
    )
  }
  // generic fallback
  return (
    fd.summary || fd.PROJECT_TITLE || fd.VENDOR_NAME || fd.title || fallback
  )
}

export const DocumentNumberLookup: React.FC<Props> = ({
  placeholder = "例: ARC-LIC-2026-0001",
  label = "文書番号でアーカイブ検索",
  filterTemplateTypes,
  onApply,
  initialQuery = "",
  disabled = false,
}) => {
  const [query, setQuery] = React.useState(initialQuery)
  const [searching, setSearching] = React.useState(false)
  const [found, setFound] = React.useState<LookedUpDocument | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const handleSearch = async () => {
    const q = query.trim()
    if (!q) {
      setError("文書番号を入力してください")
      setFound(null)
      return
    }
    setSearching(true)
    setError(null)
    setFound(null)
    try {
      const res = await fetch(
        `/api/documents/by-number/${encodeURIComponent(q)}`
      )
      const data = await res.json()
      if (!res.ok || data?.ok === false) {
        if (res.status === 404) {
          setError(`文書番号 "${q}" は見つかりませんでした`)
        } else {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        return
      }
      // テンプレフィルタチェック
      if (
        filterTemplateTypes &&
        filterTemplateTypes.length > 0 &&
        !filterTemplateTypes.includes(data.template_type)
      ) {
        setError(
          `テンプレ種別 "${data.template_type}" は対象外です ` +
            `(期待: ${filterTemplateTypes.join(", ")})`
        )
        return
      }
      const fd = data.form_data || {}
      const doc: LookedUpDocument = {
        id: Number(data.id),
        document_number: data.document_number,
        base_document_number: data.base_document_number || undefined,
        revision: data.revision != null ? Number(data.revision) : undefined,
        template_type: data.template_type,
        form_data: fd,
        drive_link: data.drive_link || "",
        issue_key: data.issue_key || "",
        created_at: data.created_at,
        derived_title: deriveTitle(data.template_type, fd, data.document_number),
      }
      setFound(doc)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSearching(false)
    }
  }

  const handleApply = () => {
    if (!found) return
    onApply(found)
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
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              handleSearch()
            }
          }}
          placeholder={placeholder}
          disabled={disabled || searching}
          className={cn(
            "flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 px-1",
            "focus:outline-none focus:border-foreground",
            "placeholder:text-muted-foreground/40"
          )}
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={disabled || searching || !query.trim()}
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

      {found && (
        <div className="rounded-sm border border-emerald-200 bg-emerald-50/40 p-2 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 flex-1 min-w-0">
              <CheckCircle2 className="h-3 w-3 text-emerald-700 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-0.5 text-[10px] font-mono">
                <div className="font-bold text-emerald-900 truncate">
                  {found.document_number}
                  {found.revision != null && found.revision > 0 && (
                    <span className="ml-1 text-emerald-700/70">
                      (Rev. {found.revision})
                    </span>
                  )}
                </div>
                <div className="text-emerald-800/80 truncate">
                  {found.derived_title}
                </div>
                <div className="text-emerald-700/60 text-[9px]">
                  種別: {found.template_type}
                  {found.issue_key && ` / ${found.issue_key}`} /{" "}
                  {new Date(found.created_at).toLocaleDateString("ja-JP")}
                </div>
              </div>
            </div>
            {found.drive_link && (
              <a
                href={found.drive_link}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 hover:text-emerald-900 text-[9px] font-mono uppercase tracking-wider flex items-center gap-0.5"
                title="PDF を開く"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                PDF
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={handleApply}
            className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider bg-emerald-600 text-white rounded-sm hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-3 w-3" />
            フォームに適用
          </button>
        </div>
      )}
    </div>
  )
}
