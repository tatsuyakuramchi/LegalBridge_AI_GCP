# スキーマ単純化プラン（条件明細コアの再構築）

- 版: v0.1（ドラフト）— 2026-06
- 前提: **現状データは破棄してよい**（再ビルド可能）。周辺モジュール（vendors / ringi /
  royalty_calculations / signature / invoices 等）は**対象外**。本プランは
  「文書 ⇄ 条件明細(CL) ⇄ 原作マテリアル ⇄ 作品 ⇄ 原作」の**コアのみ**を再構築する。

## 0. 用語（ユーザー定義）
- **Master** = adminUI「Master Systems」の Contract（契約マスタ）。
- **CL** = 条件明細（`condition_lines`、`CL-…`）。
- **原作マテリアル** = 原作傘下の個別要素。各々に CL が複数紐づく。
- **原作** = 原作マテリアルの集合体。**CL は持たない**。
- **文書** = CL を束ねるもの（一部の文書は CL を持たない）。

## 1. 確定した方針（3決定）
1. **条件は `condition_lines` に一本化** … `capability_financial_conditions`(cfc) /
   `capability_line_items`(cli) を廃止し、料率・MG/AG・支払方式等を CL にインライン保持。
   ミラー同期（`safeSync`/`syncConditionLinesForCapability`）を撤廃し、CL を**直接書く**。
2. **文書と Master を 1 テーブルに統合** … `documents` と `contract_capabilities` を統合
   （document_number 文字列結合を廃止）。Master 画面も文書も同一レコードを見る。
3. **作品 ⇄ 原作マテリアルは N:N 中間表を保つ** … 跨ぎ原作・引用モードを維持。
   `work_components`/`work_component_lines` を `work_material_uses` 1本へ一本化。

## 2. 現状の複雑さ（撤去対象）
- **A. 条件の二重書き込み**: cfc + cli（ソース）→ condition_lines（非致命ミラー）。整合崩壊の震源。
- **B. 原作/素材の旧新並存**: `ledgers`/`materials`/`source_ips`/`source_ip_materials`（旧）
  ↔ `works`/`work_materials`（新）。
- **C. 文書↔契約の曖昧結合**: `documents` ↔ `contract_capabilities` を document_number で soft join。
- **D. 作品⇄CLの二系統**: フラット列（`condition_lines.work_id`/`source_material_id`）と
  中間表（`work_components`/`work_component_lines`）の重複。

## 3. 目標スキーマ（コア6テーブル）

### 3.1 `works`（原作 + 作品）
既存を流用。`kind`（`licensed_in`=原作 / `own`=作品）。
旧 `ledgers`/`materials`/`source_ips`/`source_ip_materials` は廃止し works/work_materials へ一本化。

### 3.2 `work_materials`（原作マテリアル）
`work_id → works(licensed_in)`（原作 1:N マテリアル）。`material_code`, `material_name`,
`rights_holder_vendor_id`, `rights_type`, `acquisition_type`, `is_royalty_bearing`,
`is_default`(本体), `material_no`。**原作は CL を持たず、CL は必ずマテリアルに属する。**

### 3.3 `documents`（文書 = Master 統合）
現 `documents` ＋ `contract_capabilities` を統合した「束ね」レコード。
- 識別: `id`, `document_number`(UNIQUE), `base_document_number`(親文書=検収書/計算書→発注書),
  `master_document_id`(自己参照=個別契約→基本契約。任意), `revision`,
  `is_primary`, `lifecycle_status`, `superseded_by`
- 文書: `template_type`, `form_data`(JSONB), `issue_key`, `drive_link`/`excel_link`, `email_*`
- 契約メタ(旧cap): `vendor_id`, `record_type`, `contract_category`, `contract_type`,
  `contract_title`, `contract_status`, `effective_date`, `expiration_date`,
  `flow_direction`, `deliverable_ownership`, `backlog_issue_key`,
  `ledger_ref_id`/`ledger_code`(原作), `material_ref_id`(軸マテリアル)

### 3.4 `condition_lines`（CL = 単一の真実源）★中核
- 束ね: `document_id → documents` **NOT NULL**（文書が CL を束ねる。ハードFK）
- 原作結線: `material_id → work_materials` **NOT NULL**
  （原作は `work_materials.work_id` から導出＝`source_work_id` 列は廃止）
- 取引形態(v3列): `group_no`（加算型の同一取引形態セルを束ねる。非v3は1行=1group）
- 経済条件（cfc+cli を吸収・インライン）:
  `payment_scheme`('royalty'|'lump_sum'|'per_unit'|'subscription'|'installment'),
  `rate_pct`, `mg_amount`, `ag_amount`, `currency`, `base_price_label`, `quantity`,
  `unit_price`, `amount_ex_tax`, `calc_type`, `fixed_kind`, `subscription_cycle`,
  `region_territory`, `region_language`, `formula_text`, `payment_terms`,
  `payment_method`, `payment_date`, `delivery_date`, `term_start`, `term_end`,
  `cycle`, `billing_day`
- v3 取引形態ヘッダ（**§4 の未決定**: インライン or 薄い group 表）:
  `is_addon`, `manufacturer`, `seller`, `max_region`, `max_language`
- 属性: `line_no`, `line_code`(CL-…), `subject`, `spec`, `category`, `notes`,
  `direction`('payable'|'receivable'), `transaction_kind`('license'|'product'|'service'),
  `deliverable_ownership`('発注者'|'受注者'), `created_at`, `updated_at`
