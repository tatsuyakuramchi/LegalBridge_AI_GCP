/**
 * Phase 22.1 — Backlog ステータス移行スクリプト
 *
 * 目的: Backlog 既存プロジェクトのステータスを Phase 22 仕様の 11 種類に
 *       整理する。既存課題のステータスも対応する新ステータスに一括移行。
 *
 * 動作モード:
 *   $ tsx scripts/backlog_migrate_statuses_v22.ts                  → DRY RUN (デフォルト、何も書き込まない)
 *   $ tsx scripts/backlog_migrate_statuses_v22.ts --apply          → 実際に Backlog を更新
 *   $ tsx scripts/backlog_migrate_statuses_v22.ts --apply --verbose
 *
 * 必須 env (.env or shell):
 *   BACKLOG_HOST         例: xxx.backlog.com
 *   BACKLOG_API_KEY      Backlog の API キー (admin 権限)
 *   BACKLOG_PROJECT_KEY  例: LEGAL
 *
 * 安全策:
 *   - 既定モードは DRY RUN (--apply を付けないと変更が走らない)
 *   - status の DELETE は default status (id 1〜4) には行わない (Backlog 仕様)
 *   - issue 一括移行は backlog の substituteStatusId は使わず、
 *     PATCH /issues/:key を 1 件ずつ叩く (どこで失敗したか分かるように)
 *   - レート制限対策で各 API 呼び出しに 250ms ディレイ
 *
 * Backlog 色パレット (POST /statuses で許可される値):
 *   #ea2c00 #e87758 #e07b9a #868cb7 #3b9dba #4caf93 #b0be3c #eda62a #bf4f51
 */

import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

