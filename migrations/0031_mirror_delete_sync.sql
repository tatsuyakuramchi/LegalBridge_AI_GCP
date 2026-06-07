-- 0031_mirror_delete_sync.sql
-- データモデル整理 Step3a: v3ミラーの DELETE 同期 + 既存孤児の掃除。
--
-- 背景: 0012 の同期トリガは AFTER INSERT/UPDATE のみで DELETE を同期しないため、
--   capability 系(contract_capabilities / capability_line_items /
--   capability_financial_conditions)を削除しても v3 ミラー
--   (contracts / contract_line_items / contract_financial_terms)に行が残り、
--   孤児化していた(連結チェックの「v3ミラー孤児」)。
--
-- 方針: ミラーの読み手(作品モデル等)が現役のためミラー自体は当面維持し、
--   DELETE 同期トリガを足して孤児の新規発生を止める + 既存孤児を一括掃除する。
--   (ミラー全廃は Step3b で読み手を capability 層へ移植してから実施)
--
-- 冪等: CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS / CREATE TRIGGER。
--   掃除 DELETE は NOT EXISTS 条件で再実行可。

-- 1) contract_capabilities 削除 → contracts 削除 (contract_* 子は ON DELETE CASCADE)
CREATE OR REPLACE FUNCTION lb_sync_delete_contracts() RETURNS trigger AS $fn$
BEGIN
  DELETE FROM contracts WHERE id = OLD.id;
  RETURN OLD;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_delete_contracts failed (cc.id=%): %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_delete_contracts ON contract_capabilities;
CREATE TRIGGER trg_sync_delete_contracts AFTER DELETE ON contract_capabilities
  FOR EACH ROW EXECUTE FUNCTION lb_sync_delete_contracts();

-- 2) capability_line_items 削除 → contract_line_items 削除 (id 共有)
CREATE OR REPLACE FUNCTION lb_sync_delete_cli() RETURNS trigger AS $fn$
BEGIN
  DELETE FROM contract_line_items WHERE id = OLD.id;
  RETURN OLD;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_delete_cli failed (cli.id=%): %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_delete_cli ON capability_line_items;
CREATE TRIGGER trg_sync_delete_cli AFTER DELETE ON capability_line_items
  FOR EACH ROW EXECUTE FUNCTION lb_sync_delete_cli();

-- 3) capability_financial_conditions 削除 → contract_financial_terms 削除 (id 共有)
CREATE OR REPLACE FUNCTION lb_sync_delete_cft() RETURNS trigger AS $fn$
BEGIN
  DELETE FROM contract_financial_terms WHERE id = OLD.id;
  RETURN OLD;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_delete_cft failed (cfc.id=%): %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_delete_cft ON capability_financial_conditions;
CREATE TRIGGER trg_sync_delete_cft AFTER DELETE ON capability_financial_conditions
  FOR EACH ROW EXECUTE FUNCTION lb_sync_delete_cft();

-- 4) 既存孤児の一括掃除
--    a) capability の無い contracts (子 contract_* は CASCADE で消える)
DELETE FROM contracts c
  WHERE NOT EXISTS (SELECT 1 FROM contract_capabilities cc WHERE cc.id = c.id);
--    b) 元の capability_line_items が無い contract_line_items (id 共有)
DELETE FROM contract_line_items cli
  WHERE NOT EXISTS (SELECT 1 FROM capability_line_items x WHERE x.id = cli.id);
--    c) 元の capability_financial_conditions が無い contract_financial_terms (id 共有)
DELETE FROM contract_financial_terms cft
  WHERE NOT EXISTS (SELECT 1 FROM capability_financial_conditions x WHERE x.id = cft.id);
