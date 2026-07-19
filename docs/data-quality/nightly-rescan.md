# DQ-10: 夜間 全件スキャン（Cloud Scheduler）

## 目的

- **自動発火（§8.4）は「保存時」のみ**該当エンティティを再評価する。
- アプリ外での変更（一括取込み、DB 直接補正、ルール追加、`is_active` 変更 等）や
  評価漏れは保存を伴わないため拾えない。
- そこで **夜間に全件 `rescan`** を回し、ドリフトを解消して DQ Center / 完全性 Badge を
  毎朝最新に保つ。`rescan` は冪等（何度回しても安全）。

## 仕組み

Cloud Scheduler（HTTP ジョブ）→ worker の既存エンドポイントを叩くだけ。**新規コードは無い**。

```
POST {WORKER_URL}/api/data-quality/rescan
Header: x-lb-portal-secret: <LB_PORTAL_SECRET>
```

worker は `--allow-unauthenticated` だが `requirePortalSecret`（ヘッダ `x-lb-portal-secret` と
env `LB_PORTAL_SECRET` の一致）で保護されている。Scheduler はこのヘッダを付けて呼ぶ。

## セットアップ（一度だけ・Cloud Shell）

```bash
REGION=asia-northeast1
SERVICE=legalbridge-document-worker

# 1) worker の URL
WORKER_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format 'value(status.url)')
echo "$WORKER_URL"

# 2) LB_PORTAL_SECRET の Secret Manager 名を確認（env の secretKeyRef.name を見る）
gcloud run services describe "$SERVICE" --region "$REGION" \
  --format 'yaml(spec.template.spec.containers[0].env)'
#   → LB_PORTAL_SECRET: valueFrom.secretKeyRef.name: <SECRET_NAME> を確認
SECRET_NAME=<上で確認した名前>            # 例: lb-portal-secret
SECRET=$(gcloud secrets versions access latest --secret="$SECRET_NAME")

# 3) Cloud Scheduler API 有効化（未なら）
gcloud services enable cloudscheduler.googleapis.com

# 4) 夜間 03:00 JST に rescan するジョブを作成
gcloud scheduler jobs create http lb-dq-nightly-rescan \
  --location="$REGION" \
  --schedule="0 3 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="${WORKER_URL}/api/data-quality/rescan" \
  --http-method=POST \
  --update-headers="x-lb-portal-secret=${SECRET}" \
  --attempt-deadline=600s \
  --description="DQ 夜間全件スキャン（設計 v1.4 DQ-10）"
```

## 動作確認

```bash
# 手動実行 → レスポンスとログを確認
gcloud scheduler jobs run lb-dq-nightly-rescan --location="$REGION"

# worker 側のログ（evaluated 件数など）
gcloud logging read \
  'resource.labels.service_name="legalbridge-document-worker" AND textPayload=~"data-quality"' \
  --limit=20 --freshness=10m
```

DQ Center（`/data-quality`）の件数が翌朝更新されていれば OK。

## 運用メモ

- **秘密の扱い**: `--update-headers` に秘密値が入るため、ジョブ設定を閲覧できる権限は絞る。
  秘密ローテーション時はジョブも `gcloud scheduler jobs update http lb-dq-nightly-rescan
  --update-headers="x-lb-portal-secret=<new>"` で更新する。
- **冪等性**: `rescan` は open Issue の upsert / auto-close とサマリー再計算のみ。二重実行しても安全。
- **失敗検知**: Scheduler ジョブの失敗は Cloud Monitoring でアラート可能
  （`cloud_scheduler_job` の実行失敗メトリクス）。

## 未実装（将来）

- **評価 outbox（§8.4 / §14.4）**: 保存イベントをキューに積み、Data Quality Engine 停止時も
  復帰後に再評価漏れを埋める仕組み。現状は「保存時の自動発火＋夜間の全件」で実質カバーしているが、
  厳密な at-least-once 保証が要るなら outbox テーブル＋ワーカを追加する。
