/**
 * Order / inspection arithmetic + DB aggregation helpers.
 *
 * Phase 6 で純粋な数式部分は billing.ts に分離した:
 *   calculateOrderLineAmount / calculateInspectedAmount は薄い wrapper
 *   になり, 中で billing.calculateFee を呼ぶ. これにより
 *   発注書↔検収書 と 利用許諾条件書↔利用許諾料計算書 の math が
 *   1 つの実装に集約された.
 *
 * Phase 23: 旧 order_items / order_line_items / delivery_line_items.order_line_item_id を
 *   contract_capabilities (record_type='purchase_order') / capability_line_items /
 *   delivery_line_items.capability_line_item_id に置換。
 *
 * 残っているのはこのモジュール固有の責務:
 *   - calculateTax: 税の切り上げ (billing からも import される)
 *   - recalculateCapabilityTotal: 明細合計 → ヘッダ反映 (DB SQL)
 *   - getInspectionAvailability: 発注 vs 累計検収 (DB SQL)
 *   - previewInspectionOverflow: 検収書確定前の overflow チェック (DB SQL)
 */

import { query } from "./db.ts";
import { calculateFee, grossOf } from "./billing.ts";

// -------------------------------------------------------------------
// Pure helpers (no DB)
// -------------------------------------------------------------------

/**
 * 税抜 → 消費税額 / 税込 をサーバ側で再計算する。
 * 法務確認済の端数処理は「切り上げ」。
 */
export function calculateTax(
  amountExTax: number,
  taxRate: number
): { taxAmount: number; amountIncTax: number } {
  const rate = Number(taxRate) || 0;
  const ex = Number(amountExTax) || 0;
  const taxAmount = Math.ceil(ex * (rate / 100));
  return { taxAmount, amountIncTax: ex + taxAmount };
}

/**
 * フォームから来た税抜/税込/税率が辻褄合うか検算する。差分が ±1円
 * 以内なら端数調整とみなして OK 扱い。それ以上ズレていれば warning。
 */
export function validateTaxConsistency(
  amountExTax: number,
  taxRate: number,
  taxAmount: number,
  amountIncTax: number
): {
  taxMatches: boolean;
  totalMatches: boolean;
  expected: { taxAmount: number; amountIncTax: number };
} {
  const expected = calculateTax(amountExTax, taxRate);
  return {
    taxMatches: Math.abs(expected.taxAmount - Number(taxAmount || 0)) <= 1,
    totalMatches: Math.abs(expected.amountIncTax - Number(amountIncTax || 0)) <= 1,
    expected,
  };
}

/**
 * PO の 1 明細あたりの税抜小計を計算する。
 *   amount_ex_tax = ceil(unit_price × quantity)
 *
 * Phase 6 で billing.calculateFee に委譲。
 * (歴史的には Math.round だったが Math.ceil に統一. 最大 1 円ズレるが
 *  Legal 合意済.)
 */
export function calculateOrderLineAmount(
  unitPrice: number,
  quantity: number
): number {
  return grossOf({ type: "fixed", unit_price: unitPrice, quantity });
}

/**
 * 検収明細 1 行の税抜額を計算する。
 *   inspected_amount = ceil(unit_price × inspected_quantity × acceptance_ratio)
 *
 * acceptance_ratio が指定されない場合は 1.0 (全量検収) として扱う。
 * 内部実装は billing.calculateFee に委譲。
 */
export function calculateInspectedAmount(
  unitPrice: number,
  inspectedQuantity: number,
  acceptanceRatio: number = 1.0
): number {
  const result = calculateFee(
    { type: "fixed", unit_price: unitPrice, quantity: inspectedQuantity },
    { acceptance_ratio: acceptanceRatio },
    0 // tax は別計算なのでここでは 0
  );
  return result.after_acceptance;
}

// -------------------------------------------------------------------
// DB-touching helpers
// -------------------------------------------------------------------

