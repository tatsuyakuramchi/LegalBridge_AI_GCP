# 作品 / 原作 / 原作マテリアル テーブル整理 設計メモ

ステータス: **設計検討中（実装未着手）** / 2026-06-26 起票
関連: [`work-material-condition-copy-plan.md`](./work-material-condition-copy-plan.md)（WMC コピー）/ [`per-line-work-attribution-plan.md`](./per-line-work-attribution-plan.md)（作品1:文書N:明細N）/ [`condition_lines_unification_design.md`](../condition_lines_unification_design.md)

---

## 1. 背景・狙い

「作品テーブル・原作テーブル・原作マテリアルテーブルがすっきりしない」という問題提起。

### 動機となる実利用シナリオ（NewIto）
個別利用許諾条件書を作成する際、**1つの当社作品に複数の素材由来の条件を束ねたい**：

```
当社作品 NewIto の個別利用許諾条件書
  ├ 構成1: 原作Ito 素材  … 従前「原作Ito を当社で製造販売した時の利用許諾条件」を採用(コピー)
  └ 構成2: NewIto 用イラスト … ライセンサーへ制作依頼したイラストの個別利用許諾条件(新規)
```

→ 「作品 = 複数素材の権利の束、各素材に条件束」を 1 文書(条件書)で表現したい。

## 1.5 文書作成依頼フロー（中核要件・2026-06-26 追記）

「ポイントは文書作成依頼の流れ」。新たに作成依頼が来たときの想定フロー＝テーブル/UI が支えるべき本質：

```
[作成依頼]
  ① 予定作品名を確認 → works に無ければ登録（当社作品 own）
  ② 利用許諾条件を確認 → 「従前の利用許諾契約の派生製品」に当たるか判定
       ├ 当たる … 従前契約の条件を採用（コピー引用）
       └ 当たらない … 新たに利用許諾条件を追加（新規入力）
  ③ この時点で 利用許諾条件書の大枠が完成
```

### 現行部品へのマッピング（ほぼ揃っている）
| ステップ | 現行部品 | 状態 |
|---|---|---|
| ① 作品確認/登録 | `linked_work_id` 選択 ＋ `newWorkTitle`/`creatingWork` → `POST /api/v3/works`（インライン作成） | ✅ |
| ② 派生判定 | 原作(`ledger_ref_id`/`selectedLedger`)・`UnifiedContractPicker`（親契約） | △ 手動・素材起点 |
| ②-採用 | **WMC コピー**（`ConditionCopyPanel`＝原作素材の既存条件を引用） | ✅ |
| ②-新規 | `FinancialConditionTable`（新規入力） | ✅ |
| ③ 大枠完成 | ①②で `formData`(work＋`financial_conditions`)が揃う | ✅ |

### ギャップ（=やること）
- **(a) 誘導フロー化**: 上記を「確認→登録→派生判定→採用/新規→大枠完成」の **1本のステップUI** にまとめる（現状は各部品が分散）。
- **(b) 派生の入口を"製品起点"に**: 「従前の利用許諾契約の派生製品に当たるか」を、素材コピー起点ではなく **"従前契約/原作からの派生" を起点**に判定・提示（NewIto は原作Ito契約の派生 → 原作Ito条件を採用候補に出す）。
- これらは **WTC-1（フォーム導線）に統合**。Category（§4.5）で構成素材を分類束ねしつつ、②で原作由来=コピー / 委託新規=新規入力、を1画面で。

### 未決（O6 として §8 に追加）
- 「派生製品に当たるか」をどう判定するか: **手動**（原作/従前契約を選ぶ→条件があれば採用）か、**自動サジェスト**（作品系譜 NewIto→原作Ito から従前条件を提案）か。

## 2. 現状テーブルの役割（確認済み）

| テーブル | 役割 | メモ |
|---|---|---|
| `works` | 作品台帳。当社作品(own)＋原作(licensed_in) | 原作は `work_code = ledger_code` |
| `source_ips` / `ledgers` | 原作の台帳（2系統） | **id揃え**（0010 backfill） |
| `source_ip_materials` / `materials`(台帳) | 原作素材の正準カタログ（2系統） | **id揃え** ＋ `material_code` ミラー |
| `work_materials` | 作品スコープの素材インスタンス | `work_id` NOT NULL / `source_ip_material_id`→正準 / `acquisition_type` / `material_code` |
| **`work_components`(work_id, material_id→work_materials)** ＋ **`work_component_lines`(component_id, condition_line_id)** | **作品＝権利の束（N:N）** | 1作品に複数素材、各素材に複数条件 |
| `condition_lines` | 条件明細（`capability_id` NOT NULL＝文書由来） | `source_work_id` / `source_material_id`(→work_materials) / `work_id` |
| `contract_capabilities` | 文書/契約の器（利用許諾条件書など） | |

