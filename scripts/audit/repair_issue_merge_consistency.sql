-- 課題統合後の捻れ補修スクリプト (dry-run付き)
--
-- 対象:
--   A1. documents.issue_key と contract_capabilities.backlog_issue_key の不一致
--   A5. merged_into_issue_key がある source 課題に残る final 文書
--
-- dry-run:
--   psql "$DATABASE_URL" -f scripts/audit/repair_issue_merge_consistency.sql
--
-- apply:
--   psql "$DATABASE_URL" -v apply=1 -f scripts/audit/repair_issue_merge_consistency.sql

\if :{?apply}
\else
  \set apply 0
\endif

\echo 'repair_issue_merge_consistency.sql apply=' :apply

BEGIN;

CREATE TEMP TABLE issue_merge_repair_candidates ON COMMIT DROP AS
WITH merged_source_docs AS (
  SELECT d.id AS document_id,
         d.document_number,
         d.template_type,
         d.issue_key AS source_issue_key,
         lr.merged_into_issue_key AS target_issue_key,
         'merged_source_final_document' AS reason
    FROM legal_requests lr
    JOIN documents d ON d.issue_key = lr.backlog_issue_key
   WHERE NULLIF(lr.merged_into_issue_key, '') IS NOT NULL
     AND COALESCE(d.lifecycle_status, 'final') = 'final'
),
capability_mismatch AS (
  SELECT d.id AS document_id,
         d.document_number,
         d.template_type,
         d.issue_key AS source_issue_key,
         cc.backlog_issue_key AS target_issue_key,
         'document_capability_issue_mismatch' AS reason
    FROM documents d
    JOIN contract_capabilities cc
      ON cc.document_number = COALESCE(NULLIF(d.base_document_number, ''), d.document_number)
   WHERE d.issue_key IS NOT NULL
     AND cc.backlog_issue_key IS NOT NULL
     AND d.issue_key <> cc.backlog_issue_key
),
deduped AS (
  SELECT DISTINCT ON (document_id)
         document_id,
         document_number,
         template_type,
         source_issue_key,
         target_issue_key,
         reason
    FROM (
      SELECT * FROM merged_source_docs
      UNION ALL
      SELECT * FROM capability_mismatch
    ) c
   WHERE NULLIF(target_issue_key, '') IS NOT NULL
     AND source_issue_key <> target_issue_key
   ORDER BY document_id,
            CASE reason
              WHEN 'merged_source_final_document' THEN 0
              ELSE 1
            END
)
SELECT * FROM deduped;

\echo 'candidate counts'
SELECT reason, COUNT(*)::int AS count
  FROM issue_merge_repair_candidates
 GROUP BY reason
 ORDER BY reason;

\echo 'candidate samples'
SELECT document_number,
       template_type,
       source_issue_key,
       target_issue_key,
       reason
  FROM issue_merge_repair_candidates
 ORDER BY reason, document_number
 LIMIT 50;

\if :apply

\echo 'applying document issue_key moves'
UPDATE documents d
   SET issue_key = c.target_issue_key
  FROM issue_merge_repair_candidates c
 WHERE d.id = c.document_id;

\echo 'normalizing target document versions'
WITH affected AS (
  SELECT DISTINCT target_issue_key, template_type
    FROM issue_merge_repair_candidates
   WHERE template_type IS NOT NULL
),
ranked AS (
  SELECT d.id,
         d.document_number,
         d.issue_key,
         d.template_type,
         ROW_NUMBER() OVER w AS rn,
         FIRST_VALUE(d.document_number) OVER w AS primary_document_number
    FROM documents d
    JOIN affected a
      ON a.target_issue_key = d.issue_key
     AND a.template_type = d.template_type
   WHERE COALESCE(d.lifecycle_status, 'final') = 'final'
   WINDOW w AS (
     PARTITION BY d.issue_key, d.template_type
     ORDER BY d.created_at DESC NULLS LAST, d.id DESC
   )
)
UPDATE documents d
   SET is_primary = (ranked.rn = 1),
       lifecycle_status = CASE WHEN ranked.rn = 1 THEN 'final' ELSE 'superseded' END,
       superseded_by = CASE WHEN ranked.rn = 1 THEN NULL ELSE ranked.primary_document_number END
  FROM ranked
 WHERE d.id = ranked.id;

\echo 'syncing capability version flags'
UPDATE contract_capabilities cc
   SET is_primary = d.is_primary,
       lifecycle_status = d.lifecycle_status,
       superseded_by = d.superseded_by,
       updated_at = CURRENT_TIMESTAMP
  FROM documents d
 WHERE cc.document_number = d.document_number
   AND d.issue_key IN (
     SELECT DISTINCT target_issue_key FROM issue_merge_repair_candidates
   );

COMMIT;

\else

\echo 'dry-run only; no changes applied'
ROLLBACK;

\endif
