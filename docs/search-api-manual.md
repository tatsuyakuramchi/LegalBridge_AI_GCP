# LegalBridge search-api 操作マニュアル

最終更新: 2026-06-04 / Phase 25 系（作品中心モデル `/api/v3`・契約構造表示・分配構造マップ）

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
| 条件明細 横断検索 | <https://legalbridge.arclight.co.jp/master/conditions> |
| 受領予定(サブライセンス) | <https://legalbridge.arclight.co.jp/master/sublicense> |
| 作品モデル(原作IP・作品・契約) | <https://legalbridge.arclight.co.jp/work-model> |
| 分配構造マップ(作品検索 / 系譜) | <https://legalbridge.arclight.co.jp/master/receivable-map> |
| 支払Excel発行(検収書・計算書 ZIP) | <https://legalbridge.arclight.co.jp/payments/excel-export> |

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

### 3.0 画面デザイン（macOS×ポップ / サイドバーナビ）

Phase 22.21.92 で search-api の SSR 画面を **macOS 風 × ポップ** デザインに刷新しました。

- **左サイドバー（ソースリスト）でページ移動**します。従来の上部 breadcrumb バー + タブ（Contracts / Vendors / Staff …）は廃止し、サイドバーの2グループに集約しました。
  - **⚙ Master Console**（編集・フルアクセス系 = admin）: 取引先 / スタッフ / 契約台帳 / 作品モデル / 請求権(受領予定) / 分配構造マップ / 管理
  - **🔍 Search & Browse**（検索・閲覧系 = view）: 取引先検索 / 条件明細
- **admin 系**は機能密度を優先（一覧・モーダル編集・CSV 取込ボタン等をそのまま表示）。
- **view 系**は検索性・可読性を優先（大きめ検索フィルタ・popテーブル・カテゴリ色）。
- 配色はインディゴ→バイオレットのグラデーションを単一アクセントとし、角丸・ソフト影・丸ゴシックで統一。

> 実装メモ: 共通シェルは `services/api/src/views/popChrome.ts`。
> - 新規 view 系ページは `popPage()` を使用。
> - 既存 admin 系ページは `popAdminPage()` + `POP_ADMIN_BRIDGE`（旧 `masterChrome` クラスを本文無改変のまま pop 見た目へ上書き）で移行。
> - 移行は段階展開中。基準実装は **view = `/master/conditions`**、**admin = `/master/vendors`**。

### 3.1 `/` ポータル
- admin → `/admin` に 302 リダイレクト
- viewer → 検索 URL を案内する静的ページ
- `?preview=viewer` を付けると admin もリダイレクトせず viewer 画面を表示(プレビュー用)

### 3.2 `/admin` 管理ダッシュボード (admin 限定)
ハブ画面。直接の機能はなくサイドバー / タイル経由で子ページへ遷移:

| セクション | リンク先 | 説明 |
|---|---|---|
| 👥 ユーザー権限管理 | `/admin/staff` | スタッフ一覧 + admin/viewer 切替 |
| 📥 データ取り込み | `/imports/legalon`, `/imports/vendor` | CSV 一括取込 |
| 🗂️ マスター CRUD | `/master/staff`, `/master/vendors`, `/master/contracts` | 個別レコード CRUD |
| 🎬 作品 / 受領管理 | `/work-model`, `/master/receivable-map`, `/master/sublicense` | 作品中心モデル / 分配構造マップ（作品検索・系譜）/ 受領予定(サブライセンス) |
| 🔍 検索ポータル | `/search/vendor`, `/master/conditions`, 稟議番号 prompt, viewer プレビュー | 検索系入口 |

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

#### 3.5.1 取引先マスタ CSV テンプレートダウンロード

`/imports/vendor` と `/master/vendors` の CSV 一括取込モーダルには **サンプル CSV** ボタンがあります。

- ダウンロード API: `GET /api/master/vendors/template.csv`
- ファイル名: `vendor_sample.csv`
- 文字コード: UTF-8 with BOM
- 用途: 取引先マスタの列名確認、インポート用 CSV の雛形

この API は `GET /api/master/vendors/:code` より優先してルーティングされます。`template.csv` が取引先コードとして扱われると 404/500 になるため、ルート順は変更しないでください。

#### 3.5.2 取引先マスタ CSV 項目

