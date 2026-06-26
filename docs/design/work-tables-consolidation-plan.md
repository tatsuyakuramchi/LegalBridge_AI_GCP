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

## 9. 結論

- NewIto の「原作由来条件＋委託制作イラスト条件を1作品に束ねる」は **現行 `work_components` で表現可能**。作り直し不要。
- 「すっきりしない」真因は **原作素材の二重表現** と **デッド列 `condition_lines.material_id`** と **束ね導線の不足**。
- 推奨は **(B) UI 導線を先行 → (A) を段階クリーンアップ**。大規模リストラはしない。
