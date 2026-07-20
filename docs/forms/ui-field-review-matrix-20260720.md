# UI項目精査マトリックス

- 文書ID: LB-UI-FIELD-MATRIX-20260720
- 関連設計: `docs/design/legalbridge-full-ui-renewal-design-20260720.md`

## 1. 判定区分

| 判定 | 意味 |
|---|---|
| KEEP | UI入力項目として維持 |
| DERIVE | 他データから自動導出し、原則編集不可 |
| QUOTE | 文書・契約・条件から引用 |
| SNAPSHOT | 発行・確定時に値を固定保存 |
| MOVE | 別エンティティ・別画面へ移動 |
| MERGE | 重複項目を統合 |
| DEPRECATE | 互換用に残し、新規入力を停止 |
| REMOVE | UI・API・DBから段階撤去 |
| SENSITIVE | 権限・目的別表示 |

## 2. 作品

| 項目 | 判定 | 必須 | 編集元 | 備考 |
|---|---|---:|---|---|
| work_code | DERIVE | ○ | system | 採番後は変更禁止 |
| title | KEEP | ○ | Works | 正式名称 |
| title_kana | KEEP | 推奨 | Works | 検索対象 |
| alternative_titles | KEEP | 任意 | Works | 複数値・検索対象 |
| kind | MERGE | ○ | Works | UI表示は「作品起源」へ |
| is_original | DEPRECATE | - | - | kind / relationから導出 |
| work_type | KEEP | ○ | Works | 選択肢をマスター化 |
| division | KEEP | ○ | Works | 複数可、表示順固定 |
| status | KEEP | ○ | Works | 遷移制御 |
| parent_work_id | DEPRECATE | - | - | `work_relations`へ移行 |
| derivation_type | DEPRECATE | - | - | `work_relations.relation_type`へ移行 |
| work_family_id | KEEP | 条件付 | Works | 新設・シリーズ所属 |
| representative_work_id | MOVE | 条件付 | Work Family | 作品側へ重複保持しない |
| rights_position | KEEP | ○ | Works | owned / licensed_in / commissioned / joint |
| rights_holder_vendor_id | MOVE | 条件付 | Rights Source | 作品全体の既定値だけ残す場合は明示 |
| original_publisher | KEEP | 条件付 | Works | 外部原版時のみ |
| default_credit_display | KEEP | 任意 | Works | 既定値、文書発行時snapshot |
| remarks | KEEP | 任意 | Works | 内部メモ |
| is_active | DERIVE | ○ | system | 廃止・統合時に変更 |
| completeness_score | DERIVE | - | DQ | 閲覧専用 |

## 3. 作品群・作品関係

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| family_code | DERIVE | ○ | 自動採番 |
| family_name | KEEP | ○ | シリーズ表示名 |
| family_type | KEEP | ○ | series / franchise / universe等 |
| representative_work_id | KEEP | 条件付 | UI代表 |
| root_work_id | KEEP | 条件付 | 系譜上の源流 |
| source_work_id | KEEP | ○ | work_relations |
| derived_work_id | KEEP | ○ | work_relations |
| relation_type | KEEP | ○ | 続編・番外編・翻訳等 |
| is_primary | KEEP | ○ | 主関係を1件に限定 |
| relation_note | KEEP | 任意 | 例外説明 |

## 4. マテリアル

| 項目 | 判定 | 必須 | 編集元 | 備考 |
|---|---|---:|---|---|
| material_code | DERIVE | ○ | system | 自動採番 |
| material_name | KEEP | ○ | Material | 名称 |
| material_type | KEEP | ○ | Material | illustration / text / game_design等 |
| material_role | KEEP | ○ | Material | core_logic / character等 |
| category_id | KEEP | 推奨 | Material | カテゴリマスター |
| work_id | KEEP | ○ | Material | 所属作品 |
| acquisition_type | KEEP | ○ | Material | buyout / license / commission等 |
| rights_type | KEEP | ○ | Material | owned / licensed / joint等 |
| rights_holder_vendor_id | MOVE | 条件付 | Rights Source | 既存互換値は移行後deprecate |
| rights_holder_label | MOVE | 任意 | Rights Source | 権利者表示名 |
| financial conditions | REMOVE | - | - | Material画面から直接入力しない |
| used_by_works | DERIVE | - | relation | 自動集約 |
| condition_count | DERIVE | - | condition | 自動集約 |

## 5. 権利根源

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| material_id | KEEP | ○ | 対象マテリアル |
| source_type | KEEP | ○ | work / family / direct_contract / owned等 |
| source_work_id | KEEP | 条件付 | 根源作品 |
| source_family_id | KEEP | 条件付 | 根源作品群 |
| rights_holder_vendor_id | KEEP | 条件付 | 社外権利時必須 |
| source_contract_id | KEEP | 条件付 | 根拠契約 |
| source_role | KEEP | ○ | underlying_work / character_source等 |
| is_primary | KEEP | ○ | 期間・用途ごとに1件 |
| purpose | KEEP | 任意 | 用途スコープ |
| valid_from / valid_to | KEEP | 推奨 | 有効期間 |
| fee_subject_type | KEEP | 条件付 | source_work / family / material / custom |
| fee_subject_name | KEEP | 条件付 | 利用料名目 |
| evidence_id | KEEP | 条件付 | 社外権利時推奨 |
| verified_by / verified_at | KEEP | 推奨 | 確認証跡 |

