# LegalBridge Cloud Run services

This directory hosts the two Cloud Run services that replaced the
legacy monolithic `legalbridge-admin-ui` deployment. They share no
code and depend only on the PostgreSQL schema as the integration
contract.

| Service | Directory | Role | Owner | Cloud Build |
| --- | --- | --- | --- | --- |
| `legalbridge-search-api` | `services/api/` | **Read-only.** DB queries for Slack `/法務検索`, Admin UI master/dashboard reads, Backlog lookups. | IT / platform | `cloudbuild-api.yaml` (trigger: push to `release/api`) |
| `legalbridge-document-worker` | `services/worker/` | **Read-write.** Backlog webhook ingress, document generation, master-data writes, workflow status transitions. | Legal | `cloudbuild-worker.yaml` (trigger: push to `release/worker`) |

## Branch / deploy strategy (option A)

```
main                  ← integration; PRs land here
├── release/api       ← push → Cloud Build → legalbridge-search-api
└── release/worker    ← push → Cloud Build → legalbridge-document-worker
```

To deploy:

```bash
# Deploy API
git checkout release/api && git merge main && git push origin release/api

# Deploy Worker
git checkout release/worker && git merge main && git push origin release/worker
```

`CODEOWNERS` should pin `services/api/**` to IT reviewers and
`services/worker/**` to Legal reviewers.

## DB roles (recommended)

| Role | Used by | Privileges |
| --- | --- | --- |
| `lb_read` | `legalbridge-search-api` | `SELECT` on all tables |
| `lb_write` | `legalbridge-document-worker` | `SELECT, INSERT, UPDATE, DELETE` on all tables |

Even if a SQL injection bug ever lands in `services/api/`, it cannot
mutate data — the connection role refuses anything outside `SELECT`.

## No shared code

These services are intentionally independent. Common utilities
(`src/lib/db.ts`, `src/services/*.ts`) are duplicated, not imported.
If you change a duplicated file:

1. Apply the change to **both** copies.
2. Note in the commit message which services need the change.
3. Pull request reviewers from both teams should sign off.

The duplication cost is small (~600 lines today) compared to the
ownership clarity it preserves.

## Local development

Each service runs standalone:

```bash
# In services/api/
npm install
npm run dev          # → tsx server.ts on :8080

# In services/worker/  (different terminal)
npm install
npm run dev
```

Set the relevant env vars locally (`DATABASE_URL`, `LB_PORTAL_SECRET`,
`BACKLOG_*`, `SLACK_BOT_TOKEN`, `GOOGLE_*` etc.). See `.env.example`
at the repo root.

## Migration status (2026-05)

- [x] Phase 1: GAS dead-code cleanup (`forwardLegalRequest_` et al)
- [x] Phase 2a/b: Scaffolding + service file copies
- [ ] Phase 2c: Move read endpoints from top-level `server.ts` → `services/api/server.ts`
- [ ] Phase 2d: Move write/webhook/doc-gen endpoints → `services/worker/server.ts`
- [ ] Phase 2e: Wire Cloud Build triggers on `release/api` / `release/worker`
- [ ] Phase 2f: Decommission top-level `server.ts`, `Dockerfile`, `cloudbuild.yaml`

Top-level `server.ts` continues to be the production source of truth
until Phase 2c–2d land and the new Cloud Run services are validated.
