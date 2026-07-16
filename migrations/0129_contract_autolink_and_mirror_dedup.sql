-- 0129_contract_autolink_and_mirror_dedup.sql
-- Phase 5 第2弾(契約・金銭分離): 書込み経路の contract_id 自動付与＋ミラー重複 contracts の統合。
-- 仕様: docs/plans/phase5-contract-finance-plan.md §3 第2弾
--
-- ① documents BEFORE INSERT トリガ(0106 autolink と同型):
--    contract_id 未設定の文書に、版ファミリの契約を解決して付与する。
--    契約が無い家族は 0128 ⑤ と同一写像で contracts を補完生成する。
--    INSERT サイトは 30 箇所超あるためアプリ側の個別スタンプではなく DB で不変式を保証し、
--    EXCEPTION は握り潰して文書の書込みを絶対に壊さない(lb_sync/autolink と同じ流儀)。
--    ※ 撤去条件: Phase 7 で書込みが明示 DTO 経由に一本化された時点で DROP。
-- ② 0101 以前の 1:1 ミラー行のうち「家族の正本(documents.contract_id)ではない」重複を統合:
--    非 CASCADE の参照(payments / invoices / royalty_statements / alerts / deliverables、
--    contracts の self-ref)を正本へ付け替えてから重複行を削除する
--    (CASCADE 子 contract_works/parties/financial_terms/line_items/obligations/
--     stage_history/signature_requests のミラー残骸は行ごと削除される)。

BEGIN;

-- ── ① contract_id 自動付与トリガ ──────────────────────────────────────
CREATE OR REPLACE FUNCTION doc_autolink_contract() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fam text; cid int;
BEGIN
  IF NEW.contract_id IS NOT NULL THEN RETURN NEW; END IF;
  fam := COALESCE(NULLIF(btrim(NEW.base_document_number), ''), NULLIF(btrim(NEW.document_number), ''));
  IF fam IS NULL THEN RETURN NEW; END IF;

  -- 1) 版ファミリの既存接続(最小 id = 正本)を継承
  SELECT d.contract_id INTO cid
    FROM documents d
   WHERE (d.base_document_number = fam OR d.document_number = fam)
     AND d.contract_id IS NOT NULL
   ORDER BY d.contract_id
   LIMIT 1;

  -- 2) contracts.document_number 一致(registered 契約等)
  IF cid IS NULL THEN
    SELECT c.id INTO cid FROM contracts c WHERE c.document_number = fam;
  END IF;

  -- 3) 契約が無い家族は補完生成(0128 ⑤ / 旧 lb_sync_contracts と同一写像)
  IF cid IS NULL THEN
    INSERT INTO contracts (
      document_number, contract_level, record_type, contract_category, contract_type,
      contract_title, primary_vendor_id, origin, contract_status, lifecycle_stage,
      effective_date, expiration_date, auto_renewal, renewal_notice_months, alert_lead_months,
      alert_slack_channels, alert_slack_mentions, source_system, legalon_url, cloudsign_url,
      drive_url, purpose_codes, scope, sublicense_allowed, overseas_allowed, translation_allowed,
      ebook_allowed, merchandising_allowed, video_adaptation_allowed, game_adaptation_allowed,
      risk_flags, legal_review_required, scope_confidence, created_at, updated_at
    ) VALUES (
      fam,
      CASE NEW.record_type
        WHEN 'master_contract' THEN 'master'
        WHEN 'license_condition' THEN 'individual'
        WHEN 'publication_condition' THEN 'individual'
        ELSE 'standalone' END,
      NEW.record_type, NEW.contract_category, NEW.contract_type, NEW.contract_title, NEW.vendor_id,
      'workflow', NEW.contract_status,
      CASE NEW.contract_status WHEN 'executed' THEN 'executed' WHEN 'confirmed' THEN 'executed'
        WHEN 'pending' THEN 'requested' ELSE NEW.contract_status END,
      NEW.effective_date, NEW.expiration_date, COALESCE(NEW.auto_renewal, FALSE),
      NEW.renewal_notice_months, NEW.alert_lead_months,
      COALESCE(NEW.alert_slack_channels, '[]'::jsonb), COALESCE(NEW.alert_slack_mentions, '[]'::jsonb),
      NEW.source_system, NEW.legalon_url, NEW.cloudsign_url, NEW.drive_url,
      COALESCE(NEW.purpose_codes, '{}'), NEW.scope, NEW.sublicense_allowed,
      COALESCE(NEW.overseas_allowed, FALSE), COALESCE(NEW.translation_allowed, FALSE),
      COALESCE(NEW.ebook_allowed, FALSE), COALESCE(NEW.merchandising_allowed, FALSE),
      COALESCE(NEW.video_adaptation_allowed, FALSE), COALESCE(NEW.game_adaptation_allowed, FALSE),
      COALESCE(NEW.risk_flags, '{}'::jsonb), COALESCE(NEW.legal_review_required, FALSE),
      NEW.scope_confidence, COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
    )
    ON CONFLICT (document_number) DO UPDATE SET updated_at = now()
    RETURNING id INTO cid;
  END IF;

  IF cid IS NOT NULL THEN NEW.contract_id := cid; END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'doc_autolink_contract failed (doc_number=%): %', NEW.document_number, SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_doc_autolink_contract ON documents;
