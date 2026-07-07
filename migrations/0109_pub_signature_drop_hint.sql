-- 0109_pub_signature_drop_hint.sql
-- 出版条件書(pub_license_terms / pub_additional_terms)の署名欄から、補助注記
--   「（法人の場合は法人名・代表者名）」を削除する。許諾者名は {{許諾者}} で自動表示されるため、
--   PDF 上にこの案内文は残すべきでない(個人選択時に不自然)。
--
-- 0108 で {{著作者名}}（…）→ {{許諾者}}（…）に置換済みのため、本マイグレーションは
--   {{許諾者}}（…）→ {{許諾者}} に置換する。TEMPLATE_SOURCE=db 運用の DB テンプレを更新。
--   冪等・対象文字列のみ・テーブル非存在時は no-op。
-- ※ 反映には worker 再起動が必要(loadFromDb は起動時キャッシュ)。

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
             '{{許諾者}}')
     WHERE html_source LIKE '%{{許諾者}}（法人の場合は法人名・代表者名）%';
  END IF;
END $$;
