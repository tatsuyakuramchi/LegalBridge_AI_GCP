-- 0089_simplify_condition_core.sql
-- スキーマ単純化 Phase 1（DDL）: 「文書⇄CL⇄原作マテリアル⇄作品⇄原作」コアの再構築。
--   設計: docs/design/schema-simplification-plan.md
--   前提: 現状データは破棄してよい（再ビルド可能）。周辺(vendors/ringi/royalty/signature 等)は対象外。
--
--   確定方針:
--     ① 条件は condition_lines に一本化（cfc/cli/expenses/other_fees は廃止 → 互換ビュー化）
--     ② documents と contract_capabilities を統合（documents を完全スーパーセット化 → 互換ビュー化）
--     ③ 作品⇄原作マテリアルは N:N（work_material_uses）に一本化
--   付随確定: 取引形態ヘッダは CL インライン / 経費・手数料も独立CL / 分割・受領は温存
--             / material は source_material_id(→work_materials) を正準・NULL許容
--
--   移行手法（ユーザ確定: 互換ビュー方式）:
--     旧 contract_capabilities / capability_financial_conditions / capability_line_items /
--     capability_expenses / capability_other_fees を物理 DROP し、同名の互換 VIEW として再作成。
--     ~870 の SELECT 参照と ~100 の INSERT/UPDATE/DELETE は INSTEAD OF トリガ経由で無改修動作。
--     物理スキーマは documents + condition_lines の 2 表に単純化（真実源）。
--     ※ 周辺レガシー表（ledgers/materials/source_ips/work_components 等）は本移行では温存（後段で退役）。
--
--   ⚠ 破壊的（DROP CASCADE）。デプロイは Phase 2-4(コード書換え)完了後に release/worker へ。

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 0. 旧コアに依存するビューを撤去。新スキーマ向け残高/予定/状態ビューは Phase 3 で再作成。
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS condition_line_status_v   CASCADE;
DROP VIEW IF EXISTS condition_line_balance_v  CASCADE;
DROP VIEW IF EXISTS condition_line_schedule_v CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. documents へ契約マスタ(contract_capabilities)の主要列を統合（②の第一段）
--    ※ 残り cc 列の完全スーパーセット化は後段 compat ブロックで実施。
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS vendor_id             INTEGER REFERENCES vendors(id),
  ADD COLUMN IF NOT EXISTS record_type           VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contract_category      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contract_type          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contract_title         TEXT,
  ADD COLUMN IF NOT EXISTS contract_status        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS effective_date         DATE,
  ADD COLUMN IF NOT EXISTS expiration_date        DATE,
  ADD COLUMN IF NOT EXISTS flow_direction         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS deliverable_ownership  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS backlog_issue_key      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ledger_ref_id          INTEGER REFERENCES works(id),
  ADD COLUMN IF NOT EXISTS ledger_code            VARCHAR(40),
  ADD COLUMN IF NOT EXISTS material_ref_id        INTEGER REFERENCES work_materials(id),
  ADD COLUMN IF NOT EXISTS master_document_id     INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS is_active              BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_renewal           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS renewal_notice_months  INTEGER,
  ADD COLUMN IF NOT EXISTS alert_lead_months      INTEGER,
  ADD COLUMN IF NOT EXISTS alert_slack_channels   JSONB,
  ADD COLUMN IF NOT EXISTS alert_slack_mentions   JSONB,
  ADD COLUMN IF NOT EXISTS original_work          TEXT,
  ADD COLUMN IF NOT EXISTS product_name           TEXT,
  ADD COLUMN IF NOT EXISTS work_name              TEXT,
  ADD COLUMN IF NOT EXISTS media                  TEXT,
  ADD COLUMN IF NOT EXISTS territory              TEXT,
  ADD COLUMN IF NOT EXISTS language               TEXT,
  ADD COLUMN IF NOT EXISTS condition_number       TEXT,
  ADD COLUMN IF NOT EXISTS document_url           TEXT,
  ADD COLUMN IF NOT EXISTS template_family        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_documents_ledger   ON documents(ledger_code) WHERE ledger_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_vendor   ON documents(vendor_id)   WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_master   ON documents(master_document_id) WHERE master_document_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. condition_lines: 新リンク列＋取引形態ヘッダ/経済メタ＋互換用 legacy_role（①）
--    既存の source_material_id(→work_materials)/source_work_id(→works) を正準とする。
--    capability_id は廃止せず document_id のミラー（旧 cl.capability_id 参照の互換用）。
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS document_id          INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS group_no             INTEGER,
  ADD COLUMN IF NOT EXISTS legacy_role          VARCHAR(16),   -- cfc/cli/expense/other_fee（互換ビュー振分け）
  ADD COLUMN IF NOT EXISTS condition_name       TEXT,
  ADD COLUMN IF NOT EXISTS calc_type            VARCHAR(30),
  ADD COLUMN IF NOT EXISTS fixed_kind           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS subscription_cycle   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS unit_amount          NUMERIC,
  ADD COLUMN IF NOT EXISTS guarantee_type       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS region_territory     TEXT,
  ADD COLUMN IF NOT EXISTS region_language      TEXT,
  ADD COLUMN IF NOT EXISTS applies_scope        TEXT,
  ADD COLUMN IF NOT EXISTS deliverable_ownership VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_addon             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manufacturer         TEXT,
  ADD COLUMN IF NOT EXISTS seller                TEXT,
  ADD COLUMN IF NOT EXISTS max_region           TEXT,
  ADD COLUMN IF NOT EXISTS max_language         TEXT;

