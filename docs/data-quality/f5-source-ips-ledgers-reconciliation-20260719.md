# F5: source_ips / ledgers ↔ works 統合照合（2026-07-19）

設計 v1.4 Phase F 第5弾「`source_ips`と`works`の統合照合」「`ledgers`を作品・作品群・
カスタム権利根源へ分類移行」「未移行行を Data Quality Issue 化」に対応する**照合記録**。

## 結論

**レガシー原作台帳（`source_ips` / `ledgers`）から `works` への移行は既存 migration
（0033 / 0076）で実質完了済み**。本照合で「真に未移行の行」は **0 件**であることを確認した。
破壊的な再移行は不要。

## 移行経路（既存）

- **`source_ips` → `works`**: `0033_work_unify_p2_1_2.sql` が `source_ips` を
  `works(kind='licensed_in')` として取り込み。対応は `works.legacy_source_ip_id = source_ips.id`
  または `works.work_code = source_ips.source_code`。`0035` にミラートリガあり。
- **`ledgers` → `works`**: `0076_ledgers_to_works_backfill.sql` が `ledgers` を
  `works` へ取り込み（`work_code = ledger_code` 継承）。旧表は非破壊で残置。

## 照合結果（実データ・2026-07-19）

| 表 | 総数 | orphan（work 未対応） | 内訳 |
|---|---|---|---|
| `source_ips` | 13 | 1 | `IP-2026-0001`「テスト」＝テストデータ残骸 |
| `ledgers` | 24 | 3 | `LO-2026-0014`「テスト」/ `LO-2026-0026`「テスト」＝残骸、`LO-2026-0020`「モンスターメーカー」＝**code 不一致（移行済み）** |

### orphan の判定

- **テスト残骸（3 件）**: `IP-2026-0001` / `LO-2026-0014` / `LO-2026-0026`。いずれも title=「テスト」。
  `ledgers` を参照する生きた FK は無し（`materials` は 0090 で撤去済み）。`source_ips` は
  `contract_works.source_ip_id` から参照され得るため、未参照を確認して削除（自己ガード付き）。
- **`LO-2026-0020`「モンスターメーカー」（1 件）**: **未移行ではない**。同名 work が
  `W-2026-0020`…ではなく `W-2026-0008`（`works.id=1000000028`, in_production, is_original）
  として存在。ledger の `work_code`（`LO-…`）と work の `work_code`（`W-…`）が異なるため
  照合式（`work_code = ledger_code`）に掛からなかっただけ。**移行済み・code 差異**として受容。

## 対応

1. **テスト残骸 3 件**: 削除（`ledgers` 14/26 は即、`source_ips` 1000000001 は
   `contract_works` 未参照を確認のうえ）。
2. **モンスターメーカー**: work 実在のため対応不要。ledger は「移行照合専用」の
   `LedgersPanel`（read-only）に残置。
3. **DQ Issue 化**: 真の未移行が 0 件のため、専用 DQ 評価器は追加しない（台帳にルールは残す）。
   将来 legacy 台帳へ新規行が入り、かつ work 未作成のケースが発生した場合に評価器を検討する。

## 残タスク（Phase H 物理撤去で扱う）

- `source_ips` / `ledgers` の**物理撤去**は本 F5 の範囲外。read-mostly レガシーとして残置し、
  参照コード（`LedgersPanel` read-only、文書フォームの `/api/master/ledgers` GET 等）を
  新モデルへ寄せ切った後に Phase H で DROP する。
