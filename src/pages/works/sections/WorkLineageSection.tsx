/**
 * ② 作品系譜 — 作品間の派生関係（work_relations, 0138）を多対多で管理。
 *   派生元（親）を複数追加/削除でき、派生物（子）は読み取り表示。
 *   works.parent_work_id は backend が「主たる親」ミラーとして自動維持するため、
 *   receivableMap（分配マップ）/ DQ / ①概要 / 一覧 は従来どおり動く（§20）。
 *   ①概要の「派生元」編集は主たる親のクイック設定として work_relations にも反映される。
 */
import * as React from "react"
import { EmptyState } from "@/components/EmptyState"
import { NativeSelect } from "@/components/ui/native-select"
import { EntityCombobox } from "@/src/components/form"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { DERIV_CHOICES, DERIV_LABEL } from "./shared"

const relLabel = (r: any, idKey: "parent_work_id" | "child_work_id") =>
  `${r.work_code || `#${r[idKey]}`} ${r.title || ""}`.trim()

export const WorkLineageSection: React.FC = () => {
  const {
    work, navigate, isSource, uses,
    relations, relationsLoading, relForm, setRelForm, addingRelation, relationErr, addRelation, deleteRelation,
    parentCandidates,
  } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  const { parents, children } = relations

  return (
    <div className="space-y-4">
      {/* 派生元（親）関係 — 複数可 */}
      <section className="rounded-md border border-border p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          派生元（親）— 複数指定できます
        </div>
        {relationsLoading ? (
          <p className="text-[11px] font-mono text-muted-foreground">読み込み中…</p>
        ) : parents.length === 0 ? (
          <p className="text-[11px] font-mono text-muted-foreground">原版（派生元なし）</p>
        ) : (
          <div className="space-y-1">
            {parents.map((r: any) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 text-[12px] font-mono border border-border/60 rounded px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/works/${r.parent_work_id}`)}
                  className="min-w-0 text-left hover:underline truncate"
                  title="この作品を開く"
                >
                  <span className="font-semibold">{relLabel(r, "parent_work_id")}</span>
                  {r.relation_type ? (
                    <span className="ml-1.5 text-[10px] text-primary">
                      （{DERIV_LABEL[r.relation_type] || r.relation_type}）
                    </span>
                  ) : null}
                  <span className="ml-1 text-muted-foreground"> ↗</span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRelation(r.id)}
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                  title="この派生元を外す"
                >
                  外す
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 派生元を追加 */}
        <div className="border-t border-dashed border-border pt-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">派生元を追加</div>
          <EntityCombobox
            items={parentCandidates.map((w) => ({
              id: w.id,
              code: w.code,
              label: w.title,
              sub: w.sub,
              raw: w,
            }))}
            value={relForm.parent_work_id || null}
            onSelect={(opt) =>
              setRelForm((f) => ({ ...f, parent_work_id: opt ? String(opt.id) : "" }))
            }
            placeholder="派生元（親作品/原作）を検索"
          />
          <div className="flex items-center gap-1.5">
            <NativeSelect
              value={relForm.relation_type || ""}
              onChange={(e) => setRelForm((f) => ({ ...f, relation_type: e.target.value }))}
              className="h-7 text-[11px] flex-1"
            >
              {DERIV_CHOICES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </NativeSelect>
            <button
              type="button"
              onClick={() => void addRelation()}
              disabled={addingRelation || !relForm.parent_work_id}
              className="text-[11px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
            >
              {addingRelation ? "追加中…" : "追加"}
            </button>
          </div>
          {relationErr && <p className="text-[10px] text-destructive">{relationErr}</p>}
          <p className="text-[10px] text-muted-foreground/70">
            先頭（最初に登録した派生元）が「主たる親」として①概要・分配マップに反映されます。
          </p>
        </div>
      </section>

      {/* この作品を派生元とする作品（子） */}
      <section className="rounded-md border border-border p-3 space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          この作品を派生元とする作品（派生物）
        </div>
        {children.length === 0 ? (
          <p className="text-[11px] font-mono text-muted-foreground">派生作品はありません。</p>
        ) : (
          <div className="space-y-1">
            {children.map((r: any) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/works/${r.child_work_id}`)}
                className="block w-full text-left text-[12px] font-mono border border-border/60 rounded px-2 py-1.5 hover:border-foreground/40"
              >
                <span className="font-semibold">{relLabel(r, "child_work_id")}</span>
                {r.relation_type ? (
                  <span className="ml-1.5 text-[10px] text-primary">
                    （{DERIV_LABEL[r.relation_type] || r.relation_type}）
                  </span>
                ) : null}
                <span className="ml-1 text-muted-foreground"> ↗</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70">
          子作品の登録は、その作品の②系譜で「派生元」にこの作品を追加してください。
        </p>
      </section>

      {/* 原作ビュー: この原作を利用している自社作品（利用関係） */}
      {isSource && (
        <section className="rounded-md border border-border p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            この原作を利用している自社作品
          </div>
          {uses.length === 0 ? (
            <p className="text-[11px] font-mono text-muted-foreground">まだありません。</p>
          ) : (
            <div className="space-y-1">
              {uses.map((u: any) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => navigate(`/works/${u.id}`)}
                  className="block w-full text-left text-[12px] font-mono border border-border/60 rounded px-2 py-1.5 hover:border-foreground/40"
                >
                  <span className="font-semibold">{u.work_code || `#${u.id}`}</span> {u.title}
                  <span className="ml-1 text-muted-foreground"> ↗</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default WorkLineageSection