CSV で受け付ける主な列は以下です。英語 `snake_case` を標準とし、一部 `camelCase` / 日本語列名もマッピングされます。迷った場合は必ずサンプル CSV を再ダウンロードして列名を合わせてください。

| 列名 | 必須 | 内容 |
|---|---:|---|
| `vendor_code` | 必須 | 取引先コード。upsert のキー |
| `vendor_name` | 必須 | 取引先名 |
| `corporate_number` | 任意 | 法人番号 |
| `address` | 任意 | 代表住所。住所 1:N テーブルが空の場合は代表住所として登録 |
| `phone` | 任意 | 取引先電話番号 |
| `email` | 任意 | 代表メールアドレス |
| `payment_terms` | 任意 | 決済条件 |
| `main_business` | 任意 | 取引先主要事業 |
| `transaction_category` | 任意 | 取引内容区分。推奨値: `goods_sale`, `service`, `license`, `other` |
| `capital_yen` | 任意 | 資本金（円）。数値 |
| `employee_count` | 任意 | 従業員数（人）。数値 |
| `rating` | 任意 | 評点 |
| `antisocial_check_result` | 任意 | 反社チェック結果。推奨値: `clear`, `pending`, `ng` |
| `master_updated_at` | 任意 | 取引先マスタ更新日。`YYYY-MM-DD` 推奨 |
| `contact_name` | 任意 | 代表担当者名 |
| `bank_name` | 任意 | 代表口座の銀行名 |
| `branch_name` | 任意 | 代表口座の支店名 |
| `account_type` | 任意 | 代表口座の種別 |
| `account_number` | 任意 | 代表口座番号 |
| `account_holder_kana` | 任意 | 代表口座名義カナ |
| `is_invoice_issuer` | 任意 | 適格請求書発行事業者フラグ。`TRUE` / `FALSE` |
| `invoice_registration_number` | 任意 | インボイス登録番号 |

`subcontract_act_applicable`（取適法適用判定）は画面・API 側で自動計算します。現行実装では、資本金または従業員数をもとに判定します。CSV に手入力する運用ではありません。

#### 3.5.3 住所・口座情報の 1:N 構造

住所と口座情報は、DB 上は以下の 1:N テーブルで管理します。

| テーブル | 内容 |
|---|---|
| `vendor_addresses` | 取引先に紐づく複数住所。代表住所は `is_primary = true` |
| `vendor_bank_accounts` | 取引先に紐づく複数口座。代表口座は `is_primary = true` |

互換性のため、`vendors.address` と `vendors.bank_name` / `branch_name` / `account_type` / `account_number` / `account_holder_kana` は代表値として残します。既存の契約書生成や検索はこの代表値を参照できます。

CSV 取込では、`address` と口座系の列は代表値として扱われます。複数住所・複数口座を細かく編集する場合は `/master/vendors` の入力フォームを使用してください。

### 3.6 `/master/contracts` 契約マスタ (admin 限定)
`contract_capabilities` の閲覧・編集 UI。LegalOn 取込結果の検査・補正に使用。

### 3.7 `/master/vendors` 取引先マスタ (admin 限定)
`vendors` の個別 CRUD。新規 1 件追加、編集、削除。
一括登録は `/imports/vendor` を使用。

#### 3.7.1 入力フォームの追加項目

取引先マスタの入力フォームでは、従来項目に加えて以下を編集できます。

- 法人番号
- 決済条件
- 取引先主要事業
- 取引内容区分（プルダウン）
- 資本金（円）
- 従業員数（人）
- 取適法適用判定（自動計算・読み取り専用）
- 評点
- 反社チェック結果
- 取引先マスタ更新日
- 住所（1:N、代表住所を指定可能）
- 口座情報（1:N、代表口座を指定可能）

住所・口座を複数登録した場合、代表に指定した行が `vendors` の互換カラムにも反映されます。契約書生成や既存検索で使われる住所・口座は、この代表値です。

#### 3.7.2 個人情報取得同意フラグ（個人取引先）

個人（`entity_type = individual` / `sole_proprietor`）に限り、個人情報取得同意の取得状況を `vendors` に保持します（migration `0022_vendor_pii_consent.sql`）。

| 列 | 内容 |
|---|---|
| `pii_consent_obtained` | 同意取得済みフラグ（既定 FALSE） |
| `pii_consent_date` | 同意取得日 |

