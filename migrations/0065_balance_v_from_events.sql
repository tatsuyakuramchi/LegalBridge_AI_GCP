-- 0065_balance_v_from_events.sql
-- データ構造刷新 Phase 2c-1: condition_line_balance_v の MG/AG 消化を
--   condition_events 由来に再定義する。
--
--   2c-0 で condition_events に mg/ag_consumed_this_time を追加し、2c-1 で同期
--   (syncRoyaltyCalcEvent)がこれらを書くようになったため、royalty_calculations への
--   JOIN 依存を断つ。これで balance_v が royalty_calculations 非依存になり、
--   2d(royalty_calculations DROP)の前提が1つ満たされる。
--
--   ※ 既存ロイヤリティイベントの mg/ag は 2c-0 backfill で移送済み(本番は現状0件)。
--      新規分は同期が書く。CREATE OR REPLACE は既存 GRANT を保持するが、念のため
--      再付与(冪等)。

CREATE OR REPLACE VIEW condition_line_balance_v AS
     SELECT cl.id AS condition_line_id, cl.line_code,
            cl.mg_amount, cl.ag_amount,
            COALESCE(d.mg_consumed,0) AS mg_consumed,
            GREATEST(0, COALESCE(cl.mg_amount,0) - COALESCE(d.mg_consumed,0)) AS mg_remaining,
            COALESCE(d.ag_consumed,0) AS ag_consumed,
            GREATEST(0, COALESCE(cl.ag_amount,0) - COALESCE(d.ag_consumed,0)) AS ag_remaining
       FROM condition_lines cl
       LEFT JOIN (
         SELECT ev.condition_line_id,
                SUM(COALESCE(ev.mg_consumed_this_time,0)) AS mg_consumed,
                SUM(COALESCE(ev.ag_consumed_this_time,0)) AS ag_consumed
           FROM condition_events ev
          WHERE ev.voided_at IS NULL AND ev.event_type = 'royalty_calc'
          GROUP BY ev.condition_line_id
       ) d ON d.condition_line_id = cl.id
      WHERE cl.payment_scheme = 'royalty';

GRANT SELECT ON condition_line_balance_v TO legalbridge;
