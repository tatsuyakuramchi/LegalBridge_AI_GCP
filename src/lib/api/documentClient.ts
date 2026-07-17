/**
 * documentClient — 文書(documents)と下書き(document_drafts)ドメインの API クライアント
 * (Phase 6 第3弾)。
 *
 * 対象は JSON を返すエンドポイントのみ。バイナリ/CSV を返すもの
 * (/api/documents/export-excel, /api/documents/preview のPDF等)は
 * blob 処理が必要なため対象外(呼び出し側で直接 fetch する)。
 *
 * ルート(worker 実装、BFF 経由で相対パス):
 *   ── documents ──
 *   GET  /api/documents/:id                          文書取得(form_data 含む)
 *   GET  /api/documents/by-number/:num               文書番号で取得
 *   GET  /api/documents/pending-pdf?limit=            PDF未作成キュー
 *   POST /api/documents/generate                     文書生成/再発行(応答は呼び出し側で解釈)
 *   POST /api/documents/:id/regenerate-pdf           PDF再生成
 *   POST /api/documents/:id/regenerate-and-complete  PDF再生成+完了
 *   POST /api/documents/:id/mark-as-imported         取込済(キュー除外)
 *   POST /api/documents/:id/mark-primary             正本指定
 *   POST /api/documents/bulk-update-fields           一括フィールド更新
 *   POST /api/documents/bulk-delete                  一括削除
 *   POST /api/documents/:num/email/send              メール送信
 *   ── document_drafts(一時保存) ──
 *   GET    /api/document-drafts?q=&limit=             一覧
 *   GET    /api/document-drafts/:issueKey?template_type=   単一取得(404=下書き無し)
 *   POST   /api/document-drafts                       保存(assign_number で採番)
 *   DELETE /api/document-drafts/:issueKey?template_type=   単一削除
 *   POST   /api/document-drafts/bulk-delete           一括削除
 *
 * 応答は worker のエンベロープをそのまま返す。失敗時は ApiError を投げる。
 */

import { apiGet, apiSend, ApiError } from "./httpClient";

function q(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const documentClient = {
  // ── documents ──────────────────────────────────────────────
  get(id: number | string) {
    return apiGet(`/api/documents/${encodeURIComponent(String(id))}`);
  },

  getByNumber(documentNumber: string) {
    return apiGet(`/api/documents/by-number/${encodeURIComponent(documentNumber)}`);
  },

  pendingPdf(limit = 200) {
    return apiGet(`/api/documents/pending-pdf${q({ limit })}`);
  },

  generate(body: Record<string, unknown>) {
    return apiSend("POST", "/api/documents/generate", body);
  },

  regeneratePdf(id: number | string) {
    return apiSend("POST", `/api/documents/${id}/regenerate-pdf`);
  },

  regenerateAndComplete(id: number | string) {
    return apiSend("POST", `/api/documents/${id}/regenerate-and-complete`);
  },

  markAsImported(id: number | string) {
    return apiSend("POST", `/api/documents/${id}/mark-as-imported`);
  },

  markPrimary(id: number | string) {
    return apiSend("POST", `/api/documents/${id}/mark-primary`);
  },

  bulkUpdateFields(body: Record<string, unknown>) {
    return apiSend("POST", "/api/documents/bulk-update-fields", body);
  },

  bulkDelete(body: Record<string, unknown>) {
    return apiSend("POST", "/api/documents/bulk-delete", body);
  },

  emailSend(documentNumber: string, body: Record<string, unknown>) {
    return apiSend(
      "POST",
      `/api/documents/${encodeURIComponent(documentNumber)}/email/send`,
      body
    );
  },

  // ── document_drafts(一時保存) ───────────────────────────────
  listDrafts(params?: { q?: string; limit?: number }) {
    return apiGet(`/api/document-drafts${q(params)}`);
  },

  /**
   * 下書きを取得する。存在しない(404)なら null を返す(= 下書き無しは正常系)。
   * それ以外のエラーは ApiError を再送出。
   */
  async getDraftOrNull(issueKey: string, templateType: string): Promise<any | null> {
    try {
      return await apiGet(
        `/api/document-drafts/${encodeURIComponent(issueKey)}${q({
          template_type: templateType,
        })}`
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  saveDraft(body: Record<string, unknown>) {
    return apiSend("POST", "/api/document-drafts", body);
  },

  deleteDraft(issueKey: string, templateType: string) {
    return apiSend(
      "DELETE",
      `/api/document-drafts/${encodeURIComponent(issueKey)}${q({
        template_type: templateType,
      })}`
    );
  },

  bulkDeleteDrafts(body: Record<string, unknown>) {
    return apiSend("POST", "/api/document-drafts/bulk-delete", body);
  },
};
