/**
 * PendingPdfPanel — Phase 15: 一括インポートで「未作成」マーク付きの
 * ドキュメントを 1 件ずつ確認 / 生成 / スキップする UI。
 *
 * 動作:
 *   1. GET /api/documents/pending-pdf で一覧取得
 *   2. テンプレタイプ別タブ切替
 *   3. 各行に [📄 PDF 生成] / [✏️ 編集して生成] / [🚫 スキップ] ボタン
 *   4. 📄 → POST /api/documents/:id/regenerate-pdf → drive_link を返す → 行を一覧から消す
 *   5. ✏️ → /documents/new?from_pending=:id に遷移 (DocumentEditorPage 側で受領)
 *   6. 🚫 → POST /api/documents/:id/mark-as-imported → 行を消す
 */

import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  RefreshCw,
  FileText,
  ExternalLink,
  CheckCircle2,
  Edit3,
  X,
  AlertTriangle,
  Loader2,
  PackageOpen,
  Link2,
  Pencil,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Row = {
  id: number
  document_number: string
  issue_key: string
  template_type: string
  document_category: string
  created_at: string
  summary: {
    counterparty: string
    title: string
    staff_email: string
    line_count: number | null
    condition_count: number | null
    variant: string | null
    amount: number | null
  }
}

type ApiResponse = {
  ok: boolean
  total: number
  rows: Row[]
  counts_by_template: Record<string, number>
}

const TEMPLATE_LABELS: Record<string, string> = {
  purchase_order: "発注書",
  individual_license_terms: "個別利用許諾条件書",
  license_master: "ライセンス基本契約書",
  service_master: "業務委託基本契約書",
  nda: "NDA",
  sales_master_buyer: "売買基本(買主)",
  sales_master_standard: "売買基本(標準)",
  sales_master_credit: "売買基本(掛売)",
}

