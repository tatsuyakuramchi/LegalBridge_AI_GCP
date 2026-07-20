/**
 * DataTableShell — 一覧の共通器（設計 §7.2/§8 / 共通部品表 DataTableShell）。
 *   列定義 columns と行 rows を受け、ヘッダ/本文/空状態/（任意で）ページングを描画。
 *   toolbar に SearchToolbar 等を差せる。読み取り一覧から段階導入する（低リスク）。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";

export interface DataTableColumn<Row> {
  key: string;
  header?: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  headClassName?: string;
  render?: (row: Row, index: number) => React.ReactNode;
}

export interface DataTableShellProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => React.Key;
  toolbar?: React.ReactNode;
  empty?: React.ReactNode;
  emptyTitle?: string;
  onRowClick?: (row: Row, index: number) => void;
  loading?: boolean;
  dense?: boolean;
  className?: string;
  pagination?: { page: number; pageCount: number; onPage: (n: number) => void };
}

export function DataTableShell<Row>({
  columns,
  rows,
  rowKey,
  toolbar,
  empty,
  emptyTitle = "該当なし",
  onRowClick,
  loading,
  dense,
  className,
  pagination,
}: DataTableShellProps<Row>) {
  const alignCls = (a?: "left" | "center" | "right") =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div className={cn("space-y-2", className)}>
      {toolbar}
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(alignCls(c.align), c.headClassName)}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                  読み込み中…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {empty ?? <EmptyState title={emptyTitle} />}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow
                  key={rowKey(row, i)}
                  className={cn(onRowClick && "cursor-pointer", dense && "[&>td]:py-1.5")}
                  onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn(alignCls(c.align), c.className)}>
                      {c.render ? c.render(row, i) : (row as any)[c.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 disabled:opacity-40"
            disabled={pagination.page <= 1}
            onClick={() => pagination.onPage(pagination.page - 1)}
          >
            前へ
          </button>
          <span>
            {pagination.page} / {pagination.pageCount}
          </span>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 disabled:opacity-40"
            disabled={pagination.page >= pagination.pageCount}
            onClick={() => pagination.onPage(pagination.page + 1)}
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
}

export default DataTableShell;
