# 利用許諾・作品モデル 共通化 設計メモ

> 目的: 出版(PUB)とボードゲーム(BDG)で「名称は違うが計算構造は同じ・最終地点は利用許諾計算書」
> という前提のもと、**(Part 1) 利用許諾条件テーブルと計算モジュールを共通化**し、さらに
> **(Part 2) 原作テーブル(source_ips)と作品テーブル(works)を `works.kind` で統合**する。
> 北極星は `docs/schema-redesign-proposal.md`(作品中心モデル)。本書はそこへ至る**段階移行の実行計画**。

ステータス: **合意待ち（実装前）** / 最終更新 2026-06-07
決定事項: 統合方式=「works に kind 列を追加して統合」 / 進め方=「設計メモ先行」

---

## 0. 横断ルール（全フェーズ共通）
- **追加(additive) → backfill → 読み手移行 → 書き手移行 → 旧構造削除** の順（同時破壊変更を避ける）。
- 冪等マイグレーション（`IF NOT EXISTS` / `to_regclass` ガード / 再実行可）。
- デプロイ順: スキーマ追加 → search-api(読) → worker(書) → 旧削除。
- 各フェーズで「連結チェック」点検 + 主要画面の動作確認。フェーズ前に `pg_dump` 断面取得。
- 作品モデルは構築途上＝**今が低リスクで統合できる好機**（データ件数が少ない）。

---

## Part 1 — 利用許諾条件・計算の共通化

### 1.1 現状（調査結果: ほぼ達成済み）
- **条件保管**: `capability_financial_conditions`(＋v3ミラー `contract_financial_terms`) が単一・汎用。
  - 汎用列: `calc_method` / `rate_pct` / `base_price_label` / `calc_period_kind`(MANUFACTURING/MONTHLY/…) /
    `formula_text` / `mg_amount` / `ag_amount` / `condition_no`。
- **計算モジュール**: `services/worker/src/lib/calc_license.ts` が `calc_type`(manufacturing/sales/sublicense)で分岐する共通実装。
- **出力**: `royalty_statement`(利用許諾計算書) テンプレが calcType で分岐の共通テンプレ。
- 出版の利用許諾条件書も `upsertCapabilityFinancialConditions` 経由で同じ条件テーブルに入る(Phase 26.9)。

### 1.2 残作業（仕上げ）
| # | 作業 | 種別 |
| :-- | :-- | :-- |
| 1a | 条件エディタを **division(PUB/BDG) 駆動プリセット**化（ラベル/既定計算式のみ切替、保存は汎用列） | UI ✅完了(2026-06-07・表示のみ/出力ニュートラル) |
| 1b | PUB の紙/電子は **condition_no で複数条件行**（紙=条件1, 電子=条件2, 翻訳=条件3） | ✅既実装(Phase 26.9: pub_license_terms 確定時に自動同期) |
| 1c | PUB フローの利用許諾計算書生成を **calc_license + royalty_statement の共通経路**へ集約 | ✅既実装(Phase 28: calc_type='sales'/'manufacturing'/'sublicense' で分岐、出力は共通 royalty_statement) |
| 1d | 任意: 条件行に `division`/`preset` ヒント列を追加(additive)、または work.division から導出 | 任意・未着手 |

#### Part 1 調査結論（2026-06-07）
**条件・計算の共通化は、データ/計算/出力の各層で既に達成済み**だった:
- 条件保管: `capability_financial_conditions`(汎用1本)。出版 `pub_license_terms` も確定時に Phase 26.9 が
  紙=条件1/電子=条件2/翻訳=条件3 として同テーブルへ同期。
- 計算: `calc_license.ts`(worker) / `RoyaltyPreviewPanel`(UI) が `calc_type`(manufacturing=製造 / sales=売上・印税 / sublicense)で分岐。
- 出力: `royalty_statement`(利用許諾計算書) の共通テンプレが calcType で表示分岐。
- 残る差異は **入力フォームのみ**(PUB=`pub_license_terms`の専用フィールド、BDG=汎用 FinancialConditionTable)。
  これは確定時同期で吸収済みのため、フォーム統一は output リスクがあり**任意**(やるなら別途慎重に)。
- 1a の division 判定バグ修正: `publication` だけでなく実テンプレ接頭辞 `pub_` も PUB と判定するよう修正。

### 1.3 プリセット対応表（タグ駆動）
| 汎用列 | BDG(own/製造) | PUB(出版/販売) |
| :-- | :-- | :-- |
| base_price_label | 上代(MSRP) | 税抜定価 |
| 数量概念 | 製造数 | 印税対象部数(実売/刷) |
| rate_pct | 料率% | 印税率%(紙/電子で別 condition_no) |
| calc_period_kind | MANUFACTURING | MONTHLY/QUARTERLY 等 |
| calc_type(計算) | manufacturing | sales |
| formula_text 既定 | 上代 × 料率 × 製造数 | 税抜定価 × 部数 × 印税率 |