export const PendingPdfPanel: React.FC = () => {
  const navigate = useNavigate()
  const [data, setData] = React.useState<ApiResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedTpl, setSelectedTpl] = React.useState<string>("ALL")
  // 行 ID → 'generating' | 'skipping' (進捗トラッキング)
  const [busyRows, setBusyRows] = React.useState<Record<number, string>>({})
  // Phase 16: 行ごとの直近 PDF 生成エラーを永続表示 (トーストでは見逃すため)
  const [rowErrors, setRowErrors] = React.useState<Record<number, string>>({})
  // Phase 23: 一括 PDF 生成 — チェックした行の drive_link をまとめて作る。
  //   選択行を逐次 (sequential) で regenerate-pdf に流す。
  //   並列だと Drive 連携 / Backlog のレート制限に当たりやすいので 1 件ずつ。
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [bulkRunning, setBulkRunning] = React.useState(false)
  const [bulkProgress, setBulkProgress] = React.useState<{
    done: number
    total: number
    okCount: number
    failCount: number
  } | null>(null)
  // Phase 23: 発注書統合 — 選択した発注書を1枚(複数明細)にまとめる。
  const [mergeOpen, setMergeOpen] = React.useState(false)
  const [mergeTargetId, setMergeTargetId] = React.useState<number | null>(null)
  const [merging, setMerging] = React.useState(false)
  // Phase 23: 一括修正(発注日 / 担当者 / 支払日 / 備考追記)
  const [bulkEditOpen, setBulkEditOpen] = React.useState(false)
  const [savingEdit, setSavingEdit] = React.useState(false)
  const [staffOptions, setStaffOptions] = React.useState<
    Array<{ email: string; staff_name: string; department?: string }>
  >([])
  const [editOrderDate, setEditOrderDate] = React.useState("")
  const [editStaffEmail, setEditStaffEmail] = React.useState("")
  const [editPaymentDate, setEditPaymentDate] = React.useState("")
  const [editRemarks, setEditRemarks] = React.useState("")
  // 担当者 検索コンボボックス
  const [staffSearch, setStaffSearch] = React.useState("")
  const [staffDropdownOpen, setStaffDropdownOpen] = React.useState(false)
  const filteredStaff = React.useMemo(() => {
    const q = staffSearch.trim().toLowerCase()
    const base = q
      ? staffOptions.filter(
          (s) =>
            s.staff_name.toLowerCase().includes(q) ||
            s.email.toLowerCase().includes(q) ||
            (s.department || "").toLowerCase().includes(q)
        )
      : staffOptions
    return base.slice(0, 50)
  }, [staffOptions, staffSearch])
  const [lastResult, setLastResult] = React.useState<{
    id: number
    document_number: string
    drive_link?: string
    // Phase 22.21.33: 一括完了 アクションを追加
    action: "generated" | "skipped" | "completed"
    delivery_child_issue_key?: string | null
    warnings?: Array<{ step: string; error: string }>
  } | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/documents/pending-pdf?limit=200")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ApiResponse = await res.json()
      setData(json)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const generatePdf = async (row: Row) => {
    setBusyRows((b) => ({ ...b, [row.id]: "generating" }))
    // Phase 16: 前回エラーをクリア
    setRowErrors((e) => {
      const copy = { ...e }
      delete copy[row.id]
      return copy
    })
    try {
      const res = await fetch(`/api/documents/${row.id}/regenerate-pdf`, {
        method: "POST",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setLastResult({
        id: row.id,
        document_number: json.document_number,
        drive_link: json.drive_link,
        action: "generated",
      })
      // 一覧から除外
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.filter((r) => r.id !== row.id),
              total: d.total - 1,
            }
          : d
      )
    } catch (e: any) {
      // Phase 16: 行内に永続表示 (トーストではなく、状況がわかる位置に固定)
      setRowErrors((prev) => ({
        ...prev,
        [row.id]: String(e?.message || e),
      }))
    } finally {
      setBusyRows((b) => {
        const copy = { ...b }
        delete copy[row.id]
        return copy
      })
    }
  }

  // Phase 22.21.33: 「📦 一括完了」アクション
  //   PDF 生成 + Backlog 完了化 + 納品・検収 子課題作成 を 1 ボタンで実行。
  //   発注書系の確認済データを一気に運用フローへ流す用途。
  const regenerateAndComplete = async (row: Row) => {
    if (
      !window.confirm(
        `${row.document_number} を PDF 生成 + Backlog 完了 + 納品・検収 子課題作成 まで一括実行します。よろしいですか?`
      )
    )
      return
    setBusyRows((b) => ({ ...b, [row.id]: "completing" }))
    setRowErrors((e) => {
      const copy = { ...e }
      delete copy[row.id]
      return copy
    })
    try {
      const res = await fetch(
        `/api/documents/${row.id}/regenerate-and-complete`,
        { method: "POST" }
      )
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setLastResult({
        id: row.id,
        document_number: json.document_number,
        drive_link: json.drive_link,
        action: "completed",
        delivery_child_issue_key: json.delivery_child_issue_key || null,
        warnings: Array.isArray(json.warnings) ? json.warnings : [],
      })
      // 一覧から除外
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.filter((r) => r.id !== row.id),
              total: d.total - 1,
            }
          : d
      )
    } catch (e: any) {
      setRowErrors((prev) => ({
        ...prev,
        [row.id]: String(e?.message || e),
      }))
    } finally {
      setBusyRows((b) => {
        const copy = { ...b }
        delete copy[row.id]
        return copy
      })
    }
  }

  const skipRow = async (row: Row) => {
    if (!window.confirm(`${row.document_number} を作成済扱いにしてキューから外しますか?`)) return
    setBusyRows((b) => ({ ...b, [row.id]: "skipping" }))
    try {
      const res = await fetch(`/api/documents/${row.id}/mark-as-imported`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLastResult({
        id: row.id,
        document_number: row.document_number,
        action: "skipped",
      })
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.filter((r) => r.id !== row.id),
              total: d.total - 1,
            }
          : d
      )
    } catch (e: any) {
      setError(`スキップ失敗 (${row.document_number}): ${e?.message || e}`)
    } finally {
      setBusyRows((b) => {
        const copy = { ...b }
        delete copy[row.id]
        return copy
      })
    }
  }

  const editAndGenerate = (row: Row) => {
    // DocumentEditorPage に from_pending=<id> 付きで遷移。
    // 編集ページ側でこの ID を見て documents から form_data を読み込んで pre-fill する。
    navigate(`/documents/new?from_pending=${row.id}`)
  }

  const filteredRows = React.useMemo(() => {
    if (!data) return []
    if (selectedTpl === "ALL") return data.rows
    return data.rows.filter((r) => r.template_type === selectedTpl)
  }, [data, selectedTpl])

  // Phase 23: 選択トグル
  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 表示中 (タブで絞り込んだ) 行をまとめて選択 / 解除
  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id))
  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filteredRows.forEach((r) => next.delete(r.id))
      } else {
        filteredRows.forEach((r) => next.add(r.id))
      }
      return next
    })
  }

  // Phase 23: 選択をまとめて発行 — 1 件ずつ regenerate-pdf を呼ぶ。
  //   成功した行は一覧から消し、失敗した行は rowErrors に残して選択も維持する
  //   (あとで「修正して再試行」できるように)。
  const bulkGenerate = async () => {
    const targets = filteredRows.filter((r) => selected.has(r.id))
    if (targets.length === 0) return
    if (
      !window.confirm(
        `選択した ${targets.length} 件の PDF をまとめて生成します。\n` +
          `1 件ずつ Drive に出力するため、件数によっては数分かかります。よろしいですか?`
      )
    )
      return
    setBulkRunning(true)
    setBulkProgress({ done: 0, total: targets.length, okCount: 0, failCount: 0 })
    setError(null)
    let okCount = 0
    let failCount = 0
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i]
      setBusyRows((b) => ({ ...b, [row.id]: "generating" }))
      setRowErrors((e) => {
        const copy = { ...e }
        delete copy[row.id]
        return copy
      })
      try {
        const res = await fetch(`/api/documents/${row.id}/regenerate-pdf`, {
          method: "POST",
        })
        const json = await res.json()
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        okCount++
        // 成功 → 一覧 / 選択から除外
        setData((d) =>
          d
            ? {
                ...d,
                rows: d.rows.filter((r) => r.id !== row.id),
                total: d.total - 1,
              }
            : d
        )
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(row.id)
          return next
        })
      } catch (e: any) {
        failCount++
        setRowErrors((prev) => ({
          ...prev,
          [row.id]: String(e?.message || e),
        }))
      } finally {
        setBusyRows((b) => {
          const copy = { ...b }
          delete copy[row.id]
          return copy
        })
        setBulkProgress({
          done: i + 1,
          total: targets.length,
          okCount,
          failCount,
        })
      }
    }
    setBulkRunning(false)
    setLastResult({
      id: -1,
      document_number: `一括生成: 成功 ${okCount} 件 / 失敗 ${failCount} 件`,
      action: "generated",
    })
  }

  // Phase 23: 統合対象として選択されている行(タブをまたいで data.rows から拾う)
  const selectedRowObjs = React.useMemo(
    () => (data ? data.rows.filter((r) => selected.has(r.id)) : []),
    [data, selected]
  )

  // 統合できない理由(空文字なら統合可)
  const mergeDisabledReason = React.useMemo(() => {
    if (selectedRowObjs.length < 2) return "2件以上の発注書を選択してください"
    if (!selectedRowObjs.every((r) => r.template_type === "purchase_order"))
      return "発注書(purchase_order)のみ統合できます"
    const vendors = new Set(
      selectedRowObjs.map((r) => (r.summary.counterparty || "").trim())
    )
    if (vendors.size !== 1 || (selectedRowObjs[0].summary.counterparty || "").trim() === "")
      return "同じ取引先の発注書のみ統合できます"
    return ""
  }, [selectedRowObjs])
  const mergeEligible = mergeDisabledReason === ""

  const openMerge = () => {
    if (!mergeEligible) return
    setMergeTargetId(selectedRowObjs[0].id)
    setMergeOpen(true)
  }

  const runMerge = async () => {
    const target = selectedRowObjs.find((r) => r.id === mergeTargetId)
    if (!target) return
    const sourceRows = selectedRowObjs.filter((r) => r.id !== target.id)
    if (sourceRows.length === 0) return
    setMerging(true)
    setError(null)
    try {
      const res = await fetch("/api/imports/v2/merge-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_document_number: target.document_number,
          source_document_numbers: sourceRows.map((r) => r.document_number),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      // 統合元の行を一覧から除外し、選択をクリア
      const sourceIds = new Set(sourceRows.map((r) => r.id))
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.filter((r) => !sourceIds.has(r.id)),
              total: d.total - sourceIds.size,
            }
          : d
      )
      setSelected(new Set())
      setMergeOpen(false)
      setLastResult({
        id: target.id,
        document_number: `${target.document_number} に ${json.merged_count} 件を統合 (明細 ${json.line_item_count} 行 / 税抜 ¥${Number(
          json.amount_ex_tax || 0
        ).toLocaleString("ja-JP")})`,
        action: "completed",
      })
      // target の明細数サマリを最新化
      refresh()
    } catch (e: any) {
      setError(`統合失敗: ${e?.message || e}`)
    } finally {
      setMerging(false)
    }
  }

  // Phase 23: 担当者プルダウン用にスタッフ一覧を取得
  React.useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch("/api/master/staff")
        if (!res.ok) return
        const rows = await res.json()
        if (Array.isArray(rows)) {
          setStaffOptions(
            rows
              .filter((r: any) => r?.email)
              .map((r: any) => ({
                email: r.email,
                staff_name: r.staff_name || r.email,
                department: r.department || "",
              }))
          )
        }
      } catch {
        /* 取得失敗時は手入力にフォールバック */
      }
    })()
  }, [])

  const openBulkEdit = () => {
    if (selectedRowObjs.length === 0) return
    setEditOrderDate("")
    setEditStaffEmail("")
    setEditPaymentDate("")
    setEditRemarks("")
    setStaffSearch("")
    setStaffDropdownOpen(false)
    setBulkEditOpen(true)
  }

  const runBulkEdit = async () => {
    if (selectedRowObjs.length === 0) return
    const set: Record<string, string> = {}
    if (editOrderDate) set["発注日"] = editOrderDate
    if (editStaffEmail) set.staff_email = editStaffEmail
    if (editPaymentDate) set.payment_date = editPaymentDate
    const remarks = editRemarks.trim()
    if (Object.keys(set).length === 0 && !remarks) {
      setError("更新する項目を1つ以上入力してください。")
      return
    }
    setSavingEdit(true)
    setError(null)
    try {
      const res = await fetch("/api/documents/bulk-update-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedRowObjs.map((r) => r.id),
          set,
          remarks_append: remarks,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setBulkEditOpen(false)
      setLastResult({
        id: -1,
        document_number: `一括修正: ${json.updated} 件を更新`,
        action: "completed",
      })
      refresh()
    } catch (e: any) {
      setError(`一括修正失敗: ${e?.message || e}`)
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            PDF 未作成キュー
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            CSV 一括インポートで「未作成」マーク付きで登録された文書を、
            内容を確認しながら 1 件ずつ PDF 化します。
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 flex items-center gap-1.5 hover:bg-muted",
            loading && "opacity-50 cursor-not-allowed"
          )}
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          リロード
        </button>
      </div>

      {/* 直近結果 */}
      {lastResult && (
        <div
          className={cn(
            "border rounded-sm px-4 py-2 text-[11px] font-mono flex flex-col gap-2",
            lastResult.action === "generated"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : lastResult.action === "completed"
                ? "bg-emerald-100 border-emerald-300 text-emerald-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {lastResult.action === "generated"
                ? `✓ PDF 生成完了: ${lastResult.document_number}`
                : lastResult.action === "completed"
                  ? `📦 一括完了: ${lastResult.document_number}`
                  : `✓ スキップ済: ${lastResult.document_number}`}
              {lastResult.action === "completed" &&
                lastResult.delivery_child_issue_key && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-white/60 border border-emerald-300 rounded-sm">
                    → 納品・検収 {lastResult.delivery_child_issue_key}
                  </span>
                )}
            </div>
            {lastResult.drive_link && (
              <a
                href={lastResult.drive_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 underline"
              >
                <ExternalLink className="w-3 h-3" />
                Drive で開く
              </a>
            )}
          </div>
          {/* Phase 22.21.33: 一括完了 で部分失敗 (PDF は OK だが Backlog or auto-chain 失敗) */}
          {Array.isArray(lastResult.warnings) &&
            lastResult.warnings.length > 0 && (
              <div className="border-t border-current/20 pt-1.5 text-[10px] space-y-0.5">
                <div className="font-bold opacity-80">
                  ⚠ 警告 (PDF 自体は成功):
                </div>
                {lastResult.warnings.map((w, i) => (
                  <div key={i} className="opacity-80">
                    <span className="font-bold">[{w.step}]</span> {w.error}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-900 rounded-sm px-4 py-2 text-[11px] font-mono flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* テンプレ別タブ */}
      {data && Object.keys(data.counts_by_template).length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border pb-2">
          <TabButton
            label="すべて"
            count={data.total}
            active={selectedTpl === "ALL"}
            onClick={() => setSelectedTpl("ALL")}
          />
          {Object.entries(data.counts_by_template).map(([tpl, n]) => (
            <TabButton
              key={tpl}
              label={TEMPLATE_LABELS[tpl] || tpl}
              count={n}
              active={selectedTpl === tpl}
              onClick={() => setSelectedTpl(tpl)}
            />
          ))}
        </div>
      )}

      {/* Phase 23: 一括発行ツールバー */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap border border-border rounded-sm bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-[10px] font-mono cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                disabled={bulkRunning}
                className="w-3.5 h-3.5"
              />
              表示中をすべて選択
            </label>
            <span className="text-[10px] font-mono text-muted-foreground">
              選択 {selected.size} 件
            </span>
            {selected.size > 0 && !bulkRunning && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[10px] font-mono text-muted-foreground underline hover:text-foreground"
              >
                選択解除
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {bulkProgress && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {bulkRunning ? "生成中… " : "完了 "}
                {bulkProgress.done}/{bulkProgress.total}
                <span className="text-emerald-700"> ✓{bulkProgress.okCount}</span>
                {bulkProgress.failCount > 0 && (
                  <span className="text-red-700"> ✗{bulkProgress.failCount}</span>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={openBulkEdit}
              disabled={bulkRunning || merging || selected.size === 0}
              className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="選択した文書の 発注日 / 担当者 / 支払日 を一括修正し、備考を一律追記します"
            >
              <Pencil className="w-3 h-3" />
              ✏️ 選択を一括修正
            </button>
            <button
              type="button"
              onClick={openMerge}
              disabled={bulkRunning || merging || !mergeEligible}
              className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                mergeEligible
                  ? "選択した同一取引先の発注書を1枚(複数明細)に統合します"
                  : mergeDisabledReason
              }
            >
              <Link2 className="w-3 h-3" />
              🔗 選択を1枚に統合
            </button>
            <button
              type="button"
              onClick={bulkGenerate}
              disabled={bulkRunning || selected.size === 0}
              className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-3 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="チェックした文書の PDF を 1 件ずつまとめて生成 (Backlog ステータスは触りません)"
            >
              {bulkRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FileText className="w-3 h-3" />
              )}
              📄 選択をまとめて発行
            </button>
          </div>
        </div>
      )}

      {/* 一覧 */}
      {!data || data.total === 0 ? (
        <div className="text-center py-12 border border-dashed border-input rounded-sm bg-muted/10">
          <PackageOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-[12px] font-mono text-muted-foreground">
            PDF 未作成のドキュメントはありません。
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            CSV インポートで <code>generate_pdf=未作成</code> を指定すると、
            ここに表示されます。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRows.map((row) => {
            const busy = busyRows[row.id]
            const rowError = rowErrors[row.id]
            return (
              <div
                key={row.id}
                className={cn(
                  "border rounded-sm bg-card p-4",
                  rowError
                    ? "border-red-300 bg-red-50/40"
                    : "border-border",
                  busy && "opacity-60"
                )}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    disabled={bulkRunning}
                    className="w-3.5 h-3.5 flex-shrink-0"
                    title="一括発行の対象に含める"
                  />
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-muted rounded-sm uppercase tracking-wider">
                        {TEMPLATE_LABELS[row.template_type] || row.template_type}
                      </span>
                      <span className="text-[11px] font-mono font-bold">
                        {row.document_number}
                      </span>
                      {row.summary.variant && (
                        <span className="text-[11px] font-mono px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-sm">
                          {row.summary.variant}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-foreground truncate">
                      {row.summary.title || "(タイトル未設定)"}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      {row.summary.counterparty && (
                        <span>取引先: {row.summary.counterparty}</span>
                      )}
                      {row.summary.line_count != null && (
                        <span>明細 {row.summary.line_count} 行</span>
                      )}
                      {row.summary.condition_count != null && (
                        <span>金銭条件 {row.summary.condition_count} 件</span>
                      )}
                      {row.summary.amount && (
                        <span>
                          税抜 ¥
                          {Number(row.summary.amount).toLocaleString("ja-JP")}
                        </span>
                      )}
                      {row.summary.staff_email && (
                        <span>担当: {row.summary.staff_email}</span>
                      )}
                    </div>
                  </div>

                  {/* アクション */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => editAndGenerate(row)}
                      disabled={!!busy}
                      className={cn(
                        "text-[10px] font-mono uppercase tracking-wider rounded-sm px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-50",
                        rowError
                          ? "bg-red-600 text-white hover:bg-red-700"
                          : "border border-foreground/30 hover:bg-muted"
                      )}
                      title={
                        rowError
                          ? "エラーの原因項目を編集して再試行"
                          : "DocumentEditorPage を開いて編集してから PDF 生成"
                      }
                    >
                      <Edit3 className="w-3 h-3" />
                      {rowError ? "修正して再試行" : "編集して生成"}
                    </button>
                    <button
                      type="button"
                      onClick={() => generatePdf(row)}
                      disabled={!!busy}
                      className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-3 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50"
                      title="PDF だけ作る (Backlog ステータスは触らない)"
                    >
                      {busy === "generating" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <FileText className="w-3 h-3" />
                      )}
                      {rowError ? "そのまま再試行" : "📄 PDF 生成"}
                    </button>
                    {/* Phase 22.21.33: 📦 一括完了 — PDF + Backlog 完了 + 納品子課題作成 */}
                    <button
                      type="button"
                      onClick={() => regenerateAndComplete(row)}
                      disabled={!!busy}
                      className="text-[10px] font-mono uppercase tracking-wider bg-emerald-600 text-white rounded-sm px-3 py-1.5 hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-50"
                      title="PDF 生成 + Backlog ステータスを 完了 に進めて納品・検収 子課題を自動作成"
                    >
                      {busy === "completing" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                      📦 一括完了
                    </button>
                    <button
                      type="button"
                      onClick={() => skipRow(row)}
                      disabled={!!busy}
                      className="text-[10px] font-mono uppercase tracking-wider border border-muted-foreground/30 text-muted-foreground rounded-sm px-2.5 py-1.5 hover:bg-muted flex items-center gap-1.5 disabled:opacity-50"
                      title="このドキュメントを「作成済」扱いにしてキューから外す"
                    >
                      <X className="w-3 h-3" />
                      スキップ
                    </button>
                  </div>
                </div>

                {/* Phase 16: 失敗時のエラー詳細を行内に永続表示 */}
                {rowError && (
                  <div className="mt-3 border border-red-200 bg-red-50 rounded-sm px-3 py-2 flex items-start gap-2 text-[10px] font-mono text-red-800">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="font-bold uppercase tracking-wider text-red-700">
                        PDF 生成失敗
                      </div>
                      <div className="break-all">{rowError}</div>
                      <div className="text-[11px] text-red-600/80 mt-1">
                        ✏️ 「修正して再試行」で項目を直してから再生成、または
                        「そのまま再試行」で時刻差で再実行できます。
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Phase 23: 一括修正モーダル (発注日 / 担当者 / 支払日 / 備考追記) */}
      {bulkEditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => !savingEdit && setBulkEditOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-sm shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-muted/30 border-b border-border px-5 py-3 flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              <span className="text-[11px] font-mono uppercase tracking-wider font-bold">
                選択 {selectedRowObjs.length} 件を一括修正
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                空欄の項目は変更しません。納品後に遡って発行する場合などに、
                発注日・担当者・支払日をまとめて修正し、遡及理由を備考(自由備考)へ
                一律で追記できます。
              </p>

              <label className="block space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  発注日
                </span>
                <input
                  type="date"
                  value={editOrderDate}
                  onChange={(e) => setEditOrderDate(e.target.value)}
                  disabled={savingEdit}
                  className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                />
              </label>

              <div className="block space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  担当者
                </span>
                <div className="relative">
                  <input
                    type="text"
                    value={staffSearch}
                    onChange={(e) => {
                      setStaffSearch(e.target.value)
                      setStaffDropdownOpen(true)
                      // スタッフ一覧が取れない環境ではメール直接入力として扱う
                      if (staffOptions.length === 0)
                        setEditStaffEmail(e.target.value)
                    }}
                    onFocus={() => setStaffDropdownOpen(true)}
                    onBlur={() =>
                      // クリック選択を拾うため少し遅延して閉じる
                      setTimeout(() => setStaffDropdownOpen(false), 150)
                    }
                    placeholder={
                      staffOptions.length > 0
                        ? "氏名・部署・メールで検索…"
                        : "担当者の E-mail"
                    }
                    disabled={savingEdit}
                    className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                  />
                  {staffDropdownOpen && staffOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto border border-border rounded-sm bg-card shadow-lg">
                      {filteredStaff.length === 0 ? (
                        <div className="px-2 py-2 text-[10px] font-mono text-muted-foreground">
                          該当する担当者がいません
                        </div>
                      ) : (
                        filteredStaff.map((s) => (
                          <button
                            key={s.email}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setEditStaffEmail(s.email)
                              setStaffSearch(
                                `${s.staff_name}${s.department ? ` (${s.department})` : ""} · ${s.email}`
                              )
                              setStaffDropdownOpen(false)
                            }}
                            className={cn(
                              "w-full text-left px-2 py-1.5 text-xs font-mono hover:bg-muted",
                              editStaffEmail === s.email && "bg-muted/60"
                            )}
                          >
                            {s.staff_name}
                            {s.department ? ` (${s.department})` : ""}
                            <span className="text-muted-foreground">
                              {" "}
                              · {s.email}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {editStaffEmail && (
                  <div className="text-[10px] font-mono text-emerald-700 flex items-center gap-2">
                    選択中: {editStaffEmail}
                    <button
                      type="button"
                      onClick={() => {
                        setEditStaffEmail("")
                        setStaffSearch("")
                      }}
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      解除
                    </button>
                  </div>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  支払日（全明細に適用）
                </span>
                <input
                  type="date"
                  value={editPaymentDate}
                  onChange={(e) => setEditPaymentDate(e.target.value)}
                  disabled={savingEdit}
                  className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 px-1 focus:outline-none focus:border-foreground"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  備考に追記（自由備考・遡及理由など）
                </span>
                <textarea
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  rows={3}
                  placeholder="例: 納品検収後に発行のため、発注日を遡及して記載。"
                  disabled={savingEdit}
                  className="w-full text-xs font-mono bg-transparent border border-input rounded-sm py-1.5 px-2 focus:outline-none focus:border-foreground resize-y"
                />
                <span className="text-[10px] font-mono text-muted-foreground/70">
                  既存の自由備考がある場合は改行して末尾に追記されます。
                </span>
              </label>
            </div>
            <div className="bg-muted/30 border-t border-border px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                disabled={savingEdit}
                className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={runBulkEdit}
                disabled={savingEdit}
                className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-4 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingEdit ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Pencil className="w-3 h-3" />
                )}
                {savingEdit
                  ? "更新中..."
                  : `${selectedRowObjs.length} 件に適用`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 23: 発注書統合モーダル */}
      {mergeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => !merging && setMergeOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-sm shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-muted/30 border-b border-border px-5 py-3 flex items-center gap-2">
              <Link2 className="w-4 h-4" />
              <span className="text-[11px] font-mono uppercase tracking-wider font-bold">
                発注書を1枚に統合
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                選択した {selectedRowObjs.length} 件の発注書を
                <span className="font-bold text-foreground">統合先</span>
                1枚にまとめます(明細を寄せ集めます)。
                <span className="font-bold text-red-700">
                  統合先以外の発注書は削除されます。
                </span>
                取引先:{" "}
                <span className="font-bold text-foreground">
                  {selectedRowObjs[0]?.summary.counterparty}
                </span>
              </p>
              <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-muted-foreground">
                統合先(残す発注書)を選択
              </div>
              <div className="border border-input rounded-sm divide-y divide-border/50 max-h-[40vh] overflow-y-auto">
                {selectedRowObjs.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-start gap-2 p-2.5 cursor-pointer hover:bg-muted/30"
                  >
                    <input
                      type="radio"
                      name="merge-target"
                      checked={mergeTargetId === r.id}
                      onChange={() => setMergeTargetId(r.id)}
                      disabled={merging}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-mono font-bold flex items-center gap-2">
                        {r.document_number}
                        {mergeTargetId === r.id && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-sm">
                            統合先 · 残す
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {r.summary.title || "(タイトル未設定)"}
                        {r.summary.line_count != null &&
                          ` · 明細 ${r.summary.line_count} 行`}
                        {r.summary.amount != null &&
                          ` · 税抜 ¥${Number(r.summary.amount).toLocaleString("ja-JP")}`}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="bg-muted/30 border-t border-border px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMergeOpen(false)}
                disabled={merging}
                className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-1.5 hover:bg-muted disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={runMerge}
                disabled={merging || mergeTargetId == null}
                className="text-[10px] font-mono uppercase tracking-wider bg-foreground text-background rounded-sm px-4 py-1.5 hover:opacity-80 flex items-center gap-1.5 disabled:opacity-50"
              >
                {merging ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Link2 className="w-3 h-3" />
                )}
                {merging
                  ? "統合中..."
                  : `${selectedRowObjs.length - 1} 件を統合先にまとめる`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const TabButton: React.FC<{
  label: string
  count: number
  active: boolean
  onClick: () => void
}> = ({ label, count, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-sm border transition-colors",
      active
        ? "bg-foreground text-background border-foreground"
        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
    )}
  >
    {label}
    <span
      className={cn(
        "ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1 rounded-sm text-[11px]",
        active ? "bg-background/20" : "bg-muted"
      )}
    >
      {count}
    </span>
  </button>
)
