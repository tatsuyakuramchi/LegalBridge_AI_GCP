/**
 * Phase 23.1 — documents.lifecycle_status の一括正規化
 *
 * 背景:
 *   Phase 23.1 以前は「再編集 → generate」のたびに新しい document_number
 *   (revision +1, _001 サフィックス) で別 row として保存していた。その結果、
 *   同一 (issue_key, template_type) に対して複数の lifecycle_status='final' な
 *   行が並ぶ状態が常態化しており、「どれが現在の正か」が一意に決まらない。
 *
 * このスクリプトは:
 *   1. (issue_key, template_type) ごとに最新の (created_at desc) 1 件だけを
 *      lifecycle_status='final' に揃える
 *   2. それ以外を 'archived_draft' に倒す (内部修正で上書きされた過去版と同等扱い)
 *   3. contract_capabilities も document_number で JOIN して同期する
 *
 * 実行:
 *   tsx scripts/normalize_document_lifecycle.ts            # ドライラン (件数のみ)
 *   tsx scripts/normalize_document_lifecycle.ts --apply    # 実行 UPDATE
 *   tsx scripts/normalize_document_lifecycle.ts --apply --verbose
 *                                                         # 行ごとの状態変化を表示
 *
 * 冪等性: 何度実行しても、すでに正しい状態の行は触らない。
 *
 * 注意:
 *   - drive_link 空の draft (= 未完成行) は対象外。final と並存しても問題ない。
 *   - revision >= 1 で _NNN サフィックス付きの再発行版が含まれる場合も、
 *     created_at が最新ならその行が final になる (= 再発行された後の状態と整合)。
 */

import { pool } from "../services/worker/src/lib/db.js";

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

interface GroupRow {
  issue_key: string;
  template_type: string;
  total: number;
  final_count: number;
  latest_id: number;
  latest_doc_number: string;
}

interface DocRow {
  id: number;
  document_number: string;
  issue_key: string;
  template_type: string;
  lifecycle_status: string;
  created_at: string;
}

async function findDuplicateFinalGroups(): Promise<GroupRow[]> {
  // 同じ (issue_key, template_type) に対し final が 2 件以上ある、
  // または final が 1 件でも archived_draft 等が混ざっていない (= 全部 final)
  // などの整合性が崩れているグループを抽出。
  // drive_link 空の draft は除外する (= まだ完成していない作成中のもの)。
  const r = await pool.query(`
    SELECT
      d.issue_key,
      d.template_type,
      COUNT(*)::int                                                 AS total,
      SUM(CASE WHEN d.lifecycle_status = 'final' THEN 1 ELSE 0 END)::int AS final_count,
      (
        SELECT d2.id
          FROM documents d2
         WHERE d2.issue_key = d.issue_key
           AND d2.template_type = d.template_type
           AND COALESCE(d2.drive_link, '') <> ''
         ORDER BY d2.created_at DESC, d2.id DESC
         LIMIT 1
      ) AS latest_id,
      (
        SELECT d2.document_number
          FROM documents d2
         WHERE d2.issue_key = d.issue_key
           AND d2.template_type = d.template_type
           AND COALESCE(d2.drive_link, '') <> ''
         ORDER BY d2.created_at DESC, d2.id DESC
         LIMIT 1
      ) AS latest_doc_number
    FROM documents d
    WHERE COALESCE(d.drive_link, '') <> ''
    GROUP BY d.issue_key, d.template_type
    HAVING SUM(CASE WHEN d.lifecycle_status = 'final' THEN 1 ELSE 0 END) > 1
    ORDER BY d.issue_key, d.template_type;
  `);
  return r.rows as GroupRow[];
}

async function listGroupRows(
  issueKey: string,
  templateType: string
): Promise<DocRow[]> {
  const r = await pool.query(
    `SELECT id, document_number, issue_key, template_type,
            COALESCE(lifecycle_status, 'final') AS lifecycle_status,
            created_at::text AS created_at
       FROM documents
      WHERE issue_key = $1
        AND template_type = $2
        AND COALESCE(drive_link, '') <> ''
      ORDER BY created_at DESC, id DESC`,
    [issueKey, templateType]
  );
  return r.rows as DocRow[];
}

