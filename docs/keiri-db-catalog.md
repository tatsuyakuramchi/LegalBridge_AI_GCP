# 経理部向け データ取得 お品書き（search-API / DB カタログ）

LegalBridge の DB から経理部が情報を取得するための「お品書き」です。
**何が・どのテーブル/カラムに・どのAPIで取れるか** をまとめています。

- 対象サービス: **search-API**（読み取り専用 / Cloud Run `search-api`、ソースは `services/api`）
- データベース: Cloud SQL (PostgreSQL)
- 最終更新: 2026-06-15

> 取得手段は2通りあります。
> 1. **DB直接** … Cloud SQL に読み取り接続して SQL を実行（本書のテーブル/カラム表・SQL例を参照）。
> 2. **search-API** … 後半の「APIエンドポイント一覧」を参照（画面と同じデータが JSON で取れます）。

---

## 1. 全体像（データモデル）

検収・支払・ロイヤリティの「実績と残高」は、新しい統一台帳 **`condition_lines`（条件明細）＋ `condition_events`（実績イベント）** に集約されています。経理が最初に見るべきはここです。

```
契約 contract_capabilities ──< 条件明細 condition_lines ──< 実績 condition_events ──> 文書 documents
   (発注書/契約)         (1明細=1債権債務)     (検収/計算/支払=消化)    (検収書/計算書 等)
        │                      │
        └─ vendors(取引先)      └─ works(作品) / 旧 capability_line_items(明細ミラー)
```

- **`condition_lines`** … 1行＝1つの債権/債務（発注明細・利用許諾条件など）。金額・納期・支払方式を持つ。
- **`condition_events`** … その明細に対する「消化」実績（検収・ロイヤリティ計算・支払）。1明細に複数イベント（分割検収など）。
- **`condition_line_status_v`**（ビュー） … 明細ごとの **成就/未了・検収額・残額** を導出。経理照合の主役。
- 旧 **`capability_line_items` / `capability_financial_conditions`** … 移行前からのミラー。横断検索や一部APIはこちらも参照（新台帳が正、無ければ旧にフォールバック）。

### 用語・ステータス定義

| 区分 | 値 | 意味 |
|---|---|---|
| `condition_lines.direction` | `payable` / `receivable` | 当社支払 / 当社受領 |
| `condition_lines.payment_scheme` | `lump_sum` / `per_unit` / `installment` / `subscription` / `royalty` | 一括 / 単価×数量 / 分割 / 継続課金 / 印税 |
| `condition_line_status_v.status`（消化型: lump_sum/per_unit/installment） | `open` / `partially_fulfilled` / `fulfilled` | 未了 / 一部検収 / 成就（全額検収済） |
| `condition_line_status_v.status`（継続型: subscription/royalty） | `pending` / `active` / `expired` | 期間前 / 期間中 / 期間終了 |
| `condition_line_status_v.status`（その他） | `closed_short` / `cancelled` | 途中打切 / 取消 |
| `condition_events.event_type` | `inspection` / `royalty_calc` / `payment` | 検収 / ロイヤリティ計算 / 支払 |
| `condition_events.voided_at` | NULL / 日時 | NULL=有効、日時入り=取消（**集計から除外**） |

> **成就（fulfilled）判定**: `condition_events`（`voided_at IS NULL`）の `amount_ex_tax` 合計 ≥ `condition_lines.amount_ex_tax`。
> **検収額（consumed_amount）** = 有効イベントの `amount_ex_tax` 合計、**残額（remaining_amount）** = `amount_ex_tax − consumed_amount`。

---

## 2. テーブル / ビュー カラム一覧

### 2.1 condition_lines（条件明細・台帳の中心）

| カラム | 型 | 説明 |
|---|---|---|
| `id` | serial | 主キー |
| `line_code` | varchar(60) | 明細コード（例 `CL-2026-00123`）。一意 |
| `capability_id` | int FK | 親契約 `contract_capabilities.id` |
| `line_no` | int | 契約内の明細連番 |
| `subject` | text | 件名・品目 |
| `direction` | varchar(10) | `payable`/`receivable` |
| `payment_scheme` | varchar(20) | 支払方式（上表参照） |
| `rights_attribution` | varchar(20) | `transfer`/`retained_license`/`license_only`/`joint` |
| `quantity` | numeric(15,4) | 数量 |
| `unit_price` | numeric(15,2) | 単価（税抜） |
| `amount_ex_tax` | numeric(15,2) | 金額（税抜）＝債権債務額 |
| `currency` | varchar(10) | 通貨（既定 JPY） |
| `delivery_date` | date | 納期 |
| `term_start` / `term_end` | date | 期間（継続型） |
| `cycle` / `billing_day` | varchar / int | 課金サイクル / 請求日 |
| `calc_period_kind` | varchar(20) | `MANUFACTURING`/`MONTHLY`/`QUARTERLY`/`SEMIANNUAL`/`ANNUAL` |
| `calc_period_close_month` | smallint | 締め月（1-12） |
| `rate_pct` | numeric(7,4) | 料率%（royalty） |
| `mg_amount` / `ag_amount` | numeric(15,2) | 最低保証(MG) / 前払保証(AG) |
| `ledger_code` | varchar(40) | 元帳コード（任意） |
| `work_id` | int FK | 作品 `works.id` |
| `closed_at` / `closed_reason` | ts / text | 途中打切 |
| `cancelled_at` | ts | 取消 |
| `source_line_item_id` | int | 由来の旧明細 `capability_line_items.id`（移行キー） |
| `source_condition_id` | int | 由来の旧財務条件 `capability_financial_conditions.id` |
| `created_at` / `updated_at` | ts | 監査 |

