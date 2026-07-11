# condition_lines を情報の中核（背骨）に据える整合性改修 設計書

ステータス: **ドラフト（設計・未実装）** / 2026-07-11 起票
対象: `condition_lines`（CL）とその周辺（cfc/cli VIEW・トリガ・素材結線・検収同期・料率計算）
関連: [`condition_lines_unification_design.md`](./condition_lines_unification_design.md) / `migrations/0063,0101,0111,0116`

---

## 0. 中核思想

**condition_line(CL) を情報の中核（背骨）とし、その上に次の“衛星”が乗る。**

```
                ┌─ 文書番号 (document_number)   ← capability → documents
                ├─ 作品 / 原作 (work / ledger)  ← work_id / source_work_id / ledger_code
   condition_line ┼─ 原作マテリアル (構成要素 LC) ← source_material_id / material_id → work_materials
       (背骨)   ├─ 取引先 (vendor)             ← capability → documents.vendor_id
                ├─ スタッフ (staff)             ← capability / staff_email
                └─ 系譜 (derived-from)          ← source_condition_id / source_line_item_id（本物の系譜のみ）
```

各金銭条件・明細は 1 本の CL であり、料率・金額・期間・支払といった値と、上記の衛星への“単一で一貫した”リンクを持つ。**衛星は CL に従属する（CL が真実の中心）。**

本改修の目的は、0101（cfc/cli の VIEW 化）以降に生じた **衛星リンクの不整合（新旧混在・死んだ JOIN・意味の混線）** を、CL 中核モデルに沿って整えること。

---

## 1. 現状モデル

### 1-1. 物理は `condition_lines` 一本
`migrations/0063_condition_lines_unification.sql:52`。主な列:

- **識別**: `id`(PK) / `capability_id`(→ contract_capabilities) / `line_no` / `line_code` / `subject`
- **系統・値**: `payment_scheme` / `amount_ex_tax` / `quantity` / `unit_price` / `rate_pct` / `mg_amount` / `ag_amount` / `term_start` / `term_end` / `currency` / `calc_method` / `formula_text` / `payment_terms` / `payment_date` …
- **衛星リンク**:
  - 作品/原作: `work_id`(→works) / `source_work_id` / `ledger_code`
  - 原作マテリアル: `material_id`(→materials 旧) / `source_material_id`（0089/0090 のマテリアル一本化後は **work_materials** が正）
  - 系譜: `source_condition_id` / `source_line_item_id`
- **ライフサイクル**: `closed_at` / `closed_reason` / `cancelled_at`
- **削除済み(0101)**: `source_ip_id` / `master_contract_id`（`0101:148-149` で DROP）

### 1-2. cfc / cli は VIEW（id = cl.id）
0101 で `capability_financial_conditions`(cfc)・`capability_line_items`(cli)・`contract_capabilities` は **VIEW 化**。
- `capability_financial_conditions AS SELECT cl.id AS id, …`（`0101:304-306`）
- `capability_line_items AS SELECT cl.id AS id, …`（`0101:355-357`）
- 書込は INSTEAD OF トリガ（`cfc_ins`/`cfc_upd`＝`0111`、`cli_ins`＝`0101:528`）。
- **不変条件: `cfc.id = cl.id` かつ `cli.id = cl.id`。** ＝ cfc/cli の“行”は CL そのもの。

### 1-3. 文書番号・取引先・スタッフは capability 経由
`contract_capabilities` も VIEW（実体は `documents`。`0101:213` 投影 / `documents` に vendor_id 等を追加 `0101:36`）。
- 文書番号 = `documents.document_number` / 取引先 = `documents.vendor_id`(→vendors) / スタッフ・課題 = `backlog_issue_key` 等。
- CL → capability_id → documents で、文書番号・取引先・スタッフが乗る。

