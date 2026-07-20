/**
 * WorkGraphPanel — 統合 Phase3c: 3カード統合エディタ（増分①: ビュー）。
 *
 * 作品(own)を選ぶと、権利フローを3カードで表示する:
 *   左 = 原作 / 素材調達（支払エッジ: ライセンスイン原作・委託素材）
 *   中 = 作品（own）＋ 素材 ＋ 製品
 *   右 = 受取（受取エッジ: ライセンスアウト派生物・物販アウト）
 *
 * カード間のエッジ = condition_lines（向き × 取引種別）。本増分は読み取り表示のみ。
 * 編集（ノード/エッジの作成・紐付け）は後続増分で追加する。
 */
import * as React from "react"
import { RightsTreePanel } from "./RightsTreePanel"
import { CompletenessPanel } from "@/src/components/dataquality/CompletenessPanel"
import { Globe } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EntityCombobox, AppFormField, CompactFormGrid } from "@/src/components/form"
import { WorkAttributionsPanel } from "@/src/components/work/WorkAttributionsPanel"
import { WorkPicker, toWorkPickerItem } from "@/src/components/work/WorkPicker"
// 8タブ移行 Phase 5: state/handler を WorkDetailContext へ持ち上げ。本パネルは①概要の描画専任。
import { useWorkDetail, type Edge } from "@/src/pages/works/WorkDetailContext"

// UIC-03 系撤去(設計 v1.4 Phase C / CLEAN): 原作ビューの「マテリアル単位 利用許諾条件 登録/編集」
//   (固定3種フォーム・FinancialConditionTable 一括保存)は A系で read-only 化した際に UI が撤去され、
//   ハンドラ(saveMatCond/saveMatFc/loadMatConds 等)と clToFc/fcToRow が孤児化していた。ここで撤去。
//   条件値の作成・修正は文書フォーム(Document Command)へ一本化済み。既存条件の閲覧・リンクは残置。

// Edge 型は WorkDetailContext からインポート（8タブ移行 Phase 5）。

const KIND_META: Record<string, { label: string; cls: string }> = {
  license: { label: "利用許諾", cls: "border-primary/40 text-primary" },
  product: { label: "物販", cls: "border-info/40 text-info" },
  service: { label: "委託", cls: "border-warning/40 text-warning" },
}
const KindBadge = ({ kind }: { kind: string | null }) => {
  const m = kind ? KIND_META[kind] : null
  return m ? <Badge variant="outline" className={m.cls}>{m.label}</Badge> : null
}
const yen = (v: any) => (v == null || v === "" ? "" : `¥${Number(v).toLocaleString("ja-JP")}`)

// マテリアル表示名: 「{コード} {原作名}　{マテリアル名}」。原作名が無い文脈では「{コード} {マテリアル名}」。
//   例: LO-2026-0015-001 ＜原作名＞　原作ゲームデザイン
const matDisplay = (code?: string | null, srcTitle?: string | null, name?: string | null) =>
  (srcTitle
    ? `${code || "—"} ${srcTitle}　${name || ""}`
    : `${code || "—"} ${name || ""}`
  ).trimEnd()


// 増分⑤: 中カードの作品(own)基本情報インライン編集の選択肢(WorkModelPanel と同一)。
const WORK_TYPES = ["board_game", "trpg_book", "supplement", "digital"]
const WORK_STATUS = ["planning", "in_production", "released", "suspended", "discontinued"]
// UIC-13(段階A): 派生種別。旧 WorkModelPanel の DERIV_CHOICES を移植(系譜・派生設定を Works へ)。
const DERIV_CHOICES: [string, string][] = [
  ["", "(なし・原版)"],
  ["translation", "翻訳"],
  ["edition", "版"],
  ["title_change", "改題"],
  ["localization", "地域化"],
  ["adaptation", "翻案"],
]
const DERIV_LABEL: Record<string, string> = Object.fromEntries(DERIV_CHOICES)

