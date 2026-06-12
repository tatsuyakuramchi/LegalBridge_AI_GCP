/**
 * データ構造刷新 — 破壊的フェーズ(E-2 / G-2〜G-6)の移行レディネス監査 (読み取り専用)。
 *
 * 計画書が要求する「参照ゼロ / データ整合を確認してから DROP」のゲートを自動判定する。
 * 本スクリプトは一切書き込まない。本番(バックフィル済み)DB に対して実行し、
 * 各破壊的ステップの GO / NO-GO を出す。
 *
 * 実行: DATABASE_URL=... tsx scripts/restructure_readiness_audit.ts
 *
 * NO-GO の主因:
 *   - 旧明細/実績に対応する condition_lines / condition_events が未生成 (バックフィル未完)。
 *   - balance_v が依然 royalty_calculations.mg_consumed_this_time に依存 (G-2 ブロッカー)。
 *   - 旧テーブル/旧列を参照するコードが残存 (下記 grep をゼロにしてから DROP)。
 */

import { pool } from "../services/worker/src/lib/db.js";

const q = async (sql: string): Promise<number> => {
  try {
    const r = await pool.query(sql);
    return Number(r.rows[0].c);
  } catch {
    return -1; // テーブル/列が無い等
  }
};

function verdict(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? "🟢 GO  " : "🔴 NO-GO"} ${label}${detail ? "  — " + detail : ""}`);
  return ok;
}

async function main() {
  console.log("\n=== 移行レディネス監査 (read-only) ===");

  // ---- 1. データ整合 (E-2 / G-4: 旧明細→新明細の網羅) -----------------------
  const li = await q(`SELECT COUNT(*)::int c FROM capability_line_items`);
  const liMigrated = await q(
    `SELECT COUNT(*)::int c FROM capability_line_items x
      WHERE EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = x.id)`
  );
  const fc = await q(`SELECT COUNT(*)::int c FROM capability_financial_conditions`);
  const fcMigrated = await q(
    `SELECT COUNT(*)::int c FROM capability_financial_conditions x
      WHERE EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_condition_id = x.id)`
  );
  const dli = await q(`SELECT COUNT(*)::int c FROM delivery_line_items`);
  const dliMigrated = await q(
    `SELECT COUNT(*)::int c FROM delivery_line_items x
      WHERE EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id = x.id)`
  );
  const rc = await q(`SELECT COUNT(*)::int c FROM royalty_calculations`);
  const rcMigrated = await q(
    `SELECT COUNT(*)::int c FROM royalty_calculations x
      WHERE EXISTS (SELECT 1 FROM condition_events e WHERE e.source_royalty_calculation_id = x.id)`
  );

  console.log("\n[1] データ整合 (旧 → 新の網羅)");
  console.log(`  capability_line_items           ${liMigrated}/${li}`);
  console.log(`  capability_financial_conditions ${fcMigrated}/${fc}`);
  console.log(`  delivery_line_items             ${dliMigrated}/${dli}`);
  console.log(`  royalty_calculations            ${rcMigrated}/${rc}`);
  const dataParity =
    li === liMigrated && fc === fcMigrated && dli === dliMigrated && rc === rcMigrated;

  console.log("\n[判定] 破壊的ステップ");
  // E-2: 旧テーブルへの書き込み停止 / G-4: 旧明細テーブル DROP
  verdict(
    dataParity,
    "E-2 / G-4 (旧明細テーブルの凍結・DROP)",
    dataParity ? "全旧行に対応する新行あり" : "未移行の旧行あり → 先に C-2/C-3 を完走"
  );

  // ---- 2. balance_v の依存 (G-2: mg_consumed_* 列 DROP) ----------------------
  // balance_v が detail(mg_consumed_this_time)に依存している間は DROP 不可。
  const balDef = await pool
    .query(`SELECT pg_get_viewdef('condition_line_balance_v'::regclass) AS d`)
    .then((r) => String(r.rows[0]?.d || ""))
    .catch(() => "");
  const balDependsDetail = /mg_consumed_this_time|ag_consumed_this_time/.test(balDef);
  verdict(
    !balDependsDetail,
    "G-2 (royalty_calculations.mg/ag_consumed_* 列 DROP)",
    balDependsDetail
      ? "condition_line_balance_v が mg/ag_consumed_this_time に依存 → 先にイベント金額からの再計算へ切替"
      : "balance はイベント駆動"
  );

  // ---- 3. 旧 FK 残骸のデータ (G-6) ------------------------------------------
  const deOrderItem = await q(
    `SELECT COUNT(*)::int c FROM delivery_events WHERE order_item_id IS NOT NULL`
  );
  console.log("\n[3] 旧 FK 残骸 (G-6)");
  console.log(`  delivery_events.order_item_id 非NULL: ${deOrderItem < 0 ? "(列なし)" : deOrderItem}`);

  // ---- 4. コード参照リマインダ (手動でゼロにする) ---------------------------
  console.log("\n[4] DROP 前にゼロにすべきコード参照 (リポジトリ root で実行):");
  console.log("  grep -rn 'capability_line_items'            services/ src/   # E-2/G-4");
  console.log("  grep -rn 'capability_financial_conditions'  services/ src/   # E-2/G-4");
  console.log("  grep -rn 'mg_consumed_this_time\\|ag_consumed_this_time' services/  # G-2");
  console.log("  grep -rn 'contract_category\\|_allowed'      services/ src/   # G-3");
  console.log("  grep -rn 'delivery_events.*order_item_id\\|license_contract_id' services/  # G-6");
  console.log("  grep -rn \"form_data->>'delivery_event_id'\"  services/        # G-5");

  console.log(
    "\n結論: 全 GO かつ上記 grep が(該当の DROP 対象について)ゼロのときのみ、" +
      "対応する破壊的ステップを実施可。NO-GO が一つでもあれば DROP は中止。"
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
