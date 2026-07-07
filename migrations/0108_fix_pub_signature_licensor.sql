-- 0108_fix_pub_signature_licensor.sql
-- 出版条件書(pub_license_terms / pub_additional_terms)の署名欄を「著作者名」→「許諾者」に修正。
--   署名当事者は許諾者(契約当事者=vendor)であり著作者ではない。個人/法人いずれでも著作者名表示は誤り。
--
-- 背景: worker は TEMPLATE_SOURCE=db のとき DB(document_template_versions.html_source)の
--   テンプレを使う。disk テンプレ(services/worker/templates, root templates)は commit 569a483 で
--   既に修正済みだが、DB 運用では反映されないため本マイグレーションで DB 側も更新する。
--
-- 方針: 対象文字列のみを REPLACE(冪等・履歴含む全 version・他の編集は壊さない)。
--   document_template_versions が存在しない構成(disk 運用)では何もしない(no-op)。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'document_template_versions'
  ) THEN
    UPDATE document_template_versions
       SET html_source = REPLACE(
             html_source,
             '{{著作者名}}（法人の場合は法人名・代表者名）',
             '{{許諾者}}（法人の場合は法人名・代表者名）')
     WHERE html_source LIKE '%{{著作者名}}（法人の場合は法人名・代表者名）%';
  END IF;
END $$;
