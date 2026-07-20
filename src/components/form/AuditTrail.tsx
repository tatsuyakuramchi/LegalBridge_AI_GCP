/**
 * AuditTrail — 登録・変更・waive・検証 等の履歴表示（設計 §8 / 共通部品表 AuditTrail）。
 *   read-only。データ源（DQ waiver / graph-link 変更ログ 等）が付き次第 items を供給する。
 *   当面は器のみ（items 空なら EmptyState 相当のメッセージ）。
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type AuditTone = "default" | "info" | "warning" | "success" | "danger";

export interface AuditItem {
  id: React.Key;
  actor?: string;
  /** ISO 文字列など。表示整形は呼び出し側 or ここで簡易整形。 */
  at?: string;
  action: React.ReactNode;
  detail?: React.ReactNode;
  tone?: AuditTone;
}

export interface AuditTrailProps {
  items?: AuditItem[];
  title?: React.ReactNode;
  empty?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

const TONE_DOT: Record<AuditTone, string> = {
  default: "bg-muted-foreground",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
};

export const AuditTrail: React.FC<AuditTrailProps> = ({
  items,
  title,
  empty,
  loading,
  className,
}) => {
  const list = items ?? [];
  return (
    <div className={cn("space-y-2", className)}>
      {title && <div className="text-[12px] font-medium text-muted-foreground">{title}</div>}
      {loading ? (
        <div className="py-4 text-center text-[12px] text-muted-foreground">読み込み中…</div>
      ) : list.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          {empty ?? "履歴はまだありません"}
        </div>
      ) : (
        <ol className="space-y-2">
          {list.map((it) => (
            <li key={it.id} className="flex gap-2.5">
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                  TONE_DOT[it.tone ?? "default"]
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <span className="font-medium text-foreground">{it.action}</span>
                  {it.actor && <span className="text-muted-foreground">{it.actor}</span>}
                  {it.at && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {it.at}
                    </span>
                  )}
                </div>
                {it.detail && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{it.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default AuditTrail;
