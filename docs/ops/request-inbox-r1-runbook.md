# 依頼受付箱 R1（Backlog 取得）運用手順

設計: [`../design/v3-backlog-request-scheme.md`](../design/v3-backlog-request-scheme.md) §4 / §12 R1
対象: `migrations/0154_request_inbox_r1.sql`、worker `src/services/backlogPull.ts` / `src/routes/requestInbox.ts`

R1 は「Backlog を読みに行く土台」だけを入れる段階です。**現行の Slack 起票・webhook・案件自動作成の動きは変わりません。** 受付箱の画面はまだ出ません。

## 1. R1 で入るもの

| 種類 | 内容 |
|---|---|
| テーブル | `request_types`（依頼種別マスタ・15種をシード）、`backlog_pull_runs`（取得ログ）、`request_events`（依頼の履歴） |
| 列 | `legal_requests` に依頼番号・受付状態・Backlog スナップショット・種別・案件 等。`staff.backlog_user_id`、`documents.request_id` |
| バックフィル | 既存の依頼に `REQ-YYYY-NNNNN` を採番、`contract_type` → 種別、`matter_issues` → 案件、`merged_into_issue_key` → 重複。受付状態は全件 `accepted`（現行運用で処理済み） |
| トリガ | 新しい依頼行に依頼番号・種別・依頼者・希望納期を自動で埋める。`matter_issues` の追加・付け替え・解除を `legal_requests.matter_id` に反映 |
| API（worker） | `POST /api/inbox/pull`、`GET /api/inbox/pull-runs`、`GET /api/inbox/pull-runs/:id`（いずれも `X-LB-PORTAL-SECRET` 必須） |

取得ジョブは、Backlog の課題と既存の依頼行を突き合わせてスナップショットを更新するだけです。**LegalBridge に無い課題の行は作りません**（作ると webhook 側が「処理済み」と判断して現行の起票パイプラインを飛ばすため）。そうした課題は取得ログに「未登録」として残します。Backlog へは書き込みません。

## 2. デプロイ手順

1. `release/worker` へのデプロイで migration 0154 が適用されることを確認する（`schema_migrations` に `0154_request_inbox_r1`）。
2. worker が起動したら手動で1回取得する（admin-ui 経由、または portal secret 付きで直接）。

   ```bash
   curl -sS -X POST "$WORKER_URL/api/inbox/pull" \
     -H "X-LB-PORTAL-SECRET: $LB_PORTAL_SECRET" -H "Content-Type: application/json" \
     -d '{"trigger":"manual"}'
   ```

   初回は直近 24 時間に更新された課題が対象です。`ok: true` と件数が返れば成功です。
3. 全件照合を1回流して、既存の依頼行すべてにスナップショットを入れる。

   ```bash
   curl -sS -X POST "$WORKER_URL/api/inbox/pull" \
     -H "X-LB-PORTAL-SECRET: $LB_PORTAL_SECRET" -H "Content-Type: application/json" \
     -d '{"trigger":"full_reconcile"}'
   ```

4. Cloud Scheduler にジョブを2本作る（いずれも HTTP POST、ヘッダ `X-LB-PORTAL-SECRET` と `Content-Type: application/json`、タイムゾーン Asia/Tokyo）。

   | ジョブ | スケジュール | 本文 |
   |---|---|---|
   | `legalbridge-backlog-pull` | `*/5 * * * *` | `{"trigger":"scheduled"}` |
   | `legalbridge-backlog-reconcile` | `0 3 * * *` | `{"trigger":"full_reconcile"}` |

   取得が失敗すると HTTP 502 を返します（Scheduler の失敗として見えます）。同時実行になった回は `skipped: true` で 200 を返します。

## 3. 検証（R1 の完了条件：1週間、突き合わせの差分が説明できること）

取得ログの一覧:

```sql
SELECT id, trigger, started_at, finished_at, fetched_count, matched_count, updated_count,
       unmatched_count, (detail->>'missing_in_backlog_count')::int AS missing, error
  FROM backlog_pull_runs ORDER BY id DESC LIMIT 50;
```

見るポイント:

- **error** が続いていないか。失敗した回は次の回が同じ範囲を取り直すので、単発の 429 などは問題ありません。
- **未登録（unmatched）**: Backlog にあって LegalBridge に無い課題。起票直後で webhook 処理がまだの課題（次の回で消える）以外が残る場合は、webhook 取りこぼしの可能性があります。R2 以降はこれらが受付箱に入ります。

  ```sql
  SELECT id, started_at, jsonb_array_elements(detail->'unmatched')->>'key' AS key
    FROM backlog_pull_runs WHERE unmatched_count > 0 ORDER BY id DESC LIMIT 100;
  ```

- **Backlog に無い（missing_in_backlog、全件照合のみ）**: LegalBridge にあって Backlog に無い課題。削除・プロジェクト移動、`IMPORT-*` などの合成キーが対象です。
- スナップショットが入っていない依頼（全件照合後は 0 件が目安。合成キーを除く）:

  ```sql
  SELECT count(*) FROM legal_requests
   WHERE backlog_issue_key LIKE 'LEGAL-%' AND last_pulled_at IS NULL;
  ```

- Backlog 側でのステータス変化の履歴:

  ```sql
  SELECT lr.request_no, lr.backlog_issue_key, e.detail->>'from' AS from_status, e.detail->>'to' AS to_status, e.created_at
    FROM request_events e JOIN legal_requests lr ON lr.id = e.request_id
   WHERE e.kind = 'backlog_changed' ORDER BY e.id DESC LIMIT 50;
  ```

## 4. 止め方・戻し方

- 取得を止める: Cloud Scheduler の2ジョブを一時停止する。現行フローには影響しません。
- 異常終了した実行は 15 分で自動的に打ち切られ、次の回が走ります。
- スキーマを戻す場合は `0154_request_inbox_r1.sql` 末尾のロールバック手順を参照（トリガ → 関数 → テーブル・列の順に削除）。

## 5. ローカルでの確認

```bash
# 全マイグレーション適用済みの DB に対して
DATABASE_URL=postgres://... npx tsx services/worker/src/services/backlogPull.selftest.ts
```

テストデータはトランザクション内で作り、最後にロールバックします。
