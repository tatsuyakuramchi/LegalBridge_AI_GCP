# LegalBridge Slack Gateway (Google Apps Script)

`gas/Code.gs` is the Slack-side entry point for the LegalBridge platform.
It receives `/法務依頼` and `/法務検索` slash commands plus all interactivity
payloads (modal submissions, radio-button changes).

| Slack action | GAS calls |
| --- | --- |
| `/法務依頼` slash command | `views.open` directly via Slack Web API |
| Modal `legal_request_modal` submit | Backlog `POST /api/v2/issues` directly (no Cloud Run hop). The Backlog `type=1` webhook on the Cloud Run document-worker then handles DB write + document generation. |
| Modal `request_type_input` change | `views.update` directly via Slack Web API |
| `/法務検索` slash command | opens the search modal directly via Slack Web API |
| Modal `legal_search_modal` submit | Backlog `/api/v2/issues` + Cloud Run `/api/contract-check/search` IN PARALLEL via `UrlFetchApp.fetchAll` |

The `/法務依頼` intake path lives entirely in GAS so it is unaffected
by Cloud Run availability or cold starts. The `/法務検索` path delegates
the contract-status DB lookup to Cloud Run (which is the only service
with PostgreSQL access).

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
| `CLOUD_RUN_BASE_URL` | `https://legalbridge-admin-ui-988056987352.asia-northeast1.run.app` (no trailing slash) | `/法務検索` contract-status lookup only |
| `LB_PORTAL_SECRET` | Shared secret used by `X-LB-PORTAL-SECRET` header on Cloud Run portal endpoints | `/法務検索` contract-status lookup |
| `BACKLOG_HOST` | `arclight.backlog.com` | `/法務依頼` issue creation + `/法務検索` Backlog issue search |
| `BACKLOG_API_KEY` | The Backlog personal API key | `/法務依頼` issue creation + `/法務検索` Backlog issue search |
| `BACKLOG_PROJECT_KEY` | `LEGAL` | `/法務依頼` issue creation + `/法務検索` Backlog issue search |
| `ALLOWED_SEARCH_CHANNEL_IDS` | *(optional)* Comma-separated Slack channel IDs that may invoke `/法務検索`, e.g. `C090WRVD1TM` or `C090WRVD1TM,C012345ABCD`. When unset, `/法務検索` is open to every channel. | `/法務検索` channel allow-list |
| `SLACK_SIGNING_SECRET` | *(optional, currently unused — see "Signature verification" below)* | reserved |

> **Architecture note (2026-05)**: contract-status lookups previously hopped
> through the Contract-Status GAS Web App, which itself proxied to Cloud Run.
> That double hop routinely pushed `/法務検索` past Slack's 3-second budget
> (observed: 7.5s end-to-end). The Slack Gateway now calls Cloud Run's
> `/api/contract-check/search` directly, eliminating one GAS-to-GAS hop.

> **`/法務依頼` runs entirely in GAS.** The legal-request modal submit
> creates the Backlog issue directly via the Backlog REST API (no Cloud
> Run dependency). Downstream document generation is triggered by
> Backlog's `type=1` webhook hitting the Cloud Run document-worker —
> that pipeline is asynchronous, so an outage there does not block
> Slack-side intake.

These are read at runtime via `PropertiesService.getScriptProperties()`,
so you can rotate any token / key without redeploying.

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

The Slack Gateway calls only one Cloud Run endpoint:

```http
POST  /api/contract-check/search   (X-LB-PORTAL-SECRET header)
```

Both `/法務依頼` (Backlog issue creation) and the Backlog-side part of
`/法務検索` are handled directly by GAS via the Backlog REST API and do
not touch Cloud Run.

The contract-status endpoint is gated by the `X-LB-PORTAL-SECRET`
shared secret. If you want to lock it down further:

- Restrict ingress on the Cloud Run service to authenticated callers and
  attach an identity token to the `UrlFetchApp` request, **or**
- Rotate `LB_PORTAL_SECRET` periodically.

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
- **`HTTP 4xx` from Cloud Run on `/法務検索` contract section**:
  `CLOUD_RUN_BASE_URL` typo or `LB_PORTAL_SECRET` mismatch. Inspect the
  GAS execution log for the response body.
- **Backlog issue not created on `/法務依頼` submit**: confirm
  `BACKLOG_HOST` / `BACKLOG_API_KEY` / `BACKLOG_PROJECT_KEY` are set and
  the API key has issue-create permission on the LEGAL project. The GAS
  execution log will surface the Backlog API error body.
- **Search returns no Backlog issues**: verify the same Backlog
  credentials, then test with `curl https://<BACKLOG_HOST>/api/v2/issues?apiKey=...&keyword=foo`.
