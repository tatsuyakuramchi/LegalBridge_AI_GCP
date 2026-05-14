# LegalOn 契約台帳 CSV 取り込み運用ガイド (Phase 17x)

## 概要

LegalOn Cloud から出力される契約書台帳 CSV を、LegalBridge の `contract_capabilities` テーブルに取り込む機能。法務検索 (`/search/vendor`) で「基本契約」「個別契約」「その他」として表示されるようになる。

実装は `legalbridge-search-api` サービス内に閉じている (Phase 17t-w: Option A)。worker / admin-ui は触らない。

## アーキテクチャ

```
LegalOn Cloud
    ↓ CSV エクスポート (xlsx → CSV)
ブラウザ (管理者)
    ↓ /imports/legalon にアクセス (HMAC 短期署名 URL 必須)
search-api (legalbridge-search-api)
    ↓ POST /api/imports/legalon-csv
    ↓ papaparse でパース
    ↓ vendors マスタと突合 (in-memory index)
    ↓ contract_capabilities に UPSERT
    ↓ 結果サマリ JSON 返却
ブラウザに結果表示
```

## 使い方

### Step 1: LegalOn から CSV エクスポート

LegalOn Cloud の契約書台帳画面で:
1. フィルタを必要に応じて設定 (期間・契約類型 等)
2. 「エクスポート」→ Excel ファイル (.xlsx) を取得
3. Excel で開いて **CSV (UTF-8)** として保存し直す

または、LegalOn API 直接取得もあり (今回未対応)。

### Step 2: 取り込み URL を発行

`/imports/legalon` は HMAC 短期署名 URL 必須 (Phase 17s)。Cloud Shell で:

```bash
# Secret Manager から鍵を取得
SECRET=$(gcloud secrets versions access latest --secret=LB_SIGNING_SECRET)

# 10 分間有効な署名 URL を作成
EXP=$(($(date +%s) + 600))
SIG=$(printf '%s' "imports:legalon.$EXP" \
      | openssl dgst -sha256 -hmac "$SECRET" -binary \
      | openssl base64 \
      | tr -d '=' | tr '/+' '_-')

API_URL=$(gcloud run services describe legalbridge-search-api \
  --region asia-northeast1 \
  --format='value(status.url)')

echo "$API_URL/imports/legalon?exp=$EXP&sig=$SIG"

unset SECRET SIG EXP
```

ブラウザで開いて取り込みフォームが表示されることを確認。

### Step 3: Dry Run で確認

1. CSV ファイルを選択
2. **「Dry Run」チェックは ON のまま** (デフォルト)
3. 「取り込み開始」をクリック
4. 結果画面で以下を確認:
   - **Total**: CSV の総行数 (= 取り込み対象数)
   - **Would Succeed**: 成功予測数
   - **Failed**: エラー予測数
   - **Multi-Party**: 3 者以上の契約数
   - **Unresolved Vendors**: vendors マスタと突合できなかった取引先数
   - **プレビュー表**: 上から 200 行までの取り込み内容
   - **エラー表**: 失敗予測の理由

### Step 4: 本番取り込み

Dry Run の結果に問題なければ:
1. **「Dry Run」チェックを外す**
2. 「取り込み開始」をクリック
3. 結果画面で **「Succeeded」** カウントを確認

### Step 5: 法務検索で確認

Slack `/法務検索 [取引先名]` で実行 → 結果モーダル → Web 詳細 → 該当の契約が「基本契約」または「個別契約」セクションに表示されることを確認。

## CSV 列マッピング

LegalOn CSV → LegalBridge `contract_capabilities`:

| LegalOn 列 | LegalBridge | 必須？ | 備考 |
|---|---|---|---|
| 管理番号 | `document_number` | ✅ 必須 | 主キー。空ならスキップされる |
| 契約書タイトル | `contract_title` + 類型推定 | ✅ 必須 | タイトル文字列から契約類型を推定 |
| 契約類型, 立場 | 類型推定の補助情報 | 任意 | タイトルと組み合わせて推定 |
| 取引先名 | `vendor_id` (主) + `additional_parties` JSONB | ✅ 必須 | カンマ区切りで 3+ 者契約対応 |
| 取引先コード | `vendor_id` 解決の優先キー | 任意 | あれば高速・確実 |
| 契約締結日 | `effective_date` | 任意 | `契約開始日` でフォールバック |
| 契約開始日 | `effective_date` (fallback) | 任意 | |
| 契約終了日 | `expiration_date` | 任意 | |
| 自動更新 | `auto_renewal` | 任意 | "あり"/"なし" を真偽値に |
| 契約状況 | `contract_status` | 任意 | デフォルト "executed" |
| URL | `legalon_url` | 推奨 | 法務検索からの遷移リンク |
| ファイル名 | (取り込み対象外) | — | 参照情報のみ |

