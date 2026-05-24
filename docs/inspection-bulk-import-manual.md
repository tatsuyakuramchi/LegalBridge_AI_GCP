# 検収書一括作成マニュアル

最終更新: 2026-05-24  
対象機能: 過去文書 DB 登録 > 個別伝票 > 検収書

## 1. 概要

検収書一括作成は、Backlog の「トリガー待ち」ステータスにある「納品・検収」課題を抽出し、発注書 DB と紐づけた CSV を作成して、検収書データをまとめて登録する機能です。

主な流れは次の通りです。

1. Backlog 側で検収対象課題を「トリガー待ち」にする
2. Admin UI で「トリガー待ち CSV」を抽出する
3. CSV を確認・補正する
4. 右上の「CSV 一括インポート」から検収書として取り込む
5. PDF 未作成キューで PDF 生成を確認する

## 2. 前提条件

Backlog 側に次の設定が必要です。

| 項目 | 必要な値 |
|---|---|
| ステータス | トリガー待ち |
| 課題種別 | 納品・検収 |

LegalBridge 側には、親となる発注書が先に登録されている必要があります。CSV 抽出時は、検収課題の親課題キー、または課題本文内の課題キーから発注書を探します。

## 3. 画面の場所

1. Admin UI を開く
2. 「過去文書 DB 登録」を開く
3. 「個別伝票」行の「検収書」タブを選択する
4. 「トリガー待ち CSV を抽出」をクリックする

CSV ファイル名は `inspection_trigger_waiting_<timestamp>.csv` 形式でダウンロードされます。

## 4. CSV 抽出の仕様

抽出対象は次の条件を満たす Backlog 課題です。

| 条件 | 内容 |
|---|---|
| ステータス | トリガー待ち |
| 課題種別 | 納品・検収 |
| 最大件数 | 100 件、API 上限は 500 件 |
| 並び順 | 更新日時の新しい順 |

抽出時に LegalBridge は親発注書を探し、発注書明細が見つかる場合は明細単位で CSV 行を出力します。親発注書または明細が見つからない場合でも、検収課題の基本情報を 1 行出力します。この場合は CSV 上で親発注書情報や明細情報を補正してください。

## 5. CSV 列定義

| 列名 | 必須 | 説明 |
|---|---:|---|
| import_key | 必須 | 一括取込時のグループキー。同じ検収書にしたい行は同じ値にします。通常は検収課題キーです。 |
| issue_key | 必須 | 検収書に紐づける Backlog 課題キーです。 |
| parent_po_issue_key | 条件付き | 親発注書の Backlog 課題キーです。`parent_po_id` または `parent_po_number` があれば省略可です。 |
| parent_po_id | 条件付き | LegalBridge DB 内の親発注書 ID です。最も確実な紐づけキーです。 |
| parent_po_number | 条件付き | 親発注書の文書番号です。`parent_po_id` または `parent_po_issue_key` があれば省略可です。 |
| document_number | 任意 | 検収書番号です。空欄の場合は自動採番されます。 |
| document_date | 任意 | 検収書の日付です。空欄の場合は取込日になります。 |
| delivered_at | 任意 | 納品日です。空欄の場合は取込日になります。 |
| inspection_completed_at | 任意 | 検収完了日です。 |
| payment_due_date | 任意 | 支払予定日です。 |
| staff_email | 任意 | 担当者メールアドレスです。staff マスタに一致すると部署・氏名が補完されます。 |
| counterparty | 任意 | 取引先名です。空欄の場合は親発注書の取引先名を使用します。 |
| vendor_code | 任意 | 取引先コードです。 |
| description | 任意 | 件名・摘要です。空欄の場合は親発注書または Backlog 課題の件名を使用します。 |
| tax_rate | 任意 | 税率です。空欄の場合は親発注書の税率、さらに空欄なら 10 を使用します。 |
| delivery_no | 任意 | 納品回数です。空欄の場合は親発注書ごとの次番号を自動採番します。 |
| generate_pdf | 任意 | PDF 生成対象にするか。空欄または `true` 相当なら PDF 未作成キューに入ります。 |
| remarks | 任意 | 備考です。納品イベントの note に保存されます。 |
| CHANGE_RECORDS | 任意 | PDF の「変更履歴（当初発注条件からの変更）」に出力する変更履歴です。形式は `日付|項目名|変更前|変更後|理由`。複数件は `;` 区切りです。 |
| row_type | 任意 | 明細行種別です。通常は `item`。`expense` は検収書取込では対象外です。 |
| line_no | 条件付き | 親発注書の明細行番号です。`order_line_item_id` があれば省略可です。 |
| order_line_item_id | 条件付き | 親発注書明細 ID です。最も確実な明細紐づけキーです。 |
| item_name | 任意 | CSV 確認用の品目名です。取込時は親発注書明細の値が優先されます。 |
| spec | 任意 | CSV 確認用の仕様です。取込時は親発注書明細の値が優先されます。 |
| inspected_quantity | 必須 | 今回検収する数量です。 |
| acceptance_ratio | 任意 | 検収率です。空欄の場合は `1` です。半分検収なら `0.5` を入力します。 |

