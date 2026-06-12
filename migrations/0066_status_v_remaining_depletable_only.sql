-- 0066_status_v_remaining_depletable_only.sql
-- データ構造刷新 Phase 2c-2: condition_line_status_v.remaining_amount を
--   「消化型(lump_sum/per_unit/installment)のみ」に限定する。
--
--   2c-2 で subscription の 数量/単価/金額 を condition_lines に保存するようにした
--   (横断検索の raw 表示を忠実にするため)。その副作用で、従来 NULL だった
--   subscription の remaining_amount が「金額 - 消化」で計算されてしまい、コックピット
--   一覧に紛らわしい残額が出る。subscription は金額消化の概念ではない(スケジュール追跡)
--   ため、remaining は消化型に限定して subscription は引き続き NULL(「残—」)とする。
--
--   それ以外のロジック(status / consumed_amount 等)は 0063 と不変。

CREATE OR REPLACE VIEW condition_line_status_v AS
     SELECT
       cl.id, cl.line_code, cl.capability_id, cl.payment_scheme, cl.direction,
       CASE
         WHEN cl.cancelled_at IS NOT NULL THEN 'cancelled'
         WHEN cl.closed_at IS NOT NULL THEN 'closed_short'
         WHEN cl.payment_scheme IN ('lump_sum','per_unit','installment') THEN
           CASE WHEN COALESCE(e.sum_amount,0) >= COALESCE(cl.amount_ex_tax,0) THEN 'fulfilled'
                WHEN COALESCE(e.sum_amount,0) > 0 THEN 'partially_fulfilled'
                ELSE 'open' END
         ELSE
           CASE WHEN cl.term_start IS NOT NULL AND CURRENT_DATE < cl.term_start THEN 'pending'
                WHEN cl.term_end IS NOT NULL AND CURRENT_DATE > cl.term_end THEN 'expired'
                ELSE 'active' END
       END AS status,
       COALESCE(e.sum_amount,0) AS consumed_amount,
       -- 2c-2: 残額は消化型のみ。subscription/royalty は NULL(コックピットで「残—」)。
       CASE WHEN cl.payment_scheme IN ('lump_sum','per_unit','installment')
             AND cl.amount_ex_tax IS NOT NULL
            THEN cl.amount_ex_tax - COALESCE(e.sum_amount,0) END AS remaining_amount,
       COALESCE(e.event_count,0) AS event_count,
       e.last_event_at
     FROM condition_lines cl
     LEFT JOIN (
       SELECT condition_line_id, SUM(amount_ex_tax) AS sum_amount,
              COUNT(*) AS event_count, MAX(occurred_at) AS last_event_at
         FROM condition_events
        WHERE voided_at IS NULL
        GROUP BY condition_line_id
     ) e ON e.condition_line_id = cl.id;

GRANT SELECT ON condition_line_status_v TO legalbridge;
