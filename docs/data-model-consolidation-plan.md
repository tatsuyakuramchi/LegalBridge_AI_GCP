# データモデル整理・テーブル構造シンプル化 移行計画書

> 対象: LegalBridge AI (PostgreSQL / Cloud SQL) — worker / search-api / admin-ui
> 目的: **「同じ内容が複数テーブルに重複保管され、経路ごとにキー名・書き方が違う」** ことに起因する
> ドリフト不具合（件名・発注日・明細が編集で空になる／検収待ちに出る・出ない 等）を根絶し、
> 最終的にテーブル構造をシンプル化する。
> 長期の理想形（作品=Work 中心の再正規化）は `docs/schema-redesign-proposal.md` を北極星とし、
> 本書はそこへ至る **低リスク・段階移行の実行計画** を定義する。

最終更新: 2026-06-07 / ステータス: **合意済み・Step 1 着手前**

---

## 0. 用語

- **正準（SSOT, Single Source of Truth）**: 業務ロジック上「正」とするデータの置き場所。本計画では **`contract_capabilities` ＋ `capability_*` 系**を正準とする。
- **スナップショット**: 発行時点の内容を固定保存する複製。`documents.form_data` がこれにあたり、**意図的に残す**（法的文書として「実際に出した内容」を保持する役割）。
- **ミラー**: トリガ等で自動複製される派生。`contracts` / `contract_*`（v3）など。

---

## 1. 現状マップ（調査結果）

### 1.1 同一内容を別テーブルで持っている箇所

| # | 重複 | 同期方法 | 性質 | リスク |
| :-- | :-- | :-- | :-- | :-- |
| ① | `documents.form_data`(JSONB) ⇄ `contract_capabilities`＋`capability_line_items`/`_expenses`/`_other_fees`/`_financial_conditions` | **手動・経路ごとにバラバラ** | 一部は意図的(発行スナップショット) | **高** |
| ② | `contract_capabilities` → `contracts` | トリガ `trg_sync_contracts`(INSERT/UPDATE) | 純粋ミラー | 中(DELETE非同期=孤児) |
| ② | `capability_financial_conditions` → `contract_financial_terms` | トリガ `trg_sync_cft` | 純粋ミラー | 中 |
| ② | `capability_line_items` → `contract_line_items` | トリガ `trg_sync_cli` | 純粋ミラー | 中 |
| ② | `royalty_calculations` → `royalty_statements` | トリガ `trg_sync_royalty_statements` | 純粋ミラー | 中 |
| ② | `royalty_payments` → `payments` | トリガ `trg_sync_payments` | 純粋ミラー | 中 |
| ③ | `capability_line_items`(flow_direction=out / is_inbound) → `sublicense_deals`(請求権台帳) | アプリ(source_line_item_id で冪等) | 派生取込 | 中 |
| ③ | `capability_line_items` → `delivery_events` / `delivery_line_items`(検収) | アプリ | 派生実績 | 中 |
| ④ | `document_drafts` ⇄ `documents` | アプリ(発行成功で draft 削除) | 下書き | 低 |
| ④ | `documents` ⇄ `external_assets` | アプリ | 資産レジストリ | 低 |
| ⑤ | ~~`order_items`/`order_line_items`~~ → capability | Phase 23 廃止 | レガシー | 低(撤去対象) |
| ⑤ | ~~`license_contracts`~~ → `contract_capabilities`(license) | Phase 23 移行 | レガシー | 低(撤去対象) |

### 1.2 ① のキー名ドリフト（不具合の主因）

同じ概念を **documents.form_data と capability で別名**で持っているため、経路（通常作成 / インポート）で食い違う。

| 概念 | `documents.form_data`（B） | `contract_capabilities`系（C, 正準候補） |
| :-- | :-- | :-- |
| 明細 | `items`（通常作成）/ `line_items`（インポート） | `capability_line_items` |
| 経費 | `expenses` | `capability_expenses` |
| その他手数料 | `other_fees` | `capability_other_fees` |
| 件名 | `PROJECT_TITLE` / `CONTRACT_TITLE` | `contract_title` |
| 発注日 | `発注日` / `order_date` | `issue_date_po` |
| 検収者 | `inspectorName/Dept/Email` | (staff 経由) |
| 検収日 | `inspectionCompletedAt` | `delivery_events` 等 |

> これまでの個別パッチ（件名・発注日・明細・検収書まわり）は、B↔C を**その都度フォールバック／両書き**して凌いだもの。本計画で恒久解決する。

### 1.3 書き込み経路の現状

