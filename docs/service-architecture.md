# サービスアーキテクチャ刷新案 ― Search と admin+worker の2独立ユニット化

> 対象: GCP (Cloud Run × 複数 / Cloud SQL / Cloud Build / IAP)
> 目的: デプロイされているサービスの役割分担を明確化し、**「Search(表・全社・保守対象)」** と **「admin+worker(裏・法務のみ・保守非対象=凍結)」** を **2つの独立ユニット**として分離する。

---

## 1. 思想

| | **Search**(表) | **admin + worker**(裏) |
| :--- | :--- | :--- |
| 公開範囲 | **全社** | **法務部のみ** |
| 位置づけ | データベース参照サービス(+一部登録) | 完全機能の裏方(Searchの全機能 + 課題管理) |
| 機能 | 検索(取引先・契約・テンプレ)/ 登録(取引先・契約・スタッフ)/ テンプレDL(viewer) | Search全機能 + 課題管理(文書生成・Slack通知・採番・稟議・Backlog webhook・migration) |
| フロント | **専用フロントを新設** | 既存 admin-ui |
| 保守 | **対象(育てる)** | **非対象(凍結)** |
| 原則 | **2ユニットは互いに独立**(Search は worker に依存しない / admin+worker は search-api に依存しない) | |

### 確定事項
- **テンプレートは DB に格納**(汎用性確保)。Search も worker も DB から読む(ファイル/ディスク依存を脱却)。
- **Search は専用フロントエンドを持つ**(admin-ui とは別)。

---

## 2. 現状(確認済み)

Cloud Run 3 サービス + 単一 Cloud SQL:
- **legalbridge-admin-ui**: 静的Reactホスト。`src/lib/apiRouter.ts` が `/api/*` を search-api / worker に振り分け。
- **legalbridge-search-api**: 読み取り中心。**Phase 17z で取引先マスター CRUD のメインに昇格(書き込み有り)**。`/api/master/*`・`/api/management/*`・`/api/backlog/*`・`/api/contract-check/*`(Slack GAS)。
- **legalbridge-document-worker**: 書き込み + ジョブ。Backlog webhook・文書生成(PDF/Excel)・採番・稟議・Slack通知・**migration 所有**。

### 現状の相互依存(独立を阻む2点)
1. **Search → worker**: テンプレ取得が `fetch(worker/api/templates)` の**プロキシ**(`services/api/server.ts:486,514`)。
2. **admin-ui → search-api**: `apiRouter.ts` が GET を search-api に転送。

---

## 3. 独立化のため断つ依存

1. **Search のテンプレ proxy 撤去** → `document_templates`(DB)を直読。
2. **admin-ui を worker のみへ振り分け** → admin+worker を自己完結化(worker が全 read を持つ superset である前提)。

---

## 4. MECE: 追加開発が必要な箇所

