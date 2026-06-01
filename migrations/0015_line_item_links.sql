-- 0015_line_item_links.sql
-- 条件明細(capability_line_items)に 原作(source_ips)/ 作品(works)/
-- マスター契約(contracts = 作品モデル v3)への紐付けを追加。明細行ごとに 1 つずつ。
-- additive・冪等。参照先テーブルは 0004(source_ips/works)/ 0005(contracts)。

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS source_ip_id       INTEGER REFERENCES source_ips(id),
  ADD COLUMN IF NOT EXISTS work_id            INTEGER REFERENCES works(id),
  ADD COLUMN IF NOT EXISTS master_contract_id INTEGER REFERENCES contracts(id);

CREATE INDEX IF NOT EXISTS idx_cli_source_ip       ON capability_line_items(source_ip_id);
CREATE INDEX IF NOT EXISTS idx_cli_work            ON capability_line_items(work_id);
CREATE INDEX IF NOT EXISTS idx_cli_master_contract ON capability_line_items(master_contract_id);
