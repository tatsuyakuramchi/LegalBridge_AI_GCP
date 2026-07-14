# LegalBridge AI — Phase 0 基準固定インベントリ

**修正計画書 [`legalbridge-remediation-plan-20260714.md`](./legalbridge-remediation-plan-20260714.md) §9 Phase 0「基準固定」の実施記録**

| 項目 | 内容 |
|---|---|
| 対象 | `tatsuyakuramchi/LegalBridge_AI_GCP` |
| 基準ブランチ | `main`(PR #292 時点) |
| マイグレーション範囲 | `0001`–`0125`(計129 SQLファイル) |
| 作成日 | 2026-07-14 |
| 版 | 1.0 |
| 目的 | 実装着手前に現状(実表・VIEW・トリガ・関数・読書箇所・テンプレ・設計資料)を確定し、修正計画の前提を検証する |
| 親計画 | [`legalbridge-remediation-plan-20260714.md`](./legalbridge-remediation-plan-20260714.md) |

> [!IMPORTANT]
> 本書は Phase 0 の成果物であり、コード/DBは変更しない**棚卸し記録**である。Phase 1 以降の実装は本書の現状把握を前提とする。数値・行番号は上記基準時点のもの。

---

## 0. Phase 0 タスクの実施状況

計画 §9 Phase 0 の5タスクに対する本書のカバレッジ:

| # | Phase 0 タスク | 状態 | 参照 |
|---|---|---|---|
| 1 | 本番 Cloud SQL の migration 適用履歴を確認 | ⚠ **要手動**(この環境に gcloud/DB 接続なし) | §1.1 に確認手順を記載 |
| 2 | 実テーブル・VIEW・トリガ・関数を一覧化 | ✅ 完了 | §1 |
| 3 | documents / condition_lines / 互換VIEW への読取・書込箇所を棚卸し | ✅ 完了 | §2 |
| 4 | テンプレートごとに Schema移行・必須項目・direction適用・Matter依存を一覧化 | ✅ 完了 | §4 |
| 5 | 設計資料の正本を一本化し、旧資料へ Superseded 表記 | ✅ 完了(表記付与は別コミット) | §5 |

---

## 1. DB オブジェクト・インベントリ

マイグレーションは `migrations/run.mjs` が単独所有し、適用履歴を **`schema_migrations`**(`version` / `checksum` / `applied_at`)で追跡する。各ファイルは独立トランザクション・チェックサム記録・冪等(適用済みはスキップ)。本番では `Dockerfile.migrate` の Cloud Run Job（`lb_migrate` ロール）として実行。アプリ2サービスは起動時マイグレーションを行わない(`docs/service-architecture.md` §8 D2)。

### 1.1 本番適用履歴の確認手順（⚠ 要手動）

この作業環境には gcloud / DB 接続が無いため、本番の適用状況は未確認。GCP Console / Cloud SQL 接続がある端末で以下を実施する:

```sql
-- 適用済みバージョンと適用日時（0125 まで載っているのが期待値）
SELECT version, applied_at FROM schema_migrations ORDER BY version;
```

```bash
# 未適用マイグレーションの有無（何も出なければ最新）
DATABASE_URL=postgres://... node migrations/run.mjs --dry-run
```

**確認観点**: `0121`(ILT v3 テンプレDB同期)・`0122`(documents.master_document_number)・`0123`–`0125`(発注書/業務委託テンプレDB同期)が本番に反映済みか。テンプレはDB配信(`TEMPLATE_SOURCE=db`)のため、未適用だと画面/PDFに反映されない。

### 1.2 実テーブル（約80）

`ledgers` / `works` / `source_ips` / `source_ip_materials` / `materials` / `material_categories` / `products` / `vendors`(+ `vendor_addresses` / `vendor_bank_accounts` / `vendor_contacts` / `vendor_shareholdings`) / `staff` / `officers` / `documents` / `document_templates` / `document_template_versions` / `document_sequences` / `document_drafts` / `document_sends` / `condition_lines` / `condition_events` / `condition_receipts` / `condition_line_installments` / `matters` / `matter_issues` / `contracts` / `contract_parties` / `contract_financial_terms` / `contract_line_items` / `contract_works` / `contract_obligations` / `contract_scopes` / `contract_purposes` / `contract_stage_history` / `contract_decision_logs` / `deliverables` / `deliverable_revisions` / `delivery_events` / `delivery_line_items` / `invoices` / `payments` / `statements` / `royalty_calculations` / `royalty_payments` / `royalty_statements` / `sublicense_deals` / `sublicense_sales_reports` / `sublicensees` / `sales_events` / `manufacturing_events` / `receivable_statuses` / `legal_requests` / `issue_workflows` / `department_workflow_rules` / `ringi_*` / `signature_requests` / `signature_steps` / `cloudsign_requests` / `ip_registrations` / `external_assets` / `alerts` / `app_settings` / `master_sequences` / ほか。

> [!NOTE]
> **計画前提の検証(重要)**: 計画 §5/§9 の Phase 5 が「導入」とする `contracts` / `contract_parties` / `deliverables` / `deliverable_revisions` / `invoices` / `payments` は **既にテーブルとして存在**する。したがって Phase 5 の実態は「新規作成」ではなく **既存スキーマとの整合・接続**である。詳細は §3。

### 1.3 VIEW（9）

| VIEW | 実体/役割 | 導入 |
|---|---|---|
| `contract_capabilities` | `documents` の 1:1 ミラー(旧「契約器」名の互換) | 0101 |
| `capability_financial_conditions` | `condition_lines` ベースの互換VIEW | 0101 |
| `capability_line_items` | 同上(明細互換) | 0101 |
| `capability_expenses` | 同上(費用互換) | 0101 |
| `capability_other_fees` | 同上(その他料金互換) | 0101 |
| `condition_line_balance_v` | 条件明細の残高集計 | — |
| `condition_line_schedule_v` | 条件明細のスケジュール展開 | — |
| `condition_line_status_v` | 条件明細のステータス | — |
| `matter_overview_v` | 案件サマリ(課題数/文書数/条件数/最終送信) | 0102 |

### 1.4 トリガ（26）と関数（約28）

- **互換VIEW書込みトリガ（`INSTEAD OF`, 0101)**: `tg_cc_ins`(→`cc_compat_ins`) / `tg_cfc_ins|upd|del`(→`cfc_*`) / `tg_cli_ins|upd|del`(→`cli_*`) / `tg_exp_ins|upd|del`(→`exp_*`) / `tg_fee_ins|upd|del`(→`fee_*`)。旧 `capability_*` への書込みを実体表(`documents`/`condition_lines`)へ変換する。
- **二重書込み同期トリガ(`trg_sync_*`)**: `trg_sync_contracts`(→`lb_sync_contracts`) / `trg_sync_cft` / `trg_sync_cli` / `trg_sync_payments` / `trg_sync_royalty_statements` / `trg_sync_source_ip_to_work` と対応する `*_delete_*`。新旧構造の整合を保つ**二重書込み**であり、計画がレガシー撤去(Phase 7)で消したい対象。
- **業務トリガ**: `tg_doc_autolink_matter`(→`doc_autolink_matter`: 文書作成時に Matter 自動リンク) / `tg_lr_autocreate_matter`(→`lr_autocreate_matter`: 法務相談から Matter 自動生成) / `documents_auto_category`(→`lb_documents_set_category` / `lb_category_for_template`)。
- **条件明細ヘルパ関数**: `cl_dir` / `cl_scheme` / `cl_next_code` / `cl_resolve_work` / `cl_view_del` など。

