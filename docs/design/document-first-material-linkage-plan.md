# 設計書：文書ファースト 原作マテリアル紐付けプラン（Document-First Material Linkage）

- 版: **v1.0（確定）** — 2026-06 壁打ち反映。決定1〜4 すべて確定（決定2＝素材帰属は「自社原作を立てる」で一元化を例外なく適用）。実装着手可。
- 位置づけ: [work-3card-unified-editor-spec.md](work-3card-unified-editor-spec.md) §3.6（文書が条件の真実源・エディタは参照リンクのみ）と [work-nn-junction-activation-plan.md](work-nn-junction-activation-plan.md)（マテリアル:作品＝N:N）の延長。両設計の確定事項を前提に、**条件明細⇄原作マテリアルの紐付けを「文書作成と同時」に成立させる**運用へ寄せる。
- 目的: 「原作・原作マテリアル・作品の関係がUI上で分かりにくい」根本原因＝**文書では原作/素材を選ぶのに、条件明細⇄マテリアルの実紐付けは別系統・別テーブルで後から手作業**、という構造を解消する。

---

## 1. 背景：実務トリガーと現状のズレ

### 1.1 実務の流れ

```
契約したい → 「文書を作って」オーダー → 文書作成（発注書 / 個別利用許諾条件書 / 出版等個別利用許諾条件書）
```

文書作成が業務のトリガー。だから「素材を先に登録しておく（素材ファースト）」を人に強制すると運用が回らない。**紐付け入力を文書作成の中に埋め込むのが現実的**。

### 1.2 現状の配線（調査結果）

| 箇所 | いま起きていること | 問題 |
|---|---|---|
| `DocumentForm.tsx:1234`「3. マスター条件 — 原作・素材」 | 原作(`ledger_ref_id`)＋素材(`material_ref_id`)を**capability単位で1つ**選択 | 明細(行)単位でない・複数素材を表せない |
| `server.ts:14483`〜 保存 | 選択値は **PDF差し込み（素材番号/名/権利者）と work_id 採番** に使うだけ | `condition_lines.source_material_id` には**入らない** |
| 実紐付け | 後から 3カードエディタで graph-link / attach-work / ピッカーで手作業 | 工程が分離・属人化 |
| マテリアル表 | 文書＝台帳 `materials`(LO-) / 条件明細・エディタ＝`work_materials` | **二重化**（N:N計画§2が `work_materials` を正準と決定済み） |

→ UIだけの問題ではなく**構造の問題**。これを文書ファーストの紐付けに作り替える。

---

## 1.3 前提：作品連動スイッチ（`is_work_linked`）

全契約が作品に関わるわけではない（NDA・一般業務委託 等）。文書フォームに **作品連動スイッチ**（`formData.is_work_linked`）を置き、本プランの作品連動フロー（原作・原作マテリアルの紐付け、作品構成・条件明細への連動）を **ON のときだけ**適用する。

- 既定 ON（未設定＝ON。既存挙動を維持）。OFF で原作・素材セクションを非表示にし、作品連動の生成処理をスキップ。
- 実装済（`DocumentForm.tsx`：セクション3「マスター条件 — 原作・素材」をスイッチでゲート）。保存経路（Stage 2）はこのフラグを参照して連動生成の有無を決める。

---

## 2. 提案フロー：明細1行 = 条件明細1本 = 原作マテリアル1つ

文書作成フォームの**明細入力**を拡張し、各行に以下を持たせる。

1. **作品選択（なければ作成）** — 「どの作品のための契約か」。`works(kind='own')` から選択、無ければ title だけで即時作成（`POST /api/v3/works`）。
2. **原作選択（なければ作成）** — 「どの原作に帰属するか」。`source-ips`(=`works.kind='licensed_in'`) から選択、無ければ即時作成（`POST /api/v3/source-ips`）。
3. **条件明細の作成** — ただし **利用許諾条件付き、または権利が相手方に帰属する場合のみ**（当社帰属＝買取は条件明細を作らない）。
4. **件名 → 原作マテリアル自動生成** — 明細の件名を `material_name` として `work_materials` を作成し、同時に条件明細へ結線する。

