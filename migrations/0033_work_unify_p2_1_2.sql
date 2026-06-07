-- 0033_work_unify_p2_1_2.sql
-- データモデル統合 Part2 P2-1/P2-2:
--   works に kind 等を additive 追加し、source_ips / source_ip_materials を works /
--   work_materials へ backfill する。読み書きは現状維持(両系統が生きる)。
--   旧 source_ips・source_ip_id 列の撤去は後フェーズ(P2-6)。
--
-- 冪等: ADD COLUMN IF NOT EXISTS / legacy_source_ip_id・source_ip_material_id で重複防止。
--   source_ips が無い環境(新規DB)は to_regclass ガードでスキップ。

-- ── P2-1: works を additive 拡張 ──────────────────────────────
ALTER TABLE works ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'own';  -- own / licensed_in
ALTER TABLE works ADD COLUMN IF NOT EXISTS legacy_source_ip_id INTEGER;              -- 旧 source_ips.id マップ(移行用)
ALTER TABLE works ADD COLUMN IF NOT EXISTS original_publisher TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS default_rights_holder TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS default_credit_display TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS default_work_supplement TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS default_approval_target TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS default_approval_timing TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS rights_holder_vendor_id INTEGER REFERENCES vendors(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_works_legacy_source_ip
  ON works(legacy_source_ip_id) WHERE legacy_source_ip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_works_kind ON works(kind);

-- work_materials に原作素材の固有列(権利者ラベル)を additive 追加
ALTER TABLE work_materials ADD COLUMN IF NOT EXISTS rights_holder_label TEXT;

-- ── P2-2: backfill (source_ips が存在する環境のみ) ────────────
DO $p2_backfill$
BEGIN
  IF to_regclass('public.source_ips') IS NOT NULL THEN
    -- source_ips → works(kind='licensed_in')。work_code は source_code を流用。
    INSERT INTO works (
      work_code, title, title_kana, alternative_titles, division,
      is_original, kind, legacy_source_ip_id,
      original_publisher, default_rights_holder, default_credit_display,
      default_work_supplement, default_approval_target, default_approval_timing,
      rights_holder_vendor_id, remarks, is_active
    )
    SELECT
      s.source_code, s.title, s.title_kana, COALESCE(s.alternative_titles, '{}'), '{}',
      FALSE, 'licensed_in', s.id,
      s.original_publisher, s.default_rights_holder, s.default_credit_display,
      s.default_work_supplement, s.default_approval_target, s.default_approval_timing,
      s.rights_holder_vendor_id, s.remarks, COALESCE(s.is_active, TRUE)
    FROM source_ips s
    WHERE NOT EXISTS (SELECT 1 FROM works w  WHERE w.legacy_source_ip_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM works w2 WHERE w2.work_code = s.source_code);

    -- source_ip_materials → work_materials (source_ip_material_id で冪等)
    IF to_regclass('public.source_ip_materials') IS NOT NULL THEN
      INSERT INTO work_materials (
        work_id, material_name, material_type, rights_type,
        rights_holder_vendor_id, rights_holder_label,
        source_ip_id, source_ip_material_id, remarks
      )
      SELECT
        w.id, m.material_name, m.material_type, 'license',
        m.rights_holder_vendor_id, m.rights_holder_label,
        m.source_ip_id, m.id, m.remarks
      FROM source_ip_materials m
      JOIN works w ON w.legacy_source_ip_id = m.source_ip_id
      WHERE NOT EXISTS (
        SELECT 1 FROM work_materials wm WHERE wm.source_ip_material_id = m.id
      );
    END IF;
  END IF;
END
$p2_backfill$;
