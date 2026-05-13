/**
 * ParentPoPicker — 検収書フォームで「親 PO を手動で指定」する UI。
 *
 * 通常は form-context 経由で Backlog 親子関係から自動発見されるが、
 * 以下のケースでは自動発見できないので、このピッカーで補う:
 *   - インポートで IMPORT-<ts> キーになった PO
 *   - Backlog に実在するが親子関係を設定し忘れた PO
 *   - 自動発見した PO とは別の PO に切り替えたいとき
 *
 * 動作:
 *   1. issue_key / description / vendor_code で部分一致検索
 *   2. /api/order-items/list で候補を表示 (検収済み累計と残額付き)
 *   3. 選択すると /api/order-items/by-issue/:key で明細を取得し、
 *      onPick コールバック経由でフォームに流し込む。
 */

import * as React from "react";
import {
  Search,
  Link as LinkIcon,
  Unlink,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  PackageOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type PoListItem = {
  id: number;
  backlog_issue_key: string;
  description: string;
  amount_ex_tax: number;
  vendor_code: string;
  vendor_name: string;
  tax_rate: number | null;
  due_date: string | null;
  created_at: string;
  line_count: number;
  inspected_amount: number;
  remaining_amount: number;
  document_number: string;
  drive_link: string;
  is_imported: boolean;
};

export type PoLoaded = {
  order_item_id: number;
  backlog_issue_key: string;
  line_items: any[]; // OrderLineForInspection[] (DeliveryLineItemTable が消費)
  document_number: string; // 親 PO の document_number (例: PO-2024-001)
  vendor: any; // vendors テーブルの行 (vendor_name / entity_type / 銀行口座 等)
  delivery_progress: {
    done_count: number;
    next_delivery_no: number;
    done_amount_ex_tax: number;
    remaining_amount_ex_tax: number;
    inspected_pct: number;
    is_partial: boolean;
  } | null;
  raw: any; // /api/order-items/by-issue/:key の生レスポンス
};

interface Props {
  currentKey?: string;
  /** 親 PO を選んだとき呼ばれる。フォームに流し込む責務は呼び元。 */
  onPick: (loaded: PoLoaded) => void;
  /** 親 PO 連動を解除する。 */
  onClear: () => void;
  /** 既に form-context 経由で親 PO が乗っているか (UI ラベル切り替え用)。 */
  hasParent: boolean;
}

const yen = (n: number) =>
  "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

export const ParentPoPicker: React.FC<Props> = ({
  currentKey,
  onPick,
  onClear,
  hasParent,
}) => {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<PoListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [picking, setPicking] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState("");

  // open 時 + 検索文字列変化時にリスト取得 (300ms debounce)
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/order-items/list?q=${encodeURIComponent(q)}&limit=50`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setList(Array.isArray(data) ? data : []);
      } catch (e: any) {
        setError(String(e?.message || e));
        setList([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, q]);

  const loadPo = async (key: string) => {
    if (!key) return;
    setPicking(key);
    setError(null);
    try {
      const res = await fetch(
        `/api/order-items/by-issue/${encodeURIComponent(key)}`
      );
      if (!res.ok) {
        if (res.status === 404)
          throw new Error(`PO '${key}' が見つかりません`);
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      onPick({
        order_item_id: Number(data?.order_item?.id) || 0,
        backlog_issue_key: data?.order_item?.backlog_issue_key || key,
        line_items: Array.isArray(data?.line_items) ? data.line_items : [],
        document_number: String(data?.document_number || ""),
        vendor: data?.vendor || null,
        delivery_progress: data?.delivery_progress || null,
        raw: data,
      });
      setOpen(false);
      setManual("");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setPicking(null);
    }
  };

  return (
    <div className="border border-border rounded-sm bg-card/40">
      <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider">
          <LinkIcon className="w-3 h-3" />
          <span className="font-bold">親 PO 連動</span>
          {hasParent && currentKey ? (
            <span className="flex items-center gap-1 text-[9px] text-emerald-700 font-normal normal-case">
              <CheckCircle2 className="w-2.5 h-2.5" />
              {currentKey} を連動中
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground font-normal normal-case">
              未連動 (自由入力モード)
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {hasParent && (
            <button
              type="button"
              onClick={onClear}
              className="text-[9px] font-mono px-2 py-0.5 uppercase border border-foreground/30 rounded-sm hover:bg-muted flex items-center gap-1"
              title="親 PO 連動を解除して自由入力に戻す"
            >
              <Unlink className="w-2.5 h-2.5" /> 解除
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[9px] font-mono px-2 py-0.5 uppercase border border-foreground/30 rounded-sm hover:bg-muted flex items-center gap-1"
          >
            <Search className="w-2.5 h-2.5" />
            {open ? "閉じる" : hasParent ? "変更" : "親 PO を選択"}
          </button>
        </div>
      </header>

      {open && (
        <div className="p-3 space-y-3">
          {/* 直接入力 */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                直接入力 (issue_key / IMPORT-* どちらでも)
              </div>
              <input
                type="text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    loadPo(manual.trim());
                  }
                }}
                placeholder="例: ARC-1234 / IMPORT-1736500000"
                className="w-full text-[11px] font-mono bg-card border border-input rounded-sm px-2 py-1 focus:outline-none focus:border-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => loadPo(manual.trim())}
              disabled={!manual.trim() || picking === manual.trim()}
              className={cn(
                "text-[10px] font-mono px-3 py-1.5 uppercase rounded-sm border transition-colors flex items-center gap-1.5",
                !manual.trim() || picking === manual.trim()
                  ? "border-input text-muted-foreground cursor-not-allowed"
                  : "border-foreground/30 hover:bg-muted"
              )}
            >
              {picking === manual.trim() ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <LinkIcon className="w-3 h-3" />
              )}
              ロード
            </button>
          </div>

          <div className="border-t border-border" />

          {/* 検索 + リスト */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Search className="w-3 h-3 text-muted-foreground" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="検索 (issue_key / 業務概要 / 取引先コード)"
                className="flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 px-1 focus:outline-none focus:border-foreground"
              />
              {loading && (
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              )}
            </div>

            {error && (
              <div className="text-[10px] font-mono text-red-700 bg-red-50 border border-red-200 rounded-sm px-2 py-1.5 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="max-h-[280px] overflow-y-auto border border-border rounded-sm">
              {list.length === 0 && !loading ? (
                <div className="text-[10px] font-mono text-muted-foreground p-3 text-center flex items-center justify-center gap-2">
                  <PackageOpen className="w-3 h-3" />
                  発注書が見つかりませんでした
                </div>
              ) : (
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-muted/40 text-[9px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="text-left p-1.5">issue_key</th>
                      <th className="text-left p-1.5">業務概要</th>
                      <th className="text-left p-1.5">取引先</th>
                      <th className="text-right p-1.5">発注額 / 残</th>
                      <th className="text-center p-1.5">明細</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((po) => (
                      <tr
                        key={po.id}
                        className={cn(
                          "border-t border-border/50 hover:bg-muted/30",
                          po.backlog_issue_key === currentKey && "bg-emerald-50"
                        )}
                      >
                        <td className="p-1.5">
                          <div className="flex items-center gap-1 font-bold">
                            {po.backlog_issue_key}
                            {po.is_imported && (
                              <span className="text-[8px] px-1 py-0.5 bg-blue-100 text-blue-800 rounded-sm">
                                IMPORTED
                              </span>
                            )}
                          </div>
                          {po.document_number && (
                            <div className="text-[9px] text-muted-foreground">
                              {po.document_number}
                            </div>
                          )}
                        </td>
                        <td className="p-1.5 max-w-[180px] truncate">
                          {po.description || "—"}
                        </td>
                        <td className="p-1.5">
                          {po.vendor_name || po.vendor_code || "—"}
                        </td>
                        <td className="p-1.5 text-right">
                          <div>{yen(po.amount_ex_tax)}</div>
                          <div
                            className={cn(
                              "text-[9px]",
                              po.remaining_amount <= 0
                                ? "text-emerald-700 font-bold"
                                : "text-muted-foreground"
                            )}
                          >
                            残 {yen(po.remaining_amount)}
                          </div>
                        </td>
                        <td className="p-1.5 text-center">{po.line_count}</td>
                        <td className="p-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => loadPo(po.backlog_issue_key)}
                            disabled={picking === po.backlog_issue_key}
                            className={cn(
                              "text-[9px] font-mono px-2 py-0.5 uppercase rounded-sm border",
                              picking === po.backlog_issue_key
                                ? "border-input text-muted-foreground cursor-wait"
                                : "border-foreground/30 hover:bg-muted"
                            )}
                          >
                            {picking === po.backlog_issue_key ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              "選択"
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
