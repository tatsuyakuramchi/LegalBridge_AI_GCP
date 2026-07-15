# Drive 実ファイル台帳(document_files) 運用ランブック

> Phase 3「Drive管理」(修正計画書 §7 / §9) の運用手順。
> 対象: `document_files`(migration 0127) / 案件フォルダ(LB-08) / 欠損検査(verify-files)。

## 1. 全体像

| 対象 | 内容 |
|---|---|
| 台帳 | `document_files` — Drive file ID / フォルダ / 役割 / 版 / is_current / 検査状態 |
| 登録経路 | 文書生成・PDF未作成キュー/バルク発行・Backlog webhook 自動生成・案件添付・会計Excel。<br>すべて `services/worker/src/lib/documentFiles.ts` の `registerDocumentFile` に集約(best-effort・冪等) |
| 案件フォルダ | 案件作成時に `<root>/<YYYY>/<MTR-code>_相手方_案件名` + サブフォルダ8個を自動生成。<br>root は `GOOGLE_DRIVE_MATTERS_ROOT_ID`(未設定なら `GOOGLE_DRIVE_FOLDER_ID`) |
| 生成PDFの格納先 | 案件解決時は案件フォルダ `04_Final`、案件添付は `90_Reference`(未解決時は既定フォルダ) |

## 2. 欠損検査(verify-files)

`document_files` の is_current 行を「未検査 → 検査が古い順」に最大 limit 件、
Drive `files.get` で実在・権限を確認し `verify_status`(ok / missing / forbidden / error)
と `verified_at` を更新する。

```bash
# 手動実行(worker URL は Cloud Run のサービス URL)
curl -X POST "https://<WORKER_URL>/api/drive/verify-files" \
  -H "Content-Type: application/json" -d '{"limit": 100}'
# → { ok, checked, summary: {ok, missing, forbidden, error}, problems: [...] }
```

### Cloud Scheduler での定期実行(推奨: 毎日1回)

```bash
PROJECT=legalbridge-488506
REGION=asia-northeast1
WORKER_URL=$(gcloud run services describe legalbridge-document-worker \
  --region=$REGION --format="value(status.url)")

# 実行用 SA(worker を呼べる roles/run.invoker を付与)
gcloud iam service-accounts create drive-verify-scheduler \
  --display-name="Drive verify-files scheduler" --project=$PROJECT || true
gcloud run services add-iam-policy-binding legalbridge-document-worker \
  --region=$REGION \
  --member="serviceAccount:drive-verify-scheduler@${PROJECT}.iam.gserviceaccount.com" \
  --role=roles/run.invoker

# 毎日 06:00 JST に 200 件検査
gcloud scheduler jobs create http drive-verify-files \
  --location=$REGION \
  --schedule="0 6 * * *" --time-zone="Asia/Tokyo" \
  --uri="${WORKER_URL}/api/drive/verify-files" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"limit":200}' \
  --oidc-service-account-email="drive-verify-scheduler@${PROJECT}.iam.gserviceaccount.com"
```

> worker が公開(unauthenticated)運用の間は `--oidc-*` なしでも動くが、
> Phase 6(API・認証)で IAM 化する前提で SA 経由にしておくのが安全。

## 3. 健全性の俯瞰

```bash
curl "https://<WORKER_URL>/api/drive/file-health"
# → counts(status別件数: ok / missing / forbidden / error / unverified),
#   problems(直近の問題20件: 文書番号・fileId・役割),
#   last_verified_at
```

SQL での確認:

```sql
SELECT COALESCE(verify_status,'unverified') AS status, count(*)
  FROM document_files WHERE is_current GROUP BY 1;

-- missing/forbidden の対象文書
SELECT d.document_number, f.file_role, f.drive_file_id, f.verify_status, f.verified_at
  FROM document_files f JOIN documents d ON d.id = f.document_id
 WHERE f.is_current AND f.verify_status IN ('missing','forbidden');
```

### missing / forbidden が出たときの対処

- **missing**: Drive 側で削除/ゴミ箱化。原本の復元(Driveのゴミ箱) or 再発行
  (PDF未作成キュー/内部修正)を判断。復旧後に verify-files を再実行すれば ok に戻る。
- **forbidden**: サービスアカウントの権限剥奪(フォルダ共有の変更等)。
  対象フォルダに worker の SA を再共有する。

## 4. 外部連携ステータス(LB-F10)

エディタのフッターに表示される Backlog / Drive の接続状態の実体:

```bash
curl "https://<WORKER_URL>/api/integrations/status"
# → { backlog: {ok}, drive: {ok}, checkedAt }  ※ 60秒キャッシュ
```

- backlog: プロジェクトのステータス一覧取得(認証込みの実疎通)
- drive: 既定フォルダの files.get(実在+権限)。`GOOGLE_DRIVE_FOLDER_ID` 未設定なら不明(null)

## 5. 関連

- 計画: `docs/plans/legalbridge-remediation-plan-20260714.md` §7 / §9 Phase 3
- migration: `migrations/0127_document_files.sql`
- 実装: `services/worker/src/lib/documentFiles.ts` / `services/worker/src/services/googleDriveService.ts`
