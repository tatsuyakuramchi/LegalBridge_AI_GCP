# 統一条件明細（condition_lines）設計ドラフト

作成日: 2026-06-11
ステータス: 構想確定（DDL ドラフト段階・未実装）

## 1. 背景と課題

現行構造では「文書（documents）同士が緩く関連しているだけ」で、条件の消化・発行状態の管理があやふやになっている。コード調査で確認した具体的な問題:

1. 条件明細にステータス列が存在しない
   - `capability_line_items` / `capability_financial_conditions` に状態カラムがなく、検収済み判定は EXISTS 問い合わせで都度導出（services/worker/server.ts:2191 付近）。
2. 「全量検収」判定が不正確
   - acceptance_ratio >= 1.0 の検収明細が 1 件でもあれば全量検収扱い。数量の消化率を見ていない。
3. 文書と実績の紐付けが form_data JSONB 頼み
   - 検収書・計算書の documents 行は form_data 内の ID でしか実績と繋がらず FK がない。文書の再発行・取消が実績に連動しない。
4. MG/AG 残高が挿入順依存
   - `royalty_calculations.mg_consumed_before/_this_time/_after` がスナップショットコピーのため、過去行の取消・順序入替で以降の全行が不正になる。
5. 状態と通知の混在
   - `delivery_events.status` の 'overdue' は期限から導出可能な値で、業務状態と同居している。

また、契約系統（業務委託・ライセンス・出版）ごとに明細テーブルが分かれているが、実契約は混合する（ライセンス契約内の業務委託条項、業務委託契約のロイヤリティ条項、出版の買い切り・一括許諾）。

## 2. 設計原則

1. 条件明細（condition_lines）が状態を持つ唯一の中心エンティティ。
2. 真実の源は実績台帳（condition_events）。状態・残高・MG/AG はすべて有効実績の集計から SQL ビューで導出する。実体として持つのは人の意思決定（打ち切り・キャンセル・取消）のタイムスタンプのみ。
3. 状態機械を決めるのは支払方式（payment_scheme）だけ。契約系統は状態に関与しない。
4. 権利帰属（rights_attribution）は状態に影響しない属性。文書テンプレートの条項と ledger 紐付けにのみ作用する。
5. 検収・計算の有効な実績 1 件 = final な文書 1 件（FK + CHECK で強制）。支払記録イベントは文書を持たない。

## 3. payment_scheme（支払方式）と原型

| scheme | 説明 | 原型 | 例 |
|---|---|---|---|
| `lump_sum` | 一括（買い切り・一括許諾） | 消化型 | イラスト買い切り、利用許諾料一括払い |
| `per_unit` | 数量 × 単価 | 消化型 | 現行の発注明細 |
| `installment` | 分割・マイルストーン払い | 消化型（予定表付き） | 着手金＋納品時残金 |
| `subscription` | 定額・定期 | 継続型（定額） | 月額顧問・保守（継続型業務委託はこれに限定） |
| `royalty` | 料率・従量（MG/AG 対応） | 継続型（従量） | ライセンス料、印税、業務委託のロイヤリティ条項 |

- 消化型: 残高がゼロに向かい、成就で終端する。
  `open → partially_fulfilled → fulfilled / closed_short / cancelled`
- 継続型: 履歴が積み上がり、終端は契約期間の事象のみ。
  主状態 `pending → active → expired / terminated`
  × スケジュール軸（subscription と定期報告型 royalty のみ。当期未発行/発行済/期限超過）
  × MG/AG フェーズ軸（royalty のみ。MG消化中 → MG枯渇 → AG消化中 → 実払い）

## 4. rights_attribution（権利帰属）

| 値 | 意味 |
|---|---|
| `transfer` | 帰属移転（買い切り） |
| `retained_license` | 権利留保＋利用許諾 |
| `license_only` | 許諾のみ |
| `joint` | 共有（共同著作） |
| NULL | 帰属概念なし |

joint の持分・共有者管理の置き場所（ledger 側か明細側か）はオープン事項。

