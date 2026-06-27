# 原作素材の利用許諾条件「コピー」設計メモ

ステータス: **設計合意済み(WMC-1 着手可)** / 2026-06-25 起票・同日合意(O1=手動 / O2=一覧選択 / O6=L1経由)
関連: [`work-nn-junction-activation-plan.md`](./work-nn-junction-activation-plan.md)（作品＝権利の束 N:N）/ [`condition_lines_unification_design.md`](../condition_lines_unification_design.md)

---

## 1. 背景・狙い

ジャストアイディアの再整理: 条件明細は「**この作品を作成/販売するために原作(素材)を利用する条件**」なので、**原作に条件を付ける**のではなく **作品(×原作マテリアル)に条件を付ける**のが正しい、という気づき。

### シナリオ(原作A → 作品AA / AA2 を時間差で作成)
1. 作品AA を登録 → 原作Aの素材が(AA の利用文脈で)生まれ、AA の**利用許諾条件書**が作られる。
2. 後で 作品AA2 を作成 → AA を登録したときに作られた**原作素材を選択** → AA と**同一条件なら AA の条件をコピー**して **AA2 専用の利用許諾条件書**を作りたい。

→ 求めるのは「**コピー(テンプレ→インスタンス)**」であって「共有」ではない(AA と AA2 は**別々の利用許諾条件書**を持つ)。

## 2. エンティティ整理(現状・確認済み)

| 概念 | テーブル | 要点 |
|---|---|---|
| 原作 | `source_ips` | 原作の台帳 |
| **原作素材(正準)** | `source_ip_materials` | `source_ip_id` NOT NULL・`material_code` UNIQUE。**原作素材の真の正準カタログ** |
| 作品 | `works` | |
| **作品素材(利用インスタンス)** | `work_materials` | **`work_id` NOT NULL**(=作品ごと)＋`source_ip_material_id`→ `source_ip_materials`。同じ原作素材を複数作品が各々の work_materials で指す |
| 条件明細 | `condition_lines` | **`capability_id` NOT NULL**(文書/契約配下が不変条件)。`source_work_id`/`source_material_id`/`work_id` あり |
| 契約/文書(器) | `contract_capabilities` | 通常の利用許諾条件書、または `MLC-<work_code>`(原作登録器 `source_system='master_register'`) |
| 作品×素材→条件 | `work_components`(work_id,material_id)＋`work_component_lines`(component_id,condition_line_id) | 「作品＝権利の束」N:N |

**重要**: 「原作Aの素材は AA 登録時に生まれる」= `work_materials.work_id` NOT NULL の挙動と一致。正準は `source_ip_materials`、`work_materials` はその作品利用インスタンス。

## 3. 二層モデル(設計の核)

条件明細を役割で2層に分けて捉える:

- **(L1) 原作登録条件(テンプレ/カタログ)**: 原作素材の標準的な利用条件。`MLC-<work_code>` 配下(原作アンカー、`work_id`=NULL)。「1回登録 → 複数作品で再利用」用途。
- **(L2) 作品利用条件(インスタンス)**: ある作品が原作素材を使う具体条件。作品の**利用許諾条件書(個別 capability)配下**。payment/royalty を駆動する実体。

ユーザーの狙い = **(L2) を主役**にし、**(L1) をコピー元**として各作品へ複製する【O6 決定】。`capability_id` NOT NULL 不変条件は維持(条件=文書由来)。

**コピー元は L1(MLC- テンプレ)で確定【O6】**: AA の条件も AA2 の条件も、**原作素材に1回登録した L1 を各作品が複製**する。これにより「原作素材＝条件の正準テンプレ」「各作品＝そのコピー」という一貫したモデルになる(AA2 が AA の L2 を直接見るのではなく、両者が同じ L1 を参照してコピー)。

## 4. 「共有」と「コピー」の区別(明確化)

| | 意味 | 既存 |
|---|---|---|
| 共有(N:N) | 1条件明細を AA/AA2 が共用(=同一文書を共用) | 原作ピッカーの既存導線 |
| **コピー** | AA2 が**自分専用の利用許諾条件書**を作り AA の条件を**値コピー** | ← 本メモの対象・導線が弱い |

