-- 0117_line_item_reward_label.sql
-- 業務明細(capability_line_items)に「固定報酬の名称」(reward_label)を追加。
--   ROYALTY 明細に付く固定報酬(確定額)の表記を案件ごとに自由設定できるようにする。
--     既定は「執筆料」。案件により「制作報酬」「監修報酬」等まちまちなため。
--   発注書テンプレ(purchase_order)の業務明細 金額セルが
--     「{reward_label}（利用許諾料/インセンティブ報酬は別途）」の形でこの値を使う。
--   未設定(NULL/空)のときはテンプレ・フォーム側で「執筆料」にフォールバックする。
--
-- テンプレ本体(html)の更新は migrations では行わず、sync-templates-to-db.mjs で
--   disk テンプレを DB へ同期する運用(TEMPLATE_SOURCE=db)に従う。本 migration は
--   スキーマ(カラム)追加のみ。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS reward_label TEXT;
