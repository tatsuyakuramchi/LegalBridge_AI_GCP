-- 0105_backfill_contract_category.sql
-- documents.contract_category が NULL/空 の契約を、判別可能な手掛かりから補完する（一度きり）。
--   背景: 0101 で旧 contract_capabilities を破棄し documents へ統合した際、既存行の
--   contract_category が NULL のまま残った。Master 編集フォームは contract_category で
--   条件明細の入力欄を出し分けるため、NULL だと欄が出ない（プルダウンは既定 'service' に
--   見えるのに欄が出ない不整合。フロント側は || 'service' に統一済み）。
--   ここでは値そのものを妥当に埋め、再選択の手間をなくす。
--   優先順: template_family(既知カテゴリ) → template_type/contract_type から推定。
--   対象は契約系の行のみ(record_type IS NOT NULL)。冪等（NULL/空のみ更新）。非破壊。

BEGIN;

UPDATE documents SET contract_category = CASE
  WHEN lower(coalesce(template_family, '')) IN ('license','service','mixed','publication','sales','nda')
       THEN lower(template_family)
  WHEN lower(coalesce(template_type, '')) ~ '^pub_'                     THEN 'publication'
  WHEN lower(coalesce(template_type, '')) ~ 'license|royalty|ilt'
       OR lower(coalesce(contract_type, '')) ~ 'license'               THEN 'license'
  WHEN lower(coalesce(contract_type, '')) ~ 'nda'
       OR lower(coalesce(template_type, '')) ~ 'nda'                    THEN 'nda'
  WHEN lower(coalesce(template_type, '')) ~ 'purchase_order|inspection|delivery|invoice'
       OR lower(coalesce(contract_type, '')) ~ 'service|outsourc'      THEN 'service'
  ELSE 'service'
END
WHERE (contract_category IS NULL OR btrim(contract_category) = '')
  AND record_type IS NOT NULL;

COMMIT;
