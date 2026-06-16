-- 0069_royalty_summary_withholding_label.sql
-- 利用許諾料計算書の左下サマリー欄ラベルにも「源泉徴収税計算前」を明示する。
--   今期お支払金額（税込） → 源泉徴収税計算前　お支払予定額（税込）
-- 0068 と同方式: 現行 current_version の html_source を replace して新版に切替。
-- disk テンプレ(templates/royalty_statement.html, services/worker/templates/...) と整合。

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
                 '今期お支払金額（税込）',
                 '源泉徴収税計算前　お支払予定額（税込）'),
         cur.field_schema,
         '源泉徴収税計算前ラベル(サマリー欄)を追加 (0069)', 'migration-0069'
    FROM cur
  RETURNING id, template_id
)
UPDATE document_templates dt SET current_version_id = nv.id, updated_at = now()
  FROM nv WHERE dt.id = nv.template_id;