## 5. スキーマ案（DDL ドラフト）

```sql
CREATE TABLE condition_lines (
  id SERIAL PRIMARY KEY,
  capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  line_code VARCHAR(60) UNIQUE,          -- 公開採番（明細番号単位の管理 UI のキー。形式未決。例: {契約番号}-L{NN}）
  subject TEXT,                          -- 対象（成果物・作品・素材）
  ledger_code VARCHAR(40),               -- 原作紐付け（任意）
  payment_scheme VARCHAR(20) NOT NULL
    CHECK (payment_scheme IN ('lump_sum','per_unit','installment','subscription','royalty')),
  rights_attribution VARCHAR(20)
    CHECK (rights_attribution IN ('transfer','retained_license','license_only','joint')),
  currency VARCHAR(10) DEFAULT 'JPY',
  notes TEXT,
  -- 消化型（lump_sum / per_unit / installment）
  quantity DECIMAL(15,4),
  unit_price DECIMAL(15,2),
  amount_ex_tax DECIMAL(15,2),
  delivery_date DATE,
  -- 継続型（subscription / royalty）
  term_start DATE,
  term_end DATE,
  cycle VARCHAR(50),
  billing_day INTEGER,
  calc_period_kind VARCHAR(20),
  calc_period_close_month SMALLINT,
  -- 従量（royalty）
  rate_pct DECIMAL(7,4),
  base_price_label TEXT,
  mg_amount DECIMAL(15,2),
  ag_amount DECIMAL(15,2),
  -- 人の意思決定のみ実体で持つ
  closed_at TIMESTAMPTZ,                 -- 打ち切り（closed_short）
  closed_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (capability_id, line_no),
  CONSTRAINT scheme_royalty_cols CHECK (
    payment_scheme = 'royalty'
    OR (rate_pct IS NULL AND mg_amount IS NULL AND ag_amount IS NULL)),
  CONSTRAINT scheme_depletable_target CHECK (
    payment_scheme IN ('subscription','royalty') OR amount_ex_tax IS NOT NULL),
  CONSTRAINT scheme_recurring_term CHECK (
    payment_scheme NOT IN ('subscription','royalty') OR term_start IS NOT NULL)
);

CREATE TABLE condition_line_installments (
  id SERIAL PRIMARY KEY,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL,
  trigger_kind VARCHAR(20) NOT NULL
    CHECK (trigger_kind IN ('on_signing','on_delivery','on_inspection','fixed_date')),
  planned_amount_ex_tax DECIMAL(15,2) NOT NULL,
  due_date DATE,
  UNIQUE (condition_line_id, installment_no)
);

CREATE TABLE condition_events (
  id SERIAL PRIMARY KEY,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
  event_no INTEGER NOT NULL,
  event_type VARCHAR(20) NOT NULL
    CHECK (event_type IN ('inspection','royalty_calc','payment')),
  installment_id INTEGER REFERENCES condition_line_installments(id),
  document_id INTEGER REFERENCES documents(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  period VARCHAR(7),                     -- YYYY-MM（継続型）
  amount_ex_tax DECIMAL(15,2) NOT NULL DEFAULT 0,
  voided_at TIMESTAMPTZ,                 -- 取消（文書 void と同一トランザクションで設定）
  void_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (condition_line_id, event_no),
  CONSTRAINT event_document_pairing CHECK (
    (event_type IN ('inspection','royalty_calc') AND document_id IS NOT NULL)
    OR (event_type = 'payment' AND document_id IS NULL))
);

-- 種別固有の明細は既存テーブルを detail として接続する
-- delivery_line_items  → inspection detail（condition_event_id FK を追加）
-- royalty_calculations → royalty detail（condition_event_id FK を追加。
--   mg_consumed_before/_after 等のスナップショット列は読み取り廃止 → 後日削除）
```

### ステータス導出ビュー（骨子）

