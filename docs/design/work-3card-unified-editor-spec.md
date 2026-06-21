# 設計書：3カード統合エディタ — 入力フォーム仕様（Work 3-Card Unified Editor）

- 版: **v1.0（確定）** — 2026-06 レビュー反映。エディタ=別ページ`/works/:id` / 原作リンク=左カード / サイドバー「作品管理」/ 許諾地域引用 を確定。増分④から実装着手。
- 位置づけ: [work-source-ip-unification.md](work-source-ip-unification.md) §10「入力フォーム：3カード統合エディタ」の**実装向け詳細仕様**。上位設計書の確定事項（works 集約 / direction × transaction_kind / 条件は個別条件書の condition_lines を参照）を前提とする。
- 対象: admin-ui（`src/pages/master/`） / worker・search-api（`/api/v3/*`）
- 目的: **原作・作品・派生物を 1 画面で登録/編集**し、「原作マスター2系統」「どこで登録しても参照先に出ない」構造問題を解消する。

---

## 1. 背景：現状と目標のギャップ

### 1.1 いま起きていること（意図とのズレ）

| 画面 | 実体 | 役割 | 問題 |
|---|---|---|---|
| `LedgersPanel`（MST · LEDGERS 原作） | `ledgers`+`materials`（`LO-`） | 原作のカード一覧 CRUD | 作品と**別画面・別系統** |
| `WorkModelPanel` | `works`/source-ips/contracts（`W-`/`IP-`） | 原作IP/自社作品/契約を**タブで分離**して CRUD | 原作が2系統目。統一エディタではない |
| `WorkGraphPanel` | `works` のグラフ | 3カードの**読み取りビュー** + 増分編集（素材追加・エッジ参照リンク） | ノードの新規作成/原作の編集ができない。作品(own)選択起点のみ |

→ ユーザー視点では「原作と作品が別画面でバラバラ」。本仕様はこれを **単一の統合エディタ**へ収斂させる。

### 1.2 目標

- 一覧と編集を **`works`（`kind ∈ {source, own}`）に一元化**。`LedgersPanel` は廃止。
- 編集は **3カード（左=原作/調達 → 中=作品 → 右=派生物/受取）** の 1 画面。
- カード間（エッジ）= `condition_lines`（`direction × transaction_kind`）を**参照リンク**（新規作成はしない。条件の真実源は個別利用許諾条件書 / 出版等利用許諾条件書）。
- 既存 `WorkGraphPanel`（読み取り + 増分編集）を**土台に拡張**する。ゼロからは作らない。

---

## 2. 全体構成：2 ビュー

```
[ 一覧ビュー (Works List) ]  ──選択/新規──▶  [ 3カード統合エディタ (Work Graph Editor) ]
   kind フィルタ付き単一一覧                     左=原作  中=作品  右=派生物
```

### 2.1 一覧ビュー（`LedgersPanel` + `WorkModelPanel` の作品/原作タブを置換）

```
┌ MST · WORKS ─────────────────────────────────────────────────┐
│ 作品・原作マスター                                             │
│ 原作(ライセンスイン)と自社作品を一元管理し、権利フローを3カードで編集 │
├───────────────────────────────────────────────────────────────┤
│ [ すべて | ● 原作 source/LO | 自社作品 own/W ]   ← kind フィルタ │
│ 🔍 タイトル / コード / 権利者で検索         [+ 新規 ▾]          │
│                                              ├ 原作を登録 (source)│
│                                              └ 自社作品を登録 (own)│
├───────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌─────────────────────┐               │
│ │LO-2026-0015 [原作][有効]│ │W-2026-0003 [作品][制作中]│           │
│ │ Ito                       │ │ 〇〇ゲーム                │           │
│ │ 権利者: A社 / 素材 1件     │ │ board_game / 原作: Ito  │           │
│ │ 支払 2 · 受取 0    [編集]  │ │ 支払 1 · 受取 3   [編集] │           │
│ └─────────────────────┘ └─────────────────────┘               │
└───────────────────────────────────────────────────────────────┘
```

