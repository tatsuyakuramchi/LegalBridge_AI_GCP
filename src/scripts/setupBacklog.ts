/**
 * setupBacklog.ts
 * 実行: npx tsx src/scripts/setupBacklog.ts
 *
 * Backlogプロジェクトに対して以下を一括作成する
 *  1. 課題種別 (Issue Types) × 10
 *  2. カスタム属性 (Custom Fields) × 9
 *  3. 作成結果を .env 形式で標準出力 → .env にコピーして使う
 */

import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const HOST = (process.env.BACKLOG_HOST || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const API_KEY = process.env.BACKLOG_API_KEY || "";
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY || "";
const BASE = `https://${HOST}/api/v2`;

if (!HOST || !API_KEY || !PROJECT_KEY) {
  console.error("BACKLOG_HOST / BACKLOG_API_KEY / BACKLOG_PROJECT_KEY が未設定です");
  process.exit(1);
}

const url = (path: string) => `${BASE}${path}?apiKey=${API_KEY}`;

// ─────────────────────────────────────────────
// 1. 課題種別定義
// ─────────────────────────────────────────────
const ISSUE_TYPES = [
  { name: "ライセンス基本契約",          key: "license_master",           color: "#e30000" },
  { name: "個別利用許諾条件",            key: "individual_license_terms",  color: "#e30000" },
  { name: "製造イベント / ロイヤリティ計算", key: "manufacturing",           color: "#e30000" },
  { name: "業務委託基本契約",            key: "outsourcing",               color: "#934981" },
  { name: "発注書 / 企画発注書",         key: "purchase_order",            color: "#934981" },
  { name: "納品 / 検収書",              key: "delivery_inspection",        color: "#934981" },
  { name: "支払通知 / 報酬明細書",       key: "payment",                   color: "#934981" },
  { name: "売買基本契約",               key: "sales_master",               color: "#f42858" },
  { name: "法務相談",                   key: "legal_consultation",         color: "#3b9ddd" },
  { name: "NDA（秘密保持契約）",        key: "nda",                        color: "#3b9ddd" },
] as const;

// ─────────────────────────────────────────────
// 2. カスタム属性定義
//    typeId: 1=テキスト 2=文章 3=数値 4=日付 5=リスト
// ─────────────────────────────────────────────
const CUSTOM_FIELDS = [
  { name: "相手方名称",       typeId: 1, envKey: "BACKLOG_FIELD_COUNTERPARTY",       description: "契約・取引相手の企業名または個人名" },
  { name: "契約日",          typeId: 4, envKey: "BACKLOG_FIELD_CONTRACT_DATE",       description: "契約締結日" },
  { name: "契約期間終了日",   typeId: 4, envKey: "BACKLOG_FIELD_CONTRACT_END_DATE",  description: "契約の満了日" },
  { name: "最終納期",        typeId: 4, envKey: "BACKLOG_FIELD_DEADLINE",            description: "成果物・商品の最終納品期限" },
  { name: "契約番号",        typeId: 1, envKey: "BACKLOG_FIELD_CONTRACT_NO",         description: "社内採番された契約番号" },
  { name: "原著作物名",      typeId: 1, envKey: "BACKLOG_FIELD_ORIGINAL_WORK",       description: "ライセンス対象となる原著作物の名称" },
  { name: "料率",            typeId: 1, envKey: "BACKLOG_FIELD_ROYALTY_RATE",        description: "ロイヤリティ料率（例: 5%）" },
  { name: "支払条件",        typeId: 1, envKey: "BACKLOG_FIELD_PAYMENT_TERMS",       description: "支払方法・サイクル（例: 月末締め翌月払い）" },
  { name: "備考",            typeId: 2, envKey: "BACKLOG_FIELD_REMARKS",             description: "補足情報・特記事項" },
] as const;

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────
async function getProjectId(): Promise<number> {
  const res = await axios.get(url(`/projects/${PROJECT_KEY}`));
  return res.data.id;
}

async function getExistingIssueTypes(projectId: number): Promise<Record<string, number>> {
  const res = await axios.get(url(`/projects/${PROJECT_KEY}/issueTypes`));
  const map: Record<string, number> = {};
  for (const t of res.data) map[t.name] = t.id;
  return map;
}

async function getExistingCustomFields(projectId: number): Promise<Record<string, number>> {
  const res = await axios.get(url(`/projects/${PROJECT_KEY}/customFields`));
  const map: Record<string, number> = {};
  for (const f of res.data) map[f.name] = f.id;
  return map;
}

// ─────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Backlog セットアップ開始: ${PROJECT_KEY} @ ${HOST}\n`);

  const projectId = await getProjectId();
  console.log(`✅ プロジェクトID: ${projectId}`);

  // ── 課題種別 ──────────────────────────────
  console.log("\n📋 課題種別を作成中...");
  const existingTypes = await getExistingIssueTypes(projectId);
  const typeResults: Record<string, number> = { ...existingTypes };

  for (const t of ISSUE_TYPES) {
    if (existingTypes[t.name]) {
      console.log(`  スキップ（既存）: ${t.name} [${existingTypes[t.name]}]`);
      continue;
    }
    try {
      const body = new URLSearchParams();
      body.append("name", t.name);
      body.append("color", t.color);
      const res = await axios.post(url(`/projects/${PROJECT_KEY}/issueTypes`), body);
      typeResults[t.name] = res.data.id;
      console.log(`  ✅ 作成: ${t.name} [ID:${res.data.id}]`);
    } catch (e: any) {
      console.error(`  ❌ 失敗: ${t.name} — ${e.response?.data?.errors?.[0]?.message || e.message}`);
    }
  }

  // ── カスタム属性 ──────────────────────────
  console.log("\n🗂  カスタム属性を作成中...");
  const existingFields = await getExistingCustomFields(projectId);
  const fieldResults: Record<string, number> = {};

  for (const f of CUSTOM_FIELDS) {
    if (existingFields[f.name]) {
      fieldResults[f.envKey] = existingFields[f.name];
      console.log(`  スキップ（既存）: ${f.name} [${existingFields[f.name]}]`);
      continue;
    }
    try {
      const body = new URLSearchParams();
      body.append("typeId", String(f.typeId));
      body.append("name", f.name);
      body.append("description", f.description);
      // 全課題種別に適用（applicableIssueTypes を指定しない = 全適用）
      const res = await axios.post(url(`/projects/${PROJECT_KEY}/customFields`), body);
      fieldResults[f.envKey] = res.data.id;
      console.log(`  ✅ 作成: ${f.name} [ID:${res.data.id}]`);
    } catch (e: any) {
      console.error(`  ❌ 失敗: ${f.name} — ${e.response?.data?.errors?.[0]?.message || e.message}`);
    }
  }

  // ── 課題種別IDマップ（envKey用） ──────────
  const typeEnvMap: Record<string, string> = {
    "ライセンス基本契約":             "BACKLOG_ISSUE_TYPE_LICENSE_MASTER",
    "個別利用許諾条件":               "BACKLOG_ISSUE_TYPE_INDIVIDUAL_LICENSE",
    "製造イベント / ロイヤリティ計算": "BACKLOG_ISSUE_TYPE_MANUFACTURING",
    "業務委託基本契約":               "BACKLOG_ISSUE_TYPE_OUTSOURCING",
    "発注書 / 企画発注書":            "BACKLOG_ISSUE_TYPE_PURCHASE_ORDER",
    "納品 / 検収書":                  "BACKLOG_ISSUE_TYPE_DELIVERY",
    "支払通知 / 報酬明細書":          "BACKLOG_ISSUE_TYPE_PAYMENT",
    "売買基本契約":                   "BACKLOG_ISSUE_TYPE_SALES_MASTER",
    "法務相談":                       "BACKLOG_ISSUE_TYPE_LEGAL_CONSULTATION",
    "NDA（秘密保持契約）":            "BACKLOG_ISSUE_TYPE_NDA",
  };

  // ── .env 出力 ─────────────────────────────
  console.log("\n\n─────────────────────────────────────────");
  console.log("📄 以下を .env に追記してください:");
  console.log("─────────────────────────────────────────");

  console.log("\n# Backlog 課題種別 ID");
  for (const [name, envKey] of Object.entries(typeEnvMap)) {
    const id = typeResults[name];
    if (id) console.log(`${envKey}=${id}`);
  }

  console.log("\n# Backlog カスタム属性 ID");
  for (const f of CUSTOM_FIELDS) {
    const id = fieldResults[f.envKey];
    if (id) console.log(`${f.envKey}=${id}`);
  }

  console.log("\n─────────────────────────────────────────\n");
  console.log("✅ セットアップ完了\n");
}

main().catch(e => { console.error(e); process.exit(1); });
