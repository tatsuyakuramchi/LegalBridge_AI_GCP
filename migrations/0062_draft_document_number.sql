-- 0062_draft_document_number.sql
-- 発番タイミングを「初回保存(下書きのサーバ保存)」に変更するための土台。
--   document_drafts に document_number 列を追加し、初回サーバ保存時に採番して保持する。
--   生成(Finalize)時はこの番号を existingDocumentNumber として流用する
--   (getDocumentNumberForGenerate は documents 行が未作成のとき渡された番号を初版として使う)。
--
--   ※ 途中破棄された下書きの番号は欠番になる(発番タイミング変更の副作用・承知の上)。

ALTER TABLE document_drafts
  ADD COLUMN IF NOT EXISTS document_number VARCHAR(100);

-- 下書き一覧/呼び出しで番号検索しやすいように索引を張る。
CREATE INDEX IF NOT EXISTS idx_document_drafts_docnum
  ON document_drafts(document_number);
