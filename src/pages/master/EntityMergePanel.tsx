/**
 * EntityMergePanel — ID統合(マージ)カート。
 *
 * 重複登録した 作品 / 原作 / 案件 を「カート」に集め、👑 で残す方(survivor)を選び、
 * それ以外(loser)を survivor へ統合する。統合前に「影響プレビュー」で、どのテーブル・列を
 * 何件付け替えるか(＝孤立せず引き継がれる外部キー)を確認できる。
 *
 * backend: /api/v3/merge/preview(読み取り) と /api/v3/merge/execute(付替え→loser削除)。
 * ※ 依頼(Backlog課題)の統合は既存の「統合カート」を使用。
 */
import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { GitMerge, Crown, X, Loader2, ShoppingCart, Trash2, AlertTriangle, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAppData } from "@/src/context/AppDataContext"
import { EntitySearchSelect, ENTITY_LABEL, type EntityKind, type EntityOption } from "@/src/components/search/EntitySearch"

type MergeKind = "work" | "source_ip" | "matter" | "issue"

// このカートで統合できる実体(EntitySearch で検索できるもの)。
const MERGE_KINDS: Array<{ key: MergeKind; label: string; accent: string }> = [
  { key: "source_ip", label: "原作", accent: "border-t-sky-500 text-sky-600" },
  { key: "work", label: "作品", accent: "border-t-emerald-500 text-emerald-600" },
  { key: "matter", label: "案件", accent: "border-t-violet-500 text-violet-600" },
  { key: "issue", label: "依頼", accent: "border-t-amber-500 text-amber-600" },
]

// issue はローカル本体を持たず、参照(backlog_issue_key/issue_key)を付け替えるのみ。
const isKeyBased = (k: MergeKind) => k === "issue"

type PreviewRef = { table: string; column: string; count: number; keyType: string }