- 文書作成（admin-ui の文書作成フォーム）で「同意書を同時に作成」を選んで生成すると、同意書テンプレート（`notice_consent_personal_info_freelance`）が本文書と同時に生成され、**このフラグが自動 ON ＋ 同意日が記録**されます。
- フラグの参照／更新エンドポイント（`GET/POST /api/master/vendors/:code/pii-consent`）は **worker 側**に実装されています（search-api ではありません）。

### 3.8 `/master/staff` スタッフマスタ (admin 限定)
`staff` の個別 CRUD + CSV 取込。**経営管理本部** または **法務** 部門のメンバーが操作対象。

### 3.9 `/search/vendor` 取引先・契約検索 (viewer/admin 共通)
- `?q=<取引先名>` で取引先名検索
- 契約類型・基本契約・個別契約を一覧表示
- Slack `/法務検索` から短期署名 URL 付きで開かれる経路もある(HMAC 経路は IAP 経由 + `exp`/`sig` 検証)

### 3.10 `/search/ringi/:no` 稟議番号検索 (viewer/admin 共通)
- 5 桁ゼロ詰めの稟議番号で詳細表示(例: `/search/ringi/00001`)
- admin ダッシュボードのタイルから prompt で番号入力可能

### 3.11 `/master/conditions` 条件明細 横断検索 (view デザイン)
`capability_line_items`（各文書の支払・成果物などの明細行）を横断検索する画面。view デザイン（大きめ検索フィルタ + popテーブル）。

- **検索軸**: 支払日 / 納期 / 種類（業務委託・ライセンス・出版・売買・NDA）/ 取引先（名称・コード）/ 担当 / フリーワード（品目・仕様・契約名・文書番号）
- **「古い版・重複も表示」** チェック … 既定は正本のみ。ONで旧版・重複も表示。
- **行クリックで紐付け編集モーダル** … 原作(source IP) / 作品(work) / マスター契約(基本契約) / 稟議(ringi) / 状態フラグ（発注書締結済・検収書発行済・支払申請ファイル出力済 等）を編集。
- **CSV 出力** … 「選択をCSV」（チェックした行のみ）/「全件CSV」。
- API: `GET /api/conditions/search`, `GET /api/conditions/export`, `PUT /api/conditions/:id/links`, `GET /api/conditions/ringi-options`。

### 3.12 `/master/sublicense` 受領予定(サブライセンス) (admin デザイン)
当社が相手方（サブライセンシー）に**請求／受領する**ライセンス料を管理する画面。作品×サブライセンシー単位。

- 売上料率 + MG（ミニマムギャランティ）+ 前払の組合せに対応。
- 受領予定一覧（請求一覧）として表示し、確定すると `payments`（inbound）に記録され、作品モデルに連携。
- API: `GET/POST /api/sublicense/deals`, `GET /api/sublicense/options`, `GET /api/sublicense/receipts`, `GET /api/sublicense/deals/:id/reports`, `POST /api/sublicense/reports`, `POST /api/sublicense/receipts/confirm`, `GET /api/sublicense/receipts/export`。

### 3.13 `/work-model` 作品モデル（作品中心モデル / 作品検索・契約構造表示）

作品（IP / タイトル）を軸に **原作IP → 自社作品 → 契約** の 3 層を閲覧・編集する新プラットフォーム（`/api/v3/*`）の画面です。条件明細・サブライセンス・分配マップからの紐付け先でもあります。

#### 3.13.1 3 層構造（作品検索の入口）

| セクション | テーブル | 内容 |
|---|---|---|
| 📚 **原作IP** | `source_ips` | 他社/自社の原作 IP。素材（`source_ip_materials`）件数つき |
| 🎲 **自社作品** | `works` | 当社の作品/タイトル。製品（`products`）件数つき。**派生元の作品（`parent_work_id`）で系譜（翻訳版・改題版）を表現** |
| 📜 **契約** | `contracts` | 契約レベル（master / individual / standalone）・カテゴリ（license_in / license_out / service / publication / sales / nda）・財務条件件数つき |

- 各セクションは一覧表示 → **行クリックで詳細（子コレクションを展開）**。
- **作品検索**: 原作IP・自社作品・契約を作品軸で横断的に一覧/参照できます。タイトルの別名・改題での名寄せ検索は **3.14 分配構造マップ**側（`/api/receivable-map/resolve` + タイトル別名）が担います。

