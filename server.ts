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
