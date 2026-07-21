/**
 * ② 作品系譜 — 派生元（親）チェーンと、この作品を親とする派生作品の read ビュー。
 *   8タブ移行 Phase 6。系譜・派生の「編集」は①概要の基本情報フォーム（1 フォーム/1 保存）に
 *   集約し、本タブは既にロード済みのデータ（works / source-ips / uses）から導出する読み取り表示に
 *   徹する（新規 API 呼び出しなし・§20）。派生の正本化（work_relations 複数関係）は別 PR。
 */
import * as React from "react"
import { EmptyState } from "@/components/EmptyState"
import { useWorkDetail } from "@/src/pages/works/WorkDetailContext"
import { DERIV_LABEL } from "./shared"

const label = (w: any) =>
  `${w.work_code || w.source_code || `#${w.id}`} ${w.title || ""}`.trim()

export const WorkLineageSection: React.FC = () => {
  const { work, works, sourceWorks, uses, isSource, navigate } = useWorkDetail()

  if (!work) return <EmptyState title="作品を選択してください" />

  const parent =
    work.parent_work_id != null
      ? [...works, ...sourceWorks].find((w: any) => String(w.id) === String(work.parent_work_id)) || null
      : null

  // この作品/原作を親とする派生作品（own 側の parent_work_id 一致）。
  const children = works.filter((w: any) => work.id != null && String(w.parent_work_id) === String(work.id))

  return (
    <div className="space-y-4">
      {/* 派生元（親）*/}
      <section className="rounded-md border border-border p-3 space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">派生元（親）</div>
        {work.parent_work_id == null ? (
          <p className="text-[11px] font-mono text-muted-foreground">原版（派生元なし）</p>
        ) : parent ? (
          <button
            type="button"
            onClick={() => navigate(`/works/${parent.id}`)}
            className="block text-left text-[12px] font-mono border border-border/60 rounded px-2 py-1.5 hover:border-foreground/40"
          >
            <span className="font-semibold">{label(parent)}</span>
            {work.derivation_type ? (
              <span className="ml-1.5 text-[10px] text-primary">
                （{DERIV_LABEL[work.derivation_type] || work.derivation_type}）
              </span>
            ) : null}
            <span className="ml-1 text-muted-foreground"> ↗</span>
          </button>
        ) : (
          <p className="text-[11px] font-mono text-muted-foreground">
            #{work.parent_work_id}
            {work.derivation_type ? `（${DERIV_LABEL[work.derivation_type] || work.derivation_type}）` : ""}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground/70">
          系譜・派生の設定（派生元／派生種別）は「① 概要」タブの編集で変更します。
        </p>
      </section>

      {/* この作品を親とする派生作品 */}
      <section className="rounded-md border border-border p-3 space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          この作品を派生元とする作品
        </div>
        {children.length === 0 ? (
          <p className="text-[11px] font-mono text-muted-foreground">派生作品はありません。</p>
        ) : (
          <div className="space-y-1">
            {children.map((c: any) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/works/${c.id}`)}
                className="block w-full text-left text-[12px] font-mono border border-border/60 rounded px-2 py-1.5 hover:border-foreground/40"
              >
                <span className="font-semibold">{label(c)}</span>
                {c.derivation_type ? (
                  <span className="ml-1.5 text-[10px] text-primary">
                    （{DERIV_LABEL[c.derivation_type] || c.derivation_type}）
                  </span>
                ) : null}
                <span className="ml-1 text-muted-foreground"> ↗</span>
              </button>
            ))}
          </div>
        )}
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
