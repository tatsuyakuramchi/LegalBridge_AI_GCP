/**
 * UnifiedContractPicker — Phase 23.
 *
 * 全フォーム共通の親契約 picker。検収書・利用許諾料計算書・発注書フォーム
 * など、親文書を選ぶ全てのフォームで利用する。
 *
 * Phase 23.0.3: フォーム内 inline ドロップダウンだと表示領域が狭く読みづらい
 * ため Dialog ベースの全幅モーダルに改修。テーブル形式で 種別 / 文書番号・件名
 * / 取引先 / 税抜金額 / 検収状況 を並べる。
 *
 * Props:
 *   acceptableRecordTypes : ["purchase_order","individual_contract",...]
 *                           候補を絞る。検収書なら purchase_order +
 *                           individual_contract + standalone_contract、
 *                           利用許諾料計算書なら individual_contract +
 *                           standalone_contract。
 *   categoryFilter        : ["service","license",...] (任意)
 *   onPick(contract)      : 詳細を取得して呼び出される。フォーム側で
 *                           parent_contract_id / line_items 等を埋める。
 *   onClear               : 親契約連動の解除
 *   currentContractId     : 既に選択済みの契約 ID (ラベル表示用)
 */

import * as React from "react";
import {
  Search,
  Link as LinkIcon,
  Unlink,
  Loader2,
  AlertTriangle,
  PackageOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

export type RecordType =
  | "purchase_order"
  | "individual_contract"
  | "standalone_contract"
  | "master_contract"
  // Phase 26.10: 利用許諾計算書フォームが「条件 (金銭条件を持つ個別文書)」を
  //   直接 picker から選べるよう、条件系の record_type も受け付ける。
  | "license_condition"
  | "publication_condition";

export type Category =
  | "service"
  | "license"
  | "nda"
  | "sales"
  | "publication";

export type ContractSearchHit = {
  id: number;
  record_type: RecordType;
  contract_category: Category;
  contract_type: string;
  contract_title: string;
  document_number: string;
  backlog_issue_key: string;
  vendor_id: number | null;
  vendor_code: string;
  vendor_name: string;
  vendor_entity_type: string;
  amount_ex_tax: number | null;
  amount_inc_tax: number | null;
  tax_rate: number | null;
  due_date: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  drive_link: string;
  original_work: string;
  ledger_code: string;
  is_active: boolean;
  line_count: number;
  condition_count: number;
  inspected_amount: number;
  remaining_amount: number;
  is_imported: boolean;
  created_at: string;
};

export type ContractDetail = {
  contract: {
    id: number;
    record_type: RecordType;
    contract_category: Category;
    contract_type: string;
    contract_title: string;
    document_number: string;
    backlog_issue_key: string;
    amount_ex_tax: number | null;
    amount_inc_tax: number | null;
    tax_rate: number | null;
    due_date: string | null;
    /** Phase 23.5: 発注書系の発注日 (PO header の発行日)。検収書フォームの
     *  orderDate 自動補完の最優先キー。due_date は支払期限なので別概念。 */
    issue_date_po: string | null;
    effective_date: string | null;
    expiration_date: string | null;
    original_work: string;
    ledger_code: string;
  };
  vendor: any | null;
  line_items: any[];
  financial_conditions: any[];
  expenses: any[];
  other_fees: any[];
  document_number: string;
  drive_link: string;
  delivery_progress: {
    ordered_amount_ex_tax: number;
    inspected_amount_ex_tax: number;
    remaining_amount_ex_tax: number;
  };
};

interface Props {
  acceptableRecordTypes: RecordType[];
  categoryFilter?: Category[];
  currentContractId?: number;
  hasParent: boolean;
  onPick: (detail: ContractDetail) => void;
  onClear: () => void;
  /** ボタンのラベル (例: "親PO/契約を選ぶ", "ライセンス契約を選ぶ") */
  label?: string;
  /** true のとき、金銭条件(condition_count>0)を持つ契約のみ候補に出す。
      利用許諾料計算書で「条件を持つ発注書/契約」だけを選ばせるのに使う。 */
  requireConditions?: boolean;
  /** 指定すると、その契約 ID を自動で詳細取得して onPick する(ディープリンク用)。
      未検収発注書インボックス → 検収書作成 のように親POを事前選択して開くのに使う。 */
  autoPickContractId?: number;
}

const yen = (n: number | null | undefined) =>
  "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  purchase_order: "発注書",
  individual_contract: "個別契約",
  standalone_contract: "単独契約",
  master_contract: "基本契約",
  license_condition: "利用許諾条件",
  publication_condition: "出版利用許諾条件",
};

