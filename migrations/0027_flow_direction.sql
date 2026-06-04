-- 0027_flow_direction.sql
-- 契約/明細に「方向(in/out)」を別軸で追加する(ユーザー決定)。
--   in  = 当社が受ける側(被許諾者・仕入) → 支払/条件明細で管理
--   out = 当社が出す側(許諾者・製造卸)   → 請求台帳(請求権)で管理
--
-- ジャンル表示は 種別(contract_category: license/publication/sales/service) × 方向
-- の2軸で「ライセンスイン/アウト・プロダクトイン/アウト」等を表現する。
-- 既存の license/publication/service データはそのまま活かす(additive)。
--
-- out 明細は方向から自動で請求台帳へ取込(importInboundConditions が
-- flow_direction='out' OR is_inbound を受領明細として扱う)。
--
-- 参照先 contract_capabilities / capability_line_items(0001)。冪等。

ALTER TABLE contract_capabilities
  ADD COLUMN IF NOT EXISTS flow_direction VARCHAR(10);   -- 'in' / 'out'
ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS flow_direction VARCHAR(10);   -- 'in' / 'out'(未設定=null)

-- 既に向き付き category(license_in/license_out 等)を持つ場合は backfill。
UPDATE contract_capabilities SET flow_direction = 'out'
 WHERE flow_direction IS NULL AND contract_category ILIKE '%\_out';
UPDATE contract_capabilities SET flow_direction = 'in'
 WHERE flow_direction IS NULL AND contract_category ILIKE '%\_in';

-- 既存の受領(inbound)明細は out とみなす。
UPDATE capability_line_items SET flow_direction = 'out'
 WHERE flow_direction IS NULL AND is_inbound = TRUE;

CREATE INDEX IF NOT EXISTS idx_cli_flow ON capability_line_items(flow_direction);
CREATE INDEX IF NOT EXISTS idx_cc_flow ON contract_capabilities(flow_direction);
