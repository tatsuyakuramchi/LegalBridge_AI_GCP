# UIC-13 パリティ精査 — WorkModelPanel → Works 統合の可否と段取り

設計 v1.4 UIC-13「WorkModelPanel の作品ツリー・派生設定を Works へ移植し廃止」の着手前精査。
`WorkModelPanel`（1772 行）を丸ごとリダイレクト＋削除できるか（UIC-10/11 と同型か）を機能パリティで確認した結果。

- 精査日: 2026-07-18
- 対象: `src/pages/master/WorkModelPanel.tsx`（旧・作品モデル）
- 統合先候補: `/works`（`WorksListPanel`）＋ `/works/:id`（`WorkGraphPanel`）、`/master/contracts`（`ContractsPanel`）

## 結論（要点）

**UIC-10/11 のような「素直なリダイレクト＋即削除」は不可。** `WorkModelPanel` は単機能ではなく
**4 つの関心事を同居**させており、UIC-13 の守備範囲はそのうち 1 つ（作品ツリー・派生設定）だけ。
全削除には UIC-13 に加えて他 Issue（UIC-15 契約 / UIC-17 取込）の完了が必要。

したがって UIC-13 は「移植（porting）を伴う中規模スライス」であり、
**①派生設定編集 + 作品ツリーを Works へ移植 → ②契約/取込の重複を解消 → ③リダイレクト＋削除** の順で段階実施する。

## WorkModelPanel が抱える 4 つの関心事とパリティ

| # | 関心事 | WorkModel での機能 | 統合先の現状 | 判定 |
|---|---|---|---|---|
| 1 | **原作IP (source-ips)** | 一覧・詳細（**既に閲覧専用**。新規は Ledgers へ誘導済み） | `/works`＋Ledgers(UIC-14 で read-only) | ✅ 冗長。移植不要 |
| 2a | **自社作品 作成** | スキーマ駆動フォームで新規作成 | `WorksListPanel` の作成ダイアログ | ✅ 充足 |
| 2b | **自社作品 基本情報 編集** | スキーマ駆動フォーム編集（PUT works） | `WorkGraphPanel` の中カード インライン編集（PUT works） | ✅ 充足 |
| 2c | **系譜 / 派生設定 編集** | `parent_work_id`・`derivation_type` を編集（`QuickParentModal` + フォーム項目） | `WorkGraphPanel` は **PUT で値を素通し保持するが編集 UI は無い** | ❌ **GAP（UIC-13 の本丸）** |
| 2d | **作品ツリー表示** | 親→派生の入れ子ツリー（`WorkTree`/`WorkNode`） | `WorksListPanel` はフラット一覧（ツリー無し） | ❌ **GAP（UIC-13 の本丸）** |
| 3 | **契約 (contracts) CRUD** | スキーマ駆動 作成/編集 + サブタブ（当事者/財務/明細/ロイヤリティ） | **`ContractsPanel`（/master/contracts, 2804 行）が正準 CRUD を保有** | ⚠️ 重複。移植不要・削除のみ（UIC-15 の領域） |
| 4 | **CSV 取込** | エンティティ別 CSV 取込（`/api/v3/import/:type`） | `/data-import`(GenericImport) / `/master/bulk-import`(BulkImport) が別方式で存在 | ⚠️ 要確認。おそらく後継で代替（UIC-17 の領域） |

### GAP は 2c・2d の 2 点のみ（UIC-13 の実装対象）

- **2c 派生設定編集**: `WorkGraphPanel` の作品基本情報 編集フォームに `parent_work_id`（作品ピッカー）と
  `derivation_type`（選択）を足すだけ。既に PUT body は両フィールドを送っている（今は素通し）ので、**バックエンド変更ゼロ**。小さい。
- **2d 作品ツリー表示**: `WorksListPanel`（自社作品フィルタ時）に親→派生の入れ子表示を追加、
  もしくは `WorkModelPanel` の `WorkTree`/`WorkNode` を移植。読み取り主体で中規模。

## 全削除を阻む依存（UIC-13 単独では消せない理由）

- **契約タブ（#3）**: `ContractsPanel` が正準なので機能損失は無いが、`WorkModelPanel` 内の契約 UI を
  「消す」判断は UIC-15（契約台帳を /contracts へ）の文脈。UIC-13 では触れないのが筋。
- **CSV 取込（#4）**: `/data-import`・`/master/bulk-import` で代替できるかの実機確認が要る（UIC-17 領域）。

## 推奨する段取り

**段階 A（UIC-13 本体・移植）— admin-ui のみ / バックエンド変更なし / 中規模**
1. ✅ **完了**: `WorkGraphPanel` の作品基本情報 編集に **派生設定（parent_work_id / derivation_type）編集 UI** を追加（GAP 2c）。
   - `DERIV_CHOICES`/`DERIV_LABEL` を移植、編集フォームに派生元 `WorkPicker`（own＋licensed_in、自身除外）＋派生種別 select を追加、
     `saveEdit` を form 値送信へ（PUT works は既に両フィールドを送っていたため**バックエンド変更なし**）、非編集ビューに系譜の読み取り表示を追加。
