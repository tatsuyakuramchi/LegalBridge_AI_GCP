/**
 * ConditionCopyPanel — WMC-2: 利用許諾条件書フォームで「原作素材に既に登録済みの
 *   金銭条件(L1/L2)を引用してコピー」する導線。
 *
 * 設計(work-material-condition-copy-plan.md, O1=手動 / O2=一覧 / O6=L1優先):
 *   - 選択中の原作素材(material_code)をキーに WMC-1 API を叩き、その素材に
 *     紐づく既存条件を一覧表示する。
 *   - ユーザーが手動で1件選び「コピー」すると、その値を新しい FinancialCondition
 *     行として親フォームへ追加する(値コピー = テンプレ→インスタンス。共有ではない)。
 *   - is_template(原作登録器 MLC- 由来 = L1)を優先表示・バッジ表示する。
 *
 * これ自体は条件の「保存」はしない。コピーした行は通常の financial_conditions と
 * 同じ保存パス(/api/documents → upsertCapabilityFinancialConditions)に乗る。
 */

import React from "react";
import { Copy, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type FinancialCondition,
  buildFormulaText,
  calcMethodFromType,
  composeRegionLabel,
} from "./FinancialConditionTable";

// WMC-1 API が返す候補行(cfc 由来の金銭条件 + メタ)。
type CopyCandidate = {
  source_condition_line_id: number;
  source_condition_id: number | null;
  source_work_id: number | null;
  capability_id: number | null;
  document_number: string | null;
  contract_title: string | null;
  is_template: boolean;
  origin_work_code: string | null;
  origin_work_title: string | null;
  work_material_id: number | null;
  material_code: string | null;
  material_name: string | null;
  condition_no: number | null;
  condition_name: string | null;
  region_territory: string | null;
  region_language: string | null;
  region_language_label: string | null;
  calc_method: string | null;
  calc_type: FinancialCondition["calc_type"] | null;
  fixed_kind: FinancialCondition["fixed_kind"] | null;
  subscription_cycle: FinancialCondition["subscription_cycle"] | null;
  unit_amount: number | null;
  guarantee_type: FinancialCondition["guarantee_type"] | null;
  rate_pct: number | null;
  base_price_label: string | null;
  calc_period: string | null;
  calc_period_kind: FinancialCondition["calc_period_kind"] | null;
  calc_period_close_month: number | null;
  currency: string | null;
  formula_text: string | null;
  payment_terms: string | null;
  mg_amount: number | null;
  ag_amount: number | null;
  applies_scope: string | null;
};

interface Props {
  /** 選択中の原作素材コード(=ledger material / work_materials の material_code)。 */
  materialCode?: string;
  /** 表示用の素材ラベル(原作タイトル + 素材名 等)。 */
  materialLabel?: string;
  /** 既存の金銭条件(コピー後の condition_no 採番に使用)。 */
  existing: FinancialCondition[];
  /** コピー確定時、新しい1行を親 financial_conditions に追加する。 */
  onCopy: (cond: FinancialCondition) => void;
  readOnly?: boolean;
}

// 候補(cfc shape) → フォームの FinancialCondition へ変換。
//   id は付けない(= 新規行 = 値コピー。共有でない)。
//   O4: コピー元 cfc.id を copied_from_condition_id に保持し、保存時に痕跡を残す。
function candidateToCondition(
  cand: CopyCandidate,
  nextNo: number
): FinancialCondition {
  const territory = cand.region_territory || "";
  const language = cand.region_language || "";
  const label =
    composeRegionLabel(territory, language) || cand.region_language_label || "";
  const c: FinancialCondition = {
    condition_no: nextNo,
    condition_name: cand.condition_name || undefined,
    region_territory: territory || undefined,
    region_language: language || undefined,
    region_language_label: label || undefined,
    calc_type: cand.calc_type || undefined,
    calc_method:
      cand.calc_method || calcMethodFromType(cand.calc_type || undefined) || undefined,
    fixed_kind: cand.fixed_kind || undefined,
    subscription_cycle: cand.subscription_cycle || undefined,
    unit_amount: cand.unit_amount ?? undefined,
    guarantee_type: cand.guarantee_type || undefined,
    rate_pct: cand.rate_pct ?? undefined,
    base_price_label: cand.base_price_label || undefined,
    calc_period: cand.calc_period || undefined,
    calc_period_kind: cand.calc_period_kind || undefined,
    calc_period_close_month: cand.calc_period_close_month ?? undefined,
    currency: cand.currency || "JPY",
    payment_terms: cand.payment_terms || undefined,
    mg_amount: cand.mg_amount ?? undefined,
    ag_amount: cand.ag_amount ?? undefined,
    applies_scope: cand.applies_scope || undefined,
    // O4: コピー元 cfc.id を痕跡として保持(保存時 cfc.copied_from_condition_id へ)。
    copied_from_condition_id: cand.source_condition_id ?? undefined,
  };
  // 計算式テキストは構造化値から再生成(無ければ元の formula_text を踏襲)。
  c.formula_text = buildFormulaText(c) || cand.formula_text || undefined;
  return c;
}

