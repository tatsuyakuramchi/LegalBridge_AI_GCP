-- 0022_vendor_pii_consent.sql
-- 取引先(個人事業主・フリーランス)について「個人情報取得同意」を取得済みかの
-- フラグと同意日を追加。文書作成時に同意書を同時生成したら自動ON+同意日記録する。
-- additive・冪等。vendors は 0001。

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pii_consent_obtained BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pii_consent_date DATE;

CREATE INDEX IF NOT EXISTS idx_vendors_pii_consent ON vendors(pii_consent_obtained);
