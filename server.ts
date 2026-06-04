/**
 * legalbridge-admin-ui — static-only edition (Phase 2f-2)
 *
 * Before Phase 2 this file was a 2,000-line monolith that owned every
 * /api/* route, the Backlog webhook, document generation, Slack
 * notifications, and so on. All of that moved to:
 *
 *   - services/api/        → legalbridge-search-api      (reads)
 *   - services/worker/     → legalbridge-document-worker (writes + jobs)
 *
 * The Admin UI's apiRouter (src/lib/apiRouter.ts) intercepts client-
 * side fetch and dispatches to the new services directly. This server
 * is therefore now just a static-file host for the React bundle plus
 * a 410 fallback for any stale tab still asking this origin for /api/*.
 *
 * Next step (Phase 2f-3): move static hosting off Cloud Run entirely
 * (Firebase Hosting or GCS + Load Balancer) and retire this service.
 */

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const SEARCH_API_URL =
  "https://legalbridge-search-api-988056987352.asia-northeast1.run.app";
const DOCUMENT_WORKER_URL =
  "https://legalbridge-document-worker-988056987352.asia-northeast1.run.app";

// 統合 Phase 2: admin-ui を「管理者(app_role=admin)専用エディタ」にするための
//   IAP 身元ゲート。admin-ui を IAP 配下に置くと x-goog-authenticated-user-email
//   が必ず入るので、それを read して app_role を search-api に問い合わせ、admin
//   以外は 403(検索ポータルへ誘導)。viewer は search-api ポータルを使う。
//
//   ADMIN_UI_ENFORCE_ROLE=true のときだけ enforce(既定 OFF=従来どおり全通し)。
//   IAP 配下化 + env 設定が揃ってから ON にすれば安全に切り替えられる。
const ENFORCE_ROLE =
  String(process.env.ADMIN_UI_ENFORCE_ROLE || "").toLowerCase() === "true";

/** IAP ヘッダ(or DEV_AS_USER)からメールを取り出す。 */
function iapEmail(req: express.Request): string | null {
  const raw = String(req.header("x-goog-authenticated-user-email") || "");
  const m = raw.match(/^accounts\.google\.com:(.+)$/);
  if (m && m[1]) return m[1].trim().toLowerCase();
  if (raw) return raw.trim().toLowerCase();
  if (process.env.DEV_AS_USER) return String(process.env.DEV_AS_USER).toLowerCase();
  return null;
}

/** search-api に email の app_role を問い合わせる(portal_secret で保護)。 */
async function resolveRole(email: string): Promise<"admin" | "viewer"> {
  try {
    const url = `${SEARCH_API_URL}/api/staff/role?email=${encodeURIComponent(email)}`;
    const r = await fetch(url, {
      headers: { "x-lb-portal-secret": process.env.LB_PORTAL_SECRET || "" },
    });
    if (!r.ok) return "viewer";
    const j: any = await r.json();
    return j?.role === "admin" ? "admin" : "viewer";
  } catch (err) {
    console.warn("[admin-ui] resolveRole failed:", err);
    return "viewer";
  }
}

