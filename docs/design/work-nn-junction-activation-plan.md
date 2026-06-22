# 設計書：N:N 中間表（work_components / work_component_lines）活性化プラン

- 版: **v0.1（ドラフト）** — 2026-06-22 起案。Stage 0 マイグレーション(0078)同梱。
- 位置づけ: [work-3card-unified-editor-spec.md](work-3card-unified-editor-spec.md) の続き。3カードエディタの「ノードをテーブルから選び、条件明細を橋に数珠つなぎ」UX を、データモデルとして正しく N:N で支えるための基盤整備。
- 上位前提: condition_lines が状態を持つ中心・真実源（[condition_lines_unification_design.md](../condition_lines_unification_design.md)）。本プランはその骨格「**work_components がイン側条件明細と N:M ＝作品＝権利の束**」を実装で起こす。

---

## 1. 背景と要求

### 1.1 ユーザー要求（UX）

作品編集画面で、**ノードをテーブルからピックし、条件明細（利用許諾条件）を橋に数珠つなぎ**する直観操作：

```
[原作] ─1:N→ [原作マテリアル] ═══利用許諾条件明細(橋)═══ [作品] ─同様─ [派生作品]
                        └──────── N:N ────────┘
```

- 条件（利用許諾条件明細）は**原作そのものでなくマテリアルにぶら下がる**
- 原作 : 作品 ＝ **1 : N**
- 原作マテリアル : 作品 ＝ **N : N**（同一原作マテリアルの利用許諾条件を**複数作品で共有**できる）
- 派生作品も同型（作品の条件明細を橋に再帰）

### 1.2 現状の橋は「フラット」で N:N を表せない

現行の紐付けは `condition_lines` 上のフラット構造：1本の明細が `(source_material_id 1件, work_id 1件)` を持つ ＝ **「1明細 ＝ 1マテリアル × 1作品」**。

→ 「同じ原作マテリアルの利用許諾条件を複数作品で共有」ができない（作品ごとに明細を複製する羽目になり、"条件はマテリアルにぶら下がる＝単一所有" と矛盾）。

### 1.3 受け皿はスキーマに存在するが休眠中

真の N:N を担う中間表は [0063](../migrations/0063_condition_lines_unification.sql) で定義済み：

```
work_components       (id, work_id, component_no, component_kind, material_id, notes)
work_component_lines  (component_id, condition_line_id)   ← N:N ジャンクション
```

ただし**どのコードも INSERT しておらず休眠**（populate なし）。これを起こすのが本プラン。

---

## 2. ブロッカー：マテリアル表の二重化（Stage 0 で解消）

中間表を橋にするには、まず「どのマテリアル表が正準か」を揃える必要がある。

| 参照元 | 指す表 | 出所 |
|---|---|---|
| `work_components.material_id` | **`materials`**（台帳 LO-…-001） | 0063 |
| `condition_lines.source_material_id` | **`work_materials`**（works系） | 0074 |
| 3カードエディタ / `/graph` | **`work_materials`** | workModel.ts |
| 原作(source-ips POST)が作る素材 | **`materials`**（台帳） | workModel.ts:329 |

**決定（ユーザー合意 2026-06-22）: `work_materials` を正準**とする。エディタ・条件明細が既に work_materials を使うため、これが自然で破壊が最小。`materials`（台帳）側に揃える逆方向はエディタ全体の作り直しになり非採用。

→ Stage 0 で `work_components.material_id` の FK を **materials → work_materials** に付け替える（[migration 0078](../migrations/0078_work_components_material_repoint.sql)）。

---

## 3. 段階実装プラン

| Stage | 内容 | 成果物 | 状態 |
|---|---|---|---|
| **0. 表の正準化** | `work_components.material_id` を `work_materials` へ repoint。0076 の materials→work_materials 取込を冪等 top-up し、中間表が指すべき work_materials を確実化。原作 `POST /api/v3/source-ips` も work_materials を作る（or ミラー）への追従は Stage 1 で。 | migration 0078 ＋ API微修正 | 🚧 migration ドラフト作成 |
| **1. 中間表を populate（デュアル化）** | 「原作マテリアル明細 → 作品」リンク時に `work_components(work_id, material_id)` を ensure し `work_component_lines(component_id, condition_line_id)` を張る API（`PATCH /api/condition-lines/:id/attach-work` 系を拡張 or 新設）。当面は既存フラット列（`source_work_id`/`source_material_id`/`work_id`）と**デュアル書き込み**で既存を壊さない。 | API | 未着手 |
| **2. グラフが N:N を読む** | `GET /api/v3/works/:id/graph` のエッジ取得を中間表経由に拡張（1明細→複数作品が見える。受取側・派生も同様）。フラット読みと突き合わせて差異検出。 | API | 未着手 |
| **3. ピッカー UI** | 作品編集→「原作をテーブルから選択」→その原作のマテリアル＋利用許諾条件明細を一覧→橋にする明細をピック→中間表で結線。派生作品も同型（再帰）。`WorkGraphPanel` の per-エッジ select を、ノード起点のテーブルピッカーに発展。 | WorkGraphPanel | 未着手 |
| **4. 移行・フラット廃止** | 既存フラットリンクを中間表へバックフィル → デュアル期間後にフラット列を段階廃止（読み取りを中間表へ一本化）。 | migration/script | 未着手 |

> 推奨着手順: 0（基盤）→ 1（書き込み・デュアル）→ 2（読み取り）→ 3（UX）→ 4（収斂）。各 Stage は既存を壊さない additive で進め、UI 切替（Stage 3）まで現行フラット経路を生かす。

---

## 4. Stage 0 マイグレーション（0078）詳細

[migrations/0078_work_components_material_repoint.sql](../migrations/0078_work_components_material_repoint.sql)

1. **安全確認**: `work_components.material_id` に `work_materials` 非対応の値がある場合は `RAISE EXCEPTION` で中断（休眠＝空前提。非空なら人手マッピングを促す）。
2. **FK 付け替え**: 既存の materials 参照 FK を名前非依存で drop → `work_materials(id)` 参照 FK を冪等に追加。
3. **冪等 top-up**: 0076 の materials→work_materials 取込を NOT EXISTS ガードで再掲（0076 以降に source-ips POST 等で増えた台帳素材も work_materials に揃える）。

additive・冪等。旧表（materials）は削除しない（物理廃止は Stage 4 以降の別移行）。

---

## 5. 未解決・要決定（後続 Stage で詰める）

- **work_id の扱い**: 中間表が N:N の真実になった後、`condition_lines.work_id`（単一作品）は「主たる作品」の導出列に降格するか、廃止するか。Stage 1〜2 で決定。
- **component_no 採番**: `work_components(work_id, component_no)` の連番採番ルール（material 追加順 / material_no 由来）。Stage 1。
- **受取側（派生作品 / ライセンスアウト）**: 派生作品＝works ノードの再帰（§1.1 で合意）。受取×license の中間表表現を Stage 2 で確定。
- **原作 source-ips POST の素材**: 台帳 materials を作る現行を work_materials 直作成（or ミラー）に寄せる時期。Stage 0〜1。
- **重複条件の単一化**: 既にフラットで複製済みの「同一マテリアル条件×複数作品」を中間表へ統合する突合ロジック。Stage 4。
