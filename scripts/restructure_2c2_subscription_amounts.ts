/**
 * データ構造刷新 Phase 2c-2 — subscription 行の 数量/単価/金額 backfill。
 *
 * 2c-2 で mapper を「subscription も 数量/単価/金額 を保存」に変更したが、既存の
 * subscription condition_lines は 2c-0/2c-1 までの仕様で NULL のまま。横断検索の
 * 移行(2c-2b)で raw 表示を忠実にするため、既存分を旧 capability_line_items から移送する。
 *
 * 実行:
 *   tsx scripts/restructure_2c2_subscription_amounts.ts          # 検出
 *   tsx scripts/restructure_2c2_subscription_amounts.ts --apply  # 移送
 *
 * 冪等: 旧値の単純コピー(差分のある行のみ更新)。新規 subscription 行は mapper が
 *   既に正しく書くので、対象は移行前に作られた既存行のみ。
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Phase 2c-2: subscription 数量/単価/金額 backfill (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  const cnt = await pool.query(`
    SELECT COUNT(*)::int AS n
      FROM condition_lines cl
      JOIN capability_line_items cli ON cli.id = cl.source_line_item_id
     WHERE cl.payment_scheme = 'subscription'
       AND (cl.quantity      IS DISTINCT FROM cli.quantity
         OR cl.unit_price    IS DISTINCT FROM cli.unit_price
         OR cl.amount_ex_tax IS DISTINCT FROM COALESCE(cli.amount_ex_tax, 0))
  `);
  console.log(`移送候補(subscription で 数量/単価/金額 が旧と差分): ${cnt.rows[0].n}`);

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で移送。");
    await pool.end();
    return;
  }

  const r = await pool.query(`
    UPDATE condition_lines cl
       SET quantity      = cli.quantity,
           unit_price    = cli.unit_price,
           amount_ex_tax = COALESCE(cli.amount_ex_tax, 0),
           updated_at    = CURRENT_TIMESTAMP
      FROM capability_line_items cli
     WHERE cl.source_line_item_id = cli.id
       AND cl.payment_scheme = 'subscription'
       AND (cl.quantity      IS DISTINCT FROM cli.quantity
         OR cl.unit_price    IS DISTINCT FROM cli.unit_price
         OR cl.amount_ex_tax IS DISTINCT FROM COALESCE(cli.amount_ex_tax, 0))
  `);
  console.log(`\n--- APPLY ---\n  subscription 行 更新 ${r.rowCount}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
