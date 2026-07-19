# OpsPilot

Production-oriented workflow automation for turning Teams and Slack messages into governed Jira tickets, Slack/Teams triage posts, Outlook emails, and employee EOD summaries.

## Run locally

Node 20+ is required; the service has no third-party runtime dependencies.

```bash
cp .env.example .env
node --env-file=.env src/server.js
```

Use `APP_MODE=demo` for the built-in sample. Set `APP_MODE=production` only after completing every required credential. The server refuses to start production mode with an incomplete critical configuration.

### Local HTTPS

For a Microsoft redirect registered as `https://localhost:3080/auth/callback`, create a trusted localhost certificate. On macOS, the easiest development option is `mkcert`:

```bash
brew install mkcert
mkcert -install
mkdir -p certs
mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1
```

Configure `.env`:

```dotenv
HOST=127.0.0.1
TLS_CERT_PATH=certs/localhost.pem
TLS_KEY_PATH=certs/localhost-key.pem
MS_OAUTH_REDIRECT_URI=https://localhost:3080/auth/callback
SECURE_COOKIES=true
```

Then open `https://localhost:3080`. OpsPilot uses HTTPS whenever both TLS paths are configured and rejects incomplete TLS settings. The Microsoft redirect URI must match exactly. Certificate and key files under `certs/` are ignored by git. A plain self-signed OpenSSL certificate can test the server but causes a browser warning unless manually trusted; `mkcert` avoids that for local development.

## Production integrations

- **Jira Cloud REST v3:** creates issues through `/rest/api/3/issue`, uses Atlassian Document Format descriptions, labels every issue, and stores the OpsPilot action ID as an issue property.
- **Slack Web API:** polls configured channel IDs with `conversations.history`, posts incident threads using `chat.postMessage`, and supports signed Events API callbacks at `POST /webhooks/slack`.
- **Microsoft Graph / Teams:** reads configured channel messages using application credentials.
- **Microsoft Graph / Outlook:** sends action notifications and EOD summaries as the configured `OUTLOOK_SENDER`.
- **Teams triage:** supported through a Teams Workflow webhook. Set `TRIAGE_PROVIDER=teams` to send only to Teams or `both` to post to Slack and Teams.
- **Confluence Cloud REST v2:** creates approved meeting-note and incident-review pages in a configured space. Drafts are generated locally in OpsPilot and are never published without approval.

## Microsoft login

Register a Microsoft identity-platform **Web** application and choose the supported account type **Accounts in any organizational directory and personal Microsoft accounts**. Add the exact redirect URI from `MS_OAUTH_REDIRECT_URI`, create a client secret, and grant delegated `User.Read` and `Mail.Send`. OpsPilot also requests standard `openid`, `profile`, `email`, and `offline_access` scopes.

The login uses authorization code flow with PKCE and the `/common` authority. Microsoft tokens remain server-side; the browser receives an opaque `HttpOnly`, `SameSite=Lax` session cookie. Set `SECURE_COOKIES=true` behind production HTTPS. Personal Microsoft accounts can sign in and send Outlook mail, but do not gain organizational Teams channel/transcript access.

For a personal-account demo, create a Teams Workflow using the **When a Teams webhook request is received** trigger, copy its URL into `TEAMS_TRIAGE_WEBHOOK_URL`, and set `TRIAGE_PROVIDER=teams` or `both`. This demonstrates outbound incident/triage creation in Teams. Reading organization channel messages or automatically retrieving meeting transcripts still requires a Microsoft 365 work/school tenant, Graph permissions, and administrator consent. Sample meeting text can be submitted to `POST /api/meetings/draft` for the approval workflow.

## Public demo URL

The included `render.yaml` and `Dockerfile` can deploy the dashboard as a Render web service. Render terminates public HTTPS, so hosted configuration must use `HOST=0.0.0.0`, `EXTERNAL_HTTPS=true`, empty `TLS_CERT_PATH`/`TLS_KEY_PATH`, and an OAuth redirect such as `https://YOUR-SERVICE.onrender.com/auth/callback`. Add that exact redirect URI to the Microsoft app registration and configure secrets in Render's environment settings; never upload `.env`.

The current JSON state store and login sessions are local to one running container. They can reset when a free service restarts or spins down, so this setup is appropriate for a working demo, not durable production. PostgreSQL-backed state and sessions are the next step before a multi-instance or always-on launch.

In demo mode, a signed-in user receives the approver role. In production, users default to employee; list explicit approvers/admins in `APPROVER_EMAILS` or `ADMIN_EMAILS`. Completed actions record the approving identity.

