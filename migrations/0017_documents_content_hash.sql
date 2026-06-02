-- 0017_documents_content_hash.sql
-- 文書の重複登録防止のための内容ハッシュ列。
-- 「文書作成→保存」が毎回あたらしい document_number を採番して同一内容の行を
-- 量産していた問題への対策(発生源を断つ)の一部。
-- content_hash = sha256(template_type + 正規化した form_data[__系を除く])。
-- worker は新規保存時に「同一(起票×種別 or content_hash 一致)の正本」が
-- あれば再採番せずその番号を上書きする。
-- additive・冪等。

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- 正本(現行)を素早く引くための複合索引。
CREATE INDEX IF NOT EXISTS idx_documents_dedup
  ON documents(template_type, content_hash)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_documents_issue_template
  ON documents(issue_key, template_type)
  WHERE is_primary = TRUE;