### 1-4. 二系統ライフサイクル
| | A) 消費型（金額）→ 検収書 | B) 時限型（期間）→ 利用許諾条件書 |
|---|---|---|
| payment_scheme | lump_sum / per_unit / installment | royalty（subscription も期間側）|
| 生存の芯 | `amount_ex_tax`（必須）| `term_start`/`term_end`(+rate/mg/ag) |
| 消化・満了 | `condition_events(inspection)` 合計 ≥ amount → fulfilled（`condition_line_status_v` `0101:654-659`）| term_end 超過 → expired（`0101:660-665`）|
| CHECK | `cl_scheme_depletable_target`（非royalty/subは amount 必須）| `cl_scheme_royalty_cols`（royalty以外は rate/mg/ag=NULL）|

マッパー（純関数）は系統分岐を正しく持つ:
- 消費型: `mapLineItemToConditionLine`（`conditionLineMapper.ts:86`、amount_ex_tax 必須担保）
- 時限型: `mapFinancialConditionToConditionLine`（`conditionLineMapper.ts:188`、term_* を親契約からコピー）

---

## 2. 現状の破れ（DB 診断で確証）

### 2-0. DB 診断結果（本番, 2026-07-11）
- `condition_lines` 総数 296。`source_condition_id` 非NULL=72 / `source_line_item_id` 非NULL=142（**新旧混在**）。
- ただし **capability を持つ文書経路の行では source_* はほぼ全NULL**:
  - `purchase_order`: 36行 **すべて source_condition_id=0 / source_line_item_id=0**
  - `license_condition`: 7行中 3行が `source_condition_id`=**別参照(other)**（＝本物の系譜）
  - 他 record_type も 0。
- 非NULLの 72/142 の大半は **capability_id IS NULL の作品モデル由来 CL**（別サブシステム）。

→ **文書（発注書・利用許諾）経路では source_* リンクが実質全滅**。バックフィルされた作品モデル由来のみ値を持つ。

### 2-1. S1【設計の断絶】ランタイム CL 生成がマッパーを通らない
発注書保存は cfc/cli VIEW への INSERT → INSTEAD OF トリガが実書込。直後の `syncConditionLinesForCapability` は `conditionSync.ts:70` で即 `return 0`（ミラー無効）。**`conditionLineMapper.ts` はランタイム死蔵**（バックフィル専用）。値の正しさはトリガ SQL が担保。

### 2-2. S2【時限型＝利用許諾/構成要素引用が機能しない・確定】
cfc トリガ（`0111:39-98`）と cfc VIEW（`0101:304-353`）は `source_condition_id` を**書かない/公開しない**。よって `cl.source_condition_id = cfc.id` 前提の JOIN が **文書経路で恒常0件**:
- `server.ts:6152` 原作マテリアル結線 → **no-op（構成要素の引用が効かない）**
- `server.ts:6439` 加算型 LC別セル分解 → no-op
- `calc_license.ts:193` / `sharedReads.ts:322` / `dataLinkage.ts:998` / `conditionSync.ts:109,290` → CL優先読みは0件だが、多くは cfc VIEW フォールバックで**結果は救済**（挙動不変、ただし CL 優先は死文）。

### 2-3. S3【消費型＝検収の消化が更新されない・確定】
検収同期 `conditionSync.ts:214` の `cl.source_line_item_id = dli.capability_line_item_id` も**恒常0件**（トリガが source_line_item_id を書かない ＋ cli VIEW id=cl.id）。→ **検収イベントが作られず、消費型 CL が永遠に open**。正しくは `cl.id = dli.capability_line_item_id`（稼働中の他 JOIN `server.ts:11583` はこの形）。納期アラート（`server.ts:3954`）は旧比率フォールバックで救済。

### 2-4. S4【地雷・500候補】マッパー直INSERTが削除列を参照
`CONDITION_LINE_COLUMNS`（`conditionLineMapper.ts:300-301`）が **DROP済み `source_ip_id`/`master_contract_id`** を含む。直INSERT箇所（`server.ts:6500` decompose 新規セル 等）は実行されれば `42703 column does not exist` で **500**。現状は S2 で decompose が手前 return するため未到達＝**S2 修正で露出する地雷**。

