/**
 * データ構造刷新 Phase 2a — 旧→新 同期の整合レコンサイル(継続運用ツール)。
 *
 * 目的:
 *   ランタイムの二重書き込み(safeSync)は「失敗しても保存本体を止めない」非致命設計
 *   のため、稀に condition_lines / condition_events が旧テーブルから取り残れる
 *   (ドリフト)。本スクリプトはそのドリフトを「可視化」し、必要なら冪等同期で
 *   「自動修復」する。既出の新台帳リード(コックピット/検収待ち)が静かにズレない
 *   保証になる。
 *
 * 実行:
 *   tsx scripts/condition_sync_reconcile.ts            # 検出のみ(ドライラン)
 *   tsx scripts/condition_sync_reconcile.ts --repair   # 未同期を冪等同期で修復
 *
 * 終了コード:
 *   ドリフトが残っていれば 1 (スケジューラ/CI のアラート用)。クリーンなら 0。
 *
 * 冪等: 検出も修復も source_* / event の存在チェックで二重挿入しない。
 * 依存: services/worker/src/lib/conditionSync.ts の同期関数(ランタイムと完全共用)。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pool } from "../services/worker/src/lib/db.js";
import {
  syncConditionLinesForCapability,
  syncInspectionEventsForDelivery,
  syncRoyaltyCalcEvent,
} from "../services/worker/src/lib/conditionSync.js";

const REPAIR = process.argv.includes("--repair");
const REPORT_DIR = path.resolve(process.cwd(), "restructure_reports");

function writeCsv(name: string, header: string[], rows: any[][]) {
  if (!rows.length) return;
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(
    path.join(REPORT_DIR, name),
    [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n"
  );
  console.log(`      report → ${path.join(REPORT_DIR, name)} (${rows.length} rows)`);
}

// 1 件ずつ独立トランザクションで修復(1件の失敗が全体を巻き込まない)。
async function repairEntity(
  label: string,
  fn: (db: { query: any }) => Promise<number>
): Promise<{ added: number; ok: boolean; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const added = await fn(client);
    await client.query("COMMIT");
    return { added, ok: true };
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return { added: 0, ok: false, error: e?.message || String(e) };
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`\n=== Phase 2a: 同期レコンサイル (${REPAIR ? "REPAIR" : "DRY-RUN"}) ===\n`);

  // ---- 検出 ---------------------------------------------------------------
  // G1: capability_line_items に対応する condition_lines が無い
  const g1 = await pool.query(`
    SELECT cli.capability_id, COUNT(*)::int AS n
      FROM capability_line_items cli
     WHERE NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = cli.id)
     GROUP BY cli.capability_id
     ORDER BY cli.capability_id
  `);
  // G2: capability_financial_conditions に対応する condition_lines が無い
  const g2 = await pool.query(`
    SELECT fc.capability_id, COUNT(*)::int AS n
      FROM capability_financial_conditions fc
     WHERE NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_condition_id = fc.id)
     GROUP BY fc.capability_id
     ORDER BY fc.capability_id
  `);
  // G3: delivery_line_items に対応する condition_events(inspection) が無い。
  //   has_line/has_doc が揃って初めて同期可能(揃わない分は「保留」=正常)。
  const g3 = await pool.query(`
    SELECT dli.id, dli.delivery_event_id,
           (cl.id IS NOT NULL) AS has_line,
           EXISTS (
             SELECT 1 FROM documents d
              WHERE d.template_type IN ('inspection_certificate','delivery_inspec')
                AND d.form_data->>'delivery_event_id' = dli.delivery_event_id::text
                AND COALESCE(d.lifecycle_status,'final') = 'final'
           ) AS has_doc
      FROM delivery_line_items dli
      LEFT JOIN condition_lines cl ON cl.source_line_item_id = dli.capability_line_item_id
     WHERE NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id = dli.id)
     ORDER BY dli.delivery_event_id, dli.id
  `);
  // G4: royalty_calculations に対応する condition_events(royalty_calc) が無い
  const g4 = await pool.query(`
    SELECT rc.id,
           (cl.id IS NOT NULL) AS has_line
      FROM royalty_calculations rc
      LEFT JOIN condition_lines cl ON cl.source_condition_id = rc.capability_financial_condition_id
     WHERE NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_royalty_calculation_id = rc.id)
     ORDER BY rc.id
  `);

  const g1Caps = g1.rows.map((r) => Number(r.capability_id));
  const g2Caps = g2.rows.map((r) => Number(r.capability_id));
  const capsToSync = [...new Set([...g1Caps, ...g2Caps])];
  const g3Syncable = g3.rows.filter((r) => r.has_line && r.has_doc);
  const g3Held = g3.rows.filter((r) => !(r.has_line && r.has_doc));
  const g4Syncable = g4.rows.filter((r) => r.has_line);
  const g4Held = g4.rows.filter((r) => !r.has_line);

  const g1Total = g1.rows.reduce((s, r) => s + Number(r.n), 0);
  const g2Total = g2.rows.reduce((s, r) => s + Number(r.n), 0);

  console.log("検出されたドリフト(旧テーブルに対し新台帳が未同期):");
  console.log(`  G1 line_items → condition_lines 未同期 : ${g1Total} 行 (契約 ${g1Caps.length})`);
  console.log(`  G2 financial  → condition_lines 未同期 : ${g2Total} 行 (契約 ${g2Caps.length})`);
  console.log(
    `  G3 検収       → condition_events 未同期 : ${g3.rows.length} 行 ` +
      `(同期可能 ${g3Syncable.length} / 保留 ${g3Held.length})`
  );
  console.log(
    `  G4 ロイヤリティ → condition_events 未同期 : ${g4.rows.length} 行 ` +
      `(同期可能 ${g4Syncable.length} / 保留 ${g4Held.length})`
  );
  console.log(
    "  ※ 保留 = condition_line 未解決 または 対の最終文書が未作成。" +
      "イベントは文書とペア必須(CHECK)のため、これは正常な未同期。"
  );

  // G5(2c-1): メタ列ドリフト(新台帳の値が旧 source と食い違う)。同期は保存ごとに
  //   追従するが、status_flags 更新等 sync を通らない経路の取りこぼしをここで検出・修復。
  const g5 = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM condition_lines cl
         JOIN capability_line_items cli ON cli.id = cl.source_line_item_id
        WHERE cl.source_ip_id       IS DISTINCT FROM cli.source_ip_id
           OR cl.master_contract_id IS DISTINCT FROM cli.master_contract_id
           OR cl.ringi_id           IS DISTINCT FROM cli.ringi_id
           OR cl.status_flags       IS DISTINCT FROM COALESCE(cli.status_flags,'{}'::jsonb)
           OR cl.is_inbound         IS DISTINCT FROM COALESCE(cli.is_inbound,FALSE)
           OR cl.flow_direction     IS DISTINCT FROM cli.flow_direction)            AS cl_meta,
      (SELECT COUNT(*) FROM condition_events ev
         JOIN delivery_line_items dli ON dli.id = ev.source_delivery_line_item_id
        WHERE ev.event_type='inspection'
          AND (ev.inspected_quantity IS DISTINCT FROM dli.inspected_quantity
            OR ev.acceptance_ratio   IS DISTINCT FROM dli.acceptance_ratio))        AS ev_insp,
      (SELECT COUNT(*) FROM condition_events ev
         JOIN royalty_calculations rc ON rc.id = ev.source_royalty_calculation_id
        WHERE ev.event_type='royalty_calc'
          AND (ev.manufacturing_event_id IS DISTINCT FROM rc.manufacturing_event_id
            OR ev.mg_consumed_this_time  IS DISTINCT FROM rc.mg_consumed_this_time
            OR ev.ag_consumed_this_time  IS DISTINCT FROM rc.ag_consumed_this_time)) AS ev_roy
  `);
  const g5cl = Number(g5.rows[0].cl_meta);
  const g5ei = Number(g5.rows[0].ev_insp);
  const g5er = Number(g5.rows[0].ev_roy);
  const g5Total = g5cl + g5ei + g5er;
  console.log(
    `  G5 メタ列ドリフト              : ${g5Total} 行 ` +
      `(condition_lines ${g5cl} / 検収 ${g5ei} / ロイヤリティ ${g5er})`
  );

  // 金額整合(同期済み分の旧集計 = 新集計か)
  const amt = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(inspected_amount_ex_tax),0) FROM delivery_line_items
        WHERE condition_event_id IS NOT NULL) AS dli_amt,
      (SELECT COALESCE(SUM(amount_ex_tax),0) FROM condition_events
        WHERE event_type='inspection' AND voided_at IS NULL) AS ev_amt
  `);
  const a = amt.rows[0];
  const amtOk = Number(a.dli_amt) === Number(a.ev_amt);
  console.log(
    `\n金額整合(検収): 旧 ${a.dli_amt} = 新 ${a.ev_amt} : ${amtOk ? "OK" : "MISMATCH ⚠"}`
  );

  // レポート(あれば)
  writeCsv("reconcile_g3_held.csv", ["delivery_line_item_id", "delivery_event_id", "has_line", "has_doc"],
    g3Held.map((r) => [r.id, r.delivery_event_id, r.has_line, r.has_doc]));
  writeCsv("reconcile_g4_held.csv", ["royalty_calculation_id", "has_line"],
    g4Held.map((r) => [r.id, r.has_line]));

  const syncableDrift = capsToSync.length + g3Syncable.length + g4Syncable.length + g5Total;

  if (!REPAIR) {
    console.log(
      `\n同期可能なドリフト: ${syncableDrift} (契約 ${capsToSync.length} / 検収 ${g3Syncable.length} / ロイヤリティ ${g4Syncable.length} / メタ ${g5Total})`
    );
    console.log(syncableDrift > 0 ? "→ --repair で冪等同期できます。" : "→ クリーン(同期可能なドリフトなし)。");
    await pool.end();
    process.exitCode = syncableDrift > 0 || !amtOk ? 1 : 0;
    return;
  }

  // ---- 修復 ---------------------------------------------------------------
  console.log("\n--- REPAIR ---");
  let capAdded = 0, insAdded = 0, royAdded = 0;
  const failures: any[][] = [];

  for (const capId of capsToSync) {
    const r = await repairEntity(`CL(cap ${capId})`, (db) => syncConditionLinesForCapability(db, capId));
    if (r.ok) capAdded += r.added;
    else failures.push(["capability", capId, r.error]);
  }
  const deliveryIds = [...new Set(g3Syncable.map((r) => Number(r.delivery_event_id)))];
  for (const deId of deliveryIds) {
    const r = await repairEntity(`inspection(de ${deId})`, (db) => syncInspectionEventsForDelivery(db, deId));
    if (r.ok) insAdded += r.added;
    else failures.push(["delivery_event", deId, r.error]);
  }
  for (const row of g4Syncable) {
    const rcId = Number(row.id);
    const r = await repairEntity(`royalty(rc ${rcId})`, (db) => syncRoyaltyCalcEvent(db, rcId));
    if (r.ok) royAdded += r.added;
    else failures.push(["royalty_calculation", rcId, r.error]);
  }

  // G5: メタ列の取りこぼしを旧から再コピー(2c-0 backfill と同じ・冪等)。
  const m1 = await repairEntity("meta(condition_lines)", async (db) => {
    const r = await db.query(`
      UPDATE condition_lines cl
         SET source_ip_id = cli.source_ip_id, master_contract_id = cli.master_contract_id,
             ringi_id = cli.ringi_id, status_flags = COALESCE(cli.status_flags,'{}'::jsonb),
             is_inbound = COALESCE(cli.is_inbound,FALSE), flow_direction = cli.flow_direction,
             updated_at = CURRENT_TIMESTAMP
        FROM capability_line_items cli
       WHERE cl.source_line_item_id = cli.id
         AND (cl.source_ip_id IS DISTINCT FROM cli.source_ip_id
           OR cl.master_contract_id IS DISTINCT FROM cli.master_contract_id
           OR cl.ringi_id IS DISTINCT FROM cli.ringi_id
           OR cl.status_flags IS DISTINCT FROM COALESCE(cli.status_flags,'{}'::jsonb)
           OR cl.is_inbound IS DISTINCT FROM COALESCE(cli.is_inbound,FALSE)
           OR cl.flow_direction IS DISTINCT FROM cli.flow_direction)`);
    return r.rowCount || 0;
  });
  const m2 = await repairEntity("meta(inspection)", async (db) => {
    const r = await db.query(`
      UPDATE condition_events ev
         SET inspected_quantity = dli.inspected_quantity, acceptance_ratio = dli.acceptance_ratio
        FROM delivery_line_items dli
       WHERE ev.source_delivery_line_item_id = dli.id AND ev.event_type='inspection'
         AND (ev.inspected_quantity IS DISTINCT FROM dli.inspected_quantity
           OR ev.acceptance_ratio IS DISTINCT FROM dli.acceptance_ratio)`);
    return r.rowCount || 0;
  });
  const m3 = await repairEntity("meta(royalty)", async (db) => {
    const r = await db.query(`
      UPDATE condition_events ev
         SET manufacturing_event_id = rc.manufacturing_event_id,
             mg_consumed_this_time = rc.mg_consumed_this_time,
             ag_consumed_this_time = rc.ag_consumed_this_time
        FROM royalty_calculations rc
       WHERE ev.source_royalty_calculation_id = rc.id AND ev.event_type='royalty_calc'
         AND (ev.manufacturing_event_id IS DISTINCT FROM rc.manufacturing_event_id
           OR ev.mg_consumed_this_time IS DISTINCT FROM rc.mg_consumed_this_time
           OR ev.ag_consumed_this_time IS DISTINCT FROM rc.ag_consumed_this_time)`);
    return r.rowCount || 0;
  });
  const metaFixed = m1.added + m2.added + m3.added;
  for (const m of [m1, m2, m3]) if (!m.ok) failures.push(["meta", 0, m.error]);

  console.log(`  condition_lines  +${capAdded}`);
  console.log(`  inspection events +${insAdded}`);
  console.log(`  royalty events    +${royAdded}`);
  console.log(`  メタ列 修復        ${metaFixed}`);
  if (failures.length) {
    console.log(`  失敗 ${failures.length} 件:`);
    writeCsv("reconcile_repair_failures.csv", ["kind", "id", "error"], failures);
  }

  await pool.end();
  process.exitCode = failures.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
