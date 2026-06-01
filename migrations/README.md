# migrations/ — スキーマ migration 基盤(Phase 0 / D2)

DDL の**単一所有者**。アプリ(search-api / worker)は**起動時に migration しない**。
本ディレクトリのランナーが、順序付き・冪等な `NNNN_*.sql` を `schema_migrations`
基準で適用する。設計: `docs/service-architecture.md` §8。

## ファイル
| ファイル | 役割 |
| :--- | :--- |
| `run.mjs` | ランナー(`schema_migrations` 追跡、1ファイル=1トランザクション、checksum記録) |
| `0001_baseline.sql` | **現行スキーマのベースライン**(worker `initDb` から自動抽出。冪等) |
| `roles.template.sql` | DBロール定義テンプレ(手動適用・runner対象外・秘密情報を含むため) |
| `package.json` | `pg` 依存 + npm scripts |

> `0001_baseline.sql` は **手で編集しない**。再生成は `npm run extract-baseline`
> (`scripts/extract-baseline.mjs` が worker db.ts から再抽出)。

### Phase 1 追加分(テンプレDB化)
| ファイル | 内容 |
| :--- | :--- |
| `0002_document_templates.sql` | `document_templates` / `document_template_versions` + `documents.template_version_id`(§3.5) |
| `0003_seed_templates.sql` | 既存テンプレ(`templates_config.json` + `templates/*.html` + partials)を version 1 として投入(**自動生成**・冪等) |

> `0003` は手編集しない。再生成は `node scripts/seed-templates.mjs`
> (config + `services/worker/templates/` から再構築)。

## 使い方
```bash
cd migrations
npm install
DATABASE_URL='postgres://USER:PW@HOST:5432/legalbridge' npm run migrate:dry  # 保留分の確認
DATABASE_URL='postgres://USER:PW@HOST:5432/legalbridge' npm run migrate      # 適用
```
- 適用済みは skip。`schema_migrations` に version + checksum を記録。
- 適用済みファイルを後から編集すると checksum 不一致を警告(**migration は不変**。
  変更は新しい `NNNN_*.sql` を足す)。
- 本番は `lb_migrate` ロールの `DATABASE_URL` で実行。

## 新しい migration の足し方
1. `0002_xxx.sql`, `0003_xxx.sql` … と連番で追加(additive / 冪等を推奨)。
2. 新スキーマ(works/contracts/payments …)= `schema-redesign-proposal.md`。
3. 読取専用の互換ビュー(`contract_capabilities` 等)もここで定義(§8.2)。
4. worker が**書く**旧テーブルはビュー化不可 → worker の書込先差し替え(§7.3 / §10 C5)。

## 既存DBへの初回適用(ベースライン整合)
`0001_baseline.sql` は冪等(`IF NOT EXISTS`)なので、既存本番に流しても no-op。
初回 `migrate` で 0001 が `schema_migrations` に記録され、以後は新規分のみ適用。

## アプリ側 initDb の無効化(段階移行)
worker の起動時 `initDb()` は環境変数 `RUN_INIT_DB` で制御:
- 既定(未設定 or `true`): 現行どおり起動時に DDL を流す(後方互換)。
- ランナー検証後に `RUN_INIT_DB=false` を設定 → worker は DDL を触らない(§8.5 step3)。

## ロール(§8.4)
| ロール | 権限 | 主体 |
| :--- | :--- | :--- |
| `lb_migrate` | DDL | このランナー |
| `lb_search` | 自所有テーブル DML + SELECT/ビュー | Search |
| `lb_worker` | 自所有テーブル DML + 互換ビュー SELECT | worker |

ロール作成は `roles.template.sql`(手動)。table 単位の GRANT 厳格化は
Phase 3(C5/D1)で `00NN_grants.sql` として版管理する。