// ─── env ─────────────────────────────────────────────────────────
const API_KEY = process.env.BACKLOG_API_KEY || "";
const HOST = (process.env.BACKLOG_HOST || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY || "";

const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has("--apply");
const DRY_RUN = !APPLY;
const VERBOSE = ARGS.has("--verbose");

if (!API_KEY || !HOST || !PROJECT_KEY) {
  console.error(
    "❌ Required env: BACKLOG_API_KEY, BACKLOG_HOST, BACKLOG_PROJECT_KEY"
  );
  process.exit(1);
}

const BASE_URL = `https://${HOST}/api/v2`;
const url = (path: string) => `${BASE_URL}${path}?apiKey=${API_KEY}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 仕様 (Phase 22 canonical) ─────────────────────────────────────

/** リネーム: 既存名 → 新名 */
const RENAMES: Array<{ from: string; to: string }> = [
  { from: "未対応", to: "未着手" }, // default id=1
  { from: "処理中", to: "着手中" }, // default id=2
  { from: "相談・交渉中", to: "相手方確認中" },
  { from: "審査中", to: "承認待ち" },
  { from: "クラウドサイン送信待ち", to: "締結準備中" },
  { from: "クラウドサイン確認待ち", to: "締結待ち" },
];

/** 課題一括移行: from の課題を to に付け替える (status 自体は残す or 削除) */
const ISSUE_MIGRATIONS: Array<{
  from: string;
  to: string;
  /** 移行後に from status を削除する? (default 4 status は削除不可) */
  deleteAfter: boolean;
}> = [
  { from: "処理済み", to: "完了", deleteAfter: false }, // default id=3, 削除不可
  { from: "クラウドサイン締結完了", to: "完了", deleteAfter: true },
  { from: "締結済", to: "完了", deleteAfter: true },
  { from: "有効", to: "完了", deleteAfter: true },
  // Phase 1 で 審査中→承認待ち の rename が name 衝突で skip された場合、
  // 課題を 承認待ち に移してから 審査中 status を削除する。
  { from: "審査中", to: "承認待ち", deleteAfter: true },
];

/** 新規追加 */
const ADDITIONS: Array<{ name: string; color: string }> = [
  { name: "トリガー待ち", color: "#868cb7" },
  { name: "送信待ち", color: "#4caf93" },
  { name: "終結", color: "#bf4f51" },
  { name: "差戻し", color: "#bf4f51" },
  { name: "キャンセル", color: "#868cb7" },
];

/** 表示順 (flow 順) */
const TARGET_ORDER = [
  "未着手",
  "着手中",
  "相手方確認中",
  "承認待ち",
  "締結準備中",
  "送信待ち",
  "締結待ち",
  "完了",
  "トリガー待ち",
  "終結",
  "差戻し",
  "キャンセル",
];

// ─── helpers ─────────────────────────────────────────────────────

type BacklogStatus = {
  id: number;
  projectId?: number;
  name: string;
  color?: string;
  displayOrder?: number;
};

async function listStatuses(): Promise<BacklogStatus[]> {
  const res = await axios.get(url(`/projects/${PROJECT_KEY}/statuses`));
  return res.data;
}

async function listIssuesByStatus(
  statusId: number,
  projectId: number
): Promise<Array<{ id: number; issueKey: string }>> {
  const all: Array<{ id: number; issueKey: string }> = [];
  let offset = 0;
  while (true) {
    const res = await axios.get(url(`/issues`), {
      params: {
        "projectId[]": projectId,
        "statusId[]": statusId,
        count: 100,
        offset,
      },
    });
    const rows = (res.data || []) as any[];
    if (rows.length === 0) break;
    all.push(...rows.map((r) => ({ id: r.id, issueKey: r.issueKey })));
    if (rows.length < 100) break;
    offset += 100;
  }
  return all;
}

async function patchIssueStatus(issueKey: string, newStatusId: number) {
  const body = new URLSearchParams();
  body.append("statusId", String(newStatusId));
  await axios.patch(url(`/issues/${issueKey}`), body);
}

async function renameStatus(statusId: number, newName: string) {
  const body = new URLSearchParams();
  body.append("name", newName);
  await axios.patch(url(`/projects/${PROJECT_KEY}/statuses/${statusId}`), body);
}

async function addStatus(name: string, color: string): Promise<BacklogStatus> {
  const body = new URLSearchParams();
  body.append("name", name);
  body.append("color", color);
  const res = await axios.post(
    url(`/projects/${PROJECT_KEY}/statuses`),
    body
  );
  return res.data;
}

async function deleteStatus(
  statusId: number,
  substituteStatusId: number
): Promise<void> {
  await axios.delete(
    url(`/projects/${PROJECT_KEY}/statuses/${statusId}`),
    { data: new URLSearchParams({ substituteStatusId: String(substituteStatusId) }) }
  );
}

async function updateDisplayOrder(orderedIds: number[]) {
  // Backlog: PATCH /projects/:key/statuses/updateDisplayOrder
  // body: statusId[]=1&statusId[]=2 ...
  const body = new URLSearchParams();
  for (const id of orderedIds) body.append("statusId[]", String(id));
  await axios.patch(
    url(`/projects/${PROJECT_KEY}/statuses/updateDisplayOrder`),
    body
  );
}

function log(level: "info" | "warn" | "error" | "verbose", msg: string) {
  if (level === "verbose" && !VERBOSE) return;
  const tag =
    level === "info" ? "ℹ️ " : level === "warn" ? "⚠️ " : level === "error" ? "❌" : "  ";
  console.log(`${tag} ${msg}`);
}

// ─── main ────────────────────────────────────────────────────────

async function main() {
  console.log(
    `🚀 Backlog Status Migration (Phase 22)  ${DRY_RUN ? "[DRY RUN]" : "[APPLY]"}`
  );
  console.log(`   host=${HOST}  project=${PROJECT_KEY}`);
  console.log();

  // ── Project ID ──
  const projectRes = await axios.get(url(`/projects/${PROJECT_KEY}`));
  const projectId = projectRes.data.id as number;
  log("info", `Project ${PROJECT_KEY} resolved → id=${projectId}`);

  // ── Current statuses ──
  let statuses = await listStatuses();
  const byName = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );
  console.log();
  console.log("📋 現在の status 一覧:");
  for (const s of statuses) {
    console.log(
      `   [${String(s.id).padStart(4)}] ${s.name}  ${s.color || ""}`
    );
  }

  // ── Phase 1: Renames ─────────────────────────────────────────────
  console.log();
  console.log("───── Phase 1: RENAME ─────");
  for (const r of RENAMES) {
    const cur = byName.get(r.from);
    if (!cur) {
      log("verbose", `skip rename "${r.from}" → "${r.to}" (元 status なし)`);
      continue;
    }
    // 既に新名で存在する場合はリネームすると衝突する
    if (byName.has(r.to) && byName.get(r.to)!.id !== cur.id) {
      log(
        "warn",
        `skip rename "${r.from}" → "${r.to}" (既に "${r.to}" が存在、ID ${
          byName.get(r.to)!.id
        })。issue migration で対応してください。`
      );
      continue;
    }
    console.log(
      `   RENAME id=${cur.id}  "${r.from}" → "${r.to}"  ${DRY_RUN ? "(dry-run)" : ""}`
    );
    if (!DRY_RUN) {
      await renameStatus(cur.id, r.to);
      await sleep(250);
    }
  }

  // refresh
  if (!DRY_RUN) statuses = await listStatuses();
  const byName2 = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );

  // ── Phase 2: Additions ──────────────────────────────────────────
  console.log();
  console.log("───── Phase 2: ADD ─────");
  for (const a of ADDITIONS) {
    if (byName2.has(a.name)) {
      log("verbose", `skip add "${a.name}" (既存)`);
      continue;
    }
    console.log(
      `   ADD  "${a.name}"  color=${a.color}  ${DRY_RUN ? "(dry-run)" : ""}`
    );
    if (!DRY_RUN) {
      const created = await addStatus(a.name, a.color);
      byName2.set(a.name, created);
      await sleep(250);
    }
  }

  // refresh
  if (!DRY_RUN) statuses = await listStatuses();
  const byName3 = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );

  // ── Phase 3: Issue migrations ────────────────────────────────────
  console.log();
  console.log("───── Phase 3: ISSUE MIGRATIONS ─────");
  for (const m of ISSUE_MIGRATIONS) {
    const fromS = byName3.get(m.from);
    const toS = byName3.get(m.to);
    if (!fromS) {
      log("verbose", `skip migration "${m.from}" → "${m.to}" (元 status なし)`);
      continue;
    }
    if (!toS) {
      log(
        "error",
        `cannot migrate "${m.from}" → "${m.to}" (移行先 status 無し)`
      );
      continue;
    }
    const issues = await listIssuesByStatus(fromS.id, projectId);
    console.log(
      `   MIGRATE "${m.from}" (id=${fromS.id}) → "${m.to}" (id=${toS.id})  issues=${issues.length}  ${
        DRY_RUN ? "(dry-run)" : ""
      }`
    );
    if (!DRY_RUN) {
      let ok = 0,
        fail = 0;
      for (const issue of issues) {
        try {
          await patchIssueStatus(issue.issueKey, toS.id);
          ok++;
          await sleep(250);
        } catch (e: any) {
          fail++;
          log(
            "warn",
            `   ${issue.issueKey}: failed (${e?.response?.status || e?.message})`
          );
        }
      }
      console.log(`   → ok=${ok}  fail=${fail}`);

      // delete source if requested + safe (= not a default status)
      if (m.deleteAfter && fromS.id > 4) {
        console.log(`   DELETE status id=${fromS.id} (substitute=${toS.id})`);
        try {
          await deleteStatus(fromS.id, toS.id);
          await sleep(250);
        } catch (e: any) {
          log(
            "warn",
            `   delete failed (id=${fromS.id}): ${
              e?.response?.status || e?.message
            }`
          );
        }
      } else if (m.deleteAfter) {
        log(
          "warn",
          `   skip delete of "${m.from}" (id=${fromS.id} は default status のため削除不可)`
        );
      }
    }
  }

  // ── Phase 4: Reorder ─────────────────────────────────────────────
  console.log();
  console.log("───── Phase 4: REORDER ─────");
  if (!DRY_RUN) statuses = await listStatuses();
  const byName4 = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );
  const orderedIds: number[] = [];
  for (const name of TARGET_ORDER) {
    const s = byName4.get(name);
    if (s) orderedIds.push(s.id);
  }
  // include any leftover status (e.g., 処理済み が削除できなかった) at the end
  for (const s of statuses) {
    if (!orderedIds.includes(s.id)) orderedIds.push(s.id);
  }
  console.log(
    `   REORDER (${orderedIds.length} statuses)  ${DRY_RUN ? "(dry-run)" : ""}`
  );
  console.log(
    `   ` + orderedIds.map((id) => `${id}:${statuses.find((s) => s.id === id)?.name}`).join(" → ")
  );
  if (!DRY_RUN) {
    await updateDisplayOrder(orderedIds);
    await sleep(250);
  }

  // ── Final state ─────────────────────────────────────────────────
  console.log();
  console.log("✅ Done.");
  if (!DRY_RUN) {
    statuses = await listStatuses();
    console.log();
    console.log("📋 移行後の status 一覧:");
    for (const s of statuses) {
      console.log(
        `   [${String(s.id).padStart(4)}] ${s.name}  ${s.color || ""}`
      );
    }
  } else {
    console.log();
    console.log("💡 これは DRY RUN です。実際に変更するには --apply を付けて再実行してください。");
    console.log("   tsx scripts/backlog_migrate_statuses_v22.ts --apply");
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:");
  console.error(err?.response?.data || err);
  process.exit(1);
});