CREATE INDEX IF NOT EXISTS idx_cl_document  ON condition_lines(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cl_group     ON condition_lines(document_id, group_no);
CREATE INDEX IF NOT EXISTS idx_cl_role      ON condition_lines(legacy_role) WHERE legacy_role IS NOT NULL;
ALTER TABLE condition_lines ADD CONSTRAINT cl_document_line_no_uq UNIQUE (document_id, line_no);

-- capability_id は document_id のミラー。旧 FK は contract_capabilities DROP で外れる。NULL 許容化のみ。
ALTER TABLE condition_lines ALTER COLUMN capability_id DROP NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. work_material_uses（作品 N:N 原作マテリアル）。③
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_material_uses (
  id                SERIAL PRIMARY KEY,
  work_id           INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  material_id       INTEGER NOT NULL REFERENCES work_materials(id) ON DELETE CASCADE,
  condition_line_id INTEGER REFERENCES condition_lines(id) ON DELETE CASCADE,
  use_no            INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, condition_line_id)
);
CREATE INDEX IF NOT EXISTS idx_wmu_work     ON work_material_uses(work_id);
CREATE INDEX IF NOT EXISTS idx_wmu_material ON work_material_uses(material_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. 受領(condition_receipts) を cfc 依存から condition_line_id へ付け替え
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE condition_receipts
  ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id) ON DELETE CASCADE;
ALTER TABLE condition_receipts ALTER COLUMN condition_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creceipts_line ON condition_receipts(condition_line_id);

ALTER TABLE royalty_calculations
  ADD COLUMN IF NOT EXISTS condition_line_id INTEGER REFERENCES condition_lines(id);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. 旧コア表を DROP（互換ビューで再作成するため）。範囲は ①② の対象のみ。
--    ledgers/materials/source_ips/source_ip_materials/contract_financial_terms/
--    license_financial_conditions/work_components/work_component_lines はレガシーだが
--    読み取り参照が残るため本移行では温存（後段で退役）。
-- ───────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS capability_financial_conditions CASCADE;
DROP TABLE IF EXISTS capability_line_items           CASCADE;
DROP TABLE IF EXISTS capability_expenses             CASCADE;
DROP TABLE IF EXISTS capability_other_fees           CASCADE;
DROP TABLE IF EXISTS contract_capabilities           CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. condition_lines の旧結線列を掃除（capability_id は document_id ミラーとして温存）。
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE condition_lines
  DROP COLUMN IF EXISTS material_id,
  DROP COLUMN IF EXISTS source_ip_id,
  DROP COLUMN IF EXISTS master_contract_id,
  DROP COLUMN IF EXISTS ledger_code;

ALTER TABLE work_materials
  DROP COLUMN IF EXISTS source_ip_id,
  DROP COLUMN IF EXISTS source_ip_material_id,
  DROP COLUMN IF EXISTS source_contract_id,
  DROP COLUMN IF EXISTS license_financial_term_id,
  DROP COLUMN IF EXISTS license_condition_id,
  DROP COLUMN IF EXISTS service_line_item_id;

-- ════════════════════════════════════════════════════════════════════════
-- 7. 互換ビュー（documents/condition_lines 上）＋ INSTEAD OF トリガ
-- ════════════════════════════════════════════════════════════════════════
-- AUTO-GENERATED compat layer (gen_migration.ts). Hand-edited header in 0089.

-- documents 完全スーパーセット化（不足 cc 列を追加）
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS external_asset_id integer,
  ADD COLUMN IF NOT EXISTS source_system character varying(50),
  ADD COLUMN IF NOT EXISTS legalon_url text,
  ADD COLUMN IF NOT EXISTS cloudsign_url text,
  ADD COLUMN IF NOT EXISTS drive_url text,
  ADD COLUMN IF NOT EXISTS purpose_codes text[],
  ADD COLUMN IF NOT EXISTS purchase_order_allowed boolean,
  ADD COLUMN IF NOT EXISTS license_condition_allowed boolean,
  ADD COLUMN IF NOT EXISTS publication_contract_allowed boolean,
  ADD COLUMN IF NOT EXISTS publication_condition_allowed boolean,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS covered_service_categories text,
  ADD COLUMN IF NOT EXISTS covered_works text,
  ADD COLUMN IF NOT EXISTS covered_products text,
  ADD COLUMN IF NOT EXISTS covered_media text,
  ADD COLUMN IF NOT EXISTS covered_territory text,
  ADD COLUMN IF NOT EXISTS covered_language text,
  ADD COLUMN IF NOT EXISTS sublicense_allowed character varying(100),
  ADD COLUMN IF NOT EXISTS overseas_allowed boolean,
  ADD COLUMN IF NOT EXISTS translation_allowed boolean,
  ADD COLUMN IF NOT EXISTS ebook_allowed boolean,
  ADD COLUMN IF NOT EXISTS merchandising_allowed boolean,
  ADD COLUMN IF NOT EXISTS video_adaptation_allowed boolean,
  ADD COLUMN IF NOT EXISTS game_adaptation_allowed boolean,
  ADD COLUMN IF NOT EXISTS risk_flags jsonb,
  ADD COLUMN IF NOT EXISTS legal_review_required boolean,
  ADD COLUMN IF NOT EXISTS scope_confidence character varying(20),
  ADD COLUMN IF NOT EXISTS reason_template text,
  ADD COLUMN IF NOT EXISTS caution_note text,
  ADD COLUMN IF NOT EXISTS additional_parties jsonb,
  ADD COLUMN IF NOT EXISTS last_renewal_alert_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tax_rate integer,
  ADD COLUMN IF NOT EXISTS amount_ex_tax numeric(15,2),
  ADD COLUMN IF NOT EXISTS amount_inc_tax numeric(15,2),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS issue_date_po date,
  ADD COLUMN IF NOT EXISTS legal_request_id integer,
  ADD COLUMN IF NOT EXISTS structural_role character varying(10),
  ADD COLUMN IF NOT EXISTS parent_capability_id integer;

-- documents NOT NULL 既定（cc 互換 INSERT を安全化）
ALTER TABLE documents ALTER COLUMN issue_key SET DEFAULT '', ALTER COLUMN template_type SET DEFAULT '', ALTER COLUMN form_data SET DEFAULT '{}'::jsonb, ALTER COLUMN drive_link SET DEFAULT '';

