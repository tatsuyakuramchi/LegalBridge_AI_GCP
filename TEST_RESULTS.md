# システムテスト報告書 (Test Report)

**実施日:** 2026-04-28
**テスター:** AI Coding Agent
**対象:** 契約管理・帳票生成システム

---

## 1. テストシナリオと実施結果

### カテゴリA：過去契約書・発注書の管理 (External Assets)
| ID | テストシナリオ | 期待値 | 結果 | 備考 |
|---|---|---|---|---|
| A-1 | 締結済書類の新規登録 | 入力した情報（書類名、相手方、リンク等）がDBに保存されること | **PASS** | `POST /api/management/assets` |
| A-2 | アーカイブ一覧表示 | 登録済みの書類が作成日降順で表示されること | **PASS** | UI上でのカード表示を確認 |

### カテゴリB：データの紐付け連携 (Relational Linking)
| ID | テストシナリオ | 期待値 | 結果 | 備考 |
|---|---|---|---|---|
| B-1 | 成果物(Delivery)へのPO紐付 | 納品イベントに対し、過去の発注書(PO)番号を関連付けられること | **PASS** | `linked_asset_id` の更新を確認 |
| B-2 | ライセンス条件への契約紐付 | ライセンス契約に対し、過去の個別利用許諾条件書を関連付けられること | **PASS** | `linked_asset_id` の更新を確認 |

### カテゴリC：帳票生成エンジン (Document Generation)
| ID | テストシナリオ | 期待値 | 結果 | 備考 |
|---|---|---|---|---|
| C-1 | 検収書へのPO番号反映 | 生成された検収書PDFに関連発注書番号が印字されること | **PASS** | `{{linked_po_number}}` |
| C-2 | 利用許諾計算書への契約番号反映 | 生成された帳票に個別契約番号が印字されること | **PASS** | `{{linked_terms_number}}` |
| C-3 | 振込先情報の参照 | ベンダーマスタの `account_number` が正しく取得・印字されること | **PASS** | カラム名修正済み |

### カテゴリD：APIエンドポイントの健全性 (API Integrity)
| ID | テスト内容 | 検証方法 | 結果 | 備考 |
|---|---|---|---|---|
| D-1 | 帳票コンテキスト取得 | `GET /api/backlog/issues/.../form-context` | **PASS** | SQLの500エラー解消を確認 |
| D-2 | 紐付け実行API | `POST /api/management/link-asset` | **PASS** | 各タイプ別の正常レスポンスを確認 |

---

## 2. 実装上の修正ログ (Bug Fixes Found During Testing)

- **DBカラム不整合の修正**: `vendors` テーブルのカラム名誤認（`account_no` → `account_number`）による500エラーを解消。
- **マッピング調整**: 帳票側で期待されるキー（`accountNo`, `accountHolder`）に合わせてDBからの取得値を整理。

---

## 3. 津國スモークテスト (Smoke Test Results)

**ステータス:** 🟢 **ALL PASS**

| 機能 | 確認項目 | 結果 | 備考 |
|---|---|---|---|
| API整合性 | `individual_license_terms` 取得時の500エラー解消 | **PASS** | SQLのJoin条件不備（vendor_code）を修正 |
| 紐付け機能 | 納品イベント・ライセンス契約へのアセット紐付け | **PASS** | `POST /api/management/link-asset` 動作確認 |
| 帳票表示 | 紐付け情報のテンプレート反映（{{linked_po_number}} 等） | **PASS** | 反映ロジックと初期値設定を確認 |

---

## 4. 総合評価
基本的なデータ登録・紐付け・帳票反映のフローは正常に動作しています。報告のあった500エラー（内部サーバーエラー）は、データベースのカラム名不整合およびSQLの結合キー誤記が原因であり、すべて修正・検証済みです。

---

## 5. Phase 23 — 統一スキーマ移行 検証計画

**対象:** `order_items` / `license_contracts` → `contract_capabilities` 系への一本化。
親契約 picker と インポート API の統一化。

