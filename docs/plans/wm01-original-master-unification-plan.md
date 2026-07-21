# WM-01 原作マスタ統合（ledgers / source_ips 撤去）計画

原作（原著作物）の正本を `works(kind='licensed_in')` へ一本化し、旧 `ledgers` /
`source_ips` テーブルを最終的に DROP する。ledgers は `work_code = ledger_code`
で works と紐付く互換ブリッジとして残置し、参照を段階的に付け替えてから撤去する。

## 前提・不変量

- **id 空間は分離**: `works.id` は 10 億オフセット採番、`ledgers.id` は小さい連番。
  混在した保存済み FK（`documents.ledger_ref_id` 等）でも衝突なく解決できる。
- **解決の使い分け**:
  - 新一覧 id（= works.id）由来 → `resolveLicensedInWork()`（works 優先）
  - 保存済み FK（ledgers.id 主・works.id 混在）→ `resolveLedgerRef()`（ledgers 優先）
- **§20**: 既存挙動を壊さない。破壊的操作（DROP）は Phase E で人間承認のうえ実施。

## フェーズと状態

| Phase | 内容 | サービス | 状態 |
|---|---|---|---|
| A′ | 素材 write を ledgers.id∪works.id 両対応（`resolveLicensedInWork`） | worker | ✅ live |
| A | 原作一覧を works 由来へ（read superset / rollback 経路） | search-api | ✅ live |
| B | 原作解決 read 4 箇所＋bulk-export を両対応（`resolveLedgerRef`） | worker | ✅ live |
| C | 実アプリの原作一覧（既定 `API_READS_TO_WORKER=1`=worker）を works 由来へ | worker | ✅ live |
| **D** | **CI ラチェット（source_ips=0 凍結・ledgers write/read 据え置き）** | CI | ✅ 済 |
| **E-code** | **ledgers write/read のコード付替（write 7→0 / read 16→2）** | worker/api | ✅ 済 |
| E-verify | 本番で `documents.ledger_ref_id` に ledgers.id 残存が無いことを確認 | prod SQL | ✅ 0 件 |
| E-final-① | resolver フォールバック撤去（read 2→0・コードから ledgers 参照 0） | worker | ✅ 済 |
| E-final-② | `DROP source_ips` / `DROP ledgers`（migration） | migration | ⏸ 要人間承認（破壊的） |

デプロイ順の制約: B は後方互換のため A と同時か先に。A 単独先行は degrade 窓を作る。

## Phase D ラチェット（`scripts/audit/legacy_master_refs.sh --gate S W R`）

Cloud Build（`cloudbuild-worker.yaml` / `cloudbuild-api.yaml`）で計測し、上限超過でビルドを止める。

| カテゴリ | 上限（現状） | 意味 | 目標 |
|---|---|---|---|
| source_ips | 0 | `(FROM/JOIN/INTO/UPDATE/DELETE) source_ips` の SQL アクセス | 0 維持 |
| ledgers_write | 0 | `(INSERT/UPDATE/DELETE) ledgers` | 0 維持 |
| ledgers_read | 2 | `(FROM/JOIN) ledgers` | E-final で 0 |

**運用**: works へ付け替えて参照を減らしたら、この上限も同時に下げる（増加は不可）。

### E-code で付け替え済み（write 7→0 / read 16→2）

- write(7→0): createLedger の ledgers INSERT / workModel stub INSERT+DELETE /
  旧 master PUT・DELETE（works 直接更新・削除へ）/ bulk-import UPDATE / entityMerge DELETE。
- read(16→2): 診断メトリクス→works / LO 採番 UNION→works 単独 / bulk-import lookup→works /
  entityMerge の ledger_ref_id 付替を works.id 直接へ / 旧 master PUT サブクエリ撤去。

### 残り 2 read（E-final の撤去対象）

`services/worker/src/lib/db.ts` の `resolveLicensedInWork` / `resolveLedgerRef` の
**ledgers フォールバック tier**。`documents.ledger_ref_id` は 0101 で `REFERENCES works(id)` の
FK になっており値は works.id のはずだが、FK が `IF NOT EXISTS` 追加のため未強制の可能性が残る。
**E-verify（下記 SQL）で ledgers.id 残存が 0 と確認できたら**、この 2 tier を撤去して read=0 にする。

```sql
-- ledger_ref_id に ledgers.id 空間（= works に存在しない id）が残っていないか
SELECT COUNT(*) FROM documents d
 WHERE d.ledger_ref_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM works w WHERE w.id = d.ledger_ref_id);
-- 0 なら E-final（resolver フォールバック撤去→DROP）に進める。
```

## Phase E 事前条件（着手前に全て満たすこと・要人間承認）

1. A′/A/B/C が本番で十分ソークし、原作一覧・素材 write・文書生成に退行が無い。
2. 旧 master 書込み経路（LedgersPanel の POST/PUT/DELETE・bulk-import）を
   works 一本化へ移行するか、ledgers 非依存に付け替える（write を 0 へ）。
3. `resolveLedgerRef`/`resolveLicensedInWork` の ledgers フォールバックと LO 採番 UNION、
   診断メトリクスを works のみに付け替える（read を 0 へ）。
4. `documents.ledger_ref_id` の実データが全て works.id 前提でも解決できることを確認
   （旧 ledgers.id 値が残る場合はバックフィルで works.id へ寄せるか、両対応を維持）。
5. 上記でラチェット上限を `0 0 0` まで下げてから、新規 migration で
   `DROP TABLE ledgers` / `DROP TABLE source_ips`（+ 関連 FK/index）。
