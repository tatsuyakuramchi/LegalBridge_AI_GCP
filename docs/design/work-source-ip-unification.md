# 設計書：作品・原作マスター統合（Work / Source-IP Unification）

- 版: v1（ドラフト）
- 対象: LegalBridge AI GCP（admin-ui / worker / search-api / DB）
- 目的: 「作品登録」と「原作登録」が二重化し、登録先と参照先が食い違う問題を根本解消し、単一の正本モデルに統合する。

---

## 1. 背景・課題

### 1.1 発生している事象
原作を登録したのに、個別利用許諾条件書フォームの「原作」プルダウンに出てこない。さらに採番が想定の `LO-` ではなく `IP-` になっていた。

### 1.2 根本原因：原作マスターが2系統ある
原作を登録できる画面・テーブル・採番が **2つ**存在し、相互に連携していない。

| 系統 | 登録UI | テーブル | コード | 個別利用許諾フォームが参照 |
|---|---|---|---|---|
| **A: Ledgers（原作マスター, Phase22.18）** | `master/ledgers`（LedgersPanel） | `ledgers` + `materials` | `LO-YYYY-NNNN`（素材は `{LO}-NNN`） | ✅ **参照する** |
| **B: Work-Model（作品モデル, 統合P3-5）** | `master/work-model`（WorkModelPanel）「原作IP」 | `works(kind='licensed_in')` + `work_materials` | `IP-YYYY-NNNN` | ❌ 参照しない |

- 個別利用許諾条件書フォームの原作セレクタは **Ledgers(LO-)** を読む（`src/components/document/DocumentForm.tsx:239,1215`、`useAppData().ledgers` = `/api/master/ledgers`）。
- 今回は **作品モデル＞原作IP** で登録したため `works` に `IP-` で入り、フォームの参照先(Ledgers)に存在しない → 表示されない／コードがIP-になる。

### 1.3 さらに根深い重複
| 概念 | A系統 | B系統 |
|---|---|---|
| 原作（外部権利者からライセンスイン） | `ledgers` | `works(kind='licensed_in')` |
| 自社作品 | （なし） | `works(kind='own')` |
| 素材（派生/キャラ/原稿等） | `materials`（`ledger_id`、material_code採番あり） | `work_materials`（`work_id`、コードなし）＋ 旧 `source_ip_materials` |
| 契約との紐付け | `contract_capabilities.ledger_ref_id` / `ledger_code` | `contract_works` / `capability_financial_conditions.work_id` |
| 採番管理 | `document_sequences`（worker） | `master_sequences`（search-api） |
| 既存の統合進捗 | — | P2-1〜P2-4 で `source_ips → works` 移行済み、P2-5/6 未完 |

> すなわち「A(LO)」「B(IP/W)」「旧 source_ips」の3層が混在し、`condition_lines` も `work_id` と `ledger_code/material_id` の両方を持つ過渡期状態。

---

## 2. 設計方針（決定事項と推奨）

### 2.1 正本モデルの選定（推奨）
**`works` を単一正本にする。** 既に P2 で `source_ips → works` 統合が進んでおり、契約・条件・受取マップが `works` 前提で広がっているため、`works` 集約が最小コスト。

- 原作 = `works(kind='licensed_in')`
- 自社作品 = `works(kind='own')`
- 素材 = `work_materials`（`works` の 1:N、安定した `material_code` を採番）
- `ledgers` / `materials` / `source_ips` / `source_ip_materials` は**廃止**（移行後）。

### 2.2 採番方針（推奨：利用者の期待に合わせる）
| 区分 | 新コード | 旧 |
|---|---|---|
| 原作（licensed_in） | **`LO-YYYY-NNNN`** | IP-（廃止）/ LO-（ledger由来をそのまま継承） |
| 自社作品（own） | **`W-YYYY-NNNN`** | 同左 |
| 素材 | **`{work_code}-NNN`** | materials踏襲 |

