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
| **C. admin+worker(凍結)** | C1 | admin-ui の振り分けを **worker のみ**へ(search-api依存除去) | admin-ui(apiRouter) | ― | ★★★ |
| | C2 | worker が **全 read endpoint を持つ superset** であることの担保(search-api専用readの補完) | worker | **要(一度)** | ★★☆ |
| | C3 | worker の文書生成を **DBテンプレ取得**に改修(現状ディスク読み) | worker | **要(一度)** | ★★★ |
| | C4 | 法務のみアクセスの IAP/IAM 制限(Backlog webhook は開放維持) | IAP/IAM | ― | ★★☆ |
| **D. 横断(MECE境界)** | D1 | **書き込み所有の一本化**: masters=Search / 課題・文書・稟議・採番=worker。worker のレガシー vendor CRUD は read-only化 or 撤去(**二重writer解消**) | 方針決定 | **要(一度)** | ★★★ |
| | D2 | **migration 所有の決定**: 新スキーマは Search が使用 → migration を Search 移管 or 専用 job。凍結 worker は**互換ビュー**で延命(スキーマ刷新 §8 と連結) | 方針決定 | ― | ★★★ |
| | D3 | 共有コード/重複の方針: `services/api/lib/db.ts`(836) と `services/worker/lib/db.ts`(2105) の重複 → 共有lib化 or 意図的分岐(Search=新スキーマ / worker=互換ビュー) | 方針決定 | ― | ★★☆ |
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

> 本ドキュメントはサービス役割分担の刷新提案。テーブル構造刷新案(`schema-redesign-proposal.md`)と対になる。
