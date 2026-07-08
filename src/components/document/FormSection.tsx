import React from 'react';

import { cn } from '@/lib/utils';

interface FormSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'blue' | 'amber' | 'emerald' | 'indigo' | 'cyan' | 'red' | 'default';
  className?: string;
  headerActions?: React.ReactNode;
  /** アンカー用 id（誘導ウィザードのステップ・ジャンプ先）。 */
  id?: string;
}

// 新デザイン: 色付き上ボーダーのカード(SchemaDocumentForm の FkSection と統一)。
//   ※ ボディは従来と同じ 3 カラムグリッドを維持し、既存の col-span-full(明細表・
//     注記など)がそのまま全幅で効くようにする(レイアウト非破壊)。
const TOP: Record<NonNullable<FormSectionProps['variant']>, string> = {
  blue: 'border-t-sky-500',
  amber: 'border-t-amber-500',
  emerald: 'border-t-emerald-500',
  indigo: 'border-t-indigo-500',
  cyan: 'border-t-cyan-500',
  red: 'border-t-rose-500',
  default: 'border-t-foreground/40',
};
const TITLE: Record<NonNullable<FormSectionProps['variant']>, string> = {
  blue: 'text-sky-600',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
  indigo: 'text-indigo-600',
  cyan: 'text-cyan-600',
  red: 'text-rose-600',
  default: 'text-foreground',
};

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  icon,
  children,
  variant = 'default',
  className = '',
  headerActions,
  id,
}) => {
  return (
    <section
      id={id}
      className={cn(
        'rounded-xl border border-border border-t-[3px] bg-card overflow-hidden',
        TOP[variant],
        className
      )}
    >
      <header className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <span className={cn('shrink-0', TITLE[variant])}>{icon}</span>}
          <h3 className={cn('text-[12px] font-mono font-bold tracking-[0.08em] truncate', TITLE[variant])}>
            {title}
          </h3>
        </div>
        {headerActions && <div className="flex items-center gap-1.5 shrink-0">{headerActions}</div>}
      </header>
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {children}
      </div>
    </section>
  );
};