本件は**コピー**。AA と AA2 はそれぞれ独立した利用許諾条件書を持ちつつ、条件値を引き継ぐ。

## 5. コピー導線フロー(L1 登録 → 各作品へコピー)【O1/O2/O6 反映】

### Step A: 原作素材に条件を登録(L1・1回)
原作管理で原作Aの素材M を選び、利用許諾条件を **MLC-(L1)** に登録(既存「マテリアル単位 利用許諾条件 登録」)。これが各作品のコピー元テンプレになる。

### Step B: 作品の利用許諾条件書を作成(L2・コピー)
作品(AA / AA2 …)の利用許諾条件書(`individual_license_terms`/`pub_license_terms`)作成フローで:
1. 使う **原作A → 原作素材M を選択**(既存の原作/素材ピッカー)。
2. その素材の **L1 登録条件を一覧表示**【O2: 一覧から選択】(下記既存 API)。
3. 一覧から **手動で1件を選び「引用してコピー」**【O1: 手動】→ フォームの `financial_conditions`(料率/MG/AG/地域/言語等)へ値を流し込む(編集可)。
4. 保存 → その作品専用の **capability + condition_line(コピー値)** が生成され、(作品×素材M)に紐づく。

→ AA も AA2 も Step B で**同じ L1 を一覧から選んでコピー**するだけ。「AA と同一条件」は L1 を選べば自動的に同一になる(差分の自動判定は不要=手動引用)。

### データの動き
- 新規: `documents`(AA2 の利用許諾条件書) + `contract_capabilities`(AA2 の器) + `condition_lines`(コピー値、`capability_id`=AA2 器、`source_material_id`=素材M、`source_work_id`=原作A、`work_id`=AA2)。
- 紐付け: `work_components`(AA2, 素材M) + `work_component_lines` で N:N。
- 地域/言語: コピー元の `source_condition_id`→`capability_financial_conditions` の region 値も複写。

## 6. 既存資産(再利用できるもの)

- `GET /api/v3/source-ips/:id/materials/:mid/condition-lines`(workModel.ts:1159): **原作素材に紐づく既存条件を取得**(=AA の条件を引ける)。
- `POST /api/v3/source-ips/:id/materials/:mid/condition-lines`(workModel.ts:1211): 条件を**既存の利用許諾条件書(`capability_id` 指定)配下** or `MLC-` 配下に登録(チェック済)。
- `ensureMasterLicenseCapability`(MLC- 原作登録器)。
- 原作/素材ピッカー(WorkGraphPanel・license-form-work-picker)。
- 利用許諾条件書フォーム(`financial_conditions`)。

→ **スキーマ変更は不要**。主に「素材の既存条件を引用→フォームにコピー」の UI/プレフィルが新規。

## 7. 決定事項・残オープン

### 決定済み
- **O1【決定】手動引用** — 自動の差分判定はせず、候補一覧から人が選んでコピー。
- **O2【決定】一覧から選択** — 原作素材の既存(L1)条件を一覧表示し、そこから1件選ぶ。
- **O6【決定】L1 経由** — 原作素材に L1(MLC-)を1回登録し、各作品はその L1 をコピー元にする(AA の L2 を直接参照しない)。

### 残オープン(実装着手時)
- O3. `work_materials` の扱い: 各作品用に**新規 work_materials 行**(同 `source_ip_material_id`)を作る(work_id NOT NULL なので新規が筋・既定)。
- O4. コピー痕跡: コピーした L2 condition_line に「どの L1 から引用したか」のリンク(`source_condition_id` 等)を残すか(トレーサビリティ。推奨=残す)。
- O5. 既存 N:N 共有導線との関係: コピーを主導線にしつつ共有も残すか、コピーへ寄せるか。

## 8. Phase 計画(案)

- **WMC-0(設計確定)**: 本メモの O1〜O6 を確定。
- **WMC-1(取得API整備)**: 原作素材の既存条件一覧を「コピー元候補」として返す read（既存 v3 を流用/拡張）。
- **WMC-2(フォーム導線)**: 利用許諾条件書フォームに「原作素材の既存条件を引用→ `financial_conditions` にコピー」ボタン＋プレビュー。
- **WMC-3(保存連携)**: 保存時に AA2 の capability + condition_line + work_components 紐付けが正しく生成されることを確認(既存生成パスに乗る)。
- **WMC-4(任意)**: (L1)テンプレ運用・引用痕跡(source リンク)・差分判定。

