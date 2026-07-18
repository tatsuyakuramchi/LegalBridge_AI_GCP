# レガシー条件エンドポイント棚卸し (UIC-01 / CLEAN-08)

設計 v1.4「最重要修正 #1: 条件明細(condition_lines)唯一の書込み口」に対する **Phase A（計測・ガード）** の成果物。

条件値は **文書フォーム（Document Command）経由でのみ** 書けるべき、というのが本システムの第 1 原則。
しかし Admin UI（`src/`）の複数画面が、作品・素材（source-ip）単位のレガシー条件エンドポイントを
直接叩いている。本書はその全参照を分類し、`scripts/audit/condition_write_refs.sh --gate N` の
ラチェット上限（現状 **18**）の根拠を示す。

- 計測: `scripts/audit/condition_write_refs.sh`（`--detail` で該当行、`--gate N` で CI ゲート）
- CI: `cloudbuild.yaml` の `gate-condition-endpoints`（admin-ui ビルドの先頭ステップ）
- 目標: Phase C で **値書込み系を 0 件**、Phase D で source-ips→works 統合に伴い残面ごと撤去
- 進捗: **18 → 17 → 15 → 12（値書込み 0 達成）**
  - UIC-02: WorkGraphPanel の V3LicenseMatrix 直接保存 `license-matrix` を撤去（文書起票 CTA へ）→ 17
  - UIC-03: MaterialEntryPanel の条件作成（POST `condition-lines`）・全置換（PUT `conditions`）を撤去（素材CRUD限定＋文書フォームCTA）→ 15
  - CLEAN: WorkGraphPanel の孤児条件書込み（`saveMatFc` PUT / `saveMatCond` POST。A系 read-only 化で UI 撤去済・ハンドラ孤児）を物理撤去 → **12**
  - **残 12 は全て「関係リンク（component-lines / link-conditions）」または「読取り（condition-lines GET）」。値書込みは 0**。撤去は Phase D（source-ips→works）で。

## 分類

| 種別 | エンドポイント | 判定 | 撤去フェーズ |
|---|---|---|---|
| ~~値書込み~~ | ~~`POST /api/works/:id/license-matrix`~~ | ~~V3LicenseMatrix 直接保存~~ → **撤去済み（UIC-02）**。文書フォーム起票 CTA へ置換 | ✅ 完了 |
| ~~値書込み~~ | ~~`PUT .../materials/:mid/conditions`~~ | ~~素材条件の全置換~~ → **撤去済み**（MaterialEntry=UIC-03、WorkGraph 孤児 saveMatFc=CLEAN） | ✅ 完了 |
| ~~値書込み~~ | ~~`POST .../materials/:mid/condition-lines`~~ | ~~素材条件明細の作成~~ → **撤去済み**（MaterialEntry=UIC-03、WorkGraph 孤児 saveMatCond=CLEAN）。文書フォーム CTA へ | ✅ 完了 |
| リンク維持 | `POST/DELETE /api/v3/works/:id/component-lines` | 既存 condition_line を作品構成へリンク／解除（`{condition_line_id, source_material_id}`。値は書かない） | 維持（凍結）。Phase D で Works マテリアルタブへ統合 |
| リンク維持 | `POST /api/v3/source-ips/:id/materials/:mid/link-conditions` | 既存条件行を素材へリンク（値は書かない） | 維持（凍結）。設計 §Phase C「既存条件の関係リンク API だけ維持」 |
| 読取り | `GET /api/v3/source-ips/:id/materials/:mid/condition-lines` | 素材条件明細の取得（値は書かない。MaterialEntry の read-only 表示等） | **Phase D**（source-ips 撤去に同伴） |

> 注（分類の訂正）: `component-lines` は当初「値書込み」に分類していたが、実体は既存 condition_line を
> 作品構成へ**リンク／解除**するだけ（`{condition_line_id, source_material_id}`）で条件値は書かない。
> よって `link-conditions` と同じ「関係リンク維持（凍結）」に再分類し、撤去は Phase D（Works 統合）で行う。

## 参照箇所（現状: 12。ベースライン 18 → UIC-02 で 17 → UIC-03 で 15 → CLEAN で 12。**値書込み 0**）

| ファイル | 参照数 | 主な用途 |
|---|---|---|
| `src/pages/master/WorkGraphPanel.tsx` | 3 | component-lines リンク／解除・条件明細の read-only GET（値書込みは撤去済） |
| `src/pages/master/WorkMaterialLinkPanel.tsx` | 4 | component-lines リンク／解除（doc-comment 含む） |
| `src/pages/master/MaterialEntryPanel.tsx` | 2 | ~~作成/全置換(撤去済)~~・link-conditions・条件明細の read-only GET |
| `src/pages/master/UnlinkedConditionsPanel.tsx` | 2 | link-conditions（未リンク条件の紐付け） |
| `src/pages/master/BulkImportPanel.tsx` | 1 | CSV 取込時の condition-lines 作成（管理者バッチ。Phase D/CSV 移管で扱う） |

## 撤去の進め方

1. **Phase C**: 各値書込み UI を「条件書作成 CTA / 独立入力 CTA / 元文書再編集」へ置換し、
   置換のたびに `--gate` の上限を実測値へ下げる（ラチェット）。
2. **Phase D**: `source_ips`→`works` 統合で `/api/v3/source-ips/...` 系エンドポイント自体を撤去。
   読取り（GET）も Works 側の統合 API へ移す。
3. リンク維持系（`link-conditions`）は値を書かないため凍結のまま存置。関係付けは Works マテリアルタブ経由へ。

各撤去 PR は本書の分類表と `--gate` 上限を同時に更新すること（設計 §文書管理ルール）。
