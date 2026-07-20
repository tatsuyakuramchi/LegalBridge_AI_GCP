/**
 * EntityCombobox — 作品/素材/取引先/担当者 等の「検索して1件選ぶ」共通コントロール
 * （設計 §8.1 / 共通部品表 EntityCombobox）。
 *
 *   2 モード:
 *     - entity 指定: remote/AppData 検索。既存 EntitySearchSelect にそのまま委譲。
 *         <EntityCombobox entity="vendor" value={code} onSelect={...} />
 *     - items 指定: 事前ロード済みの候補配列(constrained list)を絞り込み選択。
 *         <EntityCombobox items={opts} value={id} onSelect={...} />
 *
 *   返却は EntityOption(id/code/label/sub/raw)。呼び出し側は onSelect で解決する。
 *   ページ独自の生 <select>/自前ピッカーを新設せず、これを使う（§11.3）。
 */
import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  EntitySearchSelect,
  type EntityKind,
  type EntityOption,
} from "@/src/components/search/EntitySearch";

export type { EntityKind, EntityOption } from "@/src/components/search/EntitySearch";

export interface EntityComboboxProps {
  /** remote/AppData 検索モード。items と排他。 */
  entity?: EntityKind;
  /** entity="work_material" の親原作 id。 */
  parentId?: string | number | null;
  /** 事前ロード済み候補モード。entity と排他。 */
  items?: EntityOption[];
  /** 現在の選択(表示用)。code もしくは id いずれかで一致判定。 */
  value?: string | null;
  onSelect: (opt: EntityOption | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** entity モードの初期表示最大件数。 */
  limit?: number;
}

/** items モード: 事前ロード配列を label/code/sub で絞り込む軽量コンボボックス。 */
const ItemsCombobox: React.FC<
  Omit<EntityComboboxProps, "entity" | "parentId" | "limit"> & { items: EntityOption[] }
> = ({ items, value, onSelect, placeholder = "検索して選択", className, disabled }) => {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(
    () => (value ? items.find((o) => o.id === value || o.code === value) ?? null : null),
    [items, value]
  );

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = Array.isArray(items) ? items : [];
    if (!s) return base.slice(0, 50);
    return base
      .filter(
        (o) =>
          o.label.toLowerCase().includes(s) ||
          (o.code || "").toLowerCase().includes(s) ||
          (o.sub || "").toLowerCase().includes(s)
      )
      .slice(0, 50);
  }, [items, q]);

  if (selected || (value && !selected)) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 min-h-8 px-2.5 py-1 border border-border rounded-md text-[12px] bg-background",
          className
        )}
      >
        <span className="truncate">{selected?.label ?? `#${value}`}</span>
        {selected?.code ? (
          <span className="text-[10px] font-mono text-muted-foreground">{selected.code}</span>
        ) : null}
        <span className="flex-1" />
        {!disabled && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onSelect(null)}
            aria-label="選択を解除"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-7 text-[12px]"
          value={q}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {filtered.map((o) => (
            <button
              type="button"
              key={o.id}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(o);
                setQ("");
                setOpen(false);
              }}
            >
              <span className="truncate">{o.label}</span>
              {o.code ? (
                <span className="text-[10px] font-mono text-muted-foreground">{o.code}</span>
              ) : null}
              {o.sub ? (
                <span className="ml-auto truncate text-[10px] text-muted-foreground">{o.sub}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const EntityCombobox: React.FC<EntityComboboxProps> = (props) => {
  const { entity, parentId, items, value, onSelect, placeholder, className, disabled, limit } =
    props;

  if (entity) {
    // remote/AppData モードは既存 EntitySearchSelect に委譲（ロジック新規実装しない）。
    return (
      <div className={cn(disabled && "pointer-events-none opacity-60", className)}>
        <EntitySearchSelect
          entity={entity}
          parentId={parentId}
          value={value}
          onSelect={onSelect}
          placeholder={placeholder}
          limit={limit}
        />
      </div>
    );
  }

  return (
    <ItemsCombobox
      items={items ?? []}
      value={value}
      onSelect={onSelect}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  );
};

export default EntityCombobox;
