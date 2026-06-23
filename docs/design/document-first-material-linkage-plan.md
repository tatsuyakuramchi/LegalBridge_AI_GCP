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

## 2. 提案フロー：明細1行 = 条件明細1本 = 原作マテリアル1つ

文書作成フォームの**明細入力**を拡張し、各行に以下を持たせる。

1. **作品選択（なければ作成）** — 「どの作品のための契約か」。`works(kind='own')` から選択、無ければ title だけで即時作成（`POST /api/v3/works`）。
2. **原作選択（なければ作成）** — 「どの原作に帰属するか」。`source-ips`(=`works.kind='licensed_in'`) から選択、無ければ即時作成（`POST /api/v3/source-ips`）。
3. **条件明細の作成** — ただし **利用許諾条件付き、または権利が相手方に帰属する場合のみ**（当社帰属＝買取は条件明細を作らない）。
4. **件名 → 原作マテリアル自動生成** — 明細の件名を `material_name` として `work_materials` を作成し、同時に条件明細へ結線する。

### 2.1 保存時マッピング（確定方針）

明細1行ごとに、相手方帰属／利用許諾の場合：

| 生成物 | 値 |
|---|---|
| `work_materials` | `work_id` = **選択した原作の id**（決定2）, `material_name` = 明細件名, `rights_holder_vendor_id` = 相手方, `rights_type` = license/joint |
| `condition_lines` | `capability_id` = この文書の器, `source_work_id` = 原作, `source_material_id` = 上で作った素材, `work_id` = 作品, `direction` = payable, `transaction_kind` = license / service, 料率等 = 明細の金銭条件 |
| N:N 中間表 | `attach-work` 経路で `work_components(work_id=作品, material_id)` ＋ `work_component_lines` を ensure（フラット列とデュアル書込。N:N計画 Stage1/4 準拠）|

文書種別ごと：

| 文書 | direction × kind | 行が作るもの |
|---|---|---|
| 個別利用許諾条件書 / 出版等個別利用許諾条件書 | payable × license | 原作マテリアル ＋ 条件明細（上表）|
| 発注書（相手方帰属＝印税方式）| payable × service（またはlicense）| 原作マテリアル（権利者=受注者）＋ 条件明細 |
| 発注書（当社帰属＝買取）| — | **条件明細・自動素材は作らない**。業務委託明細(service line item)のみ |

「相手方帰属のときだけ条件明細＋素材」は既存 `isCounterpartyRights`（license/joint＝相手方）ロジック（`WorkModelPanel.tsx:587`）と一致。整合的。

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
| 1 | 文書フォーム明細に 作品/原作 セレクタ（なければ作成）＋ 素材欄（件名で新規 / 既存選択）を追加 | DocumentForm.tsx | ⬜ |
| 2 | 保存経路で 明細→`work_materials`生成→`condition_lines`(source_work_id/source_material_id/work_id)結線→`attach-work`で中間表 ensure | server.ts（文書保存）/ conditionSync | ⬜ |
| 3 | 当社帰属／相手方帰属の分岐（条件明細を作る/作らない）を rights_type 駆動で確定 | DocumentForm.tsx / server.ts | ⬜ |
| 4 | 既存文書（capability単位 ledger_ref_id/material_ref_id）からの移行・後方互換 | migration（冪等） | ⬜ |

> Stage 0 メモ: 台帳 materials への書込経路は `createLedger`（ミラー既存）/ `addMaterialToLedger`（本Stageで追加）/ `POST /api/v3/source-ips`（ミラー既存）の3本に限定されることを確認。すべて work_materials へミラーするため、以後の表ドリフトは発生しない。既存差分は migration 0082（0076の冪等再実行）で解消。

各 Stage は additive・冪等を原則とし、既存の文書発行フローを壊さない。

---

## 6. 未解決・要決定

- **自社原作の運用ルール**（決定2の派生）：自社原作を「作品ごとに1つ立てる」のか「自社レーベル単位で束ねる」のか。素材増殖を避けるなら原則 1作品=1自社原作だが、シリーズ共通素材は束ね原作に置くと共有しやすい。Stage1 のUI設計時に既定挙動を確定。
- **発注書の条件明細生成経路**：現状 service 明細と condition_lines の関係を実装確認し、相手方帰属時の条件明細生成をどの保存パスに挿すか。
- **件名の一意性**：同一原作内で同名素材を作らないためのガード（決定1のUI＋保存時 NOT EXISTS）。
- **再発行時の冪等**：既存明細に紐付く素材を二重生成しない（line_code / source_seq_no 単位の upsert キー設計）。
