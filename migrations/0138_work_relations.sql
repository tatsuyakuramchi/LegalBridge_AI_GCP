-- 0138_work_relations.sql
-- Phase F 第1弾: 作品間の関係(派生元→派生物)を独立テーブルへ。
--   既存 works.parent_work_id / derivation_type を 1:1 でバックフィルする。
--   親ポインタ(parent_work_id)は当面そのまま残す＝非破壊。additive・冪等・可逆。
--   これで WORK-REL-002(自己参照・循環) の評価器を有効化できる。
--
-- ロールバック: DROP TABLE IF EXISTS work_relations CASCADE;

CREATE TABLE IF NOT EXISTS work_relations (
  id             SERIAL PRIMARY KEY,
  child_work_id  INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,   -- 派生物(子)
  parent_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,   -- 派生元(親)
  relation_type  VARCHAR(30),                                               -- sequel / localization / adaptation ...
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_work_id, parent_work_id)
);

CREATE INDEX IF NOT EXISTS idx_work_relations_child  ON work_relations (child_work_id);
CREATE INDEX IF NOT EXISTS idx_work_relations_parent ON work_relations (parent_work_id);

-- バックフィル: 既存の親ポインタを 1:1 複製(冪等)。
--   works.parent_work_id は自身の FK で works(id) 参照済みなので dangling は無い。
INSERT INTO work_relations (child_work_id, parent_work_id, relation_type)
SELECT id, parent_work_id, derivation_type
  FROM works
 WHERE parent_work_id IS NOT NULL
ON CONFLICT (child_work_id, parent_work_id) DO NOTHING;