| 区分 | # | 項目 | 所有 / 配置 | 凍結worker に触れるか | 優先 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A. データ層** | A1 | `document_templates` テーブル新設(key/version/html/field_schema/prefix/category/active) | 共有DB | ― | ★★★ |
| | A2 | 既存 `templates_config.json` + `templates/*.html` を DB へ移行投入 | 移行スクリプト | ― | ★★★ |
| | A3 | テンプレ CRUD/編集(ファイルcommit運用 → DB編集へ)。テンプレ管理画面/API | 配置先を決定(worker or Search admin) | ― | ★★☆ |
| **B. Search(育てる)** | B1 | **専用フロントエンド新規開発**(検索 / 登録 / テンプレDL viewer) | Search | ― | ★★★ |
| | B2 | テンプレ proxy 撤去 → DB直読(B + worker依存断ち) | search-api | ― | ★★★ |
| | B3 | アクセス制御: 全社 **viewer**(検索/DL) vs 一部 **admin**(登録)のロール分離 | search-api + IAP | ― | ★★☆ |
| | B4 | 登録機能の完結(vendor / contract / staff master CRUD を search-api 内で自己完結) | search-api | ― | ★★☆ |
| | B5 | **レンダリングモジュール**(Handlebars+helper+PDF)。viewer はデータ流し込みプレビュー/PDF(②)まで対応。**エフェメラル**(`documents` には書かない=worker所有を維持) | Search(共有lib) | ― | ★★☆ |
| **C. admin+worker(凍結)** | C1 | admin-ui の振り分けを **worker のみ**へ(search-api依存除去) | admin-ui(apiRouter) | ― | ★★★ |
| | C2 | worker が **全 read endpoint を持つ superset** であることの担保(search-api専用readの補完) | worker | **要(一度)** | ★★☆ |
| | C3 | worker の文書生成を **DBテンプレ取得**に改修(現状ディスク読み) | worker | **要(一度)** | ★★★ |
| | C4 | 法務のみアクセスの IAP/IAM 制限(Backlog webhook は開放維持) | IAP/IAM | ― | ★★☆ |
| **D. 横断(MECE境界)** | D1 | **書き込み所有の一本化**: masters=Search / 課題・文書・稟議・採番=worker。worker のレガシー vendor CRUD は read-only化 or 撤去(**二重writer解消**) | 方針決定 | **要(一度)** | ★★★ |
| | D2 | **migration 所有の決定**: 新スキーマは Search が使用 → migration を Search 移管 or 専用 job。凍結 worker は**互換ビュー**で延命(スキーマ刷新 §8 と連結) | 方針決定 | ― | ★★★ |
| | D3 | 共有コード/重複の方針: DB/業務ロジックは**意図的分岐**(Search=新スキーマ / worker=互換ビュー)。**例外: レンダリング部品(Handlebars+helper+PDF)は共有ライブラリ化**(B5 で Search も②までレンダリングするため) | 方針決定 | ― | ★★☆ |
| | D4 | CI/CD: **Search専用フロントの build 追加**、各ユニット独立トリガ、**凍結worker の誤デプロイ防止** | Cloud Build | ― | ★★☆ |

---

## 5. 重要な留意点

### 5.1 「凍結」でも一度きりの改修は必要
独立化のため、保守非対象の worker にも **一度だけ**手を入れる必要がある(C2 read superset化 / C3 DBテンプレ取得 / D1 二重writer解消)。**この一回の独立化リファクタ後に凍結**する、という前提で進める。

### 5.2 superset の重複は「機能はOK / データはMECEに」
admin+worker が「Search の全機能を含む superset」である以上、**機能の重複は意図的**。ただし **書き込み先(データ)は単一所有**にしないと両ユニットが同じ DB を競合更新する。→ D1 で「どの実体をどちらが authoritative に書くか」を一本化する。

### 5.3 スキーマ刷新との連結
「worker 凍結 / Search 育成」は、テーブル刷新(`schema-redesign-proposal.md` §8)の **互換ビュー戦略の前提そのもの**:
- **新スキーマの正テーブルは Search が使用**。
- **凍結 worker は互換ビュー越しに現行コードのまま稼働**。
- 新機能・新スキーマ開発は Search に集約。

---

## 6. 推奨(意思決定)

### 6.0 「独立」の定義
**独立 = サービス間の HTTP 依存がゼロ**(各サービスが自分の DB 接続で完結)であること。**共有 Cloud SQL の直読は独立を損なわない**。この定義により「Search がマスターの唯一の書き手」かつ「worker も独立」を両立できる(worker はマスターを*書かず*に DB 直読するだけ)。

### 6.1 各決定の推奨

| 決定 | 推奨 | 理由 |
| :--- | :--- | :--- |
| **D1 書込所有** | **Search = マスター系の唯一の書き手**(vendors / contracts / staff / `document_templates`)。**worker = マスターは共有DB直読のみ** + 課題・文書・稟議・採番・payments の書き手。worker のレガシー vendor CRUD は**撤去**(二重writer解消) | 書き込みを単一所有にすればデータ競合が消える。worker は「読むだけ」なので HTTP 依存なしで独立を保てる。全社のマスター登録は Search フロントに集約 |
| **D2 migration所有** | **短期: Search が所有**(新スキーマ + 凍結worker用の互換ビューを作成、worker の `initDb` は無効化)。**目標: 専用 migration ジョブに分離**(Cloud Run Job / Build step) | 育てる Search が新スキーマを使うので所有も自然。最終的にどちらのサービスも起動時 migration しない形(起動レース回避)が2独立ユニットに最も整合 |
| **D3 コード重複** | DB/業務ロジックは**意図的分岐**(契約面は「DBスキーマ + 互換ビュー」)。**例外: レンダリング部品(Handlebars+helper+PDF)だけは共有ライブラリ化** | Search=新スキーマで育成 / worker=互換ビューで凍結。ただし Search viewer が②(データ流し込みプレビュー/PDF)まで行うため、worker と同一レンダリング結果を保つには helper/PDF を共有する必要がある |
| **A3 テンプレCRUD** | **Search の admin機能**として実装。worker は生成時に DB 直読 | 新規開発は保守対象(Search)に置く。法務は Search の admin ロールでテンプレ編集、worker は読むだけ |
| **C2 worker read superset** | **必要(一度きり)**。不足 read を worker に補完 | admin-ui を worker 専用にするため。独立化リファクタの一部 |

