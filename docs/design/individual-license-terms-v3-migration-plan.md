# 移植プラン: 個別利用許諾条件 v3（マトリクス構造）

- 版: v0.1（ドラフト）— 2026-06。アップロード版 v3（入力フォーム / テンプレート）の移植計画。
- 対象: `individual_license_terms`（別紙 個別利用許諾条件）。発注書/出版等は後続。
- 関連: docs/design/document-first-material-linkage-plan.md（材料ファースト・1材料:N条件）の延長。

---

## 1. v3 が導入する構造（リファレンス読み取り）

現行のフラットな「金銭条件テーブル」を **2軸マトリクス**へ進化させる。

| 概念 | v3 呼称 | 我々のモデル対応 |
|---|---|---|
| 行 | **構成要素 LC**（原作ゲーム・イラスト…）＋**権利元** | 原作マテリアル `work_materials` ＋ 権利者 |
| 列 | **取引形態（条件）**（製造販売／サブライセンス／プロダクトアウト） | 1材料:N条件 の「条件」＝算定の違い |
| セル | LC × 取引形態 の **料率** | （新規）材料×条件の料率 |

新要素:
- **加算型/非加算型**: 加算型＝適用料率＝各LC料率の**合算**／非加算型＝**実効料率**を直接指定。
- **1-3(A) 基準価格表**（製造者・販売者・最大地域/言語・基準価格）と **2-1 金銭条件マスタ**（地域・言語・適用料率・個数・AG・MG・通貨）の**分離**。
- 算定式: `ロイヤリティ ＝ 基準価格 × 料率 × 個数 ± 固定額`。
- 4-2 按分（権利元が異なる場合）。

---

## 2. 既存との 3 つのギャップ

1. **テンプレ・エンジン不一致**: v3 テンプレは `<!-- REPEAT:xxx -->` カスタム構文。現行 worker は **Handlebars**（`{{#each}}`/`{{#if}}`、`documentService.ts`）。REPEAT 処理は未実装 → **v3 を Handlebars 化**して移植する（v3 HTML は設計リファレンス）。
2. **料率マトリクスの保存先が無い**: 「材料×取引形態の料率」を現行スキーマは持たない。
3. **フォームがフラット**: 現行 `FinancialConditionTable` は条件の一次元リスト。v3 は LC×取引形態の2軸＋加算ロジック。

---

## 3. データモデル（推奨マッピング）

**既存スキーマでほぼ表現できる**のが結論。

| v3 | 既存テーブル | 備考 |
|---|---|---|
| 構成要素 LC | `work_materials`（material_name, rights_holder） | 権利元＝rights_holder。既存。**LC の ID/区分は現行 `material_code`（例: `LO-2026-0015-001`）を使い、合成の "LC-NN" は使わない**（決定）。 |
| 取引形態（条件） | `capability_financial_conditions`（1行=1取引形態） | 列メタ。**新列が必要**（下記） |
| セル（LC×取引形態 料率） | `condition_lines`（`source_material_id`=LC × `source_condition_id`=取引形態 × `rate_pct`） | **既存スキーマで表現可**。1cell=1明細。 |
| 適用料率 | 加算型: Σ condition_lines.rate_pct（その取引形態）／非加算型: 取引形態の実効料率 | 計算で導出 |

→ これは我々の「**1材料:N条件**」を**マトリクス化**したもの。condition_lines が「材料×取引形態」のセル。`source_condition_id`（→capability_financial_conditions）と `source_material_id`（→work_materials）は既存列なので、cell 表現は無理がない。

**`capability_financial_conditions` への新列（migration）:**
- `manufacturer`（製造者）, `seller`（販売者）
- `max_region`, `max_language`（1-3(A) 最大スコープ）
- `is_addon`（加算型 boolean）
- `quantity`（個数。「数量」/「1」）
- （既存で流用: `base_price_label`, `region_territory/region_language`, `mg_amount`, `ag_amount`, `currency`, `rate_pct`=非加算型の実効料率, `condition_name`=取引形態名, `condition_no`）

---

## 4. 移植コンポーネント

### 4.1 スキーマ（migration 0083）
- `capability_financial_conditions` に上記新列を additive 追加（既存挙動不変）。
- `condition_lines` は既存列（source_material_id / source_condition_id / rate_pct / payment_scheme）で cell 表現。新規 DDL 不要。

### 4.2 テンプレート（Handlebars 化）
- v3 テンプレ（`d2cfd5b0…v3.html`）を Handlebars へ翻訳:
  - `<!-- REPEAT:cond -->` → `{{#each conds}}`（1-3(A) 基準価格表）
  - `<!-- REPEAT:condHeader -->` → `{{#each conds}}`（1-3(B) 列ヘッダ）
  - `<!-- REPEAT:lc -->` / `<!-- REPEAT:lcRate -->` → `{{#each lcs}}` / 入れ子 `{{#each rates}}`（料率表）。`{{lcId}}`（v3 の "LC-01" 区分）は **`material_code`（現行形式 `LO-…-NNN`）に置換**。
  - `<!-- REPEAT:cond2 -->` → `{{#each conds}}`（2-1 金銭条件マスタ）
  - `<!-- REPEAT:sublicense -->` ＋ `EMPTY` → `{{#each sublicensees}}{{else}}…{{/each}}`
  - `{{condCount}}` 等 → context で供給