export function EntityMergePanel() {
  const { showNotification } = useAppData() as any
  const [kind, setKind] = React.useState<MergeKind>("source_ip")
  const [items, setItems] = React.useState<EntityOption[]>([])
  const [survivorId, setSurvivorId] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<{ loser: EntityOption; refs: PreviewRef[]; total: number }[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [merging, setMerging] = React.useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  // 連結チェック(DuplicateFinder)からの prefill: sessionStorage の候補群でカートを初期化。
  React.useEffect(() => {
    if (searchParams.get("prefill") !== "1") return
    try {
      const raw = sessionStorage.getItem("lb_merge_prefill")
      if (raw) {
        const p = JSON.parse(raw)
        if (p && p.kind && Array.isArray(p.items) && p.items.length) {
          setKind(p.kind)
          setItems(p.items)
          setSurvivorId(p.items[0]?.id ?? null)
          setPreview(null)
        }
      }
    } catch { /* noop */ }
    sessionStorage.removeItem("lb_merge_prefill")
    const sp = new URLSearchParams(searchParams); sp.delete("prefill"); setSearchParams(sp, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 実体種別を変えたらカートを空にする(異種は混ぜられない)。
  const switchKind = (k: MergeKind) => {
    setKind(k); setItems([]); setSurvivorId(null); setPreview(null)
  }

  const add = (o: EntityOption | null) => {
    if (!o) return
    setPreview(null)
    setItems((prev) => (prev.some((x) => x.id === o.id) ? prev : [...prev, o]))
    setSurvivorId((s) => s ?? o.id) // 最初の1件を暫定 survivor に
  }
  const remove = (id: string) => {
    setPreview(null)
    setItems((prev) => prev.filter((x) => x.id !== id))
    setSurvivorId((s) => (s === id ? null : s))
  }
  const clear = () => { setItems([]); setSurvivorId(null); setPreview(null) }

  const survivor = items.find((x) => x.id === survivorId) || null
  const losers = items.filter((x) => x.id !== survivorId)
  const canMerge = !!survivor && losers.length >= 1

  // 影響プレビュー: 各 loser について preview を取り、テーブル/件数を集計。
  const runPreview = async () => {
    if (!survivor || losers.length === 0) return
    setLoading(true)
    try {
      const out: { loser: EntityOption; refs: PreviewRef[]; total: number }[] = []
      for (const loser of losers) {
        const res = await fetch("/api/v3/merge/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity: kind, survivorId: survivor.id, loserId: loser.id }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
        out.push({ loser, refs: d.refs || [], total: d.total || 0 })
      }
      setPreview(out)
    } catch (e: any) {
      showNotification?.(`プレビューに失敗: ${String(e?.message || e)}`, "error")
    } finally {
      setLoading(false)
    }
  }

  const doMerge = async () => {
    if (!survivor || losers.length === 0) return
    const total = (preview || []).reduce((s, p) => s + p.total, 0)
    const tail = isKeyBased(kind)
      ? `関連する外部キー ${total} 件を付け替えます（Backlog課題自体は残ります）。`
      : `関連する外部キー ${total} 件を付け替えてから、統合元を削除します（不可逆）。`
    if (!window.confirm(
      `${losers.map((l) => l.label).join(", ")} を「${survivor.label}」へ統合します。\n${tail}\nよろしいですか？`
    )) return
    setMerging(true)
    try {
      let ok = 0
      const failed: string[] = []
      for (const loser of losers) {
        const res = await fetch("/api/v3/merge/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity: kind, survivorId: survivor.id, loserId: loser.id, confirm: true }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok || d.ok === false) { failed.push(loser.label); continue }
        ok++
      }
      showNotification?.(
        `${ok}/${losers.length} 件を「${survivor.label}」へ統合しました${failed.length ? `（失敗: ${failed.join(", ")}）` : ""}`,
        failed.length ? "error" : "success"
      )
      // 成功した loser はカートから除去(survivor は残す)。
      setItems((prev) => prev.filter((x) => x.id === survivor.id || failed.includes(x.label)))
      setPreview(null)
      loadHistory()
    } catch (e: any) {
      showNotification?.(`統合に失敗: ${String(e?.message || e)}`, "error")
    } finally {
      setMerging(false)
    }
  }

  // 監査ログ(履歴)
  const [history, setHistory] = React.useState<any[]>([])
  const loadHistory = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v3/merge/audit?limit=20")
      const d = await res.json().catch(() => ({}))
      setHistory(Array.isArray(d.rows) ? d.rows : [])
    } catch { setHistory([]) }
  }, [])
  React.useEffect(() => { loadHistory() }, [loadHistory])

  const undo = async (id: number) => {
    if (!window.confirm("この統合を取り消します（best-effort: 参照を戻し、削除した本体を復元）。よろしいですか？")) return
    try {
      const res = await fetch("/api/v3/merge/undo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audit_id: id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
      showNotification?.(`取り消しました${d.note ? `（注意: ${d.note}）` : ""}`, d.note ? "error" : "success")
      loadHistory()
    } catch (e: any) {
      showNotification?.(`取り消しに失敗: ${String(e?.message || e)}`, "error")
    }
  }

  const grandTotal = (preview || []).reduce((s, p) => s + p.total, 0)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="retro-tag mb-1.5">MST · ID MERGE</p>
        <h3 className="text-lg font-mono font-bold">ID統合（マージ）カート</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          重複登録した実体をカートに集め、👑 で残す方を選んで統合します。関連する外部キー（文書番号・条件明細など）を付け替えてから統合元を削除するので、孤立しません。
        </p>
      </div>

      {/* 実体種別 */}
      <div className="flex flex-wrap gap-2">
        {MERGE_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => switchKind(k.key)}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[12px] font-bold transition-colors ${
              kind === k.key ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/40"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* 追加(統一検索) */}
      <div className="rounded-xl border border-border border-t-[3px] border-t-sky-500 bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold text-sky-600">
          <Search className="h-3.5 w-3.5" /> {ENTITY_LABEL[kind as EntityKind]}を検索してカートに追加
        </div>
        <EntitySearchSelect entity={kind as EntityKind} onSelect={add} placeholder={`${ENTITY_LABEL[kind as EntityKind]}を検索（名称 / コード）`} />
        {isKeyBased(kind) && (
          <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">
            依頼はDB参照（backlog_issue_key / issue_key）を統合先へ付け替えます。Backlog課題自体の子課題化・削除は右下の「統合カート」で行ってください。
          </p>
        )}
      </div>

      {/* カート */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-indigo-600" />
          <span className="font-mono text-[12px] font-bold">カート</span>
          <span className="font-mono text-[10px] text-muted-foreground">{items.length} 件</span>
          <div className="flex-1" />
          {items.length > 0 && (
            <button type="button" onClick={clear} className="font-mono text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> 空にする
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="text-center font-mono text-[11px] text-muted-foreground border border-dashed border-border rounded-lg py-6">
            上の検索から統合したい{ENTITY_LABEL[kind as EntityKind]}を2件以上追加してください。
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map((it) => {
              const isSurv = it.id === survivorId
              return (
                <div key={it.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${isSurv ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/30" : "border-border"}`}>
                  <label className="flex items-center gap-1 pt-0.5 cursor-pointer shrink-0" title="この{ENTITY_LABEL[kind]}を残す(統合先)">
                    <input type="radio" name="merge-survivor" className="accent-amber-600" checked={isSurv} onChange={() => { setSurvivorId(it.id); setPreview(null) }} />
                    <Crown className={`h-3.5 w-3.5 ${isSurv ? "text-amber-600" : "text-muted-foreground/40"}`} />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] font-bold">{it.label}</span>
                      {it.sub && <span className="font-mono text-[9px] text-muted-foreground">{it.sub}</span>}
                      {isSurv ? (
                        <span className="font-mono text-[9px] text-amber-700 font-bold">残す(統合先)</span>
                      ) : (
                        <span className="font-mono text-[9px] text-muted-foreground">{isKeyBased(kind) ? "参照を付替え" : "統合されて削除"}</span>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => remove(it.id)} className="text-muted-foreground hover:text-destructive shrink-0 pt-0.5" title="カートから出す">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {items.length === 1 && (
          <p className="font-mono text-[10px] text-amber-700">統合にはもう1件以上必要です。</p>
        )}
      </div>

      {/* 影響プレビュー */}
      {canMerge && (
        <div className="rounded-xl border border-border border-t-[3px] border-t-amber-500 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[12px] font-bold text-amber-600">影響プレビュー（付け替える外部キー）</span>
            <Button variant="outline" size="sm" onClick={runPreview} disabled={loading} className="font-mono text-[11px]">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 影響を確認
            </Button>
          </div>
          {preview == null ? (
            <p className="font-mono text-[10px] text-muted-foreground">「影響を確認」で、統合時に付け替えるテーブル・列・件数を表示します。</p>
          ) : grandTotal === 0 ? (
            <p className="font-mono text-[11px] text-emerald-700">付け替える外部キーはありません（統合元は参照されていません）。安全に統合できます。</p>
          ) : (
            <div className="space-y-3">
              {preview.map((p) => (
                <div key={p.loser.id} className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-2.5 py-1.5 font-mono text-[10.5px] font-bold">
                    {p.loser.label} <span className="text-muted-foreground">→ {survivor?.label}</span>
                    <span className="ml-2 text-amber-700">付替え {p.total} 件</span>
                  </div>
                  <table className="w-full font-mono text-[10px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <thead><tr className="text-muted-foreground"><th className="text-left px-2.5 py-1">テーブル</th><th className="text-left px-2.5 py-1">列</th><th className="text-right px-2.5 py-1">件数</th></tr></thead>
                    <tbody>
                      {p.refs.length === 0 ? (
                        <tr><td colSpan={3} className="px-2.5 py-1.5 text-muted-foreground">参照なし</td></tr>
                      ) : p.refs.map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2.5 py-1 text-sky-700">{r.table}</td>
                          <td className="px-2.5 py-1">{r.column}</td>
                          <td className="px-2.5 py-1 text-right">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 実行 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] text-muted-foreground flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          統合は不可逆です。先に「影響を確認」で内容を確かめてください。
        </p>
        <Button size="sm" className="font-mono text-[11px] gap-1.5" disabled={!canMerge || merging} onClick={doMerge}>
          {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
          {merging ? "統合中…" : `統合を実行（${losers.length} 件 → ${survivor?.label || "未選択"}）`}
        </Button>
      </div>

      {/* 監査ログ(統合履歴) + 取消し */}
      {history.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="font-mono text-[12px] font-bold text-muted-foreground">統合履歴（監査ログ）</div>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full font-mono text-[10px]" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead><tr className="bg-muted/40 text-muted-foreground">
                <th className="text-left px-2 py-1">日時</th><th className="text-left px-2 py-1">種別</th>
                <th className="text-left px-2 py-1">統合元 → 統合先</th><th className="text-right px-2 py-1">付替</th><th className="text-right px-2 py-1">操作</th>
              </tr></thead>
              <tbody>
                {history.map((h) => {
                  const moved = Array.isArray(h.moved) ? h.moved.reduce((s: number, m: any) => s + (m.updated || 0), 0) : 0
                  return (
                    <tr key={h.id} className="border-t border-border">
                      <td className="px-2 py-1 text-muted-foreground">{h.created_at ? new Date(h.created_at).toLocaleString("ja-JP") : "—"}</td>
                      <td className="px-2 py-1">{h.entity}</td>
                      <td className="px-2 py-1 truncate">{h.loser_label || h.loser_id} → <b>{h.survivor_label || h.survivor_id}</b></td>
                      <td className="px-2 py-1 text-right">{moved}</td>
                      <td className="px-2 py-1 text-right">
                        {h.undone_at ? (
                          <span className="text-muted-foreground">取消済</span>
                        ) : (
                          <button type="button" onClick={() => undo(h.id)} className="border border-rose-500 text-rose-600 rounded px-1.5 py-0.5 hover:bg-rose-500/10">取消し</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[9px] text-muted-foreground">取消しは best-effort（記録した参照を戻し、削除した本体を復元）。ledger 付替えや id 列の無い表は戻せない場合があります。</p>
        </div>
      )}
    </div>
  )
}

export default EntityMergePanel
