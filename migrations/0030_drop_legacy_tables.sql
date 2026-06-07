-- 0030_drop_legacy_tables.sql
-- データモデル整理 Step2: レガシーテーブルの撤去。
--
-- 撤去対象(いずれも Phase23 で現行スキーマへ統合済み):
--   order_items / order_line_items
--       → contract_capabilities / capability_line_items (record_type='purchase_order')
--   license_contracts / license_financial_conditions
--       → contract_capabilities / capability_financial_conditions (contract_category='license')
--
-- 安全確認(2026-06-07 コード棚卸し):
--   - 現行コードに CREATE TABLE 文なし(起動時に再生成されない)
--   - 残存 FK 制約なし(Phase23.6.5 で参照側 FK は撤去済み、列は plain INTEGER で残置)
--   - アプリの実 SQL 参照なし(唯一の参照は to_regclass ガード付きバックフィルのみ)
--   - 新規 DB には存在しない(baseline 0001 も CREATE しない)
--
-- 冪等: DROP TABLE IF EXISTS ... CASCADE。CASCADE は当該レガシー表に依存する
--   ビュー/FK制約等のみを除去し、他テーブルの列自体は削除しない。

-- 1) 撤去前の取りこぼし防止: license_contracts が残る環境では
--    royalty_calculations.capability_id のバックフィルを最終再実行(idempotent)。
DO $rc_backfill_final$
BEGIN
  IF to_regclass('public.license_contracts') IS NOT NULL THEN
    UPDATE royalty_calculations rc
       SET capability_id = cc.id
      FROM license_contracts lc
      JOIN contract_capabilities cc
        ON cc.document_number = COALESCE(lc.contract_number, lc.ledger_number, lc.work_id)
     WHERE rc.license_contract_id = lc.id
       AND rc.capability_id IS NULL
       AND cc.document_number IS NOT NULL;
  END IF;
END
$rc_backfill_final$;

-- 2) 撤去(子→親順、IF EXISTS + CASCADE で冪等)
DROP TABLE IF EXISTS order_line_items CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS license_financial_conditions CASCADE;
DROP TABLE IF EXISTS license_contracts CASCADE;
