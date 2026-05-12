/**
 * legalbridge-document-worker
 *
 * Cloud Run service that owns:
 *   - Backlog webhook ingress (POST /api/webhooks/backlog)
 *   - Document generation (Docs / Excel / Drive)
 *   - Master-data writes (vendors, staff, contracts, rules, templates,
 *     workflow settings)
 *   - Workflow status transitions
 *
 * Independent of services/api — no shared code. DB schema is the only
 * contract between the two services.
 *
 * Operated by the Legal team. The /法務依頼 → Backlog → webhook →
 * document-generation pipeline lives entirely here.
 *
 * Routes are wired in Phase 2d (forthcoming commit). This stub exposes
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
    service: "legalbridge-document-worker",
    status: "ok",
    role: "read-write",
    timestamp: new Date().toISOString(),
  });
});

// Phase 2d will move the actual route handlers here from the top-level
// server.ts (Backlog webhook, document generation, master writes).
// Until then, /api/status is the only live endpoint.

app.listen(PORT, () => {
  console.log(`[document-worker] listening on :${PORT}`);
});
