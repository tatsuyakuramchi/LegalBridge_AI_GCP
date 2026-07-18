# フォーム台帳 (Form Surface Inventory) — R0 / FRM-01

設計 v1.4 §15「横断トラック R」の R0、および Issue FRM-01 の成果物。
全編集 surface に **ID・所有者・旧／新基盤・撤去/移行方針** を登録し、以後の全フォーム UI リニューアル
（AppFormShell 等の共通基盤への移行）と物理撤去（R6 / Phase H）の進捗計測の起点にする。

- 基準日: 2026-07-18（Phase A ベースライン）
- 基盤の凡例:
  - `Schema` = `SchemaDocumentForm`（`documentFormSchemas.ts` の REGISTRY 経由）
  - `DocumentForm(legacy)` = 旧 per-template 分岐フォールバック（FRM-04 / R2 で撤去対象）
  - `page-specific` = ページ固有の手書きフォーム（R3〜R5 で共通シェルへ移行対象）
- `共通シェル`列: `AppFormShell`/`FormField`/`ValidationSummary`/`DataQualityPanel`/`StickyActionBar`（R1 で新設予定）への移行状態。現状は全て未移行（`-`）。

> この台帳は R トラックの各 wave / 各撤去 PR で更新する。新規の編集画面・Dialog・Drawer を追加する PR は、
> ここへ `form_surface_id` を追記すること（設計 §文書管理ルール）。

---

## 1. 文書テンプレート（Document Editor 経由）

Document Editor（`/documents/new`）が唯一の起票口。基盤は `documentFormSchemas.ts` の REGISTRY。
**18 テンプレート中 16 が Schema 化済み、`sublicense_out_terms` は Schema（CTA 起点）、残り 2 が legacy fallback。**

| form_surface_id | テンプレート | 基盤 | 共通シェル | 備考 |
|---|---|---|---|---|
| DOC-legal_response | 法務レター | Schema | - | |
| DOC-notice_consent_pinf_freelance | 個人情報同意通知 | Schema(AUTO) | - | |
| DOC-pub_master_individual | 出版基本契約(個人) | Schema | - | |
| DOC-pub_master_corporate | 出版基本契約(法人) | Schema | - | |
| DOC-license_master | 利用許諾基本契約 | Schema | - | |
| DOC-service_master | 業務委託基本契約 | Schema | - | |
| DOC-nda | NDA | Schema | - | |
| DOC-sales_master_buyer | 売買基本(買主) | Schema | - | |
| DOC-sales_master_standard | 売買基本(標準) | Schema | - | |
| DOC-sales_master_credit | 売買基本(与信) | Schema | - | |
| DOC-intl_purchase_order | 海外発注書 | Schema | - | |
| DOC-maintenance_spec | 保守仕様書(別紙) | Schema | - | 動的配列 custom section |
| DOC-inspection_certificate | 検収書 | Schema | - | bare section |
| DOC-royalty_statement | 利用許諾料計算書 | Schema | - | bare + 3 effects |
| DOC-purchase_order | 発注書 | Schema | - | 明細集計 effect は DocumentForm 残存 |
| DOC-individual_license_terms | 個別利用許諾条件書 | Schema | - | v3 マトリクス bare section |
| DOC-sublicense_out_terms | 再許諾条件書 | Schema | - | **CTA 起点（picker 未露出）。要 config 露出判断** |
| DOC-pub_license_terms | 出版利用許諾条件書 | Schema(bare custom) | - | ✅ FRM-04 で移行済（作品/原作ピッカー＋基本契約Lookup＋FinancialConditionTable＋PUB並替を bare セクションへ移設） |
| DOC-pub_additional_terms | 出版追加条件書 | Schema(AUTO) | - | ✅ FRM-04 で移行済（旧は独自セクション無し→AUTOで等価） |

**✅ 旧 DocumentForm フォールバックは 0 件**（全 18 テンプレート Schema 化完了）。`isSchemaMigrated` が全テンプレートで true になり、DocumentForm の legacy render path（1061 行以降）は到達不能な dead code。物理削除は FRM-14 / CLEAN-02（別タスク）で実施する（`pubCondSeededRef` 等の hook effect は SchemaDocumentForm 経路でも発火するため据え置き）。

---

## 2. マスター編集ルート（`/master/*`）

