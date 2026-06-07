-- 0035_work_unify_p2_3_source_ip_mirror.sql
-- データモデル統合 Part2 P2-3(移行): source_ips → works(kind='licensed_in') 同期トリガ。
--
-- 目的: 原作IPの作成/更新(POST/PUT/CSV取込 いずれの経路でも)を works に自動同期し、
--   works を原作IP+自社作品の完全な統合ストアに保つ。これにより以降 work_id 一本で
--   原作IPも辿れる(reader/契約リンクの統一)。writer 全面移植や UI の id 変更は不要。
--
-- ※ これは移行用の一時ミラー(source_ips→works)。最終的に source_ips を撤去する
--   P2-6 でトリガごと廃止する。
-- 冪等: CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS。source_ips 不在ならトリガ未作成。

CREATE OR REPLACE FUNCTION lb_sync_source_ip_to_work() RETURNS trigger AS $fn$
DECLARE wid INTEGER;
BEGIN
  SELECT id INTO wid FROM works WHERE legacy_source_ip_id = NEW.id;
  IF wid IS NULL THEN
    -- work_code 衝突時は既存 works に紐付けるだけ(二重作成回避)
    SELECT id INTO wid FROM works WHERE work_code = NEW.source_code;
    IF wid IS NULL THEN
      INSERT INTO works (
        work_code, title, title_kana, alternative_titles, division,
        is_original, kind, legacy_source_ip_id,
        original_publisher, default_rights_holder, default_credit_display,
        default_work_supplement, default_approval_target, default_approval_timing,
        rights_holder_vendor_id, remarks, is_active
      ) VALUES (
        NEW.source_code, NEW.title, NEW.title_kana, COALESCE(NEW.alternative_titles, '{}'), '{}',
        FALSE, 'licensed_in', NEW.id,
        NEW.original_publisher, NEW.default_rights_holder, NEW.default_credit_display,
        NEW.default_work_supplement, NEW.default_approval_target, NEW.default_approval_timing,
        NEW.rights_holder_vendor_id, NEW.remarks, COALESCE(NEW.is_active, TRUE)
      );
    ELSE
      UPDATE works SET legacy_source_ip_id = NEW.id, kind = 'licensed_in' WHERE id = wid;
    END IF;
  ELSE
    UPDATE works SET
      title = NEW.title, title_kana = NEW.title_kana,
      alternative_titles = COALESCE(NEW.alternative_titles, '{}'),
      original_publisher = NEW.original_publisher,
      default_rights_holder = NEW.default_rights_holder,
      default_credit_display = NEW.default_credit_display,
      default_work_supplement = NEW.default_work_supplement,
      default_approval_target = NEW.default_approval_target,
      default_approval_timing = NEW.default_approval_timing,
      rights_holder_vendor_id = NEW.rights_holder_vendor_id,
      remarks = NEW.remarks, is_active = COALESCE(NEW.is_active, TRUE), updated_at = now()
    WHERE id = wid;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_source_ip_to_work failed (sip.id=%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DO $mk$
BEGIN
  IF to_regclass('public.source_ips') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_source_ip_to_work ON source_ips';
    EXECUTE 'CREATE TRIGGER trg_sync_source_ip_to_work AFTER INSERT OR UPDATE ON source_ips '
         || 'FOR EACH ROW EXECUTE FUNCTION lb_sync_source_ip_to_work()';
  END IF;
END
$mk$;
