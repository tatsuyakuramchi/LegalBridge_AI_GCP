-- Sample data input for testing Contract Check API logic (LegalBridge)
-- Do not run in production unless you wish to seed a test vendor for validation.

-- Create or update sample vendor
INSERT INTO vendors (vendor_code, vendor_name, entity_type)
VALUES ('V-000123', '株式会社サンプル', 'corporate')
ON CONFLICT (vendor_code) DO UPDATE SET 
  vendor_name = EXCLUDED.vendor_name,
  entity_type = EXCLUDED.entity_type;

-- Insert sample contract capabilities linked to the sample vendor
DO $$
DECLARE
  v_id INTEGER;
BEGIN
  -- Clear any old test capabilities for this vendor to allow re-runs
  SELECT id INTO v_id FROM vendors WHERE vendor_code = 'V-000123';
  IF v_id IS NOT NULL THEN
    DELETE FROM contract_capabilities WHERE vendor_id = v_id;
  END IF;

  -- 1. 業務委託基本契約 (master_contract)
  INSERT INTO contract_capabilities (
    vendor_id,
    record_type,
    contract_category,
    contract_type,
    contract_title,
    document_number,
    contract_status,
    effective_date,
    auto_renewal,
    purchase_order_allowed
  ) VALUES (
    v_id,
    'master_contract',
    'service',
    'service_basic',
    '業務委託基本契約書',
    'SB-2026-001',
    'executed',
    '2026-04-01',
    TRUE,
    TRUE
  );

  -- 2. ライセンス基本契約 (master_contract)
  INSERT INTO contract_capabilities (
    vendor_id,
    record_type,
    contract_category,
    contract_type,
    contract_title,
    document_number,
    contract_status,
    effective_date,
    auto_renewal,
    license_condition_allowed
  ) VALUES (
    v_id,
    'master_contract',
    'license',
    'license_basic',
    'ライセンス利用許諾基本契約書',
    'LB-2026-001',
    'executed',
    '2026-04-01',
    TRUE,
    TRUE
  );

  -- 3. ライセンス個別利用許諾条件 (license_condition)
  INSERT INTO contract_capabilities (
    vendor_id,
    record_type,
    contract_category,
    contract_type,
    contract_title,
    contract_status,
    condition_number,
    original_work,
    product_name,
    territory,
    language
  ) VALUES (
    v_id,
    'license_condition',
    'license',
    'license_basic',
    '個別利用許諾条件書 (LIC-2026-001)',
    'executed',
    'LIC-2026-001',
    '対象作品',
    '対象製品',
    '日本',
    '日本語'
  );

  -- 4. 出版個別条件 (publication_condition)
  INSERT INTO contract_capabilities (
    vendor_id,
    record_type,
    contract_category,
    contract_type,
    contract_title,
    contract_status,
    condition_number,
    work_name,
    original_work,
    media,
    territory,
    language,
    scope
  ) VALUES (
    v_id,
    'publication_condition',
    'publication',
    'publication_license',
    '出版個別条件書 (PUB-2026-001)',
    'executed',
    'PUB-2026-001',
    '対象作品',
    '対象作品',
    '紙書籍',
    '日本',
    '日本語',
    '紙媒体出版'
  );

  RAISE NOTICE 'Sample contract capabilities successfully registered for vendor ID %', v_id;
END $$;
