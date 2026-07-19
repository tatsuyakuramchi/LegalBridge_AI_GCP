-- 0142_works_original_metadata.sql
-- Phase H-3a: works を「原作の正準モデル」として完成させる準備。
--   旧 ledgers にしか無かった原作メタ(title_kana / creator_name / publisher_name /
--   division / alternative_titles)を works へ追加し、work_code = ledger_code(licensed_in ミラー)で
--   backfill する。読み書き経路は変えない＝本番リスクゼロ。additive・冪等・可逆。
--   これで後続 H-3b(GET /api/master/ledgers を works 由来へ)で shape 互換を保てる。
--   ロールバック: ALTER TABLE works DROP COLUMN ... (title_kana/creator_name/publisher_name/
--                 division/alternative_titles)。

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS title_kana         TEXT,
  ADD COLUMN IF NOT EXISTS creator_name       TEXT,
  ADD COLUMN IF NOT EXISTS publisher_name     TEXT,
  ADD COLUMN IF NOT EXISTS division           TEXT[],           -- ledgers.division は TEXT[]
  ADD COLUMN IF NOT EXISTS alternative_titles TEXT[] DEFAULT '{}';

-- backfill: licensed_in ミラー(work_code = ledger_code)から原作メタを複製。
--   既存値がある works は触らない(冪等)。alternative_titles は空配列のときだけ補う。
UPDATE works w
   SET title_kana     = COALESCE(w.title_kana, l.title_kana),
       creator_name   = COALESCE(w.creator_name, l.creator_name),
       publisher_name = COALESCE(w.publisher_name, l.publisher_name),
       division       = COALESCE(w.division, l.division),
       alternative_titles = CASE
         WHEN w.alternative_titles IS NULL OR array_length(w.alternative_titles, 1) IS NULL
         THEN l.alternative_titles ELSE w.alternative_titles END
  FROM ledgers l
 WHERE l.ledger_code = w.work_code
   AND (w.title_kana IS NULL OR w.creator_name IS NULL OR w.publisher_name IS NULL
        OR w.division IS NULL
        OR w.alternative_titles IS NULL OR array_length(w.alternative_titles, 1) IS NULL);
