# 法務相談 → Cowork 契約書レビュー連携

法務相談(=案件)を起点に、契約書の **格納** と Cowork(legal プラグイン)での **1次レビュー / ドラフト** を成立させる構想の設計メモ。

- 決定事項: 接続は **MCP 化 + 人が確認**、着手は **格納導線を先に**。
- 全体は 3 フェーズ。本書は **Phase 1(実装済) の要約** と **Phase 2(設計確定・未実装) の詳細** を記す。

---

## Phase 1 — 格納導線(実装済)

案件詳細から契約書の生ファイル(Word/PDF 等)を Drive に保管し、`documents` 行として案件へ紐付ける。

- 新 EP `POST /api/matters/:id/attachments` (`services/worker/server.ts`)
  - `multer.single("file")` → `googleDriveService.uploadFile()` で Drive 保管
  - `documents` 行を作成: 採番 `ATT-YYYY-NNNNN`(`document_sequences` kind='attachment')、`template_type = docKind`、`is_primary = FALSE`(正本契約版と区別)、`matter_id` 明示、`issue_key` = 案件の代表課題
  - `docKind` = `counterparty_draft`(相手方ドラフト) / `own_draft`(自社ドラフト) / `reference`(参考資料)
  - `form_data` に `original_file_name` / `source_mime_type` / `kind` を保存(Phase 2 の本文化で MIME 判定に使う)
- FE `src/pages/MatterDetailPage.tsx` の文書カードに格納 UI(ファイル選択 + 種別 + 表示名 + 「格納」)。
- 前提確認済: `documents.template_type` は CHECK 制約なし(DDL 不要) / 生ファイルアップロード経路は既存(`googleDriveService.uploadFile` 162-188) / `tg_doc_autolink_matter`(0106) は `matter_id IS NULL` 時のみ発火で競合なし / `apiRouter` の POST 既定で worker へ。

---

## Phase 2 — Cowork 読取 MCP ブリッジ(設計確定・未実装)

LegalBridge を MCP 化し、Cowork/Claude から相談・契約書本文を **読み取り**、`/legal:review-contract` で 1 次レビューを実行する。**この段階では書き戻しをしない**(安全に試行)。

### トポロジ

```
[Cowork / Claude]
     │  MCP ツール呼び出し (stdio)
     ▼
[LegalBridge MCP Bridge]  ── HTTPS + X-LB-PORTAL-SECRET ──▶  [worker / search-api]
  (services/mcp-bridge, 薄いアダプタ)     既存の読取 EP を叩くだけ        └─▶ Postgres / Google Drive
```

- **接続形態**: ローカル stdio MCP(Claude Desktop / Claude Code から `claude mcp add` で登録)。Cloud Run デプロイも OAuth も不要で最速。フロー検証後、複数人共有が必要になればリモート(HTTP/SSE)MCP へ昇格。
- **認証**: 既存の共有シークレット `X-LB-PORTAL-SECRET`(env `LB_PORTAL_SECRET`、`services/api/src/lib/authMiddleware.ts` で timing-safe 比較)。サーバー間呼び出しに使用。worker は `--allow-unauthenticated`(ネットワーク層) + portal-secret(アプリ層)ゲートのため、ローカルプロセスから公開 URL に到達可能。

### MCP ツール面(読取のみ)

| ツール | 入力 | ラップ先 EP | 返すもの |
|---|---|---|---|
| `list_consultations` | `{status?, q?, limit?}` | `GET /api/matters` | 相談=案件の一覧(code / 相手方 / 状態 / 代表課題) |
| `get_consultation` | `{matter_id}` | `GET /api/matters/:id` | 相談の全体像(課題 + 添付文書 + 条件 + 送信履歴) |
| `get_document_text` | `{document_number}` | 新 EP `…/:num/text` | 契約書メタ + **本文テキスト** |

### 本文テキスト化(新規)

契約書本文のテキスト化は現状 GAP(worker/search-api に pdf-parse/mammoth 等なし、`googleDriveService.downloadPdf` は生バイナリのみ)。サーバー側で抽出する。

- **新 EP** `GET /api/documents/by-number/:num/text` (worker、**要 X-LB-PORTAL-SECRET**)
  1. 文書を番号引き → `drive_link` / `template_type` / `form_data.source_mime_type`
  2. `drive_link` から fileId 抽出(既存 `fileIdFromLink`) → Drive から bytes 取得
  3. MIME 分岐で本文化:
     - `application/pdf` → **pdf-parse**
     - `…wordprocessingml.document`(docx) → **mammoth.extractRawText**
     - `application/vnd.google-apps.document` → `drive.files.export({ mimeType: 'text/plain' })`
     - `text/plain` → そのまま
     - その他 → `unsupported`
  4. 返却 `{ ok, document_number, template_type, mime_type, char_count, truncated, needs_ocr, text }`
     - `text` は上限(例 200,000 字)でカット + `truncated` フラグ(モデル context 保護)
     - PDF で抽出テキストが空同然 → `needs_ocr: true`(スキャン PDF。OCR は Phase 2 対象外)
- **変更**: `googleDriveService.downloadPdf` を汎用 `downloadFile(fileId)` に一般化。
- **新規 deps**(worker): `pdf-parse` / `mammoth`(ともに純 JS・Cloud Run 可)。

### MCP サーバ

- 新パッケージ `services/mcp-bridge/`(`@modelcontextprotocol/sdk` + `StdioServerTransport`)。
- 各ツールは `fetch(LB_WORKER_URL + path, { headers: { 'X-LB-PORTAL-SECRET': ... } })` する薄いアダプタ。
- env: `LB_WORKER_URL` / `LB_PORTAL_SECRET`(必要なら `LB_READ_URL`)。
- 登録例:
  ```
  claude mcp add legalbridge -- node services/mcp-bridge/dist/index.js
  # env: LB_WORKER_URL=https://legalbridge-document-worker-<region>.run.app  LB_PORTAL_SECRET=****
  ```

### セキュリティ留意

- 本文 EP は契約書本文を外部(モデル)に出すため、**必ず portal-secret 認証の内側**に置く。worker がルート単位でゲートしていない場合は本 EP に明示チェックを追加する。

### 実装順

1. `googleDriveService.downloadFile` 汎用化 → 本文抽出 EP → deps 追加(worker 単体で selftest / curl 検証可能)
2. MCP サーバ(EP が動けば `get_document_text` を実接続でテスト)
3. 登録手順 + Cowork で `/legal:review-contract` を通しで試行

### 検証

- `tsc --noEmit`(worker + 新パッケージ) + selftest(抽出 EP を実文書で叩く)。

---

## Phase 3 — 書き戻し + プレイブック(未着手)

- `save_review` / `save_draft` MCP ツールでレビュー結果を `documents.ai_review_json`(新カラム) / `risk_flags` / ドラフトへ。
- 自社ネゴシエーション・プレイブック(標準条項ポジション)を LegalBridge に保持し、App と Cowork で同一基準に。
