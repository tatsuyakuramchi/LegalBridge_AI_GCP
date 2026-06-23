-- 0082_backfill_work_materials_topup.sql
-- 文書ファースト 原作マテリアル紐付けプラン Stage 0: マテリアル表一本化の冪等トップアップ。
--   設計: docs/design/document-first-material-linkage-plan.md (決定3)
--         docs/design/work-nn-junction-activation-plan.md §5
--
-- 背景:
--   0076 で materials(台帳) → work_materials を取り込んだが「一度きり」。以降に
--   addMaterialToLedger(台帳への派生素材追加, server.ts:6672) 等で台帳へ足された素材は
--   work_materials へミラーされず、正準表(work_materials)が欠落する(= 表の再二重化)。
--   本移行は 0076 を冪等に再実行し、work_materials を materials の完全な上位集合に保つ。
--   併せて、以後のドリフトは addMaterialToLedger 側のミラー追加(同 Stage 0 のコード変更)で防ぐ。
--
-- 方針: すべて additive・冪等。work_code = ledger_code(kind='licensed_in')で解決。
--   material_code で既存判定。旧表(ledgers/materials)は削除しない(物理廃止は別途)。
--
-- 検証(適用後に 0 になるべき):
--   -- works 未登録 ledger:
--   SELECT COUNT(*) FROM ledgers l WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);
--   -- work_materials 欠落の台帳素材:
--   SELECT COUNT(*) FROM materials m JOIN ledgers l ON l.id=m.ledger_id
--     JOIN works w ON w.work_code=l.ledger_code AND w.kind='licensed_in'
--    WHERE NOT EXISTS (SELECT 1 FROM work_materials wm WHERE wm.material_code = m.material_code);

-- (1) ledgers → works(licensed_in) を冪等再掲(0076(1) と同一)。works 未登録 ledger を取り込む。
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

-- (2) materials → work_materials トップアップ(0076(2) と同一・冪等)。material_code で既存判定。
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