### 2.1 保存時マッピング（確定方針）

明細1行ごとに（全行共通。payment_scheme だけ条件で変わる）：

| 生成物 | 値 |
|---|---|
| `work_materials` | `work_id` = **選択した原作の id**（決定2）, `material_name` = 明細件名, `rights_holder_vendor_id` = 相手方 or 受注者, `rights_type` = license/joint/owned, `is_royalty_bearing` = royalty系なら true / 買切固定額なら false |
| `condition_lines` | `capability_id` = この文書の器, `source_work_id` = 原作, `source_material_id` = 上で作った素材, `work_id` = 作品, `direction` = payable, `transaction_kind` = license / service, `payment_scheme` = **royalty / lump_sum** など明細の対価方式, 料率/固定額 = 明細の金銭条件 |
| N:N 中間表 | `attach-work` 経路で `work_components(work_id=作品, material_id)` ＋ `work_component_lines` を ensure（フラット列とデュアル書込。N:N計画 Stage1/4 準拠）|

**統一モデル：作品を構成する各原作マテリアルに、条件明細が必ず1本付く。違いは `payment_scheme`（＝ロイヤリティ計算をするか否か）だけ。**

```
原作A ──────── 作品B（構成 = C・D・E）
                 原作マテリアルC  利用許諾条件   （payment_scheme=royalty 系）
                 原作マテリアルD  業績連動条件   （payment_scheme=royalty 系・売上連動）
                 原作マテリアルE  買切固定額     （payment_scheme=lump_sum・ロイヤリティ計算なし）
```

- **買取も「業務委託の条件明細」を持つ**（完全になしではない）。`payment_scheme='lump_sum'` で固定額を記録し、ロイヤリティ計算だけ走らせない。
- よって **全ケース共通で 原作マテリアル＋条件明細＋構成リンクを作る**。条件明細を「作る/作らない」で分岐しない。
- → 既存の condition_line 起点の構成 populate（`attach-work` / `component-lines`）が全ケースで使える。**条件明細非依存の特別経路は不要**（前版の想定を撤回）。

各行が作るもの（全行で 原作マテリアル＋条件明細＋`work_component_lines` を生成）：

| 条件タイプ | transaction_kind | payment_scheme | ロイヤリティ計算 | rights_type（記録のみ）|
|---|---|---|---|---|
| 利用許諾条件（原作を借りる）| license | royalty / lump_sum(一括許諾) | royalty系のみ実行 | license/joint |
| 業績連動条件（業務委託・印税）| service | royalty | 実行 | owned or license/joint |
| 買切固定額（業務委託・買取）| service | lump_sum | **しない**（固定額記録のみ）| owned |

**判定ルール：**
- **原作マテリアル生成・条件明細生成・作品構成への組み込みは全ケース共通で常に行う。**
- 分岐するのは **ロイヤリティ計算/残高管理を走らせるか否か**だけで、これは `payment_scheme`（royalty 系か）で駆動。`is_royalty_bearing` はその要約フラグ。
- 権利帰属（`rights_type`）は判定に使わずマテリアルへ記録のみ。
- 既存の「②発注者×ROYALTY も対象・帰属ではなく支払方法で駆動」（`DocumentForm.tsx:648`）と一致。

---

## 3. 確定する決定事項（4点）

### 決定1：素材の重複防止と N:N（確定）

件名からの**「新規作成」を既定**にしつつ、各明細行に**「既存の原作マテリアルから選択」も必ず併設**する。

- 同一素材を複数作品で使い回すときは新規作成せず既存を選ぶ。共有は `component-lines`(N:N) が担う。
- これをしないと契約のたびに素材が増殖し「条件はマテリアルに単一所有」が崩れる。
- UI: 行の素材欄は「件名で新規 / 既存を検索選択」のトグル。既定は新規（＝件名）。

### 決定2：素材の帰属先 → **原作(source work)配下に一元化**（確定）

