# 設計書：作品・原作マスター統合（Work / Source-IP Unification）

- 版: **v2**（権利フロー・グラフモデル反映）
- 対象: LegalBridge AI GCP（admin-ui / worker / search-api / DB）
- 目的: 「作品登録」と「原作登録」の二重化を解消し、**ノード（作品・原作・素材・製品）を向き付き・種別付きの取引条件明細でつなぐ単一グラフ**に統合する。

---

## 1. 背景・課題（要約）

原作を登録してもライセンスフォームに出ない／採番が `LO-` でなく `IP-`。原因は **原作マスターが2系統**あること。

| 系統 | 登録UI | テーブル | コード | フォーム参照 |
|---|---|---|---|---|
| A: Ledgers（原作マスター, P22.18） | `master/ledgers` | `ledgers`+`materials` | `LO-` | ✅ |
| B: Work-Model（作品モデル, 統合P3-5） | `master/work-model`「原作IP」 | `works(licensed_in)`+`work_materials` | `IP-` | ❌ |

加えて旧 `source_ips` も残存し、`condition_lines` は `work_id` と `ledger_code/material_id` を併存（P2-1〜4 で works 統合が途中まで進行・P2-5/6 未完）。

---

## 2. 概念モデル：権利フロー・グラフ

**ノードを、向き(方向)×種別の取引条件明細(エッジ)でつなぐ有向グラフ**として表現する。

```
        ┌──────────── 素材(原作/翻訳/イラスト…) ────────────┐
        │  各々が「支払」源になりうる(権利者ごと)            │
        ▼                                                     │
 [原作 source/LO] ──支払×ライセンス──▶ [作品 own/W] ──受取×ライセンス──▶ [派生物/相手]
       仕入先 ──支払×プロダクト──▶ [製品 product/SKU] ──受取×プロダクト──▶ 卸先
```

### 2.1 ノード（マスター）
| ノード | 実体 | 種別/コード |
|---|---|---|
| 原作 | 外部からライセンスインする原著作物 | `works.kind='source'`、**`LO-YYYY-NNNN`** |
| 自社作品 | 当社が作る作品 | `works.kind='own'`、**`W-YYYY-NNNN`** |
| 派生物 | 当社作品から派生し外部へ出る対象 | （取引先製品として表現／後述） |
| 素材 | 原作の構成要素（原作/翻訳/イラスト/シナリオ…） | `work_materials`（`{work_code}-NNN`）。**各素材が支払の第一級ソース** |
| 製品(SKU) | 物販対象の製品 | `products`（`work_id` 配下） |

### 2.2 エッジ（取引条件明細＝`condition_lines`）の2軸
| 軸 | 値 | 既存対応 |
|---|---|---|
| **方向 (direction)** | 支払（当社が払う）/ 受取（当社が受け取る） | `flow_direction`(in/out) / `is_inbound` |
| **取引種別 (transaction_kind)** | `license`（料率%）/ `product`（単価×数量・買取/卸） | **新規列**。料率様式は `payment_scheme`(`royalty`/`per_unit`/`lump_sum`) で吸収 |

### 2.3 4象限の定義（1つの `condition_lines` に集約）
| 象限 | 方向 | 種別 | from（源） | to（先） | 取引先 | 連結列 |
|---|---|---|---|---|---|---|
| ライセンスイン | 支払 | license | 原作 / 素材 | 作品 | 権利者 | `source_work_id` / `source_material_id` |
| ライセンスアウト | 受取 | license | 作品 | 派生物 / 相手 | サブライセンシー | `work_id`（＋相手 vendor） |
| プロダクトイン | 支払 | product | 仕入先の製品/部材 | 作品 / 製品 | サプライヤー | `work_id` ＋ `product_id` |
| プロダクトアウト | 受取 | product | 作品 / 製品 | 卸先 | 卸/販売先 | `work_id` ＋ `product_id` |

> 決定: **派生物・卸先・仕入先は「取引先(vendor)＋製品(product)」で表現**し、ノード種別は増やさない。**4象限は単一 `condition_lines`**（属性 `direction × transaction_kind` で区別）。受取マップ＝このグラフのビュー。

---

## 3. ターゲットデータモデル（テーブル）

