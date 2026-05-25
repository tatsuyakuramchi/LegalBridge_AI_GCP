/**
 * Licensing pipeline DB helpers + thin wrappers around billing.calculateFee.
 *
 * Phase 6 で純粋な計算 (gross / MG / 税) は billing.ts に統合された。
 * このモジュールに残るのは licensing 固有の DB 集計と shape adapter:
 *   - calculateGrossRoyalty / applyMgConsumption: billing への wrapper
 *   - getMgConsumedToDate: royalty_calculations の累積 SUM
 *   - previewRoyaltyCalculation: 1 計算書分の試算 (DB lookup + billing)
 *   - getLicenseMgStatus: 金銭条件単位の MG 残高サマリ
 *
 * 計算順序 (Legal-confirmed):
 *   gross → MG 相殺 → AG 相殺 → actual_ex_tax → ceil 消費税 → total
 */

import { query } from "./db.ts";
import { calculateTax } from "./calc.ts";
import { calculateFee } from "./billing.ts";

// -------------------------------------------------------------------
// Pure helpers (no DB)
// -------------------------------------------------------------------

/**
 * 総ロイヤリティ (税抜) を計算する。
 *   gross = ceil(unit_price × billable_quantity × rate_pct / 100)
 *
 * Phase 6 で billing.calculateFee に委譲。シグネチャは後方互換のため維持。
 */
export function calculateGrossRoyalty(
  unitPrice: number,
  billableQuantity: number,
  ratePct: number
): number {
  return calculateFee(
    {
      type: "performance",
      base_price: unitPrice,
      quantity: billableQuantity,
      rate_pct: ratePct,
    },
    {},
    0 // 税はここでは別計算
  ).gross_ex_tax;
}

/**
 * MG 消化を適用する。grossRoyalty と mgRemainingBefore を受け取り、
 * 今回消化額・残額・MG 消化完了フラグ・実支払額を返す。
 *
 * Phase 6 で billing.calculateFee の MG 段に委譲。AG は使わず, 税も別。
 */
export function applyMgConsumption(
  grossRoyalty: number,
  mgRemainingBefore: number
): {
  mg_consumed_this_time: number;
  mg_remaining_after: number;
  mg_fully_consumed: boolean;
  actual_royalty: number;
} {
  // billing.calculateFee に MG 残を mg_amount として渡し,
  // mg_consumed_before=0 として「丸ごと残っている」状態を表現する.
  // gross は固定で渡すために unit_price=1, quantity=gross の Fixed term を使う.
  const r = calculateFee(
    {
      type: "fixed",
      unit_price: Math.max(0, Number(grossRoyalty) || 0),
      quantity: 1,
    },
    {
      mg_amount: Math.max(0, Number(mgRemainingBefore) || 0),
      mg_consumed_before: 0,
    },
    0
  );
  return {
    mg_consumed_this_time: r.mg_consumed_this_time,
    mg_remaining_after: r.mg_remaining_after,
    mg_fully_consumed: r.mg_fully_consumed,
    actual_royalty: r.actual_ex_tax,
  };
}

// -------------------------------------------------------------------
// DB-touching helpers
// -------------------------------------------------------------------

/**
 * 指定ライセンス契約 (任意で特定の金銭条件) のこれまでの MG 累積
 * 消化額を返す。Phase 5b の preview/save エンドポイントで「今回前の
 * MG 残」を求めるのに使う。
 *
 * 注: license_financial_condition_id で絞らない場合、その契約全体の
 *      MG 累積消化を返す (金銭条件単位の MG が複数ある場合に注意)。
 */
export async function getMgConsumedToDate(
  licenseContractId: number,
  licenseFinancialConditionId?: number,
  excludeCalculationId?: number
): Promise<number> {
  const conditions: string[] = ["license_contract_id = $1"];
  const params: any[] = [licenseContractId];
  if (licenseFinancialConditionId != null) {
    params.push(licenseFinancialConditionId);
    conditions.push(`license_financial_condition_id = $${params.length}`);
  }
  if (excludeCalculationId != null) {
    params.push(excludeCalculationId);
    conditions.push(`id <> $${params.length}`);
  }
  const res = await query(
    `SELECT COALESCE(SUM(mg_consumed_this_time), 0) AS consumed
       FROM royalty_calculations
      WHERE ${conditions.join(" AND ")}`,
    params
  );
  return Number(res.rows[0].consumed) || 0;
}

