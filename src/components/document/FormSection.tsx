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
//   LB-F11 (§5.5.8): ボディのグリッドを FkGrid と同じ「通常2カラム」へ統一
//   (旧: md2/lg3 の3カラム)。既存の col-span-full(明細表・住所・長文・注記など)は
//   そのまま全幅で効く。金額・率・日付のコンパクトグリッドは各フォームの
//   ローカルグリッドで表現する。
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
  blue: 'text-primary',
  amber: 'text-warning',       // UIC-24: status tone → token
  emerald: 'text-success',
  indigo: 'text-primary',
  cyan: 'text-info',
  red: 'text-destructive',
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
      // LB-F12: 左セクションナビ(DocumentEditorPage)がこの属性を走査して
      //   見出し一覧・未入力件数・アンカー移動を構築する。
      data-form-section=""
      data-section-title={title}
      className={cn(
        'rounded-xl border border-border border-t-[3px] bg-card overflow-hidden scroll-mt-4',
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
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        {children}
      </div>
    </section>
  );
};
