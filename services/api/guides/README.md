# services/api/guides/ — 法務ポータル ガイド本文の置き場（DB 投入元）

法務ポータル(GAS 移植)の各ガイド本文をここに `<key>.html` として置きます。
**GAS(Google Apps Script)用に書かれた HTML をそのまま** 置いてください。
`<?!= include('common_top_tabs', ...) ?>` / `<?= appUrl ?>?page=KEY` / `{{JURISDICTION}}`
等のテンプレートタグは、配信時に search-api の `src/lib/portalRender.ts` が自動変換します。

## 仕組み（DB 化）

ファイルは「DB 投入の元データ」です。配信は **DB の現行版**(`portal_guide_versions`)から行います。

```
guides/<key>.html  ──(sync-guides-to-db.mjs)──▶  portal_guide_versions(版を追加)
                                                  portal_guides.current_version_id 貼替・status=published
                            search-api が現行版を portalRender で変換して配信(/g/<key>)
```

投入手順:

```bash
cd ~/LegalBridge_AI_GCP/migrations
# 1) 器とメタ(0093/0094)を適用
DATABASE_URL="postgresql://.../legalbridge" node run.mjs
# 2) このディレクトリの *.html を DB へ同期(版追加＋公開化)
DATABASE_URL="postgresql://.../legalbridge" node sync-guides-to-db.mjs
```

ファイルが**無い**ガイドは `status=draft`(準備中)のまま。ポータル/カテゴリページで
「準備中」表示になり、リンクは壊れません(配置→同期で自動的に公開中になります)。

## キー一覧（`<key>.html`）

| key | GUIDE | カテゴリ | ガイド名 | 状態 |
|-----|-------|----------|----------|------|
| `guide`     | 00 | （ご利用案内） | 法務部 実務ガイド ご利用案内 | 要配置 |
| `tetsuzuki` | 05 | A 取引を進める | ライセンス・業務委託 取引社内手続きガイド | 受領済 |
| `vendor`    | 03 | A 取引を進める | 新規取引先登録手続きガイド | 受領済 |
| `pub`       | 02 | A 取引を進める | 出版事業部 契約・書類発行フローガイド | 受領済 |
| `bg`        | 01 | B 契約を設計・理解する | BG事業部 契約スキーム実務ガイド | 受領済 |
| `clause`    | 06 | B 契約を設計・理解する | 契約書 条文解説ガイド | 受領済※ |
| `knowledge` | 09 | B 契約を設計・理解する | 法務ナレッジブック | 受領済 |
| `search`    | 07 | C 調べる・判定する | 法務データ検索ガイド | 未受領 |
| `torihiki`  | 04 | D 法律・コンプラ | 取引適正化・フリーランス法 実務ガイド | 受領済 |
| `eventinst` | 12 | D 法律・コンプラ | 試遊インストラクション 業務委託ガイド | 未受領 |
| `privacy`   | 10 | D 法律・コンプラ | 個人情報 運用ガイド（事業部向け） | 受領済 |

※ `clause.html` は GAS エクスポート時に `<body>` 直後へ別ページ(`#guide-portal`)の
  断片が混入しているケースがある。配置前に、本文(`#guide-clause` 以降の本体)以外の
  浮いた断片を除去すること。

### 除外したガイド（ポータルには載せない）

- `contractcheck`（基本契約範囲確認・文書判定）… 検索機能に集約のため削除。
- `related_party`（関連当事者取引 判定・決議）… 後日 書込を伴う独立アプリ化(release/worker)。

新しいガイドを追加する場合は、先に `migrations/0094_seed_portal_guides.sql` に
メタ行(key・カテゴリ・タイトル等)を足してから、`<key>.html` を置いて同期してください
(メタ未登録の key の html は sync スクリプトがスキップします)。