#### 3.13.2 契約構造の表示（契約詳細）

契約（`contracts`）の行を開くと、その契約に紐づく構造を一括展開します。これが「契約構造の表示」です。

| 子コレクション | 内容 |
|---|---|
| **対象作品 / IP**（`contract_works`） | この契約が対象とする作品・原作IP・製品 |
| **当事者**（`contract_parties`） | 甲乙等の当事者（取引先名つき） |
| **財務条件**（`contract_financial_terms`） | 料率・MG・前払等の条件（`condition_no` 順） |
| **明細**（`contract_line_items`） | 支払・成果物などの明細行（`line_no` 順） |
| **ロイヤリティ**（`royalty_statements`） | 期別の総額・MG・残MG・実額 |

自社作品（`works`）の詳細では **製品 / 権利台帳（`work_materials`）/ 紐づく契約 / 支払集計（種別×方向）** が展開され、各作品カードには **「🔀 分配マップ」リンク**（→ 3.14）が付きます。

#### 3.13.3 編集と CSV 一括取込

- 閲覧は viewer/admin 共通（IAP）。**新規・更新・CSV 取込は admin のみ**（`requireWrite`）。
- 採番は `master_sequences`（worker の文書番号空間とは分離）。例: 原作IP は `IP-YYYY-NNNN`。
- CSV 一括取込: `POST /api/v3/import/:entity`（`source-ips` / `works` / `contracts`）。雛形は `GET /api/v3/import/:entity/template.csv`。

### 3.14 `/master/receivable-map` 分配構造マップ（作品検索 / 系譜）

当社が**サブライセンサー**となる構造を、**作品中心の 3 層フロー図**で表示する画面です（view デザイン）。

```
上流（原権利者 / ライセンサー）  →  当社（サブライセンサー）  →  下流（サブライセンシー）
        ＝当社が分配（料率×受領額）         ＝受領                ＝当社が受領
```

#### 3.14.1 作品検索（タイトル名寄せ）

- 上部の **「🔎 他社/改題タイトルで作品検索…」** ボックスに入力すると、`GET /api/receivable-map/resolve?q=` でタイトルから作品を解決します。
- **他社が付けた改題タイトル・別名でもヒット**します（`matched_via` で何経由のマッチかを表示）。
- 受領のある作品は `GET /api/receivable-map/works` でピッカーに並びます。

#### 3.14.2 系譜（多段）の表示

- 作品を選ぶと `GET /api/receivable-map?work=<id>`（単段の分配構造）と `GET /api/receivable-map/lineage?work=<id>`（派生系譜・多段）を読み、**上流分配 ← 当社 ← 下流受領**を図示します。
- 派生作品（翻訳版・改題版など。`works.parent_work_id`）は子ノードとしてリンク表示され、クリックでその作品のマップへ移動します。
- 系譜合計（受領額など）も集計表示します。

#### 3.14.3 タイトル別名（名寄せ）の登録

- 画面下部の別名カードから、その作品の **改題タイトル・他社呼称** を登録できます（`POST /api/works/:id/aliases` / 削除 `DELETE /api/work-aliases/:id`）。
- 別名を登録しておくと、利用報告 CSV 取込時のタイトル自動名寄せ（`/api/sublicense/reports/import-csv`）や上記の作品検索でその名称ヒット率が上がります。

### 3.15 `/payments/excel-export` 支払Excel発行（検収書・利用許諾料計算書）

ログイン担当者が**自分の担当する検収書 / 利用許諾料計算書**を支払期日の期間で絞り込み、
チェックした文書を **ZIP（検収書PDF × 選択件数 + 支払申請用 Excel）** としてローカルにダウンロードする画面です（view デザイン / viewer 可）。

- **一覧**: `GET /api/payment-exports/list?from&to&staff` — 支払期日（`form_data.paymentDueDate` 等）で絞込。
  列: 種別 / 検収書番号 / 発注書番号 / 取引先名 / 件名 / 支払期日 / 前回Excel発行日 / PDF リンク。
- **Excel の中身**: worker の会計用バッチ（`/api/excel-batches/*`）と同一の列構成（1 行 = 1 文書、
  支払スロット 8・源泉税・差引振込額・インボイス登録番号）。実装は
  `services/api/src/services/excelService.ts`（worker からの移植。**変更時は両方を同時更新**）。
