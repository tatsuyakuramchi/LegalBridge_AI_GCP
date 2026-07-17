-- 0131_drop_compat_write_triggers.sql
-- Phase 7 第1弾 = 撤去ゲート G2: 互換VIEW の INSTEAD OF 書込みトリガと その関数を DROP。
-- 仕様: docs/plans/phase7-legacy-retirement-plan.md §5
--
-- 前提: G1(互換VIEWへの書込みゼロ)達成済・CI ゲート稼働(compat_view_refs --gate-writes 0)。
--   Phase 4 で全書込みを documents / condition_lines 直書きへ移行済み。
--
-- これで互換VIEW への書込みは物理的に不可能になる(1:1 の contract_capabilities は
--   UPDATE/DELETE のみ auto-updatable、capability_* は書込み不可でエラー)。
--   万一の残存書込みはエラーで顕在化する(CI ゲートで既に 0)。
--
-- 残すもの(まだ必要):
--   - 互換VIEW 5本: 読取りが 282 箇所残る(G3 で段階移行、G4 で DROP)。
--   - cl_* ヘルパ関数(cl_dir / cl_scheme / cl_next_code / cl_resolve_work):
--     Phase 4 の直書き SQL が 65 箇所で参照するため DROP しない。
--
-- 可逆性: 0101 のトリガ/関数定義を再適用すれば復元できる。

BEGIN;

-- ── ① INSTEAD OF トリガ(15本)を DROP ────────────────────────────────
DROP TRIGGER IF EXISTS tg_cc_ins  ON contract_capabilities;

DROP TRIGGER IF EXISTS tg_cfc_ins ON capability_financial_conditions;
DROP TRIGGER IF EXISTS tg_cfc_upd ON capability_financial_conditions;
DROP TRIGGER IF EXISTS tg_cfc_del ON capability_financial_conditions;

DROP TRIGGER IF EXISTS tg_cli_ins ON capability_line_items;
DROP TRIGGER IF EXISTS tg_cli_upd ON capability_line_items;
DROP TRIGGER IF EXISTS tg_cli_del ON capability_line_items;

DROP TRIGGER IF EXISTS tg_exp_ins ON capability_expenses;
DROP TRIGGER IF EXISTS tg_exp_upd ON capability_expenses;
DROP TRIGGER IF EXISTS tg_exp_del ON capability_expenses;

DROP TRIGGER IF EXISTS tg_fee_ins ON capability_other_fees;
DROP TRIGGER IF EXISTS tg_fee_upd ON capability_other_fees;
DROP TRIGGER IF EXISTS tg_fee_del ON capability_other_fees;

-- ── ② トリガ関数(10本)を DROP。cl_* ヘルパは残す ───────────────────
DROP FUNCTION IF EXISTS cc_compat_ins();
DROP FUNCTION IF EXISTS cfc_ins();
DROP FUNCTION IF EXISTS cfc_upd();
DROP FUNCTION IF EXISTS cli_ins();
DROP FUNCTION IF EXISTS cli_upd();
DROP FUNCTION IF EXISTS exp_ins();
DROP FUNCTION IF EXISTS exp_upd();
DROP FUNCTION IF EXISTS fee_ins();
DROP FUNCTION IF EXISTS fee_upd();
DROP FUNCTION IF EXISTS cl_view_del();

-- ── ③ 残存確認(適用ログ) ────────────────────────────────────────────
DO $$
DECLARE
  trg INT;
  helpers INT;
BEGIN
  SELECT COUNT(*) INTO trg
    FROM pg_trigger
   WHERE tgname LIKE 'tg_cc_%' OR tgname LIKE 'tg_cfc_%'
      OR tgname LIKE 'tg_cli_%' OR tgname LIKE 'tg_exp_%' OR tgname LIKE 'tg_fee_%';
  SELECT COUNT(*) INTO helpers
    FROM pg_proc
   WHERE proname IN ('cl_dir', 'cl_scheme', 'cl_next_code', 'cl_resolve_work');
  RAISE NOTICE '0131: 残存 INSTEAD OF トリガ % 本 (期待 0) / cl_* ヘルパ % 本 (期待 4=温存)',
    trg, helpers;
END $$;

COMMIT;