/**
 * Phase 22.21.95: AG (前払い保証金) の累積消化額を返す。
 *   royalty_calculations.ag_consumed_this_time (新規列) を SUM する。
 *   列が存在しない古い DB では undefined_column 例外を握り潰して 0 を返す。
 */
export async function getAgConsumedToDate(
  licenseContractId: number,
  licenseFinancialConditionId?: number,
  excludeCalculationId?: number
): Promise<number> {
  const conditions: string[] = ["license_contract_id = $1"];
  const params: any[] = [licenseContractId];
  if (licenseFinancialConditionId != null) {
    params.push(licenseFinancialConditionId);
    conditions.push(`license_financial_condition_id = $${params.length}`);
  }
  if (excludeCalculationId != null) {
    params.push(excludeCalculationId);
    conditions.push(`id <> $${params.length}`);
  }
  try {
    const res = await query(
      `SELECT COALESCE(SUM(ag_consumed_this_time), 0) AS consumed
         FROM royalty_calculations
        WHERE ${conditions.join(" AND ")}`,
      params
    );
    return Number(res.rows[0].consumed) || 0;
  } catch (err: any) {
    // 42703 = undefined column → 列マイグレーション前の DB なので 0 とみなす
    if (err && err.code === "42703") return 0;
    throw err;
  }
}

/**
 * 利用許諾料計算書を 1 件 preview する (まだ保存しない)。
 * フロントが「数量を 100 に変更したら税込いくら？」と問い合わせる用途。
 *
 * 戻り値は royalty_calculations にそのまま挿入できる shape にしてある。
 */
