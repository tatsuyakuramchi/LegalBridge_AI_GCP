-- 0130_g5_drop_sync_triggers_and_mirrors.sql
-- Phase 5 第4弾 = 撤去ゲート G5(計画 §10 / phase4-compat-retirement-plan.md §3):
--   二重書込みトリガと v3 ミラーの撤去。
--
-- 前提(読み手の正本切替が完了していること):
--   - royalty_statements の唯一の読み手(workModel /api/v3/contracts/:id)は
--     royalty_calculations 直読みへ切替済み(本スライス)。
--   - payments のトリガ供給行(PAY-MIG-* / work_id NULL)は唯一の集計読み手
--     (workModel work詳細: WHERE work_id = $1)に元々現れないため読み手影響なし。
--     ※ worker ロイヤリティ支払フローの payments 台帳への正式合流は第5弾以降
--       (work_id / financial 情報を持つ明示書込みとして設計する)。
--   - contract_financial_terms / contract_line_items へのコード参照は第3弾でゼロ。
--
-- 順序: 照合ログ → トリガDROP → 孤児関数DROP → ミラー表DROP → 残存確認ログ。

BEGIN;

-- ── ① 新旧照合(削除前のスナップショットを適用ログに残す) ─────────────
DO $$
DECLARE
  rc_n INT; rs_n INT; rc_sum NUMERIC; rs_sum NUMERIC;
  rp_n INT; pm_n INT; rp_sum NUMERIC; pm_sum NUMERIC;
  cft_n INT; cli_n INT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(actual_royalty_ex_tax), 0) INTO rc_n, rc_sum FROM royalty_calculations;
  SELECT COUNT(*), COALESCE(SUM(actual_royalty_ex_tax), 0) INTO rs_n, rs_sum FROM royalty_statements;
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO rp_n, rp_sum FROM royalty_payments;
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO pm_n, pm_sum
    FROM payments WHERE payment_no LIKE 'PAY-MIG-%';
  SELECT COUNT(*) INTO cft_n FROM contract_financial_terms;
  SELECT COUNT(*) INTO cli_n FROM contract_line_items;
  RAISE NOTICE '0130 照合: royalty_calculations=% (実額計%) / royalty_statements=% (実額計%)',
    rc_n, rc_sum, rs_n, rs_sum;
  RAISE NOTICE '0130 照合: royalty_payments=% (総額計%) / payments(PAY-MIG)=% (総額計%)',
    rp_n, rp_sum, pm_n, pm_sum;
  RAISE NOTICE '0130 照合: ミラー表 contract_financial_terms=% / contract_line_items=% (DROP対象)',
    cft_n, cli_n;
END $$;

-- ── ② 生存中の二重書込みトリガを DROP ────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_royalty_statements ON royalty_calculations;
DROP FUNCTION IF EXISTS lb_sync_royalty_statements();

DROP TRIGGER IF EXISTS trg_sync_payments ON royalty_payments;
DROP FUNCTION IF EXISTS lb_sync_payments();

-- ── ③ 0101 の DROP TABLE CASCADE でトリガだけ消え孤児化していた関数を DROP ──
DROP FUNCTION IF EXISTS lb_sync_contracts();
DROP FUNCTION IF EXISTS lb_sync_cft();
DROP FUNCTION IF EXISTS lb_sync_cli();
DROP FUNCTION IF EXISTS lb_sync_delete_contracts();
DROP FUNCTION IF EXISTS lb_sync_delete_cli();
DROP FUNCTION IF EXISTS lb_sync_delete_cft();

-- ── ④ 参照ゼロの v3 ミラー表を DROP ─────────────────────────────────
-- CASCADE で消えるのは残存 FK 制約のみ(列は残る・実データは消えない):
--   payments.financial_term_id / royalty_statements.financial_term_id
--     → contract_financial_terms への FK
--   deliverables.contract_line_item_id → contract_line_items への FK
-- (work_materials.license_financial_term_id は 0101 で列ごと撤去済み)
DROP TABLE IF EXISTS contract_line_items CASCADE;
DROP TABLE IF EXISTS contract_financial_terms CASCADE;

-- ── ⑤ 残存確認(期待値: trg_sync_* は source_ip_to_work の 1 本のみ、
--       lb_sync_* も同関数の 1 本のみ。0035 の作品統一ミラーは本スコープ外) ──
DO $$
DECLARE t INT; f INT;
BEGIN
  SELECT COUNT(*) INTO t FROM pg_trigger WHERE tgname LIKE 'trg_sync_%' AND NOT tgisinternal;
  SELECT COUNT(*) INTO f FROM pg_proc WHERE proname LIKE 'lb_sync_%';
  RAISE NOTICE '0130: 残存 trg_sync_* トリガ % 本 / lb_sync_* 関数 % 本 (期待値: 各1 = source_ip_to_work のみ)',
    t, f;
END $$;

COMMIT;
