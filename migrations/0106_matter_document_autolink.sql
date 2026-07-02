-- 0106_matter_document_autolink.sql
-- 案件(matter)と Request(Backlog課題) の整合性強化。
--   Request 経由で作られた文書が案件に自動で束ねられず、案件ページの
--   文書/条件明細/送信履歴が空のままになる不整合を解消する。
--     ① documents BEFORE INSERT/UPDATE トリガ:
--        matter_id が未設定なら issue_key(なければ backlog_issue_key) の属する案件を設定
--     ② 既存文書のバックフィル(冪等・再実行安全)
--   非破壊・追加のみ。

BEGIN;

CREATE OR REPLACE FUNCTION doc_autolink_matter() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; mid int;
BEGIN
  IF NEW.matter_id IS NOT NULL THEN RETURN NEW; END IF;
  k := COALESCE(NULLIF(btrim(NEW.issue_key), ''), NULLIF(btrim(NEW.backlog_issue_key), ''));
  IF k IS NULL THEN RETURN NEW; END IF;
  SELECT mi.matter_id INTO mid
    FROM matter_issues mi
   WHERE mi.backlog_issue_key = k
   ORDER BY mi.id LIMIT 1;
  IF mid IS NOT NULL THEN NEW.matter_id := mid; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_doc_autolink_matter ON documents;
CREATE TRIGGER tg_doc_autolink_matter
  BEFORE INSERT OR UPDATE OF issue_key, backlog_issue_key ON documents
  FOR EACH ROW EXECUTE FUNCTION doc_autolink_matter();

-- 既存文書のバックフィル: 課題の案件が分かる文書に matter_id を付与する。
UPDATE documents d
   SET matter_id = mi.matter_id
  FROM (
    SELECT DISTINCT ON (backlog_issue_key) backlog_issue_key, matter_id
      FROM matter_issues
     ORDER BY backlog_issue_key, id
  ) mi
 WHERE d.matter_id IS NULL
   AND COALESCE(NULLIF(btrim(d.issue_key), ''), NULLIF(btrim(d.backlog_issue_key), '')) = mi.backlog_issue_key;

COMMIT;