---

## 2. 読取・書込箇所の棚卸し

サービスは `services/api`(4,728行) と `services/worker`(17,783行)の2つ。計画 §2.3 が言及する `search-api` は**現状リポジトリに存在しない**(過去設計の名残)。

### 2.1 互換VIEW(`contract_capabilities` / `capability_*`)への書込み — **102箇所 / 11ファイル**

| ファイル | 書込み数 |
|---|---|
| `services/worker/server.ts` | 54 |
| `services/worker/src/routes/importsV2.ts` | 17 |
| `services/api/src/routes/workModel.ts` | 12 |
| `services/worker/src/lib/db.ts` | 8 |
| `services/api/src/lib/db.ts` | 3 |
| `services/worker/src/services/csvImportService.ts` | 2 |
| `services/api/src/services/conditionsService.ts` | 2 |
| その他4ファイル | 各1 |

→ 互換VIEW経由の書込みが 100箇所超残存。計画の「互換依存削減」(Phase 4)・「レガシー撤去」(Phase 7)は、この 102箇所を実体表直書きへ移すのが具体作業。

### 2.2 正本テーブルへの書込み(`documents` / `condition_lines` / `matters` / `matter_issues`) — **111箇所 / 11ファイル**

集中箇所: `services/worker/server.ts`(55) / `services/api/src/routes/workModel.ts`(16) / `services/worker/src/routes/matters.ts`(16)。