**取り込み対象外** の列: 保存先 / 担当者 / 取引金額 / 関連契約書 / 特記事項 / 伝票番号(1..10) / その他多数 (= ノイズ・内部運用情報のため除外)

## 3 者契約の扱い

LegalOn の `取引先名` 列に **カンマ区切り** で複数社を入れる:

```
取引先名: 「株式会社 A, 株式会社 B, 株式会社 C」
```

→ DB には:
- `vendor_id` = 株式会社 A の id (主取引先)
- `additional_parties` = `[{"name": "株式会社 B", "vendor_id": 102, "role": "secondary"}, {"name": "株式会社 C", "vendor_id": 103, "role": "secondary"}]`

法務検索は `vendor_id` + `additional_parties @> '[{"vendor_id": N}]'` で OR 検索するので、**B 社 / C 社いずれで検索しても** この契約がヒットする。

区切り文字: 半角カンマ・全角カンマ・読点・中黒・改行 すべて対応。

## 取引先解決の優先順

1. **`取引先コード`** で `vendors.vendor_code` 完全一致 (最優先)
2. **`取引先名`** で `vendors.vendor_name` 完全一致
3. **`取引先名`** で `vendors.trade_name` / `pen_name` 完全一致
4. 全部 miss → `vendor_id = NULL` で登録 (法務検索ヒットなし、後で resync で救済可能)

## 重複時の動作 (duplicate_mode)

| モード | 動作 | 用途 |
|---|---|---|
| **overwrite** (デフォルト) | LegalOn 値で全項目 UPDATE | 最新状態への同期 |
| **skip** | 既存行はスキップ、新規だけ INSERT | 増分取り込み |
| **fill_only** | 既存の NULL 項目だけ補完 | 既存の手動編集を保護 |

## エラー対応

### 「管理番号 が空です」

LegalOn 側で管理番号未設定の行。LegalOn 上で管理番号を補完するか、無視 (取り込みできない)。

### 「取引先名 が空です」

LegalOn 側で取引先名未設定の行。同上、LegalOn 側で補完。

### 「主取引先 "X社" が vendors マスタに未登録」 (warning)

取り込みは成功するが `vendor_id = NULL` 状態。法務検索でこの取引先名で検索してもヒットしない。

対処:
1. Admin UI で vendors マスタに該当取引先を追加
2. 取り込み後に resync (worker 側):
   ```bash
   curl -X POST "$WORKER_URL/api/admin/resync-contract-capabilities" \
     -H "Content-Type: application/json" -d '{}'
   ```

### "2 つ目以降の取引先の一部が vendors マスタに未登録" (warning)

3 者契約の secondary party が vendors マスタに無い場合。`additional_parties` には `vendor_id: null` で記録される。同上で対処。

## 監査ログ

Cloud Logging で取り込み履歴を確認:

```
jsonPayload.evt="legalon_import"
```

例:
```json
{
  "evt": "legalon_import",
  "dry_run": false,
  "duplicate_mode": "overwrite",
  "total": 1983,
  "succeeded": 1850,
  "failed": 12,
  "skipped": 0,
  "multi_party": 27,
  "unresolved_vendors": 121,
  "ts": "2026-05-14T08:00:00.000Z"
}
```

## DB スキーマ変更

Phase 17x で追加:
```sql
ALTER TABLE contract_capabilities
  ADD COLUMN IF NOT EXISTS additional_parties JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_capabilities_additional_parties
  ON contract_capabilities USING GIN (additional_parties);
```

`legalbridge-search-api` のデプロイで自動的に migration が走る。

## ロールバック

万が一の取り込みミスは:

1. **直近の取り込みだけ消す**:
   ```sql
   DELETE FROM contract_capabilities
   WHERE source_system = 'LegalOn Import'
     AND updated_at >= '<取り込み開始時刻>';
   ```

2. **全 LegalOn 取り込み分を消す**:
   ```sql
   DELETE FROM contract_capabilities
   WHERE source_system = 'LegalOn Import';
   ```

これで CSV を直して再取り込みできる。
