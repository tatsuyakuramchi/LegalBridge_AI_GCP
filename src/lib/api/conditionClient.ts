/**
 * conditionClient — 条件明細(condition_lines)ドメインの API クライアント
 * (Phase 6 第3.5弾)。condition_lines は SSOT の金銭条件で、本システムの中核。
 *
 * 対象は JSON を返すエンドポイントのみ。CSV(blob)を返す /api/conditions/export は
 * 呼び出し側で直接 fetch する。
 *
 * ルート(BFF 経由で相対パス):
 *   GET   /api/condition-lines                       条件明細一覧(bare 配列)
 *   GET   /api/condition-lines/:code                 明細詳細({line, events, schedule})
 *   POST  /api/condition-lines/:id/delete            明細削除(実績が無いもののみ)
 *   POST  /api/condition-lines/:id/link-document     対になる文書をリンク
 *   PATCH /api/condition-lines/:id/graph-link        作品グラフのエッジ紐付け更新
 *   POST  /api/condition-events/:id/void             文書リンク(イベント)を解除
 *   GET   /api/conditions/search?...                 条件明細の横断検索({rows})
 *
 * 応答はサーバの形(エンベロープ or bare 配列)をそのまま返す。失敗時は ApiError。
 */

import { apiGet, apiSend } from "./httpClient";

function q(params?: Record<string, string | number | undefined> | URLSearchParams): string {
  if (!params) return "";
  if (params instanceof URLSearchParams) {
    const s = params.toString();
    return s ? `?${s}` : "";
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const conditionClient = {
  /** 条件明細一覧(bare 配列を返す)。 */
  listLines() {
    return apiGet("/api/condition-lines");
  },

  /** 明細詳細({ line, events, schedule })。lineCode で引く。 */
  getLine(lineCode: string) {
    return apiGet(`/api/condition-lines/${encodeURIComponent(lineCode)}`);
  },

  deleteLine(id: number | string) {
    return apiSend("POST", `/api/condition-lines/${id}/delete`);
  },

  linkDocument(id: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/condition-lines/${id}/link-document`, body);
  },

  /** 作品グラフのエッジ紐付けを更新(PATCH)。 */
  setGraphLink(id: number | string, patch: Record<string, unknown>) {
    return apiSend("PATCH", `/api/condition-lines/${id}/graph-link`, patch);
  },

  /** 文書リンク(condition_event)を解除(void)。 */
  voidEvent(eventId: number | string, body: Record<string, unknown>) {
    return apiSend("POST", `/api/condition-events/${eventId}/void`, body);
  },

  /** 条件明細の横断検索({ rows })。params は URLSearchParams でも可。 */
  search(params?: Record<string, string | number | undefined> | URLSearchParams) {
    return apiGet(`/api/conditions/search${q(params)}`);
  },
};