```sql
CREATE VIEW condition_line_status_v AS
SELECT cl.id,
  CASE
    WHEN cl.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN cl.closed_at IS NOT NULL THEN 'closed_short'
    WHEN cl.payment_scheme IN ('lump_sum','per_unit','installment') THEN
      CASE WHEN COALESCE(e.sum_amount,0) >= cl.amount_ex_tax THEN 'fulfilled'
           WHEN COALESCE(e.sum_amount,0) > 0 THEN 'partially_fulfilled'
           ELSE 'open' END
    ELSE
      CASE WHEN CURRENT_DATE < cl.term_start THEN 'pending'
           WHEN cl.term_end IS NOT NULL AND CURRENT_DATE > cl.term_end THEN 'expired'
           ELSE 'active' END
  END AS status,
  COALESCE(e.sum_amount,0) AS consumed_amount,
  cl.amount_ex_tax - COALESCE(e.sum_amount,0) AS remaining_amount
FROM condition_lines cl
LEFT JOIN (
  SELECT condition_line_id, SUM(amount_ex_tax) AS sum_amount
    FROM condition_events
   WHERE voided_at IS NULL
   GROUP BY condition_line_id
) e ON e.condition_line_id = cl.id;
```

別途:
- MG/AG 残高ビュー: `mg_remaining = mg_amount - Σ(有効 royalty_calc の mg 消化)`。明細の生涯にわたる Σ なので、契約更新時の引き継ぎは追加実装なしで成立する。
- スケジュールビュー: subscription（cycle/billing_day/term）と定期報告型 royalty（calc_period_kind/締め月）について「期待される期」を生成し、有効イベントの period と突き合わせて当期未発行・期限超過を導出。製造イベント駆動の royalty は監視対象外。

## 6. 不変条件（invariants）

1. 有効（voided_at IS NULL）な inspection / royalty_calc イベント 1 件 = final な documents 1 件。
2. payment イベントは document_id を持たない（subscription・着手金等の支払記録）。
3. 文書の void / reissue は対応イベントの voided_at / document_id 付け替えと同一トランザクションで行う。
4. 集計値（消化額・残高・MG/AG・状態）をテーブル列として保持しない。導出はビューのみ。
5. 消化型明細の有効イベント合計は目標額を超えない（保存時にサーバ側で検証。現行 overflow チェックを踏襲）。
6. condition_lines は structural_role='terms' の契約のみに属する（master は枠組みのみ。A案）。

## 7. 移行計画

1. `condition_lines` / `condition_line_installments` / `condition_events` を新設。
2. バックフィル:
   - `capability_line_items` → condition_lines（cycle/billing_day あり → subscription、それ以外は per_unit / lump_sum。calc_method 列を判定材料に使う）
   - `capability_financial_conditions` → condition_lines（royalty。一括許諾は lump_sum）
   - `delivery_line_items` / `royalty_calculations` → condition_events ヘッダ生成 + detail FK 接続
   - document_id は form_data 内の ID から復元（phase23_restore_lines_from_form_data.sql と同じ手口）
3. ステータス導出ビューを作成し、アラート cron・UI の判定をビュー参照に切替（既存の「全量検収」誤判定もここで解消）。
4. 文書 void / reissue API を整備し、イベントへの伝搬をトランザクションで保証。
5. `royalty_calculations` の mg/ag before/after 列の読み取り廃止（書き込みは互換のため一時継続 → 後日削除）。`delivery_events.status` から 'overdue' を外し導出に変更。
6. 旧 2 テーブルに互換ビューを被せて読み取り元を段階切替 → 物理削除（Phase 23 の旧テーブル削除と合わせて実施）。

各ステップは独立リリース可能。Phase 24（Excel 発行分離）とは衝突しない。

## 8. 契約ヘッダ層：構造役割 × スコープ × テンプレート

現行の9分類（基本契約・個別条件・単独契約 × 出版・ライセンス・業務委託）を直交分解する。

### 8.1 分解の3軸

