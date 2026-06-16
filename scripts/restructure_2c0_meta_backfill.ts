/**
 * データ構造刷新 Phase 2c-0 — 新台帳メタ列の backfill(旧→新)。
 *
 * 0064 で追加した condition_lines / condition_events のメタ列を、source_* 連結で
 * 旧テーブルから移送する。2c-0 時点では旧が source of truth なので、単純コピーで冪等。
 *
 *   condition_lines.{source_ip_id, master_contract_id, ringi_id, status_flags,
 *                    is_inbound, flow_direction}
 *      ← capability_line_items (via cl.source_line_item_id)
 *   condition_events(inspection).{inspected_quantity, acceptance_ratio}
 *      ← delivery_line_items (via ev.source_delivery_line_item_id)
 *   condition_events(royalty_calc).{manufacturing_event_id, mg/ag_consumed_this_time}
 *      ← royalty_calculations (via ev.source_royalty_calculation_id)
 *
 * 実行:
 *   tsx scripts/restructure_2c0_meta_backfill.ts          # 検出のみ(ドライラン)
 *   tsx scripts/restructure_2c0_meta_backfill.ts --apply  # 移送実行
 *
 * 冪等: 旧値の単純コピー(再実行で同値)。挙動不変(これらの列はまだ誰も読まない)。
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Phase 2c-0: メタ列 backfill (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  // 候補件数(source 連結が存在する新台帳行)
  const cnt = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM condition_lines cl
         JOIN capability_line_items cli ON cli.id = cl.source_line_item_id)        AS cl_meta,
      (SELECT COUNT(*) FROM condition_events ev
         JOIN delivery_line_items dli ON dli.id = ev.source_delivery_line_item_id
        WHERE ev.event_type = 'inspection')                                        AS ev_insp,
      (SELECT COUNT(*) FROM condition_events ev
         JOIN royalty_calculations rc ON rc.id = ev.source_royalty_calculation_id
        WHERE ev.event_type = 'royalty_calc')                                      AS ev_roy
  `);
  const c = cnt.rows[0];
  console.log("移送候補(source 連結あり):");
  console.log(`  condition_lines メタ            : ${c.cl_meta}`);
  console.log(`  condition_events 検収詳細        : ${c.ev_insp}`);
  console.log(`  condition_events ロイヤリティ詳細 : ${c.ev_roy}`);

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で移送。");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const r1 = await client.query(`
      UPDATE condition_lines cl
         SET source_ip_id       = cli.source_ip_id,
             master_contract_id = cli.master_contract_id,
             ringi_id           = cli.ringi_id,
             status_flags       = COALESCE(cli.status_flags, '{}'::jsonb),
             is_inbound         = COALESCE(cli.is_inbound, FALSE),
             flow_direction     = cli.flow_direction,
             updated_at         = CURRENT_TIMESTAMP
        FROM capability_line_items cli
       WHERE cl.source_line_item_id = cli.id
    `);

    const r2 = await client.query(`
      UPDATE condition_events ev
         SET inspected_quantity = dli.inspected_quantity,
             acceptance_ratio   = dli.acceptance_ratio
        FROM delivery_line_items dli
       WHERE ev.source_delivery_line_item_id = dli.id
         AND ev.event_type = 'inspection'
    `);

    const r3 = await client.query(`
      UPDATE condition_events ev
         SET manufacturing_event_id = rc.manufacturing_event_id,
             mg_consumed_this_time  = rc.mg_consumed_this_time,
             ag_consumed_this_time  = rc.ag_consumed_this_time
        FROM royalty_calculations rc
       WHERE ev.source_royalty_calculation_id = rc.id
         AND ev.event_type = 'royalty_calc'
    `);

    await client.query("COMMIT");
    console.log("\n--- APPLY ---");
    console.log(`  condition_lines メタ            更新 ${r1.rowCount}`);
    console.log(`  condition_events 検収詳細        更新 ${r2.rowCount}`);
    console.log(`  condition_events ロイヤリティ詳細 更新 ${r3.rowCount}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e);
    process.exitCode = 1;
    client.release();
    await pool.end();
    return;
  }
  client.release();

  // 検証: MG/AG 消化が新(condition_events) = 旧(balance_v が JOIN している royalty_calculations) か。
  const v = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(mg_consumed_this_time),0) FROM condition_events
        WHERE event_type='royalty_calc' AND voided_at IS NULL)         AS ev_mg,
      (SELECT COALESCE(SUM(rc.mg_consumed_this_time),0)
         FROM royalty_calculations rc
         JOIN condition_events ev ON ev.id = rc.condition_event_id
        WHERE ev.voided_at IS NULL)                                    AS rc_mg
  `);
  const x = v.rows[0];
  console.log(
    `\n[検証] MG 消化 新 ${x.ev_mg} = 旧 ${x.rc_mg} : ${Number(x.ev_mg) === Number(x.rc_mg) ? "OK" : "MISMATCH ⚠"}`
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
