# ランブック: ledgers → works バックフィル（設計 §8 #4）

対象移行: [`migrations/0076_ledgers_to_works_backfill.sql`](../migrations/0076_ledgers_to_works_backfill.sql)
関連設計: [work-3card-unified-editor-spec.md](design/work-3card-unified-editor-spec.md) §8 #4 / work-source-ip-unification.md

## 目的
純 ledger 由来（原作台帳=LedgersPanel で直接作成）の LO- 原作を `works(kind='licensed_in')` へ取り込み、
`/works`（作品管理）一覧に**全原作**を表示できるようにする。`materials` も `work_materials` へ移送。
additive・冪等。旧表（ledgers/materials）は**削除しない**。

## 前提
- 0075 まで適用済み（works/work_materials に LO 再採番・素材コード補完が入っている）。
- 採番統一済み（api `source-ips` と worker `getNewLedgerCode` が `ledgers ∪ works` の max+1 で LO 発番）。

## 手順

### 1. ドライラン（適用前の件数把握）
```sql
-- 取り込み対象(works 未登録の ledger)
SELECT COUNT(*) AS ledgers_to_import
  FROM ledgers l
 WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);

-- 取り込み対象 materials
SELECT COUNT(*) AS materials_to_import
  FROM materials m
  JOIN ledgers l ON l.id = m.ledger_id
 WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);

-- 念のため: 既に works にある LO 件数(skip される分)
SELECT COUNT(*) AS already_in_works FROM ledgers l
 WHERE EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);
```

### 2. 適用
```bash
cd migrations
npm install          # 初回のみ
npm run migrate      # run.mjs が schema_migrations 基準で 0076 を1トランザクションで適用
```
> 1 ファイル = 1 トランザクション。失敗時は自動 ROLLBACK。

### 3. 検証（適用後）
```sql
-- 取り込み残がゼロ(全 ledger が works に存在)
SELECT COUNT(*) AS remaining FROM ledgers l
 WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.work_code = l.ledger_code);   -- => 0 期待

-- works(licensed_in) 件数 ≥ ledgers 件数
SELECT (SELECT COUNT(*) FROM works WHERE kind='licensed_in') AS works_source,
       (SELECT COUNT(*) FROM ledgers) AS ledgers_total;

-- 素材の取り込み残
SELECT COUNT(*) FROM materials m JOIN ledgers l ON l.id=m.ledger_id
  JOIN works w ON w.work_code=l.ledger_code AND w.kind='licensed_in'
 WHERE NOT EXISTS (SELECT 1 FROM work_materials wm WHERE wm.material_code=m.material_code); -- => 0 期待
```
- admin-ui の `/works` で「原作」フィルタに全原作が出ること。
- 既存の `/api/v3/source-ips`（= works licensed_in 読取）に取り込み分が出ること。

## 移行後の回帰防止（重要）
`LedgersPanel`（原作台帳）の新規作成は現状 **ledger のみ**作成し works を作らないため、放置すると
ギャップが再発する。次のいずれかで塞ぐこと（推奨は上から）:
1. **原作作成を `/works` に一本化**（推奨）: `LedgersPanel` の新規作成ボタンを無効化/非表示にする（フロントのみ）。作成は作品管理（api `source-ips`= works+ledger ミラー両作成）に集約。
2. worker のレジャー作成ハンドラに works(licensed_in) ミラー作成を追加（api と対称化）。
3. 物理廃止フェーズで `LedgersPanel`/`ledgers` 自体を撤去。

## ロールバック
- 本移行は additive（INSERT のみ）。問題時は取り込んだ works/work_materials を削除する逆移行を別途用意:
```sql
-- 例(慎重に): 0076 で作られた licensed_in works とその素材を消す
--   ※ legacy_code IS NULL かつ ledger ミラー由来のみを対象にするなど、条件は要精査。
```
- 旧表は無傷なので、最悪 works(licensed_in) の該当分を削除すれば原状復帰可能。**実運用前に削除条件をレビューすること。**

## 残（物理廃止フェーズ）
- `ledgers` / `materials` の DROP は本移行の対象外。デュアルリード期間を経て、参照（condition_lines.ledger_code 等）の撤去後に別移行で実施。