1. 構造役割（structural_role）: `master`（基本契約）/ `terms`（条件契約）
   - `terms` + `parent_capability_id` あり → 個別条件
   - `terms` + 親なし → 単独契約
   - 単独契約は個別条件と同義（条件明細を持てる。違いは親の有無のみ）なので、役割は2値で足りる。
2. スコープ（contract_scopes、1契約に1..N行）: `service`（業務委託）/ `license_use`（利用許諾）
   - 出版とライセンスの本質はどちらも利用許諾であり、分かれているのはテンプレートの都合。
     意味論上のスコープは2種に集約する。
   - 複数ジャンル契約（ライセンス基本契約＋業務委託基本契約、出版基本契約＋業務委託要素）は
     master 1行＋スコープ複数行で表現。`contract_category='mixed'` は廃止。
3. テンプレートファミリー（template_family）: `license` / `publication` / …
   - 文書テンプレート選択のための表現層の属性。状態・検証には関与しない。

### 8.2 検証規則と整理効果

- 条件明細（condition_lines）は structural_role='terms' の契約のみに付けられる。
  master は枠組み（スコープ・期間・更新・権利帰属のデフォルト）のみを定義する。
- 個別条件（terms＋親あり）の scopes ⊆ 親 master の scopes。
- 子文書・明細の作成可否（発注書を作れるか等）は scopes から導出。
  `purchase_order_allowed` / `license_condition_allowed` / `publication_condition_allowed` は廃止。
- `parent_capability_id` FK を新設。現行は form_data.selected_master_contract_id のみ
  （services/worker/server.ts:8917）で DB 上の親子 FK が存在しないため、ここからバックフィル。
- 現行 record_type の非契約値（purchase_order / delivery_record / license_condition /
  publication_condition）は condition_lines / condition_events / documents へ移り、
  contract_capabilities は「本物の契約」のみのテーブルになる。

### 8.3 DDL ドラフト

```sql
ALTER TABLE contract_capabilities ADD COLUMN structural_role VARCHAR(10)
  CHECK (structural_role IN ('master','terms'));
ALTER TABLE contract_capabilities ADD COLUMN parent_capability_id INTEGER
  REFERENCES contract_capabilities(id);
ALTER TABLE contract_capabilities ADD COLUMN template_family VARCHAR(20);

CREATE TABLE contract_scopes (
  id SERIAL PRIMARY KEY,
  capability_id INTEGER NOT NULL REFERENCES contract_capabilities(id) ON DELETE CASCADE,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('service','license_use')),
  UNIQUE (capability_id, scope)
);
-- master のみ親になれる制約はトリガまたはアプリ層で強制
```

### 8.4 移行マッピング

| 現行 | 新 |
|---|---|
| record_type='master_contract' | structural_role='master' |
| record_type='individual_contract' | structural_role='terms' + parent FK バックフィル |
| record_type='standalone_contract' | structural_role='terms'（親なし） |
| contract_category='service' | scope('service') |
| contract_category='license' | scope('license_use') + template_family='license' |
| contract_category='publication' | scope('license_use') + template_family='publication' |
| contract_category='mixed' | 実データを確認して scope 複数行に分解 |
| *_allowed フラグ | scope 行の補完材料に使った後、廃止 |
| ライセンス基本契約に直付きの金銭条件 | 同日付・同条件の「暗黙の terms 契約」を生成して切り出す（master 直下に 1 件、親 FK 付き） |

## 9. 作品・原作・権利者層

### 9.1 構成

- `ledgers` / `materials`（他社 IP マスター）は現行を維持。
- `works`（作品マスター）を新設。自社製品（日本語版・ボードゲーム・出版物等）の実体。
  `parent_work_id` で派生（第2版・多言語版・グッズ化）の親子関係を持つ。
- `work_components`（構成要素）: 作品を構成する権利の束（原作利用・翻訳・イラスト等）。素材参照は任意。
- `work_component_lines`: 構成要素 ↔ イン側条件明細の N:M 接続
  （1要素を複数契約が支えるケース: 翻訳許諾＋翻訳改訂委託 など）。
