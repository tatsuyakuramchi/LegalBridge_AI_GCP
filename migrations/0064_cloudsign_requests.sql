-- 0064_cloudsign_requests.sql
-- クラウドサイン送信の状態・履歴を管理する専用テーブル。
--   1 文書(documents.document_number) に対する送信(=CloudSign の「書類」)を 1 行で追跡する。
--   状態: draft → sent → completed / declined / canceled / error
CREATE TABLE IF NOT EXISTS cloudsign_requests (
  id                    SERIAL PRIMARY KEY,
  document_number       VARCHAR(100),            -- 紐付く自社文書(documents.document_number)
  capability_id         INTEGER,                 -- 契約(contract_capabilities.id) 任意
  template_type         VARCHAR(50),             -- service_master 等
  cloudsign_document_id VARCHAR(100),            -- CloudSign 側の書類ID(送信単位)
  status                VARCHAR(30) NOT NULL DEFAULT 'draft',
  title                 TEXT,
  participants          JSONB DEFAULT '[]'::jsonb, -- [{email,name,organization,order,status}]
  is_test               BOOLEAN DEFAULT FALSE,     -- 社内宛テスト送信か(本番宛先ガード用)
  signed_drive_link     TEXT,                      -- 締結済みPDFの保存先(Drive)
  error                 TEXT,
  created_by            VARCHAR(255),
  sent_at               TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cloudsign_requests_doc ON cloudsign_requests(document_number);
CREATE INDEX IF NOT EXISTS idx_cloudsign_requests_cap ON cloudsign_requests(capability_id);
-- CloudSign 側IDで Webhook から逆引きするためユニーク。
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloudsign_requests_csid
  ON cloudsign_requests(cloudsign_document_id)
  WHERE cloudsign_document_id IS NOT NULL;
