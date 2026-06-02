-- 0019_sublicense_deals.sql
-- サブライセンス受領管理(第1段)。
-- 「作品 × サブライセンシー」を最小単位に、当社がサブライセンシーから受領する
-- ライセンス料の条件(料率 / MG / 前払 / 基準 / 周期 / 期間)を保持する。
-- 個別利用許諾契約は参照(契約番号)として紐づけるだけ(複合契約OK)。
-- 受領予定(各回)はこの条件から算出して『受領予定一覧』に展開する。
-- additive・冪等。参照先 works(0004)/ sublicensees(0001)。

CREATE TABLE IF NOT EXISTS sublicense_deals (
  id                      SERIAL PRIMARY KEY,
  work_id                 INTEGER REFERENCES works(id),
  sublicensee_id          INTEGER REFERENCES sublicensees(id),
  inline_sublicensee_name TEXT,                         -- マスタ未登録時の手入力名
  source_contract_number  VARCHAR(100),                 -- 参照: 個別利用許諾契約番号
  basis                   VARCHAR(20) DEFAULT 'sales',  -- sales(売上) / manufacturing(製造数)
  rate_pct                DECIMAL(7,4),                 -- 料率 %
  unit_price              DECIMAL(15,2),                -- 基準価格(製造数ベース等)
  forecast_amount         DECIMAL(15,2),                -- 見込売上 or 見込数量(受領予定の試算用)
  mg_amount               DECIMAL(15,2),                -- MG(ミニマムギャランティ)総額
  advance_amount          DECIMAL(15,2),                -- 前払 / AG(受領総額から相殺)
  currency                VARCHAR(10) DEFAULT 'JPY',
  cycle                   VARCHAR(20) DEFAULT 'QUARTERLY', -- MONTHLY/QUARTERLY/SEMIANNUAL/ANNUAL/CUSTOM
  interval_unit           VARCHAR(10),                  -- CUSTOM: MONTH / DAY
  interval_count          INTEGER,                      -- CUSTOM: N
  billing_day             INTEGER,                      -- 毎期の受領日(1-31 / 0 or >30 で末日)
  term_start              DATE,
  term_end                DATE,
  status                  VARCHAR(20) DEFAULT 'active', -- active / closed
  remarks                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subdeals_work ON sublicense_deals(work_id);
CREATE INDEX IF NOT EXISTS idx_subdeals_sublicensee ON sublicense_deals(sublicensee_id);
CREATE INDEX IF NOT EXISTS idx_subdeals_status ON sublicense_deals(status);
