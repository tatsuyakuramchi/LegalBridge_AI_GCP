# Phase 5 契約・金銭分離 実行計画（棚卸しと documents.contract_id 導入）

> 修正計画書 [`legalbridge-remediation-plan-20260714.md`](./legalbridge-remediation-plan-20260714.md)
> §9 Phase 5「契約・金銭分離」/ §6.4「中長期の分離」/ §13.1 推奨(契約と文書は独立、documents は発行書面に限定)の実行管理。
> Phase 4 の撤去ゲート G5(trg_sync_* 解消)は本 Phase と連動([`phase4-compat-retirement-plan.md`](./phase4-compat-retirement-plan.md) §3)。

| 項目 | 内容 |
|---|---|
| 目的 | `contracts`(法的関係) と `documents`(発行書面) を分離し、1契約:N文書を `documents.contract_id` で表現。金銭は `invoices`/`payments` へ正本化 |
| 前提 | 新構造テーブル群は **0005/0006 で導入済み**。Phase 5 は新規導入ではなく「整合・正本化」 |
| 作成日 | 2026-07-16 |

## 1. 現状棚卸し（2026-07-16, main 46782bf 時点）

### 1.1 新構造テーブルの実態

| テーブル | 定義 | 書き手(現在) | 読み手(現在) | 状態 |
|---|---|---|---|---|
| `contracts` | 0005 | ① Search `/api/v3/contracts`(origin='registered'、id≥1e9 高レンジ採番)<br>② importsV2 / server.ts / dataLinkage の削除・修理経路 | 11箇所(workModel / conditionsService / dataLinkage 等) | **二層混成**。workflow 由来行(origin='workflow'、id=documents.id の旧ミラー)は 0101 以降更新停止で陳腐化 |
| `contract_works` | 0005 | workModel(v3 契約 POST/PUT) | workModel | 現役(registered 契約用) |
| `contract_parties` | 0005 | **なし** | workModel:472 の1箇所 | 実質未使用(3者以上契約は未運用) |
| `contract_financial_terms` | 0005 | なし(0101 でミラー停止) | workModel(term_count / 一覧) | **陳腐化**。正本は condition_lines |
| `contract_line_items` | 0005 | importsV2 が手動ミラー再構築(§1.3) | workModel | 手動ミラーで延命中 |
| `invoices` | 0006 | **なし** | **なし** | 未使用(空テーブル)。`invoice_lines` は未定義 |
| `payments` | 0006 | ① workModel `syncReceiptPayment`(inbound/sublicense_income)・`syncDistributionPayment`(outbound/royalty)<br>② `trg_sync_payments`(royalty_payments→payments、現役) | 5箇所 | **現役**(再許諾受領・分配の台帳として稼働) |
| `deliverables` / `deliverable_revisions` | 0006 | **なし** | **なし** | 未使用 |
| `royalty_statements` | 0006 | `trg_sync_royalty_statements`(royalty_calculations→、現役) | — | トリガ同期のみ |

### 1.2 trg_sync_*(二重書込み)の生死

0012 で5本作られたが、**0101 の `DROP TABLE ... CASCADE` で旧実表上のトリガは消滅済み**:

| トリガ | 載っていた表 | 現状 |
|---|---|---|
| `trg_sync_contracts` (cc→contracts) | contract_capabilities | **消滅**(0101)。関数 `lb_sync_contracts` は孤児で残存 |
| `trg_sync_cft` (cfc→contract_financial_terms) | capability_financial_conditions | 同上(`lb_sync_cft` 孤児) |
| `trg_sync_cli` (cli→contract_line_items) | capability_line_items | 同上(`lb_sync_cli` 孤児) |
| `trg_sync_delete_contracts` / `trg_sync_delete_cli` / `trg_sync_delete_cft` (0031/0032) | 同上 | 同上(`lb_sync_delete_*` 孤児) |
| `trg_sync_royalty_statements` | royalty_calculations(実表・現役) | **生存・発火中** |
| `trg_sync_payments` | royalty_payments(実表・現役) | **生存・発火中** |

→ G5 の実作業 = ①孤児関数 `lb_sync_contracts/cft/cli/delete_*` の DROP(無害・即可)、
②生存2本は payments / royalty_statements の正本化方針を決めてから DROP(新旧照合が前提)。

### 1.3 手動ミラー・修理経路(移行時に意味が変わる箇所)

- `services/worker/src/routes/importsV2.ts:1231` — 一括インポートが `contract_line_items` を DELETE→INSERT で作り直す(v3 ミラー手動維持)。
- `services/worker/src/routes/dataLinkage.ts` — `orphan_contracts` プローブ / `prune_orphan_contracts` 修理:
  「documents(=cc view) に id が無い origin='workflow' の contracts」を削除。contract_id 導入後もこの判定は
  成立し続ける(ミラー行 id=documents.id のため)が、**第2弾のミラー統合後は判定式の見直しが必要**。
- `services/worker/server.ts:13027` 他 — 文書削除時に同 id の contracts 行を消す手動ミラー削除。

### 1.4 documents 側の既存リンク列

- `master_document_number`(0122) — 個別契約→基本契約の**文書番号**参照。contracts.master_contract_id への昇格元。
- `parent_capability_id` / `structural_role`(0101) — 構造親子。
- `base_document_number` / `revision` / `is_primary`(再発行の版ファミリ) — **1契約:N文書の家族キー**。