### 2.2 condition_events（実績イベント・消化）

| カラム | 型 | 説明 |
|---|---|---|
| `id` | serial | 主キー |
| `condition_line_id` | int FK | 対象明細 `condition_lines.id` |
| `event_no` | int | 明細内のイベント連番 |
| `event_type` | varchar(20) | `inspection`/`royalty_calc`/`payment` |
| `document_id` | int FK | 対の文書 `documents.id`（検収書/計算書）。payment は NULL |
| `occurred_at` | ts | 発生日（検収日・計算日 等） |
| `period` | varchar(7) | 対象期間 `YYYY-MM`（継続型） |
| `amount_ex_tax` | numeric(15,2) | 消化額（税抜）＝この回の検収/計算額 |
| `voided_at` / `void_reason` | ts / text | 取消（**集計除外**） |
| `installment_id` | int FK | 分割予定 `condition_line_installments.id` |
| `backlog_issue_key` | varchar(50) | 起票 Backlog キー |
| `source_delivery_line_item_id` | int | 由来の検収明細 `delivery_line_items.id` |
| `source_royalty_calculation_id` | int | 由来のロイヤリティ計算 `royalty_calculations.id` |

### 2.3 condition_line_status_v（ビュー：成就/未了・残高） ★経理照合の主役

| カラム | 説明 |
|---|---|
| `id` | `condition_lines.id` と一致 |
| `line_code` / `capability_id` / `payment_scheme` / `direction` | 明細属性 |
| `status` | `open`/`partially_fulfilled`/`fulfilled` ほか（上表） |
| `consumed_amount` | 検収/消化額の合計（有効イベントのみ） |
| `remaining_amount` | 残額（`amount_ex_tax − consumed_amount`） |
| `event_count` | 有効イベント件数 |
| `last_event_at` | 最終イベント日 |

### 2.4 condition_line_balance_v（ビュー：MG/AG 残高・royalty 用）

`condition_line_id`, `line_code`, `mg_amount`, `mg_consumed`, `mg_remaining`, `ag_amount`(=cl.ag_amount), `ag_consumed`, `ag_remaining`。

### 2.5 condition_line_schedule_v（ビュー：継続型の発行予定/未発行）

`condition_line_id`, `line_code`, `payment_scheme`, `expected_period`(YYYY-MM), `issued`(bool), `overdue`(bool)。
月次/四半期等の計算書の **発行漏れ（overdue AND NOT issued）** 検出に使用。

### 2.6 contract_capabilities（契約・発注書のヘッダ）

主要カラム（経理）: `id`, `record_type`（`purchase_order`/`master_contract`/…）, `contract_category`, `contract_title`, `document_number`, `vendor_id`, `amount_ex_tax`, `amount_inc_tax`, `tax_rate`, `tax_amount`, `due_date`（支払期限）, `issue_date_po`（発注日）, `effective_date`/`expiration_date`, `contract_status`, `is_primary`（正本フラグ）, `lifecycle_status`（`final`/`archived_draft`/`reissued`）, `revision`, `base_document_number`, `backlog_issue_key`, `ledger_code`, `drive_url`。

> 集計時は **正本のみ**（`COALESCE(is_primary,TRUE)=TRUE AND COALESCE(lifecycle_status,'final')='final'`）に絞るのが基本。

### 2.7 capability_line_items（旧：明細ミラー） / capability_financial_conditions（旧：財務条件）

横断検索・一部APIが参照。新台帳 `condition_lines` と `source_line_item_id`/`source_condition_id` で対応。