- 「原作=LO」は利用者の認識・現行フォーム表示と一致するため **licensed_in は LO に統一**。
- 採番権限を **1系統に集約**（`document_sequences` か `master_sequences` のどちらかへ寄せる。worker/serach-api 双方から呼べる方を採用。推奨: `master_sequences` を正とし worker からも参照）。

### 2.3 移行を安全にする原則
- **互換ビュー（compatibility view）**を提供：`ledgers` / `materials` という名前の **VIEW** を `works`/`work_materials` の上に作り、既存の参照コードを壊さず段階移行する。
- **デュアルリード期間**を設け、consumer を順次 `works` ベースへ切替。
- **入口は即日一本化**（誤登録の再発防止＝今回の事象の即時対策）。

---

## 3. ターゲットデータモデル

```
works (正本)
  id, work_code(LO-/W-), kind('own'|'licensed_in'),
  title, title_kana, alternative_titles[], division[],
  work_type, status,                         -- own 用
  original_publisher, rights_holder_vendor_id,
  default_rights_holder, default_credit_display,
  default_work_supplement, default_approval_target, default_approval_timing,  -- 原作デフォルト(旧ledger)
  remarks, is_active, timestamps
   │ 1:N
   ▼
work_materials (素材=旧 materials/source_ip_materials)
  id, work_id, material_no, material_code({work_code}-NNN),
  material_name, material_type, rights_type,
  rights_holder_vendor_id, rights_holder_label, is_default, is_active, ...

contract_works / capability_financial_conditions / condition_lines
  → すべて work_id（+ work_material_id）で紐付け（ledger_code/material_id は廃止予定）
```

- `materials` 固有だった `material_no` / `material_code` / `is_default(-001)` の概念は **work_materials に取り込む**（フォームの「素材-001 自動選択」を維持するため）。

---

## 4. 改修対象（consumer）一覧と方針

| Consumer | 現状 | 改修方針 |
|---|---|---|
| 個別利用許諾フォーム（DocumentForm） | `ledger_ref_id`/`material_ref_id` で ledgers/materials 参照 | 原作候補を `works(licensed_in)` に切替。`work_id`/`work_material_id` を form_data に保存（旧キーは読み取り互換維持） |
| AppDataContext `ledgers` | `/api/master/ledgers` | 互換ビュー or 新APIで `works(licensed_in)+work_materials` を同形で返す |
| LedgersPanel（原作マスターUI） | ledgers CRUD | WorkModelPanel に統合 or 「原作」タブとして works(licensed_in) を編集 |
| WorkModelPanel（作品モデルUI） | works/source-ips/contracts | 原作IPの採番を LO- に変更、素材を work_materials で統一 |
| conditionsService / conditionsHtml | `cli.source_ip_id`,`work_id`,`source_code` | work_id 基準に統一（source_ips 参照を撤去） |
| receivableMapService | capabilities + source_ips(legacy) | work_id/work_materials 基準へ |
| workModelImportService（CSV） | source-ips(IP-)/works(W-)/contracts | 原作CSVを LO- 採番に。ledgers用CSVは新設不要（works取込に集約） |
| condition_lines 連結 | work_id ＋ ledger_code/material_id 併存 | work_id/work_material_id に一本化、旧列バックフィル後 deprecate |
| 再発行/契約 capabilities | `ledger_ref_id`/`ledger_code`/`work_id` | work_id へ寄せる（互換読取維持） |

---

## 5. 移行計画（フェーズ）

### Phase 0 — 入口一本化（即日・低リスク・今回の即時対策）
- 「作品モデル＞原作IP」からの新規原作登録を**停止 or Ledgersへ誘導**（誤登録防止）。
- 当面の原作登録は **Ledgers(LO-)** に集約。
- 既に IP- で登録済みの原作は Ledgers へ再登録 or Phase2 で移行。

