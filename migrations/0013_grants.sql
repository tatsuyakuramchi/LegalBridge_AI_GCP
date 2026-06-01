-- 0013_grants.sql
-- migration runner は postgres ロールで適用されるため、新テーブル/シーケンスは
-- postgres 所有になる。一方アプリ(worker / search-api)は `legalbridge` ロールで
-- 接続するため、postgres 所有オブジェクトに権限が無く F1 で
--   permission denied for table document_templates (42501)
-- となった。さらに 0012 同期トリガは worker(legalbridge)の旧テーブル書込を契機に
-- 新テーブルへ INSERT/UPDATE するため、legalbridge への DML 付与が必須。
--
-- 本マイグレーションは:
--   1) public スキーマの postgres 所有テーブル/シーケンスを legalbridge へ付与
--      (既存の legalbridge 所有テーブルは対象外＝GRANT 権限エラーを回避)
--   2) 今後 postgres が作るオブジェクトも自動付与されるよう DEFAULT PRIVILEGES を設定
-- いずれも冪等(再付与は無害)。

DO $grant$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tableowner = 'postgres'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO legalbridge', r.tablename);
  END LOOP;

  FOR r IN
    SELECT sequencename FROM pg_sequences
     WHERE schemaname = 'public' AND sequenceowner = 'postgres'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO legalbridge', r.sequencename);
  END LOOP;
END
$grant$;

-- 今後 postgres が public に作るテーブル/シーケンスを legalbridge へ自動付与。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO legalbridge;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO legalbridge;
