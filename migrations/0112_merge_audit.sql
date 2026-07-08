-- ============================================================================
-- 0112: ID統合(マージ)の監査ログ。
--   /api/v3/merge/execute が「何を(entity) どのIDから(loser)どのIDへ(survivor)
--   付け替え、どの行(changes)を動かし、削除した loser 本体(loser_snapshot)は何か」を
--   記録する。これにより一覧での追跡と、best-effort な取消し(undo)を可能にする。
-- ============================================================================

CREATE TABLE IF NOT EXISTS merge_audit (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor          TEXT,                      -- 実行者(IAP メール等、best-effort)
  entity         TEXT NOT NULL,             -- work / source_ip / matter / issue
  survivor_id    TEXT NOT NULL,             -- 残した側(int/string を文字列で保持)
  loser_id       TEXT NOT NULL,             -- 統合元(付け替え後に削除 or キーrename)
  survivor_label TEXT,
  loser_label    TEXT,
  moved          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{table,column,updated}]
  changes        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{table,column,pks:[...],loseVal,survVal}] (undo用)
  conflicts      JSONB NOT NULL DEFAULT '[]'::jsonb,
  loser_snapshot JSONB,                     -- 削除した loser 本体(復元用)。issue は null。
  deleted_loser  BOOLEAN NOT NULL DEFAULT false,
  undone_at      TIMESTAMPTZ,               -- 取消し済みならその時刻
  undo_note      TEXT
);

CREATE INDEX IF NOT EXISTS idx_merge_audit_created ON merge_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merge_audit_entity  ON merge_audit(entity, created_at DESC);