## 8.5 実装記録 (2026-06-25)

ブランチ `feat/wmc-condition-copy`(off main)。

### 調査で確定したデータモデル(重要)
- フォーム(`individual_license_terms`)の原作/素材ピッカーは **`ledgers`/`materials`**(Phase 22.18 原作マスター)由来。`material_ref_id`=`materials.id`、`formData.素材番号`=`materials.material_code`。
- 一方 `condition_lines.source_material_id` → **`work_materials.id`**、正準は `source_ip_materials`。
- ブリッジ: `0010_backfill_source_ips.sql` が **id保存**で `ledgers→source_ips` / `materials→source_ip_materials` を移送(`materials.id == source_ip_materials.id`)。ただし **新規 ledger 素材**(`addMaterialToLedger`)は `source_ip_materials` へは同期せず、`work_materials` へ **`material_code`** でミラーするのみ(`source_ip_material_id` は NULL)。
- → 「同一原作素材」を新旧データ両方で確実に束ねる安定キーは **`material_code`**(=`<ledger_code>-NNN`, グローバル一意)。WMC-1 はこれをキーにした。

### WMC-1【済】コピー元候補 API
`GET /api/v3/materials/by-code/:materialCode/copy-source-conditions`(`services/api/src/routes/workModel.ts`)。
- `condition_lines cl JOIN work_materials wm ON wm.id=cl.source_material_id WHERE wm.material_code=$1`。
- `capability_financial_conditions cfc`(コピー対象の全フィールド) + メタ(`is_template`=MLC-由来 L1 / `document_number` / `origin_work_*` / トレース用 `source_condition_id`)を返す。`ORDER BY is_template DESC`(O6: L1優先)。
- `?exclude_capability_id=` で編集中文書の自条件を除外可。

### WMC-2【済】フォーム コピー導線
`src/components/document/ConditionCopyPanel.tsx`(新規) を `DocumentForm.tsx` の §3-2 金銭条件直下に組込み。
- 軸素材(`formData.素材番号`)の material_code で WMC-1 を引き、候補一覧(L1バッジ・計算サマリ)を表示。
- 「コピー」で `candidateToCondition()` が cfc→`FinancialCondition` に値変換し、`condition_no = max+1` で `financial_conditions` に**新規行追加**(値コピー=共有でない)。`buildFormulaText` で式を再生成。

### WMC-3【済(コード不要)】保存連携
コピー行は通常の `financial_conditions` として既存保存パス(`/api/documents` → `upsertCapabilityFinancialConditions` → `syncConditionLinesForCapability`)に乗り、capability + condition_line が生成される。原作マテリアルへの紐づけ(work_components)は §3-2 直下の既存「紐づけ」ブロック(`condition_material_codes`)が担う。→ 追加コードなし。

### デプロイ / 検証メモ
- WMC-1 は `services/api`(release/api)。WMC-2 はフロント(main)。
- O4(コピー痕跡の永続化)【済 2026-06-26】: `capability_financial_conditions.copied_from_condition_id`(自己参照FK, `0083`)を追加。コピー時にコピー元 cfc.id を保持し、`upsertCapabilityFinancialConditions` で永続化(再保存で消えないよう `COALESCE` で保護)。`condition_line → cfc(source_condition_id) → copied_from_condition_id` で辿れるため condition_lines への列追加は不要。フォームのコピー行に「引用」バッジ表示。デプロイ: migration は `release/worker`(migrate)、worker server.ts も `release/worker`、フロントは main。
- 実データ検証(ledger選択→素材選択→候補表示→コピー→保存)は要バックエンド+シードのため未実施。

## 9. 結論

- **実現可能**。スキーマ(source_ip_materials 正準 / work_materials 利用インスタンス / condition_lines / work_components N:N)は既にこの構想を支持。
- 本質は **(L2)作品利用条件を主役にし、コピー(テンプレ→インスタンス)導線を足す**こと。`capability_id` NOT NULL 不変条件は維持。
- 新規はほぼ **UI/プレフィルの導線**で、v3 API(素材条件の取得/登録)を再利用できる。
