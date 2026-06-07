-- 0038_products_attributes.sql
-- 整理①の決定: 作品固有属性(ジャンル/対象年齢/プレイ人数/判型 等)は products(製品)側に持たせる。
--   柔軟性のため JSONB の汎用 attributes 列を追加(additive)。
-- 併せて整理①で「廃止」決定の works.publisher_vendor_id / works.is_original は
--   トリガ(0035)・既存マイグレーションが参照するため、本フェーズでは物理DROPせず
--   UI/API から外すのみ(=deprecated)。物理DROPは後続クリーンアップで実施。

ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
