/**
 * ③ マテリアル — 履行する利用許諾条件サマリ／原作の構成ツリー／素材一覧・追加。
 *   8タブ移行 Phase 6。旧 WorkGraphPanel の consumedGroups サマリ・原作構成ツリー・
 *   中カード素材ブロック（素材一覧・追加・原作の条件明細確認/編集/リコール）を移設。
 *   条件の作成・修正は文書フォームへ一本化済み（§UIC-03）。API 呼び方は context 経由で不変（§20）。
 */
import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/EmptyState"
import { DataTableShell, type DataTableColumn } from "@/src/components/form"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { yen, matDisplay } from "./shared"
import { FeeSubjectEditor } from "./FeeSubjectEditor"

// own(自社作品)の素材一覧の列定義（DataTableShell）。原作ビューは条件明細を
//   展開するため従来のカスタム描画を維持し、こちらは own の読み取り一覧のみ。
const ownMaterialColumns: DataTableColumn<any>[] = [
  {
    key: "code",
    header: "コード",
    className: "font-mono text-[10px] text-muted-foreground whitespace-nowrap",
    render: (m) => m.material_code || "—",
  },
  {
    key: "name",
    header: "素材名",
    render: (m) => (
      <span>
        <span className="font-semibold">{m.material_name}</span>
        {m.is_default && (
          <Badge variant="outline" className="ml-1 border-success/40 text-success">本体</Badge>
        )}
      </span>
    ),
  },
  {
    key: "rights_holder",
    header: "権利者",
    render: (m) =>
      m.rights_holder ? (
        <span className="text-[10px] text-warning">{m.rights_holder}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

export const WorkMaterialsSection: React.FC = () => {
  const {
    work, isSource, materials, consumedGroups, navigate, srcMatConds, uses,
    matEditId, setMatEditId, matEditForm, setMatEditForm, matEditSaving, matEditErr, startEditCond, saveEditCond, deleteCond, openMatEditor,
    matCondOpen, toggleMatCond, setMatCondOpen,
    matRecallDoc, setMatRecallDoc, recallByDoc, matRecallLoading, matRecallLines, assignRecalled,
    matName, setMatName, matType, setMatType, adding, addMaterial, createLicenseDocForSource,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  return (
    <div className="space-y-5">
      {/* 作品(own)が利用する原作マテリアル／履行する利用許諾条件（=支払う利用料）。 */}
      {!isSource && consumedGroups.length > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              この作品が利用する原作マテリアル／履行する利用許諾条件
            </span>
            <Badge variant="outline" className="border-success/40 text-success">
              マテリアル {consumedGroups.length}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">
            下のマテリアルの条件を履行（利用料を支払う）ことで、この作品を販売できます。これがこの作品の利用許諾条件書に記載される条件です。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {consumedGroups.map((g, gi) => (
              <div key={gi} className="rounded border border-border bg-card px-2.5 py-2 text-[11px] font-mono space-y-1">
                {g.workId != null ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/works/${g.workId}`)}
                    className="block w-full text-left text-[10px] text-primary truncate hover:underline"
                    title="この原作を開く"
                  >
                    <span className="font-bold">原作 ↗</span>{" "}
                    {g.workCode || ""} {g.workTitle || (g.workCode ? "" : "—")}
                  </button>
                ) : (
                  <div className="text-[10px] text-muted-foreground truncate">
                    <span className="text-primary font-bold">原作</span>{" "}
                    {g.workCode || ""} {g.workTitle || (g.workCode ? "" : "—")}
                  </div>
                )}
                <div className="font-semibold truncate">
                  <span className="text-success">◦ マテリアル</span>{" "}
                  {g.matCode || ""} {g.matName || (g.matCode ? "" : "（未設定）")}
                </div>
                <div className="space-y-1 pt-0.5 border-t border-border/50">
                  {g.edges.map((e) => (
                    <div key={e.id} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{e.subject || e.line_code || `条件#${e.id}`}</span>
                        <span className="shrink-0 font-semibold text-foreground/80">
                          {e.payment_scheme === "royalty"
                            ? e.rate_pct != null ? `${e.rate_pct}%` : "—"
                            : e.amount_ex_tax != null ? yen(e.amount_ex_tax) : "—"}
                        </span>
                      </div>
                      <div className="text-[10px] text-warning truncate">
                        相手方: {e.counterparty || "（未設定）"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 原作ビュー: 原作 → マテリアル(権利者) → 条件明細(算定) の 1原作:N材料:N条件 ツリー。 */}
      {isSource && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              原作の構成（マテリアル → 条件明細）
            </span>
            <Badge variant="outline" className="border-success/40 text-success">
              マテリアル {materials.length}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">
            原作は複数の原作マテリアルで構成され（権利者が異なる場合あり）、各マテリアルに複数の条件明細（直販／サブライセンス等の算定）がぶら下がります（1原作 : N材料 : N条件）。
          </p>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
            <span className="text-muted-foreground">この原作を利用する作品:</span>
            {uses.length === 0 ? (
              <span className="text-muted-foreground/70">まだありません</span>
            ) : (
              uses.map((u: any) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => navigate(`/works/${u.id}`)}
                  className="text-info hover:underline"
                  title="この作品を開く"
                >
                  {u.work_code || `#${u.id}`} {u.title} ↗
                </button>
              ))
            )}
          </div>
          {materials.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              まだマテリアルがありません。下の「素材を追加」から登録してください。
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {materials.map((m: any) => {
                const conds = srcMatConds[m.id] || []
                return (
                  <div key={m.id} className="rounded border border-border bg-card px-2.5 py-2 text-[11px] font-mono space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold truncate">
                        <span className="text-success">◦ マテリアル</span>{" "}
                        {matDisplay(m.material_code, work?.title, m.material_name)}
                        {m.is_default && (
                          <Badge variant="outline" className="ml-1 border-success/40 text-success">本体</Badge>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openMatEditor(m.id)}
                        className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary/10"
                        title="このマテリアルの条件明細を編集/追加"
                      >
                        条件編集 ▾
                      </button>
                    </div>
                    {m.rights_holder && (
                      <div className="text-[10px] text-warning truncate">権利者: {m.rights_holder}</div>
                    )}
                    <div className="space-y-0.5 pt-0.5 border-t border-border/50">
                      {conds.length === 0 ? (
                        <div className="text-[10px] text-muted-foreground">条件明細なし</div>
                      ) : (
                        conds.map((c: any) => {
                          const isMlc =
                            c.source_system === "master_register" ||
                            String(c.document_number || "").startsWith("MLC-")
                          const editing = matEditId === c.id
                          const ecls =
                            "w-full text-[10px] font-mono bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
                          return (
                            <div key={c.id} className="space-y-1 border-b border-border/30 last:border-0 pb-1 last:pb-0">
                              <div className="flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
                                <span className="truncate flex items-center gap-1 min-w-0">
                                  <span
                                    className={`shrink-0 text-[8px] font-mono px-1 py-0.5 rounded-sm border ${
                                      isMlc
                                        ? "border-success/40 bg-success/10 text-success"
                                        : "border-primary/40 bg-primary/10 text-primary"
                                    }`}
                                    title={isMlc ? "原作マスター(MLC)登録条件" : `文書由来: ${c.document_number || ""}`}
                                  >
                                    {isMlc ? "MLC" : (c.document_number || "文書")}
                                  </span>
                                  <span className="truncate">{c.subject || c.line_code || `条件#${c.id}`}</span>
                                </span>
                                <span className="shrink-0 flex items-center gap-1">
                                  <span className="font-semibold text-foreground/80">
                                    {c.payment_scheme === "royalty"
                                      ? c.rate_pct != null ? `${c.rate_pct}%` : "—"
                                      : c.amount_ex_tax != null ? yen(c.amount_ex_tax) : (c.payment_scheme || "—")}
                                  </span>
                                  <button type="button" onClick={() => startEditCond(c)}
                                    className="text-[9px] font-mono px-1 py-0.5 rounded border border-border hover:border-foreground/40" title="編集">編集</button>
                                  <button type="button" onClick={() => void deleteCond(c, m.id)}
                                    className="text-[9px] font-mono px-1 py-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10" title="削除">削除</button>
                                </span>
                              </div>
                              {editing && (
                                <div className="rounded border border-primary/40 bg-primary/10 p-1.5 space-y-1 text-[10px]">
                                  {!isMlc && (
                                    <p className="text-[9px] text-warning">⚠ 文書由来の条件です。編集は文書側の表示と差異が出る場合があります。</p>
                                  )}
                                  <div className="grid grid-cols-2 gap-1">
                                    <label className="space-y-0.5"><span className="text-muted-foreground">名称</span>
                                      <input className={ecls} value={matEditForm.subject || ""} onChange={(e) => setMatEditForm({ ...matEditForm, subject: e.target.value })} /></label>
                                    <label className="space-y-0.5"><span className="text-muted-foreground">支払方式</span>
                                      <select className={ecls} value={matEditForm.payment_scheme || "royalty"} onChange={(e) => setMatEditForm({ ...matEditForm, payment_scheme: e.target.value })}>
                                        <option value="royalty">royalty(料率)</option>
                                        <option value="lump_sum">lump_sum(固定)</option>
                                        <option value="per_unit">per_unit</option>
                                        <option value="installment">installment</option>
                                        <option value="subscription">subscription</option>
                                      </select></label>
                                  </div>
                                  {matEditForm.payment_scheme === "royalty" ? (
                                    <div className="grid grid-cols-3 gap-1">
                                      <label className="space-y-0.5"><span className="text-muted-foreground">料率%</span><input className={ecls} value={matEditForm.rate_pct || ""} onChange={(e) => setMatEditForm({ ...matEditForm, rate_pct: e.target.value })} /></label>
                                      <label className="space-y-0.5"><span className="text-muted-foreground">MG</span><input className={ecls} value={matEditForm.mg_amount || ""} onChange={(e) => setMatEditForm({ ...matEditForm, mg_amount: e.target.value })} /></label>
                                      <label className="space-y-0.5"><span className="text-muted-foreground">AG</span><input className={ecls} value={matEditForm.ag_amount || ""} onChange={(e) => setMatEditForm({ ...matEditForm, ag_amount: e.target.value })} /></label>
                                    </div>
                                  ) : matEditForm.payment_scheme !== "subscription" ? (
                                    <label className="block space-y-0.5"><span className="text-muted-foreground">金額(税抜)</span><input className={ecls} value={matEditForm.amount_ex_tax || ""} onChange={(e) => setMatEditForm({ ...matEditForm, amount_ex_tax: e.target.value })} /></label>
                                  ) : null}
                                  <div className="grid grid-cols-2 gap-1">
                                    <label className="space-y-0.5"><span className="text-muted-foreground">地域</span><input className={ecls} value={matEditForm.region_territory || ""} onChange={(e) => setMatEditForm({ ...matEditForm, region_territory: e.target.value })} /></label>
                                    <label className="space-y-0.5"><span className="text-muted-foreground">言語</span><input className={ecls} value={matEditForm.region_language || ""} onChange={(e) => setMatEditForm({ ...matEditForm, region_language: e.target.value })} /></label>
                                  </div>
                                  {/* WM-05: 利用料名目 プレビュー＋手動上書き（§6.6）。 */}
                                  <FeeSubjectEditor conditionId={c.id} />
                                  {matEditErr && <p className="text-[9px] text-destructive">{matEditErr}</p>}
                                  <div className="flex justify-end gap-1">
                                    <button type="button" onClick={() => setMatEditId(null)} className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">取消</button>
                                    <button type="button" onClick={() => void saveEditCond(m.id)} disabled={matEditSaving} className="text-[9px] px-1.5 py-0.5 rounded border border-primary bg-primary/10 text-primary font-bold disabled:opacity-50">{matEditSaving ? "保存中…" : "保存"}</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                      <div className="text-[9px] text-muted-foreground/60">条件 {conds.length}件</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 原作の利用許諾条件は「個別利用許諾条件書」文書フォームで起票（データの唯一の入力口）。 */}
      {isSource && materials.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
            利用許諾条件（原作マスター）
          </div>
          <p className="text-[9px] text-muted-foreground/70">
            この原作の素材ごとの取引形態・料率は<strong>「個別利用許諾条件書」文書フォーム</strong>で登録・修正します（データの唯一の入力口＝文書作成）。
            登録済みの条件は下の「素材（クリックで条件明細を確認）」で閲覧できます。
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={createLicenseDocForSource}
              className="text-[10px] font-mono px-2.5 py-1 rounded border border-primary bg-primary/10 text-primary font-bold hover:bg-primary/10"
            >
              文書フォームで条件を登録（個別利用許諾条件書）
            </button>
          </div>
        </div>
      )}

      {/* 素材一覧（原作ビューはクリックで条件明細確認）＋素材追加 */}
      <Card>
        <CardContent className="px-3.5 py-3 space-y-2">
          {materials.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                素材{isSource && "（クリックで条件明細を確認）"}
              </div>
              {!isSource ? (
                /* own(自社作品)の素材一覧は共通 DataTableShell へ。 */
                <DataTableShell
                  columns={ownMaterialColumns}
                  rows={materials}
                  rowKey={(m) => m.id}
                  emptyTitle="素材はありません"
                  dense
                />
              ) : (
                materials.map((m) => (
                <div key={m.id} id={`srcmat-${m.id}`} className="text-[11px] font-mono border border-border/60 rounded overflow-hidden scroll-mt-20">
                  <button
                    type="button"
                    onClick={() => toggleMatCond(m.id)}
                    className="w-full text-left px-2 py-1 hover:bg-muted/40 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      <span className="font-semibold">{m.material_code || "—"}</span>{work?.title ? ` ${work.title}　` : " "}{m.material_name}
                      {m.is_default && <Badge variant="outline" className="ml-1 border-success/40 text-success">本体</Badge>}
                      {m.rights_holder && <span className="text-[10px] text-warning"> · 権利者: {m.rights_holder}</span>}
                    </span>
                    <span className="text-[10px] text-primary shrink-0">
                      {matCondOpen === m.id ? "▲ 閉じる" : "利用許諾条件 ▾"}
                    </span>
                  </button>
                  {matCondOpen === m.id && (
                    <div className="border-t border-border/60 p-2 space-y-2 bg-muted/20">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">
                          条件の追加・編集は上の
                          <strong className="text-primary">「文書フォームで条件を登録（個別利用許諾条件書）」</strong>
                          から行います（データの唯一の入力口＝文書作成）。この素材はその原作の構成要素として扱われます。
                        </p>
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => setMatCondOpen(null)}
                            className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                          >
                            閉じる
                          </button>
                        </div>
                      </div>

                      {/* 上級(任意): 既存の金銭条件を文書番号で呼び出してこのマテリアルへ紐づける(複数可) */}
                      <details className="rounded border border-primary/40">
                        <summary className="cursor-pointer px-1.5 py-1 text-[10px] uppercase tracking-[0.14em] text-primary select-none">
                          ▶ 既存の金銭条件を文書番号から呼び出して紐づける（任意）
                        </summary>
                        <div className="p-1.5 space-y-1.5 border-t border-primary/40">
                          <div className="flex items-center gap-1.5">
                            <input
                              value={matRecallDoc}
                              onChange={(e) => setMatRecallDoc(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") void recallByDoc() }}
                              placeholder="文書番号 (例: LIC-... / ARC-...)"
                              className="flex-1 text-[10px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                            />
                            <button type="button" onClick={() => void recallByDoc()} disabled={matRecallLoading || !matRecallDoc.trim()} className="text-[10px] font-mono px-2 py-1 rounded border border-border hover:border-foreground/40 disabled:opacity-50">
                              {matRecallLoading ? "呼出中…" : "呼び出す"}
                            </button>
                          </div>
                          {matRecallLines.map((l) => {
                            const here = String(l.source_material_id ?? "") === String(m.id)
                            return (
                              <div key={l.id} className="flex items-center justify-between gap-2 text-[10px] border border-border/50 rounded px-1.5 py-1">
                                <div className="min-w-0">
                                  <span className="font-semibold">金銭条件{l.source_seq_no ?? "—"}</span>{" · "}
                                  {l.subject || l.line_code}{" · "}
                                  {l.payment_scheme === "royalty"
                                    ? `${l.rate_pct ?? "—"}%${l.mg_amount ? ` MG${yen(l.mg_amount)}` : ""}${l.ag_amount ? ` AG${yen(l.ag_amount)}` : ""}`
                                    : yen(l.amount_ex_tax) || l.payment_scheme}
                                  {l.region_language_label && <span className="text-muted-foreground">{" · 🌐 "}{l.region_language_label}</span>}
                                  {!here && l.source_material_id != null && <span className="text-warning">{" · 他素材に紐付け済"}</span>}
                                </div>
                                {here ? (
                                  <button type="button" onClick={() => void assignRecalled(m.id, l, false)} className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground">外す</button>
                                ) : (
                                  <button type="button" onClick={() => void assignRecalled(m.id, l, true)} className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary/10">紐づける</button>
                                )}
                              </div>
                            )
                          })}
                          {matRecallLines.length > 0 && (
                            <p className="text-[9px] text-muted-foreground/70">複数の金銭条件(n, n+1, …)をそれぞれこのマテリアルに紐づけられます。</p>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
                ))
              )}
            </div>
          )}
          {/* 素材を追加(work_material)。{work_code}-NNN を自動採番。 */}
          <div className="border-t border-border/60 pt-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">素材を追加</div>
            <div className="flex items-center gap-1.5">
              <input
                value={matName}
                onChange={(e) => setMatName(e.target.value)}
                placeholder="素材名 (例: カバーイラスト)"
                className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
              />
              <select
                value={matType}
                onChange={(e) => setMatType(e.target.value)}
                className="text-[11px] font-mono border-b border-input bg-transparent py-1"
              >
                <option value="original">原作</option>
                <option value="translation">翻訳</option>
                <option value="illustration">イラスト</option>
                <option value="scenario">シナリオ</option>
                <option value="design">デザイン</option>
                <option value="music">音楽</option>
              </select>
              <button
                type="button"
                onClick={addMaterial}
                disabled={adding || !matName.trim()}
                className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
              >
                {adding ? "追加中…" : "追加"}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default WorkMaterialsSection