/**
 * capability_line_items の合計を再集計し、contract_capabilities ヘッダの
 * amount_ex_tax / tax_rate / tax_amount / amount_inc_tax / amount
 * を整合的に書き戻す。Phase 4b 以降、明細を追加・更新するたびに
 * 呼び出すことで「明細合計 ≠ 総額」の不整合を構造的に防ぐ。
 *
 * Phase 23: order_items / order_line_items → contract_capabilities /
 *   capability_line_items に置換 (record_type='purchase_order')。
 *
 * @param capabilityId contract_capabilities.id
 * @param taxRateOverride 明示的に税率を渡したい場合 (フォーム送信時等)。
 *                        省略すると contract_capabilities の既存税率、それも
 *                        無ければ 10 がデフォルト。
 */
export async function recalculateCapabilityTotal(
  capabilityId: number,
  taxRateOverride?: number
): Promise<{
  amount_ex_tax: number;
  tax_rate: number;
  tax_amount: number;
  amount_inc_tax: number;
}> {
  const sumRes = await query(
    `SELECT COALESCE(SUM(amount_ex_tax), 0) AS total
       FROM capability_line_items
      WHERE capability_id = $1`,
    [capabilityId]
  );
  const amountExTax = Number(sumRes.rows[0].total) || 0;

  let taxRate = taxRateOverride;
  if (taxRate === undefined || taxRate === null) {
    const headerRes = await query(
      `SELECT tax_rate FROM contract_capabilities WHERE id = $1
         AND record_type = 'purchase_order'`,
      [capabilityId]
    );
    taxRate = Number(headerRes.rows[0]?.tax_rate) || 10;
  }

  const { taxAmount, amountIncTax } = calculateTax(amountExTax, taxRate);

  await query(
    `UPDATE contract_capabilities
        SET amount_ex_tax = $1,
            tax_rate      = $2,
            tax_amount    = $3,
            amount_inc_tax = $4,
            amount        = $1,
            latest_amount = $1
      WHERE id = $5
        AND record_type = 'purchase_order'`,
    [amountExTax, taxRate, taxAmount, amountIncTax, capabilityId]
  );

  return {
    amount_ex_tax: amountExTax,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    amount_inc_tax: amountIncTax,
  };
}

/**
 * ある PO 明細 (capability_line_item) について、発注額 vs これまでの検収累計を
 * 突き合わせ、残検収可能量・残検収可能額・overflow フラグを返す。
 *
 * 検収書生成エンドポイント (Phase 4b) はこの結果を見て:
 *   - overflow_amount / overflow_quantity が true → HTTP 400 で拒否
 *   - そうでなければ delivery_line_items に書き込み
 * という挙動を取る。
 *
 * Phase 23: order_line_items → capability_line_items,
 *   delivery_line_items.order_line_item_id → capability_line_item_id に置換。
 */
/**
 * Phase E-2 (dual-read): 発注側の「金額・数量・単価」を condition_lines 優先で読む。
 *   - 移行済み(condition_lines に source_line_item_id 一致行あり) → そちらを正とする
 *   - 未移行 / condition_lines 未作成環境 → capability_line_items にフォールバック
 *   どちらも同値(C-2/C-5 で同名コピー)なので挙動は不変。旧テーブルへの硬い依存を
 *   ソフト依存(フォールバック)に落とし、将来の旧テーブル DROP に備える。
 */
