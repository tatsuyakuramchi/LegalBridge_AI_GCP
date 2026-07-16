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
 *
 * Phase 6 (API・認証):
 *   VITE_API_SAME_ORIGIN=1 のとき、このインターセプタは休眠する。
 *   /api/* は相対パスのまま admin-ui オリジンへ届き、server.ts の BFF
 *   プロキシが同じ規則(src/lib/apiRoutingRules.ts)でサーバ側転送する。
 *   共有シークレットはサーバ側 env(LB_PORTAL_SECRET)のみが持ち、
 *   JS バンドルへの焼き込み(VITE_API_PORTAL_SECRET)は廃止。
 *   このファイルはロールバック用に残す(規則の実体は apiRoutingRules.ts)。
 *   凍結: 新しいルート規則は apiRoutingRules.ts にのみ追加すること。
 */

import {
  WRITE_PATHS_ON_GET,
  READ_PATHS_ON_GET,
  READ_PATHS_ON_POST,
} from "./apiRoutingRules";

const SAME_ORIGIN =
  String((import.meta as any).env?.VITE_API_SAME_ORIGIN || "") === "1";

const READ_URL = (import.meta as any).env?.VITE_API_READ_URL || "";
const WRITE_URL = (import.meta as any).env?.VITE_API_WRITE_URL || "";

// C1 (Phase 2): admin-ui の read を worker に寄せる切替フラグ。
//   "1" のとき GET(WRITE_PATHS_ON_GET 以外)を READ_URL ではなく WRITE_URL
//   (worker)へ振る。worker は read superset(C2 で 24 read 補完済み)。
//   既定 OFF=従来どおり READ_URL(search-api)= 可逆。
//   注: マスター書込(READ_PATHS_ON_POST の master/vendors 等)は D1「Search が
//   マスター書込を所有」に従い、本フラグでも引き続き READ_URL(search-api)へ。
const READS_TO_WORKER =
  String((import.meta as any).env?.VITE_API_READS_TO_WORKER || "") === "1";

// Phase 22: admin-ui が search-api/worker を直接 *.run.app URL で叩く際の
// 共有シークレット。search-api 側の requireIapUser middleware が
// X-LB-PORTAL-SECRET ヘッダを portal_secret fallback として受け入れる。
// 値は Cloud Build 時に Secret Manager (lb-portal-secret) から
// .env.production.local 経由で注入する。未設定なら header は付かない
// (= 旧来通り、IAP 経由のみ動作)。
const PORTAL_SECRET =
  (import.meta as any).env?.VITE_API_PORTAL_SECRET || "";

function resolveBaseUrl(method: string, path: string): string {
  if (!READ_URL && !WRITE_URL) return ""; // no config → pass through
  const m = method.toUpperCase();
  if (m === "GET") {
    if (WRITE_PATHS_ON_GET.some((re) => re.test(path))) return WRITE_URL;
    // worker にミラーが無い search-api 専用 read は常に READ_URL へ。
    if (READ_PATHS_ON_GET.some((re) => re.test(path))) return READ_URL;
    // C1: read を worker に寄せる(フラグ ON 時)。既定は READ_URL(search-api)。
    return READS_TO_WORKER ? WRITE_URL : READ_URL;
  }
  // マスター書込等(contract-check / master/vendors)は D1 に従い常に Search へ。
  if (READ_PATHS_ON_POST.some((re) => re.test(path))) return READ_URL;
  return WRITE_URL;
}

function isApiPath(value: string): boolean {
  return value.startsWith("/api/");
}

function installInterceptor() {
  if (typeof window === "undefined" || !window.fetch) return;
  // Phase 6: 同一オリジン(BFF プロキシ)モードでは monkey-patch を入れない。
  //   相対 /api/* がそのまま admin-ui オリジンへ届き、server.ts が転送する。
  if (SAME_ORIGIN) {
    console.info("[apiRouter] same-origin mode — interceptor disabled (BFF proxy owns routing)");
    return;
  }
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
