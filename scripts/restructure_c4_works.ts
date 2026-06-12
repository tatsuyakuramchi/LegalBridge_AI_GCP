/**
 * データ構造刷新 Phase C-4 — sublicensees 統合 / works 起票 / 受取明細生成。
 *
 *   sublicensees       → vendors (名寄せ。一致なしは新規作成)
 *   work_sublicensees  → works + アウト側 terms 契約 + 受取条件明細(receivable)
 *   contract_capabilities.original_work / product_name
 *                      → works 名寄せドラフト CSV (⚠ 自動確定しない)
 *
 * 実行:
 *   tsx scripts/restructure_c4_works.ts                  # ドライラン
 *   tsx scripts/restructure_c4_works.ts --apply          # 実書き込み
 *
 * 冪等: 一時マッピングテーブル _migration_sublicensee_vendor /
 *   _migration_ws_outbound で既処理を除外。
 * 依存: Phase B (works/condition_lines)。works.work_code は新採番、
 *   元 work_id 文字列は works.remarks に [src:...] で退避し再利用判定に使う。
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

async function nextWorkCode(client: any, year: number): Promise<string> {
  const r = await client.query(
    `INSERT INTO document_sequences (kind, year, current_value) VALUES ('work', $1, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [year]
  );
  return `WK-${year}-${String(r.rows[0].current_value).padStart(4, "0")}`;
}

async function nextLineCode(client: any, year: number): Promise<string> {
  const r = await client.query(
    `INSERT INTO document_sequences (kind, year, current_value) VALUES ('condition_line', $1, 1)
       ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
     RETURNING current_value`,
    [year]
  );
  return `CL-${year}-${String(r.rows[0].current_value).padStart(5, "0")}`;
}

async function main() {
  console.log(`\n=== Phase C-4: sublicensees/works (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  const counts = await pool.query(`
    SELECT (SELECT COUNT(*) FROM sublicensees) AS sub,
           (SELECT COUNT(*) FROM work_sublicensees) AS ws
  `);
  console.log(`  sublicensees ${counts.rows[0].sub} / work_sublicensees ${counts.rows[0].ws}`);

  // original_work / product_name 名寄せドラフト (常に出力・自動確定しない)
  const names = await pool.query(`
    SELECT DISTINCT TRIM(v) AS name FROM (
      SELECT original_work AS v FROM contract_capabilities WHERE COALESCE(original_work,'')<>''
      UNION
      SELECT product_name  AS v FROM contract_capabilities WHERE COALESCE(product_name,'')<>''
    ) t ORDER BY 1
  `);
  writeCsv(
    "c4_work_name_survey.csv",
    ["source_name", "confirmed_work_code(空欄=未確定)"],
    names.rows.map((r) => [r.name, ""])
  );

  if (!APPLY) {
    console.log("\nDRY-RUN 完了。--apply で実書き込み。");
    await pool.end();
    return;
  }

  const year = new Date().getFullYear();
  const client = await pool.connect();
  let vendorNew = 0;
  let vendorMatched = 0;
  let worksNew = 0;
  let outboundNew = 0;
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migration_sublicensee_vendor (
        sublicensee_id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migration_ws_outbound (
        work_sublicensee_id INTEGER PRIMARY KEY,
        capability_id INTEGER NOT NULL, condition_line_id INTEGER NOT NULL)
    `);

    // ---- sublicensees → vendors -------------------------------------------
    const subs = await client.query(`
      SELECT s.* FROM sublicensees s
       WHERE NOT EXISTS (SELECT 1 FROM _migration_sublicensee_vendor m WHERE m.sublicensee_id = s.id)
       ORDER BY s.id
    `);
    for (const s of subs.rows) {
      // 名寄せ: vendor_name 完全一致 (+ name_kana 補助)
      const match = await client.query(
        `SELECT id FROM vendors WHERE vendor_name = $1 ORDER BY id LIMIT 1`,
        [s.name]
      );
      let vendorId: number;
      if (match.rows.length) {
        vendorId = match.rows[0].id;
        vendorMatched++;
      } else {
        const ins = await client.query(
          `INSERT INTO vendors (vendor_code, vendor_name, entity_type, email, phone, aliases)
           VALUES ($1, $2, 'corporate', $3, $4, $5) RETURNING id`,
          [`SUBLIC-${s.id}`, s.name, s.contact_email, s.contact_phone, s.name_kana]
        );
        vendorId = ins.rows[0].id;
        vendorNew++;
      }
      await client.query(
        `INSERT INTO _migration_sublicensee_vendor (sublicensee_id, vendor_id) VALUES ($1,$2)
           ON CONFLICT (sublicensee_id) DO NOTHING`,
        [s.id, vendorId]
      );
    }
    console.log(`  sublicensees → vendors: 既存一致 ${vendorMatched} / 新規 ${vendorNew}`);

    // ---- work_sublicensees → works + アウト側契約 + 受取明細 ---------------
    const ws = await client.query(`
      SELECT ws.*, cc.original_work, cc.contract_title, cc.contract_category, cc.contract_type
        FROM work_sublicensees ws
        LEFT JOIN contract_capabilities cc ON cc.id = ws.license_contract_id
       WHERE NOT EXISTS (SELECT 1 FROM _migration_ws_outbound m WHERE m.work_sublicensee_id = ws.id)
       ORDER BY ws.id
    `);
    // work_id 文字列 → works.id のメモ (同一 work_id を共有)
    const workMemo = new Map<string, number>();
    for (const row of ws.rows) {
      const srcWorkId = String(row.work_id || `WS-${row.id}`);
      let workDbId: number;
      if (workMemo.has(srcWorkId)) {
        workDbId = workMemo.get(srcWorkId)!;
      } else {
        // 既存 works を [src:...] マーカーで再利用
        const ex = await client.query(
          `SELECT id FROM works WHERE remarks LIKE $1 ORDER BY id LIMIT 1`,
          [`%[src:${srcWorkId}]%`]
        );
        if (ex.rows.length) {
          workDbId = ex.rows[0].id;
        } else {
          const title = row.original_work || row.contract_title || srcWorkId;
          const code = await nextWorkCode(client, year);
          const w = await client.query(
            `INSERT INTO works (work_code, title, remarks) VALUES ($1,$2,$3) RETURNING id`,
            [code, title, `[src:${srcWorkId}]`]
          );
          workDbId = w.rows[0].id;
          worksNew++;
        }
        workMemo.set(srcWorkId, workDbId);
      }

      // vendor 解決 (sublicensee_id 経由 or inline_name)
      let vendorId: number | null = null;
      if (row.sublicensee_id) {
        const mv = await client.query(
          `SELECT vendor_id FROM _migration_sublicensee_vendor WHERE sublicensee_id = $1`,
          [row.sublicensee_id]
        );
        vendorId = mv.rows[0]?.vendor_id ?? null;
      }

      // アウト側 terms 契約
      const cap = await client.query(
        `INSERT INTO contract_capabilities
           (record_type, contract_category, contract_type, contract_title,
            vendor_id, structural_role, template_family, effective_date)
         VALUES ('standalone_contract', 'license', COALESCE($1,'license'),
                 $2, $3, 'terms', 'license', $4)
         RETURNING id`,
        [
          row.contract_type,
          `（再許諾）${row.inline_name || row.contract_title || srcWorkId}`,
          vendorId,
          row.contract_date,
        ]
      );
      const capId = cap.rows[0].id;
      await client.query(
        `INSERT INTO contract_scopes (capability_id, scope) VALUES ($1,'license_use')
           ON CONFLICT (capability_id, scope) DO NOTHING`,
        [capId]
      );

      // 受取条件明細 (direction='receivable', scheme='royalty')
      const code = await nextLineCode(client, year);
      const notes = [row.rate_label, row.mg_ag_label, row.payment_terms_label, row.remarks]
        .filter((x) => x && String(x).trim())
        .join(" / ") || null;
      const cl = await client.query(
        `INSERT INTO condition_lines
           (capability_id, line_no, line_code, subject, direction, payment_scheme,
            currency, notes, work_id, term_start)
         VALUES ($1, 1, $2, $3, 'receivable', 'royalty', 'JPY', $4, $5, $6)
         RETURNING id`,
        [
          capId,
          code,
          row.inline_name || null,
          notes,
          workDbId,
          row.contract_date,
        ]
      );
      await client.query(
        `INSERT INTO _migration_ws_outbound (work_sublicensee_id, capability_id, condition_line_id)
         VALUES ($1,$2,$3) ON CONFLICT (work_sublicensee_id) DO NOTHING`,
        [row.id, capId, cl.rows[0].id]
      );
      outboundNew++;
    }
    console.log(`  work_sublicensees: works 新規 ${worksNew} / アウト側契約+受取明細 ${outboundNew}`);

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

  // 検証
  const v = await pool.query(`
    SELECT (SELECT COUNT(*) FROM sublicensees) AS sub,
           (SELECT COUNT(*) FROM _migration_sublicensee_vendor) AS mapped,
           (SELECT COUNT(*) FROM work_sublicensees) AS ws,
           (SELECT COUNT(*) FROM _migration_ws_outbound) AS outbound
  `);
  const r = v.rows[0];
  console.log(`\n[検証] sublicensees ${r.sub} = mapped ${r.mapped} : ${Number(r.sub) === Number(r.mapped) ? "OK" : "未処理あり"}`);
  console.log(`        work_sublicensees ${r.ws} = outbound ${r.outbound} : ${Number(r.ws) === Number(r.outbound) ? "OK" : "未処理あり"}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