async function normalizeGroup(group: GroupRow): Promise<{ updated: number }> {
  // 最新行は final、それ以外は archived_draft。
  // すでに正しい状態の行は触らない (冪等)。
  const r1 = await pool.query(
    `UPDATE documents
        SET lifecycle_status = 'final'
      WHERE id = $1
        AND lifecycle_status <> 'final'`,
    [group.latest_id]
  );
  const r2 = await pool.query(
    `UPDATE documents
        SET lifecycle_status = 'archived_draft'
      WHERE issue_key = $1
        AND template_type = $2
        AND COALESCE(drive_link, '') <> ''
        AND id <> $3
        AND lifecycle_status = 'final'`,
    [group.issue_key, group.template_type, group.latest_id]
  );
  // contract_capabilities も同期 (documents の document_number で JOIN)
  const r3 = await pool.query(
    `UPDATE contract_capabilities cc
        SET lifecycle_status = sub.expected_status,
            updated_at       = CURRENT_TIMESTAMP
       FROM (
         SELECT d.document_number,
                CASE WHEN d.id = $1 THEN 'final' ELSE 'archived_draft' END
                  AS expected_status
           FROM documents d
          WHERE d.issue_key = $2
            AND d.template_type = $3
            AND COALESCE(d.drive_link, '') <> ''
       ) AS sub
      WHERE cc.document_number = sub.document_number
        AND COALESCE(cc.lifecycle_status, 'final') <> sub.expected_status`,
    [group.latest_id, group.issue_key, group.template_type]
  );
  return { updated: (r1.rowCount || 0) + (r2.rowCount || 0) + (r3.rowCount || 0) };
}

async function main() {
  console.log(
    `Phase 23.1 lifecycle normalization: ${APPLY ? "APPLY" : "DRY-RUN"}${
      VERBOSE ? " (verbose)" : ""
    }`
  );

  const groups = await findDuplicateFinalGroups();
  console.log(`\n複数 final が並ぶグループ: ${groups.length} 件`);

  if (groups.length === 0) {
    console.log("整合性は保たれています。終了。");
    await pool.end();
    return;
  }

  if (VERBOSE || !APPLY) {
    console.log("\n--- 対象グループ ---");
    for (const g of groups.slice(0, 20)) {
      console.log(
        `  ${g.issue_key} / ${g.template_type.padEnd(28)}  total=${g.total}  final_now=${g.final_count}  → keep_final_id=${g.latest_id} (${g.latest_doc_number})`
      );
      if (VERBOSE) {
        const rows = await listGroupRows(g.issue_key, g.template_type);
        for (const r of rows) {
          const willBe = r.id === g.latest_id ? "final" : "archived_draft";
          const arrow = r.lifecycle_status === willBe ? "=" : "→";
          console.log(
            `      [${r.id}] ${r.document_number.padEnd(28)} ${r.lifecycle_status} ${arrow} ${willBe} (${r.created_at})`
          );
        }
      }
    }
    if (groups.length > 20) {
      console.log(`  ... (残り ${groups.length - 20} 件)`);
    }
  }

  if (!APPLY) {
    console.log("\n(dry-run 終了。実行は --apply を付けて再実行)");
    await pool.end();
    return;
  }

  let totalUpdated = 0;
  let ok = 0;
  let ng = 0;
  for (const g of groups) {
    try {
      const r = await normalizeGroup(g);
      totalUpdated += r.updated;
      ok += 1;
    } catch (e) {
      ng += 1;
      console.error(
        `  ❌ ${g.issue_key} / ${g.template_type}:`,
        e
      );
    }
  }
  console.log(
    `\n✅ 正規化完了: ${ok} グループ成功 / ${ng} グループ失敗 / ${totalUpdated} 行更新`
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
