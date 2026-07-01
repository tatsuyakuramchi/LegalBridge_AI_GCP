-- 0104_matter_backfill_existing.sql
-- 既存(過去)の legal_requests を案件へ一括バックフィル（一度きり）。
--   0103 の AFTER INSERT トリガは「これ以降の新規」だけが対象のため、既存分を同ロジックで案件化する。
--   ロジックは lr_autocreate_matter と同一:
--     - 既に案件に束ねられている課題はスキップ（冪等・再実行安全）
--     - 統合済み(merged_into_issue_key)はスキップ
--     - 親課題(parent_issue_key)が案件を持てば、その案件へ related で束ねる
--     - それ以外は新規案件を作成し primary で束ねる
--   created_at 昇順（親→子）で処理し、親子チェーンを同一案件へまとめる。
--   ※ 別キーの「重複」課題の自動統合は行わない（意味判断が要るため）。案件UIの「統合」で束ねてください。
--   非破壊・追加のみ。next_matter_code() は 0103 で定義済み。

BEGIN;

DO $$
DECLARE r RECORD; parent_mid int; new_mid int; made int := 0; linked int := 0;
BEGIN
  FOR r IN
    SELECT * FROM legal_requests ORDER BY created_at NULLS FIRST, id
  LOOP
    IF r.backlog_issue_key IS NULL OR btrim(r.backlog_issue_key) = '' THEN CONTINUE; END IF;

    -- 冪等: 既にどこかの案件に束ねられていればスキップ。
    IF EXISTS (SELECT 1 FROM matter_issues WHERE backlog_issue_key = r.backlog_issue_key) THEN CONTINUE; END IF;

    -- 統合済みは独立案件を作らない。
    IF r.merged_into_issue_key IS NOT NULL AND btrim(r.merged_into_issue_key) <> '' THEN CONTINUE; END IF;

    parent_mid := NULL;
    IF r.parent_issue_key IS NOT NULL AND btrim(r.parent_issue_key) <> '' THEN
      SELECT mi.matter_id INTO parent_mid
        FROM matter_issues mi
       WHERE mi.backlog_issue_key = r.parent_issue_key
       ORDER BY mi.id LIMIT 1;
    END IF;

    IF parent_mid IS NOT NULL THEN
      INSERT INTO matter_issues (matter_id, backlog_issue_key, relation, summary_snapshot)
      VALUES (parent_mid, r.backlog_issue_key, 'related', r.summary)
      ON CONFLICT (matter_id, backlog_issue_key) DO NOTHING;
      UPDATE matters SET updated_at = now() WHERE id = parent_mid;
      linked := linked + 1;
    ELSE
      INSERT INTO matters (matter_code, title, status, counterparty, primary_issue_key, created_by)
      VALUES (
        next_matter_code(),
        COALESCE(NULLIF(btrim(r.summary), ''), r.backlog_issue_key),
        'open',
        r.counterparty,
        r.backlog_issue_key,
        r.slack_user_id
      )
      RETURNING id INTO new_mid;
      INSERT INTO matter_issues (matter_id, backlog_issue_key, relation, summary_snapshot)
      VALUES (new_mid, r.backlog_issue_key, 'primary', r.summary)
      ON CONFLICT (matter_id, backlog_issue_key) DO NOTHING;
      made := made + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[0104] backfill done: % new matters, % child links', made, linked;
END $$;

COMMIT;
