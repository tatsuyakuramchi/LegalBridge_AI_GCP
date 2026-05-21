# LegalBridge search-api 操作マニュアル

最終更新: 2026-05-21 / Phase 22.21.42

本マニュアルは **`legalbridge-search-api`** (Cloud Run サービス) の運用・操作を網羅します。
法務 / 経営管理本部 のメンバーがブラウザから利用する管理画面と、それを支える認証・取込・障害対応の手順をまとめています。

> 関連ドキュメント
> - 認証アーキテクチャ詳細: [`docs/security-phase-17s.md`](./security-phase-17s.md)
> - LegalOn インポート詳細: [`docs/legalon-import-runbook.md`](./legalon-import-runbook.md)

---

## 1. クイックスタート

### 入口 URL

| 用途 | URL |
|---|---|
| **ポータル**(全員) | <https://legalbridge.arclight.co.jp/> |
| 管理ダッシュボード(admin) | <https://legalbridge.arclight.co.jp/admin> |
| 検索 (取引先 / 契約) | <https://legalbridge.arclight.co.jp/search/vendor> |
| 検索 (稟議番号) | <https://legalbridge.arclight.co.jp/search/ringi/00001> |

> `*.run.app` 直 URL ではなく必ず `legalbridge.arclight.co.jp` を使ってください。
> `*.run.app` は IAP の手前で 401 になるよう構成されています。

### 初回アクセスの流れ

1. ブラウザで `https://legalbridge.arclight.co.jp/` を開く
2. Google アカウント (Workspace) で SSO ログイン
3. 自動的に判定:
   - **admin ロール** → `/admin` にリダイレクト
   - **viewer ロール (デフォルト)** → 検索案内ページ

---

## 2. ロールと権限

`staff.app_role` 列でユーザーごとに 2 段階のロールを管理します。

| ロール | 値 | できること |
|---|---|---|
| **admin** | `admin` | 管理ダッシュボード、CSV 取込、ロール変更、すべての検索 |
| **viewer** | `viewer` (デフォルト) | 取引先・契約検索、稟議番号検索のみ |

### admin 判定の優先順位

1. **`LB_APP_ADMIN_EMAILS` env (bootstrap)** — Cloud Run の環境変数にカンマ区切りで列挙されたメールアドレスは無条件で admin。DB が空・障害時の救済用。
2. **`staff.app_role = 'admin'`** — DB 上の値。`/admin/staff` から切り替え可能。
3. 上記いずれにもマッチしない → **viewer**。

### ロールを切り替える

1. admin で `/admin` を開く
2. 「👥 ユーザー権限管理」カード → 「スタッフ権限管理」タイル をクリック
3. `/admin/staff` で対象ユーザーを検索 → 「admin に昇格 / viewer に変更」ボタンをクリック
4. 確認ダイアログ → OK

> 👁 **Viewer 画面の確認**: admin から `/admin` > 「Viewer 用ポータルを開く」タイルを押すと、別タブで viewer 用ランディングをプレビューできます。

### 緊急時の救済 (DB に admin が 1 人もいない)

```bash
gcloud run services update legalbridge-search-api \
  --region asia-northeast1 \
  --update-env-vars LB_APP_ADMIN_EMAILS=youremail@arclight.co.jp
```

env 反映後は **すぐに** ログイン → `/admin/staff` から DB 側で admin を再付与し、env は元に戻すのが推奨です(env 由来の admin は監査ログに残らないため)。

---

## 3. ページ一覧

### 3.1 `/` ポータル
- admin → `/admin` に 302 リダイレクト
- viewer → 検索 URL を案内する静的ページ
- `?preview=viewer` を付けると admin もリダイレクトせず viewer 画面を表示(プレビュー用)

### 3.2 `/admin` 管理ダッシュボード (admin 限定)
ハブ画面。直接の機能はなくタイル経由で子ページへ遷移:

