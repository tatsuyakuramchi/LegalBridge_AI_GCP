/**
 * WorkMaterialLinkPanel — 作品 ↔ 原作マテリアル 紐づけ 専用画面。
 *
 * 「この作品が使う原作マテリアル」を検索して紐づけ/解除するだけに用途を絞った画面。
 * 既存の N:N 結線 API(component-lines)をそのまま利用し、バックエンド変更は不要。
 *   - 紐づけ済み一覧: GET /api/v3/works/:workId/graph の upstream を素材単位でグルーピング。
 *   - 追加候補     : GET /api/v3/source-ips/:sourceId/condition-lines?work_id=:workId
 *                    (原作の利用許諾条件を素材単位で表示。linked_here で結線済み判定)
 *   - 紐づけ       : POST   /api/v3/works/:workId/component-lines { condition_line_id, source_material_id }
 *   - 解除         : DELETE /api/v3/works/:workId/component-lines/:conditionLineId
 *
 * 結線の単位は「原作の利用許諾条件明細(condition_line)」で、橋渡しに source_material_id を持つ。
 * 同じ明細を複数作品で共有でき(N:N)、解除はこの作品ぶんだけに効く。
 */
import * as React from "react"
import { Boxes, Link2, X, Loader2, Search, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import { EntitySearchSelect, type EntityOption } from "@/src/components/search/EntitySearch"

const matDisplay = (code?: string | null, name?: string | null) =>
  `${code ? `[${code}] ` : ""}${name || "(無題)"}`

export function WorkMaterialLinkPanel() {
  const { push } = useToast()

  const [work, setWork] = React.useState<EntityOption | null>(null)
  const workId = work?.id || ""

  const [graph, setGraph] = React.useState<any>(null)
  const [graphLoading, setGraphLoading] = React.useState(false)

  const [source, setSource] = React.useState<EntityOption | null>(null)
  const sourceId = source?.id || ""
  const [pickerLines, setPickerLines] = React.useState<any[]>([])
  const [pickerMaterials, setPickerMaterials] = React.useState<any[]>([])
  const [pickerLineMat, setPickerLineMat] = React.useState<Record<number, string>>({})
  const [pickerLoading, setPickerLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const loadGraph = React.useCallback(async (wid: string) => {
    if (!wid) { setGraph(null); return }
    setGraphLoading(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(wid)}/graph`)
      const d = await r.json()
      setGraph(d && !d.error ? d : null)
    } catch {
      setGraph(null)
    } finally {
      setGraphLoading(false)
    }
  }, [])

  const loadPicker = React.useCallback(async (sid: string, wid: string) => {
    if (!sid) { setPickerLines([]); setPickerMaterials([]); setPickerLineMat({}); return }
    setPickerLoading(true)
    try {
      const q = wid ? `?work_id=${encodeURIComponent(wid)}` : ""
      const [lr, sr] = await Promise.all([
        fetch(`/api/v3/source-ips/${encodeURIComponent(sid)}/condition-lines${q}`),
        fetch(`/api/v3/source-ips/${encodeURIComponent(sid)}`),
      ])
      const lines = await lr.json()
      const src = await sr.json()
      const arr = Array.isArray(lines) ? lines : []
      setPickerLines(arr)
      setPickerMaterials(Array.isArray(src?.materials) ? src.materials : [])
      const init: Record<number, string> = {}
      for (const l of arr) if (l.source_material_id != null) init[l.id] = String(l.source_material_id)
      setPickerLineMat(init)
    } catch {
      setPickerLines([]); setPickerMaterials([]); setPickerLineMat({})
    } finally {
      setPickerLoading(false)
    }
  }, [])

  // 作品を選び直したらグラフを読み、原作ピッカーはリセット。
  React.useEffect(() => {
    setSource(null); setPickerLines([]); setPickerMaterials([]); setPickerLineMat({})
    void loadGraph(workId)
  }, [workId, loadGraph])

  const refresh = React.useCallback(async () => {
    await Promise.all([loadGraph(workId), loadPicker(sourceId, workId)])
  }, [loadGraph, loadPicker, workId, sourceId])

  const addLine = async (line: any) => {
    if (!workId) return
    const matId = pickerLineMat[line.id] || (line.source_material_id != null ? String(line.source_material_id) : "")
    if (!matId) { push("先に原作マテリアルを選択してください", "error"); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/component-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition_line_id: line.id, source_material_id: Number(matId) }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      push("この作品に紐づけました", "success")
      await refresh()
    } catch (e: any) {
      push(`紐づけに失敗: ${e?.message || e}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const removeLine = async (conditionLineId: number) => {
    if (!workId) return
    setBusy(true)
    try {
      const r = await fetch(
        `/api/v3/works/${encodeURIComponent(workId)}/component-lines/${encodeURIComponent(conditionLineId)}`,
        { method: "DELETE" }
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      push("紐づけを解除しました", "success")
      await refresh()
    } catch (e: any) {
      push(`解除に失敗: ${e?.message || e}`, "error")
    } finally {
      setBusy(false)
    }
  }

  // 紐づけ済み: graph.upstream を (原作×素材) 単位でグルーピング。
  const linkedGroups = React.useMemo(() => {
    const upstream: any[] = graph?.upstream || []
    const groups = new Map<string, { matCode?: string | null; matName?: string | null; srcTitle?: string | null; edges: any[] }>()
    for (const e of upstream) {
      if (e.source_material_id == null) continue
      const key = `${e.source_work_id ?? "?"}::${e.source_material_id}`
      const g = groups.get(key)
      if (g) g.edges.push(e)
      else groups.set(key, {
        matCode: e.source_material_code,
        matName: e.source_material_name,
        srcTitle: e.source_work_title || e.source_work_code,
        edges: [e],
      })
    }
    return Array.from(groups.values())
  }, [graph])

  // 追加候補: 原作の条件明細を素材単位でグルーピング(素材確定済みを上に)。
  const pickerGroups = React.useMemo(() => {
    const byMat = new Map<string, { mat: any | null; lines: any[] }>()
    for (const l of pickerLines) {
      const mid = l.source_material_id != null ? String(l.source_material_id) : ""
      if (!byMat.has(mid)) {
        const mat = mid
          ? pickerMaterials.find((m: any) => String(m.id) === mid) || { material_code: l.material_code, material_name: l.material_name }
          : null
        byMat.set(mid, { mat, lines: [] })
      }
      byMat.get(mid)!.lines.push(l)
    }
    return Array.from(byMat.values()).sort((a, b) => (a.mat ? 0 : 1) - (b.mat ? 0 : 1))
  }, [pickerLines, pickerMaterials])

  const yen = (n: any) => (n == null ? "" : `¥${Number(n).toLocaleString("ja-JP")}`)

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-6">
      <header className="border-b border-border pb-5">
        <p className="retro-tag mb-1.5">LINK · 作品×原作素材</p>
        <h2 className="text-2xl font-mono font-bold tracking-tight flex items-center gap-2">
          <Boxes className="h-6 w-6 text-muted-foreground" /> 作品 × 原作マテリアル 紐づけ
        </h2>
        <p className="text-[13px] font-mono text-muted-foreground mt-1.5">
          自社作品が利用する原作マテリアルを検索して紐づけ／解除します。紐づけは原作の利用許諾条件明細の単位で、
          同じ明細を複数作品で共有できます（解除はこの作品ぶんだけ）。
        </p>
      </header>

      {/* STEP 1: 作品を選ぶ */}
      <section className="space-y-2">
        <div className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> 1. 作品を選ぶ（自社作品）
        </div>
        <EntitySearchSelect
          entity="work"
          value={work?.id ?? null}
          onSelect={(o) => setWork(o)}
          placeholder="作品を検索（コード / タイトル）"
        />
      </section>

      {!workId ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl">
          <Boxes className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-[13px] font-mono text-muted-foreground">
            まず作品を選ぶと、紐づけ済みの原作マテリアルと追加候補が表示されます。
          </p>
        </div>
      ) : (
        <>
          {/* STEP 2: 紐づけ済み原作マテリアル */}
          <section className="space-y-2">
            <div className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-emerald-600" /> 2. この作品が使う原作マテリアル（紐づけ済み）
              {graphLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {linkedGroups.length === 0 ? (
              <p className="text-[12px] font-mono text-muted-foreground border border-dashed border-border rounded-md px-3 py-4">
                まだ原作マテリアルが紐づいていません。下の「3. 原作マテリアルを追加」から紐づけてください。
              </p>
            ) : (
              <div className="space-y-2">
                {linkedGroups.map((g, gi) => (
                  <div key={gi} className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2.5 space-y-1.5">
                    <div className="text-[12px] font-mono font-bold text-emerald-800">
                      {matDisplay(g.matCode, g.matName)}
                      {g.srcTitle && <span className="ml-2 text-[10px] font-normal text-muted-foreground">原作: {g.srcTitle}</span>}
                    </div>
                    {g.edges.map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-[11px] font-mono bg-white/70 border border-emerald-100 rounded px-2 py-1.5">
                        <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold truncate">{e.subject || e.line_code || `#${e.id}`}</span>
                          {e.payment_scheme === "royalty"
                            ? e.rate_pct != null && <span className="text-muted-foreground">{e.rate_pct}%</span>
                            : e.amount_ex_tax != null && <span className="text-muted-foreground">{yen(e.amount_ex_tax)}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeLine(e.id)}
                          disabled={busy}
                          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive disabled:opacity-50"
                          title="この作品ぶんの紐づけを解除"
                        >
                          <X className="h-3 w-3" /> 外す
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* STEP 3: 原作マテリアルを追加 */}
          <section className="space-y-2">
            <div className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-sky-600" /> 3. 原作マテリアルを追加
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/70">
              原作を選ぶと、その原作の利用許諾条件が原作マテリアル別に出ます。使う条件を「この作品に追加」で紐づけます。
            </p>
            <EntitySearchSelect
              entity="source_ip"
              value={source?.id ?? null}
              onSelect={(o) => {
                setSource(o)
                void loadPicker(o?.id || "", workId)
              }}
              placeholder="原作を検索（LO-コード / タイトル）"
            />

            {sourceId && (
              <div className="mt-2 space-y-2">
                {pickerLoading ? (
                  <p className="text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> 読み込み中…
                  </p>
                ) : pickerGroups.length === 0 ? (
                  <p className="text-[11px] font-mono text-amber-700 border border-dashed border-amber-300 rounded-md px-3 py-3">
                    この原作には利用許諾条件明細がありません。先に「原作素材」画面で素材と金銭条件を登録してください。
                  </p>
                ) : (
                  pickerGroups.map((g, gi) => (
                    <div key={gi} className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                      <div className="text-[11px] font-mono font-bold">
                        {g.mat ? (
                          <>{matDisplay(g.mat.material_code, g.mat.material_name)}<span className="ml-2 text-[10px] font-normal text-muted-foreground/60">· 条件 {g.lines.length}件</span></>
                        ) : (
                          <span className="text-muted-foreground">（マテリアル未割当 — 各条件で選択して追加）</span>
                        )}
                      </div>
                      {g.lines.map((l: any) => {
                        const knownMat = !!g.mat
                        return (
                          <div key={l.id} className="flex items-center justify-between gap-2 text-[11px] font-mono border border-border/60 rounded px-2 py-1.5 ml-2">
                            <div className="min-w-0 space-y-0.5 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold truncate">{l.subject || l.line_code || `#${l.id}`}</span>
                                {l.payment_scheme === "royalty"
                                  ? l.rate_pct != null && <span className="text-muted-foreground">{l.rate_pct}%</span>
                                  : l.amount_ex_tax != null && <span className="text-muted-foreground">{yen(l.amount_ex_tax)}</span>}
                                {l.linked_here && <span className="text-[10px] text-emerald-700">✓ 利用中</span>}
                              </div>
                              {!knownMat && !l.linked_here && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-muted-foreground shrink-0">利用するマテリアル:</span>
                                  <NativeSelect
                                    value={pickerLineMat[l.id] ?? ""}
                                    onChange={(e) => setPickerLineMat((prev) => ({ ...prev, [l.id]: e.target.value }))}
                                    className="h-6 text-[10px] py-0 min-w-[12rem]"
                                  >
                                    <option value="">— マテリアルを選択 —</option>
                                    {pickerMaterials.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {matDisplay(m.material_code, m.material_name)}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                </div>
                              )}
                            </div>
                            {l.linked_here ? (
                              <button
                                type="button"
                                onClick={() => void removeLine(l.id)}
                                disabled={busy}
                                className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                              >
                                外す
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void addLine(l)}
                                disabled={busy || !(pickerLineMat[l.id] || l.source_material_id != null)}
                                title={!(pickerLineMat[l.id] || l.source_material_id != null) ? "原作マテリアルを選択してください" : undefined}
                                className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-sky-400 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                              >
                                この作品に追加
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
