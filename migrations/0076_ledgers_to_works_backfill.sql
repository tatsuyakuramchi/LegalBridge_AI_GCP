-- 0076_ledgers_to_works_backfill.sql
-- 作品・原作統合 設計 §8 #4: 純 ledger 由来の LO- 原作を works(kind='licensed_in') へバックフィル。
--
-- 背景:
--   0075 で IP- 原作は LO 再採番され、works→ledgers ミラー(ledger/-001素材)が作られた。
--   一方 LedgersPanel(原作台帳)で直接作られた純 ledger 原作は works に無く、/works(作品管理)
--   一覧に出ない。本移行で ledgers→works(licensed_in)・materials→work_materials を取り込み、
--   /works に全原作を表示できるようにする。
--
-- 方針: すべて additive・冪等。旧表(ledgers/materials)は削除しない(物理廃止は別途)。
--   work_code = ledger_code を継承し LO コードを保全。works に同コードがあれば skip。
--
-- 検証(適用前後で件数差を確認):
--   -- 取り込み対象(works 未登録 ledger):
--   SELECT COUNT(*) FROM ledgers l WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);
--   -- 取り込み対象 materials:
--   SELECT COUNT(*) FROM materials m JOIN ledgers l ON l.id=m.ledger_id
--    WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);

-- (1) ledgers → works(licensed_in)。work_code = ledger_code 継承。既存 works は skip(冪等)。
--     is_original = FALSE(社外原作)。creator_name は works に対応列が無いため取り込まない(legacy)。
INSERT INTO works (
  work_code, kind, title, title_kana, alternative_titles, division, is_original,
  original_publisher, default_rights_holder, default_credit_display,
  default_work_supplement, default_approval_target, default_approval_timing,
  remarks, is_active
)
SELECT
  l.ledger_code, 'licensed_in', l.title, l.title_kana,
  COALESCE(l.alternative_titles, '{}'), COALESCE(l.division, '{}'), FALSE,
  l.publisher_name, l.default_rights_holder, l.default_credit_display,
  l.default_work_supplement, l.default_approval_target, l.default_approval_timing,
  l.remarks, COALESCE(l.is_active, TRUE)
FROM ledgers l
WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);

-- (2) materials → work_materials。new work_id は work_code = ledger_code で解決。
--     material_code で既存判定(冪等)。rights_holder(text) → rights_holder_label。
--     acquisition_type: 原作本体/原作種別は 'license'(ライセンスイン)、その他は NULL(不明)。
INSERT INTO work_materials (
  work_id, material_no, material_code, material_name, material_type,
  rights_holder_label, is_default, remarks, acquisition_type
)
SELECT
  w.id, m.material_no, m.material_code, m.material_name, m.material_type,
  m.rights_holder, COALESCE(m.is_default, FALSE), m.remarks,
  CASE WHEN COALESCE(m.is_default, FALSE) OR m.material_type = 'original'
       THEN 'license' ELSE NULL END
FROM materials m
JOIN ledgers l ON l.id = m.ledger_id
JOIN works  w ON w.work_code = l.ledger_code AND w.kind = 'licensed_in'
WHERE NOT EXISTS (
  SELECT 1 FROM work_materials wm WHERE wm.material_code = m.material_code
);
