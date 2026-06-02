-- 0018_dedup_documents.sql
-- 既存の「同じ内容の文書が複数登録された」重複を物理削除する(方針: 物理削除)。
--
-- 削除基準(安全側):同 issue_key × template_type で、正規化した form_data
--   (__系の制御キーを除外)が *完全一致* するクラスタごとに
--     「現行(is_primary かつ final)→ 最新(created_at, id)」を 1 件だけ残し、
--     残りを削除する。
--   → 削除される行には必ず内容同一の生存行があるため情報欠落はない。
--   → 内容の異なる正規の再発行版(_NNN)は別クラスタなので残る。
--   → MANUAL- 起票・issue_key 空は対象外(取り違え防止。今後は content_hash で抑止)。
--
-- 連動削除:
--   contract_capabilities の子(capability_line_items / _financial_conditions /
--     _expenses / _other_fees)は ON DELETE CASCADE。
--   ringi_documents は documents への FK が ON DELETE CASCADE。
--   CASCADE 無しの参照(delivery_events.capability_id /
--     royalty_calculations.capability_id / signature_requests.document_id)は
--     削除前に NULL 化して RESTRICT を回避する(重複コピー側の参照を外すだけ)。
--
-- 実行前に migrations/dedup_report.sql の「C. 削除対象_余剰行数」を必ず確認すること。
-- 各 migration は単一トランザクションで実行され、失敗時は全ロールバックされる。

-- 1) 削除対象の documents(id, document_number)
CREATE TEMP TABLE _dup_del ON COMMIT DROP AS
WITH norm AS (
  SELECT id, document_number, issue_key, template_type, created_at,
         (CASE WHEN jsonb_typeof(form_data) = 'object'
               THEN form_data - '__pdf_pending' - '__reopen_doc_number' - '__from_pending_doc_number'
               ELSE COALESCE(form_data, '{}'::jsonb) END) AS fd,
         (COALESCE(is_primary, TRUE) AND COALESCE(lifecycle_status, 'final') = 'final') AS is_current
    FROM documents
   WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
),
ranked AS (
  SELECT id, document_number,
         row_number() OVER (PARTITION BY issue_key, template_type, fd
                            ORDER BY is_current DESC, created_at DESC, id DESC) AS rn
    FROM norm
)
SELECT id AS doc_id, document_number
  FROM ranked
 WHERE rn > 1;

-- 2) 削除対象に対応する contract_capabilities の id
CREATE TEMP TABLE _dup_caps ON COMMIT DROP AS
SELECT id
  FROM contract_capabilities
 WHERE document_number IN (SELECT document_number FROM _dup_del);

-- 3) CASCADE 無し参照を外す(重複コピー側の参照のみ NULL 化)
UPDATE delivery_events
   SET capability_id = NULL
 WHERE capability_id IN (SELECT id FROM _dup_caps);

UPDATE royalty_calculations
   SET capability_id = NULL
 WHERE capability_id IN (SELECT id FROM _dup_caps);

UPDATE signature_requests
   SET document_id = NULL
 WHERE document_id IN (SELECT doc_id FROM _dup_del);

-- 4) contract_capabilities 削除(子テーブルは ON DELETE CASCADE で連動)
DELETE FROM contract_capabilities
 WHERE id IN (SELECT id FROM _dup_caps);

-- 5) documents 本体削除(ringi_documents は ON DELETE CASCADE で連動)
DELETE FROM documents
 WHERE id IN (SELECT doc_id FROM _dup_del);