CREATE TRIGGER tg_doc_autolink_contract
  BEFORE INSERT OR UPDATE OF document_number, base_document_number ON documents
  FOR EACH ROW EXECUTE FUNCTION doc_autolink_contract();

-- ── ② ミラー重複の統合 ────────────────────────────────────────────────
-- 重複 = 「documents.id と同じ id を持つ workflow ミラーだが、その文書の正本契約
--         (documents.contract_id)は別行」のもの。0128 ④ で家族が最小 id へ寄った結果。

-- 非 CASCADE 参照の付け替え(実データを失わない)
WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE payments p SET contract_id = r.new_id FROM remap r WHERE p.contract_id = r.old_id;

WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE invoices i SET contract_id = r.new_id FROM remap r WHERE i.contract_id = r.old_id;

WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE royalty_statements rs SET contract_id = r.new_id FROM remap r WHERE rs.contract_id = r.old_id;

WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE alerts a SET contract_id = r.new_id FROM remap r WHERE a.contract_id = r.old_id;

WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE deliverables dv SET contract_id = r.new_id FROM remap r WHERE dv.contract_id = r.old_id;

-- contracts 自己参照(基本契約・改定元)の付け替え
WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE contracts t SET master_contract_id = r.new_id
  FROM remap r WHERE t.master_contract_id = r.old_id AND t.id <> r.new_id;

WITH remap AS (
  SELECT c.id AS old_id, d.contract_id AS new_id
    FROM contracts c
    JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id
)
UPDATE contracts t SET amends_contract_id = r.new_id
  FROM remap r WHERE t.amends_contract_id = r.old_id AND t.id <> r.new_id;

-- 重複行の削除(CASCADE 子=ミラー残骸ごと)。文書参照が残るものは念のため除外。
DELETE FROM contracts c
 USING documents d
 WHERE d.id = c.id
   AND c.origin = 'workflow'
   AND d.contract_id IS NOT NULL
   AND d.contract_id <> c.id
   AND NOT EXISTS (SELECT 1 FROM documents d2 WHERE d2.contract_id = c.id);

-- ── ③ 結果サマリ ─────────────────────────────────────────────────────
DO $$
DECLARE dup INT; wf INT;
BEGIN
  SELECT COUNT(*) INTO dup
    FROM contracts c JOIN documents d ON d.id = c.id
   WHERE c.origin = 'workflow' AND d.contract_id IS NOT NULL AND d.contract_id <> c.id;
  SELECT COUNT(*) INTO wf FROM contracts WHERE origin = 'workflow';
  RAISE NOTICE '0129: 残存ミラー重複 % 件 (期待値0) / workflow契約 % 件', dup, wf;
END $$;

COMMIT;
