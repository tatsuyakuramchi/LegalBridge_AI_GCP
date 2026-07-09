-- ============================================================================
-- 0113: サブライセンシー マスター廃止。
--   再許諾先は取引先マスタ(vendors)へ集約する方針としたため、独立した
--   サブライセンシー マスター(sublicensees)および旧連結表(work_sublicensees)を
--   物理削除する。フロント/バックエンドの参照は撤去済み(work_sublicensees の
--   残存書込みは try/catch でグレースフル、api の read は空返却)。
-- ============================================================================

-- 連結表(sublicensee_id FK を持つ)を先に削除。
DROP TABLE IF EXISTS work_sublicensees CASCADE;

-- サブライセンシー マスター本体。
DROP TABLE IF EXISTS sublicensees CASCADE;
