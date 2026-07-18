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
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { resolveApiTarget } from "./src/lib/apiRoutingRules.ts";

dotenv.config();

const SEARCH_API_URL =
  process.env.API_READ_URL ||
  "https://legalbridge-search-api-988056987352.asia-northeast1.run.app";
const DOCUMENT_WORKER_URL =
  process.env.API_WRITE_URL ||
  "https://legalbridge-document-worker-988056987352.asia-northeast1.run.app";

// C1 フラグのサーバ側等価物(既定 ON = 現行バンドルの VITE_API_READS_TO_WORKER=1 と同じ)。
const READS_TO_WORKER =
  String(process.env.API_READS_TO_WORKER ?? "1") === "1";

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

  // CLEAN-06: deprecated route アクセス計測。クライアントの DeprecatedRedirect が
  //   旧 URL 到達時に sendBeacon で叩く。DB は持たず、構造化ログを stdout に出して
  //   Cloud Logging で集計する(旧 URL がいつまで踏まれ続けるか=リダイレクト撤去の判断材料)。
  //   注: この定義は下の app.all("/api/*") プロキシより前に置くこと(でないと上流へ転送される)。
  app.post("/api/_client-telemetry/deprecated-route", (req, res) => {
    const from = String(req.query.from || "").slice(0, 256);
    const to = String(req.query.to || "").slice(0, 256);
    console.log(
      `[deprecated-route] ${new Date().toISOString()} from=${from} to=${to} ` +
        `referer=${String(req.headers["referer"] || "").slice(0, 256)}`
    );
    res.status(204).end();
  });

  // ── Phase 6: 同一オリジン BFF プロキシ ────────────────────────────
  // ブラウザは相対 /api/* を叩く(バンドルは VITE_API_SAME_ORIGIN=1 で
  // monkey-patch 休眠)。ここで src/lib/apiRoutingRules.ts の規則により
  // search-api(read) / document-worker(write) へストリーミング転送する。
  // 共有シークレット(LB_PORTAL_SECRET)はサーバ側 env のみが持ち、
  // JS バンドルへの焼き込みは廃止(Phase 22 の VITE_API_PORTAL_SECRET)。
  // multipart / CSV / PDF もそのまま pipe する(body parser は挟まない)。
  const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  // ENFORCE_ROLE=true のとき、/api プロキシも HTML と同様に admin 限定にする
  // (60 秒キャッシュ)。OFF(既定)は従来どおり素通し(=旧バンドル内シークレットと同等)。
  const roleCache = new Map<string, { role: "admin" | "viewer"; exp: number }>();
  const resolveRoleCached = async (email: string): Promise<"admin" | "viewer"> => {
    const hit = roleCache.get(email);
    if (hit && hit.exp > Date.now()) return hit.role;
    const role = await resolveRole(email);
    roleCache.set(email, { role, exp: Date.now() + 60_000 });
    return role;
  };
  app.all("/api/*", async (req, res) => {
    if (ENFORCE_ROLE) {
      const email = iapEmail(req);
      if (!email) {
        return res.status(401).json({ ok: false, error: "unauthorized (no identity)" });
      }
      const role = await resolveRoleCached(email);
      if (role !== "admin") {
        return res.status(403).json({ ok: false, error: "forbidden (admin only)" });
      }
    }
    // 相関ID(§8): クライアント(httpClient)が付けた X-Request-Id を引き継ぎ、
    //   無ければ採番する。上流へ転送し、レスポンスにも echo し、ログにも出す。
    //   これで admin-ui / search-api / worker のログを 1 リクエストで突き合わせられる。
    const reqId =
      String(req.headers["x-request-id"] || "").trim() || randomUUID();

    let base: string;
    let target: "read" | "write";
    try {
      target = resolveApiTarget(req.method, req.originalUrl, READS_TO_WORKER);
      base = target === "read" ? SEARCH_API_URL : DOCUMENT_WORKER_URL;
    } catch (err) {
      console.error(`[api-proxy] rid=${reqId} target resolution failed:`, err);
      return res.status(502).json({ ok: false, error: "proxy target resolution failed" });
    }
    const url = new URL(base.replace(/\/+$/, "") + req.originalUrl);

    const headers: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      const lk = k.toLowerCase();
      if (HOP_BY_HOP.has(lk) || lk === "host") continue;
      headers[k] = v;
    }
    headers["x-request-id"] = reqId;
    // 内部認証: サーバ側 env の共有シークレットを付与(クライアント指定は上書き)。
    // search-api の requireIapUser が portal_secret fallback として受け入れる。
    if (process.env.LB_PORTAL_SECRET) {
      headers["x-lb-portal-secret"] = process.env.LB_PORTAL_SECRET;
    } else {
      delete headers["x-lb-portal-secret"];
    }
    headers["host"] = url.host;

    const requestFn = url.protocol === "http:" ? httpRequest : httpsRequest;
    const upstream = requestFn(
      url,
      { method: req.method, headers },
      (up) => {
        res.status(up.statusCode || 502);
        for (const [k, v] of Object.entries(up.headers)) {
          if (v == null || HOP_BY_HOP.has(k.toLowerCase())) continue;
          res.setHeader(k, v as any);
        }
        res.setHeader("x-request-id", reqId);
        up.pipe(res);
      }
    );
    // Cloud Run の admin-ui timeout(300s)より僅かに短く上流を打ち切る。
    upstream.setTimeout(290_000, () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      console.error(
        `[api-proxy] rid=${reqId} ${req.method} ${req.originalUrl} → ${target}(${url.host}) failed:`,
        err
      );
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: "upstream request failed" });
      } else {
        res.end();
      }
    });
    req.pipe(upstream);
    req.on("aborted", () => upstream.destroy());
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