- **capability_line_items**: `id`, `capability_id`, `line_no`, `category`, `item_name`, `spec`, `calc_method`, `payment_terms`, `quantity`, `unit_price`, `amount_ex_tax`, `delivery_date`, `payment_date`, `cycle`, `term_start`/`term_end`, **`inspected_amount_ex_tax`**（旧式の検収累計）, **`status_flags`**(JSONB: `po_signed`/`inspection_issued`/`payment_exported`), `is_inbound`, `flow_direction`('in'/'out'), `deliverable_ownership`, `fee_type`, `source_ip_id`/`work_id`/`master_contract_id`/`ringi_id`（紐付け）。
- **capability_financial_conditions**: `id`, `capability_id`, `condition_no`, `region_language_label`, `calc_method`(ROYALTY/FIXED/SUBSCRIPTION), `rate_pct`, `base_price_label`, `calc_period`/`calc_period_kind`/`calc_period_close_month`, `currency`, `formula_text`, `payment_terms`, `mg_amount`, `ag_amount`。

### 2.8 vendors（取引先マスタ）

`id`, `vendor_code`, `vendor_name`, `trade_name`, `pen_name`, `entity_type`, `withholding_enabled`（源泉対象）, `is_invoice_issuer`, `invoice_registration_number`（インボイス登録番号）, `bank_name`/`branch_name`/`account_type`/`account_number`/`account_holder_kana`（振込先）, `address`, `email`, `contact_department`/`contact_name`。

### 2.9 documents（発行文書）

`id`, `document_number`, `issue_key`(Backlog), `template_type`（`purchase_order`/`inspection_certificate`/`royalty_statement` 等）, `form_data`(JSONB 全項目), `drive_link`, `excel_link`, `lifecycle_status`, `is_primary`, `revision`, `base_document_number`, `vendor_name_snapshot`, `created_by`, `created_at`。

### 2.10 delivery_events / delivery_line_items（検収＝消化の源泉）

- **delivery_events**: `id`, `backlog_issue_key`, `delivered_at`（納品報告日）, `delivered_amount`, `inspection_deadline`（検収納期）, `status`(pending/completed/overdue), `note`。
- **delivery_line_items**: `id`, `delivery_event_id`, `inspected_quantity`, `acceptance_ratio`（歩留まり）, `inspected_amount_ex_tax`（検収額・税抜）, `rejection_reason`, `condition_line_id`/`condition_event_id`（新台帳への結線）。

### 2.11 royalty_calculations（ロイヤリティ計算書の明細）

`id`, `backlog_issue_key`, `calc_type`(manufacturing/sales/sublicense), `unit_price`(基準価格), `quantity`(製造数), `sample_quantity`, `billable_quantity`, `rate_pct`, `gross_royalty_ex_tax`, `mg_amount`, `mg_consumed_before`/`_this_time`/`_after`, `mg_remaining`, `actual_royalty_ex_tax`（実支払額）, `tax_rate`, `tax_amount`, `total_payment_inc_tax`, `currency`, `period`(YYYY-MM), `reporting_deadline`, `payment_due_date`, `condition_line_id`/`condition_event_id`（結線）。

---

## 3. search-API エンドポイント一覧（お品書き本体）

ベースURL = search-API のホスト。読み取りは `GET`。社内認証（IAP / portal secret）必須。

### 3.1 条件明細・横断検索（経理の主力）

| エンドポイント | 用途 | 主なクエリ | 返却の主な列 |
|---|---|---|---|
| `GET /api/conditions/search` | 条件明細の横断検索（成就/未了・検収額つき） | `payment_from/to`, `delivery_from/to`, `category`, `vendor`, `owner`, `q`, `include_all`, `limit`, `offset` | `document_number`, `vendor_name`, `item_name`, `amount_ex_tax`, `consumed_amount`, `remaining_amount`, `fulfillment_status`, `fulfilling_doc_number`, `payment_date`, `delivery_date`, `contract_category`, `issue_key` ほか |
| `GET /api/conditions/export` | 上記のCSV出力（Excel/BOM付） | 同上＋`ids` | 上記＋「成就状態」「成就文書」「検収額/残額」列 |
| `GET /api/condition-lines` | 新台帳ベースの明細一覧 | `status`, `direction`, `scheme`, `vendor_id`, `capability_id`, `q` | `line_code`, `subject`, `payment_scheme`, `direction`, `amount_ex_tax`, `status`, `consumed_amount`, `remaining_amount`, `mg_remaining`, `ag_remaining`, `vendor_name`, `contract_number`, `fulfilling_doc_number`, `has_overdue` |
| `GET /api/condition-lines/:lineCode` | 明細1件の詳細＋イベント＋発行予定 | — | `line`（全カラム＋status/残高）, `events[]`（検収/計算/支払, 取消含む）, `schedule[]`（当期発行予定/overdue） |