// 候補1件の計算サマリ(一覧表示用)。
function summarize(cand: CopyCandidate): string {
  const parts: string[] = [];
  if (cand.calc_type === "FIXED") parts.push("固定額");
  else if (cand.calc_type === "SUBSCRIPTION") parts.push("サブスク");
  else if (cand.calc_type === "SUPPLY_QTY") parts.push("供給価格×個数");
  else if (cand.rate_pct != null) parts.push(`料率 ${cand.rate_pct}%`);
  if (cand.base_price_label) parts.push(cand.base_price_label);
  if (cand.mg_amount) parts.push(`MG ¥${Number(cand.mg_amount).toLocaleString("ja-JP")}`);
  const region =
    composeRegionLabel(cand.region_territory || "", cand.region_language || "") ||
    cand.region_language_label ||
    "";
  if (region) parts.push(region);
  return parts.join(" / ") || "(条件詳細なし)";
}

export const ConditionCopyPanel: React.FC<Props> = ({
  materialCode,
  materialLabel,
  existing,
  onCopy,
  readOnly,
}) => {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<CopyCandidate[] | null>(null);
  const [copiedKeys, setCopiedKeys] = React.useState<Set<number>>(new Set());

  const nextNo = React.useMemo(() => {
    const max = (existing || []).reduce(
      (m, c) => Math.max(m, Number(c?.condition_no) || 0),
      0
    );
    return max + 1;
  }, [existing]);

  const fetchCandidates = React.useCallback(async () => {
    if (!materialCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v3/materials/by-code/${encodeURIComponent(
          materialCode
        )}/copy-source-conditions`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCandidates(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(String(e?.message || e));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [materialCode]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && candidates == null && !loading) void fetchCandidates();
  };

  if (!materialCode) {
    return (
      <div className="col-span-full mt-3 text-[10px] font-mono text-muted-foreground">
        既存条件を引用するには、先に上で<strong>原作素材</strong>を選択してください。
      </div>
    );
  }

  return (
    <div className="col-span-full mt-3 rounded-md border border-sky-200 bg-sky-50/40 px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-sky-700">
          <Copy className="h-3.5 w-3.5" />
          この原作素材の既存条件を引用してコピー
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-sky-600" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-sky-600" />
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-mono text-sky-800/80">
              対象素材：<span className="font-bold">{materialLabel || materialCode}</span>
              {" "}（同一原作素材に登録された条件を一覧。L1=原作登録テンプレを優先表示）
            </p>
            <button
              type="button"
              onClick={() => void fetchCandidates()}
              disabled={loading}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-sky-300 text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              再取得
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 取得中…
            </div>
          )}
          {error && (
            <div className="text-[10px] font-mono text-red-600 py-1">
              取得に失敗しました: {error}
            </div>
          )}
          {!loading && !error && candidates && candidates.length === 0 && (
            <div className="text-[10px] font-mono text-muted-foreground py-1">
              この原作素材に登録済みの条件は見つかりませんでした。
            </div>
          )}

          {!loading && candidates && candidates.length > 0 && (
            <ul className="space-y-1">
              {candidates.map((cand) => {
                const copied = copiedKeys.has(cand.source_condition_line_id);
                const origin =
                  cand.origin_work_title || cand.origin_work_code || "";
                return (
                  <li
                    key={cand.source_condition_line_id}
                    className="flex items-center gap-2 rounded-sm bg-white/70 border border-sky-100 px-2 py-1"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {cand.is_template && (
                          <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded-sm bg-amber-100 text-amber-800 border border-amber-300">
                            L1 テンプレ
                          </span>
                        )}
                        <span className="text-[11px] font-mono font-bold truncate">
                          条件{cand.condition_no ?? "?"}
                          {cand.condition_name ? `　${cand.condition_name}` : ""}
                        </span>
                        {(cand.document_number || origin) && (
                          <span className="text-[9px] font-mono text-muted-foreground truncate">
                            {cand.document_number || ""}
                            {origin ? `（${origin}）` : ""}
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] font-mono text-sky-800/70 truncate">
                        {summarize(cand)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => {
                        onCopy(candidateToCondition(cand, nextNo));
                        setCopiedKeys((prev) => {
                          const n = new Set(prev);
                          n.add(cand.source_condition_line_id);
                          return n;
                        });
                      }}
                      className={cn(
                        "shrink-0 text-[9px] font-mono px-2 py-1 rounded-sm border transition-colors",
                        copied
                          ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                          : "border-sky-400 text-sky-700 hover:bg-sky-100"
                      )}
                      title="この条件を新しい行としてコピー(値を引用)"
                    >
                      {copied ? "コピー済 +" : "コピー"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default ConditionCopyPanel;
