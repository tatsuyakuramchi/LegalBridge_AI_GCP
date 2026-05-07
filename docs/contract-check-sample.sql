-- Sample Seed Data for Contract Check API testing

-- 1. Insert Sample Vendor
INSERT INTO vendors (vendor_code, vendor_name, trade_name, entity_type)
VALUES ('V-SAN-001', '株式会社サンプル', 'サンプル', 'corporate')
ON CONFLICT (vendor_code) DO NOTHING;

-- Get the ID of the inserted vendor
-- (Assuming ID is 1 for a clean DB, but better to use a subquery if possible)

-- 2. Insert Master Contracts
INSERT INTO contract_capabilities 
(vendor_id, record_type, contract_category, contract_type, contract_title, document_number, contract_status, effective_date, auto_renewal)
SELECT 
  id, 
  'master_contract', 
  'service', 
  'service_basic', 
  '業務委託基本契約書', 
  'SB-2026-001', 
  'executed', 
  '2026-04-01', 
  TRUE
FROM vendors WHERE vendor_code = 'V-SAN-001'
ON CONFLICT DO NOTHING;

INSERT INTO contract_capabilities 
(vendor_id, record_type, contract_category, contract_type, contract_title, document_number, contract_status, effective_date, auto_renewal)
SELECT 
  id, 
  'master_contract', 
  'license', 
  'license_basic', 
  'ライセンス利用許諾基本契約書', 
  'LB-2026-001', 
  'executed', 
  '2026-04-01', 
  TRUE
FROM vendors WHERE vendor_code = 'V-SAN-001'
ON CONFLICT DO NOTHING;

-- 3. Insert License Condition
INSERT INTO contract_capabilities 
(vendor_id, record_type, contract_category, contract_type, contract_title, condition_number, original_work, product_name, territory, language, contract_status)
SELECT 
  id, 
  'license_condition', 
  'license', 
  'license_basic', 
  '個別利用許諾条件書', 
  'LIC-2026-001', 
  '対象作品', 
  '対象製品', 
  '日本', 
  '日本語', 
  'executed'
FROM vendors WHERE vendor_code = 'V-SAN-001'
ON CONFLICT DO NOTHING;

-- 4. Insert Publication Condition
INSERT INTO contract_capabilities 
(vendor_id, record_type, contract_category, contract_type, contract_title, condition_number, original_work, media, territory, language, scope, contract_status)
SELECT 
  id, 
  'publication_condition', 
  'publication', 
  'publication_license', 
  '出版契約書', 
  'PUB-2026-001', 
  '対象作品', 
  '紙書籍', 
  '日本', 
  '日本語', 
  '紙媒体出版', 
  'executed'
FROM vendors WHERE vendor_code = 'V-SAN-001'
ON CONFLICT DO NOTHING;