- **通常作成** `POST /api/documents/generate`(worker): `documents` 書込 → `external_assets` → `contract_capabilities` upsert → `formData.items` があれば `capability_line_items` を DELETE+INSERT → flow_direction/financial_conditions 同期。
- **一括インポート** `POST /api/imports/v2/bulk`(worker, `importsV2.ts`): `contract_capabilities`＋`capability_*` を直接 INSERT → `documents`(form_data) → `external_assets`。
- **一括検収** `POST /api/imports/bulk/inspection`(worker): `delivery_events`/`delivery_line_items` ＋ `documents`(inspection_certificate) ＋ `legal_requests`。
- **下書き** `POST /api/document-drafts`: `document_drafts`。
- ② のミラーは `migrations/0012_sync_triggers.sql`。

---

## 2. 目標（最終形の方針）

1. **C（capability 系）を唯一の正準**にする。業務ロジック（検収・台帳・検索・金額計算）は C のみを読む。
2. **B（documents.form_data）は「発行済スナップショット」専用**に役割を限定する。
   - 発行時に **C から決定論的に生成**する（B を手で組み立てない）。
   - 発行後の B は不変（過去に出した書面を保持）。編集＝新リビジョンとして C を更新し、再発行時に B を作り直す。
3. **キー名を統一**（B 内も含め、`items`/`line_items` 等の揺れを撤廃）。
4. **②ミラー（contracts/contract_*）は、読み手を C に寄せて最終的に廃止**（または DELETE 同期を入れて孤児を止める）。
5. **レガシー（⑤）を物理削除**。
6. 長期的には `docs/schema-redesign-proposal.md` の Work 中心モデルへ接続。

---

## 3. 段階移行プラン

各 Step は**独立して価値があり、いつでも止められる**ように設計する。スキーマ変更は後段に寄せ、前段はコード（挙動）で安全に進める。

### Step 1 — SSOT 変換の集約（スキーマ変更なし・最優先）
**狙い**: ① のキー名ドリフトを根絶。

- `form_data ⇄ capability` の相互変換を **1モジュールに集約**（例: `services/worker/src/lib/capabilityFormMapping.ts`）。
  - `formToCapability(templateType, formData)`: 明細/経費/手数料/金額/日付/件名 を正準の形へ。
  - `capabilityToForm(templateType, capability, lines, ...)`: 発行スナップショット用 form_data を生成。
  - **キー別名の吸収表**（items↔line_items、発注日↔issue_date_po、PROJECT_TITLE↔contract_title …）をこの1箇所に集約。
- 既存の各経路（generate / importsV2 / bulk inspection / bulk-update-fields / 編集プレフィル）を、**このモジュール経由に置き換え**。
- **受け入れ条件**: 通常作成・インポートのどちらで作っても、編集で開いた時に 件名・発注日・明細・検収者 が同じキーで揃って表示される。検収待ち/条件明細に出る条件が経路非依存。
- **リスク**: 低（テーブル不変）。ロールバックは旧コードに戻すだけ。

### Step 2 — レガシーテーブル撤去（軽いスキーマ変更）
**狙い**: 見かけ上の重複を減らす。

- 使用実態を棚卸し（grep＋本番参照）した上で、未使用が確定したものを `DROP TABLE`（冪等マイグレーション）。
  - 候補: `order_items`, `order_line_items`, `license_contracts`, `license_financial_conditions`（移行済みであること、孤児FK列の参照が無いことを確認）。
- **受け入れ条件**: 3サービスのビルド・主要画面が無影響。
- **リスク**: 低〜中。先に「読んでいる箇所ゼロ」をコードで証明してから実施。

### Step 3 — v3 ミラー（②）の収束（中規模・要判断）
**狙い**: 純粋重複と「DELETE非同期の孤児」を解消。

1. まず **`contracts` / `contract_line_items` / `contract_financial_terms` を読んでいる箇所の棚卸し**（作品モデル/契約検索ビュー等）。
2. 方針を二択で決定:
   - (a) 読み手を C（capability）へ移植 → **ミラー＆5トリガを廃止**（推奨・最終シンプル化に直結）。
   - (b) ミラーを残すなら **DELETE 同期トリガを追加**して孤児を止める（暫定）。
- **受け入れ条件**: 作品モデル/契約系画面が C 由来で同等表示。マージ/削除で孤児が出ない。
- **リスク**: 中。読み手棚卸しが前提。

### Step 4 — カラム整理・正準集約（仕上げ）
**狙い**: B から構造化データの重複を外し、スナップショット専用に縮小。

- B（form_data）から「明細配列など構造化データ」を**発行時生成に切替**（編集中は C を編集、発行時に C→B 生成）。
- 自由記述の重複列（`work_name`/`original_work`/`product_name` 等）を正準FK（ledger/work）へ寄せる（`schema-redesign-proposal.md` と接続）。
- **リスク**: 中〜高。Step 1〜3 完了後に着手。

