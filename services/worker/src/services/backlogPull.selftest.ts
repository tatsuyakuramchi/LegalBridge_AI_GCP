/**
 * backlogPull の自己テスト（手動実行）。
 *   実 DB（migration 0154 適用済み）に対して、Backlog API を模した fetchIssues で取得ジョブを回し、
 *   突き合わせ・スナップショット更新・履歴・watermark・同時実行・失敗時の挙動を検証する。
 *   テストデータは BEGIN 済みの専用接続で作り、最後に ROLLBACK するので DB を汚さない。
 *
 *   DATABASE_URL=postgres://... npx tsx src/services/backlogPull.selftest.ts
 *
 * 正式なテストランナーは無いため assert + プロセス終了コードで表現。
 */
import assert from "node:assert";
import pg from "pg";
import { runBacklogPull, jstDate, toSnapshot, OVERLAP_MS, PAGE_SIZE } from "./backlogPull.ts";

const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error("DATABASE_URL を指定してください（migration 0154 適用済みの DB）");
  process.exit(2);
}

const issue = (id: number, key: string, status: string, updated: string, extra: any = {}) => ({
  id,
  issueKey: key,
  summary: `summary ${key}`,
  description: "<@U04YAMAMOTO>\n本文",
  issueType: { name: "契約審査" },
  status: { name: status },
  createdUser: { id: 1, name: "山本 さくら" },
  updatedUser: { id: 2, name: "高橋 健" },
  customFields: [{ id: 10, name: "取引先名称", value: "株式会社ノースライト" }, { id: 11, name: "依頼種別", value: { id: 3, name: "発注書" } }],
  created: "2026-09-25T00:31:00Z",
  updated,
  ...extra,
});

