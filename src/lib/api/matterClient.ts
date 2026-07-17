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

  /** 契約書等のファイル格納。FormData(file/docKind/title)を multipart で送る。 */
  uploadAttachment(matterId: number | string, form: FormData) {
    return apiSend("POST", `/api/matters/${matterId}/attachments`, form);
  },

  absorb(matterId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/matters/${matterId}/absorb`, body);
  },
};
