-- 0128_documents_contract_id.sql
-- Phase 5 第1弾(契約・金銭分離): documents.contract_id 追加＋バックフィル。
-- 仕様: docs/plans/phase5-contract-finance-plan.md §4
--
-- 目的: contracts(法的関係) と documents(発行書面) を分離し、1契約:N文書を表現する。
--   版ファミリ(base_document_number 単位)は同一契約を指す。
-- 冪等: contract_id が NULL の行だけ埋める(ファミリ統合④は同値なら no-op)。
--
-- 背景:
--   - contracts には ①0101 以前の 1:1 ミラー行(id = documents.id, origin='workflow')と
--     ②Search /api/v3 の登録契約(origin='registered', id>=1e9) が混在する。
--   - 0101 で旧実表が DROP CASCADE され trg_sync_contracts は消滅済みのため、
--     0101 以降に作られた文書には対応する contracts 行が無い → ⑤で補完生成する。

-- ── ① additive: 列とインデックス ─────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contracts(id);
CREATE INDEX IF NOT EXISTS idx_documents_contract ON documents(contract_id);

-- ── ② 旧 1:1 ミラー行への直リンク(0101 以前に同期された文書) ─────────
UPDATE documents d
   SET contract_id = c.id
  FROM contracts c
 WHERE d.contract_id IS NULL
   AND c.id = d.id
   AND c.origin = 'workflow';

-- ── ③ document_number 一致(registered 契約や既存契約との突合) ─────────
UPDATE documents d
   SET contract_id = c.id
  FROM contracts c
 WHERE d.contract_id IS NULL
   AND d.document_number IS NOT NULL
   AND c.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number);

-- ── ④ 版ファミリ統合: 家族内で契約が割れていたら最小 contracts.id へ寄せ、
--       未接続の版にも家族の契約を伝播する ─────────────────────────────
WITH keyed AS (
  SELECT d.id,
         COALESCE(NULLIF(d.base_document_number, ''), d.document_number) AS fam_key,
         d.contract_id
    FROM documents d
   WHERE d.document_number IS NOT NULL
), pick AS (
  SELECT fam_key, MIN(contract_id) AS fam_contract_id
    FROM keyed
   WHERE contract_id IS NOT NULL
   GROUP BY fam_key
)
UPDATE documents d
   SET contract_id = p.fam_contract_id
  FROM keyed k
  JOIN pick p ON p.fam_key = k.fam_key
 WHERE d.id = k.id
   AND d.contract_id IS DISTINCT FROM p.fam_contract_id;

-- ── ⑤ 不足契約の生成: 0101 以降に作られ契約を持たない家族は、代表版
--       (is_primary → revision → id 降順)から旧 lb_sync_contracts(0012) と
--       同じ写像で contracts を新規作成する ────────────────────────────
WITH still AS (
  SELECT d.*,
         COALESCE(NULLIF(d.base_document_number, ''), d.document_number) AS fam_key
    FROM documents d
   WHERE d.contract_id IS NULL
     AND d.document_number IS NOT NULL
), rep AS (
  SELECT DISTINCT ON (fam_key) *
    FROM still
   ORDER BY fam_key, is_primary DESC NULLS LAST, revision DESC NULLS LAST, id DESC
)
INSERT INTO contracts (
  document_number, contract_level, record_type, contract_category, contract_type,
  contract_title, primary_vendor_id, origin, contract_status, lifecycle_stage,
  effective_date, expiration_date, auto_renewal, renewal_notice_months, alert_lead_months,
  alert_slack_channels, alert_slack_mentions, source_system, legalon_url, cloudsign_url,
  drive_url, purpose_codes, scope, sublicense_allowed, overseas_allowed, translation_allowed,
  ebook_allowed, merchandising_allowed, video_adaptation_allowed, game_adaptation_allowed,
  risk_flags, legal_review_required, scope_confidence, created_at, updated_at
)
SELECT fam_key,
       CASE record_type
         WHEN 'master_contract' THEN 'master'
         WHEN 'license_condition' THEN 'individual'
         WHEN 'publication_condition' THEN 'individual'
         ELSE 'standalone' END,
       record_type, contract_category, contract_type, contract_title, vendor_id,
       'workflow', contract_status,
       CASE contract_status WHEN 'executed' THEN 'executed' WHEN 'confirmed' THEN 'executed'
         WHEN 'pending' THEN 'requested' ELSE contract_status END,
       effective_date, expiration_date, COALESCE(auto_renewal, FALSE),
       renewal_notice_months, alert_lead_months,
       COALESCE(alert_slack_channels, '[]'::jsonb), COALESCE(alert_slack_mentions, '[]'::jsonb),
       source_system, legalon_url, cloudsign_url, drive_url,
       COALESCE(purpose_codes, '{}'), scope, sublicense_allowed,
       COALESCE(overseas_allowed, FALSE), COALESCE(translation_allowed, FALSE),
       COALESCE(ebook_allowed, FALSE), COALESCE(merchandising_allowed, FALSE),
       COALESCE(video_adaptation_allowed, FALSE), COALESCE(game_adaptation_allowed, FALSE),
       COALESCE(risk_flags, '{}'::jsonb), COALESCE(legal_review_required, FALSE),
       scope_confidence, created_at, updated_at
  FROM rep
ON CONFLICT (document_number) DO NOTHING;

-- ⑤で生成(または競合先行)した契約へ接続(③の再実行)
UPDATE documents d
   SET contract_id = c.id
  FROM contracts c
 WHERE d.contract_id IS NULL
   AND d.document_number IS NOT NULL
   AND c.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number);

-- ── ⑥ 基本契約リンクの昇格: documents.master_document_number(0122) →
--       contracts.master_contract_id(未設定行のみ) ──────────────────────
UPDATE contracts c
   SET master_contract_id = mc.id
  FROM documents d
  JOIN contracts mc ON mc.document_number = d.master_document_number
 WHERE c.id = d.contract_id
   AND c.master_contract_id IS NULL
   AND NULLIF(d.master_document_number, '') IS NOT NULL
   AND mc.id <> c.id;

-- ── ⑦ 結果サマリ(適用ログで確認する) ────────────────────────────────
DO $$
DECLARE
  total  INT;
  linked INT;
BEGIN
  SELECT COUNT(*), COUNT(contract_id) INTO total, linked
    FROM documents WHERE document_number IS NOT NULL;
  RAISE NOTICE '0128: documents(document_number有) % 件中 contract_id 接続 % 件 (未接続 %)',
    total, linked, total - linked;
END $$;
