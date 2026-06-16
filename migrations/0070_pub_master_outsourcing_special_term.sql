-- 0070_pub_master_outsourcing_special_term.sql
-- 出版等許諾基本契約書(個人版/法人版)の頭書「特記事項」欄に、業務委託の
-- デフォルト特約を追加する。
--   「本著作物に関連する執筆・修正等の業務を委託する場合は別途発注書を発行し、
--     委託条件は当該発注書に定める」
-- disk テンプレ(templates/pub_master_*.html, services/worker/templates/...) と整合。
-- 現行 current_version の html_source を replace して新版に切替(0068/0069 と同方式)。

DO $$
DECLARE
  k TEXT;
  old_cell CONSTANT TEXT := '<td colspan="2" class="special-cell">{{特記事項}}</td>';
  new_cell CONSTANT TEXT := '<td colspan="2" class="special-cell">１．本著作物に関連する執筆、加筆、修正、校正その他の業務を委託する場合、被許諾者は別途発注書を発行するものとし、委託条件（業務内容、報酬、納期、成果物の取扱い等）は当該発注書に定める。{{#if 特記事項}}<br>{{特記事項}}{{/if}}</td>';
BEGIN
  FOREACH k IN ARRAY ARRAY['pub_master_individual', 'pub_master_corporate'] LOOP
    WITH t AS (
      SELECT id, current_version_id FROM document_templates WHERE template_key = k
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
             replace(cur.html_source, old_cell, new_cell),
             cur.field_schema,
             '業務委託の発注書特約を特記事項に追加 (0070)', 'migration-0070'
        FROM cur
      RETURNING id, template_id
    )
    UPDATE document_templates dt SET current_version_id = nv.id, updated_at = now()
      FROM nv WHERE dt.id = nv.template_id;
  END LOOP;
END $$;
