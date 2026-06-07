# サブライセンス条件明細(OUT) → 請求明細 → 受領 連結 設計メモ

> 目的: 「サブライセンス条件明細から請求明細へつなげ、サブライセンス料／プロダクトアウト料を
> 受領したら情報を入れる」流れ(受領＝OUT側の収益管理)を、work_id 一本で連結する設計を整理する。
> 本メモは **設計合意用**。実装は合意後に着手。

作成: 2026-06-07

---

## 1. ユーザーの想定フロー

```
サブライセンス条件明細(OUT)
   ▼  (各期に展開)
請求明細（受領予定）
   ▼  (サブライセンス料 / プロダクトアウト料を受領したら入力)
受領記録（入金）
```

- 条件 = 料率／基準価格／プロダクトアウト等(OUT＝当社が受け取る)。
- 請求明細 = 各期の受領予定(請求権)。
- 受領記録 = 実際に受領した金額(入金台帳)＋必要なら利用許諾料計算書。

---

## 2. 現状の実体マップ（既にあるもの）

受領(OUT)側は **2 系統が並走** しており、まだ繋がっていない。

### (A) 既存「サブライセンス受領」モジュール（自己完結）
| 役割 | 実体 | 場所 |
|---|---|---|
| 条件 | `sublicense_deals`（料率/MG/前払(AG)/基準/周期/期間, work_id×sublicensee） | `0019` / `/api/sublicense/deals` |
| 受領報告(実績) | `sublicense_sales_reports`（period_date, reported_sales, reported_quantity） | `0020` / `/api/sublicense/reports` |
| 受領予定+実績 | 算出ビュー | `/api/sublicense/receipts` |
| 受領確定→入金 | `payments`（`direction=inbound`, `payment_kind=sublicense_income`） | `sublicenseService` 受領確定 |
| 計算書 | `royalty_statements`（`calc_type=sublicense`・「被許諾者受領額」ベース） | 利用許諾料計算書テンプレ |

### (B) 新「作品モデル」条件明細（2.18 で追加）
| 役割 | 実体 | 場所 |
|---|---|---|
| 条件 | `capability_financial_conditions.condition_kind='sublicense_out'`（work_id, source_work_id, 料率, 計算式…） | `0041` / `/api/v3/works/:id/conditions` |

→ **(B) はまだ請求・受領に繋がっていない**。(A) と概念が重複している。

### 関連: 方向(IN/OUT)概念が複数箇所にある（要整理）
- `capability_financial_conditions.condition_kind` = `license_in` / `sublicense_out`（**今回追加・金銭条件の方向**）
- `capability_line_items.flow_direction` = `in`(当社支払) / `out`(当社受領, `is_inbound`)（**伝票明細＝請求権の方向**）
- `payments.direction` = `inbound`(受領) / `outbound`(支払)
- `invoices.direction` = `issued`(発行＝入金側) / `received`(受領＝支払側)

「請求明細」は意味的に **`capability_line_items` の `flow_direction='out'`（請求権明細）** または `invoices(issued)` に対応する。

---

## 3. 目標モデル（条件明細(OUT)を SSOT に）

```
サブライセンス条件明細(OUT)                     ← capability_financial_conditions(condition_kind='sublicense_out')
  ├ 料率 / プロダクトアウト / MG / 前払(AG) / 周期 / 期間   (sublicense_deals の条件部分を吸収)
  ├ work_id(自社作品) / sublicensee(取引先) / source_work_id(原資の原作IP・任意)
  ▼  各期に展開
請求明細（受領予定）                             ← 受領予定スケジュール(請求権)。capability_line_items(flow_direction='out') 候補
  ├ period / 予定額 / 請求書発行(任意=invoices(issued))
  ▼  受領したら入力
受領記録                                         
  ├ 受領報告(実績売上/数量)                      ← sublicense_sales_reports 相当
  ├ payments(inbound, sublicense_income)         ← 入金台帳(受領額)
  └ royalty_statements(calc_type=sublicense)     ← 利用許諾料計算書(任意発行)
```

ポイント:
- **条件の SSOT を `capability_financial_conditions(sublicense_out)` に一本化**し、`sublicense_deals` をそこへ寄せる(段階移行)。
- 受領予定→受領実績→入金は **既存パイプ(sales_reports / payments inbound / royalty_statements)を再利用**。
- 「請求明細」を明示エンティティにするか(=invoices(issued) or 受領予定テーブル)は §6 で決定。

---

## 4. データ連結（案）

条件明細(OUT) を起点に以下の FK/参照で繋ぐ:

- `capability_financial_conditions`(OUT) に **受領先(sublicensee) と 周期/期間** を持たせる
  （`sublicense_deals` 相当の項目を additive 追加: `counterparty_vendor_id`/`cycle`/`term_start`/`term_end`/`mg_amount`/`advance_amount` は既存列で大半カバー、不足分のみ追加）。