- カードに **種別バッジ（原作/作品）** と **エッジ件数（支払/受取）** を表示。原作⇄作品の結合関係（「原作: Ito」）を作品カードに表示し、統一感を可視化。
- 「編集」/「行クリック」で 3カードエディタへ遷移（作品は自身の `id`、原作は「その原作を中心に置いたエディタ」を開く。§3.4 参照）。

### 2.2 3カード統合エディタ（`WorkGraphPanel` を CRUD 化）

```
┌ WORK · GRAPH EDITOR ─────────────────────────────────────────────────────────┐
│ 中心: [ W-2026-0003 〇〇ゲーム ▾ ]   [保存] [プレビュー(受取マップ)]            │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌── 左: 原作 / 調達（支払 ▶）──┐ ┌── 中: 作品 own ──┐ ┌── 右: 派生物 / 受取（◀）─┐│
│ │ [+ 原作を参照/新規]            │ │ W-2026-0003       │ │ [+ 受取先を参照/新規]      ││
│ │ ┌ 支払エッジ ──────────┐ │ │ 〇〇ゲーム         │ │ ┌ 受取エッジ ───────┐  ││
│ │ │[利用許諾] Ito 原作本体  │ │ │ board_game/制作中 │ │ │[利用許諾] 海外版 X社  │  ││
│ │ │ A社 · 8%               │ │ │                   │ │ │ X社 · 受取 10%       │  ││
│ │ │ 個別条件書: LIC-…0021   │ │ │ ─ 素材 ─          │ │ │ 個別条件書: LIC-…0044 │  ││
│ │ │ ↳ 素材に紐付け: 001 ▾   │ │ │ 001 原作本体[本体]│ │ │ ↳ 製品に紐付け: SKU ▾ │  ││
│ │ └────────────────┘ │ │ 002 イラスト      │ │ └──────────────┘  ││
│ │ ┌ 委託(service)エッジ ──┐ │ │ [+ 素材を追加]    │ │ ┌ 物販アウト(product)─┐  ││
│ │ │[委託] カバー外注 買取   │ │ │                   │ │ │[物販] 卸 Y社 ¥1,200  │  ││
│ │ │ 発注書: PO-…0102        │ │ │ ─ 製品(SKU) ─     │ │ └──────────────┘  ││
│ │ └────────────────┘ │ │ SKU-… 通常版      │ │ [+ 製品を追加]            ││
│ │ [+ 原作リンクを追加]          │ │ [+ 製品を追加]    │ │                          ││
│ └──────────────────────┘ └──────────────┘ └────────────────┘│
│        ◀── 支払×(license|service) ──         ── 受取×(license|product) ──▶       │
│           condition_line を参照リンク             condition_line を参照リンク      │
└──────────────────────────────────────────────────────────────────────────────┘
```

> 並びは**最新コミット（`82942be`）の実装に合わせ「左=原作/調達(支払) → 中=作品 → 右=派生物/受取」**で確定。上位設計書 §10.2 の旧記載（右=原作）は本仕様で上書き。

### 2.3 ナビゲーション / ルーティング

サイドバー（[Sidebar.tsx](../src/layout/Sidebar.tsx)）に独立エントリ **「作品管理 / WORKS」** を新設する。原作・自社作品・派生（外部ライセンス）を含む作品関連の単一入口とする。

| 項目 | 値 |
|---|---|
| グループ | Configuration（`Masters` の上に配置）|
| ラベル | `作品管理`（WORKS）|
| アイコン | `Network`（または `GitBranch`）lucide |
| description | `原作 / 作品 / 派生` |
| ルート | `/works`（一覧ビュー §2.1）|

```ts
// Sidebar.tsx Configuration グループに追加
{ to: "/works", label: "作品管理", icon: Network, description: "原作 / 作品 / 派生" },
```

| ルート | 画面 |
|---|---|
| `/works` | 一覧ビュー（kind フィルタ §2.1）|
| `/works/:id` | 3カード統合エディタ（別ページ・§2.2）。中心ノードの `id` |
| `/works/new?kind=source\|own` | 新規作成（一覧の「+ 新規 ▾」から）|

> 既存 `/master/work-graph`（`WorkGraphPanel`）は `/works/:id` に発展統合。`LedgersPanel`（`/master` 内タブ）は移行後に廃止し、本エントリへ集約。

---

## 3. 各カードの入力/編集仕様

