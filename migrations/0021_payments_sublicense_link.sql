-- 0021_payments_sublicense_link.sql
-- サブライセンス受領管理(第2段): 受領確定を payments 台帳に記録するための紐付け。
-- payments(direction='inbound', payment_kind='sublicense_income')に sublicense_deal_id を
-- 持たせ、どの deal × 受領予定日の確定かを辿れるようにする(状態判定・重複防止)。
-- additive・冪等。payments は 0006。

ALTER TABLE payments ADD COLUMN IF NOT EXISTS sublicense_deal_id INTEGER REFERENCES sublicense_deals(id);

CREATE INDEX IF NOT EXISTS idx_payments_subdeal ON payments(sublicense_deal_id);
