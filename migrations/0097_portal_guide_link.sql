-- 0097_portal_guide_link.sql
-- リンク型ガイド: 本文(版)を持たず、既存機能へリンクするガイドを表現する。
--   link_path が設定されたガイドは、ポータル/カテゴリのカードからそのパスへ遷移する
--   (/g/:key も link_path へリダイレクト)。本文版(current_version_id)は不要で公開扱い。
--
--   法務データ検索ガイド(search) は独立ガイドを持たず、search-api 既存の検索
--   (/search/vendor) へ接続する。

ALTER TABLE portal_guides ADD COLUMN IF NOT EXISTS link_path TEXT;

UPDATE portal_guides
   SET link_path = '/search/vendor',
       status    = 'published',
       updated_at = now()
 WHERE guide_key = 'search';
