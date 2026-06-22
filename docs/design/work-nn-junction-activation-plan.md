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
| **1. 中間表を populate（デュアル化）** | `PATCH /api/v3/condition-lines/:id/attach-work` を拡張（任意で `source_material_id` も受け、結合後に `syncWorkComponentLink` で `work_components(work_id, material_id)` ensure＋`work_component_lines` を張る）。`work_id`＋`source_material_id` が揃う時のみ中間表に書き、外れたら除去。冪等。既存フラット列とデュアル書込。一意化は migration 0079（`work_components(work_id, material_id)` 部分ユニーク）。 | migration 0079 ＋ workModel.ts | 🚧 実装（`feat/work-nn-junction-stage1`） |
| **2. グラフが N:N を読む** | `GET /api/v3/works/:id/graph` のエッジ取得を **中間表(work_component_lines)経由 ∪ フラット(work_id)** で引くよう変更。1明細→複数作品(N:N)が見え、移行期はフラット経由(graph-link 素材後付け・既存データ)も拾い欠落しない。FE 変更なし（同一明細が複数作品のグラフに現れるのは Stage3 の複数結線後）。 | workModel.ts | ✅ 実装（`feat/work-nn-junction-stage2`） |
| **3. ピッカー UI** | 作品編集→「原作をテーブルから選択」→その原作の利用許諾条件明細を一覧→「この作品に追加」で**加算結線**（共有＝他作品の結線を消さない／「外す」はこの作品ぶんだけ）。backend: `GET /api/v3/source-ips/:id/condition-lines`（原作の明細・linked_here）＋ `POST/DELETE /api/v3/works/:workId/component-lines`（加算 link/unlink。`linkWorkComponent`/`unlinkWorkComponent`）。FE: `WorkGraphPanel` 左下に原作ピッカー。 | workModel.ts ＋ WorkGraphPanel | ✅ 実装（`feat/work-nn-junction-stage3`） |
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

## 4.1 Stage 1 補足：経路カバレッジ（重要）

- 中間表を populate する正準経路は **`attach-work`**（作品結合＝`work_id` を張る操作。Stage 3 のピッカーもこの 1 本を呼ぶ）。`source_material_id` も同時に渡せるため、ピッカーは work＋material を一発で結べる。
- 一方、worker 側 `PATCH /api/condition-lines/:id/graph-link`（増分⑥の per-エッジ「素材に紐付け」）で **material のみ**を後から張る経路は、別サービス（worker）かつ単独では `work_id` が無いため、Stage 1 では**中間表を同期しない**。
- これは問題にならない：**中間表を読むコードはまだ無い**（Stage 2 未着手＝書込のみ）。graph-link 経由・既存データを含む全体整合は **Stage 4 のバックフィル**（フラット列→中間表）で一括収斂する。Stage 1 は新規 attach-work 経路の populate を確立するのが目的。
- 収斂後（Stage 3/4）、worker graph-link の素材リンクは attach-work（api）へ寄せるか、worker 側にも同期を複製するかを決める（クロスサービス重複の回避）。

## 5. 未解決・要決定（後続 Stage で詰める）

- **work_id の扱い**: Stage 3 の加算結線では **work_id は「主作品」のヒントに降格**（未設定時のみ補完、共有のため既存値は上書きしない）。中間表が N:N の真実。完全廃止（読み取りを中間表へ一本化）は Stage 4。
- **書込経路の二系統**: ⑧ `attach-work`（work_id 単一・`syncWorkComponentLink` は他コンポーネント除去）と Stage3 ピッカー（加算・共有）が併存。同一明細を両経路で操作すると齟齬の恐れ。Stage 4 で経路を加算結線へ一本化し `syncWorkComponentLink` の除去ロジックを撤廃する。
- **component_no 採番**: `work_components(work_id, component_no)` の連番採番ルール（material 追加順 / material_no 由来）。Stage 1。
- **受取側（派生作品 / ライセンスアウト）**: 派生作品＝works ノードの再帰（§1.1 で合意）。受取×license の中間表表現を Stage 2 で確定。
- **原作 source-ips POST の素材**: 台帳 materials を作る現行を work_materials 直作成（or ミラー）に寄せる時期。Stage 0〜1。
- **重複条件の単一化**: 既にフラットで複製済みの「同一マテリアル条件×複数作品」を中間表へ統合する突合ロジック。Stage 4。
