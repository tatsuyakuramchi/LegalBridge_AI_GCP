/**
 * RoyaltyPreviewPanel — 利用許諾料計算書フォームの「右側ライブ計算
 * プレビュー」 (Phase 7e)。
 *
 * ユーザーが unit_price (基準価格) / quantity / sample_quantity /
 * tax_rate を入れ替えるたびに、worker の
 *   POST /api/royalty-calculations/preview
 * を 300ms デバウンスで叩き、サーバ側 billing.calculateFee の結果
 * (Gross → MG cascade → AG cascade → tax → 総支払額) を表示する。
 *
 * フロント側でも同じ算式を持つことは可能だが、運用上「サーバ算出が
 * 唯一の真実」のため、ここでは敢えてサーバ往復にして UI と確定保存
 * 結果のズレを防いでいる。
 *
 * Backlog 課題なし (license_contract_id / condition_id 不明) の段階
 * では計算プレビューは出さず、案内メッセージを表示する。
 */

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, AlertTriangle, Coins, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type RoyaltyPreview = {
  unit_price: number;
  quantity: number;
  sample_quantity: number;
  billable_quantity: number;
  rate_pct: number;
  gross_royalty_ex_tax: number;
  mg_amount: number;
  mg_consumed_before: number;
  mg_consumed_this_time: number;
  mg_consumed_after: number;
  mg_remaining: number;
  mg_fully_consumed: boolean;
  ag_amount: number;
  ag_offset_this_time: number;
  ag_remaining: number;
  actual_royalty_ex_tax: number;
  tax_rate: number;
  tax_amount: number;
  total_payment_inc_tax: number;
  currency: string;
  formula_breakdown: string;
};

interface Props {
  licenseContractId?: number;
  licenseFinancialConditionId?: number;
  /**
   * Phase 22.21.91: 契約マスタ (contract_capabilities) ベースの preview。
   * licenseFinancialConditionId が 0/未指定で capabilityFinancialConditionId
   * が指定されている場合、worker は capability_financial_conditions から
   * 条件を引いて what-if 計算する (MG 累積履歴は 0 として扱う)。
   */
  capabilityFinancialConditionId?: number;
  unitPrice: number;
  quantity: number;
  sampleQuantity?: number;
  taxRate?: number;
  /**
   * 計算結果が変わるたび呼ばれる。親フォーム側に書き戻して
   * formData の actualRoyaltyStr / totalPaymentStr / mgRemaining などを
   * 同期させるために使う (確定保存前の preview と確定保存後の値が
   * 一致しないバグを避ける目的)。
   */
  onPreview?: (preview: RoyaltyPreview | null) => void;
}

const yen = (n: number, currency = "JPY") => {
  const sym = currency === "JPY" ? "¥ " : `${currency} `;
  return sym + (Number(n) || 0).toLocaleString("ja-JP");
};

const pct = (n: number) =>
  (Number(n) || 0).toFixed(2).replace(/\.?0+$/, "") + " %";

