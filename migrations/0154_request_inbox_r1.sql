-- 0154_request_inbox_r1.sql
-- v3 依頼受付箱 R1（取得の土台）。設計: docs/design/v3-backlog-request-scheme.md §9 / §12 R1
--   ① request_types     … 依頼種別マスタ（推定・次アクション・自動生成文書の既定値）
--   ② backlog_pull_runs … Backlog を読みに行った記録（定期/手動/Webhook合図/全件照合）
--   ③ legal_requests    … 依頼原票＋受付状態の列を追加（Backlog スナップショット・案件・種別 等）
--   ④ request_events    … 依頼の履歴（取得差分・受付操作・通知）
--   ⑤ staff.backlog_user_id / documents.request_id
--   ⑥ 既存行のバックフィル（request_no 採番・種別・案件・重複・希望納期）
--   ⑦ 移行期の同期トリガ（新規行の request_no 採番・種別、matter_issues → matter_id）
--
-- R1 の方針（現行フローを変えない）:
--   - inbox_state の既定値は 'accepted'。R1 期間中に現行パイプライン（Slack/webhook/quick-create 等）
--     が作る行は従来どおり自動処理済みとして扱う。受付箱への登録（'new'）は R2 で intakeRequest が明示的に行う。
--   - backlog_issue_key の NOT NULL は維持（手動登録の NULL 許容は R2）。
--   - 0103 の Matter 自動作成トリガは R2 で停止する。ここでは触らない。
-- additive・冪等。ロールバック: 末尾のコメント参照。

