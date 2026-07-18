# レガシー条件エンドポイント棚卸し (UIC-01 / CLEAN-08)

設計 v1.4「最重要修正 #1: 条件明細(condition_lines)唯一の書込み口」に対する **Phase A（計測・ガード）** の成果物。

条件値は **文書フォーム（Document Command）経由でのみ** 書けるべき、というのが本システムの第 1 原則。
しかし Admin UI（`src/`）の複数画面が、作品・素材（source-ip）単位のレガシー条件エンドポイントを
直接叩いている。本書はその全参照を分類し、`scripts/audit/condition_write_refs.sh --gate N` の
ラチェット上限（現状 **18**）の根拠を示す。

- 計測: `scripts/audit/condition_write_refs.sh`（`--detail` で該当行、`--gate N` で CI ゲート）
- CI: `cloudbuild.yaml` の `gate-condition-endpoints`（admin-ui ビルドの先頭ステップ）
- 目標: Phase C で **値書込み系を 0 件**、Phase D で source-ips→works 統合に伴い残面ごと撤去
- 進捗: **18 → 17 → 15**
  - UIC-02: WorkGraphPanel の V3LicenseMatrix 直接保存 `license-matrix` を撤去（文書起票 CTA へ）→ 17
  - UIC-03: MaterialEntryPanel の条件作成（POST `condition-lines`）・全置換（PUT `conditions`）を撤去（素材CRUD限定＋文書フォームCTA）→ 15

## 分類

| 種別 | エンドポイント | 判定 | 撤去フェーズ |
|---|---|---|---|
| ~~値書込み~~ | ~~`POST /api/works/:id/license-matrix`~~ | ~~V3LicenseMatrix 直接保存~~ → **撤去済み（Phase C 第1弾）**。文書フォーム起票 CTA へ置換 | ✅ 完了（UIC-02） |
| 値書込み | `POST/PUT/DELETE /api/v3/works/:id/component-lines` | コンポーネント明細の作成・置換・解除 | **Phase C / D** |
| 値書込み | `PUT /api/v3/source-ips/:id/materials/:mid/conditions` | 素材条件の全置換 | MaterialEntry は撤去済（✅ UIC-03）。**残: WorkGraphPanel の 1 箇所（Phase C/D）** |
| ~~値書込み~~ | ~~`POST .../materials/:mid/condition-lines`~~（MaterialEntry） | ~~素材条件明細の作成~~ → **撤去済（Phase C・UIC-03）**。文書フォーム CTA へ | ✅ 完了（UIC-03） |
| 読取り | `GET /api/v3/source-ips/:id/materials/:mid/condition-lines` | 素材条件明細の取得（値は書かない。MaterialEntry の read-only 表示等） | **Phase D**（source-ips 撤去に同伴） |
| リンク維持 | `POST /api/v3/source-ips/:id/materials/:mid/link-conditions` | 既存条件行を素材へリンク（値は書かない） | 維持（凍結）。設計 §Phase C「既存条件の関係リンク API だけ維持」 |

> 注: `component-lines` は `WorkMaterialLinkPanel` では純粋なリンク／解除（`{ condition_line_id, source_material_id }`）、
> `WorkGraphPanel` では明細作成にも使われる。前者は Phase D で Works マテリアルタブへ統合、後者は Phase C で文書起票へ置換する。

## 参照箇所（現状: 15。ベースライン 18 → UIC-02 で 17 → UIC-03 で 15）

| ファイル | 参照数 | 主な用途 |
|---|---|---|
| `src/pages/master/WorkGraphPanel.tsx` | 6 | ~~V3LicenseMatrix 保存~~(撤去済)・component-lines・素材条件(PUT/GET) |
| `src/pages/master/WorkMaterialLinkPanel.tsx` | 4 | component-lines リンク／解除（doc-comment 含む） |
| `src/pages/master/MaterialEntryPanel.tsx` | 2 | ~~作成/全置換(撤去済)~~・link-conditions・条件明細の read-only GET |
| `src/pages/master/UnlinkedConditionsPanel.tsx` | 2 | link-conditions（未リンク条件の紐付け） |
| `src/pages/master/BulkImportPanel.tsx` | 1 | CSV 取込時の condition-lines 作成 |

## 撤去の進め方

1. **Phase C**: 各値書込み UI を「条件書作成 CTA / 独立入力 CTA / 元文書再編集」へ置換し、
   置換のたびに `--gate` の上限を実測値へ下げる（ラチェット）。
2. **Phase D**: `source_ips`→`works` 統合で `/api/v3/source-ips/...` 系エンドポイント自体を撤去。
   読取り（GET）も Works 側の統合 API へ移す。
3. リンク維持系（`link-conditions`）は値を書かないため凍結のまま存置。関係付けは Works マテリアルタブ経由へ。

各撤去 PR は本書の分類表と `--gate` 上限を同時に更新すること（設計 §文書管理ルール）。