- **個人/法人でファイル分割**: ZIP 内の Excel は **種別 × 個人/法人** ごとに 1 ファイル
  （例: `検収書_個人_….xlsx` / `検収書_法人_….xlsx`）。区分は取引先マスター `vendors.entity_type`
  で判定（「個人」/`individual` → 個人、それ以外の設定あり → 法人）。取引先が解決できない・
  `entity_type` 未設定の場合は `…_区分不明_….xlsx` に分かれるので、取引先マスターを整備すること。
  源泉税の自動計算（個人は源泉強制 ON）も同じ判定を使う。
- **再出力可（参照用）**: `excel_issued_at` 済みの文書も期間内なら再出力できます。
  出力のたびに `excel_issued_at = NOW()` に更新され「前回発行日」として表示されます
  （worker 側の「Excel 未発行」一覧からは消えます）。
- **権限**: viewer は自分（`form_data.inspectorEmail`）の担当分のみ。
  **admin は全担当者 + 担当者未設定**を閲覧でき、担当者未設定の文書には
  行内の「設定」ボタンで担当者を設定できます（`POST /api/payment-exports/assign`、staff マスター登録者のみ）。
- **PDF 同梱の前提**: 検収書 PDF は Drive（`documents.drive_link`）から
  `drive.readonly` スコープで取得します。**search-api のサービスアカウントに
  検収書 PDF フォルダ（共有ドライブ）の閲覧権限が必要**です
  （`GOOGLE_SERVICE_ACCOUNT_KEY_PATH` → ADC の順で解決。worker と同じ SA キーを共有すれば追加設定不要）。
  取得できなかった PDF は ZIP 内の `PDF未取得一覧.txt` に列挙され、Excel は通常どおり出力されます。

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

### 取引先 CSV: サンプル CSV がダウンロードできない
- `GET /api/master/vendors/template.csv` が 404/500 になる場合は、`/api/master/vendors/:code` より前にテンプレート CSV ルートが定義されているか確認します。
- デプロイ後も改善しない場合は、ブラウザキャッシュではなく Cloud Run の最新 revision が `release/api` の最新コミットを使っているか確認します。

### 取引先マスタ画面: FETCH FAILED - HTTP 500
- search-api が新しい `vendors` カラムを SELECT している一方、DB マイグレーションが未適用の場合に発生します。
- `release/worker` を最新化して `legalbridge-document-worker` をデプロイし、worker 起動時の `initDb()` を実行してください。
- search-api 側は旧スキーマへのフォールバックを持っていますが、新項目・住所/口座 1:N の保存には worker 側マイグレーションが必要です。

## 6. デプロイと運用

### 構成

- **Cloud Run サービス**: `legalbridge-search-api` (region: `asia-northeast1`)
- **デプロイトリガー**: Cloud Build トリガー `legalbridge-search-api-release`。**`release/api` ブランチへの push** を検知し、`cloudbuild-api.yaml`（`services/api/` をビルド）で自動デプロイ。
- **ロードバランサ**: `34.36.159.230` (HTTPS, SSL 証明書 ACTIVE)
- **ドメイン**: `legalbridge.arclight.co.jp`

> ⚠️ worker（`legalbridge-document-worker`）とは別系統です。worker は `release/worker` への push で別トリガーがデプロイします。search-api を更新したいのに `release/worker` を触る、という取り違えに注意してください。

### デプロイ手順（search-api）

`release/api` に変更を載せて push するだけで自動デプロイされます。

```bash
# 変更が入っているブランチ（例: main や feature ブランチ）を release/api に反映
git checkout release/api
git merge <変更元ブランチ>        # fast-forward 可能ならそのまま FF
git push origin release/api        # ← これでトリガー起動・自動デプロイ

# ビルドの進行確認
gcloud builds list --limit 3
```

> 手動でビルドを起こす場合（トリガーを使わない場合）は、`SHORT_SHA` がトリガー経由でないと補完されないため明示指定が必要です:
> ```bash
> gcloud builds submit --config=cloudbuild-api.yaml \
>   --substitutions=SHORT_SHA=$(git rev-parse --short HEAD)
> ```

### マイグレーション（スキーマ変更）

**スキーマの単一所有者は `migrations/` ランナー**です。`migrations/NNNN_*.sql` を `schema_migrations` で追跡し、未適用分のみを順に適用します（冪等）。アプリ（search-api / worker）は**起動時に DDL を流しません**。