- 方向軸: `condition_lines` に `direction`（'payable'＝イン側支払 / 'receivable'＝アウト側受取）を追加。
  再許諾（アウト）は受取方向の条件明細・実績としてイン側と対称に管理する。
  受取 royalty の MG/AG は鏡像（相手方が当社への支払で MG を消化）。
- `sublicensees` マスターは `vendors`（取引先）に統合。
  `work_sublicensees` は「アウト側 terms 契約＋受取条件明細＋作品参照」に置き換え。
- 現行の自由テキスト作品名（`contract_capabilities.original_work` / `work_name` / `product_name`、
  `manufacturing_events.product_name`）は works 参照へ移行。

### 9.2 これで導出できる整理（代表クエリ）

1. 再許諾可否の検証: 作品 →（parent チェーンの祖先を含む）構成要素 → イン側条件明細を辿り、
   `transfer`（買い切り）は無条件可、許諾系は sublicense 可否・地域・言語を親契約スコープと突き合わせて判定。
   派生作品は祖先の制約を継承する（再帰 CTE）。
2. 収益と支払義務の連鎖: アウト側の受取イベント → 作品 → royalty 型イン側明細へ、
   支払側計算実績の起票候補を生成（買い切り要素は連鎖なし。各明細の MG/AG は独立に消化）。

### 9.3 DDL ドラフト

```sql
CREATE TABLE works (
  id SERIAL PRIMARY KEY,
  work_code VARCHAR(40) UNIQUE NOT NULL,        -- 採番形式は未決
  title TEXT NOT NULL,
  parent_work_id INTEGER REFERENCES works(id),  -- 派生元
  remarks TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_components (
  id SERIAL PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  component_no INTEGER NOT NULL,
  component_kind VARCHAR(50),                   -- original_use / translation / illustration / ...
  material_id INTEGER REFERENCES materials(id), -- 素材参照（任意）
  notes TEXT,
  UNIQUE (work_id, component_no)
);

CREATE TABLE work_component_lines (
  component_id INTEGER NOT NULL REFERENCES work_components(id) ON DELETE CASCADE,
  condition_line_id INTEGER NOT NULL REFERENCES condition_lines(id),
  PRIMARY KEY (component_id, condition_line_id)
);

ALTER TABLE condition_lines ADD COLUMN direction VARCHAR(10) NOT NULL DEFAULT 'payable'
  CHECK (direction IN ('payable','receivable'));
ALTER TABLE condition_lines ADD COLUMN work_id INTEGER REFERENCES works(id);
  -- アウト側明細の対象作品参照。イン側はこれまで通り ledger_code / 素材参照
```

### 9.4 移行

- `sublicensees` → `vendors`（名寄せの上で統合）。
- `work_sublicensees` → works の起票＋アウト側 terms 契約＋受取条件明細。
  ラベル列（rate_label / mg_ag_label / payment_terms_label）は条件明細の構造化列または notes に移す。
- 自由テキスト作品名は works への名寄せドラフトを機械生成し、人が確認して確定する。

## 10. 課題詳細 UI（フロント要件）

### 10.1 課題

- 課題（Backlog issue）1 件に文書が 1:N で紐づくが、課題の詳細ビューが存在しない。
  RequestsPage のカードをクリックすると文書作成画面（DocumentEditorPage）へ直行し
  （RequestsPage.tsx:63-66）、「この課題で作った文書の一覧」「どこまで終わったか」を見る場所がない
  （Dashboard に documentCount の数字が出るのみ）。

### 10.2 課題詳細ページ（文書に限定）

- `/issues/:issueKey` の専用ページ（Dialog でなくルート化。URL を Backlog コメントに貼れる）。
- ヘッダ: 課題キー / 件名 / Backlog ステータス（既存 WorkflowPanel compact を埋め込み）/ 担当・期日。
- 本文は文書一覧のみ: 種別・document_number・日付・lifecycle・Drive リンク・再編集。
  各文書行から対応する条件明細詳細（10.3）へリンク。
