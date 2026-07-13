-- 0122_contract_capabilities_master_ref.sql
-- 一括インポートで文書(器)に「基本契約への参照」を持たせるための列。
--   注: 0101 で contract_capabilities はテーブルから documents 上の VIEW に置き換わった。
--   したがって ALTER は実体テーブル `documents` に対して行う(view には ADD COLUMN 不可)。
--   contract_capabilities VIEW は `SELECT ... FROM documents`(WHERE なしの 1:1 ミラー)のため、
--   読み取りは documents を直接 JOIN すれば足り、view の再定義は不要。
--   個別契約/利用許諾条件書が、どの基本契約(master agreement)の下にあるかを文書番号で参照する。
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS master_document_number VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_documents_master_document_number
  ON documents(master_document_number);