### 2-5. S5【消費型ライフサイクルの未実装】
`closed_at`/`closed_reason`/`cancelled_at` を**書く経路が皆無**（読むだけ）。早期打切(closed_short)・取消(cancelled)の状態遷移は到達不能。消費型の“閉じる”は `SUM(events) ≥ amount_ex_tax` の導出 fulfilled のみ。

### 2-6. `source_condition_id` は意味が2つ混線している（改修の要）
1. **自己間接**（0101前の名残）: 「基底条件が自分の CL を指す」。0101 後は `cl.id = cfc.id` で表せるため**本来不要**。
2. **本物の系譜(derived-from)**: decompose した LC別セルが親条件を指す（mapper `:259` が `source_condition_id: fc.id`）、license_condition の3行の別参照、引用系譜。**これは保持必須**。

→ **一律 `cl.id` 置換は系譜(2)を破壊する。一律トリガ自己id埋めは decompose の「親idで子を探す」(`server.ts:6439`)を誤爆させる。** サイトごとに (1)/(2) を判定して直す必要がある。

---

## 3. 目標モデル（CL 中核・衛星の単一リンク）

### 3-1. 原則
1. **CL の自己同一性は `cl.id`。** 「自分の CL を取る」用途で `source_condition_id`（自己間接）を使わない。cfc/cli は VIEW（id=cl.id）なので、`cfc`/`cli` の行はそのまま CL。JOIN は `cl.id = cfc.id`（or cfc の列を直接使用）。
2. **`source_condition_id` / `source_line_item_id` は“本物の系譜(derived-from)”専用**に意味を限定。基底条件では NULL、派生（decompose セル・引用）でのみ親 id を持つ。
3. **衛星は CL の列 or capability 経由で単一リンク**:
   | 衛星 | 正リンク | 補足 |
   |---|---|---|
   | 文書番号 | `capability_id` → `documents.document_number` | contract_capabilities は VIEW |
   | 取引先 | `capability_id` → `documents.vendor_id` → vendors | |
   | スタッフ | `capability_id`（backlog_issue_key/staff） | |
   | 作品/原作 | `work_id` / `source_work_id` / `ledger_code` | works |
   | 原作マテリアル(構成要素) | **`source_material_id`**(→work_materials) を正、`material_id` は旧 | 0089/0090 一本化に合わせる |
   | 系譜 | `source_condition_id` / `source_line_item_id` | 派生のみ |
4. **二系統は `payment_scheme` で一意に判別**。消費型は amount+検収イベント、時限型は term_*。CHECK 制約は維持。

### 3-2. 状態（ライフサイクル）の正
- 消費型: `condition_line_status_v` の `consumed_amount = Σ inspection events`、`fulfilled ⇔ consumed ≥ amount_ex_tax`。早期打切/取消を使うなら `closed_at`/`cancelled_at` を**明示 UPDATE する経路を新設**（S5）。
- 時限型: `pending`(term未到来)/`active`/`expired`(term_end超過)。金額消化はしない。

---

## 4. 改修計画（サイト別）

> 方針: **DB スキーマ変更・バックフィルは最小化**し、まず“正リンク列に寄せるコード修正”で回復。系譜(2)のサイトは触らない。

### 4-A. S3（消費型・検収）— JOIN を `cl.id` へ
- `conditionSync.ts:214` の `ON cl.source_line_item_id = dli.capability_line_item_id` → `ON cl.id = dli.capability_line_item_id`。
- 併走の `source_line_item_id = <li id>` 依存（`server.ts:3954,3956-3958`, `4287`, `4592`, `7882` 等）を `cl.id = <li id>` へ統一（cli VIEW id=cl.id 前提）。
- **判定根拠**: これらは全て「cli(=CL) の当該行を取る＝自己間接(1)」。系譜(2)ではない。
- 影響: 検収イベントが生成され消費型 CL の消化が動く。

### 4-B. S2（時限型・構成要素引用）— サイト別に (1)/(2) を判定
- **(1) 自己間接 → `cl.id = cfc.id` へ**:
  - `server.ts:6152`（linkWorkMaterialsForCapability：capability 内の各条件の CL を取る）→ `cl.id = cfc.id`。※要精読で確定。