`work_materials.work_id` には **選択した原作（`works.kind='licensed_in'`）の id** を入れる。業務委託の相手方帰属成果物（翻訳・イラスト等）も「その原作に属する新マテリアル（権利者＝受注者）」として原作配下に作る。

- 根拠: 条件明細は `source_work_id`＋`source_material_id` で一貫して「原作＋原作素材」を指す。作品固有素材を作品配下に分けると共有単位が二系統化し、再び二重化する。
- ユーザーの言明「どの原作に帰属するかという意味で原作を選ぶ」とも一致。
- 当社帰属（買取）成果物は素材化せず service line item のみ（必要なら後から `owned` 素材として手動追加可）。
- **純自社オリジナル（外部原作が無い）作品でも、例外を作らず「自社原作」を1つ立て、その配下に素材を置く**（決定確定）。
  - 原作不在の例外経路を設けないことで「素材は必ず原作配下」という不変条件を守り、N:N共有・条件明細の参照構造を単純に保つ。
  - 自社原作も `works.kind='licensed_in'`（採番 `LO-`）として作成。権利者＝自社。作品との結線・条件明細は外部原作と同一経路で扱える（料率0/買取扱い等は条件明細側で表現）。
  - 「なければ作成」（決定4）の原作作成導線が、自社原作を立てる経路をそのまま兼ねる。

### 決定3：マテリアル表を `work_materials` に一本化（確定）

文書フォームの素材源を 台帳 `materials`(LO-) から **`work_materials`** へ切替える（N:N計画§2の既定）。

- N:N計画 Stage0（migration 0078）で `work_components.material_id` は `work_materials` へ repoint 済み。
- 残作業: 原作 `POST /api/v3/source-ips` が作る素材を `work_materials` 直作成（or ミラー）へ寄せる（N:N計画 §5 の宿題）。文書フォームの素材セレクタもこちらを参照。

### 決定4：作品・原作の「なければ作成」（確定）

明細行から title だけで即時 POST→id 採番（`/api/v3/works` / `/api/v3/source-ips`）。詳細編集は 3カードエディタへ委譲。

---

## 4. 真実源・責務の一貫性

- 条件の真実源は引き続き**文書**（spec §3.6）。本案は「文書フォームが condition_lines と素材を作る」＝ §3.6 に忠実（エディタが作るのではない）。
- 3カードエディタの役割は不変：**N:N共有の編集・閲覧・原作中心ビュー**。文書で生まれた素材/条件を、別作品へ共有結線（`component-lines`）する場。

---

## 5. 実装ステージ（後続で詳細化）

| Stage | 内容 | 主な変更 | 状態 |
|---|---|---|---|
| 0 | 素材表一本化の総仕上げ（決定3）。台帳 materials への全書込経路を work_materials へミラー＋既存差分を冪等トップアップ。 | migration 0082 ／ `addMaterialToLedger` ミラー追加（db.ts） | ✅ 実装 |
| 1 | 文書フォーム明細に 作品/原作 セレクタ（なければ作成）＋ 原作マテリアルへの紐づけ（材料ファースト 1材料:N）を追加 | DocumentForm.tsx | ✅ フォーム層実装（作品連動スイッチ／対象作品セレクタ／**材料ファースト**: 既定で全条件を軸マテリアル(素材／原作本体)へ束ね、行で別マテリアルに上書き可。payment_scheme は条件行 calc_type を流用）|