```
works (正本ノード)
  id, work_code(LO-/W-), kind('source'|'own'),
  title, title_kana, alternative_titles[], division[],
  work_type, status,                              -- own 用
  original_publisher, rights_holder_vendor_id,    -- source 用
  default_rights_holder, default_credit_display,
  default_work_supplement, default_approval_target, default_approval_timing,
  remarks, is_active, timestamps

work_materials (素材＝旧 materials/source_ip_materials)
  id, work_id, material_no, material_code({work_code}-NNN),
  material_name, material_type('original'|'translation'|'illustration'|'scenario'|…),
  rights_holder_vendor_id, rights_holder_label, is_default, is_active, …

products (製品SKU・既存)
  id, work_id, product_code, product_name, format, msrp, jan/isbn, …

condition_lines (エッジ＝取引条件明細)  ★ここに2軸
  id, capability_id/contract_id, line_no, subject,
  direction('pay'|'receive'),                 -- 請求方向(既存 flow_direction を正規化)
  transaction_kind('license'|'product'),      -- ★新規
  payment_scheme('royalty'|'per_unit'|'lump_sum'|…),  -- 料率様式
  work_id,                 -- 主対象(作品/製品の作品)
  source_work_id,          -- 支払×license の原作
  source_material_id,      -- 支払×license の素材(work_materials)
  product_id,              -- product 系の SKU
  counterparty_vendor_id,  -- 取引先(権利者/サブ/サプライヤー/卸先)
  amount_ex_tax, rate_pct, mg/ag …, term_start, term_end, …
```

- `ledgers`/`materials`/`source_ips`/`source_ip_materials` は**廃止**（移行後）。移行期は同名 **互換VIEW** を `works`/`work_materials` 上に張る。

---

## 4. 既存スキーマとのギャップ（追加・正規化するもの）

| 対象 | 現状 | 追加/変更 |
|---|---|---|
| works.kind | own / licensed_in | `licensed_in` → **`source`** に呼称統一（LO採番） |
| 原作採番 | IP-（master_seq） | **LO-** へ統一。既存IPは旧コードをエイリアス保持 |
| work_materials | コードなし | `material_no`/`material_code`/`is_default(-001)` を補完 |
| condition_lines | flow_direction/is_inbound, work_id, source_ip_id | `direction` 正規化、**`transaction_kind` 追加**、`source_work_id`/`source_material_id`/`product_id`/`counterparty_vendor_id` を正式採用 |
| 採番権限 | document_sequences(LO) と master_sequences(IP/W) の2系統 | **1系統へ集約**（推奨: master_sequences を正、worker からも参照） |
| 受取マップ | capabilities + source_ips(legacy) | `condition_lines`(direction×kind) 基準のビューへ |

---

## 5. consumer 改修方針

| Consumer | 改修方針 |
|---|---|
| 個別利用許諾フォーム(DocumentForm) | 原作候補を `works(source)` に切替。`work_id`/`work_material_id` を form_data に保存(旧 ledger_ref_id は読取互換) |
| AppData `ledgers` / `/api/master/ledgers` | 互換VIEW or 新APIで `works(source)+work_materials` を同形で返す |
| 原作/作品UI | WorkModelPanel に「原作(source)/自社作品(own)」を統合、素材は work_materials、製品は products。LedgersPanel は移行後に統合/廃止 |
| conditionsService / Html | `work_id`＋`direction`＋`transaction_kind` 基準に統一。`source_ip_id` 参照撤去 |
| receivableMapService | 4象限の `condition_lines` を辺とする分配グラフ計算へ |
| CSV取込(workModelImportService) | 原作=LO 採番。製品/取引明細も同経路に集約 |
| condition_lines 連結 | `ledger_code/material_id` を deprecate、`work_id/work_material_id/product_id` に一本化 |

---

## 6. 改修プロセス（再設計・フェーズ）

> ポイント: **「マスター統合(原作/素材)」と「エッジ2軸化(condition_lines)」を1スケジュールに統合**し、P2 ロードマップ(condition_lines)と合流させる。

### Phase 0 — 入口一本化（即日・低リスク・今回事象の即時対策）
- 原作の新規登録を **1画面に固定**（作品モデルの「原作IP」入口を停止 or Ledgersへ誘導）。
- 当面の原作登録先を決定（暫定: Ledgers=LO）。IP-既登録は Phase2 で移行。

### Phase 1 — スキーマ整備（additive・非破壊）
1. `works.kind` に `source` を採用、**LO 採番(licensed_in→source)** を実装。採番権限を1系統へ集約（最大値取込で初期化）。
2. `work_materials` に `material_no/material_code/is_default` を補完。
3. `condition_lines` に **`transaction_kind`** を追加、`direction` を正規化、`source_work_id/source_material_id/product_id/counterparty_vendor_id` を正式採用（既存値からバックフィル可能な範囲で）。
4. 互換VIEW `ledgers`/`materials`（→works/work_materials）を用意。

