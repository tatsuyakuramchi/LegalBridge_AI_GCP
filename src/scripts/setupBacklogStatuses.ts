/**
 * setupBacklogStatuses.ts
 * 実行: npx tsx src/scripts/setupBacklogStatuses.ts
 *
 * 1. Backlogプロジェクトにカスタムステータスを一括作成
 * 2. 作成結果をもとに workflow_settings の INSERT SQL を自動生成
 * 3. DBへの直接反映も実行（BACKLOG_DB_URL が設定されている場合）
 */

import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const TOKEN       = process.env.BACKLOG_API_KEY   || "";
const HOST        = (process.env.BACKLOG_HOST      || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY || "";
const BASE        = `https://${HOST}/api/v2`;

if (!TOKEN || !HOST || !PROJECT_KEY) {
  console.error("BACKLOG_HOST / BACKLOG_API_KEY / BACKLOG_PROJECT_KEY が未設定です");
  process.exit(1);
}

const url = (path: string) => `${BASE}${path}?apiKey=${TOKEN}`;

// ─────────────────────────────────────────────────────────
// 作成するカスタムステータス定義
// color は Backlog が受け付ける値のみ:
//   #e30000 #934981 #814fbc #2779ca #007e9a #7ea800 #ff9200 #ff3265 #13c2c2
// ─────────────────────────────────────────────────────────
const STATUSES = [
  // 契約系
  { name: "相談・交渉中",               color: "#2779ca" },
  { name: "審査中",                     color: "#2779ca" },
  { name: "承認待ち",                   color: "#ff9200" },
  // クラウドサイン
  { name: "クラウドサイン送信待ち",      color: "#007e9a" },
  { name: "クラウドサイン確認待ち",      color: "#007e9a" },
  { name: "クラウドサイン締結完了",      color: "#7ea800" },
  // 締結後
  { name: "締結済",                     color: "#7ea800" },
  { name: "有効",                       color: "#7ea800" },
  { name: "変更・更新",                  color: "#ff9200" },
  { name: "失効",                       color: "#934981" },
  { name: "終了",                       color: "#934981" },
  // 発注・納品系
  { name: "起票",                       color: "#2779ca" },
  { name: "発注済",                     color: "#2779ca" },
  { name: "納品待ち",                   color: "#ff9200" },
  { name: "納品依頼",                   color: "#ff9200" },
  { name: "検収中",                     color: "#ff9200" },
  { name: "支払待ち",                   color: "#814fbc" },
  // ライセンス製造系
  { name: "製造依頼",                   color: "#2779ca" },
  { name: "計算中",                     color: "#ff9200" },
  { name: "請求済",                     color: "#814fbc" },
  { name: "支払済",                     color: "#7ea800" },
  // 完了（共通）
  { name: "完了",                       color: "#13c2c2" },
] as const;

// ─────────────────────────────────────────────────────────
// 課題種別ごとのステータスフロー定義
// ─────────────────────────────────────────────────────────
const WORKFLOWS: Record<string, { statuses: string[]; final: string; prefix: string }> = {
  license_master: {
    statuses: ["相談・交渉中","クラウドサイン送信待ち","クラウドサイン確認待ち","クラウドサイン締結完了","有効","変更・更新","終了"],
    final: "終了", prefix: "LIC",
  },
  individual_license_terms: {
    statuses: ["相談・交渉中","クラウドサイン送信待ち","クラウドサイン確認待ち","クラウドサイン締結完了","有効","終了"],
    final: "終了", prefix: "ILT",
  },
  manufacturing: {
    statuses: ["製造依頼","計算中","請求済","支払済"],
    final: "支払済", prefix: "ROY",
  },
  outsourcing: {
    statuses: ["相談・交渉中","クラウドサイン送信待ち","クラウドサイン確認待ち","クラウドサイン締結完了","有効","終了"],
    final: "終了", prefix: "OUT",
  },
  purchase_order: {
    statuses: ["起票","発注済","納品待ち","検収中","支払待ち","完了"],
    final: "完了", prefix: "PO",
  },
  delivery_inspection: {
    statuses: ["納品依頼","検収中","完了"],
    final: "完了", prefix: "INS",
  },
  payment: {
    statuses: ["支払待ち","支払済"],
    final: "支払済", prefix: "PAY",
  },
  sales_master: {
    statuses: ["相談・交渉中","クラウドサイン送信待ち","クラウドサイン確認待ち","クラウドサイン締結完了","有効","変更・更新","終了"],
    final: "終了", prefix: "SAL",
  },
  legal_consultation: {
    statuses: ["相談・交渉中","審査中","承認待ち","完了"],
    final: "完了", prefix: "REQ",
  },
  nda: {
    statuses: ["相談・交渉中","審査中","クラウドサイン送信待ち","クラウドサイン確認待ち","クラウドサイン締結完了","有効","失効"],
    final: "失効", prefix: "NDA",
  },
};

// ─────────────────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Backlog ステータスセットアップ開始: ${PROJECT_KEY} @ ${HOST}\n`);

  // 既存ステータスを取得
  const existingRes = await axios.get(url(`/projects/${PROJECT_KEY}/statuses`));
  const existingMap: Record<string, number> = {};
  for (const s of existingRes.data) existingMap[s.name] = s.id;
  console.log(`既存ステータス: ${Object.keys(existingMap).join(", ")}\n`);

  // ステータスを作成
  console.log("📋 カスタムステータスを作成中...");
  const statusMap: Record<string, number> = { ...existingMap };

  for (const s of STATUSES) {
    if (existingMap[s.name]) {
      console.log(`  スキップ（既存）: ${s.name} [${existingMap[s.name]}]`);
      continue;
    }
    try {
      const body = new URLSearchParams();
      body.append("name",  s.name);
      body.append("color", s.color);
      const res = await axios.post(url(`/projects/${PROJECT_KEY}/statuses`), body);
      statusMap[s.name] = res.data.id;
      console.log(`  ✅ 作成: ${s.name} [ID:${res.data.id}]`);
    } catch (e: any) {
      const msg = e.response?.data?.errors?.[0]?.message || e.message;
      console.error(`  ❌ 失敗: ${s.name} — ${msg}`);
    }
  }

  // workflow_settings INSERT SQL を生成
  console.log("\n\n─────────────────────────────────────────");
  console.log("📄 workflow_settings INSERT SQL:");
  console.log("─────────────────────────────────────────\n");

  const sqlLines: string[] = [];

  for (const [issueType, wf] of Object.entries(WORKFLOWS)) {
    const statusConfigs: Record<string, any> = {};
    let allFound = true;

    wf.statuses.forEach((name, i) => {
      const id = statusMap[name];
      if (!id) { console.warn(`  ⚠️  ステータスIDが見つかりません: ${name}`); allFound = false; return; }
      statusConfigs[name] = {
        order:             i + 1,
        backlogStatusId:   id,
        ...(name === wf.final ? { auto_advance: true } : {}),
        ...(name.startsWith("クラウドサイン") ? { type: "cloudsign" } : {}),
      };
    });

    const configJson = JSON.stringify(statusConfigs).replace(/'/g, "''");
    const sql =
      `INSERT INTO workflow_settings (issue_type_name, status_configs, document_prefix)\n` +
      `VALUES ('${issueType}', '${configJson}', '${wf.prefix}')\n` +
      `ON CONFLICT (issue_type_name) DO UPDATE SET\n` +
      `  status_configs = EXCLUDED.status_configs,\n` +
      `  document_prefix = EXCLUDED.document_prefix;\n`;

    sqlLines.push(`-- ${issueType}${allFound ? "" : " ⚠️ 一部IDなし"}`);
    sqlLines.push(sql);
  }

  const fullSql = sqlLines.join("\n");
  console.log(fullSql);

  // SQLファイルとして保存
  const { writeFileSync } = await import("fs");
  const outPath = "setup_workflow_settings.sql";
  writeFileSync(outPath, fullSql, "utf-8");
  console.log(`\n✅ SQLを ${outPath} に保存しました`);

  // APIエンドポイント経由でDBに直接反映
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const workflowPayload = Object.entries(WORKFLOWS).map(([issueType, wf]) => {
    const statusConfigs: Record<string, any> = {};
    wf.statuses.forEach((name, i) => {
      const id = statusMap[name];
      if (!id) return;
      statusConfigs[name] = {
        order: i + 1,
        backlogStatusId: id,
        ...(name === wf.final ? { auto_advance: true } : {}),
        ...(name.startsWith("クラウドサイン") ? { type: "cloudsign" } : {}),
      };
    });
    return { issue_type_name: issueType, status_configs: statusConfigs, document_prefix: wf.prefix };
  });

  try {
    const res = await axios.post(`${appUrl}/api/admin/setup-workflow-settings`, { workflows: workflowPayload });
    console.log(`\n✅ workflow_settings をDBに反映しました: ${res.data.updated?.join(", ")}`);
  } catch (e: any) {
    console.warn(`\n⚠️  DB反映をスキップ（アプリが起動していない可能性）: ${e.message}`);
    console.log("   アプリ起動後に以下を実行してください:");
    console.log(`   curl -X POST ${appUrl}/api/admin/setup-workflow-settings \\`);
    console.log(`     -H 'Content-Type: application/json' \\`);
    console.log(`     -d '{"workflows":${JSON.stringify(workflowPayload)}}'`);
  }
  console.log("\n✅ セットアップ完了\n");
}

main().catch(e => { console.error(e); process.exit(1); });
