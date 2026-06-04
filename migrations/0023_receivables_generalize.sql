-- 0023_receivables_generalize.sql
-- 当社の請求権(債権)管理。サブライセンス受領の仕組み(sublicense_deals)を
-- 一般化し、契約由来の受領予定など「当社が受け取る側」の請求権を1台帳に束ねる。
--
-- 方針(ユーザー決定):
--   - 対象 = サブライセンス受領 + 契約由来の受領予定
--   - 起点 = 既存 sublicense_deals を一般化(新テーブルは作らず列追加)
--   - ライフサイクル = 台帳のみ(状態管理だけ。入金消込や請求書PDFはしない)
--
-- 受領予定(各回)はサービス側で deal から算出して展開する(従来どおり)。
-- 各回の請求状態(未請求/請求済/入金済)だけを receivable_statuses に保持する。
-- additive・冪等。参照先 sublicense_deals(0019) / vendors(0001) / contracts(0006以前)。

-- ── 1) deal を一般化(サブライセンス以外の請求権も登録できるように)─────
ALTER TABLE sublicense_deals
  ADD COLUMN IF NOT EXISTS receivable_kind VARCHAR(30) NOT NULL DEFAULT 'sublicense';
  -- sublicense(サブライセンス受領) / publication(出版印税) / license_out(ライセンスアウト)
  -- / service(役務・その他受領) / other(任意)

ALTER TABLE sublicense_deals
  ADD COLUMN IF NOT EXISTS counterparty_name TEXT;            -- 相手方名(サブライセンシー以外)
ALTER TABLE sublicense_deals
  ADD COLUMN IF NOT EXISTS counterparty_vendor_id INTEGER REFERENCES vendors(id); -- 任意: 取引先マスタ参照
ALTER TABLE sublicense_deals
  ADD COLUMN IF NOT EXISTS source_contract_id INTEGER;        -- 任意: 契約由来の場合の契約参照(FKは付けない=柔軟)

-- 既存行は明示的にサブライセンスとして確定(DEFAULT 済みだが念のため)。
UPDATE sublicense_deals SET receivable_kind = 'sublicense'
  WHERE receivable_kind IS NULL OR receivable_kind = '';

CREATE INDEX IF NOT EXISTS idx_subdeals_kind ON sublicense_deals(receivable_kind);

-- ── 2) 受領予定 各回の請求状態(台帳)──────────────────────────────
-- deal × 受領予定日(period_date)を一意キーに、未請求/請求済/入金済 を保持。
-- 金額・期日は deal から算出するためここには持たない(状態と任意の実日付/メモのみ)。
CREATE TABLE IF NOT EXISTS receivable_statuses (
  id            SERIAL PRIMARY KEY,
  deal_id       INTEGER NOT NULL REFERENCES sublicense_deals(id) ON DELETE CASCADE,
  period_date   DATE NOT NULL,                       -- 対応する受領予定日
  status        VARCHAR(20) NOT NULL DEFAULT 'unbilled', -- unbilled(未請求)/billed(請求済)/received(入金済)
  billed_date   DATE,                                -- 請求済にした実日付(任意)
  received_date DATE,                                -- 入金済にした実日付(任意)
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_recvstatus_deal ON receivable_statuses(deal_id);
CREATE INDEX IF NOT EXISTS idx_recvstatus_status ON receivable_statuses(status);
