/**
 * データ構造刷新 Phase C-2 — 旧明細 → 統一条件明細(condition_lines) バックフィル。
 *
 *   capability_line_items            → condition_lines (per_unit/lump_sum/subscription)
 *   capability_financial_conditions  → condition_lines (royalty/lump_sum)
 *
 * 変換ルールは services/worker/src/lib/conditionLineMapper.ts に集約 (C-5 と共用)。
 *
 * A案: structural_role='master' の契約に条件明細がぶら下がる場合、暗黙の terms
 *   契約を 1 件生成して切り出し、そこに condition_lines を付ける
 *   (master は枠組みのみ・条件明細を持たない原則)。
 *
 * 実行:
 *   tsx scripts/restructure_c2_condition_lines.ts          # ドライラン (件数のみ)
 *   tsx scripts/restructure_c2_condition_lines.ts --apply  # 実書き込み
 *
 * 冪等: source_line_item_id / source_condition_id で既移行を除外 (NOT EXISTS)。
 *   暗黙 terms 契約は parent + 命名規則で再利用。
 * 検証: 旧2テーブル行数合計 = 新規 condition_lines 行数。金額合計一致。
 */

import { pool } from "../services/worker/src/lib/db.js";
import {
  mapLineItemToConditionLine,
  mapFinancialConditionToConditionLine,
  conditionLineInsertValues,
  CONDITION_LINE_COLUMNS,
} from "../services/worker/src/lib/conditionLineMapper.js";

const APPLY = process.argv.includes("--apply");
const IMPLICIT_PREFIX = "（基本契約内条件）";

const INSERT_SQL = `INSERT INTO condition_lines (${CONDITION_LINE_COLUMNS.join(
  ", "
)}) VALUES (${CONDITION_LINE_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`;