2. ✅ **完了**: `WorksListPanel`（自社作品）に **親→派生ツリー表示** を追加（GAP 2d、`WorkTree` 移植）。
   - own 作品を `parent_work_id` で入れ子化した折りたたみ「系譜（派生ツリー）」を一覧上部に表示（派生関係があるときだけ）。
     各ノードは `/works/:id` へ遷移、派生種別バッジ付き。
3. ✅ 上記 2 点で「作品ツリー・派生設定」の Works 側パリティが成立 → **設計 UIC-13 の記述（作品ツリー・派生設定の移植）は達成**。

> **段階 A 完了（2026-07-18）**。以後 `WorkModelPanel` を開く固有理由は「契約 CRUD（→UIC-15、ContractsPanel と重複）」「CSV 取込（→UIC-17）」のみ。
> `WorkModelPanel` 物理削除は段階 B（それら 2 Issue の解消後）。

**段階 B（WorkModel 全廃）— ✅ 完了（2026-07-18）**
4. 依存の解消を確認: 契約＝`ContractsPanel`（/master/contracts, 正準 CRUD）で冗長／CSV 取込＝本番 30 日 **使用実績 0**（`/api/v3/import/` ログ 0 件）で撤去可／作品・派生＝段階A で /works へ移植済み／原作IP＝閲覧冗長。
5. ✅ `work-model` を `/works` へ計測付きリダイレクト（`DeprecatedRedirect`）＋ `WorkModelPanel.tsx`（1772 行）物理削除。
   - 補足: バックエンド撤去は **`api` サービス**（worker ではない）。`services/api/src/routes/workModel.ts` の
     `POST /api/v3/import/:entity` ＋ `GET .../template.csv` と、その実装 `workModelImportService.ts`、
     未ルーティングの死活 SSR `workModelHtml.ts` を撤去（別 PR、`release/api` FF でデプロイ）。
     **注意**: 同ファイルの他 60 ルート（`/api/v3/works`・`source-ips`・`graph`・`materials`・`component-lines` 等）は
     新 `/works` React UI が現用のため**保持**。撤去は import 2 ルートのみ。

### 段階 B 依存-2: CSV 取込（UIC-17）後継確認の結果（2026-07-18）

**判定: WorkModel の CSV 取込は「別サーフェスへ機能同等の移設」が要る（完全な後継はまだ無い）。**

| 取込サーフェス | 対象 | 方式 | WorkModel 取込の代替になるか |
|---|---|---|---|
| **WorkModel ImportModal**（撤去検討対象） | source-ips / works / contracts | `GET/POST /api/v3/import/:type`。**ドメイン対応**（コード自動採番・親をコード/作品名で紐付け・親未紐付け警告・dry-run・duplicate_mode・日英ヘッダ） | — |
| `/data-import`（GenericImportPage） | 全テーブル＋互換ビュー（works/source_ips/contracts も DENY 対象外で到達可） | `/api/imports/tables/:name`。**生テーブル**スキーマ駆動・PK/ユニークで upsert・strict/besteffort | △ 同じ**テーブル**は入るが、**ドメイン意味（自動採番・親名リンク・dry-run 警告）は無い** |
| `/master/bulk-import`（BulkImportPanel） | ledgers（原作）＋ work_materials（素材） | `POST /api/master/bulk-import`。文書抽出 / 表貼付 | ✗ works(own)/contracts は非対象 |

**要点:**
- `/api/v3/import/:type` の **UI 消費者は WorkModel の ImportModal のみ**（`src/` 全体で 2 箇所、いずれも WorkModelPanel）。バックエンドのルートは残存。
- `/data-import` は同じ**テーブル**を扱えるが**低レベル（生列）**で、WorkModel 取込の**ドメイン機能（コード自動採番・親をコード/作品名で紐付け・親未紐付け警告）を持たない** → 1:1 の後継ではない。
- したがって **WorkModel を消す前に、この取込を「捨てる／移設する」の意思決定が要る**（プロダクト判断）:
  - (A) ドメイン対応取込は不要と判断 → ImportModal を撤去し `/data-import`（生取込）へ誘導。最小工数で段階 B へ。
  - (B) 必要と判断 → ImportModal（source-ips/works/contracts のドメイン取込）を **Data Maintenance（UIC-17）** か Works 配下へ移設してから WorkModel を削除。中規模。
- **利用実態の裏取り**が判断材料に有効: `DeprecatedRedirect` と同型の計測、または本番ログで `/api/v3/import/` の POST 頻度を確認（ほぼ使われていなければ (A) が妥当）。

## メモ

- 現状 `work-model` ルートは live だが **MasterLayout のナビ項目は既に無い**（コメントのみ）。到達は直 URL / LegacyWorksBanner 経由。
- `WorkModelPanel` の source-ips 部は既に閲覧専用。works 作成・基本編集も既に /works 側にあるため、
  **UIC-13 の実質作業は「派生設定編集 UI」+「作品ツリー表示」の 2 点移植に集約される**。
- 段階 A だけでも「WorkModel を開く必要のある固有機能」は派生系だけになり、実利は高い。