- **(2) 系譜 → 温存**:
  - `server.ts:6439`（decompose：親idで子セルを探す）は `source_condition_id` が正しい意味。**触らない**。ただし派生セルが `source_condition_id=親` を確実に持つよう、生成経路（mapper 経由 or トリガ）を要確認。
  - `calc_license.ts:193` / `sharedReads.ts:322` / `dataLinkage.ts:998` は「移行済み(source_condition_id 一致)を優先、無ければ cfc フォールバック」の設計。**現状フォールバックで救済されるため優先度低**。CL 中核に寄せるなら段階的に。

### 4-C. S4（地雷）— 削除列を除去（S2/decompose 復活の前に必須）
- `conditionLineMapper.ts:300-301` の `source_ip_id` / `master_contract_id` を `CONDITION_LINE_COLUMNS` から除去。
- 併せて直INSERT箇所（`server.ts:6500` 付近）が生存する列のみを渡すことを確認。

### 4-D. S5（消費型の状態遷移）— 設計判断
- 早期打切/取消を運用で使う → `closed_at`/`closed_reason`/`cancelled_at` を UPDATE する API/内部経路を新設し、`condition_line_status_v` の分岐と接続。
- 使わない → status_v の `closed_short`/`cancelled` 分岐は**現状デッド**である旨を明文化し、UI から状態を出さない。

### 4-E. 実施順序
1. **S4**（削除列除去）… 単独で安全。
2. **S3**（検収 JOIN 是正）… 消費型の生存回復。ステージングで検収→消化を実測。
3. **S2(1)**（素材結線 JOIN 是正）… 構成要素引用の回復。ステージングで発注書→ILT引用を実測。
4. **S2(2)/B/C の CL優先化**（任意・段階的）… フォールバックがあるため後回し可。
5. **S5**（設計判断後）。

---

## 4-bis. 4機能の実現可否マッピング（検収消化・時限・素材登録）

「CL を中核に据える」目的の主要4機能について、**現状**と**本改修後**の可否、依存する修正、確認事項を整理する。

| # | 機能 | 現状 | 改修後 | 依存修正 |
|---|---|:---:|:---:|---|
| 1 | 検収書発行時の発注金額の減算処理 | ✕ | ◯ | **S3** |
| 2 | 処理結果のDB反映（＝発注額が減る） | ✕ | ◯ | **S3** |
| 3 | 利用許諾条件の時限管理 | ◯（見込み） | ◯ | フォームが term_* 送信 |
| 4 | 利用許諾条件明細と原作マテリアルの登録 | ✕ | ◯ | **S2**（＋S4） |

### 1・2 検収→減算→DB反映
- **DB反映の実体は `condition_events(inspection)` を1行挿入すること。** 「発注額が減る」は **残額 = `amount_ex_tax` − Σ検収消化 の導出値**（`condition_line_status_v` `0101:670-673`）。**保存 `amount_ex_tax` は書き換えない**（監査性）。
- 現状: 検収同期 `conditionSync.ts:214` の JOIN が0件 → `condition_line_id=NULL` → `:220` `continue` で **イベント未生成 → 残額が減らない**（S3）。
- 改修後: S3（JOIN→`cl.id = dli.capability_line_item_id`）で検収イベントが生成され、残額が導出で減る。
- **意思決定**: 「減算＝導出残額（保存額は不変）」で運用可か。保存額自体を減らす必要があるなら別設計（監査ログとの整合を要検討）。

### 3 利用許諾条件の時限管理
- `term_start`/`term_end` は cfc トリガが保存（`0111:54`）。status(pending/active/expired) は term_* から導出（`0101:660-665`）で、**S2/S3 の壊れた JOIN に非依存 → 現状でも機能する見込み**。
- **確認**: フォーム（発注書／個別利用許諾 v3）が royalty 条件に**期間(term_start/end)を送っているか**。未送信なら term_* が NULL となり満了判定不可 → 入力欄の追加が必要（機能自体は健全）。