export async function previewRoyaltyCalculation(params: {
  license_contract_id: number;
  license_financial_condition_id: number;
  unit_price: number;
  quantity: number;
  sample_quantity?: number;
  tax_rate?: number;
  /**
   * AG fields are optional. If you have AG on a license, pass the total
   * here; mg/ag consumed-before are looked up from royalty_calculations.
   */
  ag_amount?: number;
  /**
   * Phase 22.21.91: 契約マスタ (contract_capabilities) からの preview。
   * license_financial_condition_id が 0/falsy で capability_financial_condition_id
   * が指定された場合、capability_financial_conditions から rate/mg/currency を引いて
   * 計算する。MG 消化履歴は royalty_calculations に capability ベースの
   * 紐付けが無いため 0 とみなす ("master からの新規 what-if preview")。
   */
  capability_financial_condition_id?: number;
}): Promise<{
  unit_price: number;
  quantity: number;
  sample_quantity: number;
  billable_quantity: number;
  rate_pct: number;
  gross_royalty_ex_tax: number;
  // Phase 22.21.95: MG は floor。mg_consumed_* は legacy 互換のため 0 を返す。
  mg_amount: number;
  mg_consumed_before: number;
  mg_consumed_this_time: number;
  mg_consumed_after: number;
  mg_remaining: number;
  mg_fully_consumed: boolean;
  mg_floor_applied: boolean;
  mg_topup_this_time: number;
  // Phase 22.21.95: AG は累積消化型
  ag_amount: number;
  ag_consumed_before: number;
  ag_consumed_this_time: number;
  ag_consumed_after: number;
  ag_offset_this_time: number;
  ag_remaining: number;
  ag_fully_consumed: boolean;
  actual_royalty_ex_tax: number;
  tax_rate: number;
  tax_amount: number;
  total_payment_inc_tax: number;
  currency: string;
  formula_breakdown: string;
}> {
  // Phase 22.21.91: capability ベースの preview なら capability_financial_conditions
  // から条件を引く。license ベースのときは従来通り license_financial_conditions から。
  // Phase 22.21.95: ag_amount を SELECT に追加 (列が無い古い DB では COALESCE で 0)。
  const useCapability =
    (!params.license_financial_condition_id ||
      params.license_financial_condition_id <= 0) &&
    !!params.capability_financial_condition_id &&
    params.capability_financial_condition_id > 0;
  const condRes = useCapability
    ? await query(
        `SELECT rate_pct, mg_amount,
                COALESCE(ag_amount, 0) AS ag_amount,
                currency
           FROM capability_financial_conditions
          WHERE id = $1`,
        [params.capability_financial_condition_id]
      )
    : await query(
        `SELECT rate_pct, mg_amount,
                COALESCE(ag_amount, 0) AS ag_amount,
                currency
           FROM license_financial_conditions
          WHERE id = $1`,
        [params.license_financial_condition_id]
      );
  if (condRes.rows.length === 0) {
    throw new Error(
      useCapability
        ? `capability_financial_condition ${params.capability_financial_condition_id} not found`
        : `license_financial_condition ${params.license_financial_condition_id} not found`
    );
  }
  const ratePct = Number(condRes.rows[0].rate_pct) || 0;
  const mgAmount = Number(condRes.rows[0].mg_amount) || 0;
  // Phase 22.21.95: AG = DB の ag_amount。フォームから明示的に渡された場合は上書き。
  const agAmount =
    params.ag_amount != null
      ? Number(params.ag_amount) || 0
      : Number(condRes.rows[0].ag_amount) || 0;
  const currency = condRes.rows[0].currency || "JPY";

  const unitPrice = Number(params.unit_price) || 0;
  const quantity = Number(params.quantity) || 0;
  const sampleQty = Number(params.sample_quantity) || 0;
  const billableQty = Math.max(0, quantity - sampleQty);
  const taxRate = params.tax_rate != null ? Number(params.tax_rate) : 10;

  // Phase 22.21.95: MG は floor 化したので consumed_before 不要 (常に 0)。
  const mgConsumedBefore = 0;
  // AG 累積消化は royalty_calculations.ag_consumed_this_time から SUM。
  //   capability ベースの preview では履歴紐付けが無いので 0。
  const agConsumedBefore = useCapability
    ? 0
    : await getAgConsumedToDate(
        params.license_contract_id,
        params.license_financial_condition_id
      );

  // すべて billing.calculateFee に集約
  const r = calculateFee(
    {
      type: "performance",
      base_price: unitPrice,
      quantity,
      rate_pct: ratePct,
    },
    {
      sample_quantity: sampleQty,
      mg_amount: mgAmount,
      mg_consumed_before: mgConsumedBefore,
      ag_amount: agAmount,
      ag_consumed_before: agConsumedBefore,
    },
    taxRate
  );

  return {
    unit_price: unitPrice,
    quantity,
    sample_quantity: sampleQty,
    billable_quantity: billableQty,
    rate_pct: ratePct,
    gross_royalty_ex_tax: r.gross_ex_tax,
    mg_amount: mgAmount,
    // Phase 22.21.95: MG floor 化に伴い、mg_consumed_* は legacy 0 を返す。
    mg_consumed_before: 0,
    mg_consumed_this_time: 0,
    mg_consumed_after: 0,
    mg_remaining: mgAmount,
    mg_fully_consumed: false,
    // Phase 22.21.95: MG floor 適用フラグと上乗せ額
    mg_floor_applied: r.mg_floor_applied,
    mg_topup_this_time: r.mg_topup_this_time,
    ag_amount: agAmount,
    ag_consumed_before: agConsumedBefore,
    ag_consumed_this_time: r.ag_offset_this_time,
    ag_consumed_after: agConsumedBefore + r.ag_offset_this_time,
    ag_offset_this_time: r.ag_offset_this_time,
    ag_remaining: r.ag_remaining_after,
    ag_fully_consumed: r.ag_fully_consumed,
    actual_royalty_ex_tax: r.actual_ex_tax,
    tax_rate: r.tax_rate,
    tax_amount: r.tax_amount,
    total_payment_inc_tax: r.total_inc_tax,
    currency,
    formula_breakdown: r.formula_breakdown,
  };
}

/**
 * ライセンス契約の MG ステータス (総額・累積消化・残額) を返す。
 * Admin UI のヘッダや warning バナーで使う想定。
 */
export async function getLicenseMgStatus(
  licenseContractId: number
): Promise<
  Array<{
    condition_no: number;
    condition_id: number;
    mg_amount: number;
    consumed_total: number;
    remaining: number;
    fully_consumed: boolean;
  }>
> {
  const conds = await query(
    `SELECT id, condition_no, mg_amount
       FROM license_financial_conditions
      WHERE license_contract_id = $1
      ORDER BY condition_no ASC`,
    [licenseContractId]
  );

  const results: Array<any> = [];
  for (const c of conds.rows) {
    const consumed = await getMgConsumedToDate(licenseContractId, Number(c.id));
    const mgAmount = Number(c.mg_amount) || 0;
    const remaining = Math.max(0, mgAmount - consumed);
    results.push({
      condition_no: Number(c.condition_no),
      condition_id: Number(c.id),
      mg_amount: mgAmount,
      consumed_total: consumed,
      remaining,
      fully_consumed: mgAmount > 0 && consumed >= mgAmount,
    });
  }
  return results;
}
