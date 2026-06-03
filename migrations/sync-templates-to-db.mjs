// migrations/sync-templates-to-db.mjs
//
// 現行のテンプレファイルを DB(document_templates / document_template_versions)へ同期する。
// worker は TEMPLATE_SOURCE=db のとき DB のテンプレ(current_version の html_source)を使うため、
// テンプレ(*.html / partials / templates_config.json)を編集したら本スクリプトで DB を更新する。
//   ※ seed(0003)は ON CONFLICT DO NOTHING で既存版を更新しないため、編集が反映されない。
//
// 変更があったテンプレだけ「新しい version」を作成し current_version_id を貼り替える(履歴保持・冪等)。
//
//   実行(pg がある migrations/ から):
//     cd ~/LegalBridge_AI_GCP/migrations
//     DATABASE_URL="postgresql://postgres:****@127.0.0.1:5432/legalbridge" node sync-templates-to-db.mjs
//   実行後、worker を再起動(リロード)すると反映される(下記 README 参照)。

import pg from "pg";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const configPath = path.join(root, "templates_config.json");
const tplDir = path.join(root, "services/worker/templates");
const partialsDir = path.join(tplDir, "partials");

const config = JSON.parse(readFileSync(configPath, "utf8"));
const fieldSchema = (vars) =>
  !vars || typeof vars !== "object"
    ? []
    : Object.keys(vars).map((name) => ({ name, ...vars[name] }));

// 同期対象(document テンプレ + partials)を集める。
const targets = [];
for (const key of Object.keys(config)) {
  const htmlPath = path.join(tplDir, `${key}.html`);
  if (!existsSync(htmlPath)) continue;
  targets.push({
    key,
    kind: "document",
    label: config[key].label ?? null,
    category: config[key].category ?? null,
    comment: config[key]._comment ?? null,
    html: readFileSync(htmlPath, "utf8"),
    schema: fieldSchema(config[key].vars),
  });
}
if (existsSync(partialsDir)) {
  for (const f of readdirSync(partialsDir).filter((f) => f.endsWith(".html"))) {
    const key = f.replace(/\.html$/, "");
    targets.push({
      key,
      kind: "partial",
      label: key,
      category: "partial",
      comment: null,
      html: readFileSync(path.join(partialsDir, f), "utf8"),
      schema: [],
    });
  }
}

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
    unchanged = 0;
  for (const t of targets) {
    const head = await client.query(
      `INSERT INTO document_templates (template_key, kind, label, category, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (template_key) DO UPDATE
         SET label=EXCLUDED.label, category=EXCLUDED.category,
             comment=EXCLUDED.comment, kind=EXCLUDED.kind, updated_at=now()
       RETURNING id, current_version_id`,
      [t.key, t.kind, t.label, t.category, t.comment]
    );
    const templateId = head.rows[0].id;
    const curVerId = head.rows[0].current_version_id;

    let curHtml = null;
    if (curVerId) {
      const cv = await client.query(
        `SELECT html_source FROM document_template_versions WHERE id=$1`,
        [curVerId]
      );
      curHtml = cv.rows[0]?.html_source ?? null;
    }
    if (curHtml === t.html) {
      unchanged++;
      continue;
    }
    const mv = await client.query(
      `SELECT COALESCE(MAX(version_no),0) AS m FROM document_template_versions WHERE template_id=$1`,
      [templateId]
    );
    const nextVer = Number(mv.rows[0].m) + 1;
    const ins = await client.query(
      `INSERT INTO document_template_versions
         (template_id, version_no, html_source, field_schema, comment, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
      [templateId, nextVer, t.html, JSON.stringify(t.schema), "sync from file", "sync-templates"]
    );
    await client.query(
      `UPDATE document_templates SET current_version_id=$1, updated_at=now() WHERE id=$2`,
      [ins.rows[0].id, templateId]
    );
    if (curVerId) updated++;
    else created++;
    console.log(`  synced ${t.kind} ${t.key} -> v${nextVer}`);
  }
  console.log(
    `Done. updated=${updated}, created=${created}, unchanged=${unchanged} (total ${targets.length}).`
  );
  console.log("※ worker は起動時に DB テンプレを読むため、反映には worker の再起動が必要です。");
  await client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
