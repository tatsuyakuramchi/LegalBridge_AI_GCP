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
  const placeholder = meta.placeholder;
  const isRequired = meta.required === true;
  const isEmpty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '');

  // 明示的に type を指定された場合はそれが最優先。
  // それ以外は ID ベースの推論 (greedy)。ただし
  //   - "_YEAR", "_MONTH", "_DAY" 等の date 部分要素 suffix を持つ ID
  //   - meta.type が 'text' / 'number' で明示されている ID
  // は date 推論から除外する。
  const looksLikeDateSubField = /_(YEAR|MONTH|DAY|HOUR|MINUTE)$/i.test(id);
  const isDate =
    meta.type === 'date' ||
    (meta.type !== 'text' &&
      meta.type !== 'number' &&
      meta.type !== 'textarea' &&
      meta.type !== 'boolean' &&
      !looksLikeDateSubField &&
      (id.includes('日') ||
        id.includes('DATE') ||
        id.includes('期限')));
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
    error && 'border-destructive focus:border-destructive',
    isRequired && isEmpty && 'border-amber-500/60'
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
          {isRequired && (
            <span
              className="text-amber-600 font-bold leading-none"
              title="必須項目"
              aria-label="required"
            >
              *
            </span>
          )}
          {error && (
            <span className="text-[8px] bg-destructive/15 text-destructive px-1.5 py-px rounded-sm">
              !
            </span>
          )}
        </label>
        {meta.helpText ? (
          <span
            className="text-[8px] text-muted-foreground/50 italic ml-2 truncate max-w-[60%] text-right"
            title={meta.helpText}
          >
            {meta.helpText}
          </span>
        ) : (
          <HelpCircle className="h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-help" />
        )}
      </div>

      {isBoolean ? (
        // Phase 17h: 選択状態を強くハイライト。値の型 (boolean / string)
        // のゆらぎを正規化して比較ミスを防ぐ。
        (() => {
          const truthyStrings = new Set(['true', '1', 'yes', 'はい']);
          const falsyStrings = new Set(['false', '0', 'no', 'いいえ']);
          const norm =
            typeof value === 'string'
              ? truthyStrings.has(value.toLowerCase())
                ? true
                : falsyStrings.has(value.toLowerCase())
                  ? false
                  : undefined
              : value === true
                ? true
                : value === false
                  ? false
                  : undefined;
          const activeCls =
            'bg-foreground text-background border-foreground shadow-sm ring-2 ring-foreground/20';
          const inactiveCls =
            'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/50';
          return (
            <div className="flex items-center gap-2 py-1">
              <button
                type="button"
                onClick={() => onChange(true)}
                aria-pressed={norm === true}
                className={cn(
                  'text-[10px] font-mono font-bold uppercase tracking-[0.14em] px-3 py-1.5 border-2 rounded-sm transition-all',
                  norm === true ? activeCls : inactiveCls
                )}
              >
                {norm === true && '✓ '}True
              </button>
              <button
                type="button"
                onClick={() => onChange(false)}
                aria-pressed={norm === false}
                className={cn(
                  'text-[10px] font-mono font-bold uppercase tracking-[0.14em] px-3 py-1.5 border-2 rounded-sm transition-all',
                  norm === false ? activeCls : inactiveCls
                )}
              >
                {norm === false && '✓ '}False
              </button>
              {norm === undefined && (
                <span className="text-[9px] font-mono text-amber-600 italic">
                  未選択
                </span>
              )}
            </div>
          );
        })()
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
            error && 'border-destructive',
            isRequired && isEmpty && 'border-amber-500/60'
          )}
          placeholder={placeholder || `Enter ${label}…`}
        />
      ) : (
        <input
          id={id}
          type={isDate ? 'date' : isNumber ? 'number' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
          placeholder={isDate ? '' : (placeholder || `Input ${label}…`)}
        />
      )}
    </div>
  );
};
