# Phase 6 API・認証 実行計画（BFF同一オリジン化と共有秘密の撤去）

> 修正計画書 [`legalbridge-remediation-plan-20260714.md`](./legalbridge-remediation-plan-20260714.md)
> §8「API・認証・キャッシュ」/ §9 Phase 6 の実行管理。

| 項目 | 内容 |
|---|---|
| 目的 | ①`window.fetch` monkey-patch への依存停止 ②ブラウザ配布共有秘密の廃止 ③ドメインAPIクライアントへの段階移行 |
| 作成日 | 2026-07-16 |

## 1. 現状棚卸し（2026-07-16 時点）

### 1.1 API 経路

- admin-ui(React) の `fetch("/api/...")` は **204 箇所**。`src/lib/apiRouter.ts` の
  monkey-patch が起動時に window.fetch を差し替え、regex 規則で
  search-api(read) / document-worker(write) の `*.run.app` URL へ**ブラウザから直接**振っていた。
- 規則: WRITE_PATHS_ON_GET(worker のみ実装の GET) / READ_PATHS_ON_GET(search-api 専用 read) /
  READ_PATHS_ON_POST(D1: Search がマスター書込を所有) + C1 フラグ(既定 GET→worker)。

### 1.2 認証(修正前)

- **ブラウザ配布共有秘密**: Cloud Build が Secret Manager(lb-portal-secret) から
  `VITE_API_PORTAL_SECRET` を JS バンドルへ焼き込み、apiRouter が全 /api リクエストに
  `X-LB-PORTAL-SECRET` を付与。search-api の `requireIapUser` は portal_secret を
  **全ロール審査バイパス(admin 相当)** として受け入れる。
  → バンドルを取得できる者は誰でも秘密を抽出でき、search-api に admin 相当でアクセス可能(LB-08系の主要リスク)。
- worker は `--allow-unauthenticated` でアプリ内認証なし。
- admin-ui ホスト(ルート server.ts)は薄い Express。`LB_PORTAL_SECRET` は
  サービス env として既にバインド済み(/whoami の role 解決で使用)。

## 2. 第1弾(実装済 2026-07-16): 同一オリジン BFF 化

**アーキテクチャ**: ブラウザ → admin-ui オリジン(相対 /api/*) → server.ts の BFF プロキシ →
search-api / document-worker。計画 §8 の「UI向けBFF」の最小実装。

- `src/lib/apiRoutingRules.ts`(新規): 振り分け規則の**単一ソース**。
  apiRouter(休眠側)と server.ts(正本側)の両方が import する。
  **凍結ルール: 新規ルート規則はこのファイルにのみ追加する。**
- `server.ts`: `/api/*` を規則で read/write へ**ストリーミング転送**
  (multipart/CSV/PDF 透過、hop-by-hop ヘッダ除去、302s タイムアウト、502 変換)。
  `X-LB-PORTAL-SECRET` は**サーバ env から付与**(クライアント指定は常に上書き=偽装不可)。
  `ADMIN_UI_ENFORCE_ROLE=true` のときは /api プロキシも admin 限定(60秒ロールキャッシュ)。
  接続先は env `API_READ_URL` / `API_WRITE_URL` / `API_READS_TO_WORKER`(既定1)で上書き可。
- `src/lib/apiRouter.ts`: `VITE_API_SAME_ORIGIN=1`(本番既定)で **monkey-patch 休眠**。
  ロールバック用に残置(規則の実体は apiRoutingRules.ts へ移動済み)。
- `cloudbuild.yaml`: `inject-portal-secret` ステップ撤去 → **秘密のバンドル焼き込み廃止**。
- `Dockerfile`: apiRoutingRules.ts をランタイムイメージへ同梱。
- `.env.production`: `VITE_API_SAME_ORIGIN=1` 追加。`VITE_API_READ_URL` は
  外部リンク(検索ポータル導線: Sidebar / ImportPage / VendorsPanel)用に残す。

**効果**: ①ブラウザ配布物から秘密が消える ②CORS/直叩き前提が消え same-origin に
③monkey-patch は休眠(凍結) ④`ADMIN_UI_ENFORCE_ROLE` で API 面も admin ゲート可能。

**検証(ローカルE2E)**: v3→read / matters→write / 既定GET→write / master/vendors POST→read、
サーバ側シークレット付与とクライアント偽装の上書き、JSON・multipart(5KBバイナリ)の透過、
/api/status ローカルヘルス維持、バンドルに秘密値なし・休眠ログあり。

**ロールバック**: `.env.production` から `VITE_API_SAME_ORIGIN` を除去し、
cloudbuild.yaml の inject ステップを git 履歴から復元して再ビルド(旧経路が完全復活)。

## 3. 次スライス

| スライス | 内容 | 状態 |
|---|---|---|
| 第1弾 | 同一オリジン BFF + 秘密のバンドル焼き込み廃止(上記) | 実装済 |
| 第2弾 | **IAP/入口の締め**: admin-ui を IAP 配下に置き `ADMIN_UI_ENFORCE_ROLE=true`(HTML+APIともadmin限定)。search-api 側 portal_secret 受け入れ経路の縮小(admin-ui BFF の egress のみに限定する運用 or サービス間 ID トークン化)。worker のサービス間認証(ID トークン)導入検討 | 未着手(GCP設定が主) |
| 第3弾 | **ドメインAPIクライアント**: `src/lib/api/`(matterClient / documentClient / conditionClient / fileClient)を導入し、fetch 204箇所を段階移行。mutation 後の invalidate 規則(TanStack Query)をクライアント層で定義 | 未着手 |
| 第4弾 | 共通 DTO / validation / mapping の shared package 化、AppDataContext の縮小 | 未着手 |

## 4. 運用メモ

- admin-ui サービスに必要な env(既存バインドで充足): `LB_PORTAL_SECRET`(secret)。
  任意: `API_READ_URL` / `API_WRITE_URL` / `API_READS_TO_WORKER` / `ADMIN_UI_ENFORCE_ROLE`。
- search-api / worker の Cloud Run URL 変更時は admin-ui の env 変更のみで追従可能
  (再ビルド不要になった。旧方式はバンドル焼き込みのため再ビルドが必要だった)。
- 「新しい /api ルートを追加したら 404/振り分け違い」のときは apiRoutingRules.ts を疑う
  (既定: GET=read(C1でworker) / 変更系=write)。
