-- 0122_contract_capabilities_master_ref.sql
-- 一括インポートで器(contract_capabilities)に「基本契約への参照」を持たせるための列。
--   個別契約/利用許諾条件書が、どの基本契約(master agreement)の下にあるかを文書番号で参照する。
--   既存の base_document_number は版チェーン用のため流用せず、専用列を追加する(冪等)。
ALTER TABLE contract_capabilities
  ADD COLUMN IF NOT EXISTS master_document_number VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_cc_master_document_number
  ON contract_capabilities(master_document_number);