- 受領報告 `sublicense_sales_reports` に **`condition_id`(→capability_financial_conditions)** を additive 追加（既存 `deal_id` と併存→移行）。
- `payments`(inbound) に既存の `financial_term_id` があるが、新条件は `capability_financial_conditions` なので
  **`capability_financial_condition_id`** で受領を条件に紐付け（royalty_calculations 同様の FK パターン）。
- `royalty_statements` は既存 `financial_term_id` に加え、必要なら `capability_financial_condition_id` 参照を追加。

> いずれも additive・冪等マイグレーションで、既存(A)を壊さず並走→移行できる。

---

## 5. プロダクトアウト料 / サブライセンス料 の区別

両方とも OUT(受領)。条件明細内で区別:
- `region_language_label` または `condition_no`（BDGプリセット: 1=自社製造, 2=サブライセンス, 3=プロダクトアウト）。
- 受領種別タグ(任意): `calc_method`/ラベルで「サブライセンス料」「プロダクトアウト料」を表示。
- 計算書・入金の `payment_kind` は両方 `sublicense_income` でよいか、`productout_income` を分けるかは §6。

---

## 6. 決定事項（2026-06-07 確定）

1. **「請求明細」**: 🔵 **数字計算ができればOK。請求書(invoices)の文書発行は不要。**
   → 軽量な「受領予定/受領記録(計算のみ)」で実装。`invoices(issued)` は使わない。
2. **`sublicense_deals`(A)**: 🔵 **条件明細(OUT)へ移行して廃止。現状データ無し → 一気に刷新。**
   → `capability_financial_conditions(condition_kind='sublicense_out')` を条件SSOTにし、`sublicense_deals`/`sublicense_sales_reports` は撤去。
3. 受領種別（プロダクトアウト料 vs サブライセンス料）: 条件明細の `condition_no`/ラベルで区別（台帳 `payment_kind` は当面 `sublicense_income` 一本で可）。
4. 計算根拠: `basis`='sales'(報告売上×料率) / 'manufacturing'(報告数量×単価) の両対応。
5. MG/AG: 受領でも MG(floor)/AG(前払相殺) を将来踏襲（Phase で対応）。

### 安全な刷新順（重要）
旧モジュールは migrations 0019–0026・sublicenseService・receivableMapService・server.ts(~250行)・
フロント複数画面に**深く依存**。一括削除はビルド破壊リスクが高いため、
**「新フローを additive で先に作る → 依存(receivableMap/dataLinkage)を新条件明細へ寄せる → 旧 deals 撤去」** の順で、各段デプロイをグリーンに保つ。

---

## 7. 実装フェーズ（確定）

- **P1（本実装・additive）**: 
  - 条件明細(OUT)に受領用カラム追加（`counterparty_vendor_id`/`basis`/`cycle`/`billing_day`/`term_start`/`term_end`/`advance_amount`/`forecast_amount`）。
  - **受領記録テーブル `condition_receipts`**（condition_id 紐付け・period/報告売上/報告数量/計算royalty/受領額/受領日）を新設。
  - API `/api/v3`: 条件 write に OUT 項目追加 + 受領記録 CRUD（計算込み: royalty = 報告売上×料率 or 報告数量×単価）。
  - UI: 自社作品詳細に **受領記録エディタ**（条件ごとに period 行＋数字計算）。
- **P2（完了）**: 受領→`payments(inbound, sublicense_income)`台帳連携（受領記録 upsert/delete で payments を同期）。
  `receivableMap`(分配マップ)の下流受領を `sublicense_deals`(listDeals) → `condition_kind='sublicense_out'` + `condition_receipts` へ寄せ替え。
- **P3（完了・撤去）**: 旧モジュールを撤去。
  - search-api: `/api/sublicense/*`・`/master/sublicense`・利用報告CSV取込ルート、`sublicenseService.ts`・`sublicenseHtml.ts`・`usageReportImportService.ts` を削除。
  - admin-ui: `SublicensePanel` ・ナビ「請求権(受領)」・WorkModelPanel の deals インボックス/受領条件リンクを削除。
  - nav/screen: masterChrome・adminDashboard・screens から `sublicense` を除去。
  - worker: dataLinkage の sublicense_deals 孤児チェック/修復を除去。vendorMasterService の参照ラベルを除去。
  - migration `0043`: `sublicense_sales_reports` / `sublicense_deals` を DROP（`payments.sublicense_deal_id` も撤去）。
  - ※ `sublicensees`(サブライセンシー マスタ) / `work_sublicensees` は別物のため**残置**。

> 受領フローは「サブライセンス条件明細(OUT) → 受領記録(condition_receipts・計算) → 入金台帳(payments inbound)／分配マップ」に一本化済み。
