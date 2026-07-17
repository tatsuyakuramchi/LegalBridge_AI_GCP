# Phase 4 互換レイヤー撤去計画（LB-12: 依存メトリクスと撤去ゲート）

> 修正計画書 [`legalbridge-remediation-plan-20260714.md`](./legalbridge-remediation-plan-20260714.md)
> §9 Phase 4「DB安定化」/ Phase 7「レガシー撤去」の実行管理。
> 計測は [`scripts/audit/compat_view_refs.sh`](../../scripts/audit/compat_view_refs.sh) を正とする。

| 項目 | 内容 |
|---|---|
| 対象 | 互換VIEW `contract_capabilities` / `capability_financial_conditions` / `capability_line_items` / `capability_expenses` / `capability_other_fees`(0101) と INSTEAD OF トリガ、二重書込み `trg_sync_*` |
| 方針 | ①書込みを実体表(documents / condition_lines)直書きへ移行(Phase 4) → ②読取りを移行し VIEW・トリガを削除(Phase 7) |
| 作成日 | 2026-07-15 |

## 1. VIEW → 実体表のマッピング(変換ルール)

### 1.1 `contract_capabilities` → `documents`（1:1）

0101 で `contract_capabilities` は **documents の単純 SELECT ビュー(1:1・計算列なし)** になった。

| 操作 | 変換 | 難度 |
|---|---|---|
| `UPDATE cc SET … WHERE …` | **`UPDATE documents` への純リネーム**。INSTEAD OF UPDATE トリガは無く自動更新ビューとして base 表を直接更新していたため、意味論は完全に等価(documents 上のトリガ発火含め同一) | 低（機械的） |
| `DELETE FROM cc WHERE …` | 同上、**`DELETE FROM documents` への純リネーム** | 低（機械的） |
| `INSERT INTO cc (…)` | `cc_compat_ins` トリガの意味論の移植が必要: <br>① NOT NULL 既定(issue_key ''/template_type=COALESCE(contract_type,'')/form_data '{}'/drive_link=COALESCE(document_url,''))<br>② `ON CONFLICT (document_number) DO UPDATE SET 各列 = COALESCE(EXCLUDED.列, documents.列)`(NULL は既存値を保持するマージ)<br>③ `RETURNING id` | 中（サイト毎にレビュー） |

### 1.2 `capability_*` → `condition_lines`（legacy_role 別）

`capability_financial_conditions`(cfc) / `capability_line_items`(cli) / `capability_expenses`(exp) /
`capability_other_fees`(fee) は condition_lines を `legacy_role` で絞ったビュー。
INSERT/UPDATE/DELETE すべて INSTEAD OF トリガ(`cfc_*` / `cli_*` / `exp_*` / `fee_*`)が
列名変換・`legacy_role` 付与・`cl_next_code`(ラインコード採番)・`cl_dir`/`cl_scheme` 等の
ヘルパを適用して condition_lines へ書く。

→ 直書き化はトリガ関数(0101 §7)の**読み替え表を作ってからサイト毎に移植**する。
純リネーム不可。共通ヘルパ(`services/worker/src/lib/conditionWrite.ts` が既に一部を担う)へ
寄せるのが望ましい。

## 2. 進捗（書込み箇所数）

計測: `scripts/audit/compat_view_refs.sh`（`--gate-writes N` で CI ゲート可能）

| 時点 | 書込み計 | 内訳 |
|---|---|---|
| Phase 0 基準(2026-07-14) | **102** | cc: UPDATE 22 / DELETE 5 / INSERT 17、capability_*: 58 |
| Phase 4 第1弾(2026-07-15) | **75** | cc UPDATE/DELETE **27箇所を documents 直書き化**(純リネーム)。<br>付随して「cc↔documents の版同期 UPDATE」(1:1ビュー化後は自己代入の無駄撃ち)2箇所を撤去 |
| Phase 4 第2弾(2026-07-15) | **57** | cc INSERT **18箇所を documents 直書き化**。cc_compat_ins の意味論を各サイトへ移植:<br>① template_type=COALESCE(contract_type,'') / drive_link=COALESCE(document_url,'') を明示付与<br>② revision / is_primary / lifecycle_status を NULL 明示(documents の列デフォルト 0/TRUE/'final' がトリガ経路の NULL 挿入と食い違うため)<br>③ document_number 提供時は ON CONFLICT (document_number) DO UPDATE SET 提供列=COALESCE(EXCLUDED.列, documents.列), updated_at=now()<br>→ **contract_capabilities への書込みはゼロ達成**(tg_cc_ins は撤去可能状態。G2 は capability_* 完了後に一括で) |

| Phase 4 第3弾(2026-07-15) | **18** | capability_* の DELETE 25箇所 / UPDATE 14箇所を condition_lines 直書き化。<br>変換ルール: WHERE へ legacy_role 条件付与(cfc/cli/expense/other_fee)、view line_no のオフセット逆変換(cli:+1000/fee:+2000/exp:+3000)、flow_direction(in/out)→direction(payable/receivable)、cfc の大型更新は cl_scheme()/cl_resolve_work() で cfc_upd の CASE 意味論を再現(応答形はビュー再読取で互換維持)。<br>**判明した休眠バグの修復を含む**: cli_upd トリガが status_flags / is_inbound を SET 対象にしておらず、検収済フラグ(inspection_issued)や状態フラグ保存がビュー経由では永続化されていなかった → 直書きで本来の意図どおり保存される。また view の NULL 計算列(last_alert_at / alert_count / source_ip_id / basis / advance・forecast_amount 等)への書込みは実体列が無く元々無効のため削除(コメントで明記) |

