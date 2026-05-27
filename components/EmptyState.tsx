/**
 * EmptyState — Phase 23.0.4
 *
 * 「データなし」「該当なし」「未選択」を表す共通プレースホルダ。
 * 設計指針:
 *   - dashed border + bg-muted/20 (DeliveryLineItemTable / DocumentEditorPage
 *     の preview なしブロックで採用済みの統一スタイル)
 *   - アイコン + タイトル + 説明 + アクション (任意) の 4 スロット
 *   - 中央寄せ・固定高なし (親の高さに従う)
 */

import * as React from "react";
import { PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** 上部アイコン。省略時は PackageOpen */
  icon?: React.ReactNode;
  /** 主見出し */
  title: string;
  /** 補足 (任意) */
  description?: React.ReactNode;
  /** 行動を促すボタン等 (任意) */
  action?: React.ReactNode;
  /** 追加クラス。padding / 配色などを差し替えたいとき。 */
  className?: string;
  /** コンパクト表示 (行数が少ない / インライン用) */
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}) => (
  <div
    role="status"
    className={cn(
      "flex flex-col items-center justify-center text-center gap-2",
      "rounded-md border border-dashed border-input bg-muted/20",
      compact ? "p-3 text-slate-500" : "p-6 sm:p-8 text-slate-500",
      className
    )}
  >
    <span
      className={cn(
        "text-slate-400",
        compact ? "[&_svg]:h-5 [&_svg]:w-5" : "[&_svg]:h-7 [&_svg]:w-7"
      )}
      aria-hidden="true"
    >
      {icon ?? <PackageOpen />}
    </span>
    <p
      className={cn(
        "font-medium text-slate-700",
        compact ? "text-xs" : "text-sm"
      )}
    >
      {title}
    </p>
    {description && (
      <p
        className={cn(
          "text-slate-500",
          compact ? "text-[11px]" : "text-xs"
        )}
      >
        {description}
      </p>
    )}
    {action && <div className="mt-1">{action}</div>}
  </div>
);