-- ===== contract_capabilities → documents の互換ビュー =====
CREATE VIEW contract_capabilities AS
  SELECT id, vendor_id, external_asset_id, record_type, contract_category, contract_type, contract_title, document_number, contract_status, effective_date, expiration_date, auto_renewal, source_system, legalon_url, cloudsign_url, drive_url, document_url, purpose_codes, purchase_order_allowed, license_condition_allowed, publication_contract_allowed, publication_condition_allowed, condition_number, original_work, work_name, product_name, media, territory, language, scope, covered_service_categories, covered_works, covered_products, covered_media, covered_territory, covered_language, sublicense_allowed, overseas_allowed, translation_allowed, ebook_allowed, merchandising_allowed, video_adaptation_allowed, game_adaptation_allowed, risk_flags, legal_review_required, scope_confidence, reason_template, caution_note, created_at, updated_at, base_document_number, revision, is_primary, superseded_by, lifecycle_status, is_active, additional_parties, renewal_notice_months, alert_lead_months, last_renewal_alert_at, alert_slack_channels, alert_slack_mentions, ledger_code, ledger_ref_id, material_ref_id, tax_rate, amount_ex_tax, amount_inc_tax, tax_amount, due_date, issue_date_po, legal_request_id, backlog_issue_key, flow_direction, deliverable_ownership, structural_role, parent_capability_id, template_family
  FROM documents;