### Phase 1 — スキーマ整備（非破壊・additive）
- `works` に LO 採番ロジック（licensed_in）を追加。`work_materials` に `material_no`/`material_code`/`is_default` を補完。
- 採番権限を1系統へ集約。
- **互換ビュー** `ledgers_v` / `materials_v`（→ 最終的に `ledgers`/`materials` を VIEW 化）を用意。

### Phase 2 — データ移行（バックフィル）
- `ledgers → works(kind='licensed_in')`（LO コード継承）、`materials → work_materials`（material_code継承）。
- 既存 `works(licensed_in, IP-)` と Ledgers 由来の重複を**名寄せ**（title/権利者で突合、衝突は要レビュー）。
- IP- コードは LO- へ**再採番 or エイリアス保持**（決定事項④）。

### Phase 3 — Consumer 切替（デュアルリード）
- フォーム原作候補・条件・受取マップ・CSV を `works/work_materials` 参照へ。
- `/api/master/ledgers` は互換ビュー経由で同形レスポンスを維持しつつ、内部は works を読む。

### Phase 4 — 旧列/旧表の廃止
- `condition_lines.ledger_code/material_id`、`contract_capabilities.ledger_ref_id` 等を deprecate（バックフィル完了後）。
- `ledgers`/`materials`/`source_ips`/`source_ip_materials` と関連トリガを DROP。

### Phase 5 — クリーンアップ
- IP- 採番・二重UI・互換ビューを撤去。ドキュメント更新。

---

## 6. リスク・留意点
- **データ名寄せ**（ledgers↔works(licensed_in)重複）の判定は自動化しきれず、要人手レビュー。衝突時の優先ルールを事前決定。
- **採番再付与（IP→LO）**は既存文書・契約の参照コードに影響。エイリアス列（旧コード保持）で被リンクを守る。
- **採番の二系統統合**（document_sequences / master_sequences）でナンバリング競合の恐れ → 移行時に最大値を取り込み初期化。
- `condition_lines` の過渡期（P2-5/6 未完）と並行するため、本統合と P2 ロードマップを**1本のスケジュールに統合**する。
- フォーム form_data は JSONB のため、旧 `ledger_ref_id`/`material_ref_id` を**読み取り互換**で当面維持。

---

## 7. 未決事項（要決定）
1. **正本**: `works` 集約でよいか（推奨=はい）。
2. **原作採番**: licensed_in は `LO-` に統一でよいか（推奨=はい。利用者期待と一致）。
3. **既存 IP- の扱い**: LO- へ再採番するか／IP- を旧コードとしてエイリアス保持するか。
4. **UI**: 原作編集は LedgersPanel を残すか、WorkModelPanel に「原作」タブとして統合するか。
5. **採番権限**: `master_sequences` と `document_sequences` のどちらを正とするか。
6. **移行のタイミング**: P2(condition_lines)統合と同時に進めるか、先に原作/素材だけ統合するか。

---

## 8. 付録：主な参照ファイル
- スキーマ: `migrations/0001_baseline.sql`(ledgers/materials), `0004_work_ip_masters.sql`(works/source_ips), `0005_contracts.sql`(contract_works), `0006_financial_deliverables.sql`(work_materials), `0033`〜`0040`(統合P2), `0063_condition_lines_unification.sql`
- 採番: `services/worker/src/lib/db.ts`(LO/document_sequences), `services/api/src/routes/workModel.ts`(IP/W/master_sequences), `services/api/src/services/workModelImportService.ts`(CSV)
- フォーム: `src/components/document/DocumentForm.tsx`（原作=ledger 参照）
- API: `/api/master/ledgers`(worker server.ts ~6376), `/api/v3/source-ips|works|contracts`(workModel.ts)
- 表示: `conditionsService.ts` / `conditionsHtml.ts` / `receivableMapService.ts`
- 既存ロードマップ: `docs/condition_lines_migration_runbook.md`（4.4 作品モデル/受取マップ連結）