- `work_materials.acquisition_type` ∈ `license` / `buyout_commission` / `in_house`（0074）= **原作由来 / 委託制作 / 自社** の区分。
- `work_components.material_id` は 0078 で **`materials`(台帳) → `work_materials`(works系)** に repoint 済（正準を works 系へ寄せた）。

## 3. NewIto を現状モデルに載せる（＝表現可能）

```
works: NewIto (own)
 └ work_components（NewIto の権利の束）
     ├ 構成1: work_material[原作Ito素材]   (source_ip_material_id→原作Ito, acquisition_type='license')
     │     └ work_component_lines → condition_lines: 原作Ito の利用許諾条件
     │        （= WMC コピーで「原作Ito を製造販売した時の登録条件」を引用）
     └ 構成2: work_material[NewIto用イラスト] (acquisition_type='buyout_commission')
           └ work_component_lines → condition_lines: イラスト制作の個別利用許諾条件（新規入力）
 └ これらの condition_lines を載せる文書 = NewIto の個別利用許諾条件書 (contract_capabilities)
```

**結論**: テーブルを作り直さなくても、`work_components`(N:N) が「作品＝複数素材＝各素材の条件束」を表現できる。WMC（条件コピー）と per-line work も既にこの上に乗っている。

## 4. 「すっきりしない」真因

1. **原作素材の二重表現**: 台帳系（`ledgers`/`materials`、フォームのピッカーが使用）と works系（`source_ips`/`source_ip_materials`/`work_materials`、条件明細・グラフが使用）が並存。id揃え＋`material_code`ミラー＋0078 repoint で「繋いで」いるが、二重に持つこと自体が認知負荷。
2. **`condition_lines.material_id`(→台帳) のレガシー化**: 現役の書き込みは `source_material_id`(→work_materials) のみ。`material_id`(台帳) は mapper でも設定されず**事実上デッド**。残置が混乱を招く。
3. **UI/導線が束ねを十分表現していない**: 個別利用許諾条件書フォームは「1原作・1軸素材」中心。WMC でコピー導線は足したが、「**複数の構成素材（原作由来＋委託制作イラスト）を並べ、各々に条件束を付ける**」という NewIto 型の導線が未整備。

## 4.5 Category（マテリアルを束ねる分類）の検討【決定保留・2026-06-26 追記】

「原作の定義として、マテリアルを束ねる **Category**（オリジナルゲームデザイン / イラスト / グラフィックデザイン …）を設けては」という提起。

### 現状（既に分類軸は存在）
- `work_materials.material_type` / `materials.material_type`（VARCHAR(50)・自由運用）が**実質の分類軸**。
- 既存語彙（UI `MATERIAL_TYPES` @ WorkModelPanel）: 翻訳 / イラスト / シナリオ / デザイン / 音楽 / テキスト / データ / その他。
- → ご提案は、この `material_type` を**業務に合う Category として正式化**する話に対応する。

### 2案
- **(1) Category＝`material_type` 属性（既存の正式化）**: 原作 →(group by material_type)→ 素材。新テーブル不要。権利者・条件は素材単位のまま。UI で Category 別グルーピング表示。低リスク。
- **(2) Category＝実体テーブル `material_categories`(source_ip_id, name, sort, rights_holder?, …)**: `work_materials.category_id` で参照。Category 単位で **権利者 / 共有ライセンス条件 / 表示順** を持てる。属性→実体は後から昇格可。

### 語彙案（正式化する場合）
`game_design`(オリジナルゲームデザイン) / `illustration`(イラスト) / `graphic_design`(グラフィックデザイン) / `scenario`(シナリオ) / `music`(音楽) / `translation`(翻訳) / `text`(テキスト) / `data`(データ) / `other`(その他)
- 既存 `design` は `game_design` / `graphic_design` に分割（移行は `design`→いずれかへ手当て or 当面併存）。

### NewIto への効き方
- 構成素材を **Category 別に束ねて**表示（オリジナルゲームデザイン＝原作Ito由来コピー、イラスト＝委託制作の新規条件）。WTC-1 のフォーム導線でそのまま使える。

### 役割2層案（2026-06-26 追記）: コアロジック / サブコンポーネント
マテリアルを **2つの役割**で大別する案：
- **コアロジック (core_logic)**: 作品の本体（オリジナルゲームデザイン＝ルール・システム・テーマ等）。原作の中核。
- **サブコンポーネント (sub_component)**: 付属素材（イラスト / グラフィックデザイン / 翻訳 / 音楽 等）。

→ **2層モデル**にするのが素直：
- **役割** `material_role` ∈ `core_logic` / `sub_component`（束ねの大分類）
- **ジャンル** `material_type` ∈ `game_design` / `illustration` / `graphic_design` / `scenario` / `music` / `translation` …（具体）
- 例: NewIto = コアロジック[原作Itoのゲームデザイン] ＋ サブコンポーネント[委託イラスト]。
- `material_role` は `work_materials` の属性（enum 2値）で足り、新テーブル不要（Category=役割の束ね表示）。