Use a dedicated Microsoft Entra application. Grant the least privileges your tenant workflow needs (typically application permissions for reading the selected Teams messages, basic user lookup, and `Mail.Send`), then obtain admin consent. Restrict access further with Microsoft application access policies where available. The Slack bot needs `chat:write`, `users:read`, `users:read.email`, and only the history scopes for channel types it monitors; invite it only to approved channels. The Jira service account needs Browse Projects and Create Issues only in routed projects.

The Confluence service account needs access to the configured space and permission to create pages. Configure a Jira/incident-management completion webhook to `POST /webhooks/incidents` with `X-OpsPilot-Secret`. Resolved, closed, done, or completed events create a pending incident-review draft. Meeting systems can submit `{ title, transcript, meetingId, team }` to authenticated `POST /api/meetings/draft`. Microsoft Graph transcript retrieval requires `OnlineMeetingTranscript.Read.All` (or applicable resource-specific consent) plus an application access policy; only meetings with recording/transcription and tenant access enabled produce transcripts.

## Security and operational behavior

- Production `/api/*` endpoints require `Authorization: Bearer <ADMIN_API_TOKEN>`.
- Confluence drafts can be previewed and edited in the approval queue. Approval publishes through `/wiki/api/v2/pages` and records the page link.
- Slack webhook payloads require a valid HMAC signature and a timestamp no older than five minutes.
- External actions default to human approval. A workflow action is atomically claimed before execution, preventing double-click duplicates.
- Failed external actions are retained as `failed` and can be explicitly retried.
- Requests have timeouts, bounded retries, `Retry-After` handling, response-size limits, and browser security headers.
- Health endpoints: `GET /healthz` checks the process; `GET /readyz` verifies configured external services.
- Source IDs prevent repeated message intake. Jira action IDs and Slack metadata provide external audit correlation.
- Secrets are read only from environment variables and excluded from git.

## Privacy and worker monitoring

Production mode requires a documented `MONITORING_LAWFUL_BASIS`, versioned notice, and explicit approver/admin identities. Employees receive a transparency/acknowledgement screen before dashboard access. When `REQUIRE_EMPLOYEE_CONSENT=true`, messages from unacknowledged identities are skipped without logging their content. Users can withdraw, submit access/correction/deletion/objection/restriction requests, and export their own OpsPilot data through the privacy API.

Retention defaults to 30 days. Structured logs redact tokens, secrets, bodies, transcripts and messages. Templates are provided in `docs/EMPLOYEE_MONITORING_POLICY.md`, `docs/DPIA_TEMPLATE.md`, and `docs/RETENTION_AND_DATA_MAP.md`. These controls and templates are not legal advice; privacy/legal owners must approve the lawful basis, DPIA, notice, retention, transfers, consultation and excluded sources before rollout.

## Grafana OSS monitoring

`docker-compose.monitoring.yml` runs OpsPilot, Prometheus, Loki, Grafana Alloy and Grafana OSS. Prometheus scrapes `/metrics`; Alloy sends structured container logs to Loki; Grafana provisions both data sources and an OpsPilot dashboard.

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

Open OpsPilot at `http://127.0.0.1:3080` and Grafana at `http://127.0.0.1:3000`. Set a strong `GRAFANA_ADMIN_PASSWORD`. This stack is for a local/private network: Loki has no built-in authentication, so do not publicly expose ports 3000, 9090 or 3100. Pin image digests and add TLS/authentication before production.

The JSON file store is safe for a single-process pilot. Before horizontal scaling, replace `src/store.js` with PostgreSQL and enforce unique constraints on `messageId` and action idempotency keys. Use a queue such as SQS, Service Bus, or BullMQ for external actions. Run the built-in scheduler on only one replica, or invoke the intake/EOD endpoints through your platform scheduler.

## EOD summaries and privacy

`GET /api/digests` previews summaries; `POST /api/digests/send` sends them through Outlook. Employees should opt in, know which channels are monitored, and be able to correct summaries. Establish retention, legal basis, access controls, regional storage, and exclusions for private/HR/security conversations before production rollout. EOD reporting should summarize declared work—not infer productivity or performance.

## Test

```bash
npm test
npm run test:e2e
```

Tests validate classifier routing, Jira request shape, Slack reads/writes, Microsoft token/Teams/Outlook flows, retry behavior, intake deduplication, and action execution without contacting live services.

The mocked end-to-end test starts with a Slack payment incident that requests documentation, runs it through classification and human approval, and verifies that the same incident summary produces a Jira issue, Slack triage post, Outlook email, and Confluence page. It never uses credentials from `.env` or contacts external services, so it is safe for local runs and CI.
