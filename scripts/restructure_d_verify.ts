/**
 * データ構造刷新 Phase D-5 — 旧ロジック vs 新ビューの突合検証。
 *
 * 各 condition_line について、旧来の集計と導出ビューの値を比較し、
 * 既知バグ(D-2: 比率1.0の部分検収を全量扱い)由来以外の差分がゼロであることを確認する。
 *
 * 比較項目:
 *   - 消化額(consumed):  status_v.consumed_amount  vs 旧 detail SUM
 *   - MG 残(mg_remaining): balance_v.mg_remaining   vs (mg_amount - 旧 SUM mg_consumed_this_time)
 *   - fulfilled 判定:      status_v.status='fulfilled' vs 旧 EXISTS(acceptance_ratio>=1.0)
 *
 * 実行: tsx scripts/restructure_d_verify.ts   (読み取りのみ・--apply 不要)
 */

import { pool } from "../services/worker/src/lib/db.js";

async function main() {
  console.log("\n=== Phase D-5: 旧ロジック vs 新ビュー 突合 ===");

  const lines = await pool.query(`
    SELECT cl.id, cl.line_code, cl.payment_scheme, cl.amount_ex_tax, cl.mg_amount,
           cl.source_line_item_id, cl.source_condition_id,
           s.status, s.consumed_amount, s.remaining_amount,
           b.mg_remaining AS v_mg_remaining
      FROM condition_lines cl
      LEFT JOIN condition_line_status_v  s ON s.id = cl.id
      LEFT JOIN condition_line_balance_v b ON b.condition_line_id = cl.id
     ORDER BY cl.id
  `);

  let consumedDiff = 0;
  let mgDiff = 0;
  let fulfilledKnownBug = 0;
  const eq = (a: any, b: any) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;

  for (const cl of lines.rows) {
    // 消化額の旧集計
    let oldConsumed = 0;
    if (cl.source_line_item_id) {
      const r = await pool.query(
        `SELECT COALESCE(SUM(inspected_amount_ex_tax),0) AS c
           FROM delivery_line_items WHERE capability_line_item_id = $1`,
        [cl.source_line_item_id]
      );
      oldConsumed = Number(r.rows[0].c);
    } else if (cl.source_condition_id) {
      const r = await pool.query(
        `SELECT COALESCE(SUM(actual_royalty_ex_tax),0) AS c
           FROM royalty_calculations WHERE capability_financial_condition_id = $1`,
        [cl.source_condition_id]
      );
      oldConsumed = Number(r.rows[0].c);
    }
    if (!eq(oldConsumed, cl.consumed_amount)) {
      consumedDiff++;
      console.log(
        `  [consumed差分] ${cl.line_code} old=${oldConsumed} new=${cl.consumed_amount}`
      );
    }

    // MG 残 (royalty のみ)
    if (cl.payment_scheme === "royalty" && cl.source_condition_id) {
      const r = await pool.query(
        `SELECT COALESCE(SUM(mg_consumed_this_time),0) AS c
           FROM royalty_calculations WHERE capability_financial_condition_id = $1`,
        [cl.source_condition_id]
      );
      const oldMgRemaining = Math.max(0, Number(cl.mg_amount || 0) - Number(r.rows[0].c));
      if (cl.v_mg_remaining != null && !eq(oldMgRemaining, cl.v_mg_remaining)) {
        mgDiff++;
        console.log(
          `  [MG残差分] ${cl.line_code} old=${oldMgRemaining} new=${cl.v_mg_remaining}`
        );
      }
    }

    // fulfilled 判定 (per_unit/lump_sum, 検収由来)
    if (
      cl.source_line_item_id &&
      ["per_unit", "lump_sum", "installment"].includes(cl.payment_scheme)
    ) {
      const r = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM delivery_line_items
            WHERE capability_line_item_id = $1 AND COALESCE(acceptance_ratio,1.0) >= 1.0
         ) AS old_fulfilled`,
        [cl.source_line_item_id]
      );
      const oldFulfilled = Boolean(r.rows[0].old_fulfilled);
      const newFulfilled = cl.status === "fulfilled";
      if (oldFulfilled !== newFulfilled) {
        // 旧=fulfilled / 新≠fulfilled は既知バグ(部分検収を全量扱い)の解消ケース
        fulfilledKnownBug++;
        console.log(
          `  [fulfilled差分(既知バグ解消)] ${cl.line_code} old=${oldFulfilled} new=${cl.status} ` +
            `(消化 ${cl.consumed_amount}/${cl.amount_ex_tax})`
        );
      }
    }
  }

  console.log("\n[結果]");
  console.log(`  consumed 差分: ${consumedDiff} (0 が期待値)`);
  console.log(`  MG残 差分: ${mgDiff} (0 が期待値)`);
  console.log(`  fulfilled 差分: ${fulfilledKnownBug} (= 既知バグ解消件数。中身を確認)`);
  console.log(
    consumedDiff === 0 && mgDiff === 0
      ? "\n✅ 既知バグ由来以外の差分なし。"
      : "\n⚠ 想定外の差分あり。上記を確認。"
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
