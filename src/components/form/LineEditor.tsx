/**
 * LineEditor — 明細・住所・口座・条件行の反復編集（設計 §8.2 / 共通部品表 LineEditor）。
 *   行配列 rows と列定義 columns を受け、各行のフィールドを render(row, i, patch) で描画する。
 *   追加(onAdd)・削除(onRemove)ボタンを共通レイアウトで提供。readOnly で閲覧専用。
 *
 *   ページ独自の反復編集グリッドを新設せず、これを使う。金額/コード列は等幅、
 *   ラベル/本文は sans（§6.1）。
 */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LineEditorColumn<Row> {
  key: string;
  header?: React.ReactNode;
  width?: string;
  className?: string;
  /** セル描画。patch で当該行を部分更新する。 */
  render: (row: Row, index: number, patch: (p: Partial<Row>) => void) => React.ReactNode;
}

export interface LineEditorProps<Row> {
  rows: Row[];
  columns: LineEditorColumn<Row>[];
  /** patch を反映した行配列を返す（呼び出し側で setState する）。 */
  onChange?: (next: Row[]) => void;
  onAdd?: () => void;
  addLabel?: React.ReactNode;
  onRemove?: (row: Row, index: number) => void;
  canRemove?: (row: Row, index: number) => boolean;
  empty?: React.ReactNode;
  readOnly?: boolean;
  className?: string;
}

export function LineEditor<Row>({
  rows,
  columns,
  onChange,
  onAdd,
  addLabel = "行を追加",
  onRemove,
  canRemove,
  empty,
  readOnly,
  className,
}: LineEditorProps<Row>) {
  const patchAt = (index: number) => (p: Partial<Row>) => {
    if (!onChange) return;
    onChange(rows.map((r, i) => (i === index ? { ...r, ...p } : r)));
  };

  const showRemove = !readOnly && !!onRemove;

  return (
    <div className={cn("space-y-2", className)}>
      {columns.some((c) => c.header != null) && (
        <div
          className="grid gap-2 px-1 text-[11px] font-medium text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate(columns, showRemove) }}
        >
          {columns.map((c) => (
            <div key={c.key} className={c.className}>
              {c.header}
            </div>
          ))}
          {showRemove && <div />}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          {empty ?? "行がありません"}
        </div>
      ) : (
        rows.map((row, i) => (
          <div
            key={i}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: gridTemplate(columns, showRemove) }}
          >
            {columns.map((c) => (
              <div key={c.key} className={cn("min-w-0", c.className)}>
                {c.render(row, i, patchAt(i))}
              </div>
            ))}
            {showRemove && (
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                  canRemove && !canRemove(row, i) && "pointer-events-none opacity-30"
                )}
                aria-label="この行を削除"
                onClick={() => onRemove?.(row, i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))
      )}

      {!readOnly && onAdd && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-primary hover:bg-primary/5"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function gridTemplate<Row>(columns: LineEditorColumn<Row>[], showRemove: boolean): string {
  const cols = columns.map((c) => c.width ?? "1fr").join(" ");
  return showRemove ? `${cols} 28px` : cols;
}

export default LineEditor;
