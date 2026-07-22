/**
 * DataQualityCenter — Data Quality Center(設計 v1.4 DQ-06 / §8.11)。
 *   全 Issue の俯瞰・絞込・担当/期限の割当・waive・再評価、作品への修正導線。
 *   worker(DQ-01/02)未デプロイ / 未評価のときは「利用不可」を明示(既存画面は壊さない)。
 */
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { ShieldAlert, RefreshCw, Search, ExternalLink } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { useToast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"
import { ModuleHeader } from "@/src/components/form"
import {
  getIssues,
  getIssueEvents,
  patchIssue,
  waiveIssue,
  rescanDataQuality,
  type DqIssue,
  type DqIssueEvent,
} from "@/src/lib/api/dataQualityClient"

const SEV_CLS: Record<string, string> = {
  // UIC-24: 状態色トークン(severity-*)を使用。emerald/rose 直書きを撤去し light/dark 両対応に。
  BLOCKER: "border-[hsl(var(--severity-blocker)_/_0.45)] text-[hsl(var(--severity-blocker))] bg-[hsl(var(--severity-blocker)_/_0.1)]",
  ERROR: "border-[hsl(var(--severity-error)_/_0.45)] text-[hsl(var(--severity-error))] bg-[hsl(var(--severity-error)_/_0.1)]",
  WARNING: "border-[hsl(var(--severity-warning)_/_0.45)] text-[hsl(var(--severity-warning))] bg-[hsl(var(--severity-warning)_/_0.1)]",
  INFO: "border-border text-muted-foreground bg-muted/50",
}
const ENTITY_LABEL: Record<string, string> = {
  work: "作品", material: "素材", condition: "条件", work_relation: "作品関係",
  material_rights_source: "権利根源", entity_source: "証憑", contract: "契約",
}

export function DataQualityCenter() {
  const { staffList } = useAppData()
  const { push } = useToast()
  const navigate = useNavigate()

  const [status, setStatus] = React.useState("open")
  const [severity, setSeverity] = React.useState("")
  const [entityType, setEntityType] = React.useState("")
  const [q, setQ] = React.useState("")
  const [issues, setIssues] = React.useState<DqIssue[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [rescanning, setRescanning] = React.useState(false)
  // DQ-09 監査ログ: 行ごとの操作履歴(展開表示)。
  const [eventsFor, setEventsFor] = React.useState<number | null>(null)
  const [eventsData, setEventsData] = React.useState<DqIssueEvent[] | null>(null)
  const [eventsLoading, setEventsLoading] = React.useState(false)

  const toggleEvents = async (id: number) => {
    if (eventsFor === id) { setEventsFor(null); return }
    setEventsFor(id)
    setEventsData(null)
    setEventsLoading(true)
    const r = await getIssueEvents(id)
    setEventsData(r)
    setEventsLoading(false)
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    const r = await getIssues({ status, severity: severity || undefined, entity_type: entityType || undefined })
    setIssues(r)
    setLoading(false)
  }, [status, severity, entityType])

  React.useEffect(() => { void load() }, [load])

  const staffName = (id?: number | null) =>
    id == null ? "" : staffList.find((s) => s.id === id)?.staff_name || `#${id}`

  const filtered = React.useMemo(() => {
    if (!issues) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return issues
    return issues.filter(
      (i) =>
        i.rule_title.toLowerCase().includes(needle) ||
        i.rule_code.toLowerCase().includes(needle) ||
        `${i.entity_type} ${i.entity_id}`.toLowerCase().includes(needle)
    )
  }, [issues, q])

  const counts = React.useMemo(() => {
    const c = { BLOCKER: 0, ERROR: 0, WARNING: 0, INFO: 0 }
    for (const i of issues || []) c[i.severity] = (c[i.severity] || 0) + 1
    return c
  }, [issues])

  const doRescan = async () => {
    setRescanning(true)
    const r = await rescanDataQuality()
    setRescanning(false)
    if (!r) { push("再評価に失敗しました（Data Quality API 利用不可）", "error"); return }
    push(`再評価しました（${r.evaluated} ルール）`, "success")
    void load()
  }

  const applyPatch = async (id: number, body: any, label: string) => {
    const r = await patchIssue(id, body)
    if (!r) { push(`${label}に失敗しました`, "error"); return }
    setIssues((prev) => (prev || []).map((x) => (x.id === id ? { ...x, ...r } : x)))
  }

  const doWaive = async (id: number) => {
    const note = window.prompt("waive（例外）理由を入力してください")
    if (note == null) return
    const r = await waiveIssue(id, note)
    if (!r) { push("waive に失敗しました", "error"); return }
    push("waive しました", "success")
    // open 絞込中なら一覧から外れるので再取得。
    if (status === "open") void load()
    else setIssues((prev) => (prev || []).map((x) => (x.id === id ? { ...x, ...r } : x)))
  }

  // 修正導線: 対象の実編集画面へ飛ばす。
  //   work → /works/:id、条件 → line_code があれば条件明細詳細、無ければ親作品、
  //   どちらも無ければ条件明細ハブ(検索)。素材 → 親作品。
  const targetPath = (it: DqIssue): string | null => {
    if (it.entity_type === "work") return `/works/${it.entity_id}`
    if (it.entity_type === "condition") {
      if (it.condition_line_code) return `/condition-lines/${encodeURIComponent(it.condition_line_code)}`
      if (it.resolved_work_id) return `/works/${it.resolved_work_id}`
      return `/condition-lines`
    }
    if (it.resolved_work_id) return `/works/${it.resolved_work_id}`
    return null
  }
  const remediate = (it: DqIssue) => {
    const p = targetPath(it)
    if (p) navigate(p)
    else push(`${ENTITY_LABEL[it.entity_type] || it.entity_type} #${it.entity_id} を対象画面で修正してください（${it.remediation_type || ""}）`, "info")
  }

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <ModuleHeader
        eyebrow="DQ · CENTER"
        title={<span className="inline-flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Data Quality Center</span>}
        description="データ完全性の不足 Issue を俯瞰し、担当・期限の割当、例外(waive)、修正導線を提供する。"
        actions={
          <Button variant="outline" size="sm" onClick={doRescan} disabled={rescanning}>
            <RefreshCw className={cn("h-3.5 w-3.5", rescanning && "animate-spin")} />
            全件 再評価
          </Button>
        }
      />

      {/* サマリー */}
      <div className="flex flex-wrap items-center gap-2">
        {(["BLOCKER", "ERROR", "WARNING", "INFO"] as const).map((sv) => (
          <span key={sv} className={cn("rounded-sm border px-2 py-0.5 text-[11px] font-mono font-bold", SEV_CLS[sv])}>
            {sv} {counts[sv]}
          </span>
        ))}
      </div>

      {/* 絞込 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-32" aria-label="状態">
            <option value="open">未解消</option>
            <option value="all">すべて</option>
          </NativeSelect>
          <NativeSelect value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-9 w-36" aria-label="重大度">
            <option value="">全重大度</option>
            <option value="BLOCKER">BLOCKER</option>
            <option value="ERROR">ERROR</option>
            <option value="WARNING">WARNING</option>
          </NativeSelect>
          <NativeSelect value={entityType} onChange={(e) => setEntityType(e.target.value)} className="h-9 w-36" aria-label="対象">
            <option value="">全対象</option>
            <option value="work">作品</option>
            <option value="material">素材</option>
            <option value="condition">条件</option>
          </NativeSelect>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ルール名 / コード / 対象で検索" className="pl-8 font-mono text-xs" />
        </div>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="py-12 text-center text-xs text-muted-foreground">読み込み中…</div>
      ) : issues === null ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <ShieldAlert className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Data Quality API が利用できません（worker 未デプロイ / 未評価）。
            <br />デプロイ後に「全件 再評価」で Issue が生成されます。
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <p className="text-xs text-muted-foreground">該当する Issue はありません。</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[12px] font-mono">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">重大度</th>
                <th className="px-3 py-2 text-left">不足内容</th>
                <th className="px-3 py-2 text-left">対象</th>
                <th className="px-3 py-2 text-left">担当</th>
                <th className="px-3 py-2 text-left">期限</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <React.Fragment key={it.id}>
                <tr className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-1.5">
                    <span className={cn("rounded-sm border px-1 py-0.5 text-[9px] font-bold", SEV_CLS[it.severity])}>
                      {it.severity}
                    </span>
                    {it.status === "waived" && <span className="ml-1 text-[9px] text-muted-foreground">(waived)</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-bold">{it.rule_title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {it.rule_code}{it.stage ? ` · ${it.stage}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {targetPath(it) ? (
                      <Link to={targetPath(it)!} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                        {ENTITY_LABEL[it.entity_type] || it.entity_type} #{it.entity_id} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span>{ENTITY_LABEL[it.entity_type] || it.entity_type} #{it.entity_id}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <NativeSelect
                      value={it.assignee_staff_id == null ? "" : String(it.assignee_staff_id)}
                      onChange={(e) => applyPatch(it.id, { assignee_staff_id: e.target.value ? Number(e.target.value) : null }, "担当割当")}
                      className="h-7 w-32 text-[11px]"
                      aria-label="担当"
                      title={staffName(it.assignee_staff_id)}
                    >
                      <option value="">— 未割当 —</option>
                      {staffList.filter((s) => s.id != null).map((s) => (
                        <option key={s.id} value={String(s.id)}>{s.staff_name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="date"
                      value={it.due_at ? String(it.due_at).slice(0, 10) : ""}
                      onChange={(e) => applyPatch(it.id, { due_at: e.target.value || null }, "期限設定")}
                      className="h-7 rounded border border-input bg-transparent px-1.5 text-[11px]"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => remediate(it)}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
                      >
                        修正
                      </button>
                      {it.status !== "waived" && (
                        <button
                          type="button"
                          onClick={() => doWaive(it.id)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                        >
                          waive
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleEvents(it.id)}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                        title="操作履歴(監査ログ)"
                      >
                        履歴
                      </button>
                    </div>
                  </td>
                </tr>
                {eventsFor === it.id && (
                  <tr className="bg-muted/20">
                    <td colSpan={6} className="px-3 py-2">
                      {eventsLoading ? (
                        <span className="text-[11px] text-muted-foreground">読み込み中…</span>
                      ) : !eventsData || eventsData.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground">操作履歴はありません（未評価/未デプロイの可能性）。</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {eventsData.map((ev) => (
                            <li key={ev.id} className="text-[11px] text-muted-foreground">
                              <span className="text-foreground">{new Date(ev.created_at).toLocaleString("ja-JP")}</span>
                              {" · "}{ev.event_type}
                              {ev.actor ? ` · ${ev.actor}` : " · (不明)"}
                              {ev.note ? ` · ${ev.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