### 6.2 推奨する実行順序

```
1. A1/A2  テンプレDB化(document_templates 新設 + 移行投入)        ← 基盤
2. D2     migration を Search 所有へ + 互換ビュー作成              ← スキーマ作業の前提
3. D1     書込所有の一本化(worker のマスター書込を撤去)          ← 二重writer解消
4. B2/C3  テンプレ proxy 撤去 / worker をDBテンプレ読みに改修      ← 依存断ち
5. C1/C2  admin-ui を worker 専用へ + worker read superset 補完    ← admin+worker 自己完結
6. B1/B3  Search 専用フロント + viewer/admin ロール               ← Search 自己完結
7. ─────  worker を凍結
```

最も効くのは **D1 + D2**: 「Search = マスター & migration 所有、worker = 読むだけで凍結」に倒せば、2ユニットが同一DBを安全に共有しつつ独立する。

---

## 7. D1 確定: 書込所有マップ

### 原則
- **worker(凍結)** = **既存テーブルを書くだけ。新規書込はしない**(strangler の被代替側)。
- **Search(育成)** = **マスター系 + 新 work-centric モデル全部を書く**(将来の正)。
- 「独立」= サービス間 HTTP 依存ゼロ。**両者とも共有 DB を直読**してよい(読みは所有を問わない)。

### 7.1 Search が書く(唯一の書き手)

| 群 | テーブル | 備考 |
| :--- | :--- | :--- |
| 取引先マスター | `vendors` / `vendor_addresses` / `vendor_bank_accounts` / `vendor_contacts` / `party_roles` | **worker のレガシー vendor CRUD は撤去** |
| 組織 | `staff` | worker の staff 書込は撤去 |
| 参照マスター | `expense_categories` / `contract_purposes` | |
| テンプレ | `document_templates` | A3: Search admin が編集、worker は読むだけ |
| 法務検索ログ | `contract_decision_logs` | search-api の contract-check が記録 |
| Search採番(新) | `master_sequences`(Search 専用) | Search 登録契約の採番。worker `document_sequences`(生成書類用)とは番号空間を分離 |
| 作品・IP(新) | `works` / `source_ips` / `source_ip_materials` / `products` / `work_materials` / `ip_registrations` | 旧 `ledgers`/`materials`/`sublicensees` の書込もここへ集約 |
| 契約(新・内容) | `contracts` / `contract_works` / `contract_parties` / `contract_financial_terms` / `contract_line_items` / `contract_obligations` | **worker の `contract_capabilities`/`capability_*` 書込は撤去**、worker は互換ビューで read |
| 締結ワークフロー(新) | `contract_stage_history` / `signature_requests` / `signature_steps` | 新規=Search |
| 成果物・財務(新) | `deliverables` / `deliverable_revisions` / `sales_events` / `royalty_statements` / `invoices` / `payments` | 新モデルは Search が所有 |
| アラート(新) | `alerts`(レコード) | 送信は過渡的に worker の Slack 通知が read して実行 |

### 7.2 worker が書く(凍結・既存テーブルのみ)

| 群 | テーブル | 備考 |
| :--- | :--- | :--- |
| 文書・採番 | `documents` / `document_sequences` | 生成書類と採番(既存フロー) |
| 外部資産 | `external_assets` | LegalOn/CloudSign 取込(既存) |
| Backlog/課題 | `legal_requests` / `issue_workflows` / `workflow_settings` | webhook 起点(既存) |
| 検収 | `delivery_events` / `delivery_line_items` | 既存 |
| 既存ロイヤリティ | `manufacturing_events` / `royalty_calculations` / `royalty_payments` | **新 `payments`/`royalty_statements` へ移行するまで併存**(互換) |
| 稟議 | `ringi_records` / `ringi_documents` | 既存。`ringi_works`(新)は Search |
| 設定 | `app_settings` / `department_workflow_rules` | 承認・押印の運用設定(既存ワークフロー駆動) |