async function getOrderedLineEconomics(
  capabilityLineItemId: number
): Promise<{ amount_ex_tax: number; quantity: number; unit_price: number } | null> {
  try {
    const cl = await query(
      `SELECT amount_ex_tax, quantity, unit_price
         FROM condition_lines
        WHERE source_line_item_id = $1
        LIMIT 1`,
      [capabilityLineItemId]
    );
    if (cl.rows.length) {
      return {
        amount_ex_tax: Number(cl.rows[0].amount_ex_tax) || 0,
        quantity: Number(cl.rows[0].quantity) || 0,
        unit_price: Number(cl.rows[0].unit_price) || 0,
      };
    }
  } catch (err: any) {
    // condition_lines 未作成 (42P01) 等 → 旧テーブルにフォールバック
    if (!err || (err.code !== "42P01" && err.code !== "42703")) throw err;
  }
  const li = await query(
    `SELECT amount_ex_tax, quantity, unit_price FROM capability_line_items WHERE id = $1`,
    [capabilityLineItemId]
  );
  if (!li.rows.length) return null;
  return {
    amount_ex_tax: Number(li.rows[0].amount_ex_tax) || 0,
    quantity: Number(li.rows[0].quantity) || 0,
    unit_price: Number(li.rows[0].unit_price) || 0,
  };
}

export async function getInspectionAvailability(
  capabilityLineItemId: number
): Promise<{
  ordered_amount: number;
  ordered_quantity: number;
  inspected_amount: number;
  inspected_quantity: number;
  remaining_amount: number;
  remaining_quantity: number;
  overflow_amount: boolean;
  overflow_quantity: boolean;
}> {
  const ordered = await getOrderedLineEconomics(capabilityLineItemId);
  if (!ordered) {
    throw new Error(`capability_line_item ${capabilityLineItemId} not found`);
  }
  const orderedAmount = ordered.amount_ex_tax;
  const orderedQuantity = ordered.quantity;

  const inspectedRes = await query(
    `SELECT COALESCE(SUM(inspected_amount_ex_tax), 0) AS amt,
            COALESCE(SUM(inspected_quantity),       0) AS qty
       FROM delivery_line_items
      WHERE capability_line_item_id = $1`,
    [capabilityLineItemId]
  );
  const inspectedAmount = Number(inspectedRes.rows[0].amt) || 0;
  const inspectedQuantity = Number(inspectedRes.rows[0].qty) || 0;

  return {
    ordered_amount: orderedAmount,
    ordered_quantity: orderedQuantity,
    inspected_amount: inspectedAmount,
    inspected_quantity: inspectedQuantity,
    remaining_amount: orderedAmount - inspectedAmount,
    remaining_quantity: orderedQuantity - inspectedQuantity,
    overflow_amount: inspectedAmount > orderedAmount,
    overflow_quantity: inspectedQuantity > orderedQuantity,
  };
}

/**
 * 検収書全体としての overflow チェック。
 * proposed[] に「これから書き込もうとしている明細」を入れて呼ぶと、
 * 既存 delivery_line_items にこの追加分を仮計上した状態での
 * availability を返す。事前バリデーションに使う。
 *
 * Phase 23: 引数キー order_line_item_id → capability_line_item_id。
 */
export async function previewInspectionOverflow(
  proposed: Array<{
    capability_line_item_id: number;
    inspected_quantity: number;
    acceptance_ratio: number;
  }>
): Promise<
  Array<{
    capability_line_item_id: number;
    availability: Awaited<ReturnType<typeof getInspectionAvailability>>;
    proposed_quantity: number;
    proposed_amount: number;
    will_overflow_amount: boolean;
    will_overflow_quantity: boolean;
  }>
> {
  const out: Array<any> = [];
  for (const p of proposed) {
    const econ = await getOrderedLineEconomics(p.capability_line_item_id);
    const unitPrice = econ?.unit_price || 0;
    const proposedAmount = calculateInspectedAmount(
      unitPrice,
      p.inspected_quantity,
      p.acceptance_ratio
    );
    const availability = await getInspectionAvailability(p.capability_line_item_id);

    out.push({
      capability_line_item_id: p.capability_line_item_id,
      availability,
      proposed_quantity: Number(p.inspected_quantity) || 0,
      proposed_amount: proposedAmount,
      will_overflow_amount:
        availability.inspected_amount + proposedAmount > availability.ordered_amount,
      will_overflow_quantity:
        availability.inspected_quantity + (Number(p.inspected_quantity) || 0) >
        availability.ordered_quantity,
    });
  }
  return out;
}
