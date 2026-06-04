-- 0025_work_lineage.sql
-- 作品の派生系譜(lineage)。多段サブライセンス/翻訳/改題出版を「別 works を
-- parent_work_id で繋ぐ」方針で表現する(ユーザー決定: 版ではなく別作品)。
--
--   原作(source_ip=C社) → 自社原版(work) → A社翻訳版(work) → K社出版版(work, 改題)
--
-- 各 work が個別に契約・料率・受領・タイトルを持てるよう、作品内バージョンには
-- せず別レコード + 親参照で繋ぐ。改題タイトルの名寄せ用に別名表も用意。
--
-- additive・冪等。参照先 works(0004)。

-- ── 1) 作品の派生系譜 ─────────────────────────────────────────────
ALTER TABLE works
  ADD COLUMN IF NOT EXISTS parent_work_id INTEGER REFERENCES works(id);
ALTER TABLE works
  ADD COLUMN IF NOT EXISTS derivation_type VARCHAR(30);
  -- translation(翻訳) / edition(版) / title_change(改題) / localization(地域化)
  -- / adaptation(翻案) / null(原版・派生でない)

CREATE INDEX IF NOT EXISTS idx_works_parent ON works(parent_work_id);

-- ── 2) 外部/改題タイトルの名寄せ ─────────────────────────────────
-- K社が変更した出版タイトル等を「どの相手・文脈で」付いた別名かと共に保持。
-- 利用報告(他社タイトル)を作品に名寄せする際に使う。
CREATE TABLE IF NOT EXISTS work_title_aliases (
  id              SERIAL PRIMARY KEY,
  work_id         INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  alias_title     TEXT NOT NULL,
  party_vendor_id INTEGER REFERENCES vendors(id),   -- そのタイトルを付けた相手(K社等)
  context         TEXT,                              -- 例: K社 海外出版版タイトル
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wta_work ON work_title_aliases(work_id);
CREATE INDEX IF NOT EXISTS idx_wta_title ON work_title_aliases(lower(alias_title));
