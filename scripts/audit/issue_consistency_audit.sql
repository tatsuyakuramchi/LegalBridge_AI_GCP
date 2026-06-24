-- 課題コントロール整合性監査 Phase 0 (read-only)
-- A1〜A7 の件数とサンプルを確認する。
-- 実行例:
--   psql "$DATABASE_URL" -f scripts/audit/issue_consistency_audit.sql

\echo 'A1 documents.issue_key <> contract_capabilities.backlog_issue_key'
SELECT COUNT(*)::int AS count
  FROM documents d
  JOIN contract_capabilities cc
    ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
 WHERE d.issue_key IS NOT NULL
   AND cc.backlog_issue_key IS NOT NULL
   AND d.issue_key <> cc.backlog_issue_key;

SELECT d.document_number,
       d.template_type,
       d.issue_key AS document_issue_key,
       cc.id AS capability_id,
       cc.backlog_issue_key AS capability_issue_key
  FROM documents d
  JOIN contract_capabilities cc
    ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
 WHERE d.issue_key IS NOT NULL
   AND cc.backlog_issue_key IS NOT NULL
   AND d.issue_key <> cc.backlog_issue_key
 ORDER BY d.created_at DESC NULLS LAST
 LIMIT 20;

\echo 'A2 final contracting documents without condition_lines'
SELECT COUNT(*)::int AS count
  FROM documents d
  LEFT JOIN contract_capabilities cc
    ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
  LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
 WHERE d.template_type IN (
       'purchase_order',
       'intl_purchase_order',
       'individual_license_terms',
       'pub_license_terms'
     )
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
   AND COALESCE(d.is_primary, TRUE) = TRUE
   AND cl.id IS NULL;

SELECT d.document_number,
       d.issue_key,
       d.template_type,
       cc.id AS capability_id
  FROM documents d
  LEFT JOIN contract_capabilities cc
    ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
  LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
 WHERE d.template_type IN (
       'purchase_order',
       'intl_purchase_order',
       'individual_license_terms',
       'pub_license_terms'
     )
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
   AND COALESCE(d.is_primary, TRUE) = TRUE
   AND cl.id IS NULL
 ORDER BY d.created_at DESC NULLS LAST
 LIMIT 20;

\echo 'A3 payment preparation documents without condition_events'
SELECT COUNT(*)::int AS count
  FROM documents d
 WHERE d.template_type IN (
       'inspection_certificate',
       'royalty_statement',
       'license_calculation_sheet'
     )
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
   AND COALESCE(d.is_primary, TRUE) = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM condition_events ce WHERE ce.document_id = d.id
   );

SELECT d.id,
       d.document_number,
       d.issue_key,
       d.template_type,
       d.created_at
  FROM documents d
 WHERE d.template_type IN (
       'inspection_certificate',
       'royalty_statement',
       'license_calculation_sheet'
     )
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
   AND COALESCE(d.is_primary, TRUE) = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM condition_events ce WHERE ce.document_id = d.id
   )
 ORDER BY d.created_at DESC NULLS LAST
 LIMIT 20;

\echo 'A4 condition_lines classification gaps'
SELECT COUNT(*)::int AS count
  FROM condition_lines
 WHERE transaction_kind IS NULL OR counterparty_vendor_id IS NULL;

SELECT payment_scheme,
       COUNT(*)::int AS count,
       COUNT(*) FILTER (WHERE transaction_kind IS NULL)::int AS transaction_kind_null,
       COUNT(*) FILTER (WHERE counterparty_vendor_id IS NULL)::int AS counterparty_vendor_id_null
  FROM condition_lines
 WHERE transaction_kind IS NULL OR counterparty_vendor_id IS NULL
 GROUP BY payment_scheme
 ORDER BY count DESC;

\echo 'A5 merged issues with final documents left on source'
SELECT COUNT(*)::int AS count
  FROM legal_requests lr
  JOIN documents d ON d.issue_key = lr.backlog_issue_key
 WHERE NULLIF(lr.merged_into_issue_key, '') IS NOT NULL
   AND COALESCE(d.lifecycle_status, 'final') = 'final';

SELECT lr.backlog_issue_key AS source_issue_key,
       lr.merged_into_issue_key,
       d.document_number,
       d.template_type
  FROM legal_requests lr
  JOIN documents d ON d.issue_key = lr.backlog_issue_key
 WHERE NULLIF(lr.merged_into_issue_key, '') IS NOT NULL
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
 ORDER BY d.created_at DESC NULLS LAST
 LIMIT 20;

\echo 'A6 non-primary records still marked final'
WITH stale AS (
  SELECT id
    FROM documents
   WHERE COALESCE(is_primary, TRUE) = FALSE
     AND COALESCE(lifecycle_status, 'final') = 'final'
  UNION ALL
  SELECT id
    FROM contract_capabilities
   WHERE COALESCE(is_primary, TRUE) = FALSE
     AND COALESCE(lifecycle_status, 'final') = 'final'
)
SELECT COUNT(*)::int AS count FROM stale;

WITH stale AS (
  SELECT 'documents' AS source,
         id,
         document_number,
         issue_key AS issue_key,
         template_type AS record_type
    FROM documents
   WHERE COALESCE(is_primary, TRUE) = FALSE
     AND COALESCE(lifecycle_status, 'final') = 'final'
  UNION ALL
  SELECT 'contract_capabilities' AS source,
         id,
         document_number,
         backlog_issue_key AS issue_key,
         record_type
    FROM contract_capabilities
   WHERE COALESCE(is_primary, TRUE) = FALSE
     AND COALESCE(lifecycle_status, 'final') = 'final'
)
SELECT * FROM stale ORDER BY source, id DESC LIMIT 20;

\echo 'A7 pub_license_terms without condition_lines'
SELECT COUNT(*)::int AS count
  FROM documents d
  LEFT JOIN contract_capabilities cc
    ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
  LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
 WHERE d.template_type = 'pub_license_terms'
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
   AND COALESCE(d.is_primary, TRUE) = TRUE
   AND cl.id IS NULL;

SELECT d.document_number,
       d.issue_key,
       cc.id AS capability_id
  FROM documents d
  LEFT JOIN contract_capabilities cc
    ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
  LEFT JOIN condition_lines cl ON cl.capability_id = cc.id
 WHERE d.template_type = 'pub_license_terms'
   AND COALESCE(d.lifecycle_status, 'final') = 'final'
   AND COALESCE(d.is_primary, TRUE) = TRUE
   AND cl.id IS NULL
 ORDER BY d.created_at DESC NULLS LAST
 LIMIT 20;