---

## 4. 横断ルール（全 Step 共通）

- **冪等マイグレーション**（`IF EXISTS`/`IF NOT EXISTS`）。1ファイル1目的。
- **後方互換の期間を設ける**: 読み手移行 → 書き手移行 → 旧構造削除、の順（同時破壊変更を避ける）。
- **デプロイ順序**: スキーマ追加(additive) → search-api(読) → worker(書) → 旧削除。破壊的変更は最後。
- **検証**: 各 Step で esbuild/tsc/vite ビルド ＋ 主要画面の手動確認。可能なら整合性チェッククエリ（B と C の差分検出）を用意。
- **ロールバック**: Step 1〜2 はコード revert で戻る。Step 3〜4 は事前に `pg_dump` 断面を取得。

---

## 5. 進捗

| Step | 内容 | 状態 |
| :-- | :-- | :-- |
| 1 | SSOT 変換の集約（form_data ⇄ capability） | **実装中（発注書・検収書 完了）** |
| 2 | レガシーテーブル撤去 | **完了（0030 で DROP）** |
| 3 | v3 ミラー収束（読み手棚卸し → 廃止/DELETE同期） | 未着手 |
| 4 | カラム整理・正準集約 | 未着手 |

### Step 2 実装メモ（2026-06-07）
- コード棚卸し結果: `order_items` / `order_line_items` / `license_financial_conditions` は
  実 SQL 参照ゼロ。`license_contracts` は唯一 to_regclass ガード付きバックフィル（royalty_calculations）
  からのみ参照。いずれも CREATE 文なし・残存 FK なし・新規 DB に存在しない。
- 新規マイグレーション `migrations/0030_drop_legacy_tables.sql`:
  - 撤去前に license_contracts→royalty_calculations.capability_id バックフィルを最終再実行(idempotent)
  - `DROP TABLE IF EXISTS order_line_items / order_items / license_financial_conditions / license_contracts CASCADE`
- 適用: schema は `migrations/` ランナー（worker デプロイ・パイプライン）が単一所有（`initDb` は実行スキップ）。
- 確認: 連結チェック画面の「レガシー残存」は、撤去後 to_regclass NULL → 0 件表示になる。

### Step 1 実装メモ（2026-06-07）
- 新規: `services/worker/src/lib/capabilityFormMapping.ts`
  - `normalizeDocumentFormData(templateType, fd)`: 別名キーを additive に相互補完
    （発注書: items↔line_items / PROJECT_TITLE↔CONTRACT_TITLE↔contract_title / 発注日↔order_date、
     検収書: orderDate↔order_date）。
  - `extractCapabilityFields()`: 経路非依存で capability 構造化フィールドを抽出（Step 2 以降で使用）。
- 配線:
  - `importsV2.ts`（書込）: 保存 form_data を normalize → インポート発注書にも `items` が入る。
  - `server.ts maybeGeneratePdfForImport`（PDF）: normalize → **インポート発注書PDFの明細表が空になる潜在バグを解消**
    （テンプレは `{{#each items}}` を読むため）。
  - `server.ts GET /api/documents/:id`（読込）: normalize → 経路に依らずエディタが同じキーで読める。
  - `server.ts generate`（通常作成・書込）: 保存 form_data を normalize。
- 残: Step 1 の対象拡大（他テンプレ）、`extractCapabilityFields` を使った各書込経路の capability 正準寄せは Step 4 で。

### 連結チェック＆修復ツール（2026-06-07 追加）
全 Step を横断する点検・修復の入口として **「連結チェック」画面**を新設。
- 画面: 左メニュー Configuration → **連結チェック**（`/data-linkage`）
- API(worker): `GET /api/admin/data-linkage/check` / `POST /api/admin/data-linkage/repair`
- モジュール: `services/worker/src/routes/dataLinkage.ts`
- 検出: form_data別名ドリフト(発注書) / v3ミラー孤児(contracts) / 発行済なのに残る下書き /
  検収・請求権の孤児参照 / capability未連結の発注書 / documents未連結のcapability / レガシー残存(order_items, license_contracts)
- 安全修復: normalize_documents / normalize_drafts / prune_orphan_contracts /
  prune_stale_drafts / fix_orphan_refs（発行済正本は変更しない）
- 用途: **将来テーブル統合を進める際の事前点検＆掃除の入口**（Step 2/3 の前提確認に使う）。

> 次アクション: **Step 2**（レガシーテーブル `order_items`/`order_line_items`/`license_contracts` 等の使用実態棚卸し → 未使用確定後に冪等 DROP）。連結チェックの「レガシー残存」件数が 0 か、まずここで確認できる。
