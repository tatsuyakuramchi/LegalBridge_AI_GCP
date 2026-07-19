# Data Quality 基盤（設計 v1.4 DQ トラック）

作品起点の「不足検知 → 永続 Issue → 完全性サマリー → 修正導線」を支える基盤。
設計ドック §8.3〜8.7 / §14.4 に対応。

## デプロイ経路（重要）

DB スキーマは **`migrations/` ランナー（Cloud Run Job）** が単一所有。反映は
**`release/worker` の fast-forward**（`cloudbuild-worker.yaml` の migrate ステップ）で行う。
admin-ui の Cloud Build では **適用されない**。

## 進捗

| ID | 内容 | 状態 |
|---|---|---|
| **DQ-01** | ルール・Issue・完全性サマリー・entity_sources の DB 基盤 | ✅ 実装（`migrations/0136_data_quality_and_entity_sources.sql`） |
| **DQ-02** | 評価エンジン（predicate 実行 → Issue upsert/auto-close → サマリー再計算）＋ API | ✅ 実装（`services/worker/src/services/dataQualityService.ts` ＋ `routes/dataQuality.ts`） |
| **DQ-04** | 作品一覧・詳細へ 完全性 Badge・修正 CTA | ✅ 実装（admin-ui。`CompletenessBadge` / `CompletenessPanel` / `dataQualityClient`） |
| **DQ-04b** | DQ Center の 条件/素材「修正」を実画面へ接続 | ✅ 実装（issues API が親 work_id・条件 line_code を解決 → `/works/:id` `/condition-lines/:lineCode` へ導線） |
| DQ-05 | 独立データ入力 UI `/data-entry` | ⬜（admin-ui） |
| **DQ-自動発火** | 保存後に該当エンティティだけ差分再評価（§8.4） | ✅ 実装（worker `evaluateEntity` ＋ `POST /entities/:type/:id/evaluate`、admin-ui は作品/条件/素材の保存で発火） |
| **DQ-08** | 完全性ゲート（作品公開・案件完了のソフト確認） | ✅ 第1/2弾（admin-ui。請求開始ゲートは要・実機協働） |
| **DQ-09** | 監査ログ（担当/期限/waive を 誰が/いつ/何を で記録） | ✅ 実装（`migrations/0137` ＋ worker `data_quality_issue_events` 記録・`GET /issues/:id/events`、DQ Center に「履歴」表示） |
| **DQ-06** | Data Quality Center `/data-quality` | ✅ 実装（admin-ui。`DataQualityCenter` ＋ client 拡張 getIssues/patchIssue/waiveIssue） |

## DQ-01 で入ったもの（0136）

4 テーブル（すべて新規・既存へ非破壊・冪等 / 可逆）:

- **`entity_sources`** — provenance/証憑の共通中間表（§8.3）。1 エンティティに複数根拠。
- **`data_quality_rules`** — ルール台帳（§8.4）。フロント直書きせずサーバ定義。`predicate_key` を
  評価エンジン（DQ-02）が dispatch。`stage`（空=常時 / usage_start 等）で BLOCKER 昇格条件を持つ。
- **`data_quality_issues`** — 検出 Issue。`UNIQUE(entity_type, entity_id, rule_code)` で
  1 エンティティ×1 ルール=1 行（再評価は `last_detected_at` 更新・`status` 遷移で自動クローズ）。
- **`entity_completeness_summary`** — エンティティ別サマリー（identity/relationship/contract/
  financial/evidence の各 status＋blocker/error/warning 件数＋score）。PK=(entity_type, entity_id)。

**ルール台帳 seed = 21 件**（§8.6）: BLOCKER 12 / ERROR 8 / WARNING 1。
WORK-ID/FAM/REL・MAT-ID/RGT/DOC/FEE・WORK-MAT・COND-ROUTE/RGT/FIN/SCOPE・WORK-OUT・WORK-EVD。

### 検証（ローカル Postgres 16）

- migration がクリーンに適用（4 テーブル＋全 index＋`INSERT 0 21`）。
- 冪等（`ON CONFLICT`／`IF NOT EXISTS` で再適用 OK）。
- FK（`data_quality_issues.rule_code → data_quality_rules`）が不正コードを拒否。
- `UNIQUE(entity_type, entity_id, rule_code)` が重複を拒否。

## DQ-02 で入ったもの（worker / release/worker）

**評価エンジン** `services/worker/src/services/dataQualityService.ts`:
- ルールごとに「違反行の id を返す SQL(failingSql)」を持つ評価器を登録。実スキーマに対応する
  **6 ルールを実装**: `WORK-ID-001` / `WORK-REL-001` / `WORK-MAT-001` / `MAT-ID-001` /
  `MAT-RGT-002` / `COND-FIN-001`。
- 評価 = 失敗集合を issue へ **upsert(open)** ／ 失敗しなくなったものを **auto-close(resolved)**。
  `status='waived'` は尊重して**再オープンしない**。
- `entity_completeness_summary` を集計（blocker/error/warning 件数 ＋ score ＝ 100−blocker×40−error×15−warning×5、
  ＋ 分類別 status を rule→category マッピングで算出）。runtime DDL は使わない（実行ロールの CREATE 権限に非依存）。
- **未実装テーブル依存のルール（`work_relations`/`material_rights_sources`/`fee_subject_snapshot` 等）は
  評価器を登録せずスキップ**（台帳には残す）。Phase D/F でテーブルが入り次第、評価器を追加する。

**API** `services/worker/src/routes/dataQuality.ts`（§14.4）:
`POST /api/data-quality/rescan`・`GET .../rules`・`GET .../issues`（絞込＋severity 順＋rule メタ join）・
`GET .../entities/:type/:id/summary`・`PATCH .../issues/:id`（担当/期限/メモ）・`POST .../issues/:id/waive`。

### 検証（ローカル Postgres 16、全 migration 適用 + 実データ seed）

- エンジン: 6 ルールが正しい失敗集合を検出（例: work_type 欠落=3件、派生で親なし=1件…）、
  サマリー score/status が期待通り、**修復→再スキャンで auto-close**、**waive→再スキャンで再オープンしない**。
- API: rescan/rules/issues/summary/patch/waive を Express 実起動 + fetch で 200 応答・期待値を確認。
- worker `tsc --noEmit`: エラー 0。

## 初期データ是正（2026-07-18）

実機投入直後の初回スキャン（BLOCKER 88 / ERROR ~52）に対し、構造的な残骸・誤フラグ・重複を是正。
**BLOCKER 88→34・WORK-ID-001/WORK-REL-001 を 0** に。詳細は
[`initial-data-remediation-20260718.md`](./initial-data-remediation-20260718.md)。
残り（COND-FIN-001 34 / WORK-MAT-001 5 / MAT-RGT-002 18）は DQ Center の通常運用へ引き渡し。

## 次

- **DQ-04**（admin-ui）: 作品一覧・詳細へ完全性 Badge・修正 CTA（`summary`/`issues` API を消費）。
- 評価の**自動発火**（§8.4）: フォーム保存後 / リンク変更後 等での差分評価（現状は `rescan` 手動 or 定期）。
- 残ルールの評価器（Phase D/F のテーブル導入後）。