親発注書の特定には、`parent_po_id`、`parent_po_issue_key`、`parent_po_number` のいずれかが必要です。明細の特定には、`order_line_item_id` または `line_no` が必要です。

## 6. CSV 補正ルール

### 親発注書が空欄の場合

`parent_po_issue_key`、`parent_po_id`、`parent_po_number` のいずれかを入力してください。

推奨順は次の通りです。

1. `parent_po_id`
2. `parent_po_issue_key`
3. `parent_po_number`

### 明細が空欄の場合

発注書明細に対応する `line_no` または `order_line_item_id` を入力してください。明細が特定できない行は取込対象にならず、その検収グループは失敗します。

### 分割検収の場合

同じ親発注書に対して複数回検収する場合は、`delivery_no` を分けます。

例:

| import_key | delivery_no | line_no | inspected_quantity |
|---|---:|---:|---:|
| ARC-2001 | 1 | 1 | 5 |
| ARC-2002 | 2 | 1 | 3 |

`delivery_no` を空欄にした場合、既存の最大納品回数 + 1 が自動採番されます。

### 一部検収の場合

数量で分ける場合は `inspected_quantity` を調整します。金額按分したい場合は `acceptance_ratio` を使用します。

例:

| inspected_quantity | acceptance_ratio | 意味 |
|---:|---:|---|
| 10 | 1 | 数量 10 を全額検収 |
| 10 | 0.5 | 数量 10 の 50% 金額を検収 |
| 5 | 1 | 数量 5 を全額検収 |

## 7. 一括インポート手順

1. 画面右上の「CSV 一括インポート」をクリックする
2. 種別で「検収書」を選択する
3. 補正済み CSV を選択する
4. プレビュー結果を確認する
5. エラーがなければ本取込を実行する

取込が成功すると、次のデータが登録・更新されます。

| 登録先 | 内容 |
|---|---|
| documents | `template_type = inspection_certificate` の検収書データ |
| delivery_events | 納品・検収イベント |
| delivery_line_items | 検収明細 |
| legal_requests | 検収課題と親発注課題の紐づけ |

同じ `document_number` が既に存在する場合は、既存文書を更新します。同じ `issue_key` と `delivery_no` の納品イベントが既に存在する場合も更新扱いになります。

## 8. PDF 生成

`generate_pdf` が空欄、`true`、`作成済` 以外の PDF 生成対象値の場合、登録された文書の `form_data.__pdf_pending` が true になり、PDF 未作成キューに入ります。

PDF 生成の確認手順:

1. 「PDF 生成」行の「PDF 未作成キュー」を開く
2. 対象の検収書が表示されていることを確認する
3. PDF 生成を実行する
4. 生成後、文書詳細で PDF リンクを確認する

PDF を作成したくない場合は、CSV の `generate_pdf` に `false` を入力してください。

## 9. よくあるエラー

### HTTP 404

主な原因は次のいずれかです。

| 原因 | 対処 |
|---|---|
| worker が未デプロイ | `release/worker` に最新コミットが反映されているか確認します。 |
| Backlog ステータスがない | Backlog に「トリガー待ち」ステータスが存在するか確認します。 |
| Backlog 課題種別がない | Backlog に「納品・検収」課題種別が存在するか確認します。 |

### parent PO not found

親発注書が特定できていません。CSV の `parent_po_id`、`parent_po_issue_key`、`parent_po_number` のいずれかを補正してください。

### No valid inspection line rows

検収明細として有効な行がありません。`row_type` が `item` になっているか、`line_no` または `order_line_item_id` が親発注書明細に一致しているか確認してください。

### Inspection overflow

既に検収済みの数量または金額を超過しています。発注書明細の残数量、過去の検収履歴、`inspected_quantity`、`acceptance_ratio` を確認してください。

### staff_email で担当者が補完されない

staff マスタに該当メールアドレスが登録されていない可能性があります。登録がない場合でも取込はできますが、部署・氏名は空欄になります。

## 10. 運用上の注意

- CSV は Excel で開けるように UTF-8 BOM 付きで出力されます。
- 1 つの `import_key` が 1 つの検収書グループです。
- 同じ検収書に複数明細を入れる場合は、同じ `import_key` を使います。
- 親発注書に存在しない明細は取り込めません。
- 発注数量・金額を超える検収はブロックされます。
- CSV 抽出後に Backlog 側のステータスが変わっても、取込済み CSV の内容は自動更新されません。必要に応じて再抽出してください。

## 11. 管理者向け API

画面操作の裏側では次の API を使用します。

| 用途 | Method | Path | 実装 |
|---|---|---|---|
| トリガー待ち CSV 抽出 | GET | `/api/imports/bulk/inspection/trigger-waiting.csv` | `services/worker/server.ts` |
| 検収書一括取込 | POST | `/api/imports/bulk/inspection` | `services/worker/server.ts` |
| 検収書 CSV テンプレート | GET | `/api/imports/bulk/templates/inspection` | `services/worker/server.ts` |

GET の CSV 抽出 API は worker 側にルーティングされます。Admin UI のビルドでは `src/lib/apiRouter.ts` の `WRITE_PATHS_ON_GET` により、該当パスが `VITE_API_WRITE_URL` へ送られます。
