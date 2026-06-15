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

// Routes that should go to the WRITE service even on GET.
const WRITE_PATHS_ON_GET: RegExp[] = [
  // CloudSign 送信履歴 GET は worker のみ実装。READ_PATHS_ON_GET の
  //   /api/contracts/\d+ より先に評価されるのでここで WRITE に明示する。
  /^\/api\/contracts\/\d+\/cloudsign(?:\/|\?|$)/,
  // 課題の CloudSign ルート/まとめ送信(GET route)は worker のみ実装。
  /^\/api\/issues\/[^/]+\/cloudsign(?:\/|\?|$)/,
  // ラインIDでの明細 lookup は worker のみ実装。
  /^\/api\/line-items(?:\/|\?|$)/,
  // CloudSign の接続テスト(/api/cloudsign/health)等の GET も worker のみ実装。
  /^\/api\/cloudsign(?:\/|\?|$)/,
  /^\/api\/templates(?:\/|$)/,
  /^\/api\/master\/workflow-settings(?:\/|$)/,
  /^\/api\/numbering(?:\/|$)/,
  // Phase 10: CSV テンプレ DL は worker に常駐 (text/csv レスポンス)
  /^\/api\/imports\/bulk\/templates(?:\/|$)/,
  /^\/api\/imports\/bulk\/inspection\/trigger-waiting\.csv(?:\?|$)/,
  // 統合修正: v2 一括取込のテンプレ DL も worker のみが提供する(GET)。
  //   これが無いと READ(search-api)へ振られて 404(発注書等のサンプルCSVが落ちない)。
  /^\/api\/imports\/v2\/templates(?:\/|\?|$)/,
  // データモデル整理: 連結チェック(整合性点検)は worker のみ実装。
  /^\/api\/admin\/data-linkage\/check(?:\?|$)/,
  // Phase 15/16: 個別ドキュメント取得 + PDF 未作成キューは worker のみ
  // (form_data 全件返却 + jsonb 操作のため)
  /^\/api\/documents\/pending-pdf(?:\?|$)/,
  // Excel バッチ出力キュー (未発行集計) は worker のみ実装 (form_data 集計)。
  /^\/api\/excel-batches\/pending(?:\?|$)/,
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
  // Phase 23.6.12: /api/management/* は worker のみに実装。
  //   GET /api/management/issues/:issueKey/line-items (WorkflowPanel)
  //   PATCH /api/management/order-line-items/:id/deadline
  //   PATCH /api/management/issues/:issueKey/deadline
  //   POST  /api/management/issues/:issueKey/deadline-change
  //   GET   /api/management/alerts / /api/management/deliveries は
  //         api/server.ts にも mirror がある (上書きされて WRITE に行く)
  //         が、search-api 経路でも問題ないので broaden しない。
  //   ここでは line-items GET を WRITE に明示的に振る。
  /^\/api\/management\/issues\/[^/]+\/line-items(?:\?|$|\/)/,
];

// Routes that must ALWAYS go to the READ service (search-api) on GET, even when
// READS_TO_WORKER=1. worker にミラーが無い search-api 専用 read のため、ここで
// 明示しないと READS_TO_WORKER 時に worker へ振られて 404 になる。
//   - /api/contracts/search  : 親契約 picker (registerContractsV2)
//   - /api/contracts/:id      : 契約詳細 (registerContractsV2)
const READ_PATHS_ON_GET: RegExp[] = [
  /^\/api\/contracts\/search(?:\?|$)/,
  /^\/api\/contracts\/\d+(?:\/|\?|$)/,
  // 統合 P3-2: 条件明細横断検索は search-api 専用 read。
  /^\/api\/conditions(?:\/|\?|$)/,
  // 紐付け編集モーダルのピッカー(原作/作品/契約)も search-api 専用 read。
  /^\/api\/v3\/(?:source-ips|works|contracts)(?:\/|\?|$)/,
  // 統合 P3-5: 作品モデル CSV サンプル(template)も search-api 専用 read。
  /^\/api\/v3\/import\/[^/]+\/template\.csv(?:\?|$)/,
  // 統合 P3-3: 請求権受領(sublicense)は search-api 専用。read/CSV を含む。
  /^\/api\/sublicense(?:\/|\?|$)/,
  // 統合 P3-4: 分配構造マップ(receivable-map)と作品別名(aliases)read。
  /^\/api\/receivable-map(?:\/|\?|$)/,
  /^\/api\/works\/\d+\/aliases(?:\?|$)/,
];

// Routes that should go to the READ service even on POST.
const READ_PATHS_ON_POST: RegExp[] = [  /^\/api\/contract-check(?:\/|$)/,
  // Phase 25.1: 取引先 upsert は search-api の正規実装 (住所/口座 1:N +
  //   数値正規化 + トランザクション) を本体とする。admin-ui の保存 (POST
  //   /api/master/vendors の完全一致のみ) を search-api へ振り、worker の簡易
  //   二重実装は使わない。サブパス (/:code 詳細 GET, /import-csv,
  //   /upload-change-request の multipart) は対象外なので末尾を厳密に判定。
  /^\/api\/master\/vendors(?:\?|$)/,
  // 統合 Phase 3: スタッフ役割変更 (PATCH /api/master/staff/:email/role) は
  //   search-api の正規実装(staff.app_role 更新 + 監査ログ)を本体とする。
  //   apiRouter は既定で PATCH を worker へ振るため、ここで READ_URL(search-api)
  //   へ明示する。portal_secret 経由で requireAppRole を無条件通過する。
  /^\/api\/master\/staff\/[^/]+\/role(?:\?|$)/,
  // 統合 P3-2: 条件明細の紐付け更新 (PUT /api/conditions/:id/links) は
  //   search-api の正規実装。apiRouter は既定で PUT を worker へ振るため明示。
  /^\/api\/conditions\/\d+\/links(?:\?|$)/,
  // 統合 P3-3: 請求権受領(sublicense)の書込(deals/reports/receipts/import)も
  //   全て search-api 正規実装へ。
  /^\/api\/sublicense(?:\/|\?|$)/,
  // 統合 P3-4: 作品別名(タイトル名寄せ)の追加/削除は search-api 正規実装へ。
  /^\/api\/works\/\d+\/aliases(?:\?|$)/,
  /^\/api\/work-aliases\/\d+(?:\?|$)/,
  // 統合 P3-5: 作品モデル(v3)の write(POST/PUT/import)は search-api 正規実装へ。
  /^\/api\/v3\//,
];

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
