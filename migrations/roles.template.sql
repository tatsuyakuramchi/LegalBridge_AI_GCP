-- roles.template.sql — DB ロール定義テンプレート(手動適用 / 自動ランナー対象外)
--
-- 重要: このファイルは `NNNN_*.sql` 命名ではないため migration runner には
-- 拾われない。ロール作成はパスワード(Secret Manager 管理)を伴うため、
-- DBA が値を差し込んで手動適用する。GRANT の本格適用は D1 書込所有
-- (service-architecture §7)を実装する Phase 3 で行う。
--
-- 3ロール(service-architecture §8.4):
--   lb_migrate : DDL 専用(この runner が使用)
--   lb_search  : Search サービス(自所有テーブルに DML + 全体 SELECT/ビュー)
--   lb_worker  : worker サービス(自所有テーブルに DML + 互換ビュー SELECT)

-- 1) ロール作成(パスワードは環境ごとに差し替え。Secret Manager から注入)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lb_migrate') THEN
    CREATE ROLE lb_migrate LOGIN PASSWORD :'lb_migrate_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lb_search') THEN
    CREATE ROLE lb_search LOGIN PASSWORD :'lb_search_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lb_worker') THEN
    CREATE ROLE lb_worker LOGIN PASSWORD :'lb_worker_pw';
  END IF;
END
$$;

-- 2) スキーマ接続 + 既定の SELECT(暫定。Phase 3 で所有別に厳格化)
GRANT CONNECT ON DATABASE :"db_name" TO lb_search, lb_worker, lb_migrate;
GRANT USAGE ON SCHEMA public TO lb_search, lb_worker, lb_migrate;

-- lb_migrate: DDL を持つ(= テーブル所有者相当)
GRANT ALL ON SCHEMA public TO lb_migrate;

-- 暫定: 既存テーブルへ read。書込所有の厳格分離(table 単位 GRANT)は
-- Phase 3(C5/D1)で migrations/00NN_grants.sql として版管理する。
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO lb_search, lb_worker;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lb_search, lb_worker;

-- 適用例(psql 変数で値を注入):
--   psql "$ADMIN_DATABASE_URL" \
--     -v lb_migrate_pw="'***'" -v lb_search_pw="'***'" -v lb_worker_pw="'***'" \
--     -v db_name=legalbridge \
--     -f migrations/roles.template.sql