### 3.1 中カード = 作品（`works.kind='own'`）

エディタの中心ノード。ここが空のとき（新規作品）はインラインで基本情報を入力。

| セクション | 項目 | 型 | 裏側 | 備考 |
|---|---|---|---|---|
| 基本情報 | title* | text | `works.title` | 必須 |
| | title_kana | text | `works.title_kana` | |
| | alternative_titles[] | array | `works.alternative_titles` | , 区切り |
| | division[] | array | `works.division` | 例: BDG, PUB |
| 区分・状態 | work_type | select | `works.work_type` | board_game / trpg_book / supplement / digital |
| | status | select | `works.status` | planning / in_production / released / suspended / discontinued |
| 素材 | （サブテーブル）| — | `work_materials` | §3.3 |
| 製品 | （サブテーブル）| — | `products` | §3.5 |
| 系譜・備考 | parent_work_id | work-select | `works.parent_work_id` | 派生元 |
| | derivation_type | select | `works.derivation_type` | 翻訳/版/改題/地域化/翻案 |
| | remarks | textarea | `works.remarks` | |

→ フィールド定義は既存 `WORK_FIELDS`（[WorkModelPanel.tsx:56](../src/pages/master/WorkModelPanel.tsx)）の `kinds:["own"]` をそのまま流用。

### 3.2 左カード = 原作 / 調達（`works.kind='source'` + 支払エッジ）

| 区分 | 項目 | 裏側 |
|---|---|---|
| 原作ノード | title*, title_kana, alternative_titles[], division[] | `works`（source） |
| 権利・既定値 | rights_holder_vendor_id*, original_publisher, default_rights_holder, default_credit_display, default_work_supplement, default_approval_target, default_approval_timing | `works`（source用フィールド。`WORK_FIELDS` の `kinds:["licensed_in"]`）|
| 素材 | （サブテーブル）| `work_materials`（§3.3）|
| **支払エッジ** | 該当**個別利用許諾条件書を選択** → その `condition_lines`（`direction='pay'`, `transaction_kind ∈ {license, service}`）を参照リンク | §3.6 |

- 「+ 原作を参照/新規」: 既存 `works(source)` を検索選択 or その場で新規作成。
- 1 作品 → 複数原作（1対N）。原作リンクは複数追加可。

### 3.3 素材サブテーブル（`work_materials`）— 左/中で共用

| 列 | 型 | 裏側 | 備考 |
|---|---|---|---|
| material_no | auto | `material_no` | 連番 |
| material_code | auto | `material_code` | `{work_code}-NNN`。本体= `-001` |
| material_name* | text | `material_name` | |
| material_type | select | `material_type` | original/translation/illustration/scenario/design/music |
| acquisition_type | select | `acquisition_type` | **license / buyout_commission / in_house**（取得経路）|
| rights_holder_vendor_id | vendor-select | `rights_holder_vendor_id` | |
| is_default | toggle | `is_default` | 原作本体フラグ |

- 既存 `POST /api/v3/works/:id/materials`（[WorkGraphPanel.tsx:167](../src/pages/master/WorkGraphPanel.tsx)）を流用・拡張（現状は name/type/rights_type のみ → acquisition_type 等を追加）。
- `acquisition_type='buyout_commission'`（買い切り委託）の素材は、左カードの**委託(service)エッジ**（発注書明細）に紐付く（設計書 §2.2.2）。

### 3.4 原作起点で開いた場合

一覧で原作カードを選ぶと、**その原作を「左カード」に固定**し、中央は「この原作を参照している作品」を選択するピッカーにする（未参照なら「この原作から作品を新規作成」導線）。これにより原作・作品どちらからでも同じ統合エディタに入れる。

### 3.5 右カード = 派生物 / 受取（取引先 + `products` + 受取エッジ）

| 区分 | 項目 | 裏側 |
|---|---|---|
| 製品(SKU) | product_code(auto), product_name*, format, msrp, jan/isbn | `products`（`work_id` 配下）|
| 受取先 | counterparty_vendor_id（サブライセンシー/卸先）| エッジ側 `counterparty_vendor_id` |
| **許諾地域・言語** | **条件明細から引用表示**（再入力しない）| §3.8 |
| **受取エッジ** | 該当個別条件書 → `condition_lines`（`direction='receive'`, `transaction_kind ∈ {license, product}`）を参照リンク。製品にも紐付け | §3.6 |