const RECORD_TYPE_BADGE_CLASS: Record<RecordType, string> = {
  purchase_order: "bg-primary/10 text-primary border-primary/40",
  individual_contract: "bg-success/10 text-success border-success/40",
  standalone_contract: "bg-info/10 text-info border-info/40",
  master_contract: "bg-warning/10 text-warning border-warning/40",
  license_condition: "bg-teal-100 text-teal-800 border-teal-200",
  publication_condition: "bg-destructive/10 text-destructive border-destructive/40",
};

export const UnifiedContractPicker: React.FC<Props> = ({
  acceptableRecordTypes,
  categoryFilter,
  currentContractId,
  hasParent,
  onPick,
  onClear,
  label,
  autoPickContractId,
  requireConditions,
}) => {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<ContractSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [picking, setPicking] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState("");

  // Phase 23.0.4: 検索 / 詳細取得の race condition 対策。
  //   debounce はタイマー解除だけで in-flight な fetch を止められないため、
  //   AbortController で「前のリクエストを明示的にキャンセル」する。
  //   - searchAbortRef: 検索リクエスト (q / フィルタ変化で発火)
  //   - detailAbortRef: 行クリック / 文書番号指定での詳細取得
  const searchAbortRef = React.useRef<AbortController | null>(null);
  const detailAbortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // 古い検索が走っていればキャンセル
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        params.set("record_types", acceptableRecordTypes.join(","));
        if (categoryFilter && categoryFilter.length > 0) {
          params.set("category", categoryFilter.join(","));
        }
        params.set("limit", "100");
        const res = await fetch(`/api/contracts/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (controller.signal.aborted) return;
        setList(Array.isArray(data) ? data : []);
      } catch (e: any) {
        // AbortError は新しい検索が走ったときの正常終了。state は触らない。
        if (e?.name === "AbortError") return;
        setError(String(e?.message || e));
        setList([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [open, q, acceptableRecordTypes.join(","), (categoryFilter || []).join(",")]);

  // モーダルが閉じられたら in-flight な検索 / 詳細取得もキャンセル。
  React.useEffect(() => {
    if (open) return;
    searchAbortRef.current?.abort();
    detailAbortRef.current?.abort();
  }, [open]);

  const loadDetail = async (id: number) => {
    if (!id) return;
    // 前回の詳細取得が走っていればキャンセル (連打で新しいクリックを優先)
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setPicking(id);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 404)
          throw new Error(`契約 ID ${id} が見つかりません`);
        throw new Error(`HTTP ${res.status}`);
      }
      const detail = (await res.json()) as ContractDetail;
      if (controller.signal.aborted) return;
      onPick(detail);
      setOpen(false);
      setManual("");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(String(e?.message || e));
    } finally {
      // 新しい詳細取得が走ったときは picking 状態を残しておく。
      if (detailAbortRef.current === controller) setPicking(null);
    }
  };

  // ディープリンク: autoPickContractId が来たら、その契約を一度だけ自動選択する。
  //   (未検収発注書インボックス → 検収書作成 で親POを事前選択して開く用)
  const autoPickedRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (
      autoPickContractId &&
      !hasParent &&
      autoPickedRef.current !== autoPickContractId
    ) {
      autoPickedRef.current = autoPickContractId;
      loadDetail(autoPickContractId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPickContractId, hasParent]);

  const loadByDocNumber = async (docNumber: string) => {
    if (!docNumber.trim()) return;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setPicking(-1);
    setError(null);
    try {
      const r = await fetch(
        `/api/contracts/search?q=${encodeURIComponent(docNumber.trim())}&limit=10`,
        { signal: controller.signal }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const arr = (await r.json()) as ContractSearchHit[];
      if (controller.signal.aborted) return;
      const hit = arr.find((x) => x.document_number === docNumber.trim());
      if (!hit) throw new Error(`文書番号 ${docNumber} の契約が見つかりません`);
      // loadDetail は自分で AbortController を取り直すので、ここで OK。
      await loadDetail(hit.id);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(String(e?.message || e));
    } finally {
      if (detailAbortRef.current === controller) setPicking(null);
    }
  };

  // requireConditions は「発注書(service)を金銭条件付きのものだけに絞る」用途。
  //   ライセンス契約等(個別/単独/出版条件)は条件が capability_financial_conditions に
  //   無い(=condition_count 0)場合もあるため、ここでは絞らず従来どおり全件表示する。
  const filteredList = list.filter(
    (it) =>
      acceptableRecordTypes.includes(it.record_type) &&
      (!requireConditions ||
        it.record_type !== "purchase_order" ||
        (Number(it.condition_count) || 0) > 0)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-sm",
            hasParent
              ? "bg-success/10 border-success/40 text-success hover:bg-success/10"
              : "bg-white border-slate-300 hover:bg-slate-50"
          )}
        >
          {hasParent ? <LinkIcon size={14} /> : <Search size={14} />}
          {label || (hasParent ? "親契約を切り替える" : "親契約を選ぶ")}
        </button>
        {hasParent && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-2 rounded-sm border border-slate-300 px-3 py-1.5 text-sm bg-white hover:bg-slate-50"
          >
            <Unlink size={14} />
            連動解除
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl w-[92vw] max-h-[88vh] flex flex-col p-0">
          <DialogHeader>
            <DialogTitle>親契約を選ぶ</DialogTitle>
            <DialogDescription>
              対象: {acceptableRecordTypes.map((rt) => RECORD_TYPE_LABEL[rt]).join(" / ")}
              {categoryFilter && categoryFilter.length > 0 && (
                <> ・ カテゴリ: {categoryFilter.join(" / ")}</>
              )}
              ・ 文書番号 / 件名 / 取引先名 / Backlog キー で部分一致検索
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex-1 overflow-hidden flex flex-col gap-3 min-h-0">
            {/* 検索バー */}
            <div className="flex items-center gap-2">
              <Search size={16} className="text-slate-400 flex-shrink-0" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="例: 大神貴寛 / PO-2026-055 / LEGAL-120 / ボードゲーム"
                className="flex-1 rounded-sm border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-slate-500"
                autoFocus
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="text-xs px-2 py-1.5 rounded-sm border border-slate-300 bg-white hover:bg-slate-50"
                >
                  <X size={12} className="inline mr-1" />
                  クリア
                </button>
              )}
              <span className="text-xs text-slate-500 ml-2 whitespace-nowrap">
                {loading ? "検索中..." : `${filteredList.length} 件`}
              </span>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* 結果テーブル */}
            <div className="flex-1 overflow-auto rounded-sm border border-slate-200 min-h-[300px]">
              {loading ? (
                <div className="flex items-center justify-center p-12 text-slate-400">
                  <Loader2 size={20} className="animate-spin mr-2" />
                  検索中...
                </div>
              ) : filteredList.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-slate-400 text-sm gap-2">
                  <PackageOpen size={32} />
                  該当する契約がありません
                  {q && <span className="text-xs">検索ワードを変えてみてください</span>}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr className="text-left text-slate-600">
                      <th className="px-3 py-2 font-medium w-24">種別</th>
                      <th className="px-3 py-2 font-medium">文書番号 / 件名</th>
                      <th className="px-3 py-2 font-medium w-44">取引先</th>
                      <th className="px-3 py-2 font-medium w-28 text-right">税抜金額</th>
                      <th className="px-3 py-2 font-medium w-32">検収状況</th>
                      <th className="px-3 py-2 font-medium w-16 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredList.map((it) => {
                      const pct =
                        it.amount_ex_tax && it.amount_ex_tax > 0
                          ? Math.round((it.inspected_amount / it.amount_ex_tax) * 100)
                          : 0;
                      return (
                        <tr
                          key={it.id}
                          // Phase 23.0.4: キーボード操作対応。Enter/Space で行選択を発火。
                          //   `<tr role="button" tabIndex={0}>` で SR にもボタンとして読まれる。
                          role="button"
                          tabIndex={picking === it.id ? -1 : 0}
                          aria-label={`契約 ${it.document_number || it.contract_title} を選択`}
                          aria-disabled={picking === it.id || undefined}
                          className={cn(
                            "hover:bg-slate-50 cursor-pointer transition",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success",
                            currentContractId === it.id && "bg-success/10",
                            picking === it.id && "opacity-50"
                          )}
                          onClick={() => loadDetail(it.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              loadDetail(it.id);
                            }
                          }}
                        >
                          <td className="px-3 py-2 align-top">
                            <span
                              className={cn(
                                "inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap",
                                RECORD_TYPE_BADGE_CLASS[it.record_type]
                              )}
                            >
                              {RECORD_TYPE_LABEL[it.record_type]}
                            </span>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {it.contract_category}
                            </div>
                            {it.is_imported && (
                              <span className="inline-block mt-1 text-[11px] bg-warning/10 text-warning px-1 py-0.5 rounded">
                                IMPORT
                              </span>
                            )}
                            {!it.is_active && (
                              <span className="inline-block mt-1 text-[11px] bg-slate-200 text-slate-600 px-1 py-0.5 rounded">
                                無効
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top min-w-0">
                            <div className="font-mono text-slate-900 font-medium">
                              {it.document_number || "(文書番号未採番)"}
                            </div>
                            <div className="text-slate-700 mt-0.5 break-words">
                              {it.contract_title || "(件名なし)"}
                            </div>
                            {it.backlog_issue_key && (
                              <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                {it.backlog_issue_key}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="text-slate-800 truncate" title={it.vendor_name}>
                              {it.vendor_name || "(取引先不明)"}
                            </div>
                            {it.vendor_code && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {it.vendor_code}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-right">
                            {it.amount_ex_tax != null ? (
                              <span className="font-mono text-slate-900">
                                {yen(it.amount_ex_tax)}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {it.line_count > 0 && `明細 ${it.line_count}件`}
                              {it.condition_count > 0 && `条件 ${it.condition_count}件`}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {it.amount_ex_tax && it.amount_ex_tax > 0 ? (
                              <>
                                <div className="flex items-center gap-1">
                                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full transition-all",
                                        pct >= 100
                                          ? "bg-success"
                                          : pct > 0
                                          ? "bg-primary/15"
                                          : "bg-slate-300"
                                      )}
                                      style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-slate-600 w-8 text-right">
                                    {pct}%
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-1">
                                  残 {yen(it.remaining_amount)}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-center">
                            {picking === it.id ? (
                              <Loader2
                                size={14}
                                className="animate-spin inline-block text-slate-400"
                              />
                            ) : (
                              <span className="text-[10px] text-success font-medium">
                                選択
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </DialogBody>

          <DialogFooter className="!justify-between !flex-row">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs text-slate-600 whitespace-nowrap">
                文書番号で直接指定:
              </span>
              <input
                type="text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="例: ARC-PO-2026-0001"
                className="flex-1 max-w-xs rounded-sm border border-slate-300 px-2 py-1.5 text-xs font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manual.trim()) {
                    e.preventDefault();
                    loadByDocNumber(manual);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => loadByDocNumber(manual)}
                disabled={!manual.trim() || picking === -1}
                className="rounded-sm border border-slate-300 px-3 py-1.5 text-xs bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                {picking === -1 ? <Loader2 size={12} className="animate-spin" /> : "適用"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm border border-slate-300 px-3 py-1.5 text-xs bg-white hover:bg-slate-50"
            >
              閉じる
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
