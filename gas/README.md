# LegalBridge Slack Gateway (Google Apps Script)

`gas/Code.gs` is the Slack-side entry point for the LegalBridge platform.
It receives `/法務依頼` and `/法務検索` slash commands plus all interactivity
payloads (modal submissions, radio-button changes), and forwards the heavy
lifting to the LegalBridge Cloud Run service via two internal HTTP
endpoints:

| Slack action | GAS calls |
| --- | --- |
| `/法務依頼` slash command | `views.open` directly via Slack Web API |
| Modal `legal_request_modal` submit | `POST /api/internal/slack/legal-request` |
| Modal `request_type_input` change | `views.update` directly via Slack Web API |
| `/法務検索` slash command | opens the search modal directly via Slack Web API |
| Modal `legal_search_modal` submit | Backlog `/api/v2/issues` + Cloud Run `/api/contract-check/search` IN PARALLEL via `UrlFetchApp.fetchAll` |

This split lets us decommission the `legalbridge-slack-gateway` Cloud Run
service entirely — Slack talks to the GAS web app, GAS talks to the
remaining LegalBridge Cloud Run service.

---

## 1. Create the Apps Script project

1. Open <https://script.google.com> and click **New project**.
2. Replace the boilerplate `Code.gs` with the contents of this directory's
   [`Code.gs`](./Code.gs).
3. Save with ⌘S / Ctrl-S. Name the project something like
   `LegalBridge Slack Gateway`.

> Tip: the `clasp` CLI works too — `clasp push` after `clasp clone <id>`.

## 2. Configure script properties

In the Apps Script editor open **Project Settings → Script Properties** and
add:

| Key | Value | Used by |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | `xoxb-...` (the bot user token of the LegalBridge Slack app — `chat:write`, `commands`, `views:read/write` scopes) | All Slack actions |
| `CLOUD_RUN_BASE_URL` | `https://legalbridge-admin-ui-988056987352.asia-northeast1.run.app` (no trailing slash) | `/法務依頼` POST + `/法務検索` contract-status lookup |
| `LB_PORTAL_SECRET` | Shared secret used by `X-LB-PORTAL-SECRET` header on Cloud Run portal endpoints (same value as Contract-Status GAS) | `/法務検索` contract-status lookup |
| `BACKLOG_HOST` | `arclight.backlog.com` | `/法務検索` direct Backlog calls |
| `BACKLOG_API_KEY` | The Backlog personal API key | `/法務検索` direct Backlog calls |
| `BACKLOG_PROJECT_KEY` | `LEGAL` | `/法務検索` direct Backlog calls |
| `SLACK_SIGNING_SECRET` | *(optional, currently unused — see "Signature verification" below)* | reserved |

> **Architecture note (2026-05)**: contract-status lookups previously hopped
> through the Contract-Status GAS Web App (`CONTRACT_STATUS_WEBAPP_URL`),
> which itself proxied to Cloud Run. That double hop routinely pushed
> `/法務検索` past Slack's 3-second budget (observed: 7.5s end-to-end). The
> Slack Gateway now calls Cloud Run's `/api/contract-check/search`
> directly, eliminating one GAS-to-GAS hop. `CONTRACT_STATUS_WEBAPP_URL`
> is no longer required.

> **Contract-Status integration**: the `/法務検索` modal fans out to both
> Backlog (issues) and Cloud Run's `/api/contract-check/search` endpoint.
> The Contract-Status GAS Web App is no longer in the request path — see
> the architecture note above.

These are read at runtime via `PropertiesService.getScriptProperties()`,
so you can rotate any token / key without redeploying.

> **Why does `/法務検索` need its own Backlog credentials in GAS?**
> The search flow used to hop through Cloud Run, but it now calls
> `https://<BACKLOG_HOST>/api/v2/issues?keyword=…` directly via
> `UrlFetchApp`. That keeps the entire search path inside GAS, so
> Cloud Run is only on the `/法務依頼` intake path. Use the *same*
> Backlog API key that Cloud Run uses, or a separate one with at
> least read access to the LEGAL project.

## 3. Deploy as a Web App

