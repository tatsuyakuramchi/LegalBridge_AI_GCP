import React from 'react';
import { HelpCircle } from 'lucide-react';
import { TemplateVar } from './types';

import { cn } from '@/lib/utils';

interface FormFieldProps {
  id: string;
  meta: TemplateVar;
  value: any;
  error?: string | null;
  onChange: (value: any) => void;
}

const SELECT_OPTIONS: Record<string, string[]> = {
  '金銭条件1_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
  '金銭条件2_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
  '金銭条件3_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
  '金銭条件1_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
  '金銭条件2_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
  '金銭条件3_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
  '金銭条件1_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
  '金銭条件2_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
  '金銭条件3_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
  CURRENCY: ['JPY', 'USD', 'EUR', 'CNY', 'GBP', 'AUD', 'CAD', 'CHF'],
  独占性: ['独占', '非独占'],
  対象地域: ['日本国内', '全世界', '北米', '欧州'],
  許諾言語: ['日本語', '英語', '各国語'],
  販売地域: ['日本国内', '全世界', '北米', '欧州'],
  販売言語: ['日本語', '英語', '各国語'],
  taxRate: ['10', '8'],
};

export const FormField: React.FC<FormFieldProps> = ({ id, meta, value, error, onChange }) => {
  const label = meta.label || id.replace(/_/g, ' ');
  const options = meta.options || SELECT_OPTIONS[id];

  const isDate =
    meta.type === 'date' ||
    id.includes('日') ||
    id.includes('DATE') ||
    id.includes('期限');
  const isTextarea =
    meta.type === 'textarea' ||
    id.includes('本文') ||
    id.includes('備考') ||
    id.includes('REMARKS') ||
    id.includes('特記');
  const isBoolean = meta.type === 'boolean' || id.startsWith('is') || id.includes('フラグ');
  const isNumber = meta.type === 'number';

  const baseInput = cn(
    'w-full text-xs font-mono tab-mono bg-transparent transition-colors',
    'border-b border-input py-1.5 focus:outline-none focus:border-foreground',
    'placeholder:text-muted-foreground/60 placeholder:text-[11px]',
    error && 'border-destructive focus:border-destructive'
  );

  return (
    <div className="space-y-1 group relative">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className={cn(
            'flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] transition-colors',
            error ? 'text-destructive' : 'text-muted-foreground group-hover:text-foreground'
          )}
        >
          {label}
          {error && (
            <span className="text-[8px] bg-destructive/15 text-destructive px-1.5 py-px rounded-sm">
              !
            </span>
          )}
        </label>
        <HelpCircle className="h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-help" />
      </div>

      {isBoolean ? (
        <div className="flex items-center gap-2 py-1">
          <button
            type="button"
            onClick={() => onChange(true)}
            className={cn(
              'text-[10px] font-mono font-bold uppercase tracking-[0.14em] px-2.5 py-1 border rounded-sm transition-all',
              value === true
                ? 'bg-foreground text-background border-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            True
          </button>
          <button
            type="button"
            onClick={() => onChange(false)}
            className={cn(
              'text-[10px] font-mono font-bold uppercase tracking-[0.14em] px-2.5 py-1 border rounded-sm transition-all',
              value === false
                ? 'bg-foreground text-background border-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            False
          </button>
        </div>
      ) : options ? (
        <select
          id={id}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(baseInput, 'appearance-none pr-4')}
        >
          <option value="">— Select —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : isTextarea ? (
        <textarea
          id={id}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className={cn(
            'w-full text-xs font-mono bg-card border border-input rounded-sm p-2 resize-none transition-colors',
            'focus:outline-none focus:border-foreground',
            'placeholder:text-muted-foreground/60 placeholder:text-[11px]',
            error && 'border-destructive'
          )}
          placeholder={`Enter ${label}…`}
        />
      ) : (
        <input
          id={id}
          type={isDate ? 'date' : isNumber ? 'number' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
          placeholder={isDate ? '' : `Input ${label}…`}
        />
      )}
    </div>
  );
};
