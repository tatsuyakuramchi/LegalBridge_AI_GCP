# 条件明細 統一 — Phase 2c 書込カットオーバー計画

> 関連: `condition_lines_unification_design.md`（概念設計） /
> `condition_lines_implementation_plan.md`（Phase A–G） /
> `condition_lines_migration_runbook.md`（運用手順）

## 0. 背景と目的

データ構造刷新は expand/contract 移行の **expand フェーズ**にある。

```
書込:  入力 → 【旧テーブル(source of truth)】 ──safeSync(非致命)──▶ 【新台帳(派生コピー)】
読取:  カバレッジ一致時は新、未充足なら旧へフォールバック（coverage-gated dual-read）
```

- 旧テーブル（`capability_line_items` / `capability_financial_conditions` /
  `delivery_line_items` / `royalty_calculations`）が **正**。
- 新台帳（`condition_lines` / `condition_events`）は旧から生成される**影武者**。

**2c の目的**: 主役を新台帳へ交代させ（書込カットオーバー）、旧テーブルへの依存を断ち、
最終的に **2d（旧テーブル DROP）** を可能にする。

### 2c が必要になった決定的理由（2b の打ち切り）

2b（読取移行）の精査で判明:
- A2 リードの大半は **new==old の無価値な配管**（明細数・金額の集計など）。
- 唯一価値ある「横断検索・編集」タブは、`capability_line_items` 固有の
  **メタ列（紐付け・状態フラグ・方向）を編集**するもので、これらの列は
  `condition_lines` に存在しない。→ 読取の付け替えでは移せず、**列の移送（2c）が前提**。

したがって、意味あるクリーンアップは全て 2c に集約される。

---

## 1. ギャップ分析（新台帳に不足している列）

### 1.1 condition_lines に不足（横断検索・編集の対象メタ）

| 旧 `capability_line_items` の列 | 用途 | 新 condition_lines |
|---|---|---|
| `source_ip_id` | 原作リンク | **無** → 追加 |
| `master_contract_id` | 基本契約リンク | **無** → 追加 |
| `ringi_id` | 稟議リンク | **無** → 追加 |
| `status_flags` (jsonb) | 発注書締結済 / 検収書発行済 / 支払申請出力済 | **無** → 追加 |
| `is_inbound` | 受領(請求権)明細フラグ | **無** → 追加 |
| `flow_direction` ('in'/'out') | 資金方向 | **無**（`direction` payable/receivable とは別概念）→ 追加 |
| `work_id` | 作品リンク | 有（移送不要） |

### 1.2 condition_events に不足（旧実績の詳細）

| 旧の列 | 出所 | 新 condition_events |
|---|---|---|
| `inspected_quantity` | delivery_line_items | **無** → 追加 |
| `acceptance_ratio` | delivery_line_items | **無** → 追加 |
| `manufacturing_event_id` | royalty_calculations | **無** → 追加 |
| `mg_consumed_this_time` | royalty_calculations | **無** → 追加 |
| `ag_consumed_this_time` | royalty_calculations | **無** → 追加 |

> ⚠ 現 `condition_line_balance_v` は MG/AG 消化を **royalty_calculations に JOIN して**
> 算出している。royalty_calculations を DROP するには、balance_v を
> **condition_events 由来**の mg/ag_consumed に再定義する必要がある（2c-0 で対応）。

---

## 2. 段階計画

各段階は**可逆**。`reverse mirror`（新→旧の逆同期）により、旧依存は最後まで生存させる。
各段階のゲートは reconcile の**ゼロ乖離**。

### 2c-0 スキーマ拡張 + backfill（基盤）

1. **Migration**（`migrations/00NN_condition_meta_columns.sql`）
   - `condition_lines` に `source_ip_id` / `master_contract_id` / `ringi_id` /
     `status_flags jsonb` / `is_inbound boolean` / `flow_direction varchar` を追加。
   - `condition_events` に `inspected_quantity` / `acceptance_ratio` /
     `manufacturing_event_id` / `mg_consumed_this_time` / `ag_consumed_this_time` を追加。
   - `condition_line_balance_v` を **condition_events 由来**の MG/AG 消化で再定義。
   - GRANT（0013/0063 と同方針）。
2. **Backfill**（一回スクリプト `scripts/restructure_2c0_meta_backfill.ts`）
   - 既存 condition_lines に対し `source_line_item_id` 経由で旧メタを移送。
   - 既存 condition_events に対し `source_*` 経由で旧詳細を移送。
   - 冪等。reconcile でゼロ乖離確認。

### 2c-1 同期を「忠実なスーパーセット」へ

- `conditionSync.ts` / `conditionLineMapper.ts` を拡張し、上記メタ列も旧→新へ写す。
  → これで内容的に **new ⊇ old**。
- `condition_sync_reconcile.ts` を拡張し、**メタ列の乖離**も検出（G5: meta drift）。
- ゲート: 全契約で meta 乖離 0。

