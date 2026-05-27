/**
 * Phase 23.0.4 — 検収書 documents.form_data.description の修復スクリプト
 *
 * 背景:
 *   a478901 以前、検収書フォームの onPick では `description` フィールドの優先度が
 *   「formData.description (= Backlog 課題本文) → line_item.item_name」だった。
 *   その結果、form-context 経由で生成された検収書ドキュメントの form_data.description
 *   に Backlog 課題本文 (例: "依頼タイプ: delivery_inspec ...") が残ったまま保存されており、
 *   再生成 (PDF/Excel) でも当時の本文が出てしまう。
 *
 * 対象:
 *   documents WHERE template_type LIKE 'inspection_certificate%'
 *     AND form_data->>'description' のうち、
 *     line_items[0].item_name と異なるか、Backlog 本文っぽい (例: '依頼タイプ:' で始まる) もの
 *
 * 修復方針:
 *   form_data.delivery_line_items[0].item_name があれば description を上書き。
 *   無ければ何もせず (= 既存値維持)。
 *
 * 実行:
 *   tsx scripts/fix_inspection_description_from_backlog.ts             # ドライラン (件数のみ)
 *   tsx scripts/fix_inspection_description_from_backlog.ts --apply     # 実 UPDATE
 *   tsx scripts/fix_inspection_description_from_backlog.ts --apply --verbose  # 行ごとの before/after を表示
 *
 * 冪等性: 何度実行しても、line_items[0].item_name に description が一致した行は UPDATE 対象外。
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

interface DocRow {
  id: number;
  document_number: string;
  description: string | null;
  expected_description: string | null;
}

async function findTargets(): Promise<DocRow[]> {
  // delivery_line_items[0].item_name と description が乖離している検収書を抽出。
  // jsonb path で 1 番目の line_item を取り、item_name を取り出す。
  const r = await pool.query(`
    SELECT
      d.id,
      d.document_number,
      (d.form_data->>'description')                                   AS description,
      ((d.form_data->'delivery_line_items'->0)->>'item_name')         AS expected_description
    FROM documents d
    WHERE d.template_type LIKE 'inspection_certificate%'
      AND d.form_data ? 'description'
      AND ((d.form_data->'delivery_line_items'->0)->>'item_name') IS NOT NULL
      AND COALESCE((d.form_data->'delivery_line_items'->0)->>'item_name', '') <> ''
      AND COALESCE((d.form_data->>'description'), '') <>
          COALESCE((d.form_data->'delivery_line_items'->0)->>'item_name', '')
    ORDER BY d.id;
  `);
  return r.rows as DocRow[];
}

async function applyFix(row: DocRow): Promise<void> {
  await pool.query(
    `UPDATE documents
        SET form_data = jsonb_set(form_data, '{description}', to_jsonb($2::text), true)
      WHERE id = $1`,
    [row.id, row.expected_description ?? ""]
  );
}

async function main() {
  console.log(
    `Inspection description fix: ${APPLY ? "APPLY" : "DRY-RUN"}${
      VERBOSE ? " (verbose)" : ""
    }`
  );

  const targets = await findTargets();
  console.log(`\n対象ドキュメント件数: ${targets.length}`);

  if (targets.length === 0) {
    console.log("修復対象なし。終了します。");
    await pool.end();
    return;
  }

  if (VERBOSE || !APPLY) {
    console.log("\n--- 修復対象一覧 ---");
    for (const r of targets.slice(0, 50)) {
      console.log(`  [${r.id}] ${r.document_number}`);
      console.log(`      before: ${(r.description || "").slice(0, 80)}`);
      console.log(`      after : ${(r.expected_description || "").slice(0, 80)}`);
    }
    if (targets.length > 50) {
      console.log(`  ... (残り ${targets.length - 50} 件)`);
    }
  }

  if (!APPLY) {
    console.log("\n(dry-run 終了。実行は --apply を付けて再実行)");
    await pool.end();
    return;
  }

  let ok = 0;
  let ng = 0;
  for (const r of targets) {
    try {
      await applyFix(r);
      ok += 1;
    } catch (e) {
      ng += 1;
      console.error(`  ❌ [${r.id}] ${r.document_number}:`, e);
    }
  }
  console.log(`\n✅ 修復完了: ${ok} 件成功 / ${ng} 件失敗`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