### 判断基準（=未決の核）
**Category が自前データ（カテゴリ単位の権利者・共有条件・並び順）を持つ必要があるか？**
- 持たない → (1) 属性で十分。
- 持つ（例: 「イラストは絵師A、ゲームデザインは別ライセンサー」をカテゴリ単位で一括管理し条件も共有）→ (2) 実体テーブル。
- 現時点では **(1) から入り、共有要件が明確化したら (2) へ昇格**が安全（WTC 方針＝大規模作り直し回避と整合）。

## 5. 方針の選択肢

### (A) モデル統合（すっきり化・構造変更）
- 台帳 `materials` を「表示名・カタログ」役に限定し、**条件・束ねは works 系（`work_materials`/`work_components`/`condition_lines.source_material_id`）に一本化**。
- **`condition_lines.material_id`(台帳) を廃止**（デッド列の除去）。`source_material_id` 一本に。
- 期待効果: 二重表現の解消。リスク: 移行・FK・ビュー依存・回帰。0078 の延長線で段階的に。

### (B) UI 導線整備（実利用直結・低リスク）
- 個別利用許諾条件書フォームに **「この作品の構成素材」リスト**（複数）を出し、各素材に条件束を付ける：
  - 原作由来素材 … WMC コピー（既存）で原作登録条件を引用。
  - 委託制作素材（イラスト等）… `acquisition_type='buyout_commission'` の work_material を新規作成し、その条件を新規入力。
- 保存時は各条件を `condition_lines` 化 → `work_components`/`work_component_lines` で NewIto に束ねる（既存パスに乗る）。
- 期待効果: NewIto シナリオが画面で完結。テーブル変更ほぼ不要。

## 6. 推奨

- **大規模なテーブル作り直しはしない**（概念モデル＝`work_components` は正しく、シナリオを表現できる。データ量・依存・回帰リスクが大）。
- 順序は **(B) UI 導線を先**（実利用＝NewIto に直結、低リスク）→ **(A) は段階クリーンアップ**（まず最小の `condition_lines.material_id` 廃止から）。

## 7. 段階計画（案）

- **WTC-0（本メモ）**: 現状整理・方針合意。← いまここ
- **WTC-1（B: フォーム導線）**: 個別利用許諾条件書フォームに「構成素材リスト（複数）＋素材ごと条件束」。原作由来=WMCコピー / 委託制作=新規。保存で work_components 束ね。
- **WTC-2（A-1: デッド列除去）**: `condition_lines.material_id`(台帳) の参照棚卸し → 廃止（additive な無効化→後日 DROP）。
- **WTC-3（A-2: 正準一本化）**: 台帳 `materials` を表示専用に格下げ。`work_materials` を素材の唯一の正準に。ピッカーも works 系に寄せる。
- **WTC-4（任意）**: `ledgers`/`source_ips` の役割整理（原作=works(licensed_in) に一本化するか、台帳を維持するか）。

## 8. オープン論点（決定待ち）

- O1. (B) の「構成素材リスト」を **個別利用許諾条件書フォーム内**に置くか、**作品(WorkGraphPanel)側**で組んでから条件書に引くか。
- O2. 委託制作イラストの素材は **どの作品配下に作るか**（NewIto 直下の work_material か、原作Ito 配下か）。NewIto 直下＝`acquisition_type='buyout_commission'` が素直。
- O3. (A) の移行で台帳 `materials` を完全廃止するか、当面「表示名カタログ」として残すか。
- O4. `condition_lines.material_id` を参照している箇所が本当に無いか（DROP 前に全棚卸し）。
- O5. **Category（§4.5）**: 分類ラベル（属性案(1)）か、自前データを持つ実体（案(2)）か。語彙正式化（`game_design`/`graphic_design` 分割等）の要否。**決定保留**。
- O6. **派生判定（§1.5）**: 「従前契約の派生製品に当たるか」を 手動選択 か 自動サジェスト（作品系譜から）か。**決定保留**。

## 9. 結論

- **本質は文書作成依頼フロー（§1.5）**: 作品確認/登録 → 派生判定（従前契約条件の採用 or 新規）→ 条件書の大枠完成。**部品は既に揃っており**、WTC-1 で 1本の誘導フローに束ねるのが主眼。
- NewIto の「原作由来条件＋委託制作イラスト条件を1作品に束ねる」は **現行 `work_components` で表現可能**。作り直し不要。
- 「すっきりしない」真因は **原作素材の二重表現** と **デッド列 `condition_lines.material_id`** と **束ね/誘導導線の不足**。
- 推奨は **(B) UI 導線（§1.5 フロー＋§4.5 Category 束ね）を先行 → (A) を段階クリーンアップ**。大規模リストラはしない。
