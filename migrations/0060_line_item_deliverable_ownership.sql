-- 0060_line_item_deliverable_ownership.sql
-- 検収書: 受注者帰属で業務報酬0(=利用許諾料に含む)の成果物も検収対象として
--   検収書に出せるようにする。発注者帰属の0円明細とは区別するため、
--   capability_line_items に deliverable_ownership(発注者/受注者) 列を追加する。
--
--   - worker は全明細(受注者0円含む)を capability_line_items に保存し、帰属を記録。
--   - 検収書 form-context は amount>0 OR deliverable_ownership='受注者' を検収対象に含める。
--   - 検収書テンプレは金額0のとき既に「利用許諾料に含む」を表示するため変更不要。
--   - 検収待ち判定(unissued_line_count)は amount>0 のみを数えるので、0円明細が
--     検収待ちに居座ることはない。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS deliverable_ownership TEXT;