- 固定文（1-2・2-2・3・4特約）はそのまま。
- 既存 `templates/individual_license_terms.html` を置換（旧は退避）。

### 4.3 テンプレ context 構築（worker 文書生成）
- 入力（capability + financial_conditions + LC料率）から、テンプレが要求する配列を生成:
  - `conds[]`: 取引形態（label, manufacturer, seller, maxRegion, maxLang, basePrice, condType=加算/非加算, region, lang, appliedRate, quantity, ag, mg, currency）
  - `lcs[]`: 構成要素（lcId, lcName, lcHolder, rates[]=各取引形態の料率）
  - `condCount`, `sublicensees[]`
- 適用料率: 加算型＝該当取引形態の cell 合算、非加算型＝実効料率。

### 4.4 文書作成フォーム（DocumentForm）
- §3-2 の `FinancialConditionTable` を **v3 入力**へ置換 or 拡張:
  - **取引形態カード**（製造者/販売者/最大地域・言語/基準価格/加算型/今回地域・言語/個数/AG/MG/通貨）＝列。
  - **LC（構成要素）カード**（構成要素名＝原作マテリアル/権利元）＋各加算型取引形態の**料率入力**＝行×セル。
  - 適用料率プレビュー（加算型は自動合算）。
- 作品連動（§1.3〜）と整合: LC＝原作マテリアル（work_materials）。LC を既存マテリアルから選ぶ/件名で新規（材料ファースト）。

### 4.5 条件明細の登録ロジック（server.ts）★核心・要精査

LC（マテリアル）ごとに **2モード** を取る。フォームは LC 行ごとにモードを選ぶ（材料ファーストの「件名で新規 / 既存選択」の延長）。

**モード1：従前のマテリアルを使う → 既存の条件明細を引用（参照のみ・新規作成しない）**
- condition_lines は **金銭条件（取引形態）ごと** に存在する。**同一マテリアルの条件明細を複数の作品で引用**できる必要がある。
- → 既存の **N:N 中間表**（`work_components` / `work_component_lines`）で「**作品ごとに引用**」を担保。`attach-work` / `component-lines` 経路を使い、condition_line は複製せず共有。
- 文書の 2-1（金銭条件）は、引用した既存 condition_lines を表示。1-1 の枠は当該マテリアルの原作マスター（既存）に由来。

**モード2：従前を使わない（＝新しい条件の作品）→ 条件明細そのものを新規作成**
- この文書が条件の真実源。LC×取引形態の各セルを `condition_lines` として **新規生成**（source_material_id=LC, source_condition_id=取引形態, rate_pct=cell, payment_scheme=royalty）。
- このとき **template 1-1 ＝ 2-1**：許諾の枠（1-1 の地域/言語上限）と実際の金銭条件（2-1）が一致する（新規単一条件は枠＝実値）。1-1 と 2-1 を文書で同時に確定。
- 既存の document-first 登録（`linkWorkMaterialsForCapability`）を **cell（材料×取引形態）構造へ拡張**して流用。

**共通**
- 取引形態ごとに `capability_financial_conditions`（新列含む）を upsert。
- 加算型の適用料率は導出（§6: 都度計算 推奨）。
- 「引用できる整理」= condition_line は work に重複させず、N:N junction で多作品から参照する（フラット `work_id` 単独ではなく `work_component_lines` を正準に）。

---

## 5. 段階

| Stage | 内容 |
|---|---|
| A | migration 0083（新列）＋ テンプレ Handlebars 化＋ context 構築。既存フォーム互換で表示確認。 |
| B | フォーム改修（取引形態×LC マトリクス入力＋適用料率プレビュー）。 |
| C | 登録ロジック（cell→condition_lines、適用料率、作品連動の cell 拡張）。 |
| D | 旧 `financial_conditions`（フラット）経路との後方互換・移行。royalty_statement 等の下流計算の追従。 |

---

## 6. 要確認の決定事項

1. ~~LC = work_materials か~~ → **確定**。LC＝原作マテリアル（work_materials）。**ID/区分は現行 `material_code`（`LO-…-NNN`）を使い "LC-NN" は廃止**（ユーザー決定 2026-06）。
2. **セル = condition_lines**（source_material_id × source_condition_id × rate_pct）で表現 → 承認。別テーブル案は不採用。
3. **適用料率（加算型の合算結果）** は保存（冗長・下流が楽）か、都度計算か。（推奨: 都度計算＋表示。要確認）
4. **非加算型**（例: サブライセンス 50%）は LC 行を持たず取引形態の実効料率のみ。この扱い（cell 無し／代表 cell）をどうするか。
5. **基準価格・個数・AG・MG** は取引形態（列）単位で確定。マテリアル単位の差は想定するか（v3 は列単位）。
6. **後方互換**: 既存の旧 `financial_conditions` で作られた individual_license_terms 文書・条件明細との両立（読み替え or 併存）。
7. **下流**: royalty_statement / 利用許諾料計算 が新マトリクスをどう参照するか（適用料率の供給点）。
8. ~~登録モード~~ → **確定（ユーザー 2026-06）**: LC ごとに「**引用（従前マテリアルの既存条件明細を N:N で参照）**」/「**新規作成（条件明細を生成・1-1=2-1）**」の2モード（§4.5）。引用時は condition_line を複製せず `work_component_lines` で作品ごとに参照する。
