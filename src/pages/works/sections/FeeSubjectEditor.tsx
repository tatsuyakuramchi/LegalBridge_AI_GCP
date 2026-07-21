/**
 * FeeSubjectEditor — 条件明細の「利用料名目」プレビュー＋手動上書き（WM-05 / §6.6）。
 *   解決順（override → 権利根源名 → 権利根源作品『』原作利用料 → 原作作品 → マテリアル名利用料）は
 *   backend で解決し、ここでは結果表示と override の設定/解除のみ行う。
 *   計算書発行時の snapshot 凍結は別弾（既存分は 0141 でバックフィル済）。
 */
import * as React from "react"

const RULE_LABEL: Record<string, string> = {
  override: "手動指定",
  rights_source: "権利根源の名目",
  source_work: "権利根源作品",
  condition_source_work: "条件の原作作品",
  material: "マテリアル名",
}

export const FeeSubjectEditor: React.FC<{ conditionId: number }> = ({ conditionId }) => {
  const [data, setData] = React.useState<any>(null)
  const [override, setOverride] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v3/condition-lines/${conditionId}/fee-subject`)
      const d = await r.json()
      setData(d && !d.error ? d : null)
      setOverride(d?.override ?? "")
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [conditionId])

  React.useEffect(() => { void load() }, [load])

  const save = async (value: string | null) => {
    setSaving(true)
    try {
      const r = await fetch(`/api/v3/condition-lines/${conditionId}/fee-subject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_subject_override: value }),
      })
      const d = await r.json()
      if (r.ok) {
        setData(d)
        setOverride(d?.override ?? "")
      } else {
        window.alert(`名目の保存に失敗: ${d?.error || r.status}`)
      }
    } catch (e: any) {
      window.alert(`名目の保存に失敗: ${String(e?.message || e)}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-[9px] text-muted-foreground">名目を解決中…</div>
  }

  const resolved = data?.resolved ?? null
  const rule = data?.rule ?? null
  const dirty = (override || "") !== (data?.override || "")

  return (
    <div className="rounded border border-border/50 bg-muted/20 p-1.5 space-y-1 text-[10px]">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">利用料名目（利用許諾計算書）</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-foreground/90">{resolved || "（解決できません）"}</span>
        {rule && (
          <span className="text-[8px] font-mono px-1 py-0.5 rounded border border-border text-muted-foreground">
            {RULE_LABEL[rule] || rule}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <input
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          placeholder="手動で名目を上書き（空=自動解決）"
          className="flex-1 text-[10px] font-mono bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
        />
        <button
          type="button"
          onClick={() => void save(override.trim() || null)}
          disabled={saving || !dirty}
          className="text-[9px] px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary/10 disabled:opacity-40"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        {data?.override && (
          <button
            type="button"
            onClick={() => void save(null)}
            disabled={saving}
            className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="手動上書きを解除して自動解決に戻す"
          >
            自動に戻す
          </button>
        )}
      </div>
      {data?.snapshot && data.snapshot !== resolved && (
        <p className="text-[8px] text-warning">
          発行時の凍結名目: {data.snapshot}（計算書はこの値で表示されます）
        </p>
      )}
    </div>
  )
}

export default FeeSubjectEditor
