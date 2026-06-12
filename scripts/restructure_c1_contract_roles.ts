/**
 * データ構造刷新 Phase C-1 — 契約ヘッダの直交分解バックフィル。
 *
 *   record_type           → contract_capabilities.structural_role (master/terms)
 *   contract_category     → contract_scopes (service / license_use)
 *   *_allowed フラグ       → scope 補完
 *   contract_category     → template_family (license / publication / service)
 *   documents.form_data->>'selected_master_contract_id'
 *                         → contract_capabilities.parent_capability_id
 *
 * 実行:
 *   tsx scripts/restructure_c1_contract_roles.ts            # ドライラン (件数比較のみ)
 *   tsx scripts/restructure_c1_contract_roles.ts --apply    # 実際にバックフィル
 *
 * 安全策:
 *   - --apply は単一トランザクション。失敗時 ROLLBACK。
 *   - 冪等: structural_role/template_family は計算値で UPDATE、
 *     contract_scopes は ON CONFLICT DO NOTHING、parent は IS NULL のみ。
 *   - mixed / scope 0 件 / parent 解決不能 は CSV レポート出力 (⚠ Q3: 手動確認)。
 *
 * 概念/実装設計: docs/condition_lines_unification_design.md / _implementation_plan.md
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
  const out = [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join(
    "\n"
  );
  const fp = path.join(REPORT_DIR, name);
  fs.writeFileSync(fp, out + "\n");
  console.log(`      report → ${fp} (${rows.length} rows)`);
}

async function main() {
  console.log(`\n=== Phase C-1: 契約ヘッダ分解 (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  // ---- 事前集計 -----------------------------------------------------------
  const byType = await pool.query(
    `SELECT record_type, COUNT(*)::int AS c FROM contract_capabilities GROUP BY record_type ORDER BY 1`
  );
  console.log("\n[record_type 別件数]");
  for (const r of byType.rows) console.log(`  ${String(r.record_type).padEnd(24)} ${r.c}`);

  const byCat = await pool.query(
    `SELECT contract_category, COUNT(*)::int AS c FROM contract_capabilities GROUP BY contract_category ORDER BY 1`
  );
  console.log("\n[contract_category 別件数]");
  for (const r of byCat.rows) console.log(`  ${String(r.contract_category).padEnd(24)} ${r.c}`);

  // mixed 契約一覧 (⚠ Q3: 手動 scope 分解対象)
  const mixed = await pool.query(
    `SELECT id, document_number, contract_title, record_type
       FROM contract_capabilities WHERE contract_category = 'mixed' ORDER BY id`
  );
  writeCsv(
    "c1_mixed_contracts.csv",
    ["id", "document_number", "contract_title", "record_type"],
    mixed.rows.map((r) => [r.id, r.document_number, r.contract_title, r.record_type])
  );

  // parent 解決のための form_data 走査 (個別条件 → 親 master)
  const parentCandidates = await pool.query(`
    SELECT cc.id AS child_id, cc.document_number AS child_no,
           (d.form_data->>'selected_master_contract_id') AS master_ref
      FROM contract_capabilities cc
      JOIN documents d ON d.issue_key = cc.backlog_issue_key
     WHERE cc.record_type = 'individual_contract'
       AND cc.parent_capability_id IS NULL
       AND d.form_data ? 'selected_master_contract_id'
       AND COALESCE(d.form_data->>'selected_master_contract_id','') <> ''
  `);

  // master_ref は id 文字列 or document_number の可能性 → 両方で解決
  const unresolvedParents: any[][] = [];
  const parentResolutions: { childId: number; parentId: number }[] = [];
  for (const row of parentCandidates.rows) {
    const ref = String(row.master_ref);
    const r = await pool.query(
      `SELECT id FROM contract_capabilities
        WHERE (id::text = $1 OR document_number = $1)
          AND record_type = 'master_contract'
        LIMIT 2`,
      [ref]
    );
    if (r.rows.length === 1) {
      parentResolutions.push({ childId: row.child_id, parentId: r.rows[0].id });
    } else {
      unresolvedParents.push([row.child_id, row.child_no, ref, r.rows.length]);
    }
  }
  writeCsv(
    "c1_unresolved_parents.csv",
    ["child_id", "child_document_number", "master_ref", "match_count"],
    unresolvedParents
  );
  console.log(
    `\n[parent 解決] 一意解決 ${parentResolutions.length} 件 / 解決不能 ${unresolvedParents.length} 件`
  );

  if (!APPLY) {
    // scope 0 件になりそうな契約 (category 不明) を事前提示
    const noScope = await pool.query(
      `SELECT id, document_number, contract_category
         FROM contract_capabilities
        WHERE contract_category NOT IN ('service','license','publication')
           OR contract_category IS NULL
        ORDER BY id`
    );
    writeCsv(
      "c1_no_scope_contracts.csv",
      ["id", "document_number", "contract_category"],
      noScope.rows.map((r) => [r.id, r.document_number, r.contract_category])
    );
    console.log("\nDRY-RUN 完了。--apply で実書き込み。");
    await pool.end();
    return;
  }

  // ---- 適用 ---------------------------------------------------------------
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // structural_role
    const role = await client.query(`
      UPDATE contract_capabilities SET structural_role = CASE
        WHEN record_type = 'master_contract' THEN 'master'
        WHEN record_type IN ('individual_contract','standalone_contract',
             'purchase_order','delivery_record','license_condition','publication_condition')
          THEN 'terms'
        ELSE structural_role END
      WHERE structural_role IS DISTINCT FROM CASE
        WHEN record_type = 'master_contract' THEN 'master'
        WHEN record_type IN ('individual_contract','standalone_contract',
             'purchase_order','delivery_record','license_condition','publication_condition')
          THEN 'terms'
        ELSE structural_role END
    `);
    console.log(`  structural_role: ${role.rowCount} 行更新`);

    // template_family
    const tf = await client.query(`
      UPDATE contract_capabilities SET template_family = CASE
        WHEN contract_category = 'publication' THEN 'publication'
        WHEN contract_category = 'license'     THEN 'license'
        WHEN contract_category = 'service'     THEN 'service'
        ELSE template_family END
      WHERE template_family IS NULL
        AND contract_category IN ('publication','license','service')
    `);
    console.log(`  template_family: ${tf.rowCount} 行更新`);

    // contract_scopes — category 由来
    const sc1 = await client.query(`
      INSERT INTO contract_scopes (capability_id, scope)
      SELECT id, 'service' FROM contract_capabilities WHERE contract_category = 'service'
      UNION
      SELECT id, 'license_use' FROM contract_capabilities WHERE contract_category IN ('license','publication')
      ON CONFLICT (capability_id, scope) DO NOTHING
    `);
    console.log(`  contract_scopes (category): ${sc1.rowCount} 行挿入`);

    // contract_scopes — *_allowed フラグ補完
    const sc2 = await client.query(`
      INSERT INTO contract_scopes (capability_id, scope)
      SELECT id, 'service' FROM contract_capabilities WHERE purchase_order_allowed = TRUE
      UNION
      SELECT id, 'license_use' FROM contract_capabilities
        WHERE license_condition_allowed = TRUE
           OR publication_condition_allowed = TRUE
           OR publication_contract_allowed = TRUE
      ON CONFLICT (capability_id, scope) DO NOTHING
    `);
    console.log(`  contract_scopes (allowed flags): ${sc2.rowCount} 行挿入`);

    // parent_capability_id
    let parentApplied = 0;
    for (const { childId, parentId } of parentResolutions) {
      const r = await client.query(
        `UPDATE contract_capabilities SET parent_capability_id = $2
          WHERE id = $1 AND parent_capability_id IS NULL`,
        [childId, parentId]
      );
      parentApplied += r.rowCount || 0;
    }
    console.log(`  parent_capability_id: ${parentApplied} 行更新`);

    await client.query("COMMIT");
    console.log("\nCOMMIT 完了。");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  // 検証: scope 0 件の契約一覧 (手動補完対象)
  const orphan = await pool.query(`
    SELECT cc.id, cc.document_number, cc.contract_category
      FROM contract_capabilities cc
     WHERE NOT EXISTS (SELECT 1 FROM contract_scopes s WHERE s.capability_id = cc.id)
     ORDER BY cc.id
  `);
  writeCsv(
    "c1_no_scope_contracts.csv",
    ["id", "document_number", "contract_category"],
    orphan.rows.map((r) => [r.id, r.document_number, r.contract_category])
  );
  console.log(`\n[検証] scope 0 件の契約: ${orphan.rows.length} 件 (要手動補完)`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
