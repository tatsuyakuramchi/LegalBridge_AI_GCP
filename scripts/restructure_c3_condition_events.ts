/**
 * データ構造刷新 Phase C-3 — 旧実績 → 統一実績台帳(condition_events) バックフィル。
 *
 *   delivery_line_items   → condition_events(event_type='inspection')
 *   royalty_calculations  → condition_events(event_type='royalty_calc')
 *
 * 「有効実績1件 = final文書1件」の不変条件 (ce_document_pairing CHECK) を満たすため、
 * document_id を解決できない実績は INSERT を保留し CSV レポートに出す (⚠ Q4)。
 *
 * 実行:
 *   tsx scripts/restructure_c3_condition_events.ts          # ドライラン
 *   tsx scripts/restructure_c3_condition_events.ts --apply  # 実書き込み
 *
 * 冪等: source_delivery_line_item_id / source_royalty_calculation_id で除外。
 * 依存: Phase C-2 (condition_lines に source_* が揃っていること)。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");
const REPORT_DIR = path.resolve(process.cwd(), "restructure_reports");

function writeCsv(name: string, header: string[], rows: any[][]) {
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

async function nextEventNo(client: any, lineId: number): Promise<number> {
  const r = await client.query(
    `SELECT COALESCE(MAX(event_no),0) AS m FROM condition_events WHERE condition_line_id = $1`,
    [lineId]
  );
  return Number(r.rows[0].m) + 1;
}

async function main() {
  console.log(`\n=== Phase C-3: 実績バックフィル (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  const dliPending = await pool.query(`
    SELECT COUNT(*)::int c FROM delivery_line_items dli
     WHERE NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id = dli.id)
  `);
  const rcPending = await pool.query(`
    SELECT COUNT(*)::int c FROM royalty_calculations rc
     WHERE NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_royalty_calculation_id = rc.id)
  `);
  console.log(`  delivery_line_items  未移行 ${dliPending.rows[0].c}`);
  console.log(`  royalty_calculations 未移行 ${rcPending.rows[0].c}`);

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で実書き込み。");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const heldInspection: any[][] = [];
  const heldRoyalty: any[][] = [];
  let insDone = 0;
  let royDone = 0;
  try {
    await client.query("BEGIN");

    // ---- delivery_line_items → inspection ---------------------------------
    const dli = await client.query(`
      SELECT dli.id, dli.capability_line_item_id, dli.inspected_amount_ex_tax,
             de.id AS delivery_event_id, de.delivered_at, de.created_at AS de_created,
             de.backlog_issue_key,
             cl.id AS condition_line_id
        FROM delivery_line_items dli
        JOIN delivery_events de ON de.id = dli.delivery_event_id
        LEFT JOIN condition_lines cl ON cl.source_line_item_id = dli.capability_line_item_id
       WHERE NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_delivery_line_item_id = dli.id)
       ORDER BY COALESCE(de.delivered_at, de.created_at), dli.id
    `);
    for (const row of dli.rows) {
      if (!row.condition_line_id) {
        heldInspection.push([row.id, row.delivery_event_id, "condition_line 未解決(C-2先行要)"]);
        continue;
      }
      // document_id 解決: 検収書 final, form_data.delivery_event_id 一致
      const doc = await client.query(
        `SELECT id FROM documents
          WHERE template_type IN ('inspection_certificate','delivery_inspec')
            AND form_data->>'delivery_event_id' = $1::text
            AND COALESCE(lifecycle_status,'final') = 'final'
          ORDER BY created_at DESC LIMIT 1`,
        [row.delivery_event_id]
      );
      if (!doc.rows.length) {
        heldInspection.push([row.id, row.delivery_event_id, "document_id 解決不能"]);
        continue;
      }
      const documentId = doc.rows[0].id;
      const occurredAt = row.delivered_at || row.de_created;
      const eventNo = await nextEventNo(client, row.condition_line_id);
      const ev = await client.query(
        `INSERT INTO condition_events
           (condition_line_id, event_no, event_type, document_id, backlog_issue_key,
            occurred_at, amount_ex_tax, source_delivery_line_item_id)
         VALUES ($1,$2,'inspection',$3,$4,$5,$6,$7) RETURNING id`,
        [
          row.condition_line_id,
          eventNo,
          documentId,
          row.backlog_issue_key,
          occurredAt,
          Number(row.inspected_amount_ex_tax) || 0,
          row.id,
        ]
      );
      await client.query(
        `UPDATE delivery_line_items SET condition_event_id = $1, condition_line_id = $2 WHERE id = $3`,
        [ev.rows[0].id, row.condition_line_id, row.id]
      );
      insDone++;
    }
    console.log(`  inspection events: ${insDone} 件 (保留 ${heldInspection.length})`);

    // ---- royalty_calculations → royalty_calc ------------------------------
    const rc = await client.query(`
      SELECT rc.id, rc.capability_financial_condition_id, rc.manufacturing_event_id,
             rc.actual_royalty_ex_tax, rc.period, rc.backlog_issue_key, rc.created_at,
             cl.id AS condition_line_id
        FROM royalty_calculations rc
        LEFT JOIN condition_lines cl ON cl.source_condition_id = rc.capability_financial_condition_id
       WHERE NOT EXISTS (SELECT 1 FROM condition_events e WHERE e.source_royalty_calculation_id = rc.id)
       ORDER BY rc.created_at, rc.id
    `);
    for (const row of rc.rows) {
      if (!row.condition_line_id) {
        heldRoyalty.push([row.id, row.capability_financial_condition_id, "condition_line 未解決(C-2先行要)"]);
        continue;
      }
      const doc = await client.query(
        `SELECT id FROM documents
          WHERE template_type IN ('royalty_statement','利用許諾料計算書')
            AND issue_key = $1
            AND COALESCE(lifecycle_status,'final') = 'final'
            AND (
              (form_data->>'capabilityFinancialConditionId') = $2::text
              OR (form_data->>'manufacturingEventId') = $3::text
            )
          ORDER BY created_at DESC LIMIT 1`,
        [
          row.backlog_issue_key,
          row.capability_financial_condition_id,
          row.manufacturing_event_id,
        ]
      );
      if (!doc.rows.length) {
        heldRoyalty.push([row.id, row.capability_financial_condition_id, "document_id 解決不能"]);
        continue;
      }
      const eventNo = await nextEventNo(client, row.condition_line_id);
      const ev = await client.query(
        `INSERT INTO condition_events
           (condition_line_id, event_no, event_type, document_id, backlog_issue_key,
            occurred_at, period, amount_ex_tax, source_royalty_calculation_id)
         VALUES ($1,$2,'royalty_calc',$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          row.condition_line_id,
          eventNo,
          doc.rows[0].id,
          row.backlog_issue_key,
          row.created_at,
          row.period,
          Number(row.actual_royalty_ex_tax) || 0,
          row.id,
        ]
      );
      await client.query(
        `UPDATE royalty_calculations SET condition_event_id = $1, condition_line_id = $2 WHERE id = $3`,
        [ev.rows[0].id, row.condition_line_id, row.id]
      );
      royDone++;
    }
    console.log(`  royalty_calc events: ${royDone} 件 (保留 ${heldRoyalty.length})`);

    await client.query("COMMIT");
    console.log("\nCOMMIT 完了。");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e);
    process.exitCode = 1;
    client.release();
    await pool.end();
    return;
  }
  client.release();

  writeCsv(
    "c3_held_inspection.csv",
    ["delivery_line_item_id", "delivery_event_id", "reason"],
    heldInspection
  );
  writeCsv(
    "c3_held_royalty.csv",
    ["royalty_calculation_id", "capability_financial_condition_id", "reason"],
    heldRoyalty
  );

  // 検証: 明細ごとの SUM(amount) が旧集計と一致するか (inspection)
  const v = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(inspected_amount_ex_tax),0) FROM delivery_line_items WHERE condition_event_id IS NOT NULL) AS dli_amt,
      (SELECT COALESCE(SUM(amount_ex_tax),0) FROM condition_events WHERE event_type='inspection' AND voided_at IS NULL) AS ev_amt
  `);
  const r = v.rows[0];
  console.log(`\n[検証] inspection 金額 旧 ${r.dli_amt} = 新 ${r.ev_amt} : ${Number(r.dli_amt) === Number(r.ev_amt) ? "OK" : "MISMATCH"}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
