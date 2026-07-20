/**
 * ⑤ 契約・条件（追補）— 原作起点ピッカー（N:N 共有結線）＋ 個別条件書からの参照リンク。
 *   8タブ移行 Phase 6。旧 WorkGraphPanel 末尾の 2 ブロックを移設。
 *   タブ本体の RightsTreePanel と併置する（WorkDetailTabs 側で構成）。
 *   明細の作成は文書フローで。ここは既存明細の結線（参照リンク）のみ（§3.6/§10.7）。API は context 経由で不変（§20）。
 */
import * as React from "react"
import { EmptyState } from "@/components/EmptyState"
import { NativeSelect } from "@/components/ui/native-select"
import { WorkPicker, toWorkPickerItem } from "@/src/components/work/WorkPicker"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { KindBadge, yen, matDisplay } from "./shared"

export const WorkConditionsSection: React.FC = () => {
  const {
    work, workId, isSource, sourceWorks,
    pickerSource, setPickerSource, loadPicker, pickerLoading, pickerLines, pickerGroups, pickerSrcTitle, pickerMaterials, pickerLineMat, setPickerLineMat, addComponentLine, removeComponentLine,
    edgeDoc, setEdgeDoc, searchEdges, edgeSearching, edgeSearched, edgeLines, attachEdge, newDocTemplate, setNewDocTemplate, issueNewConditionDoc,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  return (
    <div className="space-y-5">
      {/* 原作起点ピッカー — 原作を選ぶ→その利用許諾条件明細を共有結線 */}
      {!isSource && (
        <div className="rounded-md border border-dashed border-primary/40 p-3 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            ＋ 原作のマテリアル条件から、この作品で使うものを選ぶ
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1">
            原作を選ぶ→各条件に「利用するマテリアル」を指定→「この作品に追加」。追加した条件がこの作品の履行義務（③マテリアルのサマリー）になります。
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">原作:</span>
            <WorkPicker
              items={sourceWorks.map((s: any) => toWorkPickerItem(s))}
              value={pickerSource || undefined}
              onSelect={(s) => {
                const id = s ? String(s.id) : ""
                setPickerSource(id)
                void loadPicker(id, workId)
              }}
              placeholder="原作を検索 (コード / タイトル / 別名)"
              className="min-w-[16rem] flex-1 max-w-md"
            />
            {pickerLoading && <span className="text-[10px] text-muted-foreground">読込中…</span>}
          </div>
          {pickerSource && !pickerLoading && pickerLines.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              この原作に紐づく利用許諾条件明細がありません（明細の出所原作が未設定の可能性）。
            </p>
          )}
          {pickerGroups.map((g, gi) => (
            <div key={gi} className="space-y-1 border border-border/50 rounded-md p-2">
              <div className="text-[10px] font-mono font-bold flex items-center gap-1.5 flex-wrap">
                {g.mat ? (
                  <>
                    <span className="text-success">◦ マテリアル</span>
                    <span>{matDisplay(g.mat.material_code, pickerSrcTitle, g.mat.material_name)}</span>
                    {g.mat.rights_holder_name && (
                      <span className="text-warning">（権利者: {g.mat.rights_holder_name}）</span>
                    )}
                    <span className="text-muted-foreground/60">· 条件 {g.lines.length}件</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">（マテリアル未割当 — 各条件で選択して追加）</span>
                )}
              </div>
              {g.lines.map((l: any) => {
                const knownMat = !!g.mat
                return (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono border border-border/60 rounded px-2 py-1.5 ml-2"
                  >
                    <div className="min-w-0 space-y-0.5 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <KindBadge kind={l.transaction_kind} />
                        <span className="font-semibold truncate">{l.subject || l.line_code || `#${l.id}`}</span>
                        {l.payment_scheme === "royalty"
                          ? l.rate_pct != null && <span className="text-muted-foreground">{l.rate_pct}%</span>
                          : l.amount_ex_tax != null && <span className="text-muted-foreground">{yen(l.amount_ex_tax)}</span>}
                        {l.counterparty && <span className="text-[10px] text-warning">相手方: {l.counterparty}</span>}
                        {l.linked_here && <span className="text-[10px] text-success">✓ 利用中</span>}
                      </div>
                      {!knownMat && !l.linked_here && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground shrink-0">利用するマテリアル:</span>
                          <NativeSelect
                            value={pickerLineMat[l.id] ?? ""}
                            onChange={(e) => setPickerLineMat((prev) => ({ ...prev, [l.id]: e.target.value }))}
                            className="h-6 text-[10px] py-0 min-w-[10rem]"
                          >
                            <option value="">— マテリアルを選択 —</option>
                            {pickerMaterials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {matDisplay(m.material_code, pickerSrcTitle, m.material_name)}{m.rights_holder_name ? `（権利者: ${m.rights_holder_name}）` : ""}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      )}
                      {l.document_number && (
                        <div className="text-[10px] text-muted-foreground/70 truncate">{l.document_number}</div>
                      )}
                    </div>
                    {l.linked_here ? (
                      <button
                        type="button"
                        onClick={() => void removeComponentLine(l)}
                        className="shrink-0 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        外す
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void addComponentLine(l)}
                        disabled={!(pickerLineMat[l.id] || l.source_material_id != null)}
                        title={!(pickerLineMat[l.id] || l.source_material_id != null) ? "原作マテリアルを選択してください" : undefined}
                        className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
                      >
                        この作品に追加
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground/70">
            ※ 各明細に「原作素材」を選んでこの作品へ結線します（条件はマテリアルにぶら下がる）。同じ明細を複数の作品で共有でき（N:N）、「外す」はこの作品ぶんだけ解除します。明細が出ない場合は、④権利根源の支払エッジの「原作に紐付け」で出所原作を設定してください。
          </p>
        </div>
      )}

      {/* 個別条件書から condition_lines をこの作品へ参照リンク（明細は新規作成しない） */}
      <div className="rounded-md border border-dashed border-input p-3 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          ＋ 条件明細をこの作品に追加（個別条件書から参照）
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">新規に起票:</span>
          <NativeSelect
            value={newDocTemplate}
            onChange={(e) => setNewDocTemplate(e.target.value)}
            className="h-7 text-[11px]"
          >
            <option value="individual_license_terms">個別利用許諾条件書</option>
            <option value="pub_license_terms">出版等利用許諾条件書</option>
          </NativeSelect>
          <button
            type="button"
            onClick={issueNewConditionDoc}
            className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10"
          >
            個別条件書を起票 ↗
          </button>
          <span className="text-[10px] text-muted-foreground/70">作成後、下の文書番号で検索して結合</span>
        </div>
        <div className="flex items-center gap-1.5 max-w-md">
          <input
            value={edgeDoc}
            onChange={(e) => setEdgeDoc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchEdges()
            }}
            placeholder="文書番号 (例: LIC-... / ARC-...)"
            className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
          />
          <button
            type="button"
            onClick={() => void searchEdges()}
            disabled={edgeSearching || !edgeDoc.trim()}
            className="text-[11px] font-mono px-2 py-1 rounded border border-border hover:border-foreground/40 disabled:opacity-50"
          >
            {edgeSearching ? "検索中…" : "検索"}
          </button>
        </div>
        {edgeSearched && edgeLines.length === 0 && (
          <p className="text-[11px] text-muted-foreground">該当する条件明細がありません。</p>
        )}
        {edgeLines.map((l) => {
          const linkedHere = String(l.work_id ?? "") === String(workId)
          return (
            <div
              key={l.id}
              className="flex items-center justify-between gap-2 text-[11px] font-mono border border-border/60 rounded px-2 py-1.5"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <KindBadge kind={l.transaction_kind} />
                  <span className="font-semibold truncate">{l.subject || l.line_code || `#${l.id}`}</span>
                  <span className="text-muted-foreground">{l.direction === "payable" ? "支払" : "受取"}</span>
                </div>
                <div className="text-[10px] text-muted-foreground/80 truncate">
                  {l.document_number}
                  {l.current_work_code && !linkedHere && ` · 紐付け済: ${l.current_work_code}`}
                </div>
              </div>
              {linkedHere ? (
                <button
                  type="button"
                  onClick={() => void attachEdge(l.id, null)}
                  className="shrink-0 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  外す
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void attachEdge(l.id, Number(workId))}
                  className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10"
                >
                  {l.work_id ? "付替えて追加" : "追加"}
                </button>
              )}
            </div>
          )
        })}
        <p className="text-[10px] text-muted-foreground/70">
          ※ 明細の作成は個別条件書フローで。ここでは既存明細をこの作品へ結び付け（参照リンク）し、direction に応じて支払/受取カードに表示します。
        </p>
      </div>
    </div>
  )
}

export default WorkConditionsSection
