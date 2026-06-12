-- 0058_financial_condition_territory_language.sql
-- 利用許諾条件(capability_financial_conditions)の「地域・言語ラベル」を
-- テリトリー(region_territory) と 言語(region_language) の2項目に分離する。
--
--   - region_language_label は後方互換・表示用に維持(テンプレ変更不要)。
--     保存時に [region_territory, region_language] を '・' 連結して再計算する
--     (worker upsertCapabilityFinancialConditions / フォーム側で合成)。
--   - 既存行は region_language_label を最初の '・' で分割してバックフィル。
--     '・' が無い行は全体をテリトリー扱い。
--
-- テンプレート(purchase_order / individual_license_terms)は引き続き
-- region_language_label を参照するため、document_templates の更新は不要。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS region_territory TEXT,
  ADD COLUMN IF NOT EXISTS region_language  TEXT;

-- 既存行のバックフィル: 合成ラベルを最初の '・' で分割(2項目が未設定の行のみ)。
UPDATE capability_financial_conditions
   SET region_territory = CASE
         WHEN position('・' IN region_language_label) > 0
           THEN btrim(substring(region_language_label
                                FROM 1
                                FOR  position('・' IN region_language_label) - 1))
         ELSE btrim(region_language_label)
       END,
       region_language = CASE
         WHEN position('・' IN region_language_label) > 0
           THEN btrim(substring(region_language_label
                                FROM position('・' IN region_language_label) + char_length('・')))
         ELSE NULL
       END
 WHERE region_language_label IS NOT NULL
   AND btrim(region_language_label) <> ''
   AND COALESCE(region_territory, '') = ''
   AND COALESCE(region_language, '')  = '';
