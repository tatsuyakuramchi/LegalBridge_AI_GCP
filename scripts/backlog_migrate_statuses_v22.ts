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

/** リネーム: 既存名 → 新名
 *  default status (id 1=未対応, 2=処理中) は API で変更不可なため、
 *  意味も通じるのでそのまま残す方針。canonical 名としても「未対応」「処理中」
 *  を採用 (src/lib/statusFlow.ts と同期)。
 */
const RENAMES: Array<{ from: string; to: string }> = [
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

/**
 * 新規追加。
 * Backlog 1 プロジェクトあたり 12 ステータスが上限のため、4 つに絞る。
 * 「差戻し」は別ステータスを設けず、「未対応」に戻す + コメント等で運用代替。
 *
 * 色は Backlog API が受け入れるパレットからのみ選択。実環境の検証で
 * 確認済の色: #ea2c00, #e87758, #868cb7, #3b9dba, #4caf93, #b0be3c, #eda62a
 * (#bf4f51 は API レスポンスでは見るが POST 時にエラーになる)
 */
const ADDITIONS: Array<{ name: string; color: string }> = [
  { name: "トリガー待ち", color: "#868cb7" },
  { name: "送信待ち", color: "#4caf93" },
  { name: "終結", color: "#ea2c00" },
  { name: "キャンセル", color: "#868cb7" },
];

/**
 * 表示順 (flow 順)。
 *
 * 重要: Backlog の仕様で「Closed」タイプの status (= default id=4 完了) は
 * 表示順の最後でなければならない。"Update order failed. Last status id
 * must be Closed" エラーを避けるため、完了 を末尾に置く。
 *
 * トリガー待ち は受動文書 (検収書 / 利用許諾料計算書) の pre-initial で、
 * 「未対応」より前のステージなので先頭に置く。
 */
const TARGET_ORDER = [
  "トリガー待ち",
  "未対応",
  "処理中",
  "相手方確認中",
  "承認待ち",
  "締結準備中",
  "送信待ち",
  "締結待ち",
  "終結",
  "キャンセル",
  "完了", // ← MUST be last (Closed type)
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

/**
 * default status (id 1〜4) は API でリネーム不可。Backlog スペース設定の
 * 「状態管理」から手動でリネームする必要がある。
 */
function isDefaultStatus(statusId: number): boolean {
  return statusId >= 1 && statusId <= 4;
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
  const manualRenames: Array<{ from: string; to: string; id: number }> = [];
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
    // default status (id 1〜4) は API で直接リネーム不可
    if (isDefaultStatus(cur.id)) {
      log(
        "warn",
        `skip rename "${r.from}" → "${r.to}" (id=${cur.id} は default status、` +
          `API でリネーム不可)。Backlog スペース設定の状態管理から手動で変更してください。`
      );
      manualRenames.push({ from: r.from, to: r.to, id: cur.id });
      continue;
    }
    console.log(
      `   RENAME id=${cur.id}  "${r.from}" → "${r.to}"  ${DRY_RUN ? "(dry-run)" : ""}`
    );
    if (!DRY_RUN) {
      try {
        await renameStatus(cur.id, r.to);
        await sleep(250);
      } catch (e: any) {
        log(
          "warn",
          `   rename failed (id=${cur.id} "${r.from}" → "${r.to}"): ${
            e?.response?.data?.errors?.[0]?.message ||
            e?.response?.status ||
            e?.message
          }`
        );
      }
    }
  }

  // refresh
  if (!DRY_RUN) statuses = await listStatuses();
  const byName2 = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );

  // ── Phase 2: Issue migrations + delete unused statuses ──────────
  //   Phase 順序の変更理由: Backlog は 1 プロジェクト 12 ステータス上限。
  //   ADD を先にやると ((12 + ADDITIONS.length) > 12) で失敗する。
  //   MIGRATIONS+DELETES で空きを作ってから ADD する順序にする。
  console.log();
  console.log("───── Phase 2: ISSUE MIGRATIONS ─────");
  for (const m of ISSUE_MIGRATIONS) {
    const fromS = byName2.get(m.from);
    const toS = byName2.get(m.to);
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

  // refresh after migrations + deletes
  if (!DRY_RUN) statuses = await listStatuses();
  const byName3 = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );

  // ── Phase 3: Additions (after migrations to free up slots) ──────
  console.log();
  console.log("───── Phase 3: ADD ─────");
  for (const a of ADDITIONS) {
    if (byName3.has(a.name)) {
      log("verbose", `skip add "${a.name}" (既存)`);
      continue;
    }
    console.log(
      `   ADD  "${a.name}"  color=${a.color}  ${DRY_RUN ? "(dry-run)" : ""}`
    );
    if (!DRY_RUN) {
      try {
        const created = await addStatus(a.name, a.color);
        byName3.set(a.name, created);
        await sleep(250);
      } catch (e: any) {
        log(
          "warn",
          `   add failed ("${a.name}"): ${
            e?.response?.data?.errors?.[0]?.message ||
            e?.response?.status ||
            e?.message
          }`
        );
      }
    }
  }

  // ── Phase 4: Reorder ─────────────────────────────────────────────
  // Backlog 仕様: Closed タイプ (= default 完了 / id=4) は必ず末尾に置く。
  // TARGET_ORDER の末尾を "完了" にし、それ以外のリストアップ漏れ status
  // (= 処理済み 等の default residue) は "完了" の手前に挿入する。
  console.log();
  console.log("───── Phase 4: REORDER ─────");
  if (!DRY_RUN) statuses = await listStatuses();
  const byName4 = new Map<string, BacklogStatus>(
    statuses.map((s) => [s.name, s])
  );
  const orderedIdsHead: number[] = []; // 完了 より前
  let closedId: number | null = null;
  for (const name of TARGET_ORDER) {
    const s = byName4.get(name);
    if (!s) continue;
    if (name === "完了") {
      closedId = s.id;
    } else {
      orderedIdsHead.push(s.id);
    }
  }
  // 漏れた status (= 処理済み 等) は 完了 の手前に追加
  for (const s of statuses) {
    if (orderedIdsHead.includes(s.id)) continue;
    if (closedId != null && s.id === closedId) continue;
    orderedIdsHead.push(s.id);
  }
  const orderedIds: number[] = [...orderedIdsHead];
  if (closedId != null) orderedIds.push(closedId);
  else {
    log("error", "完了 status (id=4) が見つかりません。reorder をスキップします。");
  }
  console.log(
    `   REORDER (${orderedIds.length} statuses)  ${DRY_RUN ? "(dry-run)" : ""}`
  );
  console.log(
    `   ` + orderedIds.map((id) => `${id}:${statuses.find((s) => s.id === id)?.name}`).join(" → ")
  );
  if (!DRY_RUN && closedId != null) {
    try {
      await updateDisplayOrder(orderedIds);
      await sleep(250);
    } catch (e: any) {
      log(
        "warn",
        `   reorder failed: ${
          e?.response?.data?.errors?.[0]?.message ||
          e?.response?.status ||
          e?.message
        }`
      );
    }
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

  // ── Manual action summary ───────────────────────────────────────
  if (manualRenames.length > 0) {
    console.log();
    console.log("═══════════════════════════════════════════════════");
    console.log("⚠️  手動操作が必要な項目があります");
    console.log("═══════════════════════════════════════════════════");
    console.log();
    console.log("Backlog の default status (id 1〜4) は API でリネーム不可です。");
    console.log("スペース管理者として Backlog にログインし、以下の手順で手動変更してください:");
    console.log();
    console.log("  1. Backlog にログイン → 右上の歯車 → スペース設定");
    console.log("  2. 「状態管理」を選択");
    console.log("  3. 以下のステータスを編集:");
    console.log();
    for (const m of manualRenames) {
      console.log(`     • id=${m.id}: 「${m.from}」 → 「${m.to}」 にリネーム`);
    }
    console.log();
    console.log("  4. 保存");
    console.log();
    console.log("(注: スペース設定の変更は全プロジェクトに影響します。");
    console.log(" 他プロジェクトでこれらの名前を使っている場合は事前に確認してください)");
    console.log();
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:");
  console.error(err?.response?.data || err);
  process.exit(1);
});