CREATE OR REPLACE FUNCTION cc_compat_ins() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE did integer;
BEGIN
  INSERT INTO documents (issue_key, template_type, form_data, drive_link, vendor_id, external_asset_id, record_type, contract_category, contract_type, contract_title, document_number, contract_status, effective_date, expiration_date, auto_renewal, source_system, legalon_url, cloudsign_url, drive_url, document_url, purpose_codes, purchase_order_allowed, license_condition_allowed, publication_contract_allowed, publication_condition_allowed, condition_number, original_work, work_name, product_name, media, territory, language, scope, covered_service_categories, covered_works, covered_products, covered_media, covered_territory, covered_language, sublicense_allowed, overseas_allowed, translation_allowed, ebook_allowed, merchandising_allowed, video_adaptation_allowed, game_adaptation_allowed, risk_flags, legal_review_required, scope_confidence, reason_template, caution_note, base_document_number, revision, is_primary, superseded_by, lifecycle_status, is_active, additional_parties, renewal_notice_months, alert_lead_months, last_renewal_alert_at, alert_slack_channels, alert_slack_mentions, ledger_code, ledger_ref_id, material_ref_id, tax_rate, amount_ex_tax, amount_inc_tax, tax_amount, due_date, issue_date_po, legal_request_id, backlog_issue_key, flow_direction, deliverable_ownership, structural_role, parent_capability_id, template_family)
  VALUES ('', COALESCE(NEW.contract_type,''), '{}'::jsonb, COALESCE(NEW.document_url,''), NEW.vendor_id, NEW.external_asset_id, NEW.record_type, NEW.contract_category, NEW.contract_type, NEW.contract_title, NEW.document_number, NEW.contract_status, NEW.effective_date, NEW.expiration_date, NEW.auto_renewal, NEW.source_system, NEW.legalon_url, NEW.cloudsign_url, NEW.drive_url, NEW.document_url, NEW.purpose_codes, NEW.purchase_order_allowed, NEW.license_condition_allowed, NEW.publication_contract_allowed, NEW.publication_condition_allowed, NEW.condition_number, NEW.original_work, NEW.work_name, NEW.product_name, NEW.media, NEW.territory, NEW.language, NEW.scope, NEW.covered_service_categories, NEW.covered_works, NEW.covered_products, NEW.covered_media, NEW.covered_territory, NEW.covered_language, NEW.sublicense_allowed, NEW.overseas_allowed, NEW.translation_allowed, NEW.ebook_allowed, NEW.merchandising_allowed, NEW.video_adaptation_allowed, NEW.game_adaptation_allowed, NEW.risk_flags, NEW.legal_review_required, NEW.scope_confidence, NEW.reason_template, NEW.caution_note, NEW.base_document_number, NEW.revision, NEW.is_primary, NEW.superseded_by, NEW.lifecycle_status, NEW.is_active, NEW.additional_parties, NEW.renewal_notice_months, NEW.alert_lead_months, NEW.last_renewal_alert_at, NEW.alert_slack_channels, NEW.alert_slack_mentions, NEW.ledger_code, NEW.ledger_ref_id, NEW.material_ref_id, NEW.tax_rate, NEW.amount_ex_tax, NEW.amount_inc_tax, NEW.tax_amount, NEW.due_date, NEW.issue_date_po, NEW.legal_request_id, NEW.backlog_issue_key, NEW.flow_direction, NEW.deliverable_ownership, NEW.structural_role, NEW.parent_capability_id, NEW.template_family)
  ON CONFLICT (document_number) DO UPDATE SET
    vendor_id = COALESCE(EXCLUDED.vendor_id, documents.vendor_id),
    external_asset_id = COALESCE(EXCLUDED.external_asset_id, documents.external_asset_id),
    record_type = COALESCE(EXCLUDED.record_type, documents.record_type),
    contract_category = COALESCE(EXCLUDED.contract_category, documents.contract_category),
    contract_type = COALESCE(EXCLUDED.contract_type, documents.contract_type),
    contract_title = COALESCE(EXCLUDED.contract_title, documents.contract_title),
    contract_status = COALESCE(EXCLUDED.contract_status, documents.contract_status),
    effective_date = COALESCE(EXCLUDED.effective_date, documents.effective_date),
    expiration_date = COALESCE(EXCLUDED.expiration_date, documents.expiration_date),
    auto_renewal = COALESCE(EXCLUDED.auto_renewal, documents.auto_renewal),
    source_system = COALESCE(EXCLUDED.source_system, documents.source_system),
    legalon_url = COALESCE(EXCLUDED.legalon_url, documents.legalon_url),
    cloudsign_url = COALESCE(EXCLUDED.cloudsign_url, documents.cloudsign_url),
    drive_url = COALESCE(EXCLUDED.drive_url, documents.drive_url),
    document_url = COALESCE(EXCLUDED.document_url, documents.document_url),
    purpose_codes = COALESCE(EXCLUDED.purpose_codes, documents.purpose_codes),
    purchase_order_allowed = COALESCE(EXCLUDED.purchase_order_allowed, documents.purchase_order_allowed),
    license_condition_allowed = COALESCE(EXCLUDED.license_condition_allowed, documents.license_condition_allowed),
    publication_contract_allowed = COALESCE(EXCLUDED.publication_contract_allowed, documents.publication_contract_allowed),
    publication_condition_allowed = COALESCE(EXCLUDED.publication_condition_allowed, documents.publication_condition_allowed),
    condition_number = COALESCE(EXCLUDED.condition_number, documents.condition_number),
    original_work = COALESCE(EXCLUDED.original_work, documents.original_work),
    work_name = COALESCE(EXCLUDED.work_name, documents.work_name),
    product_name = COALESCE(EXCLUDED.product_name, documents.product_name),
    media = COALESCE(EXCLUDED.media, documents.media),
    territory = COALESCE(EXCLUDED.territory, documents.territory),
    language = COALESCE(EXCLUDED.language, documents.language),
    scope = COALESCE(EXCLUDED.scope, documents.scope),
    covered_service_categories = COALESCE(EXCLUDED.covered_service_categories, documents.covered_service_categories),
    covered_works = COALESCE(EXCLUDED.covered_works, documents.covered_works),
    covered_products = COALESCE(EXCLUDED.covered_products, documents.covered_products),
    covered_media = COALESCE(EXCLUDED.covered_media, documents.covered_media),
    covered_territory = COALESCE(EXCLUDED.covered_territory, documents.covered_territory),
    covered_language = COALESCE(EXCLUDED.covered_language, documents.covered_language),
    sublicense_allowed = COALESCE(EXCLUDED.sublicense_allowed, documents.sublicense_allowed),
    overseas_allowed = COALESCE(EXCLUDED.overseas_allowed, documents.overseas_allowed),
    translation_allowed = COALESCE(EXCLUDED.translation_allowed, documents.translation_allowed),
    ebook_allowed = COALESCE(EXCLUDED.ebook_allowed, documents.ebook_allowed),
    merchandising_allowed = COALESCE(EXCLUDED.merchandising_allowed, documents.merchandising_allowed),
    video_adaptation_allowed = COALESCE(EXCLUDED.video_adaptation_allowed, documents.video_adaptation_allowed),
    game_adaptation_allowed = COALESCE(EXCLUDED.game_adaptation_allowed, documents.game_adaptation_allowed),
    risk_flags = COALESCE(EXCLUDED.risk_flags, documents.risk_flags),
    legal_review_required = COALESCE(EXCLUDED.legal_review_required, documents.legal_review_required),
    scope_confidence = COALESCE(EXCLUDED.scope_confidence, documents.scope_confidence),
    reason_template = COALESCE(EXCLUDED.reason_template, documents.reason_template),
    caution_note = COALESCE(EXCLUDED.caution_note, documents.caution_note),
    base_document_number = COALESCE(EXCLUDED.base_document_number, documents.base_document_number),
    revision = COALESCE(EXCLUDED.revision, documents.revision),
    is_primary = COALESCE(EXCLUDED.is_primary, documents.is_primary),
    superseded_by = COALESCE(EXCLUDED.superseded_by, documents.superseded_by),
    lifecycle_status = COALESCE(EXCLUDED.lifecycle_status, documents.lifecycle_status),
    is_active = COALESCE(EXCLUDED.is_active, documents.is_active),
    additional_parties = COALESCE(EXCLUDED.additional_parties, documents.additional_parties),
    renewal_notice_months = COALESCE(EXCLUDED.renewal_notice_months, documents.renewal_notice_months),
    alert_lead_months = COALESCE(EXCLUDED.alert_lead_months, documents.alert_lead_months),
    last_renewal_alert_at = COALESCE(EXCLUDED.last_renewal_alert_at, documents.last_renewal_alert_at),
    alert_slack_channels = COALESCE(EXCLUDED.alert_slack_channels, documents.alert_slack_channels),
    alert_slack_mentions = COALESCE(EXCLUDED.alert_slack_mentions, documents.alert_slack_mentions),
    ledger_code = COALESCE(EXCLUDED.ledger_code, documents.ledger_code),
    ledger_ref_id = COALESCE(EXCLUDED.ledger_ref_id, documents.ledger_ref_id),
    material_ref_id = COALESCE(EXCLUDED.material_ref_id, documents.material_ref_id),
    tax_rate = COALESCE(EXCLUDED.tax_rate, documents.tax_rate),
    amount_ex_tax = COALESCE(EXCLUDED.amount_ex_tax, documents.amount_ex_tax),
    amount_inc_tax = COALESCE(EXCLUDED.amount_inc_tax, documents.amount_inc_tax),
    tax_amount = COALESCE(EXCLUDED.tax_amount, documents.tax_amount),
    due_date = COALESCE(EXCLUDED.due_date, documents.due_date),
    issue_date_po = COALESCE(EXCLUDED.issue_date_po, documents.issue_date_po),
    legal_request_id = COALESCE(EXCLUDED.legal_request_id, documents.legal_request_id),
    backlog_issue_key = COALESCE(EXCLUDED.backlog_issue_key, documents.backlog_issue_key),
    flow_direction = COALESCE(EXCLUDED.flow_direction, documents.flow_direction),
    deliverable_ownership = COALESCE(EXCLUDED.deliverable_ownership, documents.deliverable_ownership),
    structural_role = COALESCE(EXCLUDED.structural_role, documents.structural_role),
    parent_capability_id = COALESCE(EXCLUDED.parent_capability_id, documents.parent_capability_id),
    template_family = COALESCE(EXCLUDED.template_family, documents.template_family),
    updated_at = now()
  RETURNING id INTO did;
  NEW.id := did;
  RETURN NEW;
