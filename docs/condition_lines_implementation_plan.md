# データ構造刷新 実装設計書（実行可能版）

作成日: 2026-06-11
ステータス: 実装着手可
概念設計: `docs/condition_lines_unification_design.md`（本書の上位文書。設計判断の理由・決定事項ログはそちらを参照）

---

## 0. この文書の使い方（Claude Code への指示）

- 本書は Phase A〜G に分割されている。各 Phase は独立してリリース可能で、原則 A → G の順に実施する。
  ただし Phase A は他と完全に独立しており、いつでも実施できる。
- 各タスクには ID（A-1, B-2 など）が付いている。改修を依頼されたら、該当 Phase のタスクを上から順に実施し、
  完了したら本書のチェックボックスを更新してコミットすること。
- 「⚠ 要確認」が付いた項目は実装前にユーザーに確認する。仮決め案が併記されている場合、
  ユーザーが即答できなければ仮決め案で実装してよい（後から変更可能な設計にしておくこと）。
- 既存機能を壊さないことが最優先。Phase B〜E は「追加 → 二重書き込み → 読み取り切替 → 旧経路廃止」の
  expand/contract パターンで進める。Phase G（破壊的削除）は全 Phase 完了後にのみ実施。
- DDL はすべて既存の initDb() 方式（冪等な CREATE TABLE IF NOT EXISTS / ALTER TABLE ... ADD COLUMN IF NOT EXISTS）に従う。
- 行番号の参照は 2026-06-11 時点のもの。ズレている場合は関数名・テーブル名で検索して特定すること。

### 0.1 主要ファイルマップ

| 役割 | パス |
|---|---|
| worker スキーマ定義（業務テーブルの主たる initDb） | `services/worker/src/lib/db.ts` |
| api スキーマ定義（documents ほか） | `services/api/src/lib/db.ts` |
| worker サーバ（文書生成・検収・ロイヤリティ・アラート cron） | `services/worker/server.ts` |
| api サーバ | `services/api/server.ts` |
| 検収 overflow 計算 | `services/api/src/lib/calc.ts`（getInspectionAvailability: L179 付近） |
| ロイヤリティ計算（MG/AG 消化） | `services/worker/src/lib/calc_license.ts` |
| 課題一覧 UI | `src/pages/RequestsPage.tsx`（open(): L63 付近） |
| 文書作成 UI | `src/pages/DocumentEditorPage.tsx` |
| 取引先詳細 UI（流用パターン） | `src/pages/master/VendorsPanel.tsx`（Field / SectionHead: L831 以降） |
| ワークフロー UI | `src/components/workflow/WorkflowPanel.tsx`（compact モード: L302 付近） |
| フロント共有状態 | `src/context/AppDataContext.tsx` |
| 過去のバックフィル前例 | `scripts/phase23_migrate_to_capabilities.ts`, `scripts/phase23_restore_lines_from_form_data.sql` |

### 0.2 スキーマ定義の二重管理について（重要）

initDb は worker と api の両方に存在し、同一 DB に対して冪等実行される。
新規テーブル・列は次のルールで追加する:

- 業務テーブル（condition_lines / condition_events / works 等）→ `services/worker/src/lib/db.ts` に正とする定義を追加
- api 側がそのテーブルを読み書きする場合 → `services/api/src/lib/db.ts` にも同一 DDL をミラー追加
  （既存の capability_* と同じ扱い。差分が出ないよう DDL 文字列はコピーで一致させる）

---

## 1. ゴール（何が変わるか）

1. 条件明細（condition_lines）が状態を持つ唯一の中心になる。状態・残高・MG/AG はテーブル列ではなく
   実績（condition_events）からの導出ビューで提供する。
2. 文書と実績が FK で対になる（検収・計算の有効実績1件 = final 文書1件）。form_data JSONB 頼みの関連を廃止。
3. 契約ヘッダは structural_role（master/terms）× contract_scopes（service/license_use）×
   template_family に直交分解。個別→基本の親子は parent_capability_id FK。
4. 作品（works）を新設し、構成要素経由でイン側条件明細と接続。アウト側（再許諾）は
   direction='receivable' の条件明細として対称管理。sublicensees は vendors に統合。
5. UI: 課題詳細ページ（文書一覧のみ）と、条件明細管理 UI（line_code 単位）を新設。

---