- 派生物は「取引先(vendor) + 製品」で表現し、ノード種別は増やさない（設計書 §2.3 決定）。
- 外部ライセンス派生（受取×license）には、許諾地域（テリトリー/言語）を §3.8 の引用で表示する。

### 3.6 エッジ（条件明細）の参照リンク — ★全カード共通の中核

- **エディタは `condition_lines` を新規作成しない**（設計書 §10.7）。条件の真実源は個別利用許諾条件書 / 出版等利用許諾条件書。
- 操作フロー:
  1. 「+ エッジを追加」→ `DocumentNumberLookup`（[DocumentNumberLookup.tsx](../src/components/document/DocumentNumberLookup.tsx)）で**個別条件書を選択**。
  2. その条件書が生成した `condition_lines` を一覧表示 → エッジとして**参照リンク**（`source_work_id` / `source_material_id` / `product_id` / `counterparty_vendor_id` を埋める）。
  3. 既存 `PATCH /api/condition-lines/:id/graph-link`（[WorkGraphPanel.tsx:151](../src/pages/master/WorkGraphPanel.tsx)）で紐付けを保存。
- 種別トグル（license/product/service）と金額様式（royalty=%表示 / per_unit・lump_sum=¥表示）は既存 `KIND_META` / `payment_scheme` 表示ロジックを流用。
- （将来オプション）「このエディタから個別条件書を起票 → その場で条件明細を作る」導線。本版ではスコープ外。

### 3.7 「派生」の3概念の区別 — ★同一原作から当社が複数作品を作るケース

「派生」という語が重なるため、モデル上は3つを厳密に分ける。

| # | 関係 | 主体 | エッジ/列 | 制約 | カード表現 |
|---|---|---|---|---|---|
| ① ライセンスイン | 原作 → 自社作品 | **当社が作る** | `condition_lines` 支払×license（`source_work_id`=原作 / `work_id`=自社作品）| `source_work_id` は UNIQUE なし | 各自社作品の中カード＋左カードの支払エッジ |
| ② 派生物/ライセンスアウト | 自社作品 → 外部 | **サブライセンシーが作る** | 受取×license（`counterparty_vendor_id`）| — | 右カード（vendor+製品。works ノードにしない）|
| ③ 系譜（派生版） | 作品 → 作品 | どちらも | `works.parent_work_id` + `derivation_type` | migration 0025「版ではなく別作品」決定 | 別 works を系譜リンク |

**「当社が同一原作を利用して作る複数の作品」= ① で表現する**（②の派生物ではない）。

- `condition_lines.source_work_id` は **UNIQUE 制約のない単純 FK**（[migrations/0074](../migrations/0074_unify_phase1_additive.sql)）。同一原作を `source_work_id` に持つ支払エッジを**複数行**作れるため、1 原作 → N 自社作品が**スキーマ変更なしで**成立（設計書 §2.2.1）。
- 作品A・作品Bは**原作を共有する兄弟ノード**であって互いに派生ではない。各々が独立した `works(own)` で、それぞれ自身の 3カードエディタを持つ。

```
            ┌─支払×license─▶ [作品A own / W-…0003]
[原作 Ito source/LO]
            └─支払×license─▶ [作品B own / W-…0008]
   source_work_id を共有する2本の独立エッジ（兄弟。互いに派生ではない）
```

> 区別: 作品A の翻訳版/改訂版を**当社が**作る場合は ③（`parent_work_id`）。①は「同一原作から別企画を起こす」、③は「ある作品の派生バージョン」。

**エディタ補強（3カードは1作品中心ゆえ兄弟関係が見えにくい問題への対応）:**
1. 左カード（原作）に **「この原作を利用する他の自社作品」のクロスリンク**を表示（作品A編集中でも 原作 Ito → 作品B が辿れる）。データ取得: `condition_lines` を `source_work_id` で集約。
2. 原作起点で開いた場合（§3.4）の中カードを **「この原作を利用している自社作品の一覧 ＋ 新規作成」ピッカー**にする。

