/**
 * legalbridge-search-api
 *
 * Read-only Cloud Run service that fronts the LegalBridge PostgreSQL DB.
 * Owns NO write endpoints — all mutations live in services/worker/.
 *
 * Consumers:
 *   - Slack Gateway GAS  → POST /api/contract-check/search   (法務検索)
 *   - Admin UI (browser) → GET  /api/master/* (vendors, staff, contracts, rules)
 *                          GET  /api/management/* (dashboards)
 *                          GET  /api/backlog/* (issue lookups)
 *
 * Security stance:
 *   - The Cloud Run revision is configured with DATABASE_URL pointing to
 *     a PostgreSQL ROLE that holds SELECT-only privileges. Even if an
 *     injection bug slipped in, this process cannot mutate data.
 *   - /api/contract-check/* is gated by the X-LB-PORTAL-SECRET header
 *     (LB_PORTAL_SECRET env var), matching Slack Gateway's egress.
 *
 * Routes are wired in Phase 2c (forthcoming commit). This stub exposes
 * /api/status only so the Cloud Build pipeline can deploy and traffic
 * the revision without depending on the route migration completing.
 */

import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.get("/api/status", (_req, res) => {
  res.json({
    service: "legalbridge-search-api",
    status: "ok",
    role: "read-only",
    timestamp: new Date().toISOString(),
  });
});

// Phase 2c will move the actual route handlers here from the top-level
// server.ts. Until then, /api/status is the only live endpoint.

app.listen(PORT, () => {
  console.log(`[search-api] listening on :${PORT}`);
});
