# データ構造刷新 — 本番移行ランブック

作成日: 2026-06-11
対象ブランチ: `claude/recent-push-execution-dp9hto`
上位文書: `condition_lines_unification_design.md` / `condition_lines_implementation_plan.md`

このランブックは、実装済みの統一条件明細(condition_lines)スキーマへ本番データを
安全に移行するための「実行順・前提・ゲート」をまとめたもの。コードは expand/contract で
書かれており、**いつ実行しても無回帰**(新スキーマ未適用なら旧テーブルにフォールバック)。

---

## 0. 全体像 — 何が実装済みで、何がゲート待ちか

| 区分 | 状態 |
|---|---|
| 新スキーマ DDL (condition_lines/events/works 等) | ✅ initDb で冪等作成 (追加のみ・既存無影響) |
| バックフィル (C-1〜C-4 + E-2a) | ✅ スクリプト実装 (dry-run既定・冪等) |
| 二重書き込み (C-5) | ✅ 検収/計算/契約登録に配線 (非致命) |
| 導出ビュー (D-1) + 既知バグ修正 (D-2) + void対応 (D-3) | ✅ |
| void/reissue API (E-1) + 支払イベント (E-3) | ✅ |
| 条件明細管理 UI (F) | ✅ `/condition-lines` |
| 読み取りの新スキーマ優先化 (E-2 dual-read) | ✅ 値消費型 + 表示系8リーダー (coverage-gated) |
| 制約強化 (G-1) | ⏸ ゲート付きスクリプト (データ補正後に実行) |
| 旧テーブル DROP / 書き込み停止 (E-2収縮 / G-2〜G-6) | ⏸ レディネス監査が全GO + 参照ゼロ後 |
| 状態の意味的移行 (inspection_issued 等) | ⏸ プロダクト判断 + アプリ実行検証が必要 |
| 作品モデル/受取マップ連結 (source_ip_id/work_id) | ⏸ 設計判断が必要 |

---

## 1. 移行の実行順 (バックフィル)

一括ドライバを使う (各スクリプトは冪等・依存順):

```bash
# 1. まず dry-run で件数・差分を確認
DATABASE_URL=... tsx scripts/restructure_run_all.ts

# 2. 問題なければ apply
DATABASE_URL=... tsx scripts/restructure_run_all.ts --apply
```

ドライバが実行する工程 (依存順):

1. **C-1** `restructure_c1_contract_roles` — record_type→structural_role, category/allowed→contract_scopes, template_family, form_data→parent_capability_id
2. **C-2** `restructure_c2_condition_lines` — 旧明細→condition_lines (A案: master直付け条件は暗黙terms契約に切出し), line_code採番
3. **C-3** `restructure_c3_condition_events` — 旧実績→condition_events, document_id解決 (解決不能は保留CSV)
4. **C-4** `restructure_c4_works` — sublicensees→vendors, work_sublicensees→works+受取明細
5. **E-2(a)** `restructure_e2a_display_columns` — 表示列(spec/category/.../source_seq_no/fee_type)を旧テーブルから再backfill
6. **D-5** `restructure_d_verify` — 旧ロジック vs 新ビューの突合 (読み取りのみ)
7. **レディネス監査** `restructure_readiness_audit` — 破壊的ステップの GO/NO-GO 判定 (読み取りのみ)

> ⚠ C-3 の保留 (document_id 解決不能) は `restructure_reports/c3_held_*.csv` に出る。
> 件数次第で手動対応。C-1 の mixed 契約・scope 0 件・親未解決も同 reports に出る。

個別実行も可 (例: `tsx scripts/restructure_c2_condition_lines.ts --apply`)。

---

## 2. バックフィル後の検証

- `restructure_run_all.ts` 末尾の **D-5 突合** が「consumed/MG残 差分 0」であること。
  - `fulfilled 差分` は既知バグ(部分検収の全量誤判定)の解消件数。中身を確認。
- **レディネス監査** で各破壊的ステップの GO/NO-GO を確認:
  - `E-2 / G-4` が 🟢 GO = 全旧行に対応する新行あり (データ整合)。
  - `G-2` は balance_v が `mg/ag_consumed_this_time` に依存する間は 🔴 NO-GO (要コード変更)。

---

## 3. 制約強化 (G-1) — データ補正後に実行

バックフィルが完走し structural_role 等が埋まったら:

```bash
DATABASE_URL=... tsx scripts/restructure_g1_constraints.ts          # 検証のみ
DATABASE_URL=... tsx scripts/restructure_g1_constraints.ts --apply   # 適用
# term_start 欠落があり NOT VALID で進める場合のみ:
DATABASE_URL=... tsx scripts/restructure_g1_constraints.ts --apply --force
```

適用内容: structural_role 自動補完トリガ + NOT NULL/CHECK、cl_scheme_recurring_term
CHECK、「terms のみ condition_lines」「parent は master のみ」トリガ。
**initDb には入っていない** (未移行環境を壊さないため)。

---

## 4. ⏸ 破壊的・意味的フェーズ (このランブックの範囲外 / 前提つき)

以下は **レディネス監査が全GO + 下記前提** を満たしてから、個別に慎重に実施する。

### 4.1 旧テーブル DROP / 書き込み停止 (E-2収縮 / G-4 / G-6)
- 前提: 監査の `E-2/G-4` が GO **かつ** 旧テーブルを参照する読み取りコードがゼロ。
- 現状の読み取りは dual-read の **coverage 安全ゲート**でのみ旧テーブルを参照
  (件数確認)。DROP 前に、このゲート (`= (SELECT COUNT(*) FROM capability_* ...)`)
  と残存する直接参照を grep で洗い出してゼロにする:
  ```bash
  grep -rn 'capability_line_items\|capability_financial_conditions' services/ src/
  ```

### 4.2 G-2 (royalty_calculations.mg/ag_consumed_* 列 DROP)
- 前提: `condition_line_balance_v` を detail(mg_consumed_this_time)依存から
  **イベント金額ベースの再計算**へ切替え、監査の G-2 が GO になること。

### 4.3 状態の意味的移行 (inspection_issued / 一覧集計)
- `status_flags.inspection_issued` は「全額検収(±0.5円)で自動ON」**または「手動ON」**で
  立つ (worker/server.ts の検収保存時)。新モデル(condition_events / status_v='fulfilled')
  では **手動フラグ・端数許容を再現できない**ため、バイト同値の機械変換は不可。
- 進めるには **プロダクト判断**(手動フラグを廃止するか/端数許容をどうするか)と
  **アプリ実行での挙動突き合わせ**が必須。
- 該当: contractsV2 の契約詳細 line_items (`inspection_issued`) と一覧集計
  (`inspected_amount` / `unissued_line_count`)。

### 4.4 作品モデル/受取マップ連結
- workModel / receivableMapService は `source_ip_id` / `work_id` (line item側) /
  `source_work_id` / `source_material_id` という **feature 固有の連結列**を使う。
  これらは condition_lines に無い。変換するなら「この連結を works/condition_lines
  モデルでどう表現するか」の **設計判断**が先。

---

## 5. ロールバック / 安全性

- バックフィル系は全て `--apply` のみ書き込み・単一トランザクション・冪等。失敗時 ROLLBACK。
- 読み取りの新スキーマ優先化は coverage-gated dual-read。**新スキーマが不完全/未作成なら
  自動的に旧テーブルにフォールバック**するため、バックフィル前でも無回帰。
- 二重書き込み (C-5) は `safeSync` で包まれ、失敗しても本体処理を止めない。
- void で残高は導出集計のため自動復元 (E-1)。
