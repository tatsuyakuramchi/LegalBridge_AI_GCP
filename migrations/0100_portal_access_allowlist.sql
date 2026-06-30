-- 0100_portal_access_allowlist.sql
-- 外部アドレス許可リスト(アプリ側)を DB 化し、管理画面から編集可能にする。
--   従来は env LB_ROLE_ALLOWLIST_EMAILS(再デプロイ必要)。本テーブルは
--   search-api の管理画面(/admin/access)から追加/削除でき、auth が参照する。
--   ※ これはアプリのロール審査用 allowlist。IAP(GCP エッジ)のドメイン制限は
--      別途 IAM での許可が必要(本テーブルは IAP を制御しない)。

CREATE TABLE IF NOT EXISTS portal_access_allowlist (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  note        TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

-- 既存 env(LB_ROLE_ALLOWLIST_EMAILS)の初期メンバーを移行投入。
INSERT INTO portal_access_allowlist (email, note, created_by)
VALUES ('koktaa-s@kadokawa.jp', '初期登録（env LB_ROLE_ALLOWLIST_EMAILS から移行）', 'migration')
ON CONFLICT (email) DO NOTHING;

DO $pa_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lb_read') THEN
    GRANT SELECT ON portal_access_allowlist TO lb_read;
  END IF;
END
$pa_grant$;