### 3.2 契約・発注書（検収待ち含む）

| エンドポイント | 用途 | 返却の主な列 |
|---|---|---|
| `GET /api/contracts/search?record_types=purchase_order` | 発注書/契約の検索・検収待ち | `document_number`, `vendor_name`, `contract_title`, `amount_ex_tax`, `inspected_amount`, `remaining_amount`, `unissued_line_count`（未検収明細数）, `due_date`, `issue_date_po`, `latest_delivered_at`（納品報告）, `nearest_inspection_deadline`（検収納期）, `nearest_line_delivery_date`（発注書由来の予定納期）, `has_delivery_report`, `overdue_no_report` |
| `GET /api/contracts/:id` | 契約1件の詳細（明細・財務条件・経費・検収集計・取引先） | ヘッダ全項目＋`line_items[]`, `financial_conditions[]`, `expenses[]`, `vendor` ほか |

### 3.3 マネジメント / マスタ

| エンドポイント | 用途 |
|---|---|
| `GET /api/management/deliveries` | 検収（納品報告）一覧 |
| `GET /api/management/royalties` | ロイヤリティ計算一覧 |
| `GET /api/management/documents` | 発行文書一覧 |
| `GET /api/management/assets` | 法務アセット（契約原本）一覧 |
| `GET /api/issues/:issueKey/documents` | Backlog課題に紐づく発行文書 |
| `GET /api/master/vendors` / `/api/master/vendors/:code` | 取引先マスタ |
| `GET /api/master/contracts` | 契約マスタ一覧 |
| `GET /api/master/ledgers` | 元帳（ledger）一覧 |
| `GET /api/master/staff` | 担当者マスタ |
| `GET /api/receivable-map` ほか | 請求権（受領側）マップ |

---

## 4. よく使う取得例

### 4.1 取引先別の未検収（未払いの債務）残高 — SQL

```sql
SELECT v.vendor_code, v.vendor_name,
       SUM(s.remaining_amount) AS remaining_ex_tax,
       COUNT(*) FILTER (WHERE s.status <> 'fulfilled') AS open_lines
  FROM condition_lines cl
  JOIN condition_line_status_v s ON s.id = cl.id
  JOIN contract_capabilities cc ON cc.id = cl.capability_id
  LEFT JOIN vendors v ON v.id = cc.vendor_id
 WHERE cl.direction = 'payable'
   AND s.status IN ('open','partially_fulfilled')
   AND COALESCE(cc.is_primary,TRUE)=TRUE
   AND COALESCE(cc.lifecycle_status,'final')='final'
 GROUP BY v.vendor_code, v.vendor_name
 ORDER BY remaining_ex_tax DESC;
```

### 4.2 月次の検収済額（実績） — SQL

```sql
SELECT to_char(e.occurred_at,'YYYY-MM') AS month,
       SUM(e.amount_ex_tax) AS inspected_ex_tax
  FROM condition_events e
 WHERE e.event_type = 'inspection'
   AND e.voided_at IS NULL
 GROUP BY 1 ORDER BY 1;
```

### 4.3 ある明細の検収履歴（API）

```
GET /api/condition-lines/CL-2026-00123
→ { line:{…status, consumed_amount, remaining_amount}, events:[…検収/計算], schedule:[…] }
```

### 4.4 横断検索を期間で絞ってCSV（API）

```
GET /api/conditions/export?payment_from=2026-04-01&payment_to=2026-06-30&category=service
→ Excel互換CSV（成就状態・検収額・残額・成就文書つき）
```

---

## 5. 取得時の注意

- **正本フィルタ**: 集計は `is_primary=TRUE` かつ `lifecycle_status='final'` の契約に絞る（再発行・旧版の二重計上を防ぐ）。
- **取消イベント**: `condition_events.voided_at IS NOT NULL` は無効。金額集計では必ず除外（`condition_line_status_v` は除外済み）。
- **税抜が基準**: 台帳の金額は原則 **税抜（`amount_ex_tax`）**。税込・消費税は `contract_capabilities.tax_rate/tax_amount/amount_inc_tax` や `royalty_calculations.tax_*` を参照。
- **新旧モデル**: 成就/残高は新台帳 `condition_lines`＋`condition_line_status_v` が正。旧 `capability_line_items.inspected_amount_ex_tax` は移行前データのフォールバック用。横断検索(`/api/conditions/search`)は両者を行単位で統合して返す（新優先）。
- **継続型（subscription/royalty）** は「成就/未了」ではなく期間ステータス（active/expired）と発行予定（`condition_line_schedule_v`）で管理。
- search-API は読み取り専用。データ更新は admin-ui / worker 経由で行われます。
