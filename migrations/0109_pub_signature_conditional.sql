-- 0109_pub_signature_conditional.sql
-- 出版条件書(pub_license_terms / pub_additional_terms)の許諾者 署名欄を、許諾者種別で出し分ける。
--   個人: {{許諾者}}(氏名)のみ
--   法人: {{許諾者}}(法人名) + 改行 + {{許諾者代表者}}(代表者)
-- あわせて従来の補助注記「（法人の場合は法人名・代表者名）」を撤去する。
--
-- 背景: worker は TEMPLATE_SOURCE=db 時に DB(document_template_versions.html_source)を使う。
--   0108 で署名欄は {{許諾者}}（法人の場合は法人名・代表者名） になっているため、その一意な文字列を
--   Handlebars 条件ブロックへ置換する(冪等・対象文字列のみ・テーブル非存在時 no-op)。
--   ※ 反映には worker 再起動が必要(loadFromDb は起動時キャッシュ)。フォーム項目
--     「許諾者代表者」は disk templates_config を worker 再デプロイで配信。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'document_template_versions'
  ) THEN
    UPDATE document_template_versions
       SET html_source = REPLACE(
             html_source,
             '{{許諾者}}（法人の場合は法人名・代表者名）',
             '{{#if (eq 許諾者種別 "法人")}}{{許諾者}}<br>{{許諾者代表者}}{{else}}{{許諾者}}{{/if}}')
     WHERE html_source LIKE '%{{許諾者}}（法人の場合は法人名・代表者名）%';
  END IF;
END $$;
