// migrations/sync-guides-to-db.mjs
//
// services/api/guides/<key>.html を 法務ポータルのガイド DB へ同期する。
//   - portal_guides の current_version(html_source)とファイルが異なるとき
//     だけ新しい version を作成し current_version_id を貼り替える(履歴保持・冪等)。
//   - ファイルが存在するガイドは status を 'published'(公開中)にする。
//     ファイルが無いガイド(未受領: search / eventinst 等)は draft(準備中)のまま。
//   - GAS 原文をそのまま投入する(配信時に search-api の portalRender が変換)。
//
//   前提: 0093/0094 マイグレーション適用済み(portal_guides にメタ行がある)。
//   メタ未登録の key のファイルはスキップ(警告)。新規ガイドはまず seed に追加する。
//
//   実行(pg がある migrations/ から):
//     cd ~/LegalBridge_AI_GCP/migrations
//     DATABASE_URL="postgresql://postgres:****@127.0.0.1:5432/legalbridge" node sync-guides-to-db.mjs
//   実行後、search-api を再起動/リロードすると反映される。

import pg from "pg";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const guidesDir = path.join(root, "services/api/guides");

if (!existsSync(guidesDir)) {
  console.error(`guides dir not found: ${guidesDir}`);
  process.exit(1);
}

// 同期対象 = guides/<key>.html (README.md 等は除外)。
const targets = readdirSync(guidesDir)
  .filter((f) => f.endsWith(".html"))
  .map((f) => ({ key: f.replace(/\.html$/, ""), html: readFileSync(path.join(guidesDir, f), "utf8") }));

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  await client.connect();
  let updated = 0,
    created = 0,
    unchanged = 0,
    skipped = 0;

  for (const t of targets) {
    const head = await client.query(
      `SELECT id, current_version_id, status FROM portal_guides WHERE guide_key = $1`,
      [t.key]
    );
    if (head.rowCount === 0) {
      console.warn(`  ! skip ${t.key}: portal_guides にメタ行がありません(先に seed に追加してください)`);
      skipped++;
      continue;
    }
    const guideId = head.rows[0].id;
    const curVerId = head.rows[0].current_version_id;

    let curHtml = null;
    if (curVerId) {
      const cv = await client.query(
        `SELECT html_source FROM portal_guide_versions WHERE id = $1`,
        [curVerId]
      );
      curHtml = cv.rows[0]?.html_source ?? null;
    }

    if (curHtml === t.html) {
      // 内容は同じ。念のため status を published に揃える(初回ファイル投入後の保険)。
      if (head.rows[0].status !== "published") {
        await client.query(
          `UPDATE portal_guides SET status='published', updated_at=now() WHERE id=$1`,
          [guideId]
        );
      }
      unchanged++;
      continue;
    }

    const mv = await client.query(
      `SELECT COALESCE(MAX(version_no), 0) AS m FROM portal_guide_versions WHERE guide_id = $1`,
      [guideId]
    );
    const nextVer = Number(mv.rows[0].m) + 1;
    const ins = await client.query(
      `INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [guideId, nextVer, t.html, "sync from file", "sync-guides"]
    );
    await client.query(
      `UPDATE portal_guides
         SET current_version_id = $1, status = 'published', updated_at = now()
       WHERE id = $2`,
      [ins.rows[0].id, guideId]
    );
    if (curVerId) updated++;
    else created++;
    console.log(`  synced ${t.key} -> v${nextVer} (published)`);
  }

  console.log(
    `Done. created=${created}, updated=${updated}, unchanged=${unchanged}, skipped=${skipped} (files ${targets.length}).`
  );
  console.log("※ search-api は配信時に DB の current 版を読みます。反映には再起動/リロードを。");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