### 7.3 移行時の重複と解消

| 重複 | 解消 |
| :--- | :--- |
| worker 旧 vendor/ledger/sublicensee CRUD ↔ Search マスター | **worker 側を撤去**(read-only化 → 削除)。Search を唯一の書き手に |
| worker 旧 `royalty_calculations`/`royalty_payments` ↔ Search 新 `royalty_statements`/`payments` | 過渡は併存。worker フロー retire 時に新へ一本化。互換ビューで read 整合 |
| worker `contract_capabilities` 書込 ↔ Search `contracts` | worker 書込を撤去し、`contract_capabilities` は Search 新テーブル上の**互換ビュー**に置換 |

### 7.4 サブ決定(確定済み)

1. **採番 → Search 専用採番を新設**(確定)。worker の `document_sequences` は**生成書類用に温存**し、**Search 登録の契約は Search 所有の別採番系統**を新設する(worker と番号空間を分離。例: Search 側 `master_sequences` / 別 prefix)。
2. **アラート送信 → worker**(確定)。`alerts` レコードは Search が書き、**Slack 送信ジョブは worker が `alerts` を read して実行**(既存通知器を流用)。新通知器の Search 実装は後続フェーズ。
3. **`contracts.lifecycle_stage` → Search 所有**(確定)。Backlog webhook 由来のステータスは worker の `issue_workflows` に残し、Search 側 `lifecycle_stage` へ**マッピング同期**する。

> これで D1(書込所有)は**完全確定**。次フェーズの起点は推奨実行順序(§6.2)の A1/A2(`document_templates` のDB化)。

---

## 8. D2 具体化: マイグレーション運用

### 8.1 結論
**どちらのサービスも起動時にスキーマを作らない。DDL は専用ランナーが明示的に適用する。**
- 現状: worker の `initDb()`(`services/worker/src/lib/db.ts` 2105行)が起動時に `CREATE/ALTER … IF NOT EXISTS` を全実行している。
- 目標: **専用マイグレーションランナー**(Cloud Run Job `legalbridge-migrate` または Cloud Build の deploy ステップ)が、順序付き・冪等なマイグレーションを適用する。Search も worker も**起動時 migration をしない**(起動レース解消・所有の曖昧さ解消)。

### 8.2 ランナーが適用するもの(1か所に集約)
1. **スキーマ(新テーブル)**: works / contracts / payments … (`schema-redesign-proposal.md`)
2. **互換ビュー**: `contract_capabilities` / `capability_*` / `royalty_calculations` を**新テーブル上のビュー**として定義 → **凍結 worker を無改修で延命**。
3. **バックフィル**: 既存データの移送(`ledgers`→`works`/`source_ips` 等)。
4. **`schema_migrations` テーブル**: 適用済みバージョンを記録(順序付き・再実行安全)。

### 8.3 構成
```
migrations/                      ← 順序付き SQL(または node-pg-migrate 等)
  0001_baseline.sql              ← 現行スキーマを worker initDb から抽出・固定化
  0002_new_tables.sql            ← works/contracts/payments … (additive)
  0003_compat_views.sql          ← 凍結worker用の後方互換ビュー
  0004_backfill.sql              ← データ移送
legalbridge-migrate (Cloud Run Job)  ← migrations/ を schema_migrations 基準で適用
```
- 実行タイミング: **デプロイ時に明示実行**(Cloud Build step か手動 Job 実行)。アプリ起動とは分離。

### 8.4 DB ロール(3分割)
| ロール | 権限 | 使う主体 |
| :--- | :--- | :--- |
| `lb_migrate` | DDL(CREATE/ALTER/DROP) | マイグレーションランナーのみ |
| `lb_search` | 自分の所有テーブルに DML + 全体/ビューに SELECT | Search |
| `lb_worker` | 自分の所有テーブルに DML + 互換ビューに SELECT | worker(凍結) |