-- ───────────────────────────────────────────────────────────────────────────
-- ① 依頼種別マスタ
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_types (
  code                      VARCHAR(40) PRIMARY KEY,
  label                     TEXT NOT NULL,
  phase                     VARCHAR(20) NOT NULL
                            CHECK (phase IN ('contracting','settlement','advisory','admin')),
  backlog_issue_type_name   TEXT NOT NULL,
  legacy_backlog_type_names TEXT[] NOT NULL DEFAULT '{}',
  default_task_title        TEXT,
  default_task_stage        VARCHAR(30),
  default_template_type     TEXT,          -- 受付後に自動生成する文書（NULL = 生成しない）
  sort_order                INT NOT NULL DEFAULT 0,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO request_types
  (code, label, phase, backlog_issue_type_name, legacy_backlog_type_names, default_task_title, default_task_stage, default_template_type, sort_order)
VALUES
  ('nda',             'NDA',                  'contracting', '契約審査',     ARRAY['NDA'],                                   'NDA を作成',                 'drafting',    'nda',                      10),
  ('outsourcing',     '業務委託基本契約',     'contracting', '契約審査',     ARRAY['業務委託基本契約'],                      '業務委託基本契約を作成',     'drafting',    'service_master',           20),
  ('license_master',  'ライセンス基本契約',   'contracting', '契約審査',     ARRAY['ライセンス契約','海外IP契約（基本契約）','海外IP契約（変更合意）'], 'ライセンス基本契約を作成', 'drafting', 'license_master', 30),
  ('lic_individual',  '個別利用許諾条件',     'contracting', '契約審査',     ARRAY['個別利用許諾条件'],                      '個別利用許諾条件書を作成',   'drafting',    'individual_license_terms', 40),
  ('pub_master',      '出版基本契約',         'contracting', '契約審査',     ARRAY[]::TEXT[],                                '出版基本契約を作成',         'drafting',    NULL,                       50),
  ('pub_terms',       '出版利用許諾条件書',   'contracting', '契約審査',     ARRAY[]::TEXT[],                                '出版利用許諾条件書を作成',   'drafting',    'pub_license_terms',        60),
  ('pub_additional',  '追加利用許諾条件書',   'contracting', '契約審査',     ARRAY[]::TEXT[],                                '追加利用許諾条件書を作成',   'drafting',    'pub_additional_terms',     70),
  ('sales_master',    '売買契約',             'contracting', '契約審査',     ARRAY['売買契約（当社買手）','売買契約（当社売手・標準）','売買契約（当社売手・保証金掛け売り）'], '売買契約を作成', 'drafting', NULL, 80),
  ('purchase_order',  '発注書',               'contracting', '契約審査',     ARRAY['発注書','企画発注書','出版発注書'],      '発注書を作成',               'drafting',    'purchase_order',           90),
  ('contract_review', '契約審査（他社書式）', 'contracting', '契約審査',     ARRAY['契約審査'],                              '相手方書式をレビュー',       'drafting',    NULL,                      100),
  ('delivery_inspec', '納品・検収',           'settlement',  '納品・検収',   ARRAY['納品リクエスト','製造案件','納品・検収'], '検収書を作成',              'inspection',  'inspection_certificate',  110),
  ('license_calc',    '利用許諾料計算',       'settlement',  '利用許諾計算', ARRAY['売上報告案件','利用許諾計算'],           '計算書を作成',               'inspection',  'royalty_statement',       120),
  ('legal_consult',   '法務相談',             'advisory',    '法務相談',     ARRAY['法務相談'],                              '回答する',                   'drafting',    NULL,                      130),
  ('admin_procedure', '事務手続',             'admin',       '事務手続',     ARRAY['事務手続'],                              '手続する',                   'drafting',    NULL,                      140),
  ('deadline_change', '納期変更依頼',         'admin',       '事務手続',     ARRAY['納期変更依頼'],                          '明細の納期を変更する',       'performance', NULL,                      150)
ON CONFLICT (code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- ② 取得ログ
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backlog_pull_runs (
  id             BIGSERIAL PRIMARY KEY,
  trigger        VARCHAR(20) NOT NULL
                 CHECK (trigger IN ('scheduled','manual','webhook','full_reconcile')),
  updated_since  TIMESTAMPTZ,                 -- この時刻以降に更新された課題を対象にした（NULL = 全件）
  watermark      TIMESTAMPTZ,                 -- この回で見た課題の最大 updated（成功時のみ次回の起点）
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  fetched_count  INT NOT NULL DEFAULT 0,      -- Backlog から受け取った課題数
  matched_count  INT NOT NULL DEFAULT 0,      -- legal_requests と突き合わせできた数
  updated_count  INT NOT NULL DEFAULT 0,      -- スナップショットが変わった数
  created_count  INT NOT NULL DEFAULT 0,      -- 受付箱に新しく入れた数（R1 は常に 0。R2 から）
  unmatched_count INT NOT NULL DEFAULT 0,     -- Backlog にあって LB に無い課題の数
  detail         JSONB,                       -- { unmatched: [...], missing_in_backlog: [...], pages: n }
  error          TEXT,
  started_by     VARCHAR(120)
);
CREATE INDEX IF NOT EXISTS idx_backlog_pull_runs_started ON backlog_pull_runs(started_at DESC);
-- 同時実行は 1 本まで（未終了の行は最大 1 行）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_backlog_pull_running ON backlog_pull_runs ((1)) WHERE finished_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- ③ legal_requests 拡張
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE legal_requests
  ADD COLUMN IF NOT EXISTS request_no              VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_channel          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS backlog_issue_id        BIGINT,
  ADD COLUMN IF NOT EXISTS backlog_issue_type_name TEXT,
  ADD COLUMN IF NOT EXISTS backlog_status_name     TEXT,
  ADD COLUMN IF NOT EXISTS backlog_created_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backlog_updated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backlog_snapshot        JSONB,
  ADD COLUMN IF NOT EXISTS backlog_last_comment_id BIGINT,
  ADD COLUMN IF NOT EXISTS last_pulled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_form             JSONB,
  ADD COLUMN IF NOT EXISTS has_unseen_update       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inbox_state             VARCHAR(20) NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS inbox_reason            TEXT,
  ADD COLUMN IF NOT EXISTS hold_until              DATE,
  ADD COLUMN IF NOT EXISTS request_type            VARCHAR(40),
  ADD COLUMN IF NOT EXISTS request_type_guess      VARCHAR(40),
  ADD COLUMN IF NOT EXISTS vendor_id               INTEGER,
  ADD COLUMN IF NOT EXISTS requester_staff_id      INTEGER,
  ADD COLUMN IF NOT EXISTS assignee_staff_id       INTEGER,
  ADD COLUMN IF NOT EXISTS department              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS due_date                DATE,
  ADD COLUMN IF NOT EXISTS matter_id               INTEGER,
  ADD COLUMN IF NOT EXISTS matter_candidates       JSONB,
  ADD COLUMN IF NOT EXISTS duplicate_of_request_id INTEGER,
  ADD COLUMN IF NOT EXISTS handled_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handled_by              VARCHAR(120),
  ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_inbox_state_chk') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_inbox_state_chk
      CHECK (inbox_state IN ('new','on_hold','accepted','duplicate','dismissed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_request_no_key') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_request_no_key UNIQUE (request_no);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_backlog_issue_id_key') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_backlog_issue_id_key UNIQUE (backlog_issue_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_request_type_fkey') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_request_type_fkey
      FOREIGN KEY (request_type) REFERENCES request_types(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_vendor_id_fkey') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_requester_staff_id_fkey') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_requester_staff_id_fkey
      FOREIGN KEY (requester_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_assignee_staff_id_fkey') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_assignee_staff_id_fkey
      FOREIGN KEY (assignee_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_matter_id_fkey') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_matter_id_fkey
      FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_requests_duplicate_of_fkey') THEN
    ALTER TABLE legal_requests ADD CONSTRAINT legal_requests_duplicate_of_fkey
      FOREIGN KEY (duplicate_of_request_id) REFERENCES legal_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lr_inbox ON legal_requests(inbox_state, backlog_created_at)
  WHERE inbox_state IN ('new','on_hold') OR has_unseen_update;
CREATE INDEX IF NOT EXISTS idx_lr_matter ON legal_requests(matter_id) WHERE matter_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- ④ 依頼の履歴
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_events (
  id          BIGSERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
  kind        VARCHAR(30) NOT NULL,   -- pulled / backlog_changed / comment_added / accepted / linked / held / dismissed / duplicate / reopened / document_generated / document_failed / notified
  origin      VARCHAR(20) NOT NULL,   -- backlog / lb / system
  detail      JSONB,
  actor       VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_id, created_at);

-- ───────────────────────────────────────────────────────────────────────────
-- ⑤ staff / documents
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS backlog_user_id BIGINT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS request_id INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_request_id_fkey') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_request_id_fkey
      FOREIGN KEY (request_id) REFERENCES legal_requests(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_documents_request ON documents(request_id) WHERE request_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- ⑥ バックフィル（既存行 = 現行運用で処理済み）
-- ───────────────────────────────────────────────────────────────────────────

-- request_no: 作成年ごとに作成順で REQ-YYYY-NNNNN を採番。
WITH numbered AS (
  SELECT id,
         EXTRACT(YEAR FROM COALESCE(created_at, now()) AT TIME ZONE 'Asia/Tokyo')::int AS y,
         ROW_NUMBER() OVER (
           PARTITION BY EXTRACT(YEAR FROM COALESCE(created_at, now()) AT TIME ZONE 'Asia/Tokyo')
           ORDER BY created_at NULLS FIRST, id
         ) AS n
    FROM legal_requests
   WHERE request_no IS NULL
)
UPDATE legal_requests lr
   SET request_no = 'REQ-' || nb.y || '-' || lpad(nb.n::text, 5, '0')
  FROM numbered nb
 WHERE lr.id = nb.id
   -- 再実行時（一部だけ NULL）に既存番号と衝突しないよう、採番済みの年は対象外。
   AND NOT EXISTS (
     SELECT 1 FROM legal_requests x
      WHERE x.request_no LIKE 'REQ-' || nb.y || '-%'
   );

-- 採番カウンタを既存最大値に合わせる（document_sequences kind='request'）。
INSERT INTO document_sequences (kind, year, current_value)
SELECT 'request', substring(request_no from 5 for 4)::int, MAX(substring(request_no from 10)::int)
  FROM legal_requests
 WHERE request_no ~ '^REQ-\d{4}-\d{5}$'
 GROUP BY substring(request_no from 5 for 4)::int
ON CONFLICT (kind, year) DO UPDATE
  SET current_value = GREATEST(document_sequences.current_value, EXCLUDED.current_value);

-- 種別: contract_type（実態は request_type）を推定値に、マスタにある値は確定値に。
UPDATE legal_requests
   SET request_type_guess = NULLIF(btrim(contract_type), '')
 WHERE request_type_guess IS NULL AND NULLIF(btrim(contract_type), '') IS NOT NULL;
UPDATE legal_requests lr
   SET request_type = rt.code
  FROM request_types rt
 WHERE lr.request_type IS NULL AND rt.code = btrim(lr.contract_type);

-- 案件: matter_issues（primary 優先、次いで最古）。
UPDATE legal_requests lr
   SET matter_id = sub.matter_id
  FROM (
    SELECT DISTINCT ON (backlog_issue_key) backlog_issue_key, matter_id
      FROM matter_issues
     ORDER BY backlog_issue_key, (relation = 'primary') DESC, id
  ) sub
 WHERE lr.matter_id IS NULL AND sub.backlog_issue_key = lr.backlog_issue_key;

-- 重複: merged_into_issue_key を持つ行。
UPDATE legal_requests lr
   SET inbox_state = 'duplicate',
       duplicate_of_request_id = tgt.id
  FROM legal_requests tgt
 WHERE NULLIF(btrim(lr.merged_into_issue_key), '') IS NOT NULL
   AND tgt.backlog_issue_key = btrim(lr.merged_into_issue_key)
   AND lr.duplicate_of_request_id IS NULL;
UPDATE legal_requests
   SET inbox_state = 'duplicate'
 WHERE NULLIF(btrim(merged_into_issue_key), '') IS NOT NULL AND inbox_state = 'accepted';

-- 経路・希望納期・処理日時・依頼者。
UPDATE legal_requests
   SET source_channel = 'legacy'
 WHERE source_channel IS NULL;
UPDATE legal_requests
   SET due_date = (deadline AT TIME ZONE 'Asia/Tokyo')::date
 WHERE due_date IS NULL AND deadline IS NOT NULL;
UPDATE legal_requests
   SET handled_at = created_at
 WHERE handled_at IS NULL AND inbox_state IN ('accepted','duplicate');
UPDATE legal_requests lr
   SET requester_staff_id = s.id
  FROM staff s
 WHERE lr.requester_staff_id IS NULL
   AND NULLIF(btrim(lr.slack_user_id), '') IS NOT NULL
   AND s.slack_user_id = lr.slack_user_id;

-- ───────────────────────────────────────────────────────────────────────────
-- ⑦ 移行期の同期トリガ
-- ───────────────────────────────────────────────────────────────────────────

-- 依頼番号の採番（アプリ側・DB 側で共用できるよう関数化）。
CREATE OR REPLACE FUNCTION next_request_no() RETURNS text LANGUAGE plpgsql AS $$
DECLARE y int := EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Tokyo')::int; v int;
BEGIN
  INSERT INTO document_sequences (kind, year, current_value) VALUES ('request', y, 1)
    ON CONFLICT (kind, year) DO UPDATE SET current_value = document_sequences.current_value + 1
  RETURNING current_value INTO v;
  RETURN 'REQ-' || y || '-' || lpad(v::text, 5, '0');
END $$;

-- 新規行: request_no 採番・種別の反映・依頼者解決・経路（未指定は legacy）。
--   R1 期間中は現行パイプラインが contract_type だけを書くため、ここで新列を埋める。
CREATE OR REPLACE FUNCTION lr_fill_v3_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.request_no IS NULL THEN
      NEW.request_no := next_request_no();
    END IF;
    IF NEW.source_channel IS NULL THEN
      NEW.source_channel := 'legacy';
    END IF;
    IF NEW.requester_staff_id IS NULL AND NULLIF(btrim(NEW.slack_user_id), '') IS NOT NULL THEN
      SELECT s.id INTO NEW.requester_staff_id FROM staff s WHERE s.slack_user_id = NEW.slack_user_id;
    END IF;
    IF NEW.due_date IS NULL AND NEW.deadline IS NOT NULL THEN
      NEW.due_date := (NEW.deadline AT TIME ZONE 'Asia/Tokyo')::date;
    END IF;
    IF NEW.handled_at IS NULL AND NEW.inbox_state IN ('accepted','duplicate') THEN
      NEW.handled_at := now();
    END IF;
  END IF;
  IF NULLIF(btrim(NEW.contract_type), '') IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.contract_type IS DISTINCT FROM OLD.contract_type) THEN
    NEW.request_type_guess := btrim(NEW.contract_type);
    IF NEW.request_type IS NULL OR TG_OP = 'UPDATE' THEN
      NEW.request_type := (SELECT code FROM request_types WHERE code = btrim(NEW.contract_type));
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_lr_fill_v3_columns ON legal_requests;
CREATE TRIGGER tg_lr_fill_v3_columns
  BEFORE INSERT OR UPDATE ON legal_requests
  FOR EACH ROW EXECUTE FUNCTION lr_fill_v3_columns();

-- matter_issues の変化を legal_requests.matter_id に反映（0103 の自動作成・案件統合・束ね解除に追従）。
CREATE OR REPLACE FUNCTION lr_sync_matter_id(p_key text) RETURNS void LANGUAGE sql AS $$
  UPDATE legal_requests lr
     SET matter_id = (
       SELECT mi.matter_id FROM matter_issues mi
        WHERE mi.backlog_issue_key = p_key
        ORDER BY (mi.relation = 'primary') DESC, mi.id
        LIMIT 1)
   WHERE lr.backlog_issue_key = p_key
     AND lr.matter_id IS DISTINCT FROM (
       SELECT mi.matter_id FROM matter_issues mi
        WHERE mi.backlog_issue_key = p_key
        ORDER BY (mi.relation = 'primary') DESC, mi.id
        LIMIT 1);
$$;

CREATE OR REPLACE FUNCTION mi_sync_legal_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM lr_sync_matter_id(NEW.backlog_issue_key);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND (TG_OP = 'DELETE' OR OLD.backlog_issue_key IS DISTINCT FROM NEW.backlog_issue_key) THEN
    PERFORM lr_sync_matter_id(OLD.backlog_issue_key);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_mi_sync_legal_request ON matter_issues;
CREATE TRIGGER tg_mi_sync_legal_request
  AFTER INSERT OR UPDATE OR DELETE ON matter_issues
  FOR EACH ROW EXECUTE FUNCTION mi_sync_legal_request();

-- 再実行などで採番漏れがあれば埋める（通常は 0 行）。
UPDATE legal_requests SET request_no = next_request_no() WHERE request_no IS NULL;

-- ロールバック（手動）:
--   DROP TRIGGER IF EXISTS tg_mi_sync_legal_request ON matter_issues;
--   DROP TRIGGER IF EXISTS tg_lr_fill_v3_columns ON legal_requests;
--   DROP FUNCTION IF EXISTS mi_sync_legal_request(), lr_sync_matter_id(text), lr_fill_v3_columns(), next_request_no();
--   DROP TABLE IF EXISTS request_events, backlog_pull_runs;
--   ALTER TABLE documents DROP COLUMN IF EXISTS request_id;
--   ALTER TABLE staff DROP COLUMN IF EXISTS backlog_user_id;
--   ALTER TABLE legal_requests DROP COLUMN ...（③ の列）;  DROP TABLE IF EXISTS request_types;
--   DELETE FROM document_sequences WHERE kind = 'request';
