-- 0067: 検収書 / 利用許諾料計算書 のメール送信(Gmail API)記録用カラム。
--   email_sent_at … 送信時刻(search-api の「送信時間」表示に使用)
--   email_to      … 送信宛先(カンマ区切り)
--   email_message_id … Gmail messageId(監査用)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_to TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_message_id TEXT;
