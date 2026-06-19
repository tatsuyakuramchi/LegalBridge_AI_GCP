-- 0072_inspection_remove_itemno_orderinfo.sql
-- 検収書テンプレートの整理:
--   (1) ヘッダーの「明細No.: ... / 全N件中」行を削除
--   (2) 下段カードの「■ 発注情報」ボックス(発注日/発注番号/明細No.)を削除
-- disk テンプレ(services/worker/templates/inspection_certificate.html, templates/…) と整合。
-- TEMPLATE_SOURCE=db の worker / search-api(プレビュー) はこの DB 版を読むため、
-- current_version の html_source を加工して新バージョンを作り current に切替える。
--
-- itemNo / itemNoList のどちらの記法でも消えるよう regexp_replace で除去する。
--   ・ヘッダー:  改行 + <div>明細No.…</div>(単一行) を丸ごと削除
--   ・発注情報:  <div class="condition-box"> ～ ■ 発注情報 ～ 最初の </div> までを削除
--   (PostgreSQL ARE: 既定で . は改行にマッチ、非貪欲 *? が使える)

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
         regexp_replace(
           regexp_replace(
             cur.html_source,
             -- (1) ヘッダーの 明細No. 行(単一行 div)を改行ごと削除
             E'\\n\\s*<div>明細No\\.[^\\n]*</div>',
             '',
             'g'),
           -- (2) 発注情報の condition-box を丸ごと削除(非貪欲で最初の </div> まで)
           E'\\n\\s*<div class="condition-box">\\s*<h3>■ 発注情報</h3>.*?</div>',
           '',
           'g'),
         cur.field_schema,
         'ヘッダー明細No.行と発注情報ボックスを削除 (0072)', 'migration-0072'
    FROM cur
  RETURNING id, template_id
)
UPDATE document_templates dt SET current_version_id = nv.id, updated_at = now()
  FROM nv WHERE dt.id = nv.template_id;
