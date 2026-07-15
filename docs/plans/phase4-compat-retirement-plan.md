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

### 残り 57 箇所の内訳（次スライスの対象）

| 操作 | 件数 | 変換難度 |
|---|---|---|
| capability_line_items (INS 4 / UPD 8 / DEL 6) | 18 | 中〜高: cli_* トリガ移植(line_no+1000 / scheme / direction / cl_next_code) |
| capability_financial_conditions (INS 6 / UPD 6 / DEL 7) | 19 | 中〜高: cfc_* トリガ移植(scheme別の rate/mg/ag/amount CASE) |
| capability_expenses (INS 4 / DEL 6) | 10 | 中: exp_* トリガ移植(line_no+3000 / legacy_role='expense') |
| capability_other_fees (INS 4 / DEL 6) | 10 | 中: fee_* トリガ移植(line_no+2000 / legacy_role='other_fee') |

DELETE 系(計 19)は `cl_view_del`(単純に condition_lines を id で DELETE)のため
`DELETE FROM condition_lines WHERE id = …` への置換で足りるが、WHERE 句が
view 列(capability_id 等)を参照する場合は legacy_role 条件の付与が必要。

読取り(FROM/JOIN)は **309 箇所**(Phase 7 対象。書込みゼロ達成後に着手)。

## 3. 撤去ゲート（計画 §10 の具体化）

| ゲート | 条件 | 確認方法 |
|---|---|---|
| G1: 書込みゼロ | `compat_view_refs.sh` の writes=0 | CI: `--gate-writes 0` |
| G2: INSTEAD OF トリガ撤去 | G1 達成後、cc_compat_ins / cfc_* / cli_* / exp_* / fee_* を DROP | migration |
| G3: 読取りゼロ | reads=0(SELECT を documents / condition_lines 直読みへ) | CI |
| G4: VIEW 撤去 | G3 達成 + 本番クエリログで一定期間アクセスなし | migration + pg_stat |
| G5: 二重書込み解消 | `trg_sync_*`(contracts/cft/cli/payments/royalty_statements)を新旧照合のうえ DROP | Phase 5 と連動 |

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