### 5.1 マイグレーション検証

```bash
# (1) 件数事前確認 (dry-run)
tsx scripts/phase23_migrate_to_capabilities.ts

# (2) 実マイグレーション (DROP なし)
tsx scripts/phase23_migrate_to_capabilities.ts --apply

# (3) 件数・整合性確認後 旧テーブル DROP
tsx scripts/phase23_migrate_to_capabilities.ts --apply --drop
```

### 5.2 検証SQL（マイグレーション後に必須）

```sql
-- A. record_type 別の件数 (purchase_order が新規分追加されているはず)
SELECT record_type, contract_category, COUNT(*) FROM contract_capabilities
 GROUP BY 1, 2 ORDER BY 1, 2;

-- B. 旧 order_items 件数 = 新 PO capability 件数 (移行直後)
SELECT
  (SELECT COUNT(*) FROM order_items) AS old_orders,
  (SELECT COUNT(*) FROM contract_capabilities WHERE record_type='purchase_order') AS new_po;

-- C. 子テーブル件数の照合
SELECT
  (SELECT COUNT(*) FROM order_line_items) AS old_lines,
  (SELECT COUNT(*) FROM capability_line_items
    WHERE capability_id IN (SELECT id FROM contract_capabilities WHERE record_type='purchase_order')) AS new_lines;

-- D. delivery_events の FK 張替確認 (capability_id が埋まっている)
SELECT COUNT(*) AS unlinked
  FROM delivery_events
 WHERE capability_id IS NULL;

-- E. 検収集計の整合性 (新 capability_line_items.inspected_amount_ex_tax)
SELECT cli.id, cli.amount_ex_tax, cli.inspected_amount_ex_tax,
       cli.amount_ex_tax - cli.inspected_amount_ex_tax AS remaining
  FROM capability_line_items cli
 WHERE cli.inspected_amount_ex_tax > cli.amount_ex_tax;  -- 0 行であるべき
```

### 5.3 UI スモークテスト

| ID | シナリオ | 期待結果 |
|---|---|---|
| 23-A1 | 検収書フォームで「親契約を選ぶ」を押す | UnifiedContractPicker が開き、purchase_order + individual_contract + standalone_contract (service) が候補に出る |
| 23-A2 | バルクインポートで `service-contract` 経由で登録した契約が ParentPoPicker 跡地から見えるか | 候補に表示される（食い違い解消の検証） |
| 23-A3 | 検収書を選択し PDF 発行 | 親契約番号・取引先・明細が正しく PDF に転記される |
| 23-B1 | 利用許諾料計算書で「ライセンス契約を選ぶ」を押す | UnifiedContractPicker (license カテゴリ) が開く |
| 23-B2 | 計算書 PDF 発行 | rate_pct / mg_amount / ag_amount が反映される |
| 23-C1 | 発注書で「業務委託基本契約を選ぶ」を押す | UnifiedContractPicker (master_contract / service) が開く |
| 23-D1 | バルクインポート(service-contract) | `/api/imports/v2/bulk` に届き、contract_capabilities + capability_line_items に upsert |
| 23-D2 | CSV テンプレ DL | `/api/imports/v2/templates?record_type=X` が UTF-8 BOM 付き CSV を返す |

### 5.4 ロールバック手順

マイグレーションは単一トランザクション。失敗時は ROLLBACK されるので DB は touch されない。
`--drop` 後に問題が判明した場合は復旧不能 (DROP TABLE が含まれる) ため、`--apply` のみで動作確認してから `--drop` を実行すること。

### 5.5 既知の制約

- `inspection` / `ringi` のバルクインポートは v2 対象外 (別テーブル運用) のため旧 API を継続使用
- 旧 `/api/order-items/list` / `/api/imports/bulk/order` 等は DEPRECATED マーク付きで残置。Phase 23.1 で削除予定
- `ledgers` / `materials` (作品マスタ) は統一対象外。`individual_license_terms` フォームの ledger/material セレクタは現状維持

