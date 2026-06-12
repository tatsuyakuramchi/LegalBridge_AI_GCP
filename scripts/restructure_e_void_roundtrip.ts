/**
 * データ構造刷新 Phase E-1 受け入れテスト — void / reissue 残高往復。
 *
 * 文書 void で残高が復元され、reissue(付け替え)で残高が保たれ、現行版 void で
 * 再び復元される「往復」を、エンドポイントが叩く SQL 操作と同じ手順で検証する。
 *
 * 実行: DATABASE_URL=... tsx scripts/restructure_e_void_roundtrip.ts
 *   (一時 DB に対して実行する想定。データを作って検証し、最後に後始末する。)
 */

import { pool } from "../services/worker/src/lib/db.js";
import { getMgConsumedToDate } from "../services/worker/src/lib/calc_license.js";

async function consumed(lineId: number): Promise<number> {
  const r = await pool.query(
    `SELECT consumed_amount FROM condition_line_status_v WHERE id = $1`,
    [lineId]
  );
  return Number(r.rows[0]?.consumed_amount || 0);
}

// 文書 void (エンドポイント /api/documents/:id/void と同じ操作)
async function voidDoc(documentId: number) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`UPDATE documents SET lifecycle_status='voided', is_primary=FALSE WHERE id=$1`, [documentId]);
    await c.query(
      `UPDATE condition_events SET voided_at=CURRENT_TIMESTAMP, void_reason='test'
        WHERE document_id=$1 AND voided_at IS NULL`,
      [documentId]
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

let pass = 0, fail = 0;
function check(label: string, got: any, want: any) {
  const ok = Number(got) === Number(want);
  console.log(`  ${ok ? "✅" : "❌"} ${label}: got=${got} want=${want}`);
  ok ? pass++ : fail++;
}

async function main() {
  const c = await pool.connect();
  await c.query("BEGIN");
  const cap = (await c.query(
    `INSERT INTO contract_capabilities (record_type,contract_category,contract_type,contract_title,effective_date,backlog_issue_key)
     VALUES ('standalone_contract','license','license','E1テスト','2026-01-01','ISSUE-E1') RETURNING id`
  )).rows[0].id;
  const fc = (await c.query(
    `INSERT INTO capability_financial_conditions (capability_id,condition_no,calc_method,rate_pct,mg_amount) VALUES ($1,1,'ROYALTY',5,100000) RETURNING id`,
    [cap]
  )).rows[0].id;
  const cl = (await c.query(
    `INSERT INTO condition_lines (capability_id,line_no,line_code,payment_scheme,direction,rate_pct,mg_amount,source_condition_id,term_start)
     VALUES ($1,1,'CL-E1-1','royalty','payable',5,100000,$2,'2026-01-01') RETURNING id`,
    [cap, fc]
  )).rows[0].id;
  const doc1 = (await c.query(
    `INSERT INTO documents (document_number,base_document_number,revision,issue_key,template_type,form_data,drive_link,lifecycle_status,is_primary)
     VALUES ('ROY-E1','ROY-E1',0,'ISSUE-E1','royalty_statement','{}','http://d','final',TRUE) RETURNING id`
  )).rows[0].id;
  const rc = (await c.query(
    `INSERT INTO royalty_calculations (backlog_issue_key,capability_id,capability_financial_condition_id,calc_type,actual_royalty_ex_tax,mg_amount,mg_consumed_this_time,created_at)
     VALUES ('ISSUE-E1',$1,$2,'sales',40000,100000,40000,'2026-02-01') RETURNING id`,
    [cap, fc]
  )).rows[0].id;
  await c.query(
    `INSERT INTO condition_events (condition_line_id,event_no,event_type,document_id,occurred_at,amount_ex_tax,source_royalty_calculation_id)
     VALUES ($1,1,'royalty_calc',$2,'2026-02-01',40000,$3)`,
    [cl, doc1, rc]
  );
  await c.query("COMMIT");
  c.release();

  console.log("\n=== Phase E-1: void / reissue 残高往復 ===");

  // 1. 初期: 消化 40000 / MG 残 60000
  check("初期 consumed", await consumed(cl), 40000);
  check("初期 MG 消化", await getMgConsumedToDate(cap, fc), 40000);

  // 2. reissue: 新版 doc2 を作り、有効イベントを付け替え (残高不変)
  const doc2 = (await pool.query(
    `INSERT INTO documents (document_number,base_document_number,revision,issue_key,template_type,form_data,drive_link,lifecycle_status,is_primary)
     VALUES ('ROY-E1-r1','ROY-E1',1,'ISSUE-E1','royalty_statement','{}','http://d2','final',TRUE) RETURNING id`
  )).rows[0].id;
  await pool.query(`UPDATE documents SET lifecycle_status='reissued', is_primary=FALSE WHERE id=$1`, [doc1]);
  await pool.query(
    `UPDATE condition_events SET document_id=$1 WHERE voided_at IS NULL AND document_id IN
       (SELECT id FROM documents WHERE base_document_number='ROY-E1' AND document_number<>'ROY-E1-r1')`,
    [doc2]
  );
  check("reissue後 consumed(不変)", await consumed(cl), 40000);

  // 3. 旧版 doc1 を void → 現行イベントは doc2 を指すので影響なし
  await voidDoc(doc1);
  check("旧版void後 consumed(不変)", await consumed(cl), 40000);

  // 4. 現行 doc2 を void → イベント取消 → 残高復元
  await voidDoc(doc2);
  check("現行void後 consumed(復元)", await consumed(cl), 0);
  check("現行void後 MG 消化(復元)", await getMgConsumedToDate(cap, fc), 0);

  console.log(`\n[結果] pass=${pass} fail=${fail}`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
