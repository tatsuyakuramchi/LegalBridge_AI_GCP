# Phase 7 レガシー撤去 実行計画（互換VIEW・トリガ・旧テーブル参照の削除）

> 修正計画書 [`legalbridge-remediation-plan-20260714.md`](./legalbridge-remediation-plan-20260714.md)
> §9 Phase 7 / §10「互換VIEW撤去基準」の実行管理。
> 撤去ゲート G1〜G5 は [`phase4-compat-retirement-plan.md`](./phase4-compat-retirement-plan.md) §3 で定義。
> 計測は [`scripts/audit/compat_view_refs.sh`](../../scripts/audit/compat_view_refs.sh) を正とする。

| 項目 | 内容 |
|---|---|
| 目的 | 互換VIEW(contract_capabilities / capability_*)・INSTEAD OF トリガ・旧テーブル名参照をゼロにして削除する |
| 前提 | G1(書込みゼロ)達成済・CIゲート稼働。G5(trg_sync_*/ミラー表)撤去済(Phase 5) |
| 作成日 | 2026-07-16 |

## 1. 現状(2026-07-16)

`compat_view_refs.sh`: **writes=0 / reads=282**。読取りの内訳:

| VIEW | 実体 | 読取り件数 | 移行難度 |
|---|---|---|---|
| `contract_capabilities` | `documents`(WHERE 無しの 1:1 passthrough) | 165 | 低(ほぼ純リネーム) |
| `capability_financial_conditions` (cfc) | `condition_lines` WHERE legacy_role='cfc' + 列リマップ | 50 | 高(列マッピング) |
| `capability_line_items` (cli) | `condition_lines` WHERE legacy_role='cli' + 列リマップ | 59 | 高 |
| `capability_expenses` (exp) | `condition_lines` WHERE legacy_role='expense' | 4 | 中 |
| `capability_other_fees` (fee) | `condition_lines` WHERE legacy_role='other_fee' | 4 | 中 |

## 2. 撤去ゲートと本Phaseのスライス

| ゲート | 内容 | スライス | 状態 |
|---|---|---|---|
| G2 | INSTEAD OF トリガ(tg_cc_ins/tg_cfc_*/tg_cli_*/tg_exp_*/tg_fee_*)と その関数を DROP。書込みゼロ(G1)が前提。VIEW と cl_* ヘルパは残す | 第1弾(migration 0131) | 実装済(2026-07-16) |
| G3a | `contract_capabilities` 読取り 165 を `documents` 直読みへ(1:1 passthrough のため原則リネーム) | 第2〜9弾(ファイル単位) | **完了(2026-07-16)**: 165→0。全体 reads 282→117(残は capability_* のみ)。第8弾 contractCheckService(8)+lc.*(2)→125、第9弾 sharedReads/contractsV2/api-server の cc.* 5箇所を互換view列(78列)へ明示展開 + named 3箇所 rename →117。view(subset)→documents(superset)は列参照を壊さず、cc.* は form_data 等の余分列混入を避けるため明示展開した。ratchet 117。 |<br>※ dataLinkage の documents-vs-cc ドリフトprobe は cc==documents のため自己比較(版family)に等価化。件数挙動は不変だが、将来 probe 自体の要否を見直す(TODO) |
| G3b | `capability_*` 読取り 117 を `condition_lines`(legacy_role + 列マッピング)直読みへ | 第1〜3弾 | **完了(2026-07-17)**: 117→0。第1弾 expenses/other_fees(8)→109。第2弾 小中ファイル(conditionSync 到達不能コード削除/importsV2/dataLinkage/conditionsService/receivableMapService/sharedReads)→80、cfc/cli 互換射影を worker `src/lib/compatViewSql.ts` に共有化。receivableMapService は cfc view が NULL 固定していた `condition_kind`/`source_ip_id` を実体列直読みへ是正(0116/0064 の設計意図・workModel 前例に準拠、再許諾受領マップの潜在バグ解消)。第3弾 大ファイル(workModel/worker server/api server/contractsV2)80→0、api 側にも compatViewSql 配置、派生テーブル別名欠落6件是正。formReadRoutes は生成元乖離のため直接手修正。ratchet 0。 |
| G4 | 読取りゼロ達成 + 本番クエリログで一定期間アクセス無しを確認し VIEW を DROP | 最終(migration 0134) | **準備完了・ソーク待ち(2026-07-17)**: `migrations/0134_drop_compat_views.sql` 作成(互換VIEW 5本を RESTRICT で DROP、可逆)。稼働サービス参照 0・DB依存 0 を確認済み。G3b デプロイ後の本番で一定期間 VIEW アクセス無しを確認してから merge/デプロイする。cl_* ヘルパは残す |
| — | 旧起動DDL(RUN_INIT_DB/initDb)ブロック削除 | 仕上げ(第10弾) | **完了(2026-07-16)**: worker/api の initDb()(計2320行の起動時レガシー DDL)と worker の RUN_INIT_DB 分岐・import を撤去。schema は migrations/ が単一所有。0101 以降 contract_capabilities は VIEW のため旧 ALTER 群は死コードだった |
| — | cl_* ヘルパのインライン化検討 | 仕上げ | **検討完了=非インライン化(2026-07-17)**: cl_scheme/cl_dir/cl_resolve_work/cl_next_code は 0101 以降の condition_lines 直書きパスが共有する現行ヘルパ(レガシー互換物ではない)。特に cl_next_code は sequence 採番(INSERT..ON CONFLICT..RETURNING)の副作用を持ち、INSERT の VALUES 内スカラとしてインライン化不可(65 サイトを data-modifying CTE へ再構成は高リスク・低便益)。よって**据え置き(保持)**を決定。将来 conditionWrite.ts と DB 側の二重定義を1本化する検討は別途 |
| — | 旧設計書(runbook/manual)の Matter 中心更新 | 仕上げ | **一次更新完了(2026-07-17)**: system-overview / operation-manual の (1) admin-ui 通信を Phase 6 BFF プロキシ(apiRoutingRules)へ訂正・旧 apiRouter monkey-patch を休眠と明記、(2) データモデルの SSOT 刷新(documents + condition_lines、capability_*/contract_capabilities は互換VIEW で Phase 7 に読取り撤去・G4 で DROP、sublicense は condition_kind+condition_receipts)、(3) 業務起点=Matter を追記。ER 図/表の逐次書換は次段 |
| — | formReadRoutes の生成元乖離解消 | 仕上げ | **完了(2026-07-17)**: 生成元 api/server.ts が form-context を helper(readCapability*ForDisplay)呼び出しへ改修済で生成物が旧インライン版から乖離していた。generator を「helper 定義も生成モジュール内へ同梱」するよう改修し再生成、worker で自走可能・api と同期。tsc 通過・compat_view_refs reads=0 |