- 文書作成は詳細ページの「作成」から template 事前選択で DocumentEditorPage へ遷移。
- 進捗・消化状況はこの画面に置かない。課題はワークフローの単位であり、
  業務進捗は条件明細の単位で管理する（下記）。

### 10.3 条件明細管理 UI（明細番号単位）

- 条件明細に公開採番 `line_code` を付与し（形式未決。例: {契約番号}-L{NN}）、明細1件＝1詳細画面とする。
- 一覧: ステータス（未消化 / 一部 / 成就 / 当期未発行 / 期限超過）・契約・取引先・方向（支払/受取）で
  フィルタできる運用コックピット。アラート cron が見ているものと同じ導出ビューを人間も見る。
- 詳細（取引先マスター詳細のセクション分割パターンを踏襲）:
  - ヘッダ: line_code / ステータスバッジ / scheme・方向・権利帰属・取引先・納期
  - メトリクス: 目標額・消化済・残（消化型）、MG/AG 残・当期発行状況（継続型）
  - SEC・01 実績と対になる文書: 有効イベント＋paired 文書の一覧と「未実施」ghost 行（作成ボタン）。
    取消（void）された実績は打ち消し表示で履歴に残す
  - SEC・02 関連: 契約 / 課題（実績の発生元課題は複数あり得る）/ 作品・素材

### 10.4 実装段階

- Stage 1（現行スキーマで実装可能）: 課題詳細ページ（ヘッダ＋ステータス操作＋文書一覧）。
  API は documents を issue_key で引くのみ。
- Stage 2（新スキーマ後）: 条件明細管理 UI。`condition_line_status_v` 等の導出ビューから供給。
  ビューが UI に公開すべき項目: status / consumed_amount / remaining_amount /
  mg_remaining / 当期 period の発行有無 / 次に期待される文書種別。

## 11. 決定事項ログ（2026-06-11 ヒアリング）

- 業務委託条件明細は消化型（成就で消せる）、利用許諾条件明細は継続型（消えない）の 2 原型に分かれる。
- 継続型の業務委託は存在するが、支払方法がサブスクリプション型のものに限定される。
- 契約更新（auto_renewal）時、MG/AG の残高・消化履歴は同一条件明細に引き継ぐ（明細は更新で作り直さない）。
- 「当期未発行」のスケジュール監視は定期報告駆動（sales 型）のみ。製造イベント駆動は対象外。
- 分割・マイルストーン払い（着手金＋納品時残金等）が実在する → installment scheme + 分割予定テーブルで対応。
- 権利帰属の区分は 帰属移転 / 権利留保＋利用許諾 / 許諾のみ、加えて共有（共同著作）がある。
- サブスクリプション型は文書発行なし、支払記録のみで管理する。
- 単独契約は個別条件と同義（条件明細を持てる。違いは親基本契約の有無のみ）。
- 出版とライセンスの本質はどちらも利用許諾。意味論上のスコープは service / license_use の2種に集約し、出版はテンプレートファミリーとして表現する。
- 基本契約は複数スコープを持てる（例: ライセンス基本契約＋業務委託、出版基本契約＋業務委託要素）。
- A案を採用: master は枠組みのみで条件明細を持たない。条件明細は必ず terms 契約（個別条件 / 単独契約）に置く。現行のライセンス基本契約直付きの金銭条件は、移行時に暗黙の terms 契約として切り出す。
- `works`（作品マスター）を新設。構成要素（work_components）でイン側条件明細と N:M 接続し、「作品＝権利の束」として再許諾可否と収益連鎖を構造から導出する。
- アウト側（再許諾）は受取方向（direction='receivable'）の条件明細・実績として対称管理（(a)案）。受取ロイヤリティの計算・入金記録まで本システムで扱う。
- `sublicensees` マスターは `vendors` に統合する。
- 作品は `parent_work_id` による親子（派生）関係を持ち、権利制約は祖先から継承する。
- 課題詳細ページは文書一覧に限定する。消化・進捗の管理は条件明細番号（line_code）単位の専用 UI で行う。