| セクション | リンク先 | 説明 |
|---|---|---|
| 👥 ユーザー権限管理 | `/admin/staff` | スタッフ一覧 + admin/viewer 切替 |
| 📥 データ取り込み | `/imports/legalon`, `/imports/vendor` | CSV 一括取込 |
| 🗂️ マスター CRUD | `/master/staff`, `/master/vendors`, `/master/contracts` | 個別レコード CRUD |
| 🔍 検索ポータル | `/search/vendor`, 稟議番号 prompt, viewer プレビュー | 検索系入口 |

### 3.3 `/admin/staff` スタッフ権限管理 (admin 限定)
- スタッフ一覧 (氏名・メール・部署・ロール)
- 検索ボックスで絞り込み
- 1 クリックで admin ↔ viewer を切り替え
- 右上「← Admin に戻る」リンクで `/admin` に戻れる

### 3.4 `/imports/legalon` LegalOn 契約台帳 CSV 取込 (admin 限定)
LegalOn Cloud の契約台帳をエクスポートした CSV を `contract_capabilities` に upsert。
詳細: [`docs/legalon-import-runbook.md`](./legalon-import-runbook.md)

**標準フロー**:
1. 「サンプル CSV をダウンロード」で雛形取得
2. LegalOn Cloud から契約台帳を CSV (UTF-8) でエクスポート
3. **Dry Run チェック ON** で「取り込み開始」 → プレビュー確認
4. 件数 / 契約類型 / 取引先解決状況をチェック
5. Dry Run を OFF にして再実行 → 本番取込

**重複モード**:
- `overwrite` — 既存を CSV の値で全列上書き(推奨)
- `skip` — 既存はスキップ、新規のみ追加
- `fill_only` — 既存の空欄列だけ CSV で埋める

### 3.5 `/imports/vendor` 取引先マスタ CSV 取込 (admin 限定)
`vendors` テーブルに upsert。`vendor_code` が主キー。

**必須列**: `vendor_code`, `vendor_name`
**任意列**: 住所 / 担当者 / 法人個人 / 電話 / メール 等(サンプル CSV 参照)

### 3.6 `/master/contracts` 契約マスタ (admin 限定)
`contract_capabilities` の閲覧・編集 UI。LegalOn 取込結果の検査・補正に使用。

### 3.7 `/master/vendors` 取引先マスタ (admin 限定)
`vendors` の個別 CRUD。新規 1 件追加、編集、削除。
一括登録は `/imports/vendor` を使用。

### 3.8 `/master/staff` スタッフマスタ (admin 限定)
`staff` の個別 CRUD + CSV 取込。**経営管理本部** または **法務** 部門のメンバーが操作対象。

### 3.9 `/search/vendor` 取引先・契約検索 (viewer/admin 共通)
- `?q=<取引先名>` で取引先名検索
- 契約類型・基本契約・個別契約を一覧表示
- Slack `/法務検索` から短期署名 URL 付きで開かれる経路もある(HMAC 経路は IAP 経由 + `exp`/`sig` 検証)

### 3.10 `/search/ringi/:no` 稟議番号検索 (viewer/admin 共通)
- 5 桁ゼロ詰めの稟議番号で詳細表示(例: `/search/ringi/00001`)
- admin ダッシュボードのタイルから prompt で番号入力可能

---

## 4. 認証アーキテクチャ

```
ユーザーブラウザ
    │ HTTPS
    ▼
[Cloud Load Balancer]  legalbridge.arclight.co.jp  (34.36.159.230)
    │
    ▼
[Identity-Aware Proxy (IAP)]  ── Workspace SSO ──> Google アカウント
    │  (JWT を Cloud Run に転送)
    ▼
[Cloud Run: legalbridge-search-api]
    │   ┌─────────────────────────────────┐
    │   │ requireIapUser 中間層         │
    │   │   - IAP JWT を再検証          │
    │   │   - req.user.email を設定     │
    │   │ requireAppRole 中間層         │
    │   │   - staff.app_role を参照     │
    │   │   - LB_APP_ADMIN_EMAILS bypass│
    │   └─────────────────────────────────┘
    ▼
Postgres (Cloud SQL)
```

