-- 0032_fix_mirror_delete_scope.sql
-- データモデル整理 Step3a 補正(重要): v3ミラーの DELETE 同期を「ミラー行のみ」に限定。
--
-- 背景: 0031 の lb_sync_delete_contracts は capability 削除時に
--   `DELETE FROM contracts WHERE id = OLD.id` を無条件で実行していた。
--   しかし contracts は混在テーブルで、origin='registered' は作品モデル
--   (POST /api/v3/contracts)が直接作る独自契約(capability 無し)である。
--   無条件削除だと、id が一致した registered 契約を誤って消す恐れがある。
--   → DELETE 同期は origin='workflow'(=capability ミラー)に限定する。
--
-- ※ 0031 の一括掃除 `DELETE FROM contracts WHERE NOT EXISTS(capability)` は
--   registered 契約も対象にしていた誤り。本ファイルでは破壊的処理は一切行わない
--   (既に消えた行の復元はバックアップ/再登録で対応)。
--
-- 冪等: CREATE OR REPLACE FUNCTION。

CREATE OR REPLACE FUNCTION lb_sync_delete_contracts() RETURNS trigger AS $fn$
BEGIN
  -- ミラー行(origin='workflow')のみ削除。registered(作品モデル独自)は保護。
  DELETE FROM contracts WHERE id = OLD.id AND origin = 'workflow';
  RETURN OLD;
EXCEPTION WHEN others THEN
  RAISE WARNING 'lb_sync_delete_contracts failed (cc.id=%): %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$fn$ LANGUAGE plpgsql;
-- トリガ自体は 0031 で作成済み(関数差し替えのみで有効)。