## 2. Phase A: 課題詳細ページ（現行スキーマ・即効）

依存: なし。今すぐ実施可。

### A-1. API: 課題の文書一覧取得
- [x] `services/api/server.ts` に `GET /api/issues/:issueKey/documents` を追加。
  - クエリ: `SELECT id, document_number, template_type, created_at, created_by, drive_link, lifecycle_status, is_primary, base_document_number, revision FROM documents WHERE issue_key = $1 ORDER BY created_at DESC`
  - 既存の認可ミドルウェア（他の /api/* と同じもの）を必ず通すこと。
  - レスポンスはオブジェクト配列。`form_data` は返さない（重い・不要）。
- 受け入れ基準: 既存課題キーで文書配列が返る。文書ゼロ件で空配列。認証なしで 401。

### A-2. ルートとページ骨格
- [x] `src/App.tsx`（ルート定義箇所）に `/issues/:issueKey` を追加。
- [x] `src/pages/IssueDetailPage.tsx` を新規作成。構成:
  - ヘッダ行: 課題キー（Badge, mono）/ 件名 / Backlog ステータスバッジ / 担当者・期日
    - 課題情報は `AppDataContext` の `issues` から `issueKey` で引く。無ければ単体 fetch にフォールバック
      （既存の issue 取得 API を確認して使う。なければ issues 一覧から検索のみで可）。
  - ステータス操作: 既存 `WorkflowPanel` の compact モードをそのまま埋め込む。
  - 文書一覧セクション: A-1 の API を fetch して行リスト表示。
    各行 = 種別ラベル（template_type の日本語名は templates_config.json / templateMetadata から解決）+
    document_number（mono）+ 日付 + lifecycle バッジ（final=緑 / reissued=グレー / archived_draft=グレー打ち消し）+
    Drive リンク（外部リンクアイコン）+「再編集」ボタン。
  - 「文書を作成」ボタン: DocumentSession に selectedIssue をセットして `/documents/new` へ navigate
    （現在 RequestsPage の open() がやっている処理と同じ）。
  - レイアウトは `VendorsPanel.tsx` の SectionHead / 2 列グリッドのスタイルを踏襲（Dialog ではなくページ）。
- [x] `src/pages/RequestsPage.tsx` の `open()`（L63 付近）を変更: `/documents/new` 直行をやめ、
  `/issues/${key}` へ navigate する。
- [x] `src/pages/DashboardPage.tsx` の課題行クリックも同様に `/issues/:key` へ。
- 受け入れ基準:
  - 課題カードクリック → 詳細ページが開き、文書一覧・ステータスが見える。
  - 「文書を作成」「再編集」から従来の作成フローに到達できる（既存フロー無破壊）。
  - URL 直叩きで開ける（Backlog コメントに貼る運用のため）。

### A-3. （任意）文書件数バッジ
- [x] RequestsPage のカードに `issue.documentCount` を表示（Dashboard と同じデータ源）。

---

## 3. Phase B: 新スキーマ DDL（追加のみ・既存無影響）

依存: なし（Phase A と並行可）。すべて `services/worker/src/lib/db.ts` の initDb に追加し、
api 側で読み書きするテーブルは `services/api/src/lib/db.ts` にもミラーする。

### B-1. 契約ヘッダの直交分解列
- [x] contract_capabilities に追加:
```sql
ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS structural_role VARCHAR(10);
  -- 'master' | 'terms'。CHECK は バックフィル(C-1)完了後に付与（既存行 NULL のため）
ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS parent_capability_id INTEGER
  REFERENCES contract_capabilities(id);
ALTER TABLE contract_capabilities ADD COLUMN IF NOT EXISTS template_family VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_cc_parent ON contract_capabilities(parent_capability_id);
```
- [x] contract_scopes 新設:
```sql
CREATE TABLE IF NOT EXISTS contract_scopes (
  id SERIAL PRIMARY KEY,
  capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('service','license_use')),
  UNIQUE (capability_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_cs_capability ON contract_scopes(capability_id);
```

### B-2. 統一条件明細
```sql
CREATE TABLE IF NOT EXISTS condition_lines (
  id SERIAL PRIMARY KEY,
  capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  line_code VARCHAR(60) UNIQUE,
  subject TEXT,
  ledger_code VARCHAR(40),
  material_id INTEGER REFERENCES materials(id),
  work_id INTEGER REFERENCES works(id),
  direction VARCHAR(10) NOT NULL DEFAULT 'payable'
    CHECK (direction IN ('payable','receivable')),
  payment_scheme VARCHAR(20) NOT NULL
    CHECK (payment_scheme IN ('lump_sum','per_unit','installment','subscription','royalty')),
  rights_attribution VARCHAR(20)
    CHECK (rights_attribution IN ('transfer','retained_license','license_only','joint')),
  currency VARCHAR(10) DEFAULT 'JPY',
  notes TEXT,
  quantity DECIMAL(15,4),
  unit_price DECIMAL(15,2),
  amount_ex_tax DECIMAL(15,2),
  delivery_date DATE,
  term_start DATE,
  term_end DATE,
  cycle VARCHAR(50),
  billing_day INTEGER,
  calc_period_kind VARCHAR(20),
  calc_period_close_month SMALLINT,
  rate_pct DECIMAL(7,4),
  base_price_label TEXT,
  mg_amount DECIMAL(15,2),
  ag_amount DECIMAL(15,2),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_reason TEXT,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  source_line_item_id INTEGER,      -- 移行元 capability_line_items.id（バックフィル追跡用）
  source_condition_id INTEGER,      -- 移行元 capability_financial_conditions.id（同上）
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (capability_id, line_no),
  CONSTRAINT cl_scheme_royalty_cols CHECK (
    payment_scheme = 'royalty'
    OR (rate_pct IS NULL AND mg_amount IS NULL AND ag_amount IS NULL)),
  CONSTRAINT cl_scheme_depletable_target CHECK (
    payment_scheme IN ('subscription','royalty') OR amount_ex_tax IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_cl_capability ON condition_lines(capability_id);
CREATE INDEX IF NOT EXISTS idx_cl_work ON condition_lines(work_id);
```
注意: `cl_scheme_recurring_term`（subscription/royalty に term_start 必須）は概念設計にあるが、
移行データに term_start 欠損があり得るため、C-2 完了・データ補正後に付与する（G-1 参照）。

### B-3. 分割予定
```sql
CREATE TABLE IF NOT EXISTS condition_line_installments (
  id SERIAL PRIMARY KEY,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL,
  trigger_kind VARCHAR(20) NOT NULL
    CHECK (trigger_kind IN ('on_signing','on_delivery','on_inspection','fixed_date')),
  planned_amount_ex_tax DECIMAL(15,2) NOT NULL,
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (condition_line_id, installment_no)
);
```

### B-4. 統一実績台帳
```sql
CREATE TABLE IF NOT EXISTS condition_events (
  id SERIAL PRIMARY KEY,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
  event_no INTEGER NOT NULL,
  event_type VARCHAR(20) NOT NULL
    CHECK (event_type IN ('inspection','royalty_calc','payment')),
  installment_id INTEGER REFERENCES condition_line_installments(id),
  document_id INTEGER REFERENCES documents(id),
  backlog_issue_key VARCHAR(50),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  period VARCHAR(7),
  amount_ex_tax DECIMAL(15,2) NOT NULL DEFAULT 0,
  voided_at TIMESTAMP WITH TIME ZONE,
  void_reason TEXT,
  source_delivery_line_item_id INTEGER,   -- 移行元（バックフィル追跡用）
  source_royalty_calculation_id INTEGER,  -- 移行元（同上）
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (condition_line_id, event_no),
  CONSTRAINT ce_document_pairing CHECK (
    (event_type IN ('inspection','royalty_calc') AND document_id IS NOT NULL)
    OR (event_type = 'payment' AND document_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_ce_line ON condition_events(condition_line_id);
CREATE INDEX IF NOT EXISTS idx_ce_document ON condition_events(document_id);
CREATE INDEX IF NOT EXISTS idx_ce_line_period ON condition_events(condition_line_id, period);
```
- [x] 既存 detail テーブルに実績 FK を追加（detail は残す）:
```sql
ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS condition_event_id INTEGER
  REFERENCES condition_events(id);
ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS condition_event_id INTEGER
  REFERENCES condition_events(id);
ALTER TABLE royalty_calculations ADD COLUMN IF NOT EXISTS condition_line_id INTEGER
  REFERENCES condition_lines(id);
ALTER TABLE delivery_line_items ADD COLUMN IF NOT EXISTS condition_line_id INTEGER
  REFERENCES condition_lines(id);
```

### B-5. 作品層
```sql
CREATE TABLE IF NOT EXISTS works (
  id SERIAL PRIMARY KEY,
  work_code VARCHAR(40) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  parent_work_id INTEGER REFERENCES works(id),
  ledger_code VARCHAR(40),
  remarks TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS work_components (
  id SERIAL PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  component_no INTEGER NOT NULL,
  component_kind VARCHAR(50),
  material_id INTEGER REFERENCES materials(id),
  notes TEXT,
  UNIQUE (work_id, component_no)
);
CREATE TABLE IF NOT EXISTS work_component_lines (
  component_id INTEGER NOT NULL REFERENCES work_components(id) ON DELETE CASCADE,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
  PRIMARY KEY (component_id, condition_line_id)
);
```
注意: works は condition_lines より先に CREATE すること（condition_lines.work_id が参照するため、
initDb 内の記述順は works → condition_lines → 以降）。

### B-6. 採番（⚠ 要確認 / 仮決め案あり）
- line_code: 仮決め案 = 独立採番 `CL-{YYYY}-{NNNNN}`（契約再発行で番号が変わらないことが要件のため、
  契約番号従属ではなく独立採番を推奨）。document_sequences と同じ仕組みで
  `(kind='condition_line', year)` の連番を払い出す関数を db.ts に追加。
- work_code: 仮決め案 = `WK-{YYYY}-{NNNN}`。同上。
- [x] 採番関数 `issueConditionLineCode()` / `issueWorkCode()` を実装（document_sequences 流用）。

### B-7. Phase B 受け入れ基準
- [x] worker / api 両サービスが起動し、initDb がエラーなく完走する（新規 DB・既存 DB の両方）。
- [x] 既存の全機能（文書生成・検収・ロイヤリティ計算・アラート）が無変化で動く。

---

## 4. Phase C: バックフィル（scripts/ 配下・dry-run 必須）

依存: Phase B。全スクリプトは `scripts/phase23_migrate_to_capabilities.ts` の流儀に従う:
`--dry-run`（デフォルト）と `--apply` の2モード、実行前後の件数突合ログ、冪等（再実行安全）。

### C-1. 契約ヘッダ分解バックフィル `scripts/restructure_c1_contract_roles.ts`
- [ ] structural_role:
  - record_type='master_contract' → 'master'
  - record_type IN ('individual_contract','standalone_contract') → 'terms'
  - record_type IN ('purchase_order','delivery_record','license_condition','publication_condition') →
    'terms'（これらは将来 condition_lines/documents に吸収されるが、当面 terms 扱いで保全）
- [ ] contract_scopes:
  - contract_category='service' → ('service')
  - contract_category IN ('license','publication') → ('license_use')
  - contract_category='mixed' → 一覧を CSV 出力して手動確認（件数を実態調査。少数なら個別指定）
  - 旧 *_allowed フラグが TRUE のものは対応 scope を補完
    （purchase_order_allowed → service / license_condition_allowed・publication_condition_allowed → license_use）
- [ ] template_family: contract_category='publication' → 'publication'、'license' → 'license'、
  'service' → 'service'（テンプレ選択ロジックが参照するのは license/publication の別のみ）
- [ ] parent_capability_id: documents.form_data->>'selected_master_contract_id' を全文書から走査し、
  individual_contract に親をバックフィル（参照先不在・複数候補は CSV でレポートし手動解決）。
- 検証: role 別件数 = 旧 record_type 別件数と一致。scope 0 件の契約一覧を出力（手動補完対象）。

### C-2. 条件明細バックフィル `scripts/restructure_c2_condition_lines.ts`
- [ ] capability_line_items → condition_lines:
  - scheme 判定: cycle IS NOT NULL OR billing_day IS NOT NULL → 'subscription'
    / quantity IS NOT NULL AND unit_price IS NOT NULL → 'per_unit' / それ以外 → 'lump_sum'
  - calc_method 列の値があれば優先判定材料にする（SUBSCRIPTION → subscription 等。値の実態を先に
    `SELECT DISTINCT calc_method` で確認しマッピング表をスクリプト冒頭に明記）
  - direction='payable'、source_line_item_id に元 id、列は同名コピー
- [ ] capability_financial_conditions → condition_lines:
  - 原則 scheme='royalty'。calc_method='FIXED' かつ rate_pct IS NULL は 'lump_sum'（一括許諾）
  - mg_amount/ag_amount/rate_pct/calc_period_* をコピー、source_condition_id に元 id
  - term_start/term_end は親 contract_capabilities の effective_date/expiration_date をコピー
- [ ] line_no は契約内で 1 から振り直し（line_items 由来 → financial_conditions 由来の順）。
  line_code は B-6 の採番関数で全行に付与。
- [ ] A案対応: structural_role='master' の契約に condition_lines がぶら下がる場合
  （ライセンス基本契約直付き条件）、暗黙の terms 契約を生成して切り出す:
  - 新規 contract_capabilities 行: structural_role='terms', parent_capability_id=master.id,
    contract_title='（基本契約内条件）'+master.contract_title, 日付・vendor は master からコピー,
    scopes は master と同一
  - condition_lines.capability_id を新 terms 行に付け替え
- 検証: 旧2テーブルの行数合計 = condition_lines の行数。金額合計（amount_ex_tax / mg_amount）が新旧一致。

### C-3. 実績バックフィル `scripts/restructure_c3_condition_events.ts`
- [ ] delivery_line_items → condition_events(event_type='inspection'):
  - condition_line_id = source_line_item_id 経由で解決
  - amount_ex_tax = inspected_amount_ex_tax、occurred_at = 親 delivery_events.delivered_at
    （NULL なら created_at）、backlog_issue_key = 親の値
  - document_id: documents から template_type IN ('inspection_certificate','delivery_inspec') かつ
    form_data->>'delivery_event_id' = 親 delivery_events.id の final 行を解決
    （phase23_restore_lines_from_form_data.sql と同じ手口）。解決不能行は CSV レポート →
    暫定で document_id 必須 CHECK を満たすため、解決不能な inspection 実績は
    event_type='payment' ではなく「document_id 解決保留リスト」に残し、INSERT を保留する
    （⚠ 件数次第でユーザーと相談）
  - delivery_line_items.condition_event_id / condition_line_id に逆 FK を書き戻す
- [ ] royalty_calculations → condition_events(event_type='royalty_calc'):
  - condition_line_id = capability_financial_condition_id → source_condition_id 経由で解決
  - amount_ex_tax = actual_royalty_ex_tax、period・backlog_issue_key コピー、
    occurred_at = created_at
  - document_id: documents の template_type IN ('royalty_statement','利用許諾料計算書') かつ
    issue_key 一致 かつ form_data の capabilityFinancialConditionId / manufacturingEventId 一致で解決
  - royalty_calculations.condition_event_id / condition_line_id に逆 FK を書き戻す
- [ ] event_no は condition_line_id 内で occurred_at 昇順に 1 から採番。
- 検証: イベント数 = 旧実績行数（保留分を除く）。明細ごとの SUM(amount_ex_tax) が
  旧集計（getInspectionAvailability / getMgConsumedToDate 相当 SQL）と一致することを突合表で出力。

### C-4. sublicensees 統合・works 起票 `scripts/restructure_c4_works.ts`
- [ ] sublicensees → vendors: vendor_name 完全一致 + name_kana で名寄せ。
  一致なし → vendors 新規作成（vendor_code は既存採番規則に従う。entity_type は corporate 仮置き）。
  対応表（sublicensee_id → vendor_id）を一時テーブル `_migration_sublicensee_vendor` に保存。
- [ ] work_sublicensees → works + アウト側契約:
  - work_id 文字列（LIC-{ledger}-W-... 形式）ごとに works を 1 件起票（title は対応する個別許諾契約の
    original_work / contract_title から取得、work_code は新採番）
  - 各 work_sublicensees 行 → アウト側 terms 契約（structural_role='terms', scope='license_use',
    vendor_id=対応表で解決）+ condition_lines 1 行（direction='receivable', scheme='royalty',
    rate_label/mg_ag_label/payment_terms_label は notes に退避）+ work_id 参照
- [ ] contract_capabilities.original_work / product_name のユニーク値一覧を CSV 出力し、
  works への名寄せドラフト（完全一致のみ自動、残りは人間が確認する surveyシート）を生成。
  ⚠ 自動確定はしない。確認済み CSV を入力に work_id を書き戻す `--apply-mapping` モードを用意。
- 検証: sublicensees 全行が vendor に対応。work_sublicensees 全行がアウト側明細に対応。

### C-5. 二重書き込みの開始（バックフィル後の新規データ対策）
- [ ] worker の検収明細保存（POST /api/delivery-events/:id/line-items 実装箇所）に、
  delivery_line_items UPSERT と同一トランザクションで condition_events(inspection) を書く処理を追加。
  condition_line_id は capability_line_item_id → source_line_item_id 逆引き。document_id は
  検収書 documents 生成時に既知のため、文書生成 → イベント INSERT の順で同一 Tx に入れる。
- [ ] ロイヤリティ計算確定（POST /api/royalty-calculations）にも同様に condition_events(royalty_calc) を追加。
- [ ] 新規契約の登録経路（インポート importsV2.ts・フォーム登録 API）で
  capability_line_items / capability_financial_conditions を書く箇所すべてに condition_lines の
  二重書き込みを追加（C-2 と同じ変換ルールを関数化して共用: `lib/conditionLineMapper.ts` を新設）。
- 受け入れ基準: 新規に検収・計算・契約登録を行うと、旧テーブルと新テーブルの両方に整合した行が入る。

---

## 5. Phase D: 導出ビューと読み取り切替

依存: Phase C 完了（実績が condition_events に揃っていること）。

### D-1. ステータス導出ビュー
- [ ] initDb に `CREATE OR REPLACE VIEW` で追加:
```sql
CREATE OR REPLACE VIEW condition_line_status_v AS
SELECT
  cl.id, cl.line_code, cl.capability_id, cl.payment_scheme, cl.direction,
  CASE
    WHEN cl.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN cl.closed_at IS NOT NULL THEN 'closed_short'
    WHEN cl.payment_scheme IN ('lump_sum','per_unit','installment') THEN
      CASE WHEN COALESCE(e.sum_amount,0) >= cl.amount_ex_tax THEN 'fulfilled'
           WHEN COALESCE(e.sum_amount,0) > 0 THEN 'partially_fulfilled'
           ELSE 'open' END
    ELSE
      CASE WHEN cl.term_start IS NOT NULL AND CURRENT_DATE < cl.term_start THEN 'pending'
           WHEN cl.term_end IS NOT NULL AND CURRENT_DATE > cl.term_end THEN 'expired'
           ELSE 'active' END
  END AS status,
  COALESCE(e.sum_amount,0) AS consumed_amount,
  CASE WHEN cl.amount_ex_tax IS NOT NULL
       THEN cl.amount_ex_tax - COALESCE(e.sum_amount,0) END AS remaining_amount,
  e.event_count, e.last_event_at
FROM condition_lines cl
LEFT JOIN (
  SELECT condition_line_id, SUM(amount_ex_tax) AS sum_amount,
         COUNT(*) AS event_count, MAX(occurred_at) AS last_event_at
    FROM condition_events
   WHERE voided_at IS NULL
   GROUP BY condition_line_id
) e ON e.condition_line_id = cl.id;
```
- [ ] MG/AG 残高ビュー `condition_line_balance_v`:
  mg_remaining = GREATEST(0, cl.mg_amount - Σ有効 royalty_calc 実績の MG 消化)。
  MG 消化額は detail（royalty_calculations.mg_consumed_this_time）ではなく、
  イベント金額から再計算するのが最終形だが、移行期は detail の SUM を採用し、
  突合ビュー `condition_line_balance_check_v`（detail SUM と旧 getMgConsumedToDate の比較）を併設。
- [ ] スケジュールビュー `condition_line_schedule_v`:
  - 対象: scheme='subscription'（cycle/billing_day/term から期待期を generate_series で生成）と
    scheme='royalty' かつ calc_period_kind IN ('MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL')（定期報告型のみ。
    'MANUFACTURING' は対象外）
  - 出力: condition_line_id, expected_period, 実績有無, overdue 判定

### D-2. 「全量検収」判定の置換（既知バグ修正込み）
- [ ] `services/worker/server.ts` 納期アラート cron（L2170-2260 付近）の
  `EXISTS (... acceptance_ratio >= 1.0)` 判定を `condition_line_status_v.status = 'fulfilled'` 参照に変更。
  これにより「比率1.0の部分検収1件で全量扱い」になる誤判定が解消される。
  切替前に新旧判定の差分件数をログ出力し、差分行を確認すること（修正対象の実データが何件あるか）。
- [ ] `services/api/src/lib/calc.ts` getInspectionAvailability を condition_events ベースの
  SUM に切替（または同等の値を返すことを突合テストで確認してから内部実装を差し替え）。

### D-3. MG/AG 読み取り切替
- [ ] `services/worker/src/lib/calc_license.ts` getMgConsumedToDate を condition_events /
  condition_line_balance_v 参照に切替。royalty_calculations の mg_consumed_before/_after は
  以後「書き込みのみ（互換）・読み取り禁止」とする（grep で読み取り箇所を列挙し全件置換）。

### D-4. delivery_events.status の整理
- [ ] cron が status='overdue' へ UPDATE している箇所を削除し、overdue はクエリ時に
  `inspection_deadline < now() AND status='pending'` で導出。UI/API で 'overdue' を参照している箇所を
  grep（'overdue'）して導出式に置換。status 列の値域は pending/completed のみになる。

### D-5. 受け入れ基準
- [ ] 突合スクリプト `scripts/restructure_d_verify.ts`: 全 condition_line について
  旧ロジックと新ビューの (consumed, remaining, mg_remaining, fulfilled判定) を比較し、
  既知バグ（D-2）由来以外の差分ゼロ。
- [ ] アラート cron が新ビューで従来同等の通知を出す（ドライランログで比較）。

---

## 6. Phase E: 書き込み一本化と void/reissue

依存: Phase D。

### E-1. 文書 void / reissue API
- [ ] `POST /api/documents/:id/void`（worker）: 同一トランザクションで
  documents.lifecycle_status='archived_draft'（既存値域に合わせる。void 専用値を追加する場合は
  'voided' を lifecycle_status の値域に追加）+ 対応する condition_events.voided_at = now(),
  void_reason 記録。Backlog コメント投稿（既存 backlogService の流儀）。
- [ ] 再発行（既存の reissue 処理 L2066 付近）に、旧文書のイベントを void → 新文書で
  イベント再作成（または document_id 付け替え）の処理を統合。
  「有効実績1件 = final文書1件」の不変条件をこの API 層で保証する。
- [ ] 受け入れ基準: void すると残額・MG 残が即座に復元される（ビュー導出なので自動）。
  void → 再発行 → 再 void のシーケンスで残高が正しく往復する統合テストを scripts/ に追加。

### E-2. 旧テーブルへの書き込み停止（読み取りは互換ビューへ）
- [ ] capability_line_items / capability_financial_conditions への新規 INSERT を停止し、
  condition_lines のみに書く（C-5 で関数化した mapper を逆転: 新→旧の互換ビューを用意）。
- [ ] 互換ビュー: 旧テーブル名でアクセスしている読み取りコードが残る間は、
  旧テーブルを `capability_line_items_legacy` 等にリネームせず、まず読み取り箇所を grep で全列挙し、
  condition_lines 参照へ書き換える方を優先（ビューより明示的）。書き換え完了後、旧テーブルは凍結。

### E-3. 支払記録イベント
- [ ] subscription / installment 用の `POST /api/condition-lines/:id/payments`
  （event_type='payment', document_id なし）を追加。着手金の記録もこれを使う。

---

## 7. Phase F: 条件明細管理 UI

依存: Phase D（ビュー）。B-6 の line_code 採番確定が前提。

### F-1. API
- [ ] `GET /api/condition-lines`（一覧）: condition_line_status_v + 契約・取引先 JOIN。
  クエリパラメータ: status / direction / scheme / vendor_id / capability_id / q（line_code・subject 部分一致）。
- [ ] `GET /api/condition-lines/:lineCode`（詳細）: 明細本体 + status + balance +
  events（document_number, lifecycle, issue_key 付き、voided 含む）+ 関連（契約・課題・作品）。

### F-2. 画面
- [ ] ルート `/condition-lines`（一覧）と `/condition-lines/:lineCode`（詳細）。
- [ ] 一覧: ステータスチップフィルタ（RequestsPage の statusBuckets パターン流用）+ テーブル
  （line_code / subject / 契約 / 取引先 / scheme / direction / status / 残額・MG残 / 当期発行状況）。
- [ ] 詳細: VendorsPanel のセクションパターンで:
  - ヘッダ: line_code（mono）/ ステータスバッジ / scheme・direction・rights_attribution・取引先・納期
  - メトリクスカード: 消化型 = 目標額・消化済（プログレスバー）・残 / 継続型 = MG残・AG残・当期発行状況
  - SEC・01 実績と対になる文書: 有効イベント行（金額・日付・document_number・課題キー・final バッジ・
    Drive リンク）、void 行は打ち消し表示、末尾に「未実施」ghost 行 +「作成」ボタン
    （consumed < target の消化型、当期未発行の継続型のとき表示。クリックで該当テンプレを
    事前選択して DocumentEditorPage へ）
  - SEC・02 関連: 契約 / 実績発生元の課題（複数）/ 作品・素材 へのリンクチップ
- [ ] Phase A の課題詳細ページ: 文書行に「条件明細を見る」リンクを追加
  （document_id → condition_events → line_code で解決。API は A-1 のレスポンスに line_code を追加）。

---

## 8. Phase G: クリーンアップ（全 Phase 完了後）

- [ ] G-1: データ補正完了後の制約強化:
  - structural_role に NOT NULL + CHECK ('master','terms')
  - condition_lines に `cl_scheme_recurring_term` CHECK を付与
  - 「terms のみ condition_lines を持てる」「master のみ親になれる」をトリガで強制
- [ ] G-2: royalty_calculations の mg_consumed_before/_this_time/_after/mg_remaining/
  ag_consumed_* 列への書き込み停止 → 列 DROP（detail として残すのは計算入力値のみ）。
- [ ] G-3: contract_capabilities から *_allowed 4 フラグ、contract_category、旧 record_type 値の整理
  （record_type 列は当面残し、参照ゼロを確認後 DROP）。
- [ ] G-4: capability_line_items / capability_financial_conditions / work_sublicensees /
  sublicensees の DROP（参照ゼロ確認後。phase23 の `--really-drop` パターンを踏襲）。
- [ ] G-5: documents.form_data 内の ID 参照（delivery_event_id 等）への依存コードを全廃
  （form_data は印字スナップショットとしてのみ保持）。
- [ ] G-6: 旧 FK 残骸（delivery_events.order_item_id, royalty_payments.license_contract_id 等）の DROP。

---

## 9. ⚠ 要確認事項一覧（実装ゲート）

| ID | 内容 | ブロックする Phase | 仮決め案 |
|---|---|---|---|
| Q1 | line_code の採番形式 | F（B-6 は仮実装可） | 独立採番 CL-{YYYY}-{NNNNN} |
| Q2 | work_code の採番形式 | C-4 | WK-{YYYY}-{NNNN} |
| Q3 | mixed 契約・scope 0 件契約の手動分解 | C-1 完了判定 | CSV を出してユーザー確認 |
| Q4 | C-3 で document_id を解決できない検収実績の扱い | C-3 完了判定 | 保留リスト化しユーザー確認 |
| Q5 | スコープごとに期間・更新が異なる契約の有無 | G-1（制約強化前） | 契約本体の期間で統一 |
| Q6 | 権利者の実体化（vendors への FK 化） | なし（将来課題） | 文字列のまま据え置き |
| Q7 | 受取側（receivable）の税・源泉・通貨仕様 | E-3 のアウト側適用 | イン側と同一ロジックの鏡像 |
| Q8 | 打ち切り検収（closed_short）の権限・理由必須化 | F の操作ボタン実装 | admin ロールのみ・理由必須 |

---

## 10. 横断的な実装規約

1. すべての新規スクリプトは `--dry-run` デフォルト・`--apply` 明示。実行ログに前後件数と差分を出す。
2. バックフィルは source_* 列で追跡可能にし、再実行しても重複 INSERT しない（source_* で NOT EXISTS）。
3. 新旧切替を伴う変更は、切替前に新旧比較ログを必ず1度本番データで取得してから切り替える。
4. トランザクション境界: 「文書生成 + イベント INSERT」「void + voided_at」は必ず同一 Tx。
5. フロントは既存 shadcn コンポーネント（components/ui）と VendorsPanel の Field/SectionHead
   パターンを流用し、新規 CSS を増やさない。
6. 各 Phase 完了時に `TEST_RESULTS.md` の流儀でテスト結果を記録し、本書のチェックボックスを更新する。