### 重要な環境変数

| 変数 | 用途 |
|---|---|
| `IAP_ENFORCE` | `true` で IAP JWT 検証を有効化 |
| `GCP_PROJECT_NUMBER` | IAP JWT の audience 検証用 |
| `IAP_BACKEND_SERVICE_ID` | IAP audience の一部 |
| `LB_APP_ADMIN_EMAILS` | bootstrap admin (カンマ区切り) |
| `LB_PORTAL_SECRET` | admin-ui → search-api 内部呼出のための共有秘密 |
| `LB_SIGNING_SECRET` | HMAC 短期署名 URL の署名キー (Slack 経路用) |

### よくある 401 / 403

| 症状 | 原因 | 対処 |
|---|---|---|
| 401 (どのページでも) | `*.run.app` 直アクセス、または IAP 認証未通過 | `legalbridge.arclight.co.jp` で再アクセス、ログイン |
| 403 on `/admin` | viewer ロール (admin 権限なし) | 既存 admin に依頼して `/admin/staff` から昇格 |
| 403 on `/imports/*` | viewer ロール | 同上 |
| 403 + `<br>` がそのまま表示 | (Phase 22.21.39 で修正済み) | キャッシュクリア |

---

## 5. CSV 取込トラブルシュート

### 共通: Dry Run プレビューでエラーが出る
- 列名の typo (英語 / camelCase / 日本語のいずれかでマッピング) — サンプル CSV を再ダウンロードして列名比較
- 文字コードが UTF-8 ではない → Excel から「CSV UTF-8 (.csv)」で再エクスポート
- 必須列の欠落 → エラーメッセージで該当行・列を確認

### LegalOn: 「取引先未登録」が大量に出る
- 先に `/imports/vendor` で取引先を取込
- もしくは `/master/vendors` から手動で追加し、`vendor_code` を LegalOn 側と合わせる

### 取引先 CSV: vendor_code 衝突
- 重複モード `skip` でスキップ件数を確認
- 上書きしたい場合は `overwrite` で再実行

### 取込後にデータ反映されない
- Dry Run のチェックが ON のままだった可能性 → 結果バナーが「Dry Run モード」と表示されているか確認
- 反映されていれば「✅ 本番取り込み完了」と緑バナーが出る

---

## 6. デプロイと運用

### 構成

- **Cloud Run サービス**: `legalbridge-search-api` (region: `asia-northeast1`)
- **デプロイトリガー**: GitHub Actions が `release/worker` ブランチへの push を検知して自動デプロイ
- **ブランチ運用**: `release/api` → `main` → `release/worker` の順に fast-forward merge
- **ロードバランサ**: `34.36.159.230` (HTTPS, SSL 証明書 ACTIVE)
- **ドメイン**: `legalbridge.arclight.co.jp`

### マイグレーション

`services/worker/src/lib/db.ts` の `initDb()` が起動時に冪等な `CREATE TABLE / ALTER … IF NOT EXISTS` を実行します。
search-api 側の `db.ts` には `initDb` がありますが **実行されません** (search-api は read-mostly のため)。
スキーマ変更は必ず worker 側に書いてください。

### ログを見る

```bash
# search-api の直近 100 行
gcloud run services logs read legalbridge-search-api \
  --region asia-northeast1 --limit 100

# Cloud Logging Web UI
# https://console.cloud.google.com/logs/query?project=<PROJECT>
```

### サービスを一時停止する

```bash
# 0 インスタンスにスケール(IAP 経由のアクセスは全部 5xx)
gcloud run services update legalbridge-search-api \
  --region asia-northeast1 --max-instances 0
```

再開は `--max-instances 10` 等に戻すだけ。

---

## 7. よくある運用タスク

### 新しい管理者を追加する
1. 対象ユーザーが一度 `https://legalbridge.arclight.co.jp/` にアクセスしてログイン(`staff` レコードが無くても OK)
2. 別の admin が `/admin/staff` を開く
3. 対象ユーザーが一覧に出ていない場合 → `/master/staff` で先にスタッフレコードを作成
4. `/admin/staff` で「admin に昇格」ボタンをクリック