function EdgeRow({
  e,
  side,
  materials,
  products,
  sourceWorks,
  vendors,
  onLink,
}: {
  e: Edge
  side: "up" | "down"
  materials: any[]
  products: any[]
  sourceWorks: any[]
  vendors: any[]
  onLink: (edgeId: number, patch: any) => void
}) {
  const node =
    side === "up"
      ? e.source_material_code
        ? `${e.source_material_code} ${e.source_material_name || ""}`
        : e.source_work_code
          ? `${e.source_work_code} ${e.source_work_title || ""}`
          : ""
      : e.product_code
        ? `${e.product_code} ${e.product_name || ""}`
        : ""
  return (
    <div className="border border-border rounded-md px-2.5 py-2 text-[11px] font-mono space-y-1 bg-card">
      <div className="flex items-center gap-1.5 flex-wrap">
        <KindBadge kind={e.transaction_kind} />
        <span className="font-semibold truncate">{e.subject || e.line_code || `#${e.id}`}</span>
      </div>
      {node && <div className="text-muted-foreground truncate">◦ {node}</div>}
      <div className="flex items-center gap-2 text-muted-foreground">
        {e.counterparty && <span className="truncate">{e.counterparty}</span>}
        {e.payment_scheme === "royalty"
          ? e.rate_pct && <span>{e.rate_pct}%</span>
          : e.amount_ex_tax && <span>{yen(e.amount_ex_tax)}</span>}
      </div>
      {/* ④' 許諾地域: 個別条件書の condition_line から引用(読み取り専用)。外部ライセンス派生で特に重要。 */}
      {e.territory_label && (
        <div
          className="flex items-center gap-1 text-[10px] text-muted-foreground/80"
          title="許諾地域・言語（個別条件書の条件明細から引用）"
        >
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{e.territory_label}</span>
        </div>
      )}
      {e.document_number && (
        <div className="text-[10px] text-muted-foreground/70 truncate">{e.document_number}</div>
      )}
      {/* 増分③/⑥: エッジをノードへ参照リンク(支払→原作/素材 / 受取→製品) */}
      {side === "up" ? (
        <div className="space-y-1">
          {/* 増分⑥: 支払エッジを原作(source_work_id)へ参照リンク */}
          <select
            value={e.source_work_id ?? ""}
            onChange={(ev) => onLink(e.id, { source_work_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この支払を原作に紐付け"
          >
            <option value="">— 原作に紐付け —</option>
            {sourceWorks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.source_code || s.work_code || "—"} {s.title}
              </option>
            ))}
          </select>
          <select
            value={e.source_material_id ?? ""}
            onChange={(ev) => onLink(e.id, { source_material_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この支払を素材に紐付け"
          >
            <option value="">— 素材に紐付け —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.material_code || "—"} {m.material_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1">
          {/* 増分⑦: 受取エッジを受取先(取引先)へ参照リンク。
              8タブ移行 Phase 1: 生 select → 共通 EntityCombobox(entity="vendor")。 */}
          <EntityCombobox
            entity="vendor"
            value={e.counterparty_vendor_id != null ? String(e.counterparty_vendor_id) : null}
            onSelect={(opt) =>
              onLink(e.id, { counterparty_vendor_id: opt ? Number(opt.id) : null })
            }
            placeholder="受取先(取引先)に紐付け"
          />
          <select
            value={e.product_id ?? ""}
            onChange={(ev) => onLink(e.id, { product_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この受取を製品に紐付け"
          >
            <option value="">— 製品に紐付け —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.product_code || "—"} {p.product_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

export function WorkGraphPanel({ embedded = false }: { embedded?: boolean } = {}) {
  // 8タブ移行 Phase 5: state/effect/handler は WorkDetailContext へ持ち上げ済み。
  //   本パネルは①概要タブの描画専任（context を消費するだけ）。embedded=false 経路は
  //   /master/work-graph が /works へリダイレクトされたため実質デッド（互換のため残置）。
  const {
    works, workId, setWorkId, graph, loading, work, upstream, downstream, materials, products, isSource, navigate,
    matName, setMatName, matType, setMatType, adding, addMaterial,
    editing, setEditing, form, setForm, saving, saveErr, startEdit, saveEdit,
    sourceWorks, uses, newOwnTitle, setNewOwnTitle, creatingOwn, createOwnFromSource,
    showNewSource, setShowNewSource, newSourceTitle, setNewSourceTitle, creatingSource, createSource, createLicenseDocForSource,
    vendors, prodName, setProdName, prodFormat, setProdFormat, prodMsrp, setProdMsrp, addingProduct, addProduct,
    linkEdge,
    edgeDoc, setEdgeDoc, edgeLines, edgeSearching, edgeSearched, searchEdges, attachEdge, newDocTemplate, setNewDocTemplate, issueNewConditionDoc,
    pickerSource, setPickerSource, pickerLoading, pickerLines, pickerMaterials, pickerLineMat, setPickerLineMat, loadPicker, addComponentLine, removeComponentLine, pickerGroups, pickerSrcTitle,
    matCondOpen, setMatCondOpen, toggleMatCond, openMatEditor,
    matEditId, setMatEditId, matEditForm, setMatEditForm, matEditSaving, matEditErr, startEditCond, saveEditCond, deleteCond,
    matRecallDoc, setMatRecallDoc, matRecallLines, matRecallLoading, recallByDoc, assignRecalled, srcMatConds,
    consumedGroups, parentCandidates,
  } = useWorkDetail()
  const inputCls =
    "w-full text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"

  return (
    <div className={embedded ? "space-y-5" : "px-6 py-6 max-w-[1500px] mx-auto space-y-5"}>
      {!embedded && (
      <header className="border-b border-border pb-5">
        <p className="retro-tag mb-1.5">WORK · GRAPH</p>
        <h2 className="text-2xl font-semibold tracking-tight">権利フロー（3カード）</h2>
        <p className="text-xs text-muted-foreground mt-1.5">
          原作 → 作品 → 派生物 を 向き×種別の条件明細でつなぐグラフ表示（統合Phase3c・ビュー）。
        </p>
        {/* 関係の明確化: 原作=マテリアルの集合 / 許諾はマテリアル単位 / 作品=必要マテリアルを選んで構成。
            利用者のメンタルモデル（作品G→C,D→条件）をそのまま図示して 3者の関係を伝える。 */}
        <details className="mt-3 rounded-md border border-border bg-muted/30 text-[11px] font-mono">
          <summary className="cursor-pointer px-3 py-1.5 font-bold text-foreground/90 select-none">
            ℹ️ 原作・原作マテリアル・作品の関係（クリックで開く）
          </summary>
          <div className="px-3 pb-2.5 pt-0.5 space-y-1.5 text-muted-foreground leading-relaxed">
            <p>
              <span className="font-bold text-primary">原作</span> は1つ以上の{" "}
              <span className="font-bold text-success">原作マテリアル</span>{" "}
              で構成されます（マテリアルごとに権利者が異なる場合があります）。
              <span className="font-bold">利用許諾条件はマテリアル単位</span>でぶら下がります。
            </p>
            <p>
              <span className="font-bold text-info">作品</span> は原作から
              <span className="font-bold">必要なマテリアルだけを選んで</span>構成します。
              選んだマテリアルの条件が、この作品の<span className="font-bold">履行義務（支払う利用料）</span>になります。
            </p>
            <div className="rounded border border-border bg-card px-2.5 py-1.5 text-[10px]">
              例: 原作A（マテリアル B / C / D / F）から <span className="font-bold text-success">C・D</span> を使う作品G
              → 作品Gの利用許諾条件書に載るのは <span className="font-bold text-success">C・D の条件</span>。
            </div>
          </div>
        </details>
        <div className="mt-3 max-w-md">
          {/* 作品数の増加に耐えるよう検索型ピッカー(かな・別名でもヒット)。 */}
          <WorkPicker
            items={works.map((w: any) => toWorkPickerItem(w))}
            value={workId || undefined}
            onSelect={(w) => setWorkId(w ? String(w.id) : "")}
            placeholder="作品を検索 (コード / タイトル / 別名)"
          />
        </div>
      </header>
      )}

      {/* DQ-04: データ完全性。8タブ移行では⑧監査・完全性タブへ移設(embedded 時は非表示)。 */}
      {!embedded && workId ? (
        <CompletenessPanel
          entityType="work"
          entityId={workId}
          reloadKey={editing}
          onRemediate={() => startEdit()}
        />
      ) : null}

      {/* 契約・権利ツリー。8タブ移行では⑤契約・条件タブへ移設(embedded 時は非表示)。 */}
      {!embedded && workId ? <RightsTreePanel workId={workId} /> : null}

      {loading ? (
        <div className="text-xs text-muted-foreground py-8 text-center">読み込み中…</div>
      ) : !work ? (
        <div className="text-xs text-muted-foreground py-8 text-center">作品を選択してください。</div>
      ) : (
        <>
        {/* PLW-D: 作品1:文書N:明細N。8タブ移行では⑦文書・証憑タブへ移設(embedded 時は非表示)。 */}
        {!embedded && <WorkAttributionsPanel workId={workId} />}
        {/* 関係の明確化: 作品(own)が「どの原作のどのマテリアルを利用し、何を履行するか」をマテリアル単位でまとめて先頭に表示。
            これがこの作品の利用許諾条件書に載る条件（=支払う利用料）の実体であることを明示する。 */}
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
                        {/* 相手方(支払先の取引先)。誰に利用料を払うかを明示し、3者の関係を補強する。 */}
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
        {/* 本丸(原作ビュー): 原作 → マテリアル(権利者) → 条件明細(算定) の 1原作:N材料:N条件 を
            一目で見せる構成ツリー。クリックせずに全体構造が把握できる(下の中カードで編集)。 */}
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
            {/* 原作⇄作品の往復: この原作を利用している自社作品へのクイックリンク（原作→作品）。 */}
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
                まだマテリアルがありません。下の中カードの「素材を追加」から登録してください。
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr,1fr] gap-3 items-start">
          {/* 左 = 原作 / 素材調達（支払）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">原作 / 調達（支払）▶</h3>
                <Badge variant="outline" className="border-warning/40 text-warning">支払 {upstream.length}</Badge>
              </div>
              {/* 増分⑥+(§3.2/決定§8.2): 原作をその場で新規登録 → 候補一覧に追加し各支払エッジで選択可に */}
              {!isSource && (
                <div className="border-b border-border/60 pb-2">
                  {!showNewSource ? (
                    <button
                      type="button"
                      onClick={() => setShowNewSource(true)}
                      className="text-[11px] font-mono px-2 py-0.5 rounded border border-success text-success hover:bg-success/10"
                    >
                      ＋ 原作を新規
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={newSourceTitle}
                          onChange={(e) => setNewSourceTitle(e.target.value)}
                          placeholder="原作タイトル *"
                          autoFocus
                          className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                        />
                        <button
                          type="button"
                          onClick={createSource}
                          disabled={creatingSource || !newSourceTitle.trim()}
                          className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
                        >
                          {creatingSource ? "作成中…" : "作成"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowNewSource(false); setNewSourceTitle("") }}
                          className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                        >
                          取消
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">
                        作成後、各支払エッジの「原作に紐付け」から選べます（LO- 採番）。
                      </p>
                    </div>
                  )}
                </div>
              )}
              {upstream.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">支払エッジはありません。</p>
              ) : (
                upstream.map((e) => (
                  <React.Fragment key={e.id}>
                    <EdgeRow e={e} side="up" materials={materials} products={products} sourceWorks={sourceWorks} vendors={vendors} onLink={linkEdge} />
                  </React.Fragment>
                ))
              )}
            </CardContent>
          </Card>

          {/* 中 = 作品（own） / 原作（source, 増分⑥）*/}
          <Card className="border-foreground/30">
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">{isSource ? "原作（source）" : "作品（own）"}</h3>
                {!editing && !isSource && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  >
                    編集
                  </button>
                )}
              </div>
              {editing ? (
                /* 増分⑤: 基本情報インライン編集 */
                <div className="space-y-2.5">
                  {/* 8タブ移行 Phase 3: ①概要の基本情報を共通 AppFormField/NativeSelect へ。
                      保存(saveEdit)の PUT ペイロードは一切変えない(§20)。 */}
                  <div className="text-[11px] font-mono font-bold text-muted-foreground">
                    {work.work_code}
                  </div>
                  <AppFormField label="タイトル" htmlFor="wg-title" required>
                    <Input
                      id="wg-title"
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="作品タイトル"
                    />
                  </AppFormField>
                  <AppFormField label="タイトル(カナ)" htmlFor="wg-kana">
                    <Input
                      id="wg-kana"
                      value={form.title_kana}
                      onChange={(e) => setForm((f) => ({ ...f, title_kana: e.target.value }))}
                      placeholder="タイトル(カナ)"
                    />
                  </AppFormField>
                  <CompactFormGrid columns={2}>
                    <AppFormField label="種別" htmlFor="wg-type" code="work_type">
                      <NativeSelect
                        id="wg-type"
                        value={form.work_type}
                        onChange={(e) => setForm((f) => ({ ...f, work_type: e.target.value }))}
                      >
                        <option value="">—</option>
                        {WORK_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </NativeSelect>
                    </AppFormField>
                    <AppFormField label="状態" htmlFor="wg-status" code="status">
                      <NativeSelect
                        id="wg-status"
                        value={form.status}
                        onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                      >
                        <option value="">—</option>
                        {WORK_STATUS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </NativeSelect>
                    </AppFormField>
                  </CompactFormGrid>
                  <AppFormField
                    label="区分"
                    htmlFor="wg-division"
                    code="division"
                    description="カンマ区切り（例: BDG, PUB）"
                  >
                    <Input
                      id="wg-division"
                      value={form.division}
                      onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))}
                      placeholder="BDG, PUB"
                    />
                  </AppFormField>
                  {/* UIC-13(段階A): 系譜・派生設定。8タブ移行 Phase 4: 共通 primitive へ(in place)。
                      派生元を指定すると翻訳版・改題版などのチェーンになる。保存(saveEdit)は不変(§20)。
                      ※物理的な②作品系譜タブへの移設は WorkGraphPanel の state 持ち上げ(container/
                        section 分割)が前提のため別途。work_relations 複数関係の正本化は別PR。 */}
                  <div className="pt-2 space-y-2.5 border-t border-dashed border-border">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">系譜・派生</div>
                    <AppFormField
                      label="派生元(親作品/原作)"
                      htmlFor="wg-parent"
                      code="parent_work_id"
                      description="指定すると翻訳版・改題版などのチェーンになる（無ければ原版）"
                    >
                      <EntityCombobox
                        items={parentCandidates.map((w) => ({
                          id: w.id,
                          code: w.code,
                          label: w.title,
                          sub: w.sub,
                          raw: w,
                        }))}
                        value={form.parent_work_id || null}
                        onSelect={(opt) =>
                          setForm((f) => ({ ...f, parent_work_id: opt ? String(opt.id) : "" }))
                        }
                        placeholder="派生元を検索 — 無ければ原版"
                      />
                    </AppFormField>
                    <AppFormField label="派生種別" htmlFor="wg-deriv" code="derivation_type">
                      <NativeSelect
                        id="wg-deriv"
                        value={form.derivation_type}
                        onChange={(e) => setForm((f) => ({ ...f, derivation_type: e.target.value }))}
                      >
                        {DERIV_CHOICES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </NativeSelect>
                    </AppFormField>
                  </div>
                  <AppFormField label="備考" htmlFor="wg-remarks" code="remarks">
                    <Textarea
                      id="wg-remarks"
                      value={form.remarks}
                      onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                      placeholder="備考"
                      rows={2}
                    />
                  </AppFormField>
                  {saveErr && <p role="alert" className="text-[10px] font-mono text-destructive">{saveErr}</p>}
                  <div className="flex items-center justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={saving || !form.title?.trim()}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
                    >
                      {saving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] font-mono">
                  <div className="font-bold">{work.work_code}</div>
                  <div>{work.title}</div>
                  {work.title_kana && <div className="text-muted-foreground">{work.title_kana}</div>}
                  {(work.work_type || work.status) && (
                    <div className="text-muted-foreground">
                      {work.work_type || "—"} / {work.status || "—"}
                    </div>
                  )}
                  {/* UIC-13(段階A): 系譜・派生の読み取り表示。 */}
                  {work.parent_work_id != null && (
                    <div className="text-muted-foreground">
                      派生元: {(() => {
                        const p = [...works, ...sourceWorks].find(
                          (w: any) => String(w.id) === String(work.parent_work_id)
                        )
                        return p ? `${p.work_code || p.source_code || `#${p.id}`} ${p.title || ""}`.trim() : `#${work.parent_work_id}`
                      })()}
                      {work.derivation_type ? `（${DERIV_LABEL[work.derivation_type] || work.derivation_type}）` : ""}
                    </div>
                  )}
                </div>
              )}
              {/* 増分⑥(§3.4): 原作中心ビュー — この原作を利用している自社作品 + 新規作成 */}
              {isSource && (
                <div className="border-t border-border/60 pt-2 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    この原作を利用している自社作品
                  </div>
                  {uses.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">まだありません。</p>
                  ) : (
                    uses.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => navigate(`/works/${u.id}`)}
                        className="block w-full text-left text-[11px] font-mono border border-border/60 rounded px-2 py-1 hover:border-foreground/40"
                      >
                        <span className="font-semibold">{u.work_code}</span> {u.title}
                      </button>
                    ))
                  )}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      value={newOwnTitle}
                      onChange={(e) => setNewOwnTitle(e.target.value)}
                      placeholder="この原作から作品を新規作成"
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={createOwnFromSource}
                      disabled={creatingOwn || !newOwnTitle.trim()}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
                    >
                      {creatingOwn ? "作成中…" : "作成"}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    作成後、その作品の支払エッジで「原作に紐付け」するとリンクされます。
                  </p>
                </div>
              )}

              {/* 設計 v1.4 Phase C(UIC-02): 原作の利用許諾条件は「個別利用許諾条件書」文書フォームで起票。
                  旧 v3 ライセンスマトリクス(直接保存する license-matrix API)は撤去し、
                  条件明細の唯一の書込み口＝Document Command へ一本化した。既存条件は下の素材一覧で閲覧。 */}
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

              {materials.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    素材{isSource && "（クリックで条件明細を確認）"}
                  </div>
                  {materials.map((m) => (
                    <div key={m.id} id={`srcmat-${m.id}`} className="text-[11px] font-mono border border-border/60 rounded overflow-hidden scroll-mt-20">
                      {isSource ? (
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
                      ) : (
                        <div className="px-2 py-1">
                          <span className="font-semibold">{m.material_code || "—"}</span> {m.material_name}
                          {m.is_default && <Badge variant="outline" className="ml-1 border-success/40 text-success">本体</Badge>}
                          {m.rights_holder && <span className="text-[10px] text-warning"> · 権利者: {m.rights_holder}</span>}
                        </div>
                      )}
                      {isSource && matCondOpen === m.id && (
                        <div className="border-t border-border/60 p-2 space-y-2 bg-muted/20">
                          {/* 条件の追加・編集は「個別利用許諾条件書」文書フォームに一本化。
                              ここは既存条件の確認＋文書由来条件の紐づけ(下の details)のみ。 */}
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
                  ))}
                </div>
              )}
              {/* 増分②: 素材を追加(work_material)。{work_code}-NNN を自動採番。 */}
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
              {products.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">製品(SKU)</div>
                  {products.map((p) => (
                    <div key={p.id} className="text-[11px] font-mono border border-border/60 rounded px-2 py-1">
                      <span className="font-semibold">{p.product_code || "—"}</span> {p.product_name}
                      {p.format && <span className="text-muted-foreground"> · {p.format}</span>}
                      {p.msrp != null && <span className="text-muted-foreground"> · {yen(p.msrp)}</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* 増分⑦: 製品(SKU)を追加(own のみ)。product_code は API で {work_code}-P-NNN 採番。 */}
              {!isSource && (
                <div className="border-t border-border/60 pt-2 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">製品を追加</div>
                  <input
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="製品名 (例: 通常版)"
                    className={inputCls}
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={prodFormat}
                      onChange={(e) => setProdFormat(e.target.value)}
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1"
                    >
                      <option value="">形態 —</option>
                      <option value="physical">physical</option>
                      <option value="ebook">ebook</option>
                      <option value="print_on_demand">print_on_demand</option>
                    </select>
                    <input
                      value={prodMsrp}
                      onChange={(e) => setProdMsrp(e.target.value)}
                      inputMode="numeric"
                      placeholder="希望小売価格"
                      className="flex-1 text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={addProduct}
                      disabled={addingProduct || !prodName.trim()}
                      className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
                    >
                      {addingProduct ? "追加中…" : "追加"}
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右 = 受取（派生物 / 物販アウト）*/}
          <Card>
            <CardContent className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold">◀ 受取（派生物 / 卸）</h3>
                <Badge variant="outline" className="border-success/40 text-success">受取 {downstream.length}</Badge>
              </div>
              {downstream.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">受取エッジはありません。</p>
              ) : (
                downstream.map((e) => (
                  <React.Fragment key={e.id}>
                    <EdgeRow e={e} side="down" materials={materials} products={products} sourceWorks={sourceWorks} vendors={vendors} onLink={linkEdge} />
                  </React.Fragment>
                ))
              )}
            </CardContent>
          </Card>
        </div>
        {/* N:N活性化 Stage3: 原作起点ピッカー — 原作を選ぶ→その利用許諾条件明細を共有結線 */}
        {!isSource && (
          <div className="rounded-md border border-dashed border-primary/40 p-3 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              ＋ 原作のマテリアル条件から、この作品で使うものを選ぶ
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              原作を選ぶ→各条件に「利用するマテリアル」を指定→「この作品に追加」。追加した条件がこの作品の履行義務（上のサマリー）になります。
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">原作:</span>
              {/* 原作数の増加に耐えるよう検索型ピッカー(かな・別名でもヒット)。 */}
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
            {/* ツリー: 原作 → マテリアル → 条件明細。マテリアル確定済みはヘッダ配下に束ね、
                未割当グループは各条件でマテリアルを選んでから追加する。 */}
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
              ※ 各明細に「原作素材」を選んでこの作品へ結線します（条件はマテリアルにぶら下がる）。同じ明細を複数の作品で共有でき（N:N）、「外す」はこの作品ぶんだけ解除します。明細が出ない場合は、支払エッジの「原作に紐付け」で出所原作を設定してください。
            </p>
          </div>
        )}
        {/* 増分⑧: 個別条件書から condition_lines をこの作品へ参照リンク(§3.6/§10.7: 明細は新規作成しない) */}
        <div className="rounded-md border border-dashed border-input p-3 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            ＋ 条件明細をこの作品に追加（個別条件書から参照）
          </div>
          {/* (B) A1-軽量(§10.7): ここから個別条件書を起票 → 保存で明細生成 → 戻って下の検索で結合 */}
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
        </>
      )}
    </div>
  )
}
