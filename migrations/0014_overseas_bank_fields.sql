-- 0014_overseas_bank_fields.sql
-- 振込先(vendor_bank_accounts)に海外送金用フィールドを追加。
-- 既存の国内項目(bank_name/branch_name/account_type/account_number/
-- account_holder_kana)は domestic 用として残し、account_scope で国内/海外を区別。
-- 全て additive・冪等(IF NOT EXISTS / DEFAULT)。

ALTER TABLE vendor_bank_accounts
  ADD COLUMN IF NOT EXISTS account_scope VARCHAR(20) DEFAULT 'domestic',  -- 'domestic' | 'overseas'
  ADD COLUMN IF NOT EXISTS swift_bic VARCHAR(20),                         -- SWIFT/BIC コード
  ADD COLUMN IF NOT EXISTS iban VARCHAR(64),                              -- IBAN(欧州等)
  ADD COLUMN IF NOT EXISTS routing_number VARCHAR(40),                    -- ABA/sort code 等
  ADD COLUMN IF NOT EXISTS account_holder_name TEXT,                      -- 英字名義(海外)
  ADD COLUMN IF NOT EXISTS bank_country VARCHAR(2),                       -- ISO 3166-1 alpha-2
  ADD COLUMN IF NOT EXISTS bank_address TEXT,                             -- 銀行所在地(英字)
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3),                           -- ISO 4217 (USD/EUR…)
  ADD COLUMN IF NOT EXISTS intermediary_bank_swift VARCHAR(20),           -- 中継銀行 SWIFT
  ADD COLUMN IF NOT EXISTS intermediary_bank_name TEXT;                   -- 中継銀行名

-- 既存行は国内扱い(DEFAULT 'domestic' が入るが、過去行を明示更新して NULL を排除)。
UPDATE vendor_bank_accounts SET account_scope = 'domestic' WHERE account_scope IS NULL;
