/**
 * apiRouter — global fetch interceptor that dispatches /api/* requests
 * to the appropriate Cloud Run service.
 *
 * Why a monkey-patch and not a wrapper function?
 *   The Admin UI has ~60 `fetch("/api/...")` call sites spread across
 *   10+ files. Migrating each one to a wrapper would be tedious and
 *   fragile (one missed call site silently calls the old service).
 *   Patching `window.fetch` once at startup catches every existing
 *   call site without touching their source. Pure fetch behaviour is
 *   preserved for any non-/api URL.
 *
 * Routing rules:
 *   - GET on /api/templates/**, /api/master/workflow-settings,
 *     /api/numbering/** → WRITE_URL (these endpoints either read
 *     state owned by the worker — template files on disk — or
 *     increment sequences, so they live with the writer).
 *   - POST on /api/contract-check/** → READ_URL (semantically a
 *     query, despite the POST verb; it's served by the read-only
 *     search-api).
 *   - All other GETs → READ_URL
 *   - All other mutations (POST/PUT/PATCH/DELETE) → WRITE_URL
 *
 * Configuration:
 *   Vite picks up `VITE_API_READ_URL` and `VITE_API_WRITE_URL` from
 *   the build environment. If neither is set, fetch is left as-is
 *   (useful when serving from the legacy monolith — every /api/*
 *   request just stays on the current origin).
 */

const READ_URL = (import.meta as any).env?.VITE_API_READ_URL || "";
const WRITE_URL = (import.meta as any).env?.VITE_API_WRITE_URL || "";

// Phase 22: admin-ui が search-api/worker を直接 *.run.app URL で叩く際の
// 共有シークレット。search-api 側の requireIapUser middleware が
// X-LB-PORTAL-SECRET ヘッダを portal_secret fallback として受け入れる。
// 値は Cloud Build 時に Secret Manager (lb-portal-secret) から
// .env.production.local 経由で注入する。未設定なら header は付かない
// (= 旧来通り、IAP 経由のみ動作)。
const PORTAL_SECRET =
  (import.meta as any).env?.VITE_API_PORTAL_SECRET || "";

// Routes that should go to the WRITE service even on GET.
const WRITE_PATHS_ON_GET: RegExp[] = [
  /^\/api\/templates(?:\/|$)/,
  /^\/api\/master\/workflow-settings(?:\/|$)/,
  /^\/api\/numbering(?:\/|$)/,
  // Phase 10: CSV テンプレ DL は worker に常駐 (text/csv レスポンス)
  /^\/api\/imports\/bulk\/templates(?:\/|$)/,
  /^\/api\/imports\/bulk\/inspection\/trigger-waiting\.csv(?:\?|$)/,
  // Phase 15/16: 個別ドキュメント取得 + PDF 未作成キューは worker のみ
  // (form_data 全件返却 + jsonb 操作のため)
  /^\/api\/documents\/pending-pdf(?:\?|$)/,
  /^\/api\/documents\/by-number\/(?:\/|\?|$|.)/,
  /^\/api\/documents\/\d+(?:\/|\?|$)/,
  // Phase 22.21.48 / 22.21.59: 部分検索エンドポイントも worker のみ実装。
  //   旧仕様の by-number (完全一致) と違い、search-api 側にミラーが無いので
  //   明示的に WRITE 経路にルーティングしないと search-api で 404 になる。
  /^\/api\/documents\/search(?:\?|$|\/)/,
  // Phase 17: 稟議マスタの read/write は worker (junction テーブル含む)
  /^\/api\/ringi(?:\/|$|\?)/,
  // Phase 22.21.79: 文書 draft (一時保存) は worker のみで GET/POST/DELETE
  //   admin-ui DocumentEditorPage の「DBSYNC」ボタンと
  //   閲覧/編集モードトグル時に直叩きする。
  /^\/api\/document-drafts(?:\/|$|\?)/,
];

// Routes that should go to the READ service even on POST.
const READ_PATHS_ON_POST: RegExp[] = [
  /^\/api\/contract-check(?:\/|$)/,
];

function resolveBaseUrl(method: string, path: string): string {
  if (!READ_URL && !WRITE_URL) return ""; // no config → pass through
  const m = method.toUpperCase();
  if (m === "GET") {
    if (WRITE_PATHS_ON_GET.some((re) => re.test(path))) return WRITE_URL;
    return READ_URL;
  }
  if (READ_PATHS_ON_POST.some((re) => re.test(path))) return READ_URL;
  return WRITE_URL;
}

function isApiPath(value: string): boolean {
  return value.startsWith("/api/");
}

function installInterceptor() {
  if (typeof window === "undefined" || !window.fetch) return;
  if ((window as any).__legalbridgeApiRouterInstalled) return;
  (window as any).__legalbridgeApiRouterInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    try {
      let urlString: string;
      let method: string;

      if (typeof input === "string") {
        urlString = input;
        method = (init?.method as string) || "GET";
      } else if (input instanceof URL) {
        urlString = input.toString();
        method = (init?.method as string) || "GET";
      } else {
        // Request object
        urlString = (input as Request).url || "";
        method = (input as Request).method || (init?.method as string) || "GET";
      }

      if (isApiPath(urlString)) {
        const base = resolveBaseUrl(method, urlString);
        if (base) {
          const newUrl = base.replace(/\/+$/, "") + urlString;

          // Phase 22: portal secret ヘッダを必ず付与 (search-api side で
          // requireIapUser middleware が fallback として受け入れる)。
          // 未設定なら付与しない (= IAP 経由のみで動く旧挙動)。
          const newInit: RequestInit = init ? { ...init } : {};
          if (PORTAL_SECRET) {
            const merged = new Headers(init?.headers || undefined);
            // 既に X-LB-PORTAL-SECRET が呼び出し側で指定されていれば上書きしない
            if (!merged.has("X-LB-PORTAL-SECRET")) {
              merged.set("X-LB-PORTAL-SECRET", PORTAL_SECRET);
            }
            newInit.headers = merged;
          }

          if (typeof input === "string" || input instanceof URL) {
            return originalFetch(newUrl, newInit);
          }
          // Reconstruct Request with the new URL (rare path).
          return originalFetch(new Request(newUrl, input as Request));
        }
      }
    } catch (err) {
      console.warn("apiRouter passthrough due to error:", err);
    }
    return originalFetch(input as any, init);
  };

  if (READ_URL || WRITE_URL) {
    console.info(
      "[apiRouter] installed. read=%s write=%s",
      READ_URL || "(passthrough)",
      WRITE_URL || "(passthrough)"
    );
  }
}

installInterceptor();

export {};