END $fn$;
CREATE TRIGGER tg_cc_ins INSTEAD OF INSERT ON contract_capabilities FOR EACH ROW EXECUTE FUNCTION cc_compat_ins();

-- ===== capability_* → condition_lines の互換ビュー =====
CREATE VIEW capability_financial_conditions AS
  SELECT
    cl.id AS id,
    cl.capability_id AS capability_id,
    cl.line_no AS condition_no,
    cl.condition_name AS region_language_label,
    CASE cl.payment_scheme WHEN 'royalty' THEN 'ROYALTY' WHEN 'subscription' THEN 'SUBSCRIPTION' WHEN 'per_unit' THEN 'PER_UNIT' WHEN 'installment' THEN 'INSTALLMENT' ELSE 'FIXED' END AS calc_method,
    cl.rate_pct AS rate_pct,
    cl.base_price_label AS base_price_label,
    cl.calc_period AS calc_period,
    cl.calc_period_kind AS calc_period_kind,
    cl.calc_period_close_month AS calc_period_close_month,
    cl.currency AS currency,
    cl.formula_text AS formula_text,
    cl.payment_terms AS payment_terms,
    cl.mg_amount AS mg_amount,
    cl.ag_amount AS ag_amount,
    cl.created_at AS created_at,
    cl.updated_at AS updated_at,
    cl.source_work_id AS work_id,
    cl.source_work_id AS source_work_id,
    cl.source_material_id AS source_material_id,
    NULL::character varying(20) AS condition_kind,
    cl.counterparty_vendor_id AS counterparty_vendor_id,
    NULL::character varying(20) AS basis,
    cl.unit_price AS unit_price,
    cl.cycle AS cycle,
    cl.billing_day AS billing_day,
    cl.term_start AS term_start,
    cl.term_end AS term_end,
    NULL::numeric(15,2) AS advance_amount,
    NULL::numeric(15,2) AS forecast_amount,
    cl.condition_name AS condition_name,
    cl.calc_type AS calc_type,
    cl.fixed_kind AS fixed_kind,
    cl.subscription_cycle AS subscription_cycle,
    cl.unit_amount AS unit_amount,
    cl.guarantee_type AS guarantee_type,
    cl.region_territory AS region_territory,
    cl.region_language AS region_language,
    cl.applies_scope AS applies_scope,
    NULL::integer AS copied_from_condition_id,
    cl.manufacturer AS manufacturer,
    cl.seller AS seller,
    cl.max_region AS max_region,
    cl.max_language AS max_language,
    cl.is_addon AS is_addon,
    cl.quantity::text AS quantity
  FROM condition_lines cl
  WHERE cl.legacy_role = 'cfc';

CREATE VIEW capability_line_items AS
  SELECT
    cl.id AS id,
    cl.capability_id AS capability_id,
    (cl.line_no-1000) AS line_no,
    cl.category AS category,
    cl.condition_name AS item_name,
    cl.spec AS spec,
    CASE cl.payment_scheme WHEN 'subscription' THEN 'SUBSCRIPTION' ELSE 'FIXED' END AS calc_method,
    cl.payment_method AS payment_method,
    cl.payment_terms AS payment_terms,
    cl.quantity::numeric AS quantity,
    cl.unit_price AS unit_price,
    cl.amount_ex_tax AS amount_ex_tax,
    cl.delivery_date AS delivery_date,
    cl.payment_date AS payment_date,
    cl.cycle AS cycle,
    cl.billing_day AS billing_day,
    cl.term_start AS term_start,
    cl.term_end AS term_end,
    cl.created_at AS created_at,
    cl.updated_at AS updated_at,
    NULL::numeric(15,2) AS inspected_amount_ex_tax,
    NULL::timestamp with time zone AS last_alert_at,
    NULL::integer AS alert_count,
    NULL::integer AS source_ip_id,
    cl.source_work_id AS work_id,
    NULL::integer AS master_contract_id,
    NULL::integer AS ringi_id,
    cl.status_flags AS status_flags,
    cl.is_inbound AS is_inbound,
    CASE cl.direction WHEN 'receivable' THEN 'out' ELSE 'in' END AS flow_direction,
    NULL::character varying(20) AS fee_type,
    cl.rate_pct AS rate_pct,
    cl.deliverable_ownership AS deliverable_ownership,
    NULL::text AS royalty_calc_basis
  FROM condition_lines cl
  WHERE cl.legacy_role = 'cli';

CREATE VIEW capability_expenses AS
  SELECT
    cl.id AS id,
    cl.capability_id AS capability_id,
    (cl.line_no-3000) AS line_no,
    cl.condition_name AS expense_name,
    cl.spec AS spec,
    cl.payment_date AS spent_date,
    cl.amount_ex_tax AS amount_inc_tax,
    cl.notes AS remarks,
    cl.created_at AS created_at,
    cl.updated_at AS updated_at
  FROM condition_lines cl
  WHERE cl.legacy_role = 'expense';

CREATE VIEW capability_other_fees AS
  SELECT
    cl.id AS id,
    cl.capability_id AS capability_id,
    (cl.line_no-2000) AS line_no,
    cl.condition_name AS fee_name,
    cl.amount_ex_tax AS amount,
    cl.notes AS remarks,
    cl.created_at AS created_at,
    cl.updated_at AS updated_at
  FROM condition_lines cl
  WHERE cl.legacy_role = 'other_fee';

