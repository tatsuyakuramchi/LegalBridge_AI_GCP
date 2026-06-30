-- 0093_portal_guides.sql
-- 法務ポータル(GAS 移植)のガイドを DB 化する器。
-- 設計: legalbridge-portal-migration。document_templates(0002) と同じ
--   「head + 不変の版履歴 + current_version ポインタ」パターン。
--   - worker が版を書込・current_version_id を貼替(差し替え=新版追加)
--   - search-api が読取・配信(GAS 原文を配信時に portalRender で変換)
--   - HTML 本体の初期投入は migrations/sync-guides-to-db.mjs(ファイル→DB)
--     本マイグレーションはメタ(0094 seed)のみで、html_source は持たない。

-- ── カテゴリ(ポータル直下の層。A〜D)。順序・色・説明を持つ。
CREATE TABLE IF NOT EXISTS portal_guide_categories (
  id           SERIAL PRIMARY KEY,
  cat_key      VARCHAR(40) UNIQUE NOT NULL,  -- transactions/contracts/lookup/compliance
  label        TEXT NOT NULL,                -- "A. 取引を進める"
  color        VARCHAR(12),                  -- "#27500a"
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ガイド(head)。is_overview=ご利用案内(カテゴリに属さない特別ページ)。
--    status: draft(準備中) / published(公開中) / archived。
--    needs_runtime: GAS の google.script.run 等ランタイム依存があり、配信は
--      できるが対話部分は要改修であることを管理画面で可視化するためのフラグ。
CREATE TABLE IF NOT EXISTS portal_guides (
  id                 SERIAL PRIMARY KEY,
  guide_key          VARCHAR(60) UNIQUE NOT NULL, -- bg/pub/.../guide
  category_id        INTEGER REFERENCES portal_guide_categories(id),
  guide_num          VARCHAR(8),                  -- "05"
  title              TEXT NOT NULL,
  summary            TEXT,                        -- カードの説明文
  is_overview        BOOLEAN NOT NULL DEFAULT FALSE,
  current_version_id INTEGER,                     -- → versions(下で FK 付与)
  status             VARCHAR(16) NOT NULL DEFAULT 'draft',
  needs_runtime      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 不変の版履歴。html_source=GAS 原文をそのまま保存(配信時に変換)。
CREATE TABLE IF NOT EXISTS portal_guide_versions (
  id          SERIAL PRIMARY KEY,
  guide_id    INTEGER NOT NULL REFERENCES portal_guides(id) ON DELETE CASCADE,
  version_no  INTEGER NOT NULL,
  html_source TEXT NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  UNIQUE (guide_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_pgv_guide        ON portal_guide_versions(guide_id);
CREATE INDEX IF NOT EXISTS idx_portal_guides_cat ON portal_guides(category_id);
CREATE INDEX IF NOT EXISTS idx_portal_guides_status ON portal_guides(status);

-- 循環参照(guides.current_version_id → versions.id, versions.guide_id → guides.id)。
-- 両テーブル作成後に FK を付与(document_templates 0002 と同手法)。
DO $pg_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_guides_current_version_fk'
  ) THEN
    ALTER TABLE portal_guides
      ADD CONSTRAINT portal_guides_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES portal_guide_versions(id);
  END IF;
END
$pg_fk$;

-- 読取ロール(lb_read=search-api)に SELECT 権限を付与(存在すれば)。
DO $pg_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lb_read') THEN
    GRANT SELECT ON portal_guide_categories, portal_guides, portal_guide_versions TO lb_read;
  END IF;
END
$pg_grant$;