### 2.3 `matter_id` 参照 — **42箇所 / 4ファイル**

`services/worker/src/routes/matters.ts`(20) / `services/worker/server.ts`(19) / `entityMerge.ts`(2) / `unifiedIssues.ts`(1)。

→ Matter 連携ロジックは worker に集中。計画 P0「文書生成時に `documents.matter_id` を保存」(LB-02)の改修点は `services/worker/server.ts` の文書生成経路。`documents.matter_id` 列は 0102 で追加済み(`ON DELETE SET NULL`)。

---

## 3. 修正計画の前提検証（差分メモ）

Phase 0 の重要成果として、計画本文と現状スキーマの食い違いを記録する。**Phase 1 着手前に計画側を補正すべき点**:

| 計画の記述 | 現状 | 補正 |
|---|---|---|
| §6.3「新規テーブル」`matter_tasks` / `document_files` / `audit_events` / `external_requests` / `matter_requests` | **5表とも未存在** | 記述どおり真に新規。着手可 |
| §6.1 `matters` へ列追加(`lifecycle_stage` / `owner_staff_id` / `target_due_date` / `blocked_reason` / `drive_folder_id` / `drive_folder_url` / `completed_at` / `completed_by` / `completion_reason`) | **全列未存在**。現行 `matters` は `status`(open/in_progress/closed/archived) のみ | 記述どおり新規追加。ライフサイクルは `status` との整合方針を決める必要あり |
| §5/§9 Phase 5「`contracts` / `contract_parties` / `deliverables` / `invoices` / `payments` を導入」 | **既にテーブルとして存在**(+ `trg_sync_*` で旧構造と二重書込み) | 「導入」ではなく**既存表の整合・正本化・二重書込み解消**へ読み替える |
| §2.3「worker と search-api に重複コード」 | **search-api は存在しない** | 対象は `api` / `worker` 2サービス間の重複に読み替え |
| §6.2 `documents.matter_id` 原則必須 | 列は存在(0102)だが **NULL 許容 / 生成時未保存の経路あり** | LB-02 で生成時保存を必須化。NOT NULL 化はバックフィル後 |

---

## 4. 文書テンプレート・インベントリ（全19）

`src/components/document/documentFormSchemas.ts` の REGISTRY(:269-297)に全19テンプレが登録。旧 `DocumentForm` 専用のものは無く、全て Schema 形式(専用ビルダー or AUTO ビルダー)。

### 4.1 一覧

