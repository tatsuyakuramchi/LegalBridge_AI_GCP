-- 0068_inspection_royalty_withholding_label.sql
-- 検収書 / 利用許諾料計算書のラベルに「源泉徴収税計算前」を明示する。
--   検収書: 今回検収金額(税込) → 源泉徴収税計算前　検収金額(税込)
--           本検収書に基づく総支払額（税込・経費 / 手数料含む）
--             → 源泉徴収税計算前　本検収書に基づく総支払額（税込・経費 / 手数料含む）
--   計算書: 今期お支払合計（税込） → 源泉徴収税計算前　お支払予定額合計（税込）
-- disk テンプレ(services/worker/templates/*.html, templates/*.html) と整合。
-- TEMPLATE_SOURCE=db の worker / search-api(プレビュー) はこの DB 版を読むため、
-- 現行 current_version の html_source を replace して新バージョンを作り current に切替える。
-- ラベル文字列(全角/半角括弧含む)で置換するため属性差分に強い。

-- 検収書 ----------------------------------------------------------------
WITH t AS (
  SELECT id, current_version_id FROM document_templates WHERE template_key = 'inspection_certificate'
),
cur AS (
  SELECT v.template_id, v.html_source, v.field_schema
    FROM document_template_versions v
    JOIN t ON t.current_version_id = v.id
),
nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT cur.template_id,
         COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = cur.template_id), 0) + 1,
         replace(
           replace(cur.html_source,
                   '今回検収金額(税込)',
                   '源泉徴収税計算前　検収金額(税込)'),
           '本検収書に基づく総支払額（税込・経費 / 手数料含む）',
           '源泉徴収税計算前　本検収書に基づく総支払額（税込・経費 / 手数料含む）'),
         cur.field_schema,
         '源泉徴収税計算前ラベルを追加 (0068)', 'migration-0068'
    FROM cur
  RETURNING id, template_id
)
UPDATE document_templates dt SET current_version_id = nv.id, updated_at = now()
  FROM nv WHERE dt.id = nv.template_id;

-- 利用許諾料計算書 ------------------------------------------------------
WITH t AS (
  SELECT id, current_version_id FROM document_templates WHERE template_key = 'royalty_statement'
),
cur AS (
  SELECT v.template_id, v.html_source, v.field_schema
    FROM document_template_versions v
    JOIN t ON t.current_version_id = v.id
),
nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT cur.template_id,
         COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = cur.template_id), 0) + 1,
         replace(cur.html_source,
                 '今期お支払合計（税込）',
                 '源泉徴収税計算前　お支払予定額合計（税込）'),
         cur.field_schema,
         '源泉徴収税計算前ラベルを追加 (0068)', 'migration-0068'
    FROM cur
  RETURNING id, template_id
)
UPDATE document_templates dt SET current_version_id = nv.id, updated_at = now()
  FROM nv WHERE dt.id = nv.template_id;