| form_surface_id | ルート | パネル | 基盤 | 設計上の方針（v1.4） |
|---|---|---|---|---|
| MST-contracts | `/master/contracts` | ContractsPanel | page-specific | `/contracts` へ移動（UIC-15 / Phase E）。旧簡易登録撤去 |
| MST-vendors | `/master/vendors` | VendorsPanel | page-specific | 参照マスターとして残置。search-api 旧UIは read-only 化済み（UIC-18） |
| MST-work-entry | `/master/work-entry` | WorkEntryPanel | page-specific | **Works へ統合しリダイレクト（UIC-10 / Phase D）** |
| MST-materials | `/master/materials` | MaterialEntryPanel | page-specific | 条件作成・全置換を撤去し素材CRUDへ限定済（✅ UIC-03 / Phase C）→条件は文書フォームCTA・既存は read-only |
| MST-bulk-import | `/master/bulk-import` | BulkImportPanel | page-specific | Data Maintenance へ移動（UIC-17 / Phase E） |
| MST-work-material-link | `/master/work-material-link` | WorkMaterialLinkPanel | page-specific | **Works マテリアルタブへ統合（UIC-11 / Phase D）** |
| MST-sublicense-conditions | `/master/sublicense-conditions` | SublicenseConditionPanel | read-only + CTA | A系で read-only 化済み。再許諾は文書起票へ |
| MST-unlinked-conditions | `/master/unlinked-conditions` | UnlinkedConditionsPanel | page-specific | link-conditions のみ（値は書かない）。維持 |
| MST-billing | `/master/billing` | BillingTablePanel | page-specific | Finance へ移動（UIC-16 / Phase E） |
| MST-billing-dashboard | `/master/billing-dashboard` | BillingDashboardPanel | page-specific | Finance へ移動（UIC-16 / Phase E） |
| ~~MST-pub-license~~ | `/master/pub-license` → redirect | ~~PubLicenseEntryPanel（削除済）~~ | Document Editor へ | ✅ UIC-12 廃止＋CLEAN-03 でファイル物理削除。旧URLは `/documents/new?template=pub_license_terms` へリダイレクト（1リリース維持） |
| MST-merge | `/master/merge` | EntityMergePanel | page-specific | Data Maintenance へ移動（UIC-17 / Phase E） |
| MST-ledgers | `/master/ledgers` | LedgersPanel | page-specific | **移行照合専用 read-only へ縮退（UIC-14 / Phase F）** |
| MST-ringi | `/master/ringi` | RingiPanel | page-specific | 参照マスター/業務。共通シェルへ（FRM-07） |
| MST-drafts | `/master/drafts` | DraftsPanel | page-specific | Data Maintenance へ移動（UIC-17 / Phase E） |
| MST-receivable-map | `/master/receivable-map` | ReceivableMapPanel | page-specific | Finance 系。read-only 照合 |
| MST-work-model | `/master/work-model` | WorkModelPanel | page-specific | **作品ツリー/派生を Works へ移植し廃止（UIC-13 / Phase D）** |
| MST-staff | `/master/staff` | StaffPanel | page-specific | 参照マスター。共通シェルへ（FRM-07） |
| MST-rules | `/master/rules` | RulesPanel | page-specific | 参照マスター |

---

## 3. 作品・文書・業務ルート（`/master` 外）

| form_surface_id | ルート | パネル/ページ | 基盤 | 方針 |
|---|---|---|---|---|
| WRK-list | `/works` | WorksListPanel | page-specific | 作品管理の正準入口。完全性 Badge 追加（DQ-04）。共通シェルへ（FRM-06） |
| WRK-graph | `/works/:id` | WorkGraphPanel | page-specific | V3LicenseMatrix 直接保存を撤去済（UIC-02 / Phase C 第1弾）→文書起票CTA。残: タブ分割（UIC-09） |
| DOC-editor | `/documents/new` | DocumentEditorPage | Schema+DocumentForm | ✅ true readonly（UIC-06：`<fieldset disabled>`）／✅ アクションバー sticky 化（UIC-04：body スクロール前提で親 `overflow-hidden` を外し `sticky bottom-0`。作成ボタンは常に画面内） |
| MAT-list | `/matters` | MattersListPage | page-specific | ✅ nested interactive 解消済（UIC-07：行=overlay button＋統合カートは独立 button）。残: カード対応（UIC-21） |
| MAT-detail | `/matters/:matterId` | MatterDetailPage | page-specific | ✅ Matterのみ下書き（UIC-05：課題なしでも matter:<id> 合成キーで下書き保存・再開。DBスキーマ変更なし）。残: タブ化（UIC-20） |
| CND-hub | `/condition-lines` | ConditionsHubPage | page-specific | 条件は read/検索中心。値編集は文書へ |
| DL-linkage | `/data-linkage` | DataLinkagePanel | page-specific | Data Maintenance 系 |
| TPL-list/editor | `/templates`,`/templates/:id` | Templates* | page-specific | テンプレ管理（管理者フォーム型 FRM-10） |
| SET-settings | `/settings` | SettingsPage | page-specific | 設定 |
| IMP-imports | `/imports`,`/data-import`,`/excel-batches` | Import系 | page-specific | Data Maintenance へ集約（UIC-17） |