> 現状の「SELECT専用 / 読み書き」2ロールに **`lb_migrate` を追加**し、アプリのロールから DDL 権限を剥奪する(アプリは自テーブルの DML のみ)。

### 8.5 移行ステップ
1. worker `initDb()` の DDL を `migrations/0001_baseline.sql` に**抽出・固定化**(現行スキーマをそのまま表現)。
2. マイグレーションランナー + `schema_migrations` を導入し、0001 を適用して**現行と一致を確認**(no-op)。
3. **worker の起動時 `initDb()` を無効化**(以後 worker はスキーマを触らない)。
4. 0002〜(新テーブル / 互換ビュー / バックフィル)をランナーで適用 → Search が新テーブルを使い始める。
5. ロールを `lb_migrate` / `lb_search` / `lb_worker` に整理。

### 8.6 短期 → 目標
- **短期(現実解)**: ランナーを **Cloud Build の deploy ステップ**として実装(追加インフラ最小)。所有は Search チーム。
- **目標**: 独立した **Cloud Run Job** に分離(どのサービスにも属さない第三の実行主体)。

> これにより `schema-redesign-proposal.md` §8 の互換ビュー戦略が運用面で裏打ちされる(凍結 worker はビュー、Search は正テーブル、DDL はランナー1か所)。

---

## 9. Search スタック設計(画面 / API / ロール / IAM)

### 9.1 画面構成(B1 専用フロント)
| 画面 | 機能 | ロール |
| :--- | :--- | :--- |
| 横断検索 | 取引先・契約情報・契約書テンプレートを検索 → 一覧 | viewer |
| 取引先 詳細/登録・編集 | vendor 閲覧 + 登録・編集 | 閲覧=viewer / 編集=admin |
| 契約 詳細/登録・編集 | contract 閲覧 + 登録・編集(Search採番 `master_sequences`) | 閲覧=viewer / 編集=admin |
| スタッフ 一覧/登録・編集 | staff 閲覧 + 登録・編集 | 閲覧=viewer / 編集=admin |
| テンプレ viewer | 一覧 / DL / **データ流し込みプレビュー・PDF(②, エフェメラル)** | viewer |
| テンプレ編集(A3) | Handlebars 本体 + `field_schema` 編集 + バージョン管理 | template-admin |

### 9.2 API サーフェス(search-api が公開)
- **読取(viewer)**: `GET /api/search` 横断 / `GET /api/master/vendors|staff` / `GET /api/contracts(:id)` / `GET /api/templates(/:key)`
- **書込(admin)**: `POST|PATCH /api/master/vendors` / `POST|PATCH /api/contracts`(+ `master_sequences` 採番) / `POST|PATCH /api/master/staff`
- **テンプレ(template-admin)**: `POST|PATCH /api/templates` / `GET /api/templates/:key/versions`
- **レンダリング(②, viewer)**: `POST /api/templates/:key/render` → プレビューHTML/PDF を返す(**`documents` に書かない**)
- **Slack GAS**: `POST /api/contract-check/*`(`X-LB-PORTAL-SECRET`)
> いずれも worker を呼ばず search-api 内で完結(共有DB直読 + レンダリング共有lib)。

### 9.3 ロール / 権限マトリクス(B3)
| 機能 | viewer(全社) | admin(権限者) | template-admin | Slack GAS |
| :--- | :---: | :---: | :---: | :---: |
| 検索・閲覧(取引先/契約/テンプレ) | ○ | ○ | ○ | 検索のみ |
| テンプレ DL / ②プレビュー・PDF | ○ | ○ | ○ | ― |
| 取引先 / 契約 / スタッフ 登録・編集 | × | ○ | ― | ― |
| テンプレ編集(本体/field_schema/版) | × | × | ○ | ― |
| 法務検索(contract-check) | ― | ― | ― | ○ |

- **viewer** = 認証済み全社ユーザー(既定)。**admin** = `staff.app_role='admin'` または対象部門ロール(`requireDepartmentRole`)。**template-admin** = admin のサブ(テンプレ編集権限フラグ)。

