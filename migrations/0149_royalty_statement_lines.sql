-- 0149_royalty_statement_lines.sql
-- 利用許諾料計算書(royalty_statement)の多明細(statementMode=multi)を正規化保存する
--   投影テーブル。従来は明細が documents.form_data JSON のみで、集計/支払Export/実績
--   照合ができなかった(監査#1)。方針X: form_data を正・本表は発行時の確定値の投影。
--   発行のたびに document 単位で置換(DELETE→INSERT)する。

CREATE TABLE IF NOT EXISTS royalty_statement_lines (
  id                serial PRIMARY KEY,
  document_id       INTEGER,               -- documents.id (柔らか連結; 物理FKは張らない)
  document_number   TEXT,
  backlog_issue_key TEXT,
  line_no           INTEGER NOT NULL DEFAULT 0,
  group_no          INTEGER,               -- 親契約グループの出現順(1..)
  contract_id       INTEGER,               -- 親契約(イン側)
  contract_title    TEXT,
  contract_number   TEXT,
  calc_method       TEXT,                  -- 'revenue'(売上/受領額ベース) / 'manufacturing'(製造ベース)
  product_name      TEXT,
  intake_currency   TEXT,                  -- 入金通貨(JPY/GBP 等)
  fx_rate           NUMERIC(18,6),         -- 入金日レート
  sales_input       NUMERIC(20,4),         -- 生入力(外貨売上 or 円売上)
  unit_price        NUMERIC(20,4),         -- 製造ベース: 基準価格
  quantity          NUMERIC(20,4),         -- 製造ベース: 製造数
  sample_quantity   NUMERIC(20,4),         -- 製造ベース: サンプル数
  sales_jpy         NUMERIC(20,4),         -- 算定基礎額(円) = base
  rate_pct          NUMERIC(9,4),          -- 料率(%)
  payment_jpy       NUMERIC(20,4),         -- 支払額(税抜, 円)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsl_document_id     ON royalty_statement_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_rsl_document_number ON royalty_statement_lines(document_number);
CREATE INDEX IF NOT EXISTS idx_rsl_contract_id     ON royalty_statement_lines(contract_id);
CREATE INDEX IF NOT EXISTS idx_rsl_issue_key       ON royalty_statement_lines(backlog_issue_key);