| template_key | 表示名 | フォーム形式 | 請求方向(現状) | Matter依存 |
|---|---|---|---|---|
| `purchase_order` | 発注書(国内) | 専用Schema | 金銭・**"in"自動既定** | Backlog起点 |
| `intl_purchase_order` | 海外発注書 | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `inspection_certificate` | 検収書 | 専用Schema | 金銭・**"in"自動既定** | Backlog起点 |
| `license_master` | ライセンス利用許諾基本契約書 | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `service_master` | 業務委託基本契約書 | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `individual_license_terms` | 個別利用許諾条件書 | 専用Schema | 金銭・**"in"自動既定** | Backlog + 作品/素材リンク |
| `individual_license_terms_v3` | 個別利用許諾条件書 v3 | 専用Schema(v3) | 金銭・**"in"自動既定** | Backlog + 作品/素材リンク |
| `pub_license_terms` | 出版等利用許諾条件書 | AUTO | 金銭・**"in"自動既定** | Backlog起点 |
| `pub_additional_terms` | 追加利用許諾条件書 | AUTO | 金銭・**"in"自動既定** | Backlog起点 |
| `pub_master_individual` | 出版等許諾基本契約書(個人版) | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `pub_master_corporate` | 出版等許諾基本契約書(法人版) | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `sales_master_buyer` | 売買基本契約書(買手版) | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `sales_master_standard` | 売買基本契約書(売手・標準) | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `sales_master_credit` | 売買基本契約書(売手・掛け売り) | AUTO | 金銭(自動既定なし) | Backlog起点 |
| `royalty_statement` | 利用許諾料計算書 | 専用Schema | 金銭(自動既定なし) | Backlog + 契約/台帳リンク |
| `maintenance_spec` | システム保守仕様書 | 専用Schema | 金銭(自動既定なし) | Backlog起点 |
| `nda` | 秘密保持契約書(NDA) | AUTO | **非金銭** | Backlog起点 |
| `legal_response` | 法務相談 回答書 | AUTO | **非金銭** | Backlog起点 |
| `notice_consent_personal_info_freelance` | 個人情報利用同意書 | AUTO | **非金銭** | Backlog起点 |

### 4.2 非金銭テンプレート(direction を撤去すべき対象 — 計画 §5.5.4 `not_applicable`)

- `nda`(秘密保持契約書)
- `legal_response`(法務相談 回答書)
- `notice_consent_personal_info_freelance`(個人情報利用同意書)

現状これら3件でも請求方向が未選択だと生成不可 → LB-F04 の直接対象。

### 4.3 請求方向(FLOW_DIRECTION)の現行メカニズム — 変更対象の正確な位置

すべて `src/pages/DocumentEditorPage.tsx`:

| 箇所 | 内容 |
|---|---|
| `:125` | `selectedDirection` state(`"" \| "in" \| "out"`) |
| `:385-408` | 自動既定 useEffect。`purchase_order` / `inspection_certificate*` / `individual_license_terms` / `pub_license_terms` / `pub_additional_terms` を `"in"` に既定 |
| `:1101-1107` | 生成ハンドラで `if (!selectedDirection)` を検査し送信を拒否 |
| `:1220-1224` | `formData.FLOW_DIRECTION = selectedDirection` として worker へ送信 |
| `:1619-1636` | UI ドロップダウン(必須マーク付き) |
| `:2287` / `:2303` | 「Finalize & Sync」/「DB登録のみ」ボタンを `!selectedDirection` で無効化 |

→ LB-F03/F04 の実装は、テンプレ属性 `directionMode`(計画 §5.5.4)を導入し、`not_applicable` テンプレでは上記の必須検査・ボタン無効化・UI表示をスキップする。最終的な金銭方向は `condition_lines.direction` を正本とする(§5.5.4 末尾)。

---

## 5. 設計資料の棚卸しと正本一本化

`docs/` 配下に 38 の Markdown。アーキテクチャの**正本は本 remediation plan** に一本化する。

### 5.1 正本(NORTH STAR / 現行)

- **`docs/plans/legalbridge-remediation-plan-20260714.md`** — アーキテクチャ改修の**唯一の正本**(Matter中心, P0–P2)。
- `docs/schema-redesign-proposal.md` — 作品中心スキーマの北極星(参照として保持)。
- `docs/data-model-consolidation-plan.md` — 段階的統合の実行計画(保持)。

### 5.2 Superseded 表記を付与する対象(草案/未実装/ブロック中の4件)

いずれも draft/design 段階で未実装のため、本 remediation plan に包含される:

