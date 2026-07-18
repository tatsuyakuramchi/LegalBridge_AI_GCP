# E2E (Playwright) — 設計 v1.4 UI 変更の実機スモーク検証

デプロイ済みの admin-ui に対して、設計 v1.4 で入れた UI 変更（UIC-03/04/05/06/07・FRM-04・UIC-12）が
実際に効いているかを自動で確認するスイート。admin-ui は Cloud Run に `--allow-unauthenticated` で出ており、
クライアント側のログイン壁も無いため、**URL を指定すれば認証情報なしで実行できる**。

## セットアップ

```bash
npm install                 # devDependencies に @playwright/test が入る
npm run e2e:install         # chromium を取得(初回のみ / = npx playwright install chromium)
```

## 実行

```bash
# 本番/ステージングの admin-ui URL を指定
E2E_BASE_URL="https://<admin-ui-url>" npm run e2e

# ローカル(npm run dev / start で 8080 に立てた場合)
E2E_BASE_URL="http://localhost:8080" npm run e2e

# UIモードでデバッグ
E2E_BASE_URL="https://<admin-ui-url>" npm run e2e:ui

# 単一ファイル
E2E_BASE_URL=... npx playwright test e2e/uic07-matters-nested.spec.ts
```

レポート（失敗時のスクショ/動画/trace 付き）は `playwright-report/` に出力される。

## 設計方針（重要）

- **非破壊が既定**。DOM 構造・CSS(computed style)・挙動（クリック/フォーカス）の assert が中心で、
  文書生成や素材作成のような本番データを増やす操作は既定で行わない。
- 破壊的フロー（UIC-05 の下書き作成）は `E2E_ALLOW_MUTATION=1` のときだけ有効（**ステージング推奨**）。
- 前提データが要るテスト（案件が0件、課題が0件、原作が0件など）は自動で `skip` する。
  → 「skipped」は失敗ではない。前提データのある環境で実行すること。

## カバレッジ

| ファイル | 対象 | 種別 |
|---|---|---|
| `uic07-matters-nested.spec.ts` | UIC-07 案件一覧のネスト interactive 解消（overlay button＋独立統合ボタン、キーボード） | 非破壊 |
| `uic04-sticky-actionbar.spec.ts` | UIC-04 Document Editor アクションバーの sticky 化 | 非破壊 |
| `frm04-pub-license.spec.ts` | FRM-04 出版利用許諾条件書の Schema 描画 ＋ UIC-12 旧URLリダイレクト | 非破壊 |
| `uic03-materials-crud.spec.ts` | UIC-03 素材CRUD限定（旧金銭条件エディタ撤去・文書CTA） | 非破壊(要 原作データ) |
| `uic06-readonly.spec.ts` | UIC-06 true readonly（fieldset disabled） | 非破壊(要 課題データ) |
| `uic05-matter-draft.spec.ts` | UIC-05 案件のみ下書き 保存→一覧→再開 | **破壊的**(要 `E2E_ALLOW_MUTATION=1` ＋ `E2E_MATTER_ID_NO_ISSUE`) |

## 環境変数

| 変数 | 用途 |
|---|---|
| `E2E_BASE_URL` | 対象 admin-ui の URL（既定 `http://localhost:8080`） |
| `E2E_ALLOW_MUTATION` | `1` で破壊的テスト（下書き作成）を有効化 |
| `E2E_MATTER_ID_NO_ISSUE` | UIC-05 用。Backlog 課題の無い案件の `matter_id` |

## 注意

- セレクタはアプリのテキスト/ロール/aria に依存しているため、UI 文言変更時は追随が必要。
  初回実行でセレクタずれが出たら、該当 spec のコメントを参照して調整すること。
- CI から回す場合は `.github/workflows/e2e.yml`（`workflow_dispatch`）を使う。URL を入力して手動実行できる。
