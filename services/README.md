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
- [x] Phase 2c: Read endpoints moved to `services/api/server.ts`
- [x] Phase 2d-1: Webhook + master writes moved to `services/worker/server.ts`
- [x] Phase 2d-2: Document generation, templates, workflow-settings, CSV import migrated (no more HTTP 501 stubs in worker)
- [x] Phase 2e: Cloud Build triggers wired on `release/api` / `release/worker`
- [x] `/法務検索` cutover to `legalbridge-search-api` (GAS `CLOUD_RUN_BASE_URL` switched)
- [x] Backlog webhook cutover to `legalbridge-document-worker`
- [ ] **Admin UI cutover**: point browser to new services (search-api for reads, document-worker for writes)
- [ ] Phase 2f: Decommission `legalbridge-admin-ui`, top-level `server.ts`, `Dockerfile`, `cloudbuild.yaml`

The new services are now feature-complete and capable of serving every
route the Admin UI uses. Top-level `server.ts` (legalbridge-admin-ui)
remains live as a hot fallback until the Admin UI is repointed and
several days of clean monitoring have passed.

## Phase 2e: Cloud Build trigger setup

Run these once in GCP Cloud Build to wire the release-branch triggers
(this is operational config, not code in the repo):

```bash
PROJECT=your-gcp-project-id
REPO_OWNER=tatsuyakuramchi
REPO_NAME=LegalBridge_AI_GCP

# Trigger for legalbridge-search-api
gcloud builds triggers create github \
  --project=$PROJECT \
  --name=legalbridge-search-api-release \
  --repo-owner=$REPO_OWNER \
  --repo-name=$REPO_NAME \
  --branch-pattern='^release/api$' \
  --build-config=cloudbuild-api.yaml

# Trigger for legalbridge-document-worker
gcloud builds triggers create github \
  --project=$PROJECT \
  --name=legalbridge-document-worker-release \
  --repo-owner=$REPO_OWNER \
  --repo-name=$REPO_NAME \
  --branch-pattern='^release/worker$' \
  --build-config=cloudbuild-worker.yaml
```

Initial deploy:

```bash
# Push current main contents to release branches to fire the triggers.
git checkout release/api && git merge main && git push origin release/api
git checkout release/worker && git merge main && git push origin release/worker
```

After both Cloud Run services are deployed and respond on
`/api/status`, switch consumer URLs:

1. **GAS Slack Gateway** — update `CLOUD_RUN_BASE_URL` script property
   to the new `legalbridge-search-api` URL.
2. **Backlog Webhook** — update the webhook URL to the new
   `legalbridge-document-worker` `/api/webhooks/backlog`.
3. **Admin UI** — point reads to `legalbridge-search-api`, writes to
   `legalbridge-document-worker` (will require an env var split or
   reverse proxy; defer until Phase 2d-2 lands so the worker covers
   every write route the UI uses).

## DB read-only role (Phase 2 hardening)

Once `legalbridge-search-api` is stable, create a read-only Postgres
role for it:

```sql
CREATE ROLE lb_read WITH LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE legalbridge TO lb_read;
GRANT USAGE ON SCHEMA public TO lb_read;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lb_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lb_read;
```

Then bind `DATABASE_URL` for the `legalbridge-search-api` Cloud Run
revision to use `lb_read`. The worker keeps the existing read-write
role.
