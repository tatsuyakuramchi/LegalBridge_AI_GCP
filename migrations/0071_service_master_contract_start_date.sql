-- 0071_service_master_contract_start_date.sql
-- 業務委託基本契約書(service_master)の緊急修正:
--   (1) 第14条1 の文言変更
--       本契約の有効期間は、{{CONTRACT_PERIOD_SUMMARY}}とする。
--         → 本契約期間は頭書き基本条件の契約開始日から１年間とする。
--   (2) 頭書「契約期間」欄を契約開始日ベースに変更({{CONTRACT_START_DATE}}から1年間)
--   (3) 相談窓口情報の「メール」行を削除
--   (4) フォーム項目 CONTRACT_START_DATE(契約開始日, date) を field_schema に追加
-- disk テンプレ(templates/service_master.html, services/worker/templates/...) と整合。
-- 現行 current_version の html_source/field_schema を更新して新版に切替(0068-0070 と同方式)。

WITH t AS (
  SELECT id, current_version_id FROM document_templates WHERE template_key = 'service_master'
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
         -- (1)(2)(3) を順に置換
         replace(
           replace(
             replace(cur.html_source,
                     '本契約の有効期間は、{{CONTRACT_PERIOD_SUMMARY}}とする。',
                     '本契約期間は頭書き基本条件の契約開始日から１年間とする。'),
             '<td class="col-value">{{CONTRACT_PERIOD_SUMMARY}}</td>',
             '<td class="col-value">{{CONTRACT_START_DATE}}（契約開始日）から１年間</td>'),
           $del$                        <br>WEBフォーム: https://koueki-tsuhou.com/slmfze8pka9s/
                        <br>メール: [email protected]
                        <br>電話: 0120-996-206（平日8:30~19:00、土曜8:30~17:00）$del$,
           $ins$                        <br>WEBフォーム: https://koueki-tsuhou.com/slmfze8pka9s/
                        <br>電話: 0120-996-206（平日8:30~19:00、土曜8:30~17:00）$ins$),
         -- (4) field_schema に契約開始日を追加(既に存在する場合は重複させない)
         CASE
           WHEN cur.field_schema @> '[{"name":"CONTRACT_START_DATE"}]'::jsonb THEN cur.field_schema
           ELSE cur.field_schema || $f$[{"name":"CONTRACT_START_DATE","label":"契約開始日","type":"date","group":"I. 契約締結日","required":true,"helpText":"頭書の契約期間と第14条に反映されます（同日から1年間）"}]$f$::jsonb
         END,
         '業務委託基本契約: 契約開始日フォーム + 第14条文言 + 相談窓口メール削除 (0071)', 'migration-0071'
    FROM cur
  RETURNING id, template_id
)
UPDATE document_templates dt SET current_version_id = nv.id, updated_at = now()
  FROM nv WHERE dt.id = nv.template_id;
