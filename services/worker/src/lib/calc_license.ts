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
 * 指定契約 (任意で特定の金銭条件) のこれまでの MG 累積
 * 消化額を返す。Phase 5b の preview/save エンドポイントで「今回前の
 * MG 残」を求めるのに使う。
 *
 * Phase 23: royalty_calculations を license_contract_id /
 *   license_financial_condition_id → capability_id /
 *   capability_financial_condition_id に切替。引数名は後方互換のため維持。
 *
 * 注: condition_id で絞らない場合、その契約全体の
 *      MG 累積消化を返す (金銭条件単位の MG が複数ある場合に注意)。
 */
export async function getMgConsumedToDate(
  capabilityId: number,
  capabilityFinancialConditionId?: number,
  excludeCalculationId?: number
): Promise<number> {
  const conditions: string[] = ["capability_id = $1"];
  const params: any[] = [capabilityId];
  if (capabilityFinancialConditionId != null) {
    params.push(capabilityFinancialConditionId);
    conditions.push(`capability_financial_condition_id = $${params.length}`);
  }
  if (excludeCalculationId != null) {
    params.push(excludeCalculationId);
    conditions.push(`id <> $${params.length}`);
  }
  // Phase D-3 (dual-read): MG 消化累計を void 対応に。
  //   旧 SUM をベースに、取消済み(voided) condition_event に紐づく行のみ除外する。
  //   未移行 (condition_event 無し) の行は従来どおり集計されるため後方互換。
  //   これにより文書 void → 残高自動復元 (E-1) が MG にも効くようになる。
  const res = await query(
    `SELECT COALESCE(SUM(mg_consumed_this_time), 0) AS consumed
       FROM royalty_calculations rc
      WHERE ${conditions.join(" AND ")}
        AND NOT EXISTS (
          SELECT 1 FROM condition_events ev
           WHERE ev.source_royalty_calculation_id = rc.id
             AND ev.voided_at IS NOT NULL
        )`,
    params
  );
  return Number(res.rows[0].consumed) || 0;
}

/**
 * Phase 22.21.95: AG (前払い保証金) の累積消化額を返す。
 *   royalty_calculations.ag_consumed_this_time (新規列) を SUM する。
 *   列が存在しない古い DB では undefined_column 例外を握り潰して 0 を返す。
 *
 * Phase 23: capability_id / capability_financial_condition_id ベース。
 */
