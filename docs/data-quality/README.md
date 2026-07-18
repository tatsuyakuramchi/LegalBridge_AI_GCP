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
| DQ-02 | 作品登録後の 契約・権利・素材・証憑 不足ルール（**評価エンジン**） | ⬜ |
| DQ-04 | 作品一覧・詳細へ 完全性 Badge・修正 CTA | ⬜（admin-ui） |
| DQ-05 | 独立データ入力 UI `/data-entry` | ⬜（admin-ui） |
| DQ-06 | Data Quality Center `/data-quality` | ⬜（admin-ui） |

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

## 次（DQ-02）

- 各 `predicate_key` の**評価ロジック**を worker に実装（作品/素材/条件を走査 → Issue upsert →
  解消時 auto-close → `entity_completeness_summary` 再計算）。
- 評価タイミング（§8.4）: フォーム保存後 / 独立 UI 保存後 / リンク変更後 / 状態遷移前 /
  夜間全件再スキャン / migration・import・merge 後。評価失敗が元データ保存を壊さないよう
  outbox で追いつく設計。
- API（§14.4）: `GET /api/data-quality/issues`・`.../entities/:type/:id/summary`・
  `POST /api/data-quality/rescan` 等。
