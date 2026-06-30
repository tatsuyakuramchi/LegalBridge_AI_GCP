/**
 * FinancialConditionPicker — 利用許諾料計算書の「条件一覧」ピッカー。
 *
 * capability_financial_conditions を契約 + 取引先と一緒に一覧し、条件を直接選ぶ。
 * 発注書由来(受注者帰属)の印税条件も、ライセンス契約の条件も同じ土俵で選べる。
 *
 * 選択時は親契約の詳細(/api/contracts/:capability_id)を取得して
 *   onPick(detail, conditionId) を呼ぶ。呼び出し側で
 *   selectMasterContract(detail) + 条件確定(capability_financial_condition_id) を行う。
 */
import * as React from "react";
import { Search, X } from "lucide-react";

export type ConditionHit = {
  id: number;
  condition_no: number;
  condition_name: string;
  region_language_label: string;
  calc_type: string | null;
  calc_method: string;
  rate_pct: number | null;
  base_price_label: string;
  mg_amount: number;
  ag_amount: number;
  guarantee_type: string | null;
  currency: string;
  capability_id: number;
  document_number: string;
  contract_title: string;
  contract_category: string;
  record_type: string;
  vendor_name: string;
  vendor_code: string;
};

interface Props {
  onPick: (detail: any, conditionId: number) => void;
  onClear: () => void;
  currentConditionId?: number;
  label?: string;
}

const CALC_TYPE_LABEL: Record<string, string> = {
  BASE_QTY_RATE: "基準価格×個数×料率",
  BASE_RATE: "基準価格×料率",
  FIXED: "固定値",
  SUBSCRIPTION: "サブスク",
};

const RECORD_TYPE_LABEL: Record<string, string> = {
  purchase_order: "発注書",
  individual_contract: "個別契約",
  standalone_contract: "単独契約",
  publication_condition: "出版条件",
  master_contract: "基本契約",
  license_condition: "利用許諾条件",
  delivery_record: "発注書(検収済)",
};

export const FinancialConditionPicker: React.FC<Props> = ({
  onPick,
  onClear,
  currentConditionId,
  label,
}) => {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<ConditionHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [picking, setPicking] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const searchAbortRef = React.useRef<AbortController | null>(null);
  const detailAbortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        params.set("limit", "150");
        const res = await fetch(
          `/api/financial-conditions/search?${params.toString()}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (controller.signal.aborted) return;
        setList(Array.isArray(data) ? data : []);
      } catch (e: any) {
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
  }, [open, q]);

  React.useEffect(() => {
    if (open) return;
    searchAbortRef.current?.abort();
    detailAbortRef.current?.abort();
  }, [open]);

  const pick = async (c: ConditionHit) => {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setPicking(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${c.capability_id}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`契約詳細の取得に失敗 (HTTP ${res.status})`);
      const detail = await res.json();
      if (controller.signal.aborted) return;
      onPick(detail, c.id);
      setOpen(false);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(String(e?.message || e));
    } finally {
      if (!controller.signal.aborted) setPicking(null);
    }
  };

  const condLabel = (c: ConditionHit) => {
    if (c.calc_type && CALC_TYPE_LABEL[c.calc_type]) return CALC_TYPE_LABEL[c.calc_type];
    return c.calc_method || "—";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 flex items-center gap-2 text-left text-[11px] font-mono border border-input rounded-sm px-3 py-2 hover:border-foreground bg-card"
        >
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground/70">
            {label || "利用許諾条件（印税）を一覧から選ぶ"}
          </span>
        </button>
        {currentConditionId ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-mono text-muted-foreground hover:text-destructive border border-input rounded-sm px-2 py-1"
          >
            解除
          </button>
        ) : null}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-auto"
          onClick={() => setOpen(false)}
        >
          <div
            className="lb-overlay bg-card w-full max-w-3xl rounded-md border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="text-sm font-mono font-bold">利用許諾条件を選ぶ</div>
              <button type="button" onClick={() => setOpen(false)}>
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-border">
              <div className="flex items-center gap-2 border border-input rounded-sm px-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="条件名称 / 契約番号 / 件名 / 取引先 で検索"
                  className="flex-1 text-xs font-mono bg-transparent py-2 focus:outline-none"
                />
                <span className="text-[10px] font-mono text-muted-foreground">
                  {list.length} 件
                </span>
              </div>
              {error && (
                <div className="mt-2 text-[11px] font-mono text-destructive border border-destructive/40 bg-destructive/5 rounded-sm px-2 py-1">
                  {error}
                </div>
              )}
            </div>
            <div className="max-h-[60vh] overflow-auto divide-y divide-border">
              {loading && list.length === 0 ? (
                <div className="p-6 text-center text-[11px] font-mono text-muted-foreground">
                  読み込み中…
                </div>
              ) : list.length === 0 ? (
                <div className="p-6 text-center text-[11px] font-mono text-muted-foreground">
                  条件が見つかりません。発注書の受注者帰属(利用許諾)や、ライセンス契約／出版条件に
                  金銭条件を登録してください。
                </div>
              ) : (
                list.map((c) => {
                  const selected = currentConditionId === c.id;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => pick(c)}
                      disabled={picking != null}
                      className={`w-full text-left px-4 py-2.5 hover:bg-muted/40 flex items-center gap-3 ${
                        selected ? "bg-emerald-50" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-foreground text-background">
                            {RECORD_TYPE_LABEL[c.record_type] || c.record_type}
                          </span>
                          <span className="text-[12px] font-mono font-bold truncate">
                            {c.condition_name || `条件 ${c.condition_no}`}
                          </span>
                          {c.region_language_label && (
                            <span className="text-[10px] font-mono text-muted-foreground truncate">
                              （{c.region_language_label}）
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">
                          {c.document_number}
                          {c.contract_title ? ` ｜ ${c.contract_title}` : ""}
                          {c.vendor_name ? ` ｜ ${c.vendor_name}` : ""}
                        </div>
                      </div>
                      <div className="text-right text-[10px] font-mono shrink-0">
                        <div className="font-bold">{condLabel(c)}</div>
                        <div className="text-muted-foreground">
                          {c.rate_pct != null ? `料率 ${c.rate_pct}%` : ""}
                          {c.guarantee_type === "MG" && c.mg_amount
                            ? ` / MG`
                            : ""}
                          {c.guarantee_type === "AG" && c.ag_amount
                            ? ` / AG`
                            : ""}
                        </div>
                      </div>
                      {picking === c.id && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          選択中…
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