// document_sequences を client 上で払い出して line_code を生成 (in-tx)。
async function nextLineCode(client: any, year: number): Promise<string> {
  const r = await client.query(
    `INSERT INTO document_sequences (kind, year, current_value) VALUES ('condition_line', $1, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [year]
  );
  return `CL-${year}-${String(r.rows[0].current_value).padStart(5, "0")}`;
}

// master の場合、暗黙 terms 契約 id を返す (生成 or 再利用)。terms はそのまま返す。
async function resolveTargetCapability(
  client: any,
  cap: any,
  memo: Map<number, number>
): Promise<number> {
  const role = cap.structural_role ||
    (cap.record_type === "master_contract" ? "master" : "terms");
  if (role !== "master") return cap.id;
  if (memo.has(cap.id)) return memo.get(cap.id)!;

  // 既存の暗黙 terms を再利用 (冪等)
  const existing = await client.query(
    `SELECT id FROM contract_capabilities
      WHERE parent_capability_id = $1 AND contract_title LIKE $2
      ORDER BY id LIMIT 1`,
    [cap.id, IMPLICIT_PREFIX + "%"]
  );
  if (existing.rows.length) {
    memo.set(cap.id, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const ins = await client.query(
    `INSERT INTO contract_capabilities
       (record_type, contract_category, contract_type, contract_title,
        vendor_id, effective_date, expiration_date,
        structural_role, parent_capability_id, template_family, backlog_issue_key)
     VALUES ('standalone_contract', $1, $2, $3, $4, $5, $6, 'terms', $7, $8, $9)
     RETURNING id`,
    [
      cap.contract_category,
      cap.contract_type,
      IMPLICIT_PREFIX + (cap.contract_title || ""),
      cap.vendor_id,
      cap.effective_date,
      cap.expiration_date,
      cap.id,
      cap.template_family,
      cap.backlog_issue_key,
    ]
  );
  const newId = ins.rows[0].id;
  // scopes を master からコピー
  await client.query(
    `INSERT INTO contract_scopes (capability_id, scope)
       SELECT $1, scope FROM contract_scopes WHERE capability_id = $2
     ON CONFLICT (capability_id, scope) DO NOTHING`,
    [newId, cap.id]
  );
  memo.set(cap.id, newId);
  return newId;
}

async function nextLineNo(client: any, capabilityId: number): Promise<number> {
  const r = await client.query(
    `SELECT COALESCE(MAX(line_no), 0) AS m FROM condition_lines WHERE capability_id = $1`,
    [capabilityId]
  );
  return Number(r.rows[0].m) + 1;
}

async function main() {
  console.log(`\n=== Phase C-2: 条件明細バックフィル (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  const liCount = await pool.query(
    `SELECT COUNT(*)::int c FROM capability_line_items`
  );
  const fcCount = await pool.query(
    `SELECT COUNT(*)::int c FROM capability_financial_conditions`
  );
  const liPending = await pool.query(
    `SELECT COUNT(*)::int c FROM capability_line_items li
      WHERE NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = li.id)`
  );
  const fcPending = await pool.query(
    `SELECT COUNT(*)::int c FROM capability_financial_conditions fc
      WHERE NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_condition_id = fc.id)`
  );
  console.log(`  capability_line_items           ${liCount.rows[0].c} (未移行 ${liPending.rows[0].c})`);
  console.log(`  capability_financial_conditions ${fcCount.rows[0].c} (未移行 ${fcPending.rows[0].c})`);

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で実書き込み。");
    await pool.end();
    return;
  }

  const year = new Date().getFullYear();
  const memo = new Map<number, number>();
  const client = await pool.connect();
  let liDone = 0;
  let fcDone = 0;
  try {
    await client.query("BEGIN");

    // capability_line_items → condition_lines
    const liRows = await client.query(`
      SELECT li.*, cc.structural_role, cc.record_type
        FROM capability_line_items li
        JOIN contract_capabilities cc ON cc.id = li.capability_id
       WHERE NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_line_item_id = li.id)
       ORDER BY li.capability_id, li.line_no
    `);
    for (const li of liRows.rows) {
      const cap = await capRow(client, li.capability_id);
      const target = await resolveTargetCapability(client, cap, memo);
      const lineNo = await nextLineNo(client, target);
      const code = await nextLineCode(client, year);
      const row = mapLineItemToConditionLine(li, target, lineNo, code);
      await client.query(INSERT_SQL, conditionLineInsertValues(row));
      liDone++;
    }
    console.log(`  line_items  → condition_lines: ${liDone} 行`);

    // capability_financial_conditions → condition_lines
    const fcRows = await client.query(`
      SELECT fc.*, cc.effective_date AS cap_effective, cc.expiration_date AS cap_expiration
        FROM capability_financial_conditions fc
        JOIN contract_capabilities cc ON cc.id = fc.capability_id
       WHERE NOT EXISTS (SELECT 1 FROM condition_lines cl WHERE cl.source_condition_id = fc.id)
       ORDER BY fc.capability_id, fc.condition_no
    `);
    for (const fc of fcRows.rows) {
      const cap = await capRow(client, fc.capability_id);
      const target = await resolveTargetCapability(client, cap, memo);
      const lineNo = await nextLineNo(client, target);
      const code = await nextLineCode(client, year);
      const row = mapFinancialConditionToConditionLine(
        fc,
        { effective_date: fc.cap_effective, expiration_date: fc.cap_expiration },
        target,
        lineNo,
        code
      );
      await client.query(INSERT_SQL, conditionLineInsertValues(row));
      fcDone++;
    }
    console.log(`  financial_conditions → condition_lines: ${fcDone} 行`);

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

  // ---- 検証: 件数・金額突合 -------------------------------------------------
  const v = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM capability_line_items) AS li,
      (SELECT COUNT(*) FROM capability_financial_conditions) AS fc,
      (SELECT COUNT(*) FROM condition_lines WHERE source_line_item_id IS NOT NULL) AS cl_from_li,
      (SELECT COUNT(*) FROM condition_lines WHERE source_condition_id IS NOT NULL) AS cl_from_fc,
      (SELECT COALESCE(SUM(amount_ex_tax),0) FROM capability_line_items) AS li_amt,
      (SELECT COALESCE(SUM(amount_ex_tax),0) FROM condition_lines WHERE source_line_item_id IS NOT NULL) AS cl_li_amt
  `);
  const r = v.rows[0];
  console.log("\n[検証]");
  console.log(`  line_items ${r.li} = condition_lines(from li) ${r.cl_from_li} : ${r.li === r.cl_from_li ? "OK" : "MISMATCH"}`);
  console.log(`  financial_conditions ${r.fc} = condition_lines(from fc) ${r.cl_from_fc} : ${r.fc === r.cl_from_fc ? "OK" : "MISMATCH"}`);
  console.log(`  line_items 金額 ${r.li_amt} ≒ condition_lines(from li) 金額 ${r.cl_li_amt} : ${Number(r.li_amt) === Number(r.cl_li_amt) ? "OK" : "差異あり(subscription はamount NULL のため期待差)"}`);

  await pool.end();
}

// capability の必要列を取得 (memoized resolve 用)。
async function capRow(client: any, id: number): Promise<any> {
  const r = await client.query(
    `SELECT id, record_type, structural_role, contract_category, contract_type,
            contract_title, vendor_id, effective_date, expiration_date,
            template_family, backlog_issue_key
       FROM contract_capabilities WHERE id = $1`,
    [id]
  );
  return r.rows[0];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