| Phase 4 第4弾(2026-07-16) | **0 — G1 達成** | INSERT capability_* **18箇所を condition_lines 直書き化**。cfc_ins / cli_ins / exp_ins / fee_ins の意味論を移植:<br>① line_no オフセット(cli:+1000 / fee:+2000 / exp:+3000、cfc はそのまま)<br>② line_code = 既存 (document_id,line_no) の code 温存 or `cl_next_code()`(COALESCE+サブクエリで遅延評価)<br>③ direction = `cl_dir(capability_id)`、scheme = `cl_scheme()` / SUBSCRIPTION 判定、royalty 以外の rate/mg/ag NULL 化、amount_ex_tax 導出<br>④ ON CONFLICT (document_id, line_no) DO UPDATE(トリガと同一の SET 列)<br>⑤ ビュー行を返していた API は RETURNING id + ビュー再読取で応答形を互換維持<br>付随修復: copied_from_condition_id(0083 実列だが 0101 ビューで NULL 計算列化され保存されず)を実列へ復元。トリガ無視の NULL 計算列(region_language_label / fee_type / royalty_calc_basis / basis / advance・forecast_amount / rate_pct(cli))は除去 |

## 2.1 G1 達成後の次ステップ

- **G2(トリガ撤去)**: `tg_cc_ins` / `tg_cfc_*` / `tg_cli_*` / `tg_exp_*` / `tg_fee_*` の DROP は
  本スライスのデプロイ後、監査期間(計画 §10 の 6)を置いてから migration で実施。
- **CI ゲート(済 2026-07-16)**: `scripts/audit/compat_view_refs.sh --gate-writes 0` を
  cloudbuild-worker.yaml / cloudbuild-api.yaml の先頭ステップ(`gate-compat-writes`)に組み込み済み。
  書込みが 1 箇所でも再発したらデプロイ前にビルドが止まる。スクリプトは rg 不在環境
  (Cloud Build の cloud-sdk イメージ等)では GNU grep -E にフォールバックする。
- **cl_* ヘルパ関数**(cl_dir / cl_scheme / cl_next_code / cl_resolve_work)は直書き SQL が
  参照し続けるため G2 では削除しない(インライン化は Phase 7 で検討)。

読取り(FROM/JOIN)は **309 箇所**(Phase 7 対象。書込みゼロ達成後に着手)。

## 3. 撤去ゲート（計画 §10 の具体化）

| ゲート | 条件 | 確認方法 |
|---|---|---|
| G1: 書込みゼロ | `compat_view_refs.sh` の writes=0 | CI: `--gate-writes 0` |
| G2: INSTEAD OF トリガ撤去 | G1 達成後、cc_compat_ins / cfc_* / cli_* / exp_* / fee_* を DROP | **達成(2026-07-16, migration 0131)**。トリガ15本+関数10本を DROP、cl_* ヘルパとVIEWは温存。詳細は phase7-legacy-retirement-plan.md |
| G3: 読取りゼロ | reads=0(SELECT を documents / condition_lines 直読みへ) | CI |
| G4: VIEW 撤去 | G3 達成 + 本番クエリログで一定期間アクセスなし | migration + pg_stat |
| G5: 二重書込み解消 | `trg_sync_*`(contracts/cft/cli/payments/royalty_statements)を新旧照合のうえ DROP | **達成(2026-07-16, migration 0130)**。contracts/cft/cli 系は 0101 の DROP CASCADE で消滅済みと判明(孤児関数のみ 0130 で DROP)。payments/royalty_statements 系は読み手を正本へ切替のうえ 0130 で DROP。詳細は phase5-contract-finance-plan.md |

## 4. 注意事項・要決定

- **`services/worker/src/lib/db.ts` のレガシー起動DDL**: `RUN_INIT_DB=true` 時のみ実行される
  旧 `ALTER TABLE contract_capabilities ADD COLUMN …` が残存(0101 以降は VIEW のため実行すると
  エラーになる死コード)。本番は migration ランナーが単独所有(D2)のため無害だが、Phase 7 で
  ブロックごと削除する。
- **LB-11(form_data 不変化)の要決定**: 計画 §9 Phase 4 は「form_data は発行後更新しない。編集は
  revision 追加」とするが、現行の**内部修正**(Phase 23.1: 同 row 上書き・同番号維持)と衝突する。
  選択肢: (a) 内部修正を廃止し常に revision 採番 / (b) 内部修正は「発行日当日のみ」等に制限 /
  (c) 現状維持で LB-11 は audit_events による変更履歴記録に読み替え。**運用判断が必要**。
- 直書き化で挙動が変わらないことの確認観点: documents 上のトリガ(autolink / auto_category /
  trg_sync_*)は VIEW 経由でも直書きでも同様に発火するため、リネーム変換では差が出ない。
  INSERT 変換時のみ ON CONFLICT マージ意味論の再現をレビューすること。
