-- 0136_data_quality_and_entity_sources.sql
-- 設計 v1.4 DQ-01: データ完全性基盤(Data Quality)の DB スキーマ。
--   §8.3 entity_sources / §8.4 data_quality_rules・data_quality_issues・
--   entity_completeness_summary を新設し、§8.6 の完全性ルール台帳を seed する。
--
-- 方針:
--   - ルールはフロントに直書きせず、サーバ側(data_quality_rules)で定義・評価する(§8.4)。
--   - 本 migration は「基盤(テーブル + ルール台帳)」のみ。評価エンジン(述語の実行)と
--     API/UI は後続(DQ-02/04)。ここではデータは増減させず、スキーマと seed のみ。
--   - 冪等: すべて IF NOT EXISTS / ON CONFLICT。再適用しても安全。
--   - 可逆: 末尾のロールバック手順参照(DROP TABLE ...)。新規テーブルのみなので既存へ非破壊。

-- ── 8.3 入力元・証憑(provenance) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_sources (
  id                 BIGSERIAL PRIMARY KEY,
  entity_type        TEXT NOT NULL,               -- work / material / condition / contract ...
  entity_id          BIGINT NOT NULL,
  origin_type        TEXT NOT NULL,               -- document / manual / import / migration / external
  source_document_id BIGINT,
  source_file_id     BIGINT,
  source_url         TEXT,
  source_matter_id   BIGINT,
  evidence_type      TEXT,                         -- 契約書 / メール / 発注書 / 口頭 ...
  evidence_note      TEXT,
  entered_by         TEXT,
  entered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by        TEXT,
  verified_at        TIMESTAMPTZ,
  is_primary         BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_entity_sources_entity ON entity_sources (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_sources_primary ON entity_sources (entity_type, entity_id) WHERE is_primary;

-- ── 8.4 ルール台帳 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_quality_rules (
  rule_code         TEXT PRIMARY KEY,
  entity_type       TEXT NOT NULL,                -- work / material / condition / work_relation / material_rights_source / entity_source
  stage             TEXT,                          -- 空=常時。usage_start / production_start / statement_issue / calc_start / billing_start / verify / downstream_start
  severity          TEXT NOT NULL CHECK (severity IN ('BLOCKER','ERROR','WARNING','INFO')),
  predicate_key     TEXT NOT NULL,                -- 評価エンジン(DQ-02)が dispatch する識別子(既定は rule_code と同一)
  predicate_version INTEGER NOT NULL DEFAULT 1,
  remediation_type  TEXT,                          -- 修正導線の種別(UI が対象フォーム/セクションへ誘導)
  title             TEXT NOT NULL,
  description       TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 8.4 検出された Issue(解消後の再評価で自動クローズ) ────────────────
CREATE TABLE IF NOT EXISTS data_quality_issues (
  id                BIGSERIAL PRIMARY KEY,
  entity_type       TEXT NOT NULL,
  entity_id         BIGINT NOT NULL,
  rule_code         TEXT NOT NULL REFERENCES data_quality_rules (rule_code) ON UPDATE CASCADE,
  severity          TEXT NOT NULL,                -- 検出時点の実効重大度(stage で昇格し得る)
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','waived')),
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  assignee_staff_id BIGINT,
  due_at            TIMESTAMPTZ,
  resolution_type   TEXT,                          -- fixed / waived / stale ...
  resolution_note   TEXT,
  detail            JSONB,                         -- 検出コンテキスト(欠損フィールド等)
  -- 1 エンティティ×1 ルールにつき Issue は 1 行(再評価は last_detected_at 更新 / status 遷移)。
  CONSTRAINT uq_dq_issue_entity_rule UNIQUE (entity_type, entity_id, rule_code)
);
CREATE INDEX IF NOT EXISTS idx_dq_issues_entity ON data_quality_issues (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dq_issues_open ON data_quality_issues (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_dq_issues_rule ON data_quality_issues (rule_code);
CREATE INDEX IF NOT EXISTS idx_dq_issues_assignee ON data_quality_issues (assignee_staff_id) WHERE status = 'open';

-- ── 8.4 エンティティ別 完全性サマリー ─────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_completeness_summary (
  entity_type         TEXT NOT NULL,
  entity_id           BIGINT NOT NULL,
  identity_status     TEXT NOT NULL DEFAULT 'unknown',  -- ok / warning / error / blocker / unknown
  relationship_status TEXT NOT NULL DEFAULT 'unknown',
  contract_status     TEXT NOT NULL DEFAULT 'unknown',
  financial_status    TEXT NOT NULL DEFAULT 'unknown',
  evidence_status     TEXT NOT NULL DEFAULT 'unknown',
  blocker_count       INTEGER NOT NULL DEFAULT 0,
  error_count         INTEGER NOT NULL DEFAULT 0,
  warning_count       INTEGER NOT NULL DEFAULT 0,
  score               INTEGER NOT NULL DEFAULT 0,       -- 0-100
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_dq_summary_blockers ON entity_completeness_summary (entity_type) WHERE blocker_count > 0;

-- ── 8.6 完全性ルール台帳の seed(初期 21 ルール) ───────────────────────
--   predicate_key は既定で rule_code と同一(エンジンが rule_code で dispatch する)。
--   stage は「その状態遷移/処理の開始時に BLOCKER 化する」条件。空=常時判定。
INSERT INTO data_quality_rules (rule_code, entity_type, stage, severity, predicate_key, remediation_type, title, description) VALUES
  ('WORK-ID-001',    'work',                  NULL,               'BLOCKER', 'WORK-ID-001',    'edit_work',            'タイトル・種別・有効状態がある',                 '全作品。基本情報が揃っているか。'),
  ('WORK-FAM-001',   'work',                  NULL,               'WARNING', 'WORK-FAM-001',   'work_family',          '作品群またはシリーズ名がある',                   'シリーズ作品。作品群/シリーズに属するか。'),
  ('WORK-REL-001',   'work',                  NULL,               'ERROR',   'WORK-REL-001',   'set_parent_work',      '主たる派生元と関係種別がある',                   '派生作品。parent_work_id と derivation_type。'),
  ('WORK-REL-002',   'work_relation',         NULL,               'BLOCKER', 'WORK-REL-002',   'fix_relation',         '循環参照・自己参照がない',                       '作品関係の健全性。'),
  ('WORK-REL-003',   'work_relation',         NULL,               'BLOCKER', 'WORK-REL-003',   'data_maintenance',     '参照先が削除済み・孤児でない',                   '作品関係の参照先健全性。'),
  ('MAT-ID-001',     'material',              NULL,               'ERROR',   'MAT-ID-001',     'edit_material',        '名称・種別・コア/サブ区分がある',               '全マテリアル。基本属性。'),
  ('MAT-RGT-001',    'material',              'usage_start',      'BLOCKER', 'MAT-RGT-001',    'register_rights_source','主要な権利根源が1件以上ある',                   '外部権利マテリアル。利用開始時に必須。'),
  ('MAT-RGT-002',    'material',              NULL,               'ERROR',   'MAT-RGT-002',    'select_vendor',        '権利者取引先または権利者名称がある',             '外部権利マテリアル。'),
  ('MAT-RGT-003',    'material_rights_source',NULL,               'ERROR',   'MAT-RGT-003',    'organize_primary',     '同一期間・用途に主要権利根源が複数ない',         '主要権利根源の一意性。'),
  ('MAT-DOC-001',    'material',              NULL,               'ERROR',   'MAT-DOC-001',    'create_condition',     '利用根拠となる契約・条件・証憑がある',           '外部権利マテリアル。'),
  ('MAT-FEE-001',    'material',              'statement_issue',  'BLOCKER', 'MAT-FEE-001',    'set_fee_subject',      '利用料名目を解決できる',                         '継続払い対象。計算書発行時に必須。'),
  ('MAT-FEE-002',    'condition',             'statement_issue',  'BLOCKER', 'MAT-FEE-002',    'repair_statement',     'fee_subject_snapshot が保存されている',          '計算書発行済み条件。'),
  ('WORK-MAT-001',   'work',                  NULL,               'ERROR',   'WORK-MAT-001',   'add_material',         '1件以上の使用マテリアルが登録されている',       '制作・公開作品。'),
  ('WORK-MAT-002',   'work',                  'production_start', 'BLOCKER', 'WORK-MAT-002',   'select_license_in',    '利用マテリアルごとに支払条件が結線されている',   '外部権利利用作品。制作・利用開始時に必須。'),
  ('WORK-MAT-003',   'material',              NULL,               'ERROR',   'WORK-MAT-003',   'create_po',            '発注書または権利取得根拠がある',                 '発注・委託マテリアル。'),
  ('COND-ROUTE-001', 'condition',             'downstream_start', 'BLOCKER', 'COND-ROUTE-001', 'condition_form',       'direction/transaction_kind/payment_scheme/settlement_trigger が整合', '全条件。後続処理開始時に必須。'),
  ('COND-RGT-001',   'condition',             'usage_start',      'BLOCKER', 'COND-RGT-001',   'select_rights_source', 'material_id と material_rights_source_id がある',  'マテリアル条件。利用開始時に必須。'),
  ('COND-FIN-001',   'condition',             'calc_start',       'BLOCKER', 'COND-FIN-001',   'complete_condition',   '料率・計算基礎・通貨がある',                     'royalty-bearing 条件。計算開始時に必須。'),
  ('COND-SCOPE-001', 'condition',             NULL,               'ERROR',   'COND-SCOPE-001', 'complete_contract',    '必要な類型で地域・言語・期間の値がある',         '許諾条件。'),
  ('WORK-OUT-001',   'work',                  'billing_start',    'BLOCKER', 'WORK-OUT-001',   'create_sublicense',    '相手方・対象製品/作品・受取条件がある',         'ライセンスアウト等。請求開始時に必須。'),
  ('WORK-EVD-001',   'entity_source',         'verify',           'BLOCKER', 'WORK-EVD-001',   'add_evidence',         '元文書または登録理由・確認者・確認日がある',     '独立入力。検証済み化時に必須。')
ON CONFLICT (rule_code) DO UPDATE SET
  entity_type      = EXCLUDED.entity_type,
  stage            = EXCLUDED.stage,
  severity         = EXCLUDED.severity,
  predicate_key    = EXCLUDED.predicate_key,
  remediation_type = EXCLUDED.remediation_type,
  title            = EXCLUDED.title,
  description      = EXCLUDED.description,
  updated_at       = now();

-- ── ロールバック(必要時) ─────────────────────────────────────────────
--   DROP TABLE IF EXISTS data_quality_issues, entity_completeness_summary,
--     data_quality_rules, entity_sources CASCADE;
--   (新規テーブルのみで既存スキーマへ非破壊。engine/API 未接続の段階なら安全に戻せる。)