---

## 4. 新設予定（v1.4）

| form_surface_id | ルート | 内容 | Issue |
|---|---|---|---|
| DE-work | `/data-entry/*` | 独立データ入力UI（作品/素材/権利根源の単独・補完登録） | DQ-05 |
| DQ-center | `/data-quality` | Data Quality Center（完全性Issue一覧・修正導線） | DQ-06 |
| FIN-home | `/finance` | Finance モジュール（billing / billing-dashboard / receivable-map を集約）**✅ 実装済み（UIC-16）**。旧 `/master/billing*`・`/master/receivable-map` は計測付きリダイレクト | UIC-16 |
| DM-home | `/data-maintenance` | bulk-import / merge / unlinked-conditions / drafts を集約 **✅ 実装済み（UIC-17）**。旧 `/master/*` は計測付きリダイレクト（`merge?prefill` の内部導線は直結に repoint） | UIC-17 |
| CTR-home | `/contracts` | 契約台帳（`/master/contracts` から top-level へ移設）**✅ 実装済み（UIC-15）**。旧 `/master/contracts` は計測付きリダイレクト、旧「簡易登録(旧フォーム)」は撤去（新規は文書フォームへ一本化） | UIC-15 |
| MST-home | `/master` | **✅ UIC-19（Phase E 仕上げ）**：参照マスターのランディングへ縮退。タブは 4 項目（取引先 / 担当者 / 稟議 / ルーティング）＋「その他」行（原作素材・再許諾条件登録）。契約=/contracts・金銭=/finance・保守=/data-maintenance・作品=/works は各モジュールへ移設済み。Master タブは 18→4 に。ヘッダの死んだ「CSV bulk import」ボタンも撤去 | UIC-19 |

---

## 5. 未棚卸し（R トラック実行時に追補）

以下は本 R0 では routeレベルまで。R1 の共通基盤導入後、各 wave で個別に台帳化する。

- **Dialog / Drawer**: 各パネル内のモーダル（作品インライン追加、取引先検索補完、明細行編集など）。FRM-11 で compact 共通フォームへ。
- **インライン追加**: `DocumentForm` / schema 内の EntitySearchSelect からの原作・作品・取引先の即時作成（A系で matched-aware トースト対応済み）。
- **旧検索ポータル（search-api SSR）**: 編集フォームは read-only/redirect 化対象（FRM-12 / UIC-18）。取引先はバナー誘導済み。

## 集計（Phase A ベースライン）

- 文書テンプレート: 18（全 Schema 化 → **legacy DocumentForm fallback 残 0**。**FRM-14 で dead render を物理削除済み**）
- マスター編集ルート: 19
- その他編集ルート: 10
- 共通シェル移行済み: **0 / 全 surface**（R1 未着手）
- レガシー条件エンドポイント参照: **18**（`docs/forms/legacy-condition-endpoints.md`）

## 検証基盤・CI ラチェット（Phase B: UIC-08 / FRM-03）

- **UIC-08 検証基盤**: `src/components/document/formValidation.ts` に `validateDocForm()` を新設。
  文書生成前チェック（`DocumentEditorPage.handleGenerate`）とセクションナビの必須件数
  （`missingRequiredIds`）を単一ソース化。従来の `required`（必須・空）判定に加え、
  `number`/`date` 型の型検証と、動的明細（`type:"array"` / `itemRequired`）の行内検証を
  「基盤」として実装（型/明細は False Positive を避ける保守的判定）。テンプレ固有の
  明細ルールは `extraValidators` で差し込める拡張口を用意。
## FRM-14 / CLEAN-03 撤去状況

- **FRM-14（完了）**: `DocumentForm.tsx` の旧 per-template 分岐（フォールバック render）＋ `renderField` ヘルパを
  物理削除。全 19 テンプレが REGISTRY 登録済み（root/worker 両 `templates_config.json` と突合済み）で
  到達不能を確認したうえで撤去（1341 行 → 805 行、-536 行）。孤立した import も除去。
  `DocumentForm` は「ctx を組み立て、移行済みの各 hook/effect を回し、`SchemaDocumentForm` へ委譲する器」に縮退。
  未登録テンプレが将来現れても `autoSectionsFromMetadata` で汎用描画する安全弁を残置（白画面防止）。
