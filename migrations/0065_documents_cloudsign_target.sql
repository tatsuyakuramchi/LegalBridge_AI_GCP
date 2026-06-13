-- 0065_documents_cloudsign_target.sql
-- 文書ごとに「クラウドサイン対象 / 対象外」を持つフラグ。
--   対象外の例: 紙で締結する、相手方の電子契約サービスを使う 等。
--   既定は TRUE(対象)。送信ボタンはこのフラグが TRUE の文書のみ有効。
ALTER TABLE documents ADD COLUMN IF NOT EXISTS cloudsign_target BOOLEAN DEFAULT TRUE;