- **適用タイミング**: `release/worker` への push で `cloudbuild-worker.yaml` の **① migration ステップ**が走り、成功してから worker をデプロイします（マイグレーションが失敗するとデプロイは止まり、旧 revision が生き続けます）。
- **接続**: 最小権限ロール `lb_migrate`（Secret `lb-migrate-database-url`）で接続。アプリ実行時の DB ロールには DDL 権限を与えません。
- **スキーマ変更の追加手順**: `migrations/` に次番号の `NNNN_*.sql` を追加 → `release/worker` に載せて push（→ 自動適用 → worker デプロイ）。
- **worker `initDb()` は既定で実行しません**（`RUN_INIT_DB=true` の時だけ後方互換でローカル/緊急時に起動時 DDL）。search-api 側の `db.ts` も同様に実行されません。
- **手動・緊急適用**: `cloudbuild-migrate.yaml` を `gcloud builds submit --config=cloudbuild-migrate.yaml --substitutions=SHORT_SHA=$(git rev-parse --short HEAD)` で単発実行できます。

> 旧構成からの変更点（統合）: 以前は worker 起動時 `initDb()` と独立 `legalbridge-migrate` トリガーの 2 系統がありました。現在は **「`migrations/` ランナーを worker デプロイ・パイプラインに畳み込む」1 系統**に統合しています。独立 `legalbridge-migrate` トリガー（特に `_INSTANCE_CONNECTION_NAME` 未指定で Cloud SQL バインドが外れ socket `ENOENT` で失敗していたもの）は**無効化**してください。

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
| `GET /api/master/vendors/template.csv` | 取引先サンプル CSV / インポートテンプレート | 制限なし |
| `GET /api/imports/legalon-csv/template` | LegalOn サンプル CSV | admin |
| `GET /api/conditions/search` | 条件明細 横断検索 | IAP |
| `GET /api/conditions/export` | 条件明細 CSV 出力（選択 / 全件） | IAP |
| `PUT /api/conditions/:id/links` | 明細行の紐付け（原作/作品/契約/稟議/状態）更新 | IAP |
| `GET /api/conditions/ringi-options` | 稟議ピッカー用一覧 | IAP |
| `GET/POST /api/sublicense/deals` | サブライセンス案件 一覧 / 登録 | IAP |
| `GET /api/sublicense/receipts` | 受領予定 一覧 | IAP |
| `POST /api/sublicense/receipts/confirm` | 受領確定（payments inbound へ記録） | IAP |
| `GET /api/sublicense/receipts/export` | 受領予定 CSV 出力 | IAP |
| `GET /api/contract-check/purposes` | 契約目的マスター（方向 `flow_direction` 付き。admin-ui 生成フォームの目的セレクタ） | portal secret |
| `GET /api/v3/{source-ips,works,contracts}` | 作品中心モデル 一覧（作品検索） | IAP(read) |
| `GET /api/v3/{source-ips,works,contracts}/:id` | 詳細（子コレクション込み＝**契約構造の表示**） | IAP(read) |
| `POST/PUT /api/v3/{source-ips,works,contracts}` | 新規 / 更新 | admin |
| `POST /api/v3/import/:entity` | 作品中心モデル CSV 一括取込 | admin |
| `GET /api/v3/import/:entity/template.csv` | 作品中心モデル サンプル CSV | admin |
| `GET /api/receivable-map/works` | 分配マップ対象作品（受領あり）一覧 | IAP |
| `GET /api/receivable-map?work=<id>` | 作品の分配構造（上流←当社←下流） | IAP |
| `GET /api/receivable-map/lineage?work=<id>` | 派生系譜（多段）マップ | IAP |
| `GET /api/receivable-map/resolve?q=` | タイトル→作品 名寄せ解決（改題/別名対応の作品検索） | IAP |
| `GET/POST /api/works/:id/aliases` | 作品タイトル別名（名寄せ）参照 / 追加 | IAP |
| `DELETE /api/work-aliases/:id` | 作品タイトル別名 削除 | IAP |
| `GET /api/sublicense/reports/template.csv` | 利用報告 サンプル CSV | IAP |
| `POST /api/sublicense/reports/import-csv` | 利用報告 CSV 取込（タイトル自動名寄せ） | IAP |

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
| `services/api/src/services/vendorMasterService.ts` | 取引先 CSV parse / upsert / サンプル CSV 生成 |
| `services/api/src/views/popChrome.ts` | **macOS×ポップ 共通シェル**（サイドバー / `popPage` / `popAdminPage` / `POP_ADMIN_BRIDGE`） |
| `services/api/src/views/masterChrome.ts` | 旧 `/master/*` 共通レイアウト（pop へ移行中。ブリッジで再利用） |
| `services/api/src/views/conditionsHtml.ts` | `/master/conditions`（view 基準実装） |
| `services/api/src/views/vendorMasterHtml.ts` | `/master/vendors`（admin 基準実装） |
| `services/api/src/views/sublicenseHtml.ts` | `/master/sublicense` 受領予定 |
| `services/api/src/views/workModelHtml.ts` | `/work-model` 作品中心モデル（原作IP/作品/契約・契約構造の表示） |
| `services/api/src/routes/workModel.ts` | `/api/v3/*` ルート（作品中心モデルの read/write/CSV） |
| `services/api/src/services/workModelImportService.ts` | 作品中心モデル CSV パース / 取込 |
| `services/api/src/views/receivableMapHtml.ts` | `/master/receivable-map` 分配構造マップ（作品検索 / 系譜 / 名寄せ） |
| `services/api/src/services/receivableMapService.ts` | 分配構造・系譜・タイトル名寄せ・作品別名ロジック |
| `services/api/src/services/usageReportImportService.ts` | 利用報告 CSV 取込（タイトル自動名寄せ） |
| `services/api/src/services/conditionsService.ts` | 条件明細 検索 / CSV / 紐付け / 状態フラグ定義 |
| `services/api/src/services/sublicenseService.ts` | サブライセンス案件 / 受領予定ロジック |
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
| 22.21.43 | 取引先マスタ項目追加、住所/口座 1:N、CSV テンプレートダウンロード |
| 22.21.9x | 条件明細 横断検索 + 紐付け編集 + 状態フラグ + CSV 出力（`/master/conditions`） |
| 22.21.9x | 受領予定(サブライセンス) 管理（`/master/sublicense`）+ 受領確定→payments(inbound) 記録 |
| 22.21.9x | 個人情報取得同意フラグ（`vendors.pii_consent_*`）+ 文書作成時の同意書同時生成 |
| 22.21.92 | **macOS×ポップ UI リデザイン**（サイドバーナビ / admin・view デザイン分け / `popChrome.ts`）。view=条件明細・admin=取引先マスタを基準に段階展開 |
| 25 系 | **作品中心モデル `/api/v3`**（原作IP→自社作品→契約の 3 層）を `/work-model` に搭載。一覧/詳細（**契約構造の表示**＝当事者・対象作品・財務条件・明細・ロイヤリティ）+ CRUD + CSV 取込 |
| 25 系 | **分配構造マップ `/master/receivable-map`**（作品中心の上流←当社←下流フロー / 派生系譜 / **改題・別名対応のタイトル名寄せ作品検索** / 作品別名 CRUD） |
| 25 系 | 利用報告 CSV 取込（タイトル自動名寄せ）+ 条件明細(inbound)→請求権 自動取込 |
| 25 系 | 契約目的マスターに方向（`contract_purposes.flow_direction`）を付与。`GET /api/contract-check/purposes` が方向を返し、admin-ui 生成フォームの目的セレクタ（ライセンスイン/アウト・プロダクトイン/アウト）から方向(in/out)を確定 |

---

## 10. 困ったら

| 症状 | まず見る |
|---|---|
| 画面が表示されない | Cloud Run のログ → IAP の OAuth consent → SSL 証明書のステータス |
| 取込が途中で失敗 | Dry Run プレビューのエラー欄、Cloud Run のログ |
| ロール切替が効かない | env `LB_APP_ADMIN_EMAILS` の上書き有無、ブラウザのキャッシュ |
| デプロイされない | **`release/api` に push したか**、Cloud Build トリガー `legalbridge-search-api-release` の実行履歴（`gcloud builds list`）。worker 用の `release/worker` と取り違えていないか |
| 画面が旧デザインのまま | Cloud Run の最新 revision が `release/api` 最新コミットを使っているか、ブラウザのハードリロード |

実装の詳細を確認する場合は、上記「関連ファイル」テーブルから該当ソースを開いてください。
