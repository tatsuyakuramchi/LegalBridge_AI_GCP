-- 0150_disable_slack_notify.sql
-- Slack 通知の一時停止スイッチを ON にする。
--   文書変更/ステータス連動(Backlog webhook 等)で notifyIssueEvent / notifyAutoChainCreated
--   が過剰に Slack 通知を飛ばしていたため、一旦停止する(運用判断)。
--   worker 起動時に app_settings を dbSettings へロードし、SLACK_NOTIFY_DISABLED が
--   真値なら Slack 通知を送らない(services/worker/server.ts の slackNotifyDisabled)。
--
-- 再開するとき:
--   UPDATE app_settings SET value = 'false'::jsonb WHERE key = 'SLACK_NOTIFY_DISABLED';
--   (または当該行を DELETE) のうえ worker を再起動(release/worker 再デプロイ)する。
--
-- additive・冪等。value は JSONB。worker 側は String()正規化で bool/数値/文字列いずれも受ける。

INSERT INTO app_settings (key, value)
VALUES ('SLACK_NOTIFY_DISABLED', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
