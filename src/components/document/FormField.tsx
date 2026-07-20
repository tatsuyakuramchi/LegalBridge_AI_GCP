import React from 'react';
import { HelpCircle, Lock } from 'lucide-react';
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
  // Phase 22.7: type: "hidden" のフィールドは UI 上には描画しない。
  // formData にだけ保持されて PDF テンプレに渡る (例: 発注書で明細から自動集計
  // される summaryDeliveryDate / summaryPaymentDate / 後方互換のみ残置の旧フィールド)。
  if (meta.type === 'hidden' || meta.hidden === true) return null;

  const label = meta.label || id.replace(/_/g, ' ');
  const options = meta.options || SELECT_OPTIONS[id];
  const placeholder = meta.placeholder;
  const isRequired = meta.required === true;
  // Phase 23 UX: readonly フィールドは🔒 アイコン+グレー背景。
  //   PDF 計算結果 (royalty_statement の MG/AG, gross 等) や自動補完結果
  //   (linked_contract_number, licensor 名など) で使う。
  const isReadOnly = meta.readonly === true;
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
    'w-full text-xs font-mono tab-mono transition-colors',
    'border-b border-input py-1.5 focus:outline-none focus:border-foreground',
    'placeholder:text-muted-foreground/60 placeholder:text-[11px]',
    isReadOnly
      ? 'bg-muted/40 text-muted-foreground/80 border-transparent cursor-not-allowed select-text'
      : 'bg-transparent',
    error && 'border-destructive focus:border-destructive',
    isRequired && isEmpty && !isReadOnly && 'border-warning/60 bg-warning/10'
  );

  return (
    <div
      className="space-y-1 group relative"
      data-field-id={id}
      data-required={isRequired ? '1' : '0'}
      data-required-empty={isRequired && isEmpty ? '1' : '0'}
      data-readonly={isReadOnly ? '1' : '0'}
    >
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className={cn(
            'flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.16em] transition-colors',
            error ? 'text-destructive' : 'text-muted-foreground group-hover:text-foreground'
          )}
        >
          {isReadOnly && (
            <Lock
              className="h-2.5 w-2.5 text-muted-foreground/60"
              aria-hidden="true"
            />
          )}
          {label}
          {isRequired && (
            <span
              className={cn(
                'font-bold leading-none',
                isEmpty ? 'text-destructive' : 'text-warning'
              )}
              title={isEmpty ? '必須項目（未入力）' : '必須項目'}
              aria-label={isEmpty ? '必須項目（未入力）' : '必須項目'}
            >
              *
            </span>
          )}
          {isReadOnly && (
            <span
              className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-px rounded-sm normal-case tracking-normal"
              title="自動計算 / 自動補完 — 直接編集はできません"
            >
              自動
            </span>
          )}
          {error && (
            <span className="text-[10px] bg-destructive/15 text-destructive px-1.5 py-px rounded-sm">
              !
            </span>
          )}
        </label>
        {/* Phase 22.21.68: helpText は下に再表示するので、ここでは
            アイコンだけにして label 行を圧迫しない */}
        <HelpCircle className="h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-help" />
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
                <span className="text-[11px] font-mono text-warning italic">
                  未選択
                </span>
              )}
            </div>
          );
        })()
      ) : options ? (
        // Phase 23.0.4: select も他要素と同じく「読み取り専用 = フォーカス可能・
        //   操作不可」に揃える。disabled では tab 順から外れスクリーンリーダーで
        //   「使用不可」と読まれるため、aria-disabled + onMouseDown 抑止で表現。
        <select
          id={id}
          value={value || ''}
          onChange={(e) => {
            if (isReadOnly) return;
            onChange(e.target.value);
          }}
          aria-required={isRequired || undefined}
          aria-invalid={error ? true : undefined}
          aria-readonly={isReadOnly || undefined}
          aria-disabled={isReadOnly || undefined}
          aria-describedby={meta.helpText ? `help-${id}` : undefined}
          onMouseDown={(e) => {
            if (isReadOnly) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (isReadOnly && e.key !== 'Tab') e.preventDefault();
          }}
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
          readOnly={isReadOnly}
          aria-required={isRequired || undefined}
          aria-invalid={error ? true : undefined}
          aria-readonly={isReadOnly || undefined}
          aria-describedby={meta.helpText ? `help-${id}` : undefined}
          rows={2}
          className={cn(
            'w-full text-xs font-mono border border-input rounded-sm p-2 resize-none transition-colors',
            'focus:outline-none focus:border-foreground',
            'placeholder:text-muted-foreground/60 placeholder:text-[11px]',
            isReadOnly
              ? 'bg-muted/40 text-muted-foreground/80 cursor-not-allowed'
              : 'bg-card',
            error && 'border-destructive',
            isRequired && isEmpty && !isReadOnly && 'border-warning/60 bg-warning/10'
          )}
          placeholder={placeholder || `Enter ${label}…`}
        />
      ) : (
        <input
          id={id}
          type={isDate ? 'date' : isNumber ? 'number' : 'text'}
          value={
            isNumber
              ? value === 0 || value === '0' || (value !== undefined && value !== null && value !== '')
                ? String(value)
                : ''
              : value || ''
          }
          onChange={(e) => onChange(e.target.value)}
          readOnly={isReadOnly}
          aria-required={isRequired || undefined}
          aria-invalid={error ? true : undefined}
          aria-readonly={isReadOnly || undefined}
          aria-describedby={meta.helpText ? `help-${id}` : undefined}
          className={baseInput}
          placeholder={isDate ? '' : (placeholder || `Input ${label}…`)}
          {...(isNumber
            ? { inputMode: 'numeric' as const, min: 0, step: 1 }
            : {})}
        />
      )}

      {/* Phase 22.21.68: helpText を入力欄の下に全幅表示。
          条文番号などの長文ガイドが切れないよう改行可能なテキスト。
          Phase 23.0.4:
            - string  : 従来通り 1 行表示 (後方互換)
            - {brief,full}: brief を summary 行に、full を <details> で展開表示
            - aria-describedby で input と紐付け、SR が読み上げる */}
      {meta.helpText &&
        (typeof meta.helpText === 'string' ? (
          <p
            id={`help-${id}`}
            className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 whitespace-pre-wrap"
          >
            {meta.helpText}
          </p>
        ) : (
          <details
            id={`help-${id}`}
            className="text-[10px] text-muted-foreground leading-relaxed mt-0.5"
          >
            <summary className="cursor-pointer hover:text-foreground whitespace-pre-wrap">
              {meta.helpText.brief}
            </summary>
            {meta.helpText.full && (
              <p className="mt-1 pl-3 border-l border-muted whitespace-pre-wrap">
                {meta.helpText.full}
              </p>
            )}
          </details>
        ))}
    </div>
  );
};
