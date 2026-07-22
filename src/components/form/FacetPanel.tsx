import * as React from "react";
import { cn } from "@/lib/utils";

export interface FacetOption {
  value: string;
  label: React.ReactNode;
  /** 件数バッジ(任意)。 */
  count?: number;
}

export interface FacetGroup {
  key: string;
  label: React.ReactNode;
  options: FacetOption[];
  /** 複数選択可(既定 true)。false なら単一選択(ラジオ相当)。 */
  multi?: boolean;
}

export interface FacetPanelProps {
  groups: FacetGroup[];
  /** グループ key → 選択中 value[] のマップ。 */
  selected: Record<string, string[]>;
  onChange: (groupKey: string, values: string[]) => void;
  /** 全解除ボタンを出す(任意)。 */
  onClear?: () => void;
  className?: string;
}

/**
 * 一覧/検索面の絞り込みファセット(横断検索ハブ・DQ センター等)。
 * グループ×選択肢(件数付き)をチェックで絞り込む共通サイドパネル。
 * 状態はページ側が保持し、本コンポーネントは表示と onChange のみ担う。
 */
export function FacetPanel({
  groups,
  selected,
  onChange,
  onClear,
  className,
}: FacetPanelProps) {
  const toggle = (g: FacetGroup, value: string) => {
    const cur = selected[g.key] ?? [];
    if (g.multi === false) {
      onChange(g.key, cur.includes(value) ? [] : [value]);
      return;
    }
    onChange(
      g.key,
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
    );
  };

  const totalSelected = Object.values(selected).reduce((n, a) => n + (a?.length ?? 0), 0);

  return (
    <aside
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-sm shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">絞り込み</span>
        {onClear && totalSelected > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            すべて解除
          </button>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((g) => {
          const sel = selected[g.key] ?? [];
          return (
            <div key={g.key}>
              <div className="mb-1.5 text-[11px] font-semibold text-foreground/80">{g.label}</div>
              <ul className="space-y-0.5">
                {g.options.map((o) => {
                  const checked = sel.includes(o.value);
                  return (
                    <li key={o.value}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-muted/50",
                          checked && "text-foreground"
                        )}
                      >
                        <input
                          type={g.multi === false ? "radio" : "checkbox"}
                          name={g.multi === false ? `facet-${g.key}` : undefined}
                          checked={checked}
                          onChange={() => toggle(g, o.value)}
                          className="h-3.5 w-3.5 accent-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.count != null && (
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{o.count}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
                {g.options.length === 0 && (
                  <li className="px-1.5 py-1 text-[11px] text-muted-foreground">該当なし</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default FacetPanel;
