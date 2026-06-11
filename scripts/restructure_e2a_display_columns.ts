/**
 * データ構造刷新 Phase E-2(a) — condition_lines 表示列の再 backfill。
 *
 * Phase E-2(a) で condition_lines に追加した表示用フィールド
 * (spec/category/calc_method/payment_method/payment_terms/payment_date/
 *  calc_period/formula_text) を、既存の移行済み行に対して旧明細テーブルから充填する。
 * これにより表示/フォーム供給リーダーが将来 condition_lines だけで完結できる
 * (= 旧テーブル DROP の前提)。
 *
 * 実行:
 *   tsx scripts/restructure_e2a_display_columns.ts          # dry-run(件数のみ)
 *   tsx scripts/restructure_e2a_display_columns.ts --apply   # 実 UPDATE
 *
 * 冪等: source(capability_line_items / capability_financial_conditions) から
 *   毎回同じ値を書くため再実行安全。fee_type は capability_line_items に列が
 *   無い環境があるため対象外(C-5/マッパーが設定した値を尊重)。
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Phase E-2(a): 表示列 再backfill (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  const liTargets = (
    await pool.query(
      `SELECT COUNT(*)::int c FROM condition_lines WHERE source_line_item_id IS NOT NULL`
    )
  ).rows[0].c;
  const fcTargets = (
    await pool.query(
      `SELECT COUNT(*)::int c FROM condition_lines WHERE source_condition_id IS NOT NULL`
    )
  ).rows[0].c;
  console.log(`  line_item 由来 condition_lines: ${liTargets}`);
  console.log(`  financial 由来 condition_lines: ${fcTargets}`);

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で実 UPDATE。");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r1 = await client.query(`
      UPDATE condition_lines cl SET
        spec           = li.spec,
        category       = li.category,
        calc_method    = li.calc_method,
        payment_method = li.payment_method,
        payment_terms  = li.payment_terms,
        payment_date   = li.payment_date
      FROM capability_line_items li
      WHERE cl.source_line_item_id = li.id
    `);
    const r2 = await client.query(`
      UPDATE condition_lines cl SET
        calc_method   = fc.calc_method,
        payment_terms = fc.payment_terms,
        calc_period   = fc.calc_period,
        formula_text  = fc.formula_text
      FROM capability_financial_conditions fc
      WHERE cl.source_condition_id = fc.id
    `);
    await client.query("COMMIT");
    console.log(`  line_item 由来 更新: ${r1.rowCount}`);
    console.log(`  financial 由来 更新: ${r2.rowCount}`);
    console.log("\n✅ COMMIT 完了。");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  // 検証: 充填漏れ(NULL のまま)の確認
  const missing = (
    await pool.query(`
      SELECT COUNT(*)::int c FROM condition_lines
       WHERE source_line_item_id IS NOT NULL AND spec IS NULL
         AND EXISTS (SELECT 1 FROM capability_line_items li
                      WHERE li.id = condition_lines.source_line_item_id AND li.spec IS NOT NULL)
    `)
  ).rows[0].c;
  console.log(`\n[検証] spec 充填漏れ(source に値あるのに NULL): ${missing}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
