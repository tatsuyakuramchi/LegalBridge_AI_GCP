/**
 * ① 概要 — 作品(own)/原作(source)の基本情報（アイデンティティ）。8タブ移行 Phase 6。
 *   旧 WorkGraphPanel 中カードの基本情報インライン編集（基本情報＋系譜・派生を 1 フォーム/1 保存）と、
 *   原作ビューの「この原作を利用している自社作品／新規作成」を移設。
 *   保存(saveEdit)の PUT ペイロード・alternative_titles passthrough・DQ 発火は不変（§20）。
 */
import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/native-select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/EmptyState"
import { EntityCombobox, AppFormField, CompactFormGrid } from "@/src/components/form"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { WORK_TYPES, WORK_STATUS, DERIV_CHOICES, DERIV_LABEL } from "./shared"

export const WorkOverviewSection: React.FC = () => {
  const {
    work, editing, setEditing, startEdit, form, setForm, saving, saveErr, saveEdit,
    isSource, works, sourceWorks, navigate, uses, newOwnTitle, setNewOwnTitle, creatingOwn, createOwnFromSource,
    parentCandidates,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  return (
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
          /* 基本情報＋系譜・派生を共通 AppFormField/NativeSelect へ。保存の PUT ペイロードは不変(§20)。 */
          <div className="space-y-2.5">
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
            {/* 系譜・派生設定。派生元を指定すると翻訳版・改題版などのチェーンになる。保存は不変(§20)。 */}
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
            {/* 系譜・派生の読み取り表示。 */}
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
        {/* 原作中心ビュー — この原作を利用している自社作品 + 新規作成 */}
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
      </CardContent>
    </Card>
  )
}

export default WorkOverviewSection
