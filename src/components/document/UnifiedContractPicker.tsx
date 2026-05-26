/**
 * UnifiedContractPicker — Phase 23.
 *
 * 全フォーム共通の親契約 picker。検収書・利用許諾料計算書・発注書フォーム
 * など、親文書を選ぶ全てのフォームで利用する。
 *
 * 旧 ParentPoPicker (order_items) と、selected_master_contract_id を inline
 * セレクタで選ぶ方式 (contract_capabilities) の 2 系統を 1 本に統合。
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
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RecordType =
  | "purchase_order"
  | "individual_contract"
  | "standalone_contract"
  | "master_contract";

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
}

const yen = (n: number | null | undefined) =>
  "¥ " + (Number(n) || 0).toLocaleString("ja-JP");

const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  purchase_order: "発注書",
  individual_contract: "個別契約",
  standalone_contract: "単独契約",
  master_contract: "基本契約",
};

export const UnifiedContractPicker: React.FC<Props> = ({
  acceptableRecordTypes,
  categoryFilter,
  currentContractId,
  hasParent,
  onPick,
  onClear,
  label,
}) => {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<ContractSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [picking, setPicking] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
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
        params.set("limit", "50");
        const res = await fetch(`/api/contracts/search?${params.toString()}`);
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
  }, [open, q, acceptableRecordTypes.join(","), (categoryFilter || []).join(",")]);

  const loadDetail = async (id: number) => {
    if (!id) return;
    setPicking(id);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${id}`);
      if (!res.ok) {
        if (res.status === 404)
          throw new Error(`契約 ID ${id} が見つかりません`);
        throw new Error(`HTTP ${res.status}`);
      }
      const detail = (await res.json()) as ContractDetail;
      onPick(detail);
      setOpen(false);
      setManual("");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setPicking(null);
    }
  };

  // 手動入力 (document_number から逆引き)
  const loadByDocNumber = async (docNumber: string) => {
    if (!docNumber.trim()) return;
    setPicking(-1);
    setError(null);
    try {
      const r = await fetch(
        `/api/contracts/search?q=${encodeURIComponent(docNumber.trim())}&limit=10`
      );
      const arr = (await r.json()) as ContractSearchHit[];
      const hit = arr.find(
        (x) => x.document_number === docNumber.trim()
      );
      if (!hit) throw new Error(`文書番号 ${docNumber} の契約が見つかりません`);
      await loadDetail(hit.id);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setPicking(null);
    }
  };

  const filteredList = list.filter((it) =>
    acceptableRecordTypes.includes(it.record_type)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-sm",
            hasParent
              ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
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

      {open && (
        <div className="rounded-sm border border-slate-300 bg-white p-3 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="文書番号 / タイトル / 取引先名 / Backlogキー で検索"
              className="flex-1 rounded-sm border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="text-xs text-slate-500">
              対象: {acceptableRecordTypes.map((rt) => RECORD_TYPE_LABEL[rt]).join("/")}
            </span>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-sm border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5" />
              {error}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-sm border border-slate-200">
            {loading ? (
              <div className="flex items-center justify-center p-6 text-slate-400">
                <Loader2 size={16} className="animate-spin mr-2" />
                検索中...
              </div>
            ) : filteredList.length === 0 ? (
              <div className="flex items-center justify-center p-6 text-slate-400 text-sm">
                <PackageOpen size={16} className="mr-2" />
                該当する契約がありません
              </div>
            ) : (
              filteredList.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => loadDetail(it.id)}
                  disabled={picking === it.id}
                  className={cn(
                    "w-full text-left p-2 hover:bg-slate-50 transition",
                    currentContractId === it.id && "bg-emerald-50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                          {RECORD_TYPE_LABEL[it.record_type]}
                        </span>
                        <span className="text-slate-500">
                          {it.contract_category}
                        </span>
                        {it.is_imported && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                            IMPORT
                          </span>
                        )}
                        {!it.is_active && (
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">
                            無効
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate font-medium text-sm">
                        {it.contract_title || it.document_number}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 truncate">
                        {it.document_number} ・ {it.vendor_name || "(取引先不明)"}
                        {it.backlog_issue_key && ` ・ ${it.backlog_issue_key}`}
                      </div>
                    </div>
                    <div className="text-right text-xs whitespace-nowrap">
                      {it.amount_ex_tax != null && (
                        <div>
                          <span className="text-slate-400">税抜</span>{" "}
                          {yen(it.amount_ex_tax)}
                        </div>
                      )}
                      {it.line_count > 0 && (
                        <div className="text-slate-400">
                          明細 {it.line_count} 件
                        </div>
                      )}
                      {it.condition_count > 0 && (
                        <div className="text-slate-400">
                          条件 {it.condition_count} 件
                        </div>
                      )}
                      {it.inspected_amount > 0 && (
                        <div className="text-emerald-600">
                          検収済 {yen(it.inspected_amount)}
                        </div>
                      )}
                      {picking === it.id && (
                        <Loader2 size={14} className="animate-spin inline-block" />
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
            <span className="text-xs text-slate-500">文書番号で直接指定:</span>
            <input
              type="text"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="例: ARC-PO-2026-0001"
              className="flex-1 rounded-sm border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => loadByDocNumber(manual)}
              disabled={!manual.trim() || picking === -1}
              className="rounded-sm border border-slate-300 px-3 py-1 text-sm bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              {picking === -1 ? "..." : "適用"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