-- ===== 共有ヘルパ（CL 派生ロジック：conditionWrite.ts と整合） =====
CREATE OR REPLACE FUNCTION cl_scheme(cm text, rate numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(coalesce(cm,'')) IN ('ROYALTY')              THEN 'royalty'
    WHEN upper(coalesce(cm,'')) IN ('SUBSCRIPTION')          THEN 'subscription'
    WHEN upper(coalesce(cm,'')) IN ('PER_UNIT','PERUNIT')    THEN 'per_unit'
    WHEN upper(coalesce(cm,'')) IN ('INSTALLMENT')           THEN 'installment'
    WHEN rate IS NOT NULL                                    THEN 'royalty'
    ELSE 'lump_sum' END;
$$;
CREATE OR REPLACE FUNCTION cl_dir(doc integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN lower(coalesce((SELECT flow_direction FROM documents WHERE id=doc),'')) = 'out'
              THEN 'receivable' ELSE 'payable' END;
$$;
CREATE OR REPLACE FUNCTION cl_resolve_work(mat integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT work_id FROM work_materials WHERE id = mat;
$$;
CREATE OR REPLACE FUNCTION cl_next_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE y int := EXTRACT(YEAR FROM now())::int; v int;
BEGIN
  INSERT INTO document_sequences (kind, year, current_value) VALUES ('condition_line', y, 1)
    ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
  RETURNING current_value INTO v;
  RETURN 'CL-'||y||'-'||lpad(v::text,5,'0');
END $$;

-- =========================== capability_financial_conditions ===========================
CREATE OR REPLACE FUNCTION cfc_ins() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_scheme text; v_dir text; v_swork int; v_code text; v_amt numeric; rid int; v_ln int;
BEGIN
  v_ln    := NEW.condition_no;
  v_scheme:= cl_scheme(NEW.calc_method, NEW.rate_pct);
  v_dir   := cl_dir(NEW.capability_id);
  v_swork := COALESCE(NEW.source_work_id, NEW.work_id, cl_resolve_work(NEW.source_material_id));
  SELECT line_code INTO v_code FROM condition_lines WHERE document_id=NEW.capability_id AND line_no=v_ln;
  IF v_code IS NULL THEN v_code := cl_next_code(); END IF;
  v_amt := CASE WHEN v_scheme IN ('royalty','subscription') THEN NULL ELSE COALESCE(NEW.unit_amount, NEW.mg_amount, 0) END;
  INSERT INTO condition_lines (
    document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
    status_flags, is_inbound, is_addon, transaction_kind, condition_name, rate_pct, mg_amount, ag_amount,
    currency, base_price_label, formula_text, payment_terms, calc_period, calc_period_kind, calc_period_close_month,
    counterparty_vendor_id, source_work_id, source_material_id, unit_price, cycle, billing_day, term_start, term_end,
    calc_type, fixed_kind, subscription_cycle, unit_amount, guarantee_type, region_territory, region_language,
    applies_scope, manufacturer, seller, max_region, max_language, quantity, amount_ex_tax, updated_at
  ) VALUES (
    NEW.capability_id, NEW.capability_id, v_ln, 'cfc', v_code, v_dir, v_scheme,
    '{}', false, COALESCE(NEW.is_addon,false), 'license', NEW.condition_name,
    CASE WHEN v_scheme='royalty' THEN NEW.rate_pct END,
    CASE WHEN v_scheme='royalty' THEN NEW.mg_amount END,
    CASE WHEN v_scheme='royalty' THEN NEW.ag_amount END,
    COALESCE(NEW.currency,'JPY'), NEW.base_price_label, NEW.formula_text, NEW.payment_terms,
    NEW.calc_period, NEW.calc_period_kind, NEW.calc_period_close_month, NEW.counterparty_vendor_id,
    v_swork, NEW.source_material_id, NEW.unit_price, NEW.cycle, NEW.billing_day, NEW.term_start, NEW.term_end,
    NEW.calc_type, NEW.fixed_kind, NEW.subscription_cycle, NEW.unit_amount, NEW.guarantee_type,
    NEW.region_territory, NEW.region_language, NEW.applies_scope, NEW.manufacturer, NEW.seller,
    NEW.max_region, NEW.max_language, NEW.quantity::numeric, v_amt, now()
  )
  ON CONFLICT (document_id, line_no) DO UPDATE SET
    legacy_role='cfc', direction=EXCLUDED.direction, payment_scheme=EXCLUDED.payment_scheme, is_addon=EXCLUDED.is_addon,
    transaction_kind='license', condition_name=EXCLUDED.condition_name, rate_pct=EXCLUDED.rate_pct, mg_amount=EXCLUDED.mg_amount,
    ag_amount=EXCLUDED.ag_amount, currency=EXCLUDED.currency, base_price_label=EXCLUDED.base_price_label,
    formula_text=EXCLUDED.formula_text, payment_terms=EXCLUDED.payment_terms, calc_period=EXCLUDED.calc_period,
    calc_period_kind=EXCLUDED.calc_period_kind, calc_period_close_month=EXCLUDED.calc_period_close_month,
    counterparty_vendor_id=EXCLUDED.counterparty_vendor_id, source_work_id=EXCLUDED.source_work_id,
    source_material_id=EXCLUDED.source_material_id, unit_price=EXCLUDED.unit_price, cycle=EXCLUDED.cycle,
    billing_day=EXCLUDED.billing_day, term_start=EXCLUDED.term_start, term_end=EXCLUDED.term_end, calc_type=EXCLUDED.calc_type,
    fixed_kind=EXCLUDED.fixed_kind, subscription_cycle=EXCLUDED.subscription_cycle, unit_amount=EXCLUDED.unit_amount,
    guarantee_type=EXCLUDED.guarantee_type, region_territory=EXCLUDED.region_territory, region_language=EXCLUDED.region_language,
    applies_scope=EXCLUDED.applies_scope, manufacturer=EXCLUDED.manufacturer, seller=EXCLUDED.seller,
    max_region=EXCLUDED.max_region, max_language=EXCLUDED.max_language, quantity=EXCLUDED.quantity,
    amount_ex_tax=EXCLUDED.amount_ex_tax, updated_at=now()
  RETURNING id INTO rid;
  NEW.id := rid; RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION cfc_upd() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_scheme text;
BEGIN
  v_scheme := cl_scheme(NEW.calc_method, NEW.rate_pct);
  UPDATE condition_lines SET
    line_no=NEW.condition_no, payment_scheme=v_scheme, is_addon=COALESCE(NEW.is_addon,false),
    condition_name=NEW.condition_name,
    rate_pct=CASE WHEN v_scheme='royalty' THEN NEW.rate_pct END,
    mg_amount=CASE WHEN v_scheme='royalty' THEN NEW.mg_amount END,
    ag_amount=CASE WHEN v_scheme='royalty' THEN NEW.ag_amount END,
    currency=COALESCE(NEW.currency,'JPY'), base_price_label=NEW.base_price_label, formula_text=NEW.formula_text,
    payment_terms=NEW.payment_terms, calc_period=NEW.calc_period, calc_period_kind=NEW.calc_period_kind,
    calc_period_close_month=NEW.calc_period_close_month, counterparty_vendor_id=NEW.counterparty_vendor_id,
    source_work_id=COALESCE(NEW.source_work_id, NEW.work_id, cl_resolve_work(NEW.source_material_id)),
    source_material_id=NEW.source_material_id, unit_price=NEW.unit_price, cycle=NEW.cycle, billing_day=NEW.billing_day,
    term_start=NEW.term_start, term_end=NEW.term_end, calc_type=NEW.calc_type, fixed_kind=NEW.fixed_kind,
    subscription_cycle=NEW.subscription_cycle, unit_amount=NEW.unit_amount, guarantee_type=NEW.guarantee_type,
    region_territory=NEW.region_territory, region_language=NEW.region_language, applies_scope=NEW.applies_scope,
    manufacturer=NEW.manufacturer, seller=NEW.seller, max_region=NEW.max_region, max_language=NEW.max_language,
    quantity=NEW.quantity::numeric,
    amount_ex_tax=CASE WHEN v_scheme IN ('royalty','subscription') THEN NULL ELSE COALESCE(NEW.unit_amount,NEW.mg_amount,0) END,
    updated_at=now()
  WHERE id = OLD.id;
  RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION cl_view_del() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN DELETE FROM condition_lines WHERE id = OLD.id; RETURN OLD; END $fn$;
CREATE TRIGGER tg_cfc_ins INSTEAD OF INSERT ON capability_financial_conditions FOR EACH ROW EXECUTE FUNCTION cfc_ins();
CREATE TRIGGER tg_cfc_upd INSTEAD OF UPDATE ON capability_financial_conditions FOR EACH ROW EXECUTE FUNCTION cfc_upd();
CREATE TRIGGER tg_cfc_del INSTEAD OF DELETE ON capability_financial_conditions FOR EACH ROW EXECUTE FUNCTION cl_view_del();

-- =========================== capability_line_items (offset 1000) ===========================
CREATE OR REPLACE FUNCTION cli_ins() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_scheme text; v_dir text; v_code text; rid int; v_ln int;
BEGIN
  v_ln    := 1000 + NEW.line_no;
  v_scheme:= CASE WHEN upper(coalesce(NEW.calc_method,''))='SUBSCRIPTION' THEN 'subscription' ELSE 'lump_sum' END;
  v_dir   := CASE WHEN lower(coalesce(NEW.flow_direction,''))='out' THEN 'receivable' ELSE cl_dir(NEW.capability_id) END;
  SELECT line_code INTO v_code FROM condition_lines WHERE document_id=NEW.capability_id AND line_no=v_ln;
  IF v_code IS NULL THEN v_code := cl_next_code(); END IF;
  INSERT INTO condition_lines (
    document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
    status_flags, is_inbound, is_addon, transaction_kind, category, condition_name, spec, payment_method,
    payment_terms, quantity, unit_price, amount_ex_tax, delivery_date, payment_date, cycle, billing_day,
    term_start, term_end, rate_pct, deliverable_ownership, source_work_id, updated_at
  ) VALUES (
    NEW.capability_id, NEW.capability_id, v_ln, 'cli', v_code, v_dir, v_scheme,
    COALESCE(NEW.status_flags,'{}'::jsonb), COALESCE(NEW.is_inbound,false), false, 'service',
    COALESCE(NEW.category,'line_item'), NEW.item_name, NEW.spec, NEW.payment_method, NEW.payment_terms,
    NEW.quantity, NEW.unit_price, COALESCE(NEW.amount_ex_tax,0), NEW.delivery_date, NEW.payment_date, NEW.cycle,
    NEW.billing_day, NEW.term_start, NEW.term_end, NULL, NEW.deliverable_ownership, NEW.work_id, now()
  )
  ON CONFLICT (document_id, line_no) DO UPDATE SET
    legacy_role='cli', direction=EXCLUDED.direction, payment_scheme=EXCLUDED.payment_scheme, transaction_kind='service',
    category=EXCLUDED.category, condition_name=EXCLUDED.condition_name, spec=EXCLUDED.spec, payment_method=EXCLUDED.payment_method,
    payment_terms=EXCLUDED.payment_terms, quantity=EXCLUDED.quantity, unit_price=EXCLUDED.unit_price,
    amount_ex_tax=EXCLUDED.amount_ex_tax, delivery_date=EXCLUDED.delivery_date, payment_date=EXCLUDED.payment_date,
    cycle=EXCLUDED.cycle, billing_day=EXCLUDED.billing_day, term_start=EXCLUDED.term_start, term_end=EXCLUDED.term_end,
    deliverable_ownership=EXCLUDED.deliverable_ownership, source_work_id=EXCLUDED.source_work_id, updated_at=now()
  RETURNING id INTO rid;
  NEW.id := rid; RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION cli_upd() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE condition_lines SET
    line_no=1000+NEW.line_no,
    payment_scheme=CASE WHEN upper(coalesce(NEW.calc_method,''))='SUBSCRIPTION' THEN 'subscription' ELSE 'lump_sum' END,
    direction=CASE WHEN lower(coalesce(NEW.flow_direction,''))='out' THEN 'receivable' WHEN lower(coalesce(NEW.flow_direction,''))='in' THEN 'payable' ELSE direction END,
    category=COALESCE(NEW.category,'line_item'), condition_name=NEW.item_name, spec=NEW.spec, payment_method=NEW.payment_method,
    payment_terms=NEW.payment_terms, quantity=NEW.quantity, unit_price=NEW.unit_price, amount_ex_tax=COALESCE(NEW.amount_ex_tax,0),
    delivery_date=NEW.delivery_date, payment_date=NEW.payment_date, cycle=NEW.cycle, billing_day=NEW.billing_day,
    term_start=NEW.term_start, term_end=NEW.term_end, deliverable_ownership=NEW.deliverable_ownership,
    source_work_id=NEW.work_id, updated_at=now()
  WHERE id = OLD.id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER tg_cli_ins INSTEAD OF INSERT ON capability_line_items FOR EACH ROW EXECUTE FUNCTION cli_ins();
CREATE TRIGGER tg_cli_upd INSTEAD OF UPDATE ON capability_line_items FOR EACH ROW EXECUTE FUNCTION cli_upd();
CREATE TRIGGER tg_cli_del INSTEAD OF DELETE ON capability_line_items FOR EACH ROW EXECUTE FUNCTION cl_view_del();

-- =========================== capability_expenses (offset 3000) ===========================
CREATE OR REPLACE FUNCTION exp_ins() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_code text; rid int; v_ln int;
BEGIN
  v_ln := 3000 + NEW.line_no;
  SELECT line_code INTO v_code FROM condition_lines WHERE document_id=NEW.capability_id AND line_no=v_ln;
  IF v_code IS NULL THEN v_code := cl_next_code(); END IF;
  INSERT INTO condition_lines (
    document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
    status_flags, is_inbound, is_addon, transaction_kind, category, condition_name, spec, payment_date,
    amount_ex_tax, notes, updated_at
  ) VALUES (
    NEW.capability_id, NEW.capability_id, v_ln, 'expense', v_code, cl_dir(NEW.capability_id), 'lump_sum',
    '{}', false, false, 'service', 'expense', NEW.expense_name, NEW.spec, NEW.spent_date,
    COALESCE(NEW.amount_inc_tax,0), NEW.remarks, now()
  )
  ON CONFLICT (document_id, line_no) DO UPDATE SET
    legacy_role='expense', category='expense', condition_name=EXCLUDED.condition_name, spec=EXCLUDED.spec,
    payment_date=EXCLUDED.payment_date, amount_ex_tax=EXCLUDED.amount_ex_tax, notes=EXCLUDED.notes, updated_at=now()
  RETURNING id INTO rid;
  NEW.id := rid; RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION exp_upd() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE condition_lines SET line_no=3000+NEW.line_no, condition_name=NEW.expense_name, spec=NEW.spec,
    payment_date=NEW.spent_date, amount_ex_tax=COALESCE(NEW.amount_inc_tax,0), notes=NEW.remarks, updated_at=now()
  WHERE id = OLD.id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER tg_exp_ins INSTEAD OF INSERT ON capability_expenses FOR EACH ROW EXECUTE FUNCTION exp_ins();
CREATE TRIGGER tg_exp_upd INSTEAD OF UPDATE ON capability_expenses FOR EACH ROW EXECUTE FUNCTION exp_upd();
CREATE TRIGGER tg_exp_del INSTEAD OF DELETE ON capability_expenses FOR EACH ROW EXECUTE FUNCTION cl_view_del();

-- =========================== capability_other_fees (offset 2000) ===========================
CREATE OR REPLACE FUNCTION fee_ins() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_code text; rid int; v_ln int;
BEGIN
  v_ln := 2000 + NEW.line_no;
  SELECT line_code INTO v_code FROM condition_lines WHERE document_id=NEW.capability_id AND line_no=v_ln;
  IF v_code IS NULL THEN v_code := cl_next_code(); END IF;
  INSERT INTO condition_lines (
    document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
    status_flags, is_inbound, is_addon, transaction_kind, category, condition_name, amount_ex_tax, notes, updated_at
  ) VALUES (
    NEW.capability_id, NEW.capability_id, v_ln, 'other_fee', v_code, cl_dir(NEW.capability_id), 'lump_sum',
    '{}', false, false, 'service', 'other_fee', NEW.fee_name, COALESCE(NEW.amount,0), NEW.remarks, now()
  )
  ON CONFLICT (document_id, line_no) DO UPDATE SET
    legacy_role='other_fee', category='other_fee', condition_name=EXCLUDED.condition_name,
    amount_ex_tax=EXCLUDED.amount_ex_tax, notes=EXCLUDED.notes, updated_at=now()
  RETURNING id INTO rid;
  NEW.id := rid; RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION fee_upd() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE condition_lines SET line_no=2000+NEW.line_no, condition_name=NEW.fee_name,
    amount_ex_tax=COALESCE(NEW.amount,0), notes=NEW.remarks, updated_at=now()
  WHERE id = OLD.id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER tg_fee_ins INSTEAD OF INSERT ON capability_other_fees FOR EACH ROW EXECUTE FUNCTION fee_ins();
CREATE TRIGGER tg_fee_upd INSTEAD OF UPDATE ON capability_other_fees FOR EACH ROW EXECUTE FUNCTION fee_upd();
CREATE TRIGGER tg_fee_del INSTEAD OF DELETE ON capability_other_fees FOR EACH ROW EXECUTE FUNCTION cl_view_del();

COMMIT;