### 4 利用許諾条件明細と原作マテリアルの登録
- 素材結線は `linkWorkMaterialsForCapability` の UPDATE（`server.ts:6074` `source_material_id=$3`）だが、対象 CL の特定に**壊れた JOIN `server.ts:6152`**（source_condition_id）を使うため0件 → **素材が結線されない**（S2）。
- 改修後: S2(1)（JOIN→`cl.id = cfc.id`）で条件明細に原作マテリアルが結線され、個別利用許諾(v3) の構成要素引用候補に出る。加算型の LC別セル分解を使うなら **S4 も同時**（decompose 復活時の削除列 500 回避）。

### 総括
4機能とも **設計上は実現可能で根本ブロッカーは無い**。1・4 は現状 S3/S2 の壊れた JOIN で不動だが原因特定済み・**移行不要のコード修正で回復**。3 は元々健全（入力有無のみ確認）。

---

## 5. テスト計画（ステージング必須・ローカル/本端末では DB不可）
1. 発注書に「固定報酬(執筆料)＋ROYALTY(利用許諾)」を混在させ保存 → `condition_lines` に payment_scheme=lump_sum と royalty の2行が正しい列で生成されるか（CHECK 違反なし）。
2. 検収を1件登録 → `condition_events(inspection)` が生成され、`condition_line_status_v.consumed_amount` が増える（S3 回復）。amount 到達で fulfilled。
3. 発注書の ROYALTY 条件に原作マテリアルが結線される（`server.ts:6152` 経路）→ 個別利用許諾(v3) の構成要素引用候補に出る（S2 回復）。
4. 加算型 ROYALTY の LC別セル分解が Σ料率=元料率で生成される（`server.ts:6439`、S2(2)）。
5. 回帰: 既存の 72/142(作品モデル由来 source_*) が壊れない（診断SQLで件数不変）。
6. 500 非再発: decompose 実行で `source_ip_id` 列エラーが出ない（S4）。

### 検証用 SQL（適用前後で比較）
```sql
-- 記録種別ごとの source_* 充足と自己/系譜内訳
SELECT cc.record_type, count(*) n,
       count(cl.source_condition_id) has_cond,
       count(*) FILTER (WHERE cl.source_condition_id = cl.id)  cond_self,
       count(*) FILTER (WHERE cl.source_condition_id <> cl.id) cond_other,
       count(cl.source_line_item_id) has_line
  FROM condition_lines cl JOIN contract_capabilities cc ON cc.id = cl.capability_id
 GROUP BY 1 ORDER BY 2 DESC;
```

---

## 6. 未決事項・意思決定ポイント
1. **S2(1) 対象サイトの確定**: `server.ts:6152` が本当に「自己間接」か、`source_condition_id` の系譜を要するかを精読で確定（本設計は自己間接と仮定）。
2. **原作マテリアルの正リンク**: `source_material_id` を正・`material_id` を旧、で確定してよいか（work_materials 一本化との整合）。
3. **S5**: 消費型の早期打切/取消を運用で使うか（closed_*/cancelled_* を活かすか、デッドとして明文化か）。
4. **本番データの混在**: 72/142 の作品モデル由来 source_* を今回の改修で触るか（触らない前提。将来 CL 中核へ寄せる別タスクとするか）。
5. **cfc/cli フォールバックの段階的撤去**: 4-B(2)/C を「CL 優先の単一経路」に寄せるのは別フェーズとするか。

---

## 付録: 主要参照
- CL 定義: `migrations/0063_condition_lines_unification.sql:52`
- VIEW化: `migrations/0101_simplify_condition_core.sql:304`(cfc), `:355`(cli), `:213`(capability); cfc トリガ `migrations/0111_cfc_condition_name_label_fallback.sql:39`
- マッパー: `services/worker/src/lib/conditionLineMapper.ts:86`(消費型), `:188`(時限型), `:300`(列配列)
- 素材結線 JOIN(S2): `services/worker/server.ts:6152`, decompose `:6439`
- 検収同期 JOIN(S3): `services/worker/src/lib/conditionSync.ts:214`
- 状態ビュー: `migrations/0101_simplify_condition_core.sql:646`(condition_line_status_v)