## 11b. 決定事項ログ（2026-06-23）— 条件入力の入口一本化

最終目的: 条件明細の入口（フォーム）を1本化し、各画面はそこへ「リンク」するだけにする。
データの混乱とテーブルの散乱を避ける。

- 入口一本化の原則: 「条件入力」と「文書生成」を分離する。条件は **1フォーム → 1書き込み経路 →
  condition_lines（＋installments/events）** に集約。文書（発注書/利用許諾/検収/計算書）は
  「登録済みの条件を参照してPDF化」する下流処理にし、documents は条件を所有せず参照する。
  各画面（発注作成・利用許諾・過去条件登録・課題詳細）はこの1フォームへリンク/埋め込みするだけ。
- 用途: 登録した（過去）条件は「計算（利用許諾料計算書・検収・分配・残額）」と「横断検索」の
  両方に使う＝フル・リンク（vendor / work・原作・素材 / direction / payment_scheme /
  rights_attribution / 料率・MG/AG・金額・期間）を必須とする。
- 書き先方式: **B案（現状整合・安全）を採用**。フォームは既存の upsert
  （upsertCapabilityFinancialConditions / capability_line_items upsert）に通し、sync で
  condition_lines を埋める。condition_lines への flip（source 化）は後回し（§7 の段階移行で実施）。
  入口一本化はフォーム／書き込み関数のレベルで先行達成する。
- 束ね方: 1過去契約 = 1 capability（structural_role='terms'）、その下に複数 condition_line。
  条件をバラで入れず「契約の器」にぶら下げる（condition_lines.capability_id 必須）。
- 過去条件は文書不要（データのみ）。原本があれば documents.document_url に添付するだけで、
  PDFは作り直さない。
- 実装の起点: 「過去条件登録」画面（capability セレクタ/軽量 terms 契約の新規作成 ＋
  既存の条件/明細フォーム流用 ＋ PDFなし保存）を最初に作る。これが一本化入口の1個目になり、
  そのまま過去条件の量産投入に使う。既存の文書作成画面は後続で同フォーム/同経路へリンクさせる。

## 12. オープン事項

- 打ち切り検収（closed_short）の運用ルール・実行権限・理由記録の要件。
- 文書の取消・再発行の発生頻度と承認フロー。
- 検収済み・計算済みに対する「支払済（paid）」を明細状態に反映するか。payment イベントは subscription / installment で導入するため、inspection / royalty 明細にも支払イベントを記録すれば自然に拡張できる。
- 共有（joint）の持分・共有者の管理場所（ledgers 側 / additional_parties / 明細側）。
- 旧テーブル互換ビューの提供期間と、参照している全コードパスの棚卸し。
- スコープごとに契約期間・更新条件が異なる契約の有無（あるなら期間情報を contract_scopes 行に持たせる）。
- template_family の値域と ledgers.division（'BDG'/'PUB'）の関係整理。
- 複数スコープ契約の文書番号採番（template_family 主導で採番するか、混合用プレフィックスを設けるか）。
- 権利者の実体化（materials.rights_holder 等の自由テキストを vendors への FK にするか。クレジット表記用文字列と支払主体の分離方法。joint の持分管理と合わせて検討）。
- 受取側（receivable）の計算仕様詳細（MG/AG の鏡像処理、通貨・税・源泉の扱い）。
- work_code の採番形式と、works と ledgers.division（'BDG'/'PUB'）の関係。
- 条件明細の公開採番 line_code の形式（契約番号従属の {契約番号}-L{NN} か、独立採番か。再発行・契約改版時に番号が変わらないことが要件）。
- 自由テキスト作品名（original_work / product_name / manufacturing_events.product_name）の名寄せ手順。
- 派生作品における制約継承の詳細（子で制約を上書き・追加できる範囲）。
- 素材単位で条件が変わる契約の有無（条件明細→素材参照を必須にするか任意のままにするか）。