### Phase 2 — データ移行・分類（バックフィル）
1. `ledgers → works(source, LOコード継承)`、`materials → work_materials(material_code継承)`。
2. 既存 `works(licensed_in, IP-)` と Ledgers 由来の **名寄せ**（title/権利者で突合、衝突は要レビュー）。IP- は旧コードをエイリアス保持。
3. 既存 `condition_lines`/明細を **4象限に分類**：`is_inbound/flow_direction → direction`、`payment_scheme(royalty→license / per_unit・lump_sum→product 判定 + 業務ルール) → transaction_kind`、`source_ip_id → source_work_id`、製品紐付け → `product_id`。
4. `counterparty_vendor_id` を契約/capability から補完。

### Phase 3 — Consumer 切替（デュアルリード）
- フォーム原作候補・条件サービス・受取マップ・CSV を `works/work_materials/condition_lines(2軸)` へ。
- `/api/master/ledgers` は互換VIEW経由で同形維持しつつ内部は works を読む。
- 受取マップを4象限グラフのビューとして再実装。

### Phase 4 — 旧列/旧表の廃止
- `condition_lines.ledger_code/material_id`、`contract_capabilities.ledger_ref_id` 等を deprecate（バックフィル完了後）。
- `ledgers/materials/source_ips/source_ip_materials` と関連トリガを DROP。

### Phase 5 — クリーンアップ
- IP- 採番・二重UI・互換VIEW撤去。受取マップ/残高をグラフ前提に最終化。ドキュメント更新。

---

## 7. 採番・分類マッピング（移行ルール）

| 旧 | 新 | 規則 |
|---|---|---|
| ledger_code `LO-…` | works.work_code | そのまま継承（source） |
| material_code `LO-…-NNN` | work_materials.material_code | そのまま継承 |
| source_ips `IP-…` | works(source) | LO 再採番 or 旧IPをエイリアス列保持（決定事項③） |
| works(own) `W-…` | works(own) | 不変 |
| is_inbound=true | direction='receive' | 受取 |
| is_inbound=false | direction='pay' | 支払 |
| payment_scheme='royalty' | transaction_kind='license' | 料率% |
| payment_scheme in('per_unit','lump_sum') ＋ 製品文脈 | transaction_kind='product' | 単価×数量/買取（業務ルールで最終判定） |

---

## 8. リスク・留意点
- **名寄せ**（ledgers↔works(licensed_in)）と **4象限分類**（payment_scheme→kind）は自動化しきれず人手レビューが残る。優先ルールを事前決定。
- **採番再付与(IP→LO)** は被リンクへ影響 → 旧コードをエイリアス保持して安全側。
- **採番二系統の統合**は番号競合に注意（最大値取込で初期化）。
- form_data(JSONB)の旧キー(`ledger_ref_id`等)は当面**読取互換**で維持。
- condition_lines の P2-5/6 と合流するため、両者を**単一スケジュール**で管理。

---

## 9. 未決事項（残り・要決定）
1. 既存 `IP-` の扱い：**LO 再採番** か **旧コードのエイリアス保持**か（推奨: エイリアス保持）。
2. 原作/作品/製品の編集UI：WorkModelPanel に統合（推奨）か、当面 LedgersPanel 併存か。
3. 採番権限：`master_sequences` を正とする（推奨）か。
4. `transaction_kind` 自動判定の業務ルール（per_unit/lump_sum をどこまで product と見なすか）。
5. 進め方：**Phase 0 即時 → 原作/素材統合 → エッジ2軸化** の順で先行リリースするか、全体を一括設計してから着手するか。

> 確定済み（本版で反映）: 正本=`works` 集約 / 原作採番=`LO-` / 派生物・卸先・仕入先=取引先＋製品で表現 / 4象限は単一 `condition_lines`（direction×transaction_kind）。

---

## 10. 付録：主な参照ファイル
- スキーマ: `migrations/0001_baseline.sql`(ledgers/materials), `0004_work_ip_masters.sql`(works/source_ips/products), `0005_contracts.sql`(contract_works), `0006_financial_deliverables.sql`(work_materials), `0033`〜`0040`(統合P2), `0063_condition_lines_unification.sql`
- 採番: `services/worker/src/lib/db.ts`(LO), `services/api/src/routes/workModel.ts`(IP/W), `workModelImportService.ts`(CSV)
- フォーム: `src/components/document/DocumentForm.tsx`（原作=ledger 参照）
- 表示/計算: `conditionsService.ts` / `conditionsHtml.ts` / `receivableMapService.ts`
- 既存ロードマップ: `docs/condition_lines_migration_runbook.md`