### 3.8 許諾地域・言語の引用表示（territory）— ★外部ライセンス派生

外部ライセンス派生（右カードの受取×license エッジ）に、**許諾地域・言語を条件明細から引用して表示**する。エディタでは再入力しない（条件の真実源は個別利用許諾条件書。設計書 §10.4 と同じ責務分離）。

**所在（重要）:** `condition_lines` 自体に territory 列は無い。地域・言語は**出所の利用許諾条件**に乗る。

| 項目 | 列 | テーブル |
|---|---|---|
| テリトリー | `region_territory` | `capability_financial_conditions`（[0058](../migrations/0058_financial_condition_territory_language.sql)）|
| 言語 | `region_language` | 〃 |
| 合成ラベル（表示用） | `region_language_label` | 〃（例: 「海外・英語」「国内・日本語」）|
| （補助）地域/言語 | `territory` / `language` / `covered_territory` / `covered_language` | `contract_capabilities`（[0001 baseline](../migrations/0001_baseline.sql)）|

**引用経路:**
```
condition_lines.source_condition_id ──▶ capability_financial_conditions.region_language_label / region_territory / region_language
   (フォールバック) condition_lines.capability_id ──▶ contract_capabilities.territory / language
```
- `condition_lines.source_condition_id`（[0063:87](../migrations/0063_condition_lines_unification.sql)）= その明細の出所条件。これを JOIN して地域・言語を引用する。

**API:** `GET /api/v3/works/:id/graph` の各 Edge に `territory` / `region_language` / `region_language_label` を追加（現 Edge 型には未含。[WorkGraphPanel.tsx:17](../src/pages/master/WorkGraphPanel.tsx) の `Edge` 型を拡張）。

**表示例（右カードの受取エッジ）:**
```
[利用許諾] 海外版 X社        ← subject
 X社 · 受取 10%             ← counterparty / rate
 🌐 海外・英語              ← region_language_label（引用・読み取り専用）
 個別条件書: LIC-2026-0044   ← source
```
- 左カード（支払×license）にも同様に引用表示してよい（許諾地域は仕入側でも意味を持つ）。本要件の主眼は右カード（外部ライセンス派生）。

---

## 4. データモデル対応（確定済みを再掲）

```
works           id, work_code(LO-/W-), kind('source'|'own'), title…, parent_work_id, derivation_type
work_materials  id, work_id, material_code({work_code}-NNN), material_type, acquisition_type, is_default…
products        id, work_id, product_code, product_name, format, msrp, jan/isbn
condition_lines id, direction('pay'|'receive'), transaction_kind('license'|'product'|'service'),
                payment_scheme, work_id, source_work_id, source_material_id, product_id, counterparty_vendor_id…
```

詳細・移行ルールは [work-source-ip-unification.md](work-source-ip-unification.md) §3・§7 を正とする。本仕様は UI 入力面のみを規定。

---

## 5. API サーフェス

| 用途 | エンドポイント | 状態 |
|---|---|---|
| 作品一覧 | `GET /api/v3/works`（kind フィルタ追加）| 既存（要拡張）|
| グラフ取得 | `GET /api/v3/works/:id/graph` → `{work, upstream[], downstream[], materials[], products[]}`。**各 Edge に `territory`/`region_language`/`region_language_label` を追加**（§3.8 の引用 JOIN）| 既存（要拡張）|
| 作品 CRUD | `POST/PATCH /api/v3/works` | 既存（WorkModelPanel）|
| 原作 CRUD | `POST/PATCH /api/v3/source-ips` → **将来 works(source) に統合** | 既存（要統合）|
| 素材追加/編集 | `POST /api/v3/works/:id/materials`（acquisition_type 等を追加）| 既存（要拡張）|
| 製品 CRUD | `POST/PATCH /api/v3/works/:id/products` | **要確認/新規** |
| エッジ参照リンク | `PATCH /api/condition-lines/:id/graph-link` | 既存 |
| 条件書ルックアップ | `DocumentNumberLookup` の既存 API | 既存 |

---

## 6. 段階リリース（既存「増分」の続き）

