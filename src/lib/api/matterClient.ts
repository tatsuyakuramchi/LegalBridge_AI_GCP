/**
 * matterClient — 案件(matter)ドメインの API クライアント(Phase 6 第2弾)。
 *
 * ルート(worker 実装 /api/matters/*、BFF 経由で相対パス):
 *   GET    /api/matters                       一覧(?status=&q=)
 *   GET    /api/matters/issue-links            課題→案件リンク(LB-03)
 *   GET    /api/matters/:id                    詳細(matter/issues/documents 等)
 *   POST   /api/matters                        新規作成
 *   PATCH  /api/matters/:id                    ヘッダ/工程/担当/期限 等の更新
 *   DELETE /api/matters/:id                    削除
 *   POST   /api/matters/:id/drive-folder       Drive 案件フォルダ作成
 *   POST   /api/matters/:id/tasks              タスク追加
 *   PATCH  /api/matters/:id/tasks/:taskId      タスク更新
 *   DELETE /api/matters/:id/tasks/:taskId      タスク削除
 *   POST   /api/matters/:id/issues             課題を束ねる
 *   DELETE /api/matters/:id/issues/:key        課題の紐付け解除
 *   POST   /api/matters/:id/documents          文書番号を紐付け
 *   DELETE /api/matters/:id/documents/:docId   文書の紐付け解除
 *   POST   /api/matters/:id/attachments        契約書ファイル格納(multipart)
 *   POST   /api/matters/:id/absorb             他案件の取り込み(統合)
 *
 * レスポンスは worker 側の `{ ok, ... }` エンベロープをそのまま返す(呼び出し側が
 * matter / matters / links 等のフィールドを読む)。失敗時は ApiError を投げる。
 */

import { apiGet, apiSend } from "./httpClient";

export interface MatterListParams {
  status?: string;
  q?: string;
}

function withQuery(base: string, params?: Record<string, string | undefined>): string {
  if (!params) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export const matterClient = {
  list(params?: MatterListParams) {
    return apiGet(withQuery("/api/matters", params as any));
  },

  issueLinks() {
    return apiGet("/api/matters/issue-links");
  },

  get(matterId: number | string) {
    return apiGet(`/api/matters/${matterId}`);
  },

  create(body: Record<string, unknown>) {
    return apiSend("POST", "/api/matters", body);
  },

  update(matterId: number | string, patch: Record<string, unknown>) {
    return apiSend("PATCH", `/api/matters/${matterId}`, patch);
  },

  remove(matterId: number | string) {
    return apiSend("DELETE", `/api/matters/${matterId}`);
  },

  createDriveFolder(matterId: number | string) {
    return apiSend("POST", `/api/matters/${matterId}/drive-folder`);
  },

  // LB-08 連動: 案件フォルダ配下の実ファイル一覧(人が直接入れたファイルも含む)。
  driveFiles(matterId: number | string) {
    return apiGet(`/api/matters/${matterId}/drive-files`);
  },

  addTask(matterId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/matters/${matterId}/tasks`, body);
  },

  updateTask(
    matterId: number | string,
    taskId: number | string,
    patch: Record<string, unknown>
  ) {
    return apiSend("PATCH", `/api/matters/${matterId}/tasks/${taskId}`, patch);
  },

  deleteTask(matterId: number | string, taskId: number | string) {
    return apiSend("DELETE", `/api/matters/${matterId}/tasks/${taskId}`);
  },

  addIssue(matterId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/matters/${matterId}/issues`, body);
  },

  removeIssue(matterId: number | string, backlogIssueKey: string) {
    return apiSend(
      "DELETE",
      `/api/matters/${matterId}/issues/${encodeURIComponent(backlogIssueKey)}`
    );
  },

  attachDocument(matterId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/matters/${matterId}/documents`, body);
  },

  detachDocument(matterId: number | string, docId: number | string) {
    return apiSend("DELETE", `/api/matters/${matterId}/documents/${docId}`);
  },

  // Drive の実ファイルを「文書」として登録する(external_file として documents へ取り込み)。
  registerDriveFile(matterId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/matters/${matterId}/documents/from-drive`, body);
  },

  /** 契約書等のファイル格納。FormData(file/docKind/title)を multipart で送る。 */
  uploadAttachment(matterId: number | string, form: FormData) {
    return apiSend("POST", `/api/matters/${matterId}/attachments`, form);
  },

  absorb(matterId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/matters/${matterId}/absorb`, body);
  },

  // 案件×Slack: 固定「法務相談」チャンネルに案件スレッド。
  /** スレッド作成(冪等。既存なら既存を返す)。 */
  slackCreateThread(matterId: number | string) {
    return apiSend("POST", `/api/matters/${matterId}/slack/thread`);
  },
  /** スレッドへメッセージ送信。 */
  slackSendMessage(matterId: number | string, text: string) {
    return apiSend("POST", `/api/matters/${matterId}/slack/messages`, { text });
  },
  /** スレッド会話をオンデマンド取得(conversations.replies)。 */
  slackReplies(matterId: number | string) {
    return apiGet(`/api/matters/${matterId}/slack/replies`);
  },
  /** メンション候補(staff のうち slack_user_id を持つ人)。 */
  slackMentionCandidates() {
    return apiGet(`/api/matters/slack/mention-candidates`);
  },
};
