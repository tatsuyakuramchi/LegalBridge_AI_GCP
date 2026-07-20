/**
 * SearchToolbar — 一覧/検索の上部ツールバー（設計 §7.2 / 共通部品表 SearchToolbar）。
 *   キーワード入力・facet 差込枠・保存ビュー・table/card 切替・右寄せアクションを共通化。
 *   DataTableShell の toolbar に差す、または List ページ上部に置く。
 */
import * as React from "react";
import { Search, LayoutGrid, List as ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface SearchToolbarProps {
  keyword?: string;
  onKeyword?: (v: string) => void;
  placeholder?: string;
  /** FacetPanel 等を差す枠（左寄せ）。 */
  facets?: React.ReactNode;
  /** 保存ビュー等。 */
  savedViews?: React.ReactNode;
  view?: "table" | "card";
  onView?: (v: "table" | "card") => void;
  /** 右寄せの主操作（新規/エクスポート 等）。 */
  actions?: React.ReactNode;
  className?: string;
}

export const SearchToolbar: React.FC<SearchToolbarProps> = ({
  keyword,
  onKeyword,
  placeholder = "キーワードで検索",
  facets,
  savedViews,
  view,
  onView,
  actions,
  className,
}) => {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {onKeyword && (
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            value={keyword ?? ""}
            placeholder={placeholder}
            onChange={(e) => onKeyword(e.target.value)}
          />
        </div>
      )}
      {facets}
      {savedViews}
      <div className="ml-auto flex items-center gap-2">
        {actions}
        {onView && (
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className={cn(
                "flex h-9 w-9 items-center justify-center",
                view === "table" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
              )}
              aria-label="テーブル表示"
              aria-pressed={view === "table"}
              onClick={() => onView("table")}
            >
              <ListIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn(
                "flex h-9 w-9 items-center justify-center border-l border-border",
                view === "card" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
              )}
              aria-label="カード表示"
              aria-pressed={view === "card"}
              onClick={() => onView("card")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchToolbar;
