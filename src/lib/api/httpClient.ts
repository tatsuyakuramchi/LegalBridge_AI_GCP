/**
 * httpClient — ドメインAPIクライアントの共通基盤(Phase 6 第2弾)。
 *
 * 目的:
 *   - admin-ui 各ページに散在していた `fetch(...) → json.ok チェック → throw`
 *     の手書きラッパを 1 箇所へ集約する。
 *   - 相対 /api/* を叩く(同一オリジン BFF: server.ts が read/write 転送する)。
 *     apiRouter の monkey-patch には依存しない(§8: 新規依存を停止)。
 *   - リクエスト相関ID(X-Request-Id)を必ず付与し、BFF・各サービスのログと
 *     突き合わせられるようにする(§8: request ID をログへ付与)。
 *
 * エラー方針(既存の手書きラッパと等価):
 *   - レスポンスが `{ ok: false, error }` エンベロープなら ApiError を投げる。
 *   - エンベロープが無く HTTP が失敗(!res.ok)なら ApiError を投げる。
 *   - それ以外はパース済み JSON をそのまま返す(呼び出し側が任意フィールドを読む)。
 */

export class ApiError extends Error {
  status: number;
  requestId: string | null;
  payload: unknown;
  constructor(
    message: string,
    status: number,
    requestId: string | null,
    payload: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.payload = payload;
  }
}

/** 相関ID。crypto.randomUUID が無い環境向けにフォールバックを持つ。 */
function newRequestId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  return (
    "rid-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

export interface ApiRequestOptions {
  method?: string;
  /**
   * リクエストボディ。FormData / string はそのまま送る(Content-Type は付けない
   * = ブラウザに任せる)。プレーンオブジェクトは JSON 化し Content-Type を付ける。
   */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 明示的に相関IDを指定したいとき(既定は自動採番)。 */
  requestId?: string;
}

function isPlainBody(body: unknown): boolean {
  return (
    body !== undefined &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    typeof body !== "string"
  );
}

/**
 * 低レベル API 呼び出し。パース済み JSON を返す。失敗時は ApiError を投げる。
 * @typeParam T レスポンス JSON の想定型(呼び出し側が指定)。
 */
export async function apiRequest<T = any>(
  path: string,
  opts: ApiRequestOptions = {}
): Promise<T> {
  const requestId = opts.requestId || newRequestId();
  const headers = new Headers(opts.headers || undefined);
  headers.set("X-Request-Id", requestId);

  let body: BodyInit | undefined = opts.body as any;
  if (isPlainBody(opts.body)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(opts.body);
  }

  const method = (opts.method || (body !== undefined ? "POST" : "GET")).toUpperCase();
  const res = await fetch(path, { method, headers, body, signal: opts.signal });
  const echoedId = res.headers.get("X-Request-Id") || requestId;

  const json = await res.json().catch(() => null);

  if (json && typeof json === "object" && "ok" in (json as any)) {
    if ((json as any).ok === false) {
      throw new ApiError(
        String((json as any).error || `${res.status}`),
        res.status,
        echoedId,
        json
      );
    }
    return json as T;
  }

  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, res.status, echoedId, json);
  }
  return json as T;
}

/** GET のショートハンド。 */
export function apiGet<T = any>(
  path: string,
  opts: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...opts, method: "GET" });
}

/** POST/PATCH/PUT/DELETE のショートハンド(body は JSON or FormData)。 */
export function apiSend<T = any>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: Omit<ApiRequestOptions, "method" | "body"> = {}
): Promise<T> {
  return apiRequest<T>(path, { ...opts, method, body });
}