export const RoyaltyPreviewPanel: React.FC<Props> = ({
  licenseContractId,
  licenseFinancialConditionId,
  capabilityFinancialConditionId,
  unitPrice,
  quantity,
  sampleQuantity,
  taxRate,
  onPreview,
}) => {
  const [preview, setPreview] = useState<RoyaltyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 引数は number / string 混在で来うるので安全側で number 化。
  const args = useMemo(
    () => ({
      license_contract_id: Number(licenseContractId) || 0,
      license_financial_condition_id: Number(licenseFinancialConditionId) || 0,
      capability_financial_condition_id:
        Number(capabilityFinancialConditionId) || 0,
      unit_price: Number(unitPrice) || 0,
      quantity: Number(quantity) || 0,
      sample_quantity: Number(sampleQuantity) || 0,
      tax_rate: taxRate != null ? Number(taxRate) : 10,
    }),
    [
      licenseContractId,
      licenseFinancialConditionId,
      capabilityFinancialConditionId,
      unitPrice,
      quantity,
      sampleQuantity,
      taxRate,
    ]
  );

  // Phase 22.21.91: license 系の id が揃うか、capability の id が揃えば ready。
  //   capability ベースの preview では license_contract_id は不要 (履歴を見ない)。
  const ready =
    ((args.license_contract_id > 0 && args.license_financial_condition_id > 0) ||
      args.capability_financial_condition_id > 0) &&
    args.unit_price > 0 &&
    args.quantity > 0;

  useEffect(() => {
    if (!ready) {
      setPreview(null);
      onPreview?.(null);
      return;
    }

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(async () => {
      // 直前の in-flight があれば中断
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/royalty-calculations/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
        }
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "preview returned !ok");
        const p = data as RoyaltyPreview;
        setPreview(p);
        onPreview?.(p);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(String(e?.message || e));
        setPreview(null);
        onPreview?.(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // onPreview を依存に入れると親 re-render で無限ループするので除外。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.license_contract_id,
    args.license_financial_condition_id,
    args.capability_financial_condition_id,
    args.unit_price,
    args.quantity,
    args.sample_quantity,
    args.tax_rate,
    ready,
  ]);

  // Stale 計算: パラメータと結果がズレているかの確認用 (網羅的に比較)
  const isStale =
    preview &&
    (preview.unit_price !== args.unit_price ||
      preview.quantity !== args.quantity ||
      preview.sample_quantity !== args.sample_quantity ||
      preview.tax_rate !== args.tax_rate);

  return (
    <div className="border border-border rounded-sm bg-card/60 p-4 space-y-3 sticky top-4">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <Calculator className="w-3.5 h-3.5" />
        <span>ライブ計算 (サーバ算出)</span>
        {loading && (
          <span className="ml-auto text-[9px] text-muted-foreground/60">
            calc...
          </span>
        )}
        {isStale && !loading && (
          <span className="ml-auto text-[9px] text-amber-700">
            stale (recalc...)
          </span>
        )}
      </div>

      {!ready ? (
        <div className="text-[10px] font-mono text-muted-foreground bg-muted/30 rounded-sm p-3 border border-dashed border-input">
          以下が揃うと自動計算されます:
          <ul className="mt-1 space-y-0.5">
            <li
              className={cn(
                args.license_financial_condition_id > 0 ||
                  args.capability_financial_condition_id > 0
                  ? "text-emerald-700"
                  : "text-muted-foreground"
              )}
            >
              {args.license_financial_condition_id > 0 ||
              args.capability_financial_condition_id > 0
                ? "✓"
                : "◻"}{" "}
              金銭条件の選択 (条件 1/2/3 のいずれか)
              {args.capability_financial_condition_id > 0 && (
                <span className="ml-1 text-[9px] opacity-60">
                  (契約マスタから)
                </span>
              )}
            </li>
            <li
              className={cn(
                args.unit_price > 0
                  ? "text-emerald-700"
                  : "text-muted-foreground"
              )}
            >
              {args.unit_price > 0 ? "✓" : "◻"} 基準価格 (上代等)
            </li>
            <li
              className={cn(
                args.quantity > 0
                  ? "text-emerald-700"
                  : "text-muted-foreground"
              )}
            >
              {args.quantity > 0 ? "✓" : "◻"} 数量
            </li>
          </ul>
        </div>
      ) : error ? (
        <div className="text-[10px] font-mono text-red-700 bg-red-50 border border-red-200 rounded-sm p-3 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-bold">計算サーバエラー</div>
            <div className="text-[9px] opacity-80 break-all">{error}</div>
          </div>
        </div>
      ) : preview ? (
        <div className="space-y-2 text-[11px] font-mono">
          {/* ---- インプット復唱 ---- */}
          <div className="grid grid-cols-2 gap-1 pb-2 border-b border-border text-[10px] text-muted-foreground">
            <div>基準価格</div>
            <div className="text-right text-foreground">
              {yen(preview.unit_price, preview.currency)}
            </div>
            <div>数量</div>
            <div className="text-right text-foreground">
              {preview.quantity.toLocaleString("ja-JP")}{" "}
              {preview.sample_quantity > 0 && (
                <span className="opacity-60">
                  (うちサンプル {preview.sample_quantity})
                </span>
              )}
            </div>
            <div>請求対象数量</div>
            <div className="text-right text-foreground font-bold">
              {preview.billable_quantity.toLocaleString("ja-JP")}
            </div>
            <div>料率</div>
            <div className="text-right text-foreground">
              {pct(preview.rate_pct)}
            </div>
          </div>

          {/* ---- Gross ---- */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              ① Gross (税抜)
            </div>
            <div className="font-bold text-foreground">
              {yen(preview.gross_royalty_ex_tax, preview.currency)}
            </div>
          </div>

          {/* ---- MG cascade ---- */}
          {preview.mg_amount > 0 && (
            <div className="bg-muted/30 rounded-sm p-2 space-y-1">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Coins className="w-2.5 h-2.5" />
                ② MG 消化
                {preview.mg_fully_consumed && (
                  <span className="ml-auto text-[9px] font-bold text-amber-700">
                    完全消化
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 text-[10px] gap-0.5">
                <div className="text-muted-foreground">MG 総額</div>
                <div className="text-right">
                  {yen(preview.mg_amount, preview.currency)}
                </div>
                <div className="text-muted-foreground">過去消化累計</div>
                <div className="text-right">
                  {yen(preview.mg_consumed_before, preview.currency)}
                </div>
                <div className="text-muted-foreground">今回消化</div>
                <div className="text-right text-foreground font-bold">
                  {yen(preview.mg_consumed_this_time, preview.currency)}
                </div>
                <div className="text-muted-foreground">残 MG</div>
                <div
                  className={cn(
                    "text-right",
                    preview.mg_remaining === 0 && "text-emerald-700 font-bold"
                  )}
                >
                  {yen(preview.mg_remaining, preview.currency)}
                </div>
              </div>
            </div>
          )}

          {/* ---- AG cascade ---- */}
          {preview.ag_amount > 0 && (
            <div className="bg-muted/30 rounded-sm p-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                ③ AG 相殺
              </div>
              <div className="grid grid-cols-2 text-[10px] gap-0.5">
                <div className="text-muted-foreground">AG 総額</div>
                <div className="text-right">
                  {yen(preview.ag_amount, preview.currency)}
                </div>
                <div className="text-muted-foreground">今回相殺</div>
                <div className="text-right">
                  {yen(preview.ag_offset_this_time, preview.currency)}
                </div>
                <div className="text-muted-foreground">残 AG</div>
                <div className="text-right">
                  {yen(preview.ag_remaining, preview.currency)}
                </div>
              </div>
            </div>
          )}

          {/* ---- Actual ---- */}
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <ArrowRight className="w-2.5 h-2.5 inline mr-1" />④ 実支払
              (税抜)
            </div>
            <div className="font-bold text-foreground">
              {yen(preview.actual_royalty_ex_tax, preview.currency)}
            </div>
          </div>

          {/* ---- Tax ---- */}
          <div className="flex items-center justify-between text-[10px]">
            <div className="text-muted-foreground">
              ⑤ 消費税 ({pct(preview.tax_rate)}, 切り上げ)
            </div>
            <div>{yen(preview.tax_amount, preview.currency)}</div>
          </div>

          {/* ---- Total ---- */}
          <div className="flex items-center justify-between pt-2 border-t-2 border-foreground/30 bg-emerald-50 -mx-2 px-2 py-1.5 rounded-sm">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-900">
              ⑥ 総支払額 (税込)
            </div>
            <div className="text-[14px] font-bold text-emerald-900">
              {yen(preview.total_payment_inc_tax, preview.currency)}
            </div>
          </div>

          {/* ---- Formula breakdown ---- */}
          {preview.formula_breakdown && (
            <details className="text-[9px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground select-none">
                ▶ 計算式の内訳
              </summary>
              <pre className="mt-1 whitespace-pre-wrap break-all bg-muted/30 p-2 rounded-sm">
                {preview.formula_breakdown}
              </pre>
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
};