### 1.4 受け入れ条件
- PUB/BDG どちらの条件も同じ `capability_financial_conditions` に入り、同じ `calc_license` で計算され、同じ利用許諾計算書が出る。
- 条件エディタが division でラベル/既定式を切替（保存先は不変）。

---

## Part 2 — 原作(source_ips) × 作品(works) の統合（works.kind）

### 2.1 方針
`works` に **`kind`** を持たせ、1テーブルで両方を表現:
- `kind='own'` … 自社作品（従来の works）
- `kind='licensed_in'` … 原作IP（従来の source_ips。社外権利を許諾を受けて使う器）

派生(翻訳/改題等)は既存の `parent_work_id` + `derivation_type` で表現（変更不要）。

### 2.2 原作IP固有項目の置き場
source_ips の固有列を works に**nullable 列**で持たせる（少数＝可読性優先）:
`original_publisher` / `default_rights_holder` / `default_credit_display` / `default_work_supplement` /
`default_approval_target` / `default_approval_timing` / `rights_holder_vendor_id`
（将来 JSONB 集約も可。まずは列で。）

### 2.3 素材の統合
`source_ip_materials`(原作素材) と `work_materials`(権利台帳) は「権利者付きマテリアル」で同型 →
**`work_materials` に一本化**（material_type / rights_holder_vendor_id / rights_holder_label / is_default 等を吸収）。
`products`(製品/SKU) は own 作品専用なので現状維持。

### 2.4 段階移行
| フェーズ | 内容 | 削除 |
| :-- | :-- | :-- |
| P2-1 (additive) | works に `kind`(default 'own') + 原作IP固有列 + `legacy_source_ip_id` を追加。work_materials に `rights_holder_label` 追加。source_ips は維持。 | なし ✅(0033) |
| P2-2 (backfill) | source_ips → works(kind='licensed_in', legacy_source_ip_id=旧id, work_code=source_code 流用)。source_ip_materials → work_materials(source_ip_material_id で冪等)。 | なし ✅(0033) |

#### P2-1/P2-2 実装メモ(2026-06-07)
- `migrations/0033_work_unify_p2_1_2.sql`(additive + backfill, to_regclass/冪等ガード)。
- **移行ガード(読み)**: `/api/v3/works`(自社作品一覧) を `kind='own'` で絞り、backfill された
  原作IP(licensed_in)が自社作品タブに出ないように。原作IPタブは従来どおり source_ips を読む。
  → **UI の見た目・出力は不変**のまま、裏で works に統合データが入る。
- デプロイ順: release/api(読みガード) → release/worker(0033 backfill)。
| P2-3 (読み手移行) | source_ips→works 同期トリガ(移行用)で works を完全同期。契約の対象作品 INSERT は source_ip_id から work_id を補完し work_id 主体に。UI/id は不変。 | なし ✅(0035 + workModel) |
| P2-4 (FK張替) | source_ip_id を持つ表(contract_works/contract_financial_terms/capability_line_items)に対応する work_id を埋める(legacy_source_ip_id マップ)。両キー併存。 | なし ✅(0034) |
| P2-5 (書き手移行) | 作成/取込/ピッカーを works(kind) 一本に。contract_works は work_id のみ使用(source_ip_id 書込停止)。 | なし |
| P2-6 (旧削除) | 参照ゼロを確認後、source_ip_materials / source_ips と各表の source_ip_id 列を撤去。 | source_ips 等 |

### 2.5 UI 影響（作品モデル）
- 「原作IP」タブ = `works WHERE kind='licensed_in'`、「自社作品」タブ = `kind='own'` の**同一フォーム＋kind切替**に集約。
- 契約の対象作品ピッカー(既存)は works 一本で 自社作品/原作IP を種別表示（source_ip 分岐を解消）。

### 2.6 リスク・ロールバック
- リスク: 中〜高（FK 多数）。各フェーズ独立・additive 中心で、P2-6 まで旧構造を残すため**いつでも停止可**。
- backfill は `legacy_source_ip_id` で冪等・再実行可。P2-4 までは読み書き両系統が生きる。

### 2.7 受け入れ条件（最終）
- 原作IP・自社作品が `works` 1テーブルで管理され、契約/条件/royalty/sublicense が work_id 一本で連結。
- source_ips/source_ip_id 参照ゼロ → 撤去後も全画面・利用許諾計算書が正常。

---

## 実装順（提案）
1. **Part 1（1a–1c）**: 低リスク・即効。条件エディタのプリセット化 + PUB を共通計算経路へ。
2. **Part 2 P2-1 / P2-2**: works に kind + 原作IP列追加 → backfill（読み書きは既存のまま）。
3. **Part 2 P2-3 / P2-4**: 読み手移行 + FK 張替（両キー併存）。
4. **Part 2 P2-5 / P2-6**: 書き手移行 → 旧 source_ips 撤去。

> 次アクション: 本メモ合意後、**Part 1（1a 条件エディタのプリセット化）**から着手。
