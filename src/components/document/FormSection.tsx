import React from 'react';

import { cn } from '@/lib/utils';

interface FormSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'blue' | 'amber' | 'emerald' | 'indigo' | 'cyan' | 'red' | 'default';
  className?: string;
  headerActions?: React.ReactNode;
}

const ACCENTS: Record<NonNullable<FormSectionProps['variant']>, string> = {
  blue: 'before:bg-cyan-600',
  amber: 'before:bg-amber-600',
  emerald: 'before:bg-emerald-600',
  indigo: 'before:bg-indigo-600',
  cyan: 'before:bg-cyan-500',
  red: 'before:bg-red-600',
  default: 'before:bg-foreground',
};

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  icon,
  children,
  variant = 'default',
  className = '',
  headerActions,
}) => {
  return (
    <section
      className={cn(
        'relative bg-card border border-border rounded-md overflow-hidden',
        // Left accent bar via ::before
        'before:absolute before:left-0 before:top-0 before:h-full before:w-0.5',
        ACCENTS[variant],
        className
      )}
    >
      <header className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h3 className="text-[11px] font-mono font-bold uppercase tracking-[0.18em] truncate">
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