- **UIC-10 / CLEAN-03（WorkEntry・完了）**: `work-entry` ルートを Works 統一一覧（`/works`）へ**計測付き互換
  リダイレクト**（`DeprecatedRedirect`）。作成は `WorksListPanel` のダイアログ（原作/自社作品）、編集は
  3カードエディタ（`/works/:id`）が担うため機能損失なし。ナビ（`MasterLayout` / `DashboardPage`）も `/works` へ
  repoint。`WorkEntryPanel.tsx`（445 行）は参照ゼロを確認して**物理削除**。
- **UIC-11 / CLEAN-03（WorkMaterialLink・完了）**: `work-material-link` を `/works` へ計測付き互換リダイレクト。
  作品↔原作マテリアルの N:N 結線（`component-lines` POST/DELETE）は Works 詳細（`/works/:id`）が同一 API で
  既に提供済みのため機能損失なし。`MasterLayout` の独立ナビ「作品×原作素材 紐づけ」は撤去（文脈内操作へ一本化）。
  `WorkMaterialLinkPanel.tsx`（349 行）を物理削除。副次効果として**条件エンドポイント参照 12 → 8**（ratchet gate も 8 へ）。
- **UIC-14（LedgersPanel read-only 縮退・完了）**: 原作マスター（`ledgers`）を**移行照合専用の読み取り専用**へ縮退。
  作成は既に `/works` へ誘導済みだったが、残る書込み（原作編集 PUT・原作削除・素材追加/削除）を全て無効化。
  4 つの書込み関数を `READ_ONLY` ガードで早期 return、詳細ダイアログを `<fieldset disabled>`（UIC-06 と同型）で
  全入力・全ボタン不活性化、行の「編集/削除」を「詳細（閲覧）」のみへ、保存ボタン撤去、read-only バナー掲示。
  `ledgers` ルートは存続（旧 ledgers 参照・移行突合のため）。物理削除は migration（Phase F）完了後。
- **UIC-13 / CLEAN-03（WorkModel・完了）**: `WorkModelPanel`（1772 行）を物理削除。作品・派生は段階A で /works へ移植、
  契約は `ContractsPanel`（/master/contracts）で冗長、CSV 取込は本番 30 日 使用実績 0（`/api/v3/import/` ログ 0 件）で撤去、
  原作IP は閲覧冗長。`work-model` は `/works` へ計測付きリダイレクト。詳細: `docs/forms/uic-13-workmodel-parity.md`。
- **CLEAN-03残**: `MaterialEntryPanel` は UIC-03 で素材 CRUD の常設面として存続（削除対象外）。`LedgersPanel` は
  UIC-14 で read-only 化（migration 完了まで参照用に存続）。`PubLicenseEntryPanel` / `WorkEntryPanel` /
  `WorkMaterialLinkPanel` / `WorkModelPanel` は削除済み。
- **CLEAN-06（計測付きリダイレクト基盤）**: `src/components/DeprecatedRedirect.tsx` を新設し、廃止ルート到達を
  `navigator.sendBeacon` で BFF（`server.ts` の `POST /api/_client-telemetry/deprecated-route`）へ通知→
  Cloud Logging に `[deprecated-route] from=… to=…` を構造化出力。旧 URL がいつまで踏まれるかを集計し、
  リダイレクト自体の撤去時期（CLEAN-09）の判断材料にする。適用: `work-entry` / `work-graph` / `pub-license` /
  `conditions` / `pending-inspections` の 5 本（`index`→contracts と catch-all は既定遷移のため対象外）。

- **FRM-03 ラチェット**: `scripts/audit/form_primitive_refs.sh`（Cloud Build `gate-form-primitives`）。
  文書フォーム面（`src/components/document/`、共通プリミティブ本体 `FormField.tsx`/`DocFormKit.tsx` 除外）の
  生 `<input>/<select>/<textarea>` と旧フォーム CSS（`retro-input` 等）を「増やさない」。
  ベースライン: **raw_inputs=28 / legacy_css=0**（raw 28 は `V3LicenseMatrix` 等の既存独自
  コンポーネントで Phase D 撤去まで凍結。`sublicenseOutTerms.tsx` の `retro-input` は本 wave で解消）。