| ファイル | 理由 | Superseded by |
|---|---|---|
| `docs/design/schema-simplification-plan.md` | v0.1 草案・未実装。DB SSOT は計画 P0 が包含 | `docs/plans/legalbridge-remediation-plan-20260714.md` |
| `docs/work-unification-plan.md` | 草案・未実装。作品統合は計画 P2 が包含 | 同上 |
| `docs/design/unified-issue-ui-plan.md` | 草案(2026-06-25)。統一UIは計画 P1(Matterワークスペース)が包含 | 同上 |
| `docs/design/work-tables-consolidation-plan.md` | design段階・設計判断待ちでブロック。計画 P2 へ先送り | 同上 |

> 付与形式(計画 §文書管理ルール準拠): 各ファイル冒頭に `> **Superseded by:** docs/plans/legalbridge-remediation-plan-20260714.md（YYYY-MM-DD, Phase 0）` のバナーを追加(本文は削除しない)。**本コミットとは分離**して適用する。

### 5.3 現行として保持(実装ガイド/ランブック/マニュアル — 抜粋)

`condition_lines_*`(統一の設計→実装→ランブック→チェックリストの一連, `condition-line-spine-remediation.md` が最新後続) / `work-source-ip-unification.md`(v3.0 確定) / `work-3card-unified-editor-spec.md`(v1.0) / `document-first-material-linkage-plan.md` / `issue-control-consistency-{plan,remediation-record}.md` / `per-line-work-attribution-plan.md` / 各運用マニュアル(`operation-manual-adminui-worker.md` / `system-overview-and-manual.md` / `search-api-manual.md` / `keiri-db-catalog.md` / `legalon-import-runbook.md` / `phase0-deploy-runbook.md` 等) / `security-phase-17s.md` / `service-architecture.md`。

---

## 6. Phase 0 出口チェックリスト → Phase 1 への引き継ぎ

- [x] 実表・VIEW・トリガ・関数の一覧化(§1)
- [x] 互換VIEW/正本表の読書箇所の棚卸し(§2: 互換書込み102・正本書込み111・matter_id 42)
- [x] テンプレ×(Schema/必須/direction/Matter)一覧(§4)
- [x] 設計資料の正本一本化・Superseded 対象の特定(§5)
- [ ] **本番 `schema_migrations` の適用履歴確認(要手動, §1.1)** — 未完(環境制約)
- [ ] Superseded バナーの付与(§5.2, 別コミット)

### Phase 1 着手時の確定事項(本書由来)

1. **LB-F03/F04(請求方向のテンプレ別制御)** の変更点は `DocumentEditorPage.tsx:{385-408, 1101, 2287, 2303}` と非金銭3テンプレ(§4.2)。`directionMode` 属性を `documentFormSchemas.ts` のテンプレ定義に追加する。
2. **LB-02(生成時 matter_id 保存)** の改修は `services/worker/server.ts` の文書生成経路(`documents` 書込み)。列は 0102 で存在。
3. **Phase 5 の読み替え**: `contracts`/`invoices`/`payments` は新設ではなく既存(§3)。二重書込みトリガ `trg_sync_*` の扱いを設計に含める。
4. **互換依存の実数**: 撤去対象は互換VIEW書込み 102箇所(§2.1)。Phase 4/7 の作業量見積り基準とする。

---

## 参考(再現コマンド)

```bash
# 実表・VIEW・トリガ・関数
grep -rhoiE "CREATE TABLE (IF NOT EXISTS )?[a-z_]+" migrations/*.sql | sort -u
grep -rhoiE "CREATE (OR REPLACE )?VIEW [a-z_]+"      migrations/*.sql | sort -u
grep -rhoiE "CREATE TRIGGER [a-z_]+"                 migrations/*.sql | sort -u
grep -rhoiE "CREATE (OR REPLACE )?FUNCTION [a-z_]+"  migrations/*.sql | sort -u

# 互換VIEW / 正本表への書込み箇所(ripgrep, node_modules 自動除外)
rg -c "(INSERT INTO|UPDATE|DELETE FROM)\s+(contract_capabilities|capability_[a-z_]+)\b" services -g '*.ts'
rg -c "(INSERT INTO|UPDATE|DELETE FROM)\s+(documents|condition_lines|matters|matter_issues)\b" services -g '*.ts'
```
