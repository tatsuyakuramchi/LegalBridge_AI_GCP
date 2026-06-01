-- 0010_backfill_source_ips.sql
-- ledgers/materials → source_ips/source_ip_materials(id保存・冪等)+
-- contract_works(ledger_ref_id由来)+ contract_parties(additional_parties由来)。
-- 判別: ledgers は source_ips へ(構造一致)。works は今後 Search で登録。

-- 1) ledgers → source_ips(id保存)
INSERT INTO source_ips (
  id, source_code, title, title_kana, alternative_titles, rights_holder_vendor_id,
  original_publisher, default_rights_holder, default_credit_display, default_work_supplement,
  default_approval_target, default_approval_timing, remarks, is_active, created_at, updated_at
)
SELECT
  l.id, l.ledger_code, l.title, l.title_kana, COALESCE(l.alternative_titles, '{}'), NULL,
  l.publisher_name, COALESCE(l.default_rights_holder, l.creator_name), l.default_credit_display,
  l.default_work_supplement, l.default_approval_target, l.default_approval_timing,
  l.remarks, COALESCE(l.is_active, TRUE), l.created_at, l.updated_at
FROM ledgers l
WHERE NOT EXISTS (SELECT 1 FROM source_ips s WHERE s.id = l.id);

-- 2) materials → source_ip_materials(id保存, source_ip_id=ledger_id)
INSERT INTO source_ip_materials (
  id, source_ip_id, material_no, material_code, material_name, material_type,
  rights_holder_vendor_id, rights_holder_label, remarks, is_default, is_active, created_at, updated_at
)
SELECT
  m.id, m.ledger_id, m.material_no, m.material_code, m.material_name, m.material_type,
  NULL, m.rights_holder, m.remarks, COALESCE(m.is_default, FALSE), COALESCE(m.is_active, TRUE),
  m.created_at, m.updated_at
FROM materials m
WHERE EXISTS (SELECT 1 FROM source_ips s WHERE s.id = m.ledger_id)
  AND NOT EXISTS (SELECT 1 FROM source_ip_materials t WHERE t.id = m.id);

-- 3) contract_works: contract_capabilities.ledger_ref_id → 契約⇔原作IP
INSERT INTO contract_works (contract_id, source_ip_id, role)
SELECT
  cc.id, cc.ledger_ref_id,
  CASE
    WHEN cc.contract_category LIKE 'license%'      THEN 'licensed_in'
    WHEN cc.contract_category = 'publication'      THEN 'publication_target'
    ELSE 'service_target'
  END
FROM contract_capabilities cc
WHERE cc.ledger_ref_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM contracts c  WHERE c.id = cc.id)
  AND EXISTS (SELECT 1 FROM source_ips s WHERE s.id = cc.ledger_ref_id)
  AND NOT EXISTS (
    SELECT 1 FROM contract_works cw
     WHERE cw.contract_id = cc.id AND cw.source_ip_id = cc.ledger_ref_id
  );

-- 4) contract_parties: contract_capabilities.additional_parties(JSONB配列)→ 当事者
INSERT INTO contract_parties (contract_id, vendor_id, party_role, sort_order)
SELECT
  cc.id,
  (elem->>'vendor_id')::int,
  COALESCE(NULLIF(elem->>'role', ''), 'secondary'),
  COALESCE((row_number() OVER (PARTITION BY cc.id))::int, 0)
FROM contract_capabilities cc
CROSS JOIN LATERAL jsonb_array_elements(cc.additional_parties) AS elem
WHERE jsonb_typeof(cc.additional_parties) = 'array'
  AND (elem->>'vendor_id') ~ '^[0-9]+$'
  AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = cc.id)
  AND EXISTS (SELECT 1 FROM vendors v WHERE v.id = (elem->>'vendor_id')::int)
  AND NOT EXISTS (
    SELECT 1 FROM contract_parties cp
     WHERE cp.contract_id = cc.id AND cp.vendor_id = (elem->>'vendor_id')::int
  );

-- 5) シーケンス整合
SELECT setval(pg_get_serial_sequence('source_ips', 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM source_ips),1));
SELECT setval(pg_get_serial_sequence('source_ip_materials', 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM source_ip_materials),1));
SELECT setval(pg_get_serial_sequence('contract_works', 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM contract_works),1));
SELECT setval(pg_get_serial_sequence('contract_parties', 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM contract_parties),1));