- 作品結線はフラット列を持たず **§3.5 の中間表で表現**（D の重複解消）。
- **請求の向き**: `direction`（'payable'=当社支払 / 'receivable'=当社受取）が**最終真実**。
  文書既定 `documents.flow_direction` は初期値の供給のみ。CL一本化で向きが1列に集約され、
  cfc/cli/文書間のズレが消える。1文書内で支払・受取の混在も CL 単位で表現可能。
  `transaction_kind`（license/product/service）と併用しロイヤリティ in/out を一貫表現。

### 3.5 `work_material_uses`（作品 N:N 原作マテリアル）
`work_components`/`work_component_lines` を 1 表へ統合。
- `work_id → works(own)`（作品）
- `material_id → work_materials`（原作マテリアル。跨ぎ原作可）
- `condition_line_id → condition_lines`（引用する具体CL。任意。引用モード）
- `use_no`, UNIQUE(work_id, condition_line_id)

### 3.6 `condition_events`（実績）
`condition_line_id → condition_lines`, `document_id → documents`（検収/利用許諾料計算）。
既存を流用（CL/文書がハードFKになるので孤児が減る）。

### 3.7 CL をもたない文書のケア（重要）
FK は「CL → 文書」の片方向。**文書は 0 本の CL でも有効**。3類型を自然に表現する:

| 類型 | 例 | 表現 |
|---|---|---|
| 枠組／基本契約 | 業務委託基本契約・包括ライセンス | `documents`(`record_type='master_contract'`)。CLゼロ。個別が親参照 |
| 純テキスト契約 | NDA・覚書・通知書 | `documents`（メタ＋`form_data` のみ）。CLゼロ |
| 参照型（実績） | 検収書・利用許諾料計算書 | CLを持たず、親CLを `condition_events.document_id` で参照 |

- **基本契約↔個別契約**: `documents.master_document_id`（自己参照, 任意）で個別→基本を結ぶ。
  これにより旧 `resolveTermsCapability` / `parent_capability_id` / `structural_role`
  （master に付いた条件を暗黙の terms 子 capability へ逃がす仕組み）を**撤去**できる
  ＝ master は CL なし文書、条件は個別文書の CL に乗る。
- **検収書/計算書**: `base_document_number`（親=発注書/契約）＋ `condition_events` で親CLへ。
- **material_id の扱い（確定: (ii) NULL許容＋運用ルール）**:
  material_id は「CL がどの原作マテリアルに属するか」＝原作ビュー(workModel)・作品連動
  (work_material_uses 生成)・按分(rights_holder)の基盤。よって:
  - **IP系CL（利用許諾・成果物）は material_id 必須**（原作ビューに出る。Master登録の症状を解消）
  - **経費・手数料・純役務のCLは material_id = NULL 可**（原作と無関係なので非表示が正しい）
  - DDL は NULL 許容、アプリ層で「利用許諾/成果物系は必須」を担保（Phase 2）。

## 4. v3 取引形態ヘッダ（確定: (a) CL インライン）
製造者/販売者/最大地域・言語/is_addon は **CL にインライン**保持。加算型は同一 group_no の
セルがヘッダ値を重複保持（非v3は1行なので重複なし）。`condition_groups` 表は作らない。

## 4.1 経費/手数料/分割/受領の扱い（確定）
- **経費・手数料**: 独立した CL として表現（`capability_expenses`/`capability_other_fees` 廃止）。
  `transaction_kind='service'` 等＋`payment_scheme`（経費=実費精算/手数料=lump_sum）。material_id は NULL 可。
- **分割（`condition_line_installments`）**: **CL の子として温存**。1CL:N の支払スケジュール
  （trigger_kind=契約時/納品時/検収時/指定日 × planned_amount × due_date）。
  `condition_line_id` FK のまま（cfc非依存）。
- **受領（`condition_receipts`）**: **温存**。receivable方向CLの収益受領台帳（報告売上/計算/実受領/入金）。
  cfc 廃止に伴い **`condition_id → condition_line_id` へ付け替え**。分配マップが使用中。

## 5. 廃止テーブル（DROP・データ破棄前提）
`capability_financial_conditions` / `capability_line_items` / `capability_expenses` /
`capability_other_fees` / `license_financial_conditions` / `contract_financial_terms` /
`contract_capabilities`(→documents) / `ledgers` / `materials` / `source_ips` /
`source_ip_materials` / `work_components` / `work_component_lines`
（**温存**: `condition_line_installments`=分割の子 / `condition_receipts`=受領台帳[condition_line_id へ付替] /
`condition_events`=実績）

## 6. 段階計画（rebuild）
- **Phase 0**: 本設計書の確定（スキーマ列・§4・(*)群の扱い）。
- **Phase 1（スキーマ）**: 新 DDL マイグレーション（旧コア DROP → 新コア CREATE）。
  data-loss 前提なので変換不要。`works`/`work_materials`/`condition_events` は ALTER で温存。
- **Phase 2（書き込み）**: 保存パス書換え。Master/文書/発注/v3 のすべてで
  cfc/cli upsert を撤廃し **CL を直接 INSERT**（material_id/document_id 必須）。
  ミラー同期・`resolveTermsCapability`・`linkWorkMaterialsForCapability` の役割を
  「CL を正しい material/work に作る」へ統合。
- **Phase 3（読み取り/計算）**: 原作ビュー(workModel)・計算(calc_license)・帳票
  (documentService/render)・横断検索を CL 直読へ。cfc フォールバック削除。
- **Phase 4（フロント）**: フォームが新構造を produce（CL を直接組み立て）。
- **Phase 5（清掃）**: 旧 route/lib（conditionSync 等）削除・監査再整備。

## 7. リスク / 留意
- 大規模改修（保存・同期・計算・クエリ・フロント横断）。Phase ごとに動作確認。
- 周辺モジュール（royalty_calculations 等）は CL を読むため、CL の列名互換に注意。
- v3（取引形態×構成要素）の加算型 Σ は group_no 集約で維持。