### 2c-2 横断検索・編集を新台帳へ（最初の可視成果・高価値）

- `conditionsService.listConditions` の FROM を `condition_lines` 起点に
  （メタ列が揃ったので可能）。返却形は現行互換（編集 `id` は condition_line.id）。
- `updateConditionLinks` の UPDATE を `condition_lines` へ。
  当面は `source_line_item_id` 経由で **旧 capability_line_items にもミラー**（reverse sync）
  し、旧リーダー互換を保つ。
- 効果: 横断検索タブとコックピットが**同じ台帳**を見る（PR #8 の統合が完結）。

### 2c-3 書込カットオーバー（経路ごと・ソーク付き）

Bucket D の各書込を「**新ネイティブ書込 ＋ 旧ミラー**」へ反転（safeSync の向きを逆に）。

| 経路 | 現状 | 2c-3 後 |
|---|---|---|
| 契約登録（upsertCapabilityLineItems / Financial） | 旧書込→新 sync | 新書込→旧ミラー |
| 発注書生成ミラー（server.ts PO mirror, PR #15） | 旧書込→新 sync | 新書込→旧ミラー |
| 検収（delivery_line_items INSERT） | 旧書込→新 sync | 新 event 書込→旧ミラー |
| ロイヤリティ（royalty_calculations INSERT） | 旧書込→新 sync | 新 event 書込→旧ミラー |

考慮事項:
- **A案 terms 分割**: ネイティブ書込が暗黙 terms サブ契約生成を内包（現 resolveTermsCapability 相当）。
- **イベント=文書ペア必須**（CHECK `ce_document_pairing`）: 検収/ロイヤリティのイベントは
  **文書確定フック**で書く（保存時点では文書未確定のため）。`payment` イベントは文書不要。
- 各経路ごとに段階リリース＋ソーク（数日）＋reconcile ゼロ乖離を確認してから次へ。

### 2c-4 旧リーダー撤去（2b の残り＝今や正当）

- ~106 の旧リード（プラミング含む）を新台帳へ順次移行。reverse mirror があるので
  一斉である必要はない。
- `calc.ts` / `calc_license.ts` の在庫・残高計算を **condition_events ベース**へ
  （availability / MG・AG 残）。
- `dataLinkage.ts` の整合チェックを新 FK ベースへ。

### 2c-5 → 2d 旧書込停止 → DROP

- 旧ミラー（reverse sync）を停止。
- **DROP 前提条件チェックリスト**（全て green で初めて DROP）:
  - [ ] 旧4テーブルへの **read 参照ゼロ**（grep + 本番ログ監視）。
  - [ ] 旧4テーブルへの **write 参照ゼロ**（ミラー停止後）。
  - [ ] reconcile が**全カテゴリ・全契約でゼロ乖離**を一定期間継続。
  - [ ] balance_v / status_v / schedule_v が旧テーブル非依存。
- DROP マイグレーション（カラム → テーブル、段階的に）。

---

## 3. 順序とリスク

- **可逆性**: 2c-0〜2c-4 の各段階は単独でロールバック可能（旧は最後まで正→ミラー→撤去）。
- **reverse mirror の寿命**: 旧リーダーが残る間だけ維持。2c-4 完了で不要に。
- **ゲート**: 各段階は reconcile ゼロ乖離を満たすまで次へ進まない。
- **本番検証**: 各カットオーバーは PR #11 と同様、本番で新旧の集計一致を SQL 照合してから信頼する。
- **リスクの集中点**: イベント=文書ペアの「文書確定フック」化（検収/ロイヤリティの書込タイミング変更）。
  ここが最も慎重を要する。フック未整備の間は現行 safeSync を残して二重保険にする。

## 4. 規模感（概算）

| 段階 | 主な対象 | 規模 |
|---|---|---|
| 2c-0 | migration 1 + backfill 1 | 小 |
| 2c-1 | conditionSync/mapper 拡張 + reconcile 拡張 | 小〜中 |
| 2c-2 | conditionsService read/write 移行 + reverse mirror | 中 |
| 2c-3 | 4 書込経路の反転（A案・文書フック含む） | 大 |
| 2c-4 | ~106 リード + calc/calc_license + dataLinkage | 大 |
| 2c-5/2d | ミラー停止 + DROP | 小（前提が揃えば） |

## 5. 推奨する着手順

1. **2c-0 → 2c-1**（基盤＋忠実同期）を先に固める。低リスクで、以降全ての土台。
2. **2c-2**（横断検索の新台帳化）を最初の可視成果として出す。ユーザー価値が明確。
3. その後 **2c-3** を経路ごとに、最もシンプルな契約登録から着手し、検収/ロイヤリティ
   （文書フック）は最後に。
4. **2c-4** はソーク中に並行して読取を移し、**2d** で締める。

各段階ごとに PR を分割し、reconcile と本番 SQL 照合をゲートにする。
