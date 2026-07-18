-- 0134_drop_compat_views.sql
-- Phase 7 撤去ゲート G4: 互換VIEW 5本を DROP(最終)。
-- 仕様: docs/plans/phase7-legacy-retirement-plan.md §2(G4) / §4(受入照合)
--
-- 前提(すべて達成済み):
--   - G1/G2(0131): 互換VIEW への書込みゼロ + INSTEAD OF トリガ/関数を DROP 済み。
--   - G3a: contract_capabilities 読取り 165 箇所 → documents 直読みへ移行済み。
--   - G3b: capability_financial_conditions / capability_line_items /
--          capability_expenses / capability_other_fees 読取りを condition_lines
--          直読みへ全移行済み。CI ゲート compat_view_refs --gate-reads 0 稼働中。
--   - 稼働サービス(worker/api)からの FROM/JOIN 参照は 0(読取り 0・書込み 0)。
--     残る参照は scripts/ 配下の一度きり実行済み移行スクリプトのみ(実行時に走らない)。
--
-- 依存関係(DROP を妨げるものが無いことを確認済み):
--   - これらは 0101 で作られた読取り専用 VIEW。書込みトリガ/関数は 0131 で撤去済み。
--   - 旧テーブル時代の FK(delivery_line_items 等)は 0101 のテーブル DROP 時に消滅。
--     現在 VIEW に対する FK/依存ビュー/依存関数は無い。
--   - RESTRICT(既定)で DROP する。万一未知の依存があれば当 TX ごと失敗し、
--     何も落とさない(安全側)。CASCADE は使わない。
--
-- 残すもの:
--   - condition_lines / documents(真実源)、condition_events、condition_line_*_v。
--   - cl_* ヘルパ関数(cl_dir / cl_scheme / cl_next_code / cl_resolve_work): Phase 4 の
--     直書き SQL が参照するため DROP しない。
--
-- 受入照合(§4, DROP はデータに触れないため件数・金額は不変):
--   - documents 件数 / legacy_role 別 condition_lines 件数は本 migration で変化しない。
--   - 主要金額(amount_ex_tax 合計、cfc の rate/mg/ag)も不変。
--
-- 可逆性: 0101 §7 の CREATE VIEW 定義を再適用すれば 5 本とも復元できる
--   (書込みトリガは復元しない = 読取り専用として復活)。

BEGIN;

DROP VIEW IF EXISTS capability_financial_conditions;
DROP VIEW IF EXISTS capability_line_items;
DROP VIEW IF EXISTS capability_expenses;
DROP VIEW IF EXISTS capability_other_fees;
DROP VIEW IF EXISTS contract_capabilities;

COMMIT;