## 6. 契約・文書

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| document_number | DERIVE | ○ | 採番 |
| contract_title | KEEP | ○ | 契約台帳 |
| contract_level | KEEP | ○ | master / individual等 |
| contract_category | KEEP | ○ | license / service / sales等 |
| contract_type | KEEP | ○ | 類型 |
| primary_vendor_id | KEEP | 条件付 | 主相手方 |
| parties | KEEP | ○ | N件・役割付き |
| effective_date | KEEP | 推奨 | 発効日 |
| expiration_date | KEEP | 条件付 | 終期 |
| auto_renewal | KEEP | ○ | Boolean |
| termination_notice_days | KEEP | 条件付 | 日数 |
| lifecycle_stage | KEEP | ○ | draft / active / expired等 |
| related_works | KEEP | 条件付 | contract_works |
| related_materials | KEEP | 条件付 | 権利対象 |
| territory | MOVE | - | condition_linesへ |
| language | MOVE | - | condition_linesへ |
| rate / amount / formula | MOVE | - | condition_linesへ |
| evidence | KEEP | ○ | 元ファイル・署名済み文書 |
| snapshot fields | SNAPSHOT | 条件付 | 発行・締結時 |

## 7. 条件明細

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| line_code | DERIVE | ○ | 採番 |
| work_id | KEEP | 条件付 | 対象作品 |
| source_material_id | KEEP | 条件付 | 対象マテリアル |
| material_rights_source_id | KEEP | 条件付 | 権利根源 |
| counterparty_vendor_id | KEEP | 条件付 | 相手方 |
| direction | KEEP | ○ | payable / receivable |
| transaction_kind | KEEP | ○ | service / license / product / rights_transfer |
| payment_scheme | KEEP | ○ | lump_sum / royalty / per_unit等 |
| settlement_trigger | KEEP | ○ | inspection / report / effective_date等 |
| calculation_basis | KEEP | 条件付 | MSRP / Net Sales等 |
| amount_ex_tax | KEEP | 条件付 | 固定額 |
| rate_pct | KEEP | 条件付 | 料率 |
| mg_amount | KEEP | 任意 | MG |
| per_unit_amount | KEEP | 条件付 | 単価 |
| currency | KEEP | 条件付 | ISO通貨 |
| fx_rule | KEEP | 条件付 | 為替ルール |
| region | KEEP | 条件付 | N件 |
| language | KEEP | 条件付 | N件 |
| valid_from / valid_to | KEEP | 推奨 | 適用期間 |
| report_frequency | KEEP | 条件付 | 月次・四半期等 |
| inspection_required | DERIVE | - | triggerから導出、override可 |
| fee_subject_override | KEEP | 任意 | 条件単位の上書き |
| fee_subject_snapshot | SNAPSHOT | 発行時 | 過去文書不変 |
| derivation_rule_code | DERIVE | - | 自動判定 |
| manual_override_reason | KEEP | 条件付 | override時必須 |

## 8. 案件・タスク

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| matter_code | DERIVE | ○ | 採番 |
| matter_name | KEEP | ○ | 案件名 |
| counterparty_id | KEEP | 条件付 | 相手方 |
| owner_id | KEEP | ○ | 担当者 |
| representative_issue | KEEP | 任意 | Backlog等 |
| target_date | KEEP | 推奨 | 期限 |
| status | KEEP | ○ | 状態遷移 |
| blocker | KEEP | 任意 | ブロッカー |
| notes | KEEP | 任意 | 備考 |
| completeness | DERIVE | - | DQ |
| task_name | KEEP | ○ | タスク |
| task_priority | KEEP | 推奨 | 優先度 |
| task_due_date | KEEP | 推奨 | 期限 |
| task_owner | KEEP | 条件付 | 担当者 |

## 9. 検収

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| purchase_order_id | QUOTE | ○ | 元発注書 |
| line_item_id | QUOTE | ○ | 元明細 |
| delivered_at | KEEP | 条件付 | 納品日 |
| inspected_at | KEEP | ○ | 検収日 |
| inspector_id | KEEP | ○ | 検収者 |
| inspected_quantity | KEEP | 条件付 | 数量 |
| inspected_amount | KEEP | 条件付 | 金額 |
| result | KEEP | ○ | pass / partial / reject |
| defect_note | KEEP | 条件付 | 不備 |
| redelivery_due | KEEP | 条件付 | 再納期限 |
| issue_certificate | KEEP | ○ | 検収書発行 |
| evidence | KEEP | 推奨 | 納品証跡 |