**Stage 1 が保存経路へ渡す formData（Stage 2 の入力契約）：**
- `is_work_linked`（false で連動スキップ。未設定=ON）
- `linked_work_id`（対象作品 works.id, kind='own'）
- `ledger_ref_id`（原作。台帳id。Stage 0 で work_materials とコード同期済）
- `condition_material_codes`：`{ [condition_no]: material_code | "" }`。**材料ファースト改訂**: 空=軸マテリアル（`素材番号`で選んだ素材／無ければ原作本体 is_default）へ束ねる、コード指定=その行だけ別マテリアルに上書き。
- `素材番号`：文書の軸となる原作マテリアルのコード（`material_ref_id` 選択で設定）。利用許諾条件は既定でここへ 1材料:N で束ねる。
- `financial_conditions[]`：各条件の `condition_no` / `condition_name`(件名) / `calc_type`(→payment_scheme: BASE_*=royalty / FIXED=lump_sum=買切 / SUBSCRIPTION) / 料率・固定額
| 2 | 保存経路で 各条件→`work_materials`解決/生成→`condition_lines`に source_work_id/source_material_id/work_id 結線→`work_components`＋`work_component_lines` ensure | server.ts（文書保存）/ conditionSync | ✅ 共通下請け `ensureMaterialAndCompose`。利用許諾条件(license)＝`linkWorkMaterialsForCapability`（**材料ファースト**: 既定で軸マテリアルへ 1材料:N 束ね・行で上書き）／買切(owned/buyout_commission)＝`linkBuyoutMaterialsForCapability`（成果物＝1明細1材料）を、個別利用許諾条件書・発注書(受注者帰属＋買取)・出版等の各経路に適用。再発行は既存素材を再利用(冪等)。新規素材は台帳`materials`へも逆ミラー。**Stage 2 完了** |

> **材料ファースト改訂（明細単位紐付けの弊害解消）**: 当初は「条件明細ごとに材料を選ぶ」実装だったが、(1)条件が増えると割当漏れ、(2)直販/サブライセンス等で算定が違っても同一材料に属すべき条件が別材料に割れる、という弊害があった。`source_material_id` は 1材料:N条件 を既存スキーマで許す（UNIQUE なし。`direction`/`payment_scheme` で算定違いを表現）ため、**マイグレーション不要**。文書の軸マテリアルへ全条件を既定で束ね、必要な行だけ上書きする方式へ改訂（3カードエディタの material→N条件 と同じ思想）。買切成果物は 1明細=1材料 のまま。
| 3 | `payment_scheme`（royalty / lump_sum 等）を明細の対価方式から確定。**ロイヤリティ計算/残高管理は royalty 系のみ走らせる**（買切固定額=lump_sum は固定額記録のみ）。マテリアル/条件明細/構成リンクの生成は全ケース共通。rights_type はマテリアルに記録のみ | DocumentForm.tsx / server.ts | ⬜ |
| 4 | 既存文書（capability単位 ledger_ref_id/material_ref_id）からの移行・後方互換 | migration（冪等） | ⬜ |

> Stage 0 メモ: 台帳 materials への書込経路は `createLedger`（ミラー既存）/ `addMaterialToLedger`（本Stageで追加）/ `POST /api/v3/source-ips`（ミラー既存）の3本に限定されることを確認。すべて work_materials へミラーするため、以後の表ドリフトは発生しない。既存差分は migration 0082（0076の冪等再実行）で解消。

各 Stage は additive・冪等を原則とし、既存の文書発行フローを壊さない。

---

## 6. 未解決・要決定

- **自社原作の運用ルール**（決定2の派生）：自社原作を「作品ごとに1つ立てる」のか「自社レーベル単位で束ねる」のか。素材増殖を避けるなら原則 1作品=1自社原作だが、シリーズ共通素材は束ね原作に置くと共有しやすい。Stage1 のUI設計時に既定挙動を確定。
- ~~**発注書の条件明細生成経路**~~ → 解決済。受注者帰属＝`capability_financial_conditions`、買取(発注者帰属)＝`capability_line_items`、どちらも `syncConditionLinesForCapability` で condition_lines 化され、`linkWorkMaterialsForCapability`／`linkBuyoutMaterialsForCapability` で結線。
- ~~**台帳 materials へのミラー**~~ → 実装済。`ensureMaterialAndCompose` の新規作成時に、同 `material_code` で台帳 `materials` へも逆ミラー（`ledger_code` で台帳解決・`material_code` で冪等・best-effort）。これで Stage 0(台帳→work_materials) と双方向に揃い、フォームの素材候補にも自動生成分が出る。
- **件名の一意性**：同一原作内で同名素材を作らないためのガード（決定1のUI＋保存時 NOT EXISTS）。
- **再発行時の冪等**：既存明細に紐付く素材を二重生成しない（line_code / source_seq_no 単位の upsert キー設計）。