async function main() {
  const client = new pg.Client({ connectionString: conn, ssl: conn!.includes("localhost") ? false : { rejectUnauthorized: false } });
  await client.connect();
  await client.query("BEGIN");
  // 本番は自動コミットの pool なので、エラーを返したクエリで後続が止まらないよう
  //   テストでもクエリごとにセーブポイントを張って同じ振る舞いにする（一意制約違反の検証用）。
  const query = async (text: string, params?: any[]) => {
    await client.query("SAVEPOINT q");
    try {
      const r = await client.query(text, params);
      await client.query("RELEASE SAVEPOINT q");
      return r;
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT q");
      throw e;
    }
  };

  try {
    // 取得ログを空に（トランザクション内）。
    await query("DELETE FROM backlog_pull_runs");
    await query(
      `INSERT INTO legal_requests (backlog_issue_key, contract_type, summary)
       VALUES ('ZZT-1', 'purchase_order', 'A'), ('ZZT-2', 'nda', 'B'), ('ZZT-9', 'nda', 'Backlog に無い')`
    );

    // ── 純関数
    assert.equal(jstDate(new Date("2026-09-24T16:00:00Z")), "2026-09-25", "JST の日付に変換する");
    const snap = toSnapshot(issue(1, "ZZT-1", "未対応", "2026-09-25T01:00:00Z"));
    assert.deepEqual(snap.customFields[1], { id: 11, name: "依頼種別", value: "発注書" }, "選択型の値は名前にする");

    // ── 1回目（初回）: 2件突き合わせ・1件未登録
    const calls: any[] = [];
    let backlog = [
      issue(101, "ZZT-1", "未対応", "2026-09-25T01:00:00Z"),
      issue(102, "ZZT-2", "未対応", "2026-09-25T01:05:00Z"),
      issue(103, "ZZT-3", "未対応", "2026-09-25T01:10:00Z"),
    ];
    const fetchIssues = async (p: any) => {
      calls.push(p);
      return backlog.slice(p.offset, p.offset + p.count);
    };
    const now = () => new Date("2026-09-25T01:30:00Z");
    const r1 = await runBacklogPull({ query, fetchIssues, projectKey: "ZZT", now }, { trigger: "manual", startedBy: "test" });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.equal(r1.fetched, 3);
    assert.equal(r1.matched, 2);
    assert.equal(r1.updated, 2);
    assert.equal(r1.unmatched, 1);
    assert.equal(r1.watermark, "2026-09-25T01:10:00.000Z", "watermark は見た課題の最大 updated");
    assert.equal(calls[0].updatedSince, "2026-09-23", "初回は 24 時間前（JST 09/24 10:30）のさらに 1 日前の日付から");
    assert.equal(calls[0].sort, "updated");
    const row1 = (await query(`SELECT * FROM legal_requests WHERE backlog_issue_key='ZZT-1'`)).rows[0];
    assert.equal(Number(row1.backlog_issue_id), 101);
    assert.equal(row1.backlog_status_name, "未対応");
    assert.equal(row1.backlog_snapshot.summary, "summary ZZT-1");
    assert.equal(row1.inbox_state, "accepted", "R1 は受付状態を変えない");
    const run1 = (await query(`SELECT * FROM backlog_pull_runs WHERE id=$1`, [r1.run_id])).rows[0];
    assert.equal(run1.detail.unmatched[0].key, "ZZT-3", "未登録の課題を取得ログに残す");
    assert.equal((await query(`SELECT count(*)::int n FROM legal_requests WHERE backlog_issue_key='ZZT-3'`)).rows[0].n, 0, "R1 は行を作らない");
    assert.equal((await query(`SELECT count(*)::int n FROM request_events WHERE request_id=$1`, [row1.id])).rows[0].n, 0, "初回取得は履歴に残さない");

    // ── 2回目: watermark−5分から。ZZT-1 のステータス変更、ZZT-2 は重なり幅で再取得されるが変化なし
    //   範囲より前の課題（00:59 更新）は数えない
    calls.length = 0;
    backlog = [
      issue(104, "ZZT-4", "未対応", "2026-09-25T00:59:00Z"),
      issue(102, "ZZT-2", "未対応", "2026-09-25T01:05:00Z"),
      issue(101, "ZZT-1", "処理中", "2026-09-25T02:00:00Z"),
    ];
    const r2 = await runBacklogPull({ query, fetchIssues, projectKey: "ZZT", now }, { trigger: "scheduled" });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.updated_since, new Date(Date.parse("2026-09-25T01:10:00Z") - OVERLAP_MS).toISOString());
    assert.equal(r2.fetched, 2, "重なり幅（5分）に入る ZZT-2 も取り直す");
    assert.equal(r2.matched, 2);
    assert.equal(r2.updated, 1, "ZZT-2 は updated が同じなので更新しない");
    const ev = (await query(`SELECT * FROM request_events WHERE request_id=$1`, [row1.id])).rows;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].kind, "backlog_changed");
    assert.deepEqual([ev[0].detail.from, ev[0].detail.to, ev[0].detail.by], ["未対応", "処理中", "高橋 健"]);

    // ── 3回目: 同じ updated は unchanged（スナップショット更新なし）
    const r3 = await runBacklogPull({ query, fetchIssues, projectKey: "ZZT", now }, { trigger: "scheduled" });
    assert.equal(r3.matched, 1, "watermark 02:00 − 5分以降は ZZT-1 だけ");
    assert.equal(r3.updated, 0);

    // ── ページング: 100件ちょうど + 1件 → 2ページ目まで読む
    calls.length = 0;
    backlog = Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
      issue(1000 + i, `ZZX-${i}`, "未対応", new Date(Date.parse("2026-09-25T03:00:00Z") + i * 1000).toISOString())
    );
    const r4 = await runBacklogPull({ query, fetchIssues, projectKey: "ZZT", now }, { trigger: "scheduled" });
    assert.equal(calls.length, 2, "100件の次のページも読む");
    assert.equal(calls[1].offset, PAGE_SIZE);
    assert.equal(r4.unmatched, PAGE_SIZE + 1);

    // ── 失敗: watermark を進めない
    const wmBefore = (await query(`SELECT watermark FROM backlog_pull_runs WHERE error IS NULL ORDER BY id DESC LIMIT 1`)).rows[0].watermark;
    const failing = async () => { throw new Error("Backlog API 429: Too Many Requests"); };
    const r5 = await runBacklogPull({ query, fetchIssues: failing, projectKey: "ZZT", now }, { trigger: "scheduled" });
    assert.equal(r5.ok, false);
    assert.match(r5.error!, /429/);
    const r6 = await runBacklogPull({ query, fetchIssues: async () => [], projectKey: "ZZT", now }, { trigger: "scheduled" });
    assert.equal(r6.updated_since, new Date(new Date(wmBefore).getTime() - OVERLAP_MS).toISOString(), "失敗した回の次は前回成功の watermark から");
    assert.equal(r6.watermark, new Date(wmBefore).toISOString(), "0件の回は watermark を巻き戻さない");

    // ── 同時実行: 未終了の行があれば skipped
    await query(`INSERT INTO backlog_pull_runs (trigger) VALUES ('manual')`);
    const r7 = await runBacklogPull({ query, fetchIssues, projectKey: "ZZT", now }, { trigger: "manual" });
    assert.equal(r7.skipped, true);
    // 古い未終了行は打ち切って次を走らせる
    await query(`UPDATE backlog_pull_runs SET started_at = now() - interval '1 hour' WHERE finished_at IS NULL`);
    const r8 = await runBacklogPull({ query, fetchIssues: async () => [], projectKey: "ZZT", now }, { trigger: "manual" });
    assert.equal(!!r8.skipped, false);
    assert.equal((await query(`SELECT count(*)::int n FROM backlog_pull_runs WHERE error LIKE 'stale:%'`)).rows[0].n, 1);

    // ── 全件照合: LB にあって Backlog に無い課題を数える
    backlog = [issue(101, "ZZT-1", "処理中", "2026-09-25T02:00:00Z"), issue(102, "ZZT-2", "未対応", "2026-09-25T01:05:00Z")];
    calls.length = 0;
    const r9 = await runBacklogPull({ query, fetchIssues, projectKey: "ZZT", now }, { trigger: "full_reconcile" });
    assert.equal(calls[0].updatedSince, undefined, "全件照合は updatedSince なし");
    assert.equal(r9.missing_in_backlog, 1);
    const run9 = (await query(`SELECT detail FROM backlog_pull_runs WHERE id=$1`, [r9.run_id])).rows[0];
    assert.deepEqual(run9.detail.missing_in_backlog, ["ZZT-9"]);

    console.log("backlogPull selftest: OK");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

main().catch((e) => {
  console.error("backlogPull selftest: FAILED\n", e);
  process.exit(1);
});