1. **Deploy → New deployment → Type → Web app**.
2. **Description**: `LegalBridge Slack Gateway`.
3. **Execute as**: *Me* (the owner account).
4. **Who has access**: *Anyone* (Slack posts unauthenticated; we rely on
   Slack's signature for trust — see below).
5. Click **Deploy** and copy the resulting URL — looks like
   `https://script.google.com/macros/s/AKfy.../exec`.

When you change `Code.gs`, **Deploy → Manage deployments → ✏️** to update
the existing deployment instead of creating a new URL.

## 4. Wire Slack to the deployment URL

In <https://api.slack.com/apps> for the LegalBridge app:

### Slash Commands

| Command | Request URL |
| --- | --- |
| `/法務依頼` | the deployment URL |
| `/法務検索` | the deployment URL |

The same URL handles both — `Code.gs` switches on `e.parameter.command`.

### Interactivity & Shortcuts

- Toggle **Interactivity** on
- **Request URL**: the deployment URL

### OAuth scopes (Bot Token)

- `commands`
- `chat:write`
- `views:read`
- `views:write`

Reinstall the app to your workspace if you change scopes.

## 5. Cloud Run side

The companion endpoints exposed by `server.ts`:

```http
POST  /api/internal/slack/legal-request
GET   /api/search/issues?query=<keyword>
```

There is no Slack signature check on the Cloud Run side — the endpoints
are called by GAS only. If you want to lock them down further, you can:

- Restrict ingress on the Cloud Run service to authenticated callers and
  attach an identity token to the `UrlFetchApp` request, **or**
- Add a shared secret header that `Code.gs` sends and `server.ts` checks.

## 6. Keep the runtime warm (REQUIRED for Slack)

Slack enforces a **3-second hard timeout** on every slash command and
interactivity request. A cold Apps Script runtime takes 2–5 seconds to
spin up, which blows that budget and produces:

> アプリが応答しなかったため、*/法務依頼* は失敗しました。

To prevent this, install a 1-minute time-driven trigger that calls the
no-op `keepWarm()` function defined in `Code.gs`:

1. Apps Script Editor → left sidebar **「トリガー (Triggers)」**
2. Bottom-right **「+ トリガーを追加」**
3. Configure:
   | Field | Value |
   | --- | --- |
   | 実行する関数 | `keepWarm` |
   | デプロイ時に実行 | `Head` |
   | イベントのソース | `時間主導型` |
   | 時間ベースのトリガーのタイプ | `分タイマー` |
   | 時間の間隔 | **`1 分おき`** |
4. **保存**

After saving, the runtime will be exercised once per minute, eliminating
cold-start latency. You can confirm it's running via Apps Script's
**「実行数 (Executions)」** sidebar — a `keepWarm` row should appear every
minute with `Status: 完了` and `Duration: <100 ms`.

Apps Script's daily execution quota easily covers this (60 invocations/hour
× ~50 ms each is well under the 6-hour CPU budget).

## Signature verification (optional, deferred)

Slack signs every request with `v0:<timestamp>:<raw_body>` using
`SLACK_SIGNING_SECRET`. Apps Script doesn't expose the raw request body
straightforwardly (it parses form-encoded payloads into `e.parameter`),
so re-signing it for verification is fiddly. The verifier stub
(`verifySlackSignature`) is left in `Code.gs` returning `true` for now;
the deployment URL is treated as private to Slack via Slack app
configuration. Once you decide to enforce it, fill in the HMAC logic and
flip the call site in `doPost`.

## Testing locally

There is no formal local runner for Apps Script, but you can simulate
slash command POSTs with `curl` against your deployed `/exec` URL:

```sh
curl -X POST <YOUR_DEPLOYMENT_URL>/exec \
  -d 'command=/法務検索' \
  -d 'text=NDA' \
  -d 'user_id=U0123' \
  -d 'user_name=tester'
```

Watch logs in Apps Script via **Executions** in the left sidebar.

## Troubleshooting

- **「アプリが応答しなかったため、…は失敗しました」 / `This app didn't respond`**:
  GAS cold-start exceeded Slack's 3-second budget. **Make sure the
  `keepWarm` 1-minute trigger is installed (see § 6 above)** — without
  it the first hit after a few minutes of idle will time out almost
  every time. Confirm via Apps Script's **「実行数 (Executions)」** that
  `keepWarm` is running every minute. If it stops or shows errors, the
  trigger may have been disabled (e.g. by an unexpected exception);
  re-add it.
- **`401 invalid_auth` from Slack**: bad/rotated `SLACK_BOT_TOKEN`. Update
  the script property — no redeploy needed.
- **`HTTP 4xx` from Cloud Run**: `CLOUD_RUN_BASE_URL` typo, or Cloud Run
  rejected the payload (bad JSON / missing fields). Inspect the GAS
  execution log for the response body.
- **Search returns nothing**: confirm the keyword reaches Cloud Run by
  hitting `GET /api/search/issues?query=foo` directly with `curl`.
