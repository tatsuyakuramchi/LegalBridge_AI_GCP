// migrations/gen-portal-guide-seed.mjs
//
// services/api/guides/<key>.html を読み、ガイド本文をインライン投入する
//   migrations/0095_seed_portal_guide_html.sql を生成する。
//
// なぜインライン SQL か:
//   移行 Job(cloudbuild-migrate / run.mjs)はビルドコンテキスト migrations/ の
//   *.sql しか適用しない(services/api/guides は参照不可)。本番で確実に公開する唯一の
//   経路がインライン seed(0003_seed_templates と同方式)。各ガイドは version 1 として
//   投入し、portal_guides.current_version_id を貼り替え status='published' にする。
//   既に版があるガイドはスキップ(再生成・冪等)。
//
// 使い方:
//   1) services/api/guides/<key>.html を配置(正本の GAS HTML をそのまま)
//      ※ clause は冒頭の #guide-portal 断片を除去済みのものを置く
//   2) cd ~/LegalBridge_AI_GCP/migrations && node gen-portal-guide-seed.mjs
//   3) 生成された 0095_seed_portal_guide_html.sql をコミット → release/worker で適用
//
// 注: メタ(0094)に無い key の html はスキップ(警告)。新ガイドは先に 0094 に追加。

import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const guidesDir = path.join(root, "services/api/guides");

// 0094 seed に定義済みの key(メタが無い html はスキップ対象)。
const KNOWN_KEYS = new Set([
  "guide", "tetsuzuki", "vendor", "pub", "bg", "clause",
  "knowledge", "search", "torihiki", "eventinst", "privacy",
]);

// 増分方式: 既存 migrations の seed 済み key を検出し、未seed の key だけを
//   次の連番 NNNN_seed_portal_guide_html.sql に出力する(適用済み 0095 等は不変)。
const migFiles = readdirSync(here).filter((f) => /^\d{4}_.*\.sql$/.test(f));
const seededKeys = new Set();
let maxNum = 0;
for (const f of migFiles) {
  maxNum = Math.max(maxNum, Number(f.slice(0, 4)));
  if (/seed_portal_guide_html/.test(f)) {
    const sql = readFileSync(path.join(here, f), "utf8");
    for (const m of sql.matchAll(/DO \$seed_([a-z_]+)\$/g)) seededKeys.add(m[1]);
  }
}
const nextNum = String(maxNum + 1).padStart(4, "0");
const outFile = path.join(here, `${nextNum}_seed_portal_guide_html.sql`);

const files = readdirSync(guidesDir).filter((f) => f.endsWith(".html"));
if (files.length === 0) {
  console.error(`no *.html in ${guidesDir} — 先に正本のガイドを配置してください。`);
  process.exit(1);
}

// 衝突しないドル引用タグを作る($g_KEY$ が本文に無いことを保証)。
function dollarTag(key, html) {
  let tag = `$g_${key}$`;
  let n = 0;
  while (html.includes(tag)) {
    n += 1;
    tag = `$g_${key}_${n}$`;
  }
  return tag;
}

const blocks = [];
let used = 0,
  skipped = 0;
for (const f of files.sort()) {
  const key = f.replace(/\.html$/, "");
  if (!KNOWN_KEYS.has(key)) {
    console.warn(`  ! skip ${key}: 0094 にメタ未登録(先に 0094 へ追加)`);
    skipped++;
    continue;
  }
  if (seededKeys.has(key)) {
    // 既存 seed 済み。更新は新版追加(sync-guides-to-db.mjs)で行う。
    skipped++;
    continue;
  }
  const html = readFileSync(path.join(guidesDir, f), "utf8");
  const tag = dollarTag(key, html);
  blocks.push(`-- ── ${key} ──────────────────────────────────────────────
DO $seed_${key}$
DECLARE gid INTEGER; vid INTEGER;
BEGIN
  SELECT id INTO gid FROM portal_guides WHERE guide_key = '${key}';
  IF gid IS NULL THEN
    RAISE NOTICE 'skip ${key}: portal_guides にメタ行なし(0094 を先に適用)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM portal_guide_versions WHERE guide_id = gid) THEN
    RETURN; -- 既に版あり。再適用しない(冪等)。
  END IF;
  INSERT INTO portal_guide_versions (guide_id, version_no, html_source, comment, created_by)
    VALUES (gid, 1, ${tag}${html}${tag}, 'seed ${nextNum} (from services/api/guides)', 'seed')
    RETURNING id INTO vid;
  UPDATE portal_guides
     SET current_version_id = vid, status = 'published', updated_at = now()
   WHERE id = gid;
END
$seed_${key}$;
`);
  used++;
  console.log(`  + ${key} (${(html.length / 1024).toFixed(1)} KB)`);
}

if (used === 0) {
  console.log(`新規 seed 対象なし(既存 ${seededKeys.size} key 済み、skipped ${skipped})。出力なし。`);
  process.exit(0);
}

const header = `-- ${nextNum}_seed_portal_guide_html.sql  (GENERATED — do not edit by hand)
-- 生成: migrations/gen-portal-guide-seed.mjs <- services/api/guides/*.html
-- 未seed の各ガイドの現行版(version 1)を投入し status='published' にする。
-- 既に版があるガイドはスキップ(冪等)。本文の更新は新版追加(sync-guides-to-db.mjs)で。
`;

writeFileSync(outFile, header + "\n" + blocks.join("\n") + "\n", "utf8");
console.log(`\nWrote ${outFile} (${used} new guides, skipped ${skipped} already-seeded).`);