| 増分 | 内容 | 状態 |
|---|---|---|
| ①〜③ | 3カード読み取りビュー / 中カードから素材追加 / エッジ参照リンク | ✅ 実装済（`WorkGraphPanel`）|
| **④** | **一覧ビューの統合**（`/works` kind フィルタ付き単一一覧 `WorksListPanel`）＋ **サイドバー「作品管理」エントリ**（§2.3）＋ Master の「権利フロー」タブ撤去（`/works/:id` へ移設）| ✅ 実装（`feat/works-unified-nav`）|
| **④'** | グラフ API Edge に territory 追加（`source_condition_id → capability_financial_conditions` を JOIN、`territory_label` 合成）→ **エッジに許諾地域を引用表示**（🌐 読み取り専用、外部ライセンス派生で特に有用）| ✅ 実装（`feat/works-unified-nav`）|
| **⑤** | **中カードの作品 基本情報インライン編集**（title/title_kana/work_type/status/division/remarks を `PUT /api/v3/works/:id`。alternative_titles/parent/derivation は保持）。新規作成は一覧の作成ダイアログ→エディタ遷移で充足 | ✅ 実装（`feat/works-unified-nav`）|
| **⑥** | **左カードの原作リンク追加**（支払エッジに「原作に紐付け」select → `source_work_id` 参照リンク、§3.6 準拠）＋ **原作中心ビュー §3.4**（`GET /api/v3/source-ips/:id/uses` 逆引き → 利用している自社作品の一覧・遷移・新規作成）| ✅ 実装（`feat/works-unified-nav`）。※原作の基本情報編集（権利者/クレジット等）は従来 source-ips PUT 経由のまま（左カード内編集化は後続） |
| **⑦** | **中カードに製品(SKU)追加**（`POST /api/v3/works/:id/products`、`product_code` = `{work_code}-P-NNN` 自動採番）＋ **右カードの受取先リンク**（受取エッジに「受取先に紐付け」select → `counterparty_vendor_id`、`GET /api/v3/vendors` を候補に）| ✅ 実装（`feat/works-unified-nav`）。※受取エッジ自体の起票（個別条件書からの参照リンク）は ⑧ |
| **⑧** | **エッジ追加 UI**（文書番号で `GET /api/v3/condition-lines/by-document` 検索 → 明細を選択 → `PATCH /api/v3/condition-lines/:id/attach-work` で work_id 結合＝参照リンク。direction で支払/受取カードに自動振り分け）。§10.7 準拠＝明細は新規作成せず結合のみ | ✅ 実装（`feat/works-unified-nav`）。※文書番号は素の入力欄（`DocumentNumberLookup` 統合は後続）。付替え/解除に対応 |
| **⑨** | 旧導線の整理: Master タブから「原作台帳」「作品モデル」を撤去し `/works`（作品管理）へ集約。両レガシー画面に移行バナー（`LegacyWorksBanner`）＋ `/works` に LO-原作(旧台帳)への導線。**ルートは温存**（データ移行 §8 #4 完了まで機能維持） | ✅ 実装（`feat/works-unified-nav`）。物理廃止は §8 #4 後 |

> 推奨着手順: ④（一覧統合・効果が見える）→ ⑤⑥（原作・作品の統一の本体）→ ⑦⑧（派生物・エッジ）。

---

## 7. 受け入れ条件（DoD）

- [ ] 1 つの一覧から原作・作品を kind で切替表示でき、新規も同導線で作れる
- [ ] 作品エディタ内で原作を選択/新規し、支払×license エッジを参照リンクできる（別画面に遷移しない）
- [ ] 原作カードから開いても同じエディタに入れる（§3.4）
- [ ] エッジは condition_lines を新規作成せず参照リンクのみ（設計書 §10.7 遵守）
- [ ] サイドバー「作品管理 / WORKS」から一覧 → 3カードエディタに入れる（§2.3）
- [ ] 外部ライセンス派生の受取エッジに許諾地域・言語が引用表示される（§3.8）
- [ ] 採番: 原作=`LO-` / 作品=`W-`（master_sequences 集約・設計書 §9）
- [ ] `npx tsc --noEmit` 型エラーなし / 768・1024・1440px で 3カードがレスポンシブ
- [ ] 既存 `LedgersPanel` の機能（検索・編集・削除）が新一覧で代替されている