### 9.4 IAM / IAP 境界(C4)
| スタック | アクセス | 認証 |
| :--- | :--- | :--- |
| **Search(表)** | **全社** | IAP(Workspace 全員)= viewer / 書込は role gate / Slack は portal-secret |
| **admin+worker(裏)** | **法務部のみ** | IAP を**法務グループに限定**(IAM 条件)。例外: `POST /api/webhooks/backlog` は Backlog 連携のため無認証維持(**署名/シークレット検証**を付与) |

> セキュリティ境界の要点: Search は「全社が読める/権限者が一部書ける」、admin+worker は「法務だけが完全機能を使える」。worker の webhook だけが公開で、それ以外の worker/admin-ui 経路は法務限定。

---

## 10. 独立化リファクタの実行段取り

### 原則
- **依存は1本ずつ切る**。各ステップは**独立デプロイ・ロールバック可能**に。
- frozen worker への改修(C2 / C3 / D1撤去)は **「独立化のための一度きり」**。その後に凍結。
- 切替は可能な限り**設定/フラグ**で行い、即時ロールバックできるようにする(`apiRouter` の `VITE_API_READ_URL`/`WRITE_URL`、テンプレ読取元フラグ等)。

### フェーズ計画
| Phase | 目的 | 含む項目 | 前提(gate) | worker改修 | リスク |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0. 基盤** | migrationランナー + ロール / CI-CD独立トリガ | D2, D4(一部) | ― | `initDb` 無効化(boot) | 中 |
| **1. テンプレDB化** | `document_templates` 投入(挙動不変) | A1, A2 | Phase0 | ― | 低 |
| **2. 依存断ち** | 2スタックが互いを HTTP で呼ばなくする | B2, C3, C2, C1 | Phase1(B2/C3)、**C2→C1** | C2, C3 | 中 |
| **3. 書込一本化** | マスター書込を Search 単一所有に | B4, D1撤去 | Search master write 完備 | D1撤去 | 中 |
| **4. 育成 + 凍結** | Search専用フロント / IAM境界 / worker凍結 | B1, B3, B5, C4, D4 | Phase2,3 | ― | ― |

### 依存(gate)関係
```
D2(migration基盤) ─┬─→ A1/A2(テンプレDB) ─┬─→ B2(Search proxy撤去→DB直読)
                    │                       └─→ C3(worker をDBテンプレ読みに)
                    │
C2(worker read superset 補完) ──→ C1(admin-ui を worker 専用に振替)
B4(Search master write 完備) ──→ D1撤去(worker 旧マスターCRUD除去)
```
- **C1 は C2 の後**(worker が必要な read を全部持ってから admin-ui を切替えないと 404)。
- **B2 / C3 は A1/A2 の後**(DB にテンプレが入ってから読取元を切替)。
- **D1撤去は B4 の後**(Search が確実にマスターを書けるようになってから worker 書込を外す)。

### 各 cut の可逆性(ロールバック手段)
| cut | 切替方法 | ロールバック |
| :--- | :--- | :--- |
| C1 admin-ui→worker専用 | `apiRouter` の READ_URL を worker に向ける(env) | READ_URL を search-api に戻す |
| B2 Search テンプレ proxy撤去 | テンプレ読取元フラグ DB/proxy | フラグを proxy に戻す |
| C3 worker テンプレDB読み | 読取元フラグ DB/disk | disk に戻す(移行期は両対応) |
| D1撤去 worker旧CRUD | まず read-only化 → 後に削除 | read-only 解除 |

### 検証ゲート(各 Phase 完了条件)
- Phase 2 後: **Search と worker が互いを一切 HTTP で呼ばない**ことをログ/ネットワークで確認(独立達成の定義)。
- Phase 3 後: マスター更新が **Search 経由のみ**で反映され、worker 経由の旧書込が無いことを確認。
- 各 Phase: 両スタックを**個別にスモークテスト**(片方停止でもう片方が動く)。

### スキーマ刷新との関係
作品中心スキーマ(`schema-redesign-proposal.md`)の適用は **Phase0 の migration 基盤を共有**し、Phase1 以降と**並行**で進む(新テーブルは Search が使用、凍結 worker は互換ビュー)。サービス分離とスキーマ刷新は独立した2トラックだが、**migration ランナー(D2)を共通基盤**とする。

---

> 本ドキュメントはサービス役割分担の刷新提案。テーブル構造刷新案(`schema-redesign-proposal.md`)と対になる。
