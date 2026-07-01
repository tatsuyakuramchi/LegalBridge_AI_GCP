-- 0103_matter_autolink.sql
-- 新規 Backlog 課題(=legal_requests 行)が増えたら案件へ自動追加する。
--   legal_requests への INSERT は worker 内に7経路(webhook/Slack/quick-create/子課題自動起票/
--   手動生成/CSV/期限変更 等)あるため、コード各所を触らず AFTER INSERT トリガで一元処理する。
--   冪等: 既に案件に紐付く課題は何もしない。親課題(parent_issue_key)があれば親の案件へ束ねる。
--   非破壊・追加のみ。

BEGIN;

-- 案件コード採番（アプリ側 nextMatterCode と同じ document_sequences 'matter' を共用＝衝突しない）。
CREATE OR REPLACE FUNCTION next_matter_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE y int := EXTRACT(YEAR FROM now())::int; v int;
BEGIN
  INSERT INTO document_sequences (kind, year, current_value) VALUES ('matter', y, 1)
    ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
  RETURNING current_value INTO v;
  RETURN 'MTR-'||y||'-'||lpad(v::text, 5, '0');
END $$;

CREATE OR REPLACE FUNCTION lr_autocreate_matter() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_mid int; new_mid int;
BEGIN
  IF NEW.backlog_issue_key IS NULL THEN RETURN NEW; END IF;

  -- 冪等: 既にどこかの案件に束ねられている課題は何もしない。
  IF EXISTS (SELECT 1 FROM matter_issues WHERE backlog_issue_key = NEW.backlog_issue_key) THEN
    RETURN NEW;
  END IF;

  -- 他課題へ統合済み(merged_into_issue_key)の起票は独立案件を作らない。
  IF NEW.merged_into_issue_key IS NOT NULL AND btrim(NEW.merged_into_issue_key) <> '' THEN
    RETURN NEW;
  END IF;

  -- 親課題があり、その親が案件に属していれば、同じ案件へ関連として束ねる(ケースを分割しない)。
  IF NEW.parent_issue_key IS NOT NULL AND btrim(NEW.parent_issue_key) <> '' THEN
    SELECT mi.matter_id INTO parent_mid
      FROM matter_issues mi
     WHERE mi.backlog_issue_key = NEW.parent_issue_key
     ORDER BY mi.id LIMIT 1;
    IF parent_mid IS NOT NULL THEN
      INSERT INTO matter_issues (matter_id, backlog_issue_key, relation, summary_snapshot)
      VALUES (parent_mid, NEW.backlog_issue_key, 'related', NEW.summary)
      ON CONFLICT (matter_id, backlog_issue_key) DO NOTHING;
      UPDATE matters SET updated_at = now() WHERE id = parent_mid;
      RETURN NEW;
    END IF;
  END IF;

  -- それ以外は新規案件を作成し、この課題を代表(primary)として束ねる。
  INSERT INTO matters (matter_code, title, status, counterparty, primary_issue_key, created_by)
  VALUES (
    next_matter_code(),
    COALESCE(NULLIF(btrim(NEW.summary), ''), NEW.backlog_issue_key),
    'open',
    NEW.counterparty,
    NEW.backlog_issue_key,
    NEW.slack_user_id
  )
  RETURNING id INTO new_mid;

  INSERT INTO matter_issues (matter_id, backlog_issue_key, relation, summary_snapshot)
  VALUES (new_mid, NEW.backlog_issue_key, 'primary', NEW.summary)
  ON CONFLICT (matter_id, backlog_issue_key) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_lr_autocreate_matter ON legal_requests;
CREATE TRIGGER tg_lr_autocreate_matter
  AFTER INSERT ON legal_requests
  FOR EACH ROW EXECUTE FUNCTION lr_autocreate_matter();

COMMIT;
