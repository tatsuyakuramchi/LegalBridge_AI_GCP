import React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * LicenseWizardRail — 利用許諾文書作成の「誘導フロー」表示(WTC-1)。
 *
 * 設計: docs/design/work-tables-consolidation-plan.md §1.5(文書作成依頼フロー) /
 *       docs/design/document-first-material-linkage-plan.md
 *
 * 役割: 既に実装済みの各入力部品(作品/原作/素材セレクタ・金銭条件・当事者)を
 *       「作品 → 原作 → マテリアル → 条件 → 当事者 → 完成」の1本の流れとして可視化する。
 *       入力や保存ロジックは持たない(純表示＋アンカージャンプのみ)。各ステップの達成判定は
 *       呼び出し側が formData から算出して `done` で渡す(真実源は従来どおり formData)。
 */
export interface WizardStep {
  /** 一意キー。 */
  key: string;
  /** ステップ見出し(短語)。 */
  label: string;
  /** 現在ステップ時に表示する一言ガイド。 */
  hint: string;
  /** 達成済みか。 */
  done: boolean;
  /** クリック時のジャンプ先 section id(未指定はジャンプなし)。 */
  anchorId?: string;
}

function defaultJump(anchorId: string) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(anchorId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export const LicenseWizardRail: React.FC<{
  steps: WizardStep[];
  onJump?: (anchorId: string) => void;
  className?: string;
}> = ({ steps, onJump, className }) => {
  if (!steps.length) return null;

  const jump = onJump || defaultJump;
  // 現在ステップ = 最初の未達成ステップ。全達成なら最終ステップ。
  const currentIndex = (() => {
    const i = steps.findIndex((s) => !s.done);
    return i === -1 ? steps.length - 1 : i;
  })();
  const allDone = steps.every((s) => s.done);
  const current = steps[currentIndex];

  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-1 mb-1 rounded-md border border-border bg-card/95 px-4 py-3 backdrop-blur',
        'shadow-sm',
        className
      )}
    >
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex && !allDone;
          const clickable = !!step.anchorId;
          return (
            <React.Fragment key={step.key}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'h-px w-4 shrink-0',
                    steps[i - 1].done ? 'bg-success' : 'bg-border'
                  )}
                />
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => step.anchorId && jump(step.anchorId)}
                title={step.hint}
                className={cn(
                  'group flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors',
                  clickable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default',
                  step.done
                    ? 'border-success bg-success/10 text-success'
                    : isCurrent
                      ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                      : 'border-border bg-muted/20 text-muted-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-mono font-bold',
                    step.done
                      ? 'bg-success text-white'
                      : isCurrent
                        ? 'bg-primary text-white'
                        : 'bg-foreground/15 text-foreground/70'
                  )}
                >
                  {step.done ? <Check className="h-2.5 w-2.5" /> : i + 1}
                </span>
                <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em]">
                  {step.label}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {allDone ? (
          <span className="text-success">すべてのステップが揃いました。内容を確認して文書を生成できます。</span>
        ) : (
          <>
            <span className="font-bold text-primary">いまここ: {current.label}</span>
            {' — '}
            {current.hint}
          </>
        )}
      </p>
    </div>
  );
};