## 10. Finance

| 項目 | 判定 | 必須 | 備考 |
|---|---|---:|---|
| condition_line_id | QUOTE | ○ | 条件正本 |
| period | KEEP | ○ | 対象期間 |
| report_id | QUOTE | 条件付 | 売上・製造・利用報告 |
| gross_base | KEEP | 条件付 | 売上等 |
| deductions | KEEP | 条件付 | 控除明細 |
| net_sales | DERIVE | 条件付 | 計算値 |
| rate / unit / mg | QUOTE | 条件付 | 条件から引用 |
| amount_ex_tax | DERIVE | ○ | 計算値 |
| tax_amount | DERIVE | 条件付 | 税計算 |
| withholding | DERIVE | 条件付 | 取引先区分等 |
| total_amount | DERIVE | ○ | 支払・受取額 |
| currency | QUOTE | ○ | 条件から引用 |
| fx_rate / fx_date | KEEP | 条件付 | 外貨時 |
| due_date | DERIVE | 条件付 | 支払条件から算出 |
| status | KEEP | ○ | draft / confirmed / paid等 |
| fee_subject | SNAPSHOT | 発行時 | 計算書名目 |
| bank_account | SENSITIVE | 条件付 | finance/adminのみ |

## 11. 取引先

| 項目 | 判定 | 必須 | 可視性 |
|---|---|---:|---|
| vendor_code | DERIVE | ○ | 全権限 |
| entity_type | KEEP | ○ | 全権限 |
| vendor_name | KEEP | ○ | 全権限 |
| trade_name / pen_name | KEEP | 任意 | 全権限 |
| aliases | KEEP | 任意 | 全権限 |
| corporate_number | KEEP | 条件付 | finance/admin |
| invoice_registration_number | KEEP | 条件付 | finance/admin |
| withholding_enabled | KEEP | ○ | finance/admin |
| subcontract_act_applicable | KEEP | 推奨 | legal/admin |
| freelance_act_applicable | KEEP | 推奨 | legal/admin |
| address / phone / email | KEEP | 条件付 | 必要最小限 |
| transaction_category | KEEP | 推奨 | internal |
| payment_terms | KEEP | 推奨 | finance/admin |
| capital / employee_count | KEEP | 任意 | legal/admin |
| antisocial_result | SENSITIVE | 条件付 | 結論のみ/詳細分離 |
| credit_result | SENSITIVE | 任意 | 結論のみ/詳細分離 |
| bank_name / branch | SENSITIVE | 条件付 | finance/admin |
| account_type / number / holder | SENSITIVE | 条件付 | finance/admin・マスク |
| master_contract_ref | DERIVE | - | 契約台帳から集約 |

## 12. 担当者・稟議・ルール

| エンティティ | 項目 | 判定 |
|---|---|---|
| Staff | name / department / email / slack_id / role / active | KEEP |
| Ringi | number / title / applicant / department / applied_at / approved_at / status / amount / related_entities | KEEP |
| Rule | code / name / target / priority / condition / action / valid_period / active | KEEP |
| Routing | API設定から閲覧 | DERIVE |

## 13. Data Maintenance

| 項目 | 判定 | 備考 |
|---|---|---|
| target_type | KEEP | 対象種別 |
| source_file | KEEP | 証跡保存 |
| mapping | KEEP | 再利用可能 |
| dry_run | KEEP | 既定true |
| duplicate_policy | KEEP | skip / update / manual |
| diff | DERIVE | 実行前表示 |
| affected_count | DERIVE | 実行前後 |
| execution_reason | KEEP | 危険操作時必須 |
| actor / executed_at | DERIVE | 監査 |
| result_file | DERIVE | 出力証跡 |

## 14. search-api削除・制限対象

| 機能・項目 | 判定 | 理由 |
|---|---|---|
| SSR取引先新規登録 | REMOVE | admin-uiへ一本化 |
| SSR取引先編集・削除 | REMOVE | 重複書込み防止 |
| SSR CSV取込 | MOVE | Data Maintenanceへ |
| SSR強制削除・救済 | MOVE | admin権限の保守画面へ |
| viewer銀行口座表示 | REMOVE | 機密情報 |
| viewer反社詳細 | REMOVE | 結論のみ |
| works kind='own'固定検索 | REMOVE | works全体へ統合 |
| 原作専用検索種別 | DEPRECATE | 派生元・根源・シリーズfacetへ |
| source_ips直接参照 | REMOVE | works正準化 |

## 15. 項目レビュー完了条件

- 同じ意味の項目が複数画面で別名になっていない。
- 条件項目が契約・素材・Financeへ重複入力されていない。
- 自動導出・引用・snapshotが直接編集できない。
- 機密項目にroleと目的制限がある。
- 必須条件がデータ品質ルールと一致する。
- 元文書・証憑へ到達できる。
- deprecate / remove項目に移行先と撤去条件がある。