## 3. 変換ルール(読取り)

### 3.1 `contract_capabilities` → `documents`（G3a, 原則リネーム）

0101 で `contract_capabilities` は `SELECT <列> FROM documents`(**WHERE 無し**)の
1:1 passthrough ビュー。列名は documents と同一。したがって:

- `FROM contract_capabilities x` / `JOIN contract_capabilities x` → `FROM documents x` / `JOIN documents x`
  (別名を温存すれば下流は無改修)。**意味論は完全に等価**(cc==全 documents)。
- 例外: `SELECT * FROM contract_capabilities` はビューの列サブセットを返すのに対し
  `SELECT * FROM documents` は documents 全列(スーパーセット)を返す。呼び出し側が
  行を named field で読む限り無害だが、行全体を再利用/キー列挙する箇所は
  明示列 SELECT へ書き換える(要レビュー箇所: contractCheckService 等の `SELECT *`)。

### 3.2 `capability_*` → `condition_lines`（G3b, 列マッピング）

各 VIEW は condition_lines を `legacy_role` で絞り、旧 capability 列名へリマップする。
読取り移行は 0101 §7 のビュー定義を読み替え表として、サイト毎に:

- WHERE に `legacy_role = 'cfc'|'cli'|'expense'|'other_fee'` を付与。
- view の line_no は実体 condition_lines の line_no にオフセットが乗る
  (cli:+1000 / fee:+2000 / exp:+3000)。表示用 line_no が必要なら逆算。
- 旧列名 → condition_lines 実列名(direction/scheme/amount_ex_tax 等)へ読み替え。
- 共通の読取りヘルパ(`conditionLineMapper.ts` 等)へ寄せて重複を避ける。

## 4. 撤去前後の照合(計画 §10)

VIEW 削除の前後で以下が一致することを確認する(G4 の受入):

- documents 件数、capability_* 由来の condition_lines 件数(legacy_role 別)。
- 主要金額(amount_ex_tax 合計、cfc の rate/mg/ag)。
- 文書番号集合、条件明細の (document_id, line_no) 集合。
- 主要業務シナリオ(発注→検収→請求、ライセンス条件登録)が新参照のみで完結。

## 5. G2(第1弾)メモ — migration 0131

- DROP 対象トリガ(15本): tg_cc_ins / tg_cfc_ins,upd,del / tg_cli_ins,upd,del /
  tg_exp_ins,upd,del / tg_fee_ins,upd,del。
- DROP 対象関数(10本): cc_compat_ins / cfc_ins,upd / cli_ins,upd / exp_ins,upd /
  fee_ins,upd / cl_view_del。
- **残す**: 互換VIEW 5本(読取りが 282 残るため)、cl_* ヘルパ(cl_dir/cl_scheme/
  cl_next_code/cl_resolve_work — Phase 4 直書き SQL が 65 箇所で使用)。
- 効果: 互換VIEW への書込みは物理的に不可能になる(auto-updatable でない capability_*
  は書込みでエラー)。書込みは既に CI ゲートで 0。**互換*書込み*層の完全撤去**。
- 可逆性: 0101 のトリガ/関数定義を再適用すれば復元可能。
