-- 0002_document_templates.sql
-- Phase 1 (A1): テンプレートの DB 化。
-- 現行の templates_config.json(label/category/_comment/vars)+ templates/*.html
-- + partials を DB に移設する器を作る。データ投入は 0003_seed_templates.sql。
-- 設計: docs/schema-redesign-proposal.md §3.5。

-- 論理テンプレ(head)。kind='partial' は共通部品(旧 templates/partials/*)。
CREATE TABLE IF NOT EXISTS document_templates (
  id                  SERIAL PRIMARY KEY,
  template_key        VARCHAR(60) UNIQUE NOT NULL,   -- 旧キー兼ファイル名 (purchase_order 等)
  kind                VARCHAR(20) NOT NULL DEFAULT 'document', -- document / partial
  label               TEXT,                          -- 旧 config.label
  category            VARCHAR(50),                   -- 旧 config.category
  comment             TEXT,                          -- 旧 config._comment
  document_prefix     VARCHAR(20),                   -- 採番prefix(情報用。実増分は worker document_sequences)
  engine              VARCHAR(20) NOT NULL DEFAULT 'handlebars',
  current_version_id  INTEGER,                       -- 現行版へのポインタ(下で FK 付与)
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 不変の版履歴。html_source=Handlebars本体、field_schema=入力フィールド定義(順序保持の配列)。
CREATE TABLE IF NOT EXISTS document_template_versions (
  id            SERIAL PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  version_no    INTEGER NOT NULL,
  html_source   TEXT NOT NULL,
  field_schema  JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  UNIQUE (template_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_dtv_template ON document_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_doc_templates_kind ON document_templates(kind);

-- 循環参照(templates.current_version_id → versions.id, versions.template_id → templates.id)。
-- 両テーブル作成後に FK を付与(IF NOT EXISTS 相当を DO ブロックで保証)。
DO $dt_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_templates_current_version_fk'
  ) THEN
    ALTER TABLE document_templates
      ADD CONSTRAINT document_templates_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES document_template_versions(id);
  END IF;
END
$dt_fk$;

-- 生成書類が「どの版で生成されたか」を固定(忠実な再レンダリング・監査)。
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS template_version_id INTEGER REFERENCES document_template_versions(id);
CREATE INDEX IF NOT EXISTS idx_documents_template_version ON documents(template_version_id);