## 2. 方針（§13.1 推奨の具体化）

- `contracts` = 法的関係の正本。`documents` = 発行・受領した書面(版ごとに1行)。
- **`documents.contract_id`** で N:1 に接続。版ファミリ(base_document_number 単位)は同一契約を指す。
- 金銭は `payments`(統一台帳) を正、`invoices` は請求書実務(受領/発行)導入時に有効化。
- `contract_financial_terms` / `contract_line_items` ミラーは **増やさない**。読み手(workModel 一覧)を
  condition_lines 直読みへ切替後、ミラー撤去(G5 と同一ゲート)。

## 3. スライス計画

| スライス | 内容 | 状態 |
|---|---|---|
| 第1弾 | 本棚卸し + **migration 0128**: `documents.contract_id` 追加(additive)＋バックフィル(§4) | 実装済(本コミット) |
| 第2弾 | **migration 0129**: ①`tg_doc_autolink_contract`(documents BEFORE INSERT、0106 autolink と同型)で全書込み経路(30箇所超)の contract_id 付与を DB 側で保証(契約が無い家族は 0128⑤ と同一写像で補完生成。Phase 7 で明示 DTO 化した時点で DROP) ②ミラー重複 contracts を非CASCADE参照(payments/invoices/royalty_statements/alerts/deliverables/self-ref)付替えのうえ削除。<br>TS: bulk-delete / importsV2統合 / dataLinkage prune の `DELETE FROM contracts` を「文書参照が残る契約は温存」ガード付きへ(0128 FK による削除経路の退行防止)。孤児判定を contract_id 基準へ | 実装済(2026-07-16) |
| 第3弾 | workModel の contract_financial_terms・contract_line_items 読み(一覧 term_count / 契約詳細)を documents.contract_id 経由の condition_lines 直読みへ切替(応答形は互換view の列で維持)。importsV2 の contract_line_items 手動ミラー再構築を撤去。**これで両ミラー表への参照はゼロ**(表の DROP は G5 と同時に migration で) | 実装済(2026-07-16) |
| 第4弾 | **migration 0130 = G5**: ①照合スナップショットを適用ログへ NOTICE 出力(rc vs rs / rp vs PAY-MIG payments / ミラー表件数) ②生存トリガ2本(trg_sync_royalty_statements / trg_sync_payments)と関数を DROP ③孤児 lb_sync_contracts/cft/cli/delete_* を DROP ④参照ゼロの contract_financial_terms / contract_line_items を DROP CASCADE(消えるのは残存FK制約のみ)。<br>前提の読み手切替: workModel 契約詳細の royalty_statements を正本 royalty_calculations 直読みへ(応答キー互換)。payments のトリガ供給行(PAY-MIG/work_id NULL)は集計読み手に元々現れないため影響なし。<br>※ worker ロイヤリティ支払の payments 台帳への正式合流は第5弾以降(明示書込みとして設計)。trg_sync_source_ip_to_work(0035 作品統一)は本スコープ外で残す | 実装済(2026-07-16) |
| 第5弾 | invoices / invoice_lines / deliverables の業務投入(請求書受領・成果物検収フローと接続) | 未着手(運用要件待ち) |

## 4. migration 0128 バックフィル仕様

`0128_documents_contract_id.sql`。冪等(NULL の contract_id のみ埋める)。

1. **additive**: `documents.contract_id INTEGER REFERENCES contracts(id)` + index。
2. **旧ミラー直リンク**: `contracts.id = documents.id AND origin='workflow'`(0101 以前の 1:1 ミラー行)を接続。
3. **document_number 一致**: 未接続文書を `contracts.document_number = 家族キー` で接続(registered 契約との突合)。
4. **版ファミリ統合**: 家族キー = `COALESCE(NULLIF(base_document_number,''), document_number)`。
   家族内で契約が割れている場合は **最小 contracts.id**(=最古の版のミラー)へ寄せ、契約未接続の版にも同契約を伝播。
5. **不足契約の生成**: それでも契約が無い家族(0101 以降に作られた文書)は、代表版(is_primary→revision→id 降順)から
   旧 `lb_sync_contracts` と同じ写像(contract_level / lifecycle_stage の CASE、既定値 COALESCE)で contracts を新規作成
   (`document_number = 家族キー`、origin='workflow'、`ON CONFLICT (document_number) DO NOTHING`)し、③を再実行して家族全員を接続。
6. **基本契約リンク昇格**: `documents.master_document_number` → `contracts.master_contract_id`(未設定行のみ)。

対象外(明記): `document_number IS NULL` の文書(接続キーなし)、ミラー重複 contracts の削除(第2弾)、
書込み経路の contract_id 付与(第2弾)。

## 5. 受入基準(計画 §11.3 対応)

- 0128 適用後、`document_number` を持つ文書の contract_id NULL 率が 0%(NULL番号文書を除く)。
- 版ファミリ内で contract_id が一意。
- `SELECT contract_id, COUNT(*) FROM documents GROUP BY 1` で 1契約:N文書が観測できる(再発行ファミリ)。
- 既存の workModel(v3)・dataLinkage 修理経路が無変更で動く(0128 は additive + バックフィルのみ)。