/** admin 以外に見せる 403 ページ(検索ポータルへ誘導)。 */
function denyPage(email: string | null): string {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>アクセス権がありません</title>
<style>body{font-family:-apple-system,"Hiragino Sans",sans-serif;max-width:560px;margin:64px auto;padding:0 24px;color:#241f3a}
h1{font-size:20px}a{color:#6c5ce7;font-weight:700}.box{background:#f6f3ff;border:1px solid #e2dbfb;border-radius:14px;padding:18px 20px;margin-top:16px}</style>
</head><body>
<h1>admin-ui は管理者専用です</h1>
<div class="box">
<p>このアプリ(編集・文書生成)は <b>app_role=admin</b> のユーザーのみ利用できます。</p>
<p>検索・閲覧は <a href="${SEARCH_API_URL}/">検索ポータル</a> をご利用ください。</p>
<p style="color:#8a86a3;font-size:12px;margin-top:14px">ログイン: ${email || "(unknown)"}</p>
</div>
<p style="margin-top:18px"><a href="${SEARCH_API_URL}/">→ 検索ポータルを開く</a></p>
</body></html>`;
}

async function startServer() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  console.log("🚀 Starting legalbridge-admin-ui (slim, static-only)…");
  console.log(`   Read routes  → ${SEARCH_API_URL}`);
  console.log(`   Write routes → ${DOCUMENT_WORKER_URL}`);

  // Simple request logger (skip noisy asset URLs).
  app.use((req, _res, next) => {
    if (!req.url.startsWith("/dist") && !req.url.startsWith("/assets")) {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    }
    next();
  });

  // Health probe.
  app.get("/api/status", (_req, res) => {
    res.json({
      service: "legalbridge-admin-ui",
      status: "ok",
      role: "static-host",
      apiRoutes: "moved to search-api / document-worker",
      timestamp: new Date().toISOString(),
    });
  });

  // Any other /api/* hit means a stale client tab is still using the
  // old bundle (its apiRouter wasn't loaded yet). Return 410 with a
  // pointer to the new services so the failure is observable and the
  // user can refresh.
  app.all("/api/*", (req, res) => {
    console.warn(
      `⚠️ Stale client hit deprecated /api/* on admin-ui: ${req.method} ${req.url}`
    );
    res.status(410).json({
      ok: false,
      error:
        "This endpoint moved in Phase 2. Hard-refresh the Admin UI " +
        "(Ctrl/Cmd+Shift+R) to pick up the apiRouter that dispatches to " +
        "legalbridge-search-api / legalbridge-document-worker.",
      newServices: {
        reads: SEARCH_API_URL,
        writes: DOCUMENT_WORKER_URL,
      },
    });
  });

  // 統合 Phase 2: React Topbar が実ユーザー(email/role)を表示するための
  //   同一オリジンエンドポイント。IAP ヘッダから email を取り、role を解決。
  app.get("/whoami", async (req, res) => {
    const email = iapEmail(req);
    const role = email ? await resolveRole(email) : "viewer";
    res.json({ email, role, enforce: ENFORCE_ROLE });
  });

  // 統合 Phase 2: admin 限定ゲート(ENFORCE_ROLE=true のときのみ)。
  //   トップレベルのページ遷移(HTML)だけを対象にし、assets/api/whoami/
  //   拡張子付き静的ファイルは通す。admin 以外は 403(検索ポータルへ誘導)。
  app.use(async (req, res, next) => {
    if (!ENFORCE_ROLE) return next();
    if (req.method !== "GET") return next();
    if (
      req.path.startsWith("/assets") ||
      req.path.startsWith("/api") ||
      req.path === "/whoami" ||
      path.extname(req.path) // favicon.ico / sw.js 等
    ) {
      return next();
    }
    const email = iapEmail(req);
    if (!email) {
      return res
        .status(401)
        .type("html")
        .send(denyPage(null));
    }
    const role = await resolveRole(email);
    if (role === "admin") return next();
    return res.status(403).type("html").send(denyPage(email));
  });

  // ── Static / SPA serving ───────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Hashed build assets carry their content hash in the filename, so
    // they are safe to cache aggressively.
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        maxAge: "1y",
        immutable: true,
      })
    );

    // Other static files (favicons, manifest, etc.). Skip index.html so
    // the SPA fallback below owns it and can set its own cache headers.
    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate"
            );
          }
        },
      })
    );

    // Defensively clean up any service worker registered by a previous
    // deployment. If a client requests `/sw.js` (or similar) and we no
    // longer ship one, return a no-op script that immediately
    // unregisters itself so users stuck on a stale cached worker recover
    // automatically.
    app.get(["/sw.js", "/service-worker.js", "/serviceworker.js"], (_req, res) => {
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(
        "self.addEventListener('install',()=>{self.skipWaiting()});" +
          "self.addEventListener('activate',e=>{e.waitUntil(self.registration.unregister().then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url))))});"
      );
    });

    // SPA fallback. Never cache index.html — every navigation must
    // revalidate so a freshly deployed bundle is picked up immediately.
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[admin-ui] listening on :${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
