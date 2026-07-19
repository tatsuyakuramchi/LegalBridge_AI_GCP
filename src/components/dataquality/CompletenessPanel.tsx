/**
 * CompletenessPanel — 作品詳細に出す完全性パネル(DQ-04)。
 *   スコア + 未解消 Issue 一覧 + 修正 CTA。データが無い(未評価 / worker 未デプロイ)ときは
 *   何も描画しない(degrade)。自身で fetch し、work 変更で再取得する。
 */
import * as React from "react";
import { ShieldCheck, ShieldAlert, RefreshCw, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { getEntityCompleteness, type DqEntityResult, type DqIssue } from "@/src/lib/api/dataQualityClient";

const SEV_CLS: Record<string, string> = {
  // UIC-24: 状態色トークン(severity-*)を使用。light/dark 両対応。
  BLOCKER: "border-[hsl(var(--severity-blocker)_/_0.45)] text-[hsl(var(--severity-blocker))] bg-[hsl(var(--severity-blocker)_/_0.1)]",
  ERROR: "border-[hsl(var(--severity-error)_/_0.45)] text-[hsl(var(--severity-error))] bg-[hsl(var(--severity-error)_/_0.1)]",
  WARNING: "border-[hsl(var(--severity-warning)_/_0.45)] text-[hsl(var(--severity-warning))] bg-[hsl(var(--severity-warning)_/_0.1)]",
  INFO: "border-border text-muted-foreground bg-muted/50",
};

export function CompletenessPanel({
  entityType = "work",
  entityId,
  onRemediate,
  reloadKey,
}: {
  entityType?: string;
  entityId: number | string | null | undefined;
  /** Issue の「修正」押下時。remediation_type で導線を分岐する側に委譲。 */
  onRemediate?: (issue: DqIssue) => void;
  /** 値が変わると再取得(保存後などに親から bump する)。 */
  reloadKey?: unknown;
}) {
  const [data, setData] = React.useState<DqEntityResult | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    if (entityId == null || entityId === "") {
      setData(null);
      return;
    }
    setLoading(true);
    getEntityCompleteness(entityType, entityId)
      .then((r) => alive && setData(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entityType, entityId, reloadKey]);

  // 未デプロイ / 未評価 は静かに非表示(既存画面を壊さない)。
  if (!data) return null;

  const s = data.summary;
  const issues = data.open_issues || [];
  const ok = (s.blocker_count || 0) + (s.error_count || 0) + (s.warning_count || 0) === 0;
  const HeadIcon = ok ? ShieldCheck : ShieldAlert;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <HeadIcon className={cn("h-4 w-4", ok ? "text-emerald-600" : "text-rose-600")} />
          <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
            完全性
          </span>
          <span
            className={cn(
              "rounded-sm border px-1.5 py-0.5 text-[10px] font-mono font-bold",
              ok ? "border-emerald-300 text-emerald-700" : "border-rose-300 text-rose-700"
            )}
          >
            {s.score}/100
          </span>
          {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          {s.blocker_count > 0 && <span className="text-rose-700">必須 {s.blocker_count}</span>}
          {s.error_count > 0 && <span className="text-amber-700">要修正 {s.error_count}</span>}
          {s.warning_count > 0 && <span className="text-yellow-700">注意 {s.warning_count}</span>}
        </div>
      </div>

      {ok ? (
        <p className="px-3 py-2 text-[11px] font-mono text-muted-foreground">未解消の不足はありません。</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {issues.map((it) => (
            <li key={it.id} className="flex items-center gap-2 px-3 py-1.5">
              <span
                className={cn(
                  "shrink-0 rounded-sm border px-1 py-0.5 text-[9px] font-mono font-bold",
                  SEV_CLS[it.severity] || SEV_CLS.INFO
                )}
              >
                {it.severity}
              </span>
              <span className="flex-1 truncate text-[11px] font-mono" title={`${it.rule_code}: ${it.rule_title}`}>
                {it.rule_title}
                {it.stage && <span className="text-muted-foreground/70"> ({it.stage})</span>}
              </span>
              {onRemediate && (
                <button
                  type="button"
                  onClick={() => onRemediate(it)}
                  className="shrink-0 inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted"
                >
                  修正 <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
