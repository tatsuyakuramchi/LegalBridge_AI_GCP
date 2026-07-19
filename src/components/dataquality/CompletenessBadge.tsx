/**
 * CompletenessBadge — 作品等の完全性スコアを示すコンパクトなチップ(DQ-04)。
 *   summary が無い(未評価 / worker 未デプロイ)ときは何も描画しない(degrade)。
 */
import * as React from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DqSummary } from "@/src/lib/api/dataQualityClient";

export function CompletenessBadge({ summary, className }: { summary: DqSummary | null | undefined; className?: string }) {
  if (!summary) return null;
  const blk = summary.blocker_count || 0;
  const err = summary.error_count || 0;
  const warn = summary.warning_count || 0;

  const tone = blk > 0 ? "blocker" : err > 0 ? "error" : warn > 0 ? "warning" : "ok";
  // UIC-24: severity / success トークンへ。light/dark 両対応。
  const cls =
    tone === "blocker"
      ? "border-[hsl(var(--severity-blocker)_/_0.45)] text-[hsl(var(--severity-blocker))] bg-[hsl(var(--severity-blocker)_/_0.1)]"
      : tone === "error"
        ? "border-[hsl(var(--severity-error)_/_0.45)] text-[hsl(var(--severity-error))] bg-[hsl(var(--severity-error)_/_0.1)]"
        : tone === "warning"
          ? "border-[hsl(var(--severity-warning)_/_0.45)] text-[hsl(var(--severity-warning))] bg-[hsl(var(--severity-warning)_/_0.1)]"
          : "border-success/40 text-success bg-success/10";
  const Icon = tone === "ok" ? ShieldCheck : tone === "warning" ? AlertTriangle : ShieldAlert;
  const label =
    tone === "ok"
      ? "完全"
      : [blk ? `必須${blk}` : "", err ? `要修正${err}` : "", warn ? `注意${warn}` : ""].filter(Boolean).join(" ");

  return (
    <span
      title={`完全性スコア ${summary.score}/100`}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-mono font-bold",
        cls,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{summary.score}</span>
      {label && tone !== "ok" && <span className="font-normal">/ {label}</span>}
    </span>
  );
}
