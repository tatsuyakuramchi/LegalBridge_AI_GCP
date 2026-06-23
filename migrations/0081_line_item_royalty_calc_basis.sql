-- 0081_line_item_royalty_calc_basis.sql
-- 業務明細(capability_line_items)に「計算式方法」(royalty_calc_basis)を追加。
--   ROYALTY 明細の利用許諾料の算定方法を、利用許諾計算書(royalty_statement)の
--   パターンに合わせて保持する:
--     manufacturing … 個数 × 基準価格 × 料率
--     sales         … 売上高 × 料率
--     sublicense    … 受領額 × 料率
--     fixed         … 固定額
--   発注書テンプレ(purchase_order)の明細「計算式方法」列がこの値で駆動される。
--   未設定(NULL)のときはテンプレ側で「売上高 × 料率」にフォールバックする。
--
-- テンプレ本体(html)の更新は migrations では行わず、sync-templates-to-db.mjs で
--   disk テンプレを DB へ同期する運用(TEMPLATE_SOURCE=db)に従う。本 migration は
--   スキーマ(カラム)追加のみ。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS royalty_calc_basis TEXT;