### 管理者を退任させる
1. `/admin/staff` で対象ユーザーの「viewer に変更」ボタンをクリック
2. (退職者の場合) `/master/staff` でスタッフレコード自体を削除も検討

### 法務以外の部門に CSV 取込を依頼する
- 推奨: その人を一時的に admin に昇格 → 操作後 viewer に戻す(操作は監査ログに残らないので注意)
- 非推奨: env `LB_APP_ADMIN_EMAILS` に追加 (反映に Cloud Run 更新が必要、戻し忘れリスク)

### 「Viewer の画面」を確認したい
- admin で `/admin` を開く → 「Viewer 用ポータルを開く」タイル → 別タブで開く
- もしくは URL に直接 `https://legalbridge.arclight.co.jp/?preview=viewer` を入力

---

## 8. リファレンス

### 内部 API エンドポイント(主要)

| エンドポイント | 用途 | 認可 |
|---|---|---|
| `GET /api/status` | ヘルスチェック | 制限なし |
| `GET /api/master/staff` | スタッフ一覧 JSON | IAP |
| `PATCH /api/master/staff/:email/role` | ロール切替 | admin |
| `POST /api/imports/legalon-csv` | LegalOn 取込 | admin |
| `POST /api/master/vendors/import-csv` | 取引先一括取込 | admin |
| `GET /api/master/vendors/template.csv` | 取引先サンプル CSV | admin |
| `GET /api/imports/legalon-csv/template` | LegalOn サンプル CSV | admin |

### 関連ファイル(コード)

| ファイル | 役割 |
|---|---|
| `services/api/server.ts` | ルート定義のエントリポイント |
| `services/api/src/lib/authMiddleware.ts` | `requireIapUser` / `requireAppRole` |
| `services/api/src/views/adminDashboardHtml.ts` | `/admin` ページの HTML 生成 |
| `services/api/src/views/adminStaffHtml.ts` | `/admin/staff` サブページ |
| `services/api/src/views/viewerGuideHtml.ts` | viewer 用ランディング |
| `services/api/src/views/legalonImportHtml.ts` | `/imports/legalon` ページ |
| `services/api/src/views/vendorImportHtml.ts` | `/imports/vendor` ページ |
| `services/api/src/views/masterChrome.ts` | `/master/*` 共通レイアウト |
| `services/api/src/services/staffMasterService.ts` | staff CRUD ロジック |
| `services/worker/src/lib/db.ts` | スキーマ・マイグレーション(本丸) |

---

## 9. Phase 履歴(抜粋)

| Phase | 内容 |
|---|---|
| 17s | HMAC 短期署名 URL + IAP 認証導入 |
| 17x | LegalOn 取込機能 |
| 17z-4 | Master Systems (vendors/staff/contracts) CRUD |
| 22.21.35 | 取引先 CSV 取込 UI を search-api に集約 |
| 22.21.36 | `/admin` ダッシュボード + `app_role` 列 + `requireAppRole` |
| 22.21.37 | `/` ルートの admin/viewer 自動振分 |
| 22.21.40 | `app_role` マイグレーションを worker 側へ移植 |
| 22.21.41 | Master/Imports に「Admin に戻る」リンク |
| 22.21.42 | `/admin/staff` サブページ分離 + viewer プレビュー動線 |

---

## 10. 困ったら

| 症状 | まず見る |
|---|---|
| 画面が表示されない | Cloud Run のログ → IAP の OAuth consent → SSL 証明書のステータス |
| 取込が途中で失敗 | Dry Run プレビューのエラー欄、Cloud Run のログ |
| ロール切替が効かない | env `LB_APP_ADMIN_EMAILS` の上書き有無、ブラウザのキャッシュ |
| デプロイされない | GitHub Actions の `release/worker` ブランチワークフロー実行履歴 |

実装の詳細を確認する場合は、上記「関連ファイル」テーブルから該当ソースを開いてください。