---

## 8. 論点と決定

### 決定済み
1. ✅ **エディタの入れ物** = **別ページ**（`/works/:id`）。3カードは横幅が要るためフル画面。一覧上のフルモーダルは採らない。
2. ✅ **原作リンクの UI** = **左カードに直接「+ 原作」**。グラフの向き（原作→作品）・支払エッジと同じ位置に置き直感性を優先。中カードのセクション方式は採らない。
3. ✅ **サイドバー** = Configuration に独立エントリ **「作品管理 / WORKS」(`/works`)** を新設。原作・作品・派生の単一入口（§2.3）。
4. ✅ **許諾地域の表示** = 外部ライセンス派生（受取×license）に、`condition_lines.source_condition_id → capability_financial_conditions.region_language_label` を**引用表示**（再入力しない）。グラフ API の Edge に territory を追加（§3.8）。

### 要決定（残）
4. ✅（決定）旧 `LedgersPanel`/`WorkModelPanel` は **移行期は併存**。ナビから撤去＋移行バナーで `/works` へ誘導し、ルートは温存。物理廃止は **§8 #4（ledgers→works データ移行）完了後**。
   - ✅ **バックフィル移行を設計**: [`migrations/0076_ledgers_to_works_backfill.sql`](../migrations/0076_ledgers_to_works_backfill.sql)（additive・冪等。純 ledger 由来 LO 原作を works(licensed_in) へ、materials を work_materials へ取込）＋ 手順 [ledgers-to-works-backfill-runbook.md](../ledgers-to-works-backfill-runbook.md)。**適用待ち**（本番DBへは migration runner で適用＝要レビュー）。
   - ✅ 回帰防止（`LedgersPanel` 新規作成を `/works` へ一本化）実装済み。
   - 残: 0076 の本番適用、`ledgers/materials` 物理 DROP（デュアルリード期間後の別移行）。

### 決定済み（追加）
3. ✅ **製品 CRUD API**: 既存に無かったため新規追加。`POST /api/v3/works/:id/products`（`product_code` 自動採番）＋ 受取先 picker 用 `GET /api/v3/vendors`（増分⑦）。製品の編集/削除UIは後続。

### 決定済み（追加）
5. ✅ **原作IDの LO 統一**:
   - 既存IP原作 → 移行 [0075](../migrations/0075_unify_phase2_data.sql) で **LO 再採番済み**（旧コードは `works.legacy_code` に保全、対応 ledger/`-001` 素材も作成）。
   - 新規作成 → `POST /api/v3/source-ips`（[workModel.ts](../services/api/src/routes/workModel.ts)）を **`IP-` → `LO-YYYY-NNNN` 採番に変更**。1文(CTE)で works(licensed_in) + ledgers(LO) + 素材 `-001` を原子的に作成。LO番号は `ledgers ∪ works` の当年最大+1。
   - ✅ **二重採番リスク解消**: worker 側 `getNewLedgerCode`（[db.ts](../services/worker/src/lib/db.ts)）も `document_sequences(LO)` カウンタをやめ、**api と同一の `ledgers ∪ works` 当年最大 +1** ロジックに統一。両系統が同じ実コード由来で発番するため LO 番号の二重採番が構造的に起きない（残: 同時 INSERT 競合は `ledger_code`/`work_code` の UNIQUE で検出）。**worker 変更のため `release/worker` デプロイが必要**。

---

## 9. 参照

- 上位設計: [work-source-ip-unification.md](work-source-ip-unification.md)（§10 が本仕様の元）
- 実装: [WorkGraphPanel.tsx](../src/pages/master/WorkGraphPanel.tsx)（土台）, [WorkModelPanel.tsx](../src/pages/master/WorkModelPanel.tsx)（フィールド定義）, [LedgersPanel.tsx](../src/pages/master/LedgersPanel.tsx)（廃止対象）
- 部品: [DocumentNumberLookup.tsx](../src/components/document/DocumentNumberLookup.tsx), [DocumentForm.tsx](../src/components/document/DocumentForm.tsx)（SectionHead/カード構造）
- スキーマ: `migrations/0004_work_ip_masters.sql`, `0063_condition_lines_unification.sql`, `0074/0075_unify_*`
