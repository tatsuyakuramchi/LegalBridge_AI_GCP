# 発注書/利用許諾条件 明細ごとの作品帰属 設計メモ

ステータス: **設計合意済み・実装中** / 2026-06-26 起票
関連: [`work-material-condition-copy-plan.md`](./work-material-condition-copy-plan.md) / [`condition_lines_unification_design.md`](../condition_lines_unification_design.md)

---

## 1. 背景・狙い

発注書は **作品が複合的**(1枚に複数タイトル)になることが多い。例:

```
発注書「翻訳業務」
  明細1  作品AA
  明細2  作品AA2
  明細3  作品AA3
```

また、権利帰属が**受注者(=当社)**の執筆が2作品分あれば、対応する**利用許諾条件明細も明細(作品)ごと**に必要。
→ 目指すモデル: **作品 1 : 文書 N : 明細 N**（1作品に複数の文書・複数の明細/条件がぶら下がる）。

### 現状(調査結果)
- **1文書=1作品 前提**。作品は文書単位の `formData.linked_work_id` のみ。
- `condition_lines.work_id` は**存在し** `ensureMaterialAndCompose` が `COALESCE(ownWorkId, work_id)` で設定中(ただし ownWorkId は文書単位)。
- `capability_line_items` / `capability_financial_conditions` には **work_id が無い**。
- 受注者帰属ROYALTY明細 `licenseItems` → `condition_no = line_no` で 1:1 に金銭条件へ変換(server.ts:15071-)。

## 2. 決定事項(2026-06-26)
- **D1. 作品の用意 = 既存作品から選択のみ**(行内新規作成はしない。受注者帰属の新作品は事前に作品マスター登録)。
- **D2. 明細→条件の作品は自動連動**(受注者帰属明細の work_id を、対応する利用許諾条件明細へ継承。`condition_no=line_no` で対応)。
- **D3. スコープ = 集約ビュー(作品1:文書N:明細N)まで一気に**。

## 3. 設計(キー: work_id を明細層に持たせ、condition_lines へ伝播)

### Phase A — DB(migration 0084)
- `capability_line_items.work_id INTEGER REFERENCES works(id)` 追加 + index。
- `capability_financial_conditions.work_id INTEGER REFERENCES works(id)` 追加 + index。
- `condition_lines.work_id` は既存(追加不要)。

### Phase B — マッパー / 保存(worker, services/api)
- `conditionLineMapper`: `CONDITION_LINE_COLUMNS` に `work_id` 追加。`mapLineItemToConditionLine`(li.work_id)・`mapFinancialConditionToConditionLine`(fc.work_id)で work_id を設定。
- `capability_line_items` INSERT/UPDATE に `work_id`(poItems[i].work_id)。
- `upsertCapabilityFinancialConditions` に `work_id`(c.work_id)。
- 受注者帰属 `mappedConds` に `work_id: it.work_id` を付与(**D2 連動の実体**)。共通条件 `mappedCommon` も同様。
- `linkWorkMaterialsForCapability` のループで `ensureMaterialAndCompose({ ownWorkId: Number(c.work_id) || ownWorkId })` と per-condition 化。
- 読取: `capability_line_items` / `capability_financial_conditions` の SELECT に work_id を追加(フォーム往復・集約用)。

### Phase C — フォーム(main)
- `LineItem` 型に `work_id?: number`、`FinancialCondition` 型に `work_id?: number`。
- `LineItemTable`(発注書明細)に **行ごとの作品セレクタ**(worksList 由来、既存選択のみ)。
- `FinancialConditionTable`(利用許諾条件)に **条件ごとの作品セレクタ**。
- `DocumentForm`: `worksList`(GET /api/v3/works, 既存取得)を両テーブルへ props で渡す。未指定行は文書 `linked_work_id` にフォールバック(単一作品フロー温存)。

### Phase D — 集約ビュー(作品1:文書N:明細N)
- 読取 API: ある作品に紐づく 文書/明細/条件 を集約。`condition_lines.work_id` と `capability_line_items.work_id` で GROUP。services/api workModel.ts に `GET /api/v3/works/:id/attributions` 等。
- 画面: 既存 WorkGraphPanel を拡張 or 作品詳細に「この作品の文書・明細・条件」一覧を追加。

## 4. 互換・フォールバック
- 明細/条件の work_id 未指定 → 文書 `linked_work_id` にフォールバック(従来の単一作品挙動を維持)。
- 既存データは work_id NULL のまま(backfill は別途。WorkGraphPanel 等は NULL を文書 work で補完表示)。

## 5. デプロイ
- migration 0084 + worker server.ts + conditionLineMapper → `release/worker`(migrate)。
- 集約 read API(workModel.ts) → `release/api`。
- フロント(型・セレクタ・集約画面) → main。

## 6. Phase 進捗
- [x] A: migration 0084(capability_line_items/cfc.work_id)
- [x] B: conditionLineMapper(work_id列)＋ capability_line_items/cfc upsert ＋ 受注者帰属継承(D2)＋ linkWorkMaterialsForCapability per-condition化
- [x] C: LineItemTable/FinancialConditionTable に作品セレクタ、DocumentForm で worksList→workOptions 配線
- [x] D: GET /api/v3/works/:id/attributions(集約API)＋ WorkAttributionsPanel を WorkGraphPanel に組込み

### 補足(D2 連動の適用範囲)
- 受注者帰属明細→**派生型**条件(共通条件なし)は `condition_no=line_no` で work_id をサーバ側自動継承。
- 発注書の**共通利用許諾条件**(formData.financial_conditions あり)は明細と1:1でないため、条件ごとに作品セレクタで指定(独立)。
- 個別利用許諾条件書も条件ごとにセレクタで指定。

### E: 既存データ backfill【済】
- `0085_backfill_per_line_work_id.sql`: 既存の `condition_lines.work_id`(旧来の文書単位リンクで設定済)を、`source_line_item_id`/`source_condition_id` をたどって `capability_line_items.work_id` / `capability_financial_conditions.work_id` へ逆伝播。これで集約ビューが既存明細も拾える。NULL のままでも文書 work フォールバックで安全(冪等)。
- 検証SQL: `scripts/audit/per_line_work_check.sql`(列存在・充足率・複数作品混在発注書・作品集約)。

### 残(任意)
- 集約ビューに「文書単位帰属(linked_work_id)のみで明細未割当の文書」も含めるか(現状は明細単位帰属のみ)。
- 実データ検証(複数タイトル発注書で行ごと割当→保存→集約確認)はバックエンド+シード環境が必要。