export async function getAgConsumedToDate(
  capabilityId: number,
  capabilityFinancialConditionId?: number,
  excludeCalculationId?: number
): Promise<number> {
  const conditions: string[] = ["capability_id = $1"];
  const params: any[] = [capabilityId];
  if (capabilityFinancialConditionId != null) {
    params.push(capabilityFinancialConditionId);
    conditions.push(`capability_financial_condition_id = $${params.length}`);
  }
  if (excludeCalculationId != null) {
    params.push(excludeCalculationId);
    conditions.push(`id <> $${params.length}`);
  }
  try {
    // Phase D-3 (dual-read): MG と対称に AG も void 対応 (取消イベント紐づき行を除外)。
    const res = await query(
      `SELECT COALESCE(SUM(ag_consumed_this_time), 0) AS consumed
         FROM royalty_calculations rc
        WHERE ${conditions.join(" AND ")}
          AND NOT EXISTS (
            SELECT 1 FROM condition_events ev
             WHERE ev.source_royalty_calculation_id = rc.id
               AND ev.voided_at IS NOT NULL
          )`,
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
 * Phase E-2 (dual-read): 発注側の利用許諾条件(料率/MG/AG/通貨)を condition_lines
 * 優先で読む。移行済み(source_condition_id 一致)はそちらを正とし、未移行 /
 * condition_lines 未作成環境は capability_financial_conditions にフォールバック。
 * 値は C-2/C-5 で同名コピーのため挙動不変。旧テーブルへの硬い依存を緩める。
 */
async function getRoyaltyConditionEconomics(
  cfcId: number
): Promise<{ rate_pct: number; mg_amount: number; ag_amount: number; currency: string } | null> {
  try {
    // Stage C-3 (加算型): 1取引形態(cfc)が複数の condition_line(LC別セル)に分解される。
    //   適用料率 = Σ(セル rate_pct)。mg/ag/currency は代表行(最小 line_no)から取得
    //   (分解時、mg/ag は代表行のみが保持し他行は 0 のため二重計上しない)。
    //   非加算型 / 旧データは1行のため、Σ=その行の rate / 代表=その行 で挙動不変。
    const cl = await query(
      `SELECT rate_pct, mg_amount, COALESCE(ag_amount, 0) AS ag_amount, currency
         FROM condition_lines
        WHERE source_condition_id = $1
        ORDER BY line_no, id`,
      [cfcId]
    );
    if (cl.rows.length) {
      const rateSum = cl.rows.reduce(
        (s: number, r: any) => s + (Number(r.rate_pct) || 0),
        0
      );
      const primary = cl.rows[0];
      return {
        rate_pct: rateSum,
        mg_amount: Number(primary.mg_amount) || 0,
        ag_amount: Number(primary.ag_amount) || 0,
        currency: primary.currency || "JPY",
      };
    }
  } catch (err: any) {
    if (!err || (err.code !== "42P01" && err.code !== "42703")) throw err;
  }
  const r = await query(
    `SELECT rate_pct, mg_amount, COALESCE(ag_amount, 0) AS ag_amount, currency
       FROM capability_financial_conditions
      WHERE id = $1`,
    [cfcId]
  );
  if (!r.rows.length) return null;
  return {
    rate_pct: Number(r.rows[0].rate_pct) || 0,
    mg_amount: Number(r.rows[0].mg_amount) || 0,
    ag_amount: Number(r.rows[0].ag_amount) || 0,
    currency: r.rows[0].currency || "JPY",
  };
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
  /**
   * Phase 28: 計算方式。
   *   "manufacturing" (既定) … 製造/印刷契機。gross = 基準価格 × (数量−サンプル) × 料率
   *   "sales" / "sublicense" … 売上報告ベース。gross = 報告金額 (unit_price) × 料率
   *     ※ 報告金額は unit_price 欄を流用 (数量・サンプルは無視)。
   */
  calc_type?: string;
}): Promise<{
  calc_type: string;
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
  // Phase 23: license_financial_conditions は廃止され、capability_financial_conditions
  //   に統合された。preview は capability_financial_condition_id 優先、なければ
  //   後方互換として license_financial_condition_id を capability_financial_conditions.id
  //   として解釈する (Phase 23 マイグレーションで ID が引き継がれている前提)。
  // Phase 22.21.95: ag_amount を SELECT に追加 (列が無い古い DB では COALESCE で 0)。
  const cfcId =
    params.capability_financial_condition_id &&
    params.capability_financial_condition_id > 0
      ? params.capability_financial_condition_id
      : params.license_financial_condition_id;
  const cond = await getRoyaltyConditionEconomics(cfcId);
  if (!cond) {
    throw new Error(
      `capability_financial_condition ${cfcId} not found`
    );
  }
  // Phase 22.21.91 互換: 旧 useCapability フラグ用途は AG 履歴 lookup の
  //   有無に使われていた。license_contract_id が >0 なら履歴あり、capability
  //   ベースの単独 preview なら履歴なし、として扱う。
  const hasLicenseHistory =
    !!params.license_contract_id && params.license_contract_id > 0;
  const ratePct = cond.rate_pct;
  const mgAmount = cond.mg_amount;
  // Phase 22.21.95: AG = DB の ag_amount。フォームから明示的に渡された場合は上書き。
  const agAmount =
    params.ag_amount != null ? Number(params.ag_amount) || 0 : cond.ag_amount;
  const currency = cond.currency;

  // Phase 28: calc_type で「製造/印刷契機 (数量あり)」と「売上報告ベース
  //   (金額 × 料率)」を分ける。manufacturing 以外 (sales / sublicense) は
  //   数量を使わない revenue 型として扱う。
  const calcType = String(params.calc_type || "manufacturing");
  const isRevenue = calcType !== "manufacturing";

  const unitPrice = Number(params.unit_price) || 0;
  // revenue 型では数量・サンプルは計算に使わない (表示も 1 件扱い)。
  const quantity = isRevenue ? 1 : Number(params.quantity) || 0;
  const sampleQty = isRevenue ? 0 : Number(params.sample_quantity) || 0;
  const billableQty = isRevenue ? 1 : Math.max(0, quantity - sampleQty);
  const taxRate = params.tax_rate != null ? Number(params.tax_rate) : 10;

  // Phase 22.21.95: MG は floor 化したので consumed_before 不要 (常に 0)。
  const mgConsumedBefore = 0;
  // AG 累積消化は royalty_calculations.ag_consumed_this_time から SUM。
  //   capability ベースの単独 preview では履歴紐付けが無いので 0。
  // Phase 23: getAgConsumedToDate は capability_id ベースに変更。
  const agConsumedBefore = hasLicenseHistory
    ? await getAgConsumedToDate(
        params.license_contract_id,
        cfcId
      )
    : 0;

  // すべて billing.calculateFee に集約。
  //   manufacturing → performance (base × 数量 × 料率)
  //   sales/sublicense → revenue (報告金額 × 料率)
  const r = isRevenue
    ? calculateFee(
        {
          type: "revenue",
          base_amount: unitPrice,
          rate_pct: ratePct,
        },
        {
          mg_amount: mgAmount,
          mg_consumed_before: mgConsumedBefore,
          ag_amount: agAmount,
          ag_consumed_before: agConsumedBefore,
        },
        taxRate
      )
    : calculateFee(
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
    calc_type: calcType,
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
  // Phase 23: license_financial_conditions → capability_financial_conditions。
  //   引数 licenseContractId は capability_id として解釈する
  //   (Phase 23 マイグレーションで ID が引き継がれている前提)。
  const conds = await query(
    `SELECT id, condition_no, mg_amount
       FROM capability_financial_conditions
      WHERE capability_id = $1
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
