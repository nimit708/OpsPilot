const csv = value => (value || "").split(",").map(x => x.trim()).filter(Boolean);
const bool = (value, fallback = false) => value == null ? fallback : value === "true";

export const config = {
  port: Number(process.env.PORT || 3080),
  host: process.env.HOST || "127.0.0.1",
  tls:{certPath:process.env.TLS_CERT_PATH||"",keyPath:process.env.TLS_KEY_PATH||"",externalHttps:bool(process.env.EXTERNAL_HTTPS)},
  mode: process.env.APP_MODE || "demo",
  actionPolicy: process.env.ACTION_POLICY || "approval",
  triageProvider: process.env.TRIAGE_PROVIDER || "slack",
  autoConfidence: Number(process.env.AUTO_CONFIDENCE || .9),
  adminToken: process.env.ADMIN_API_TOKEN || "",
  auth: { clientId:process.env.MS_OAUTH_CLIENT_ID||"",clientSecret:process.env.MS_OAUTH_CLIENT_SECRET||"",authority:process.env.MS_OAUTH_AUTHORITY||"common",redirectUri:process.env.MS_OAUTH_REDIRECT_URI||`${process.env.TLS_CERT_PATH&&process.env.TLS_KEY_PATH||bool(process.env.EXTERNAL_HTTPS)?"https":"http"}://localhost:${process.env.PORT||3080}/auth/callback`,secureCookies:bool(process.env.SECURE_COOKIES,Boolean(process.env.TLS_CERT_PATH&&process.env.TLS_KEY_PATH)||bool(process.env.EXTERNAL_HTTPS)),sessionHours:Number(process.env.SESSION_HOURS||8),admins:csv(process.env.ADMIN_EMAILS).map(x=>x.toLowerCase()),approvers:csv(process.env.APPROVER_EMAILS).map(x=>x.toLowerCase()) },
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-terra",
  jira: {
    baseUrl: (process.env.JIRA_BASE_URL || "").replace(/\/$/, ""), email: process.env.JIRA_EMAIL || "",
    token: process.env.JIRA_API_TOKEN || "", issueType: process.env.JIRA_ISSUE_TYPE || "Task",
  },
  confluence: { baseUrl:(process.env.CONFLUENCE_BASE_URL||process.env.JIRA_BASE_URL||"").replace(/\/$/,""), email:process.env.CONFLUENCE_EMAIL||process.env.JIRA_EMAIL||"", token:process.env.CONFLUENCE_API_TOKEN||process.env.JIRA_API_TOKEN||"", spaceId:process.env.CONFLUENCE_SPACE_ID||"", parentId:process.env.CONFLUENCE_PARENT_PAGE_ID||"" },
  webhookSecret: process.env.WORKFLOW_WEBHOOK_SECRET || "",
  slack: { token: process.env.SLACK_BOT_TOKEN || "", channels: csv(process.env.SLACK_CHANNEL_IDS), signingSecret: process.env.SLACK_SIGNING_SECRET || "" },
  microsoft: {
    tenantId: process.env.MS_TENANT_ID || "", clientId: process.env.MS_CLIENT_ID || "", clientSecret: process.env.MS_CLIENT_SECRET || "",
    teamId: process.env.TEAMS_TEAM_ID || "", channels: csv(process.env.TEAMS_CHANNEL_IDS), sender: process.env.OUTLOOK_SENDER || "",
    triageWebhook: process.env.TEAMS_TRIAGE_WEBHOOK_URL || "",
  },
  scheduler: { enabled: bool(process.env.SCHEDULER_ENABLED), pollMs: Number(process.env.POLL_INTERVAL_MS || 300000), eodHour: Number(process.env.EOD_HOUR || 17) },
  privacy:{policyVersion:process.env.PRIVACY_POLICY_VERSION||"2026-07-18",requireConsent:bool(process.env.REQUIRE_EMPLOYEE_CONSENT,process.env.APP_MODE==="production"),retentionDays:Number(process.env.DATA_RETENTION_DAYS||30),lawfulBasis:process.env.MONITORING_LAWFUL_BASIS||"not-configured"},
  monitoring:{metricsToken:process.env.METRICS_TOKEN||"",logLevel:process.env.LOG_LEVEL||"info"},
};

export const teamRouting = {
  payments: { jira: process.env.ROUTE_PAYMENTS_JIRA || "PAY", slack: process.env.ROUTE_PAYMENTS_SLACK || "", email: process.env.ROUTE_PAYMENTS_EMAIL || "" },
  platform: { jira: process.env.ROUTE_PLATFORM_JIRA || "PLAT", slack: process.env.ROUTE_PLATFORM_SLACK || "", email: process.env.ROUTE_PLATFORM_EMAIL || "" },
  identity: { jira: process.env.ROUTE_IDENTITY_JIRA || "IAM", slack: process.env.ROUTE_IDENTITY_SLACK || "", email: process.env.ROUTE_IDENTITY_EMAIL || "" },
  support: { jira: process.env.ROUTE_SUPPORT_JIRA || "SUP", slack: process.env.ROUTE_SUPPORT_SLACK || "", email: process.env.ROUTE_SUPPORT_EMAIL || "" },
};

export function validateProductionConfig() {
  const errors = [];
  if (Boolean(config.tls.certPath)!==Boolean(config.tls.keyPath)) errors.push("TLS_CERT_PATH and TLS_KEY_PATH must be configured together");
  if (config.auth.redirectUri.startsWith("https://") && !(config.tls.certPath&&config.tls.keyPath) && !config.tls.externalHttps) errors.push("HTTPS OAuth redirect requires local TLS certificates or EXTERNAL_HTTPS=true behind a trusted HTTPS proxy");
  if (!["slack","teams","both"].includes(config.triageProvider)) errors.push("TRIAGE_PROVIDER must be slack, teams, or both");
  if (config.mode !== "production") return errors;
  if (!config.adminToken) errors.push("ADMIN_API_TOKEN is required");
  if (!config.auth.clientId || !config.auth.clientSecret) errors.push("Microsoft OAuth credentials are incomplete");
  if (!config.auth.admins.length && !config.auth.approvers.length) errors.push("At least one ADMIN_EMAILS or APPROVER_EMAILS identity is required");
  if (config.privacy.lawfulBasis==="not-configured") errors.push("MONITORING_LAWFUL_BASIS must be documented");
  if (!config.openaiKey) errors.push("OPENAI_API_KEY is required");
  if (!config.jira.baseUrl || !config.jira.email || !config.jira.token) errors.push("Jira credentials are incomplete");
  if (!config.confluence.baseUrl || !config.confluence.email || !config.confluence.token || !config.confluence.spaceId) errors.push("Confluence credentials are incomplete");
  if (!config.slack.token && !config.microsoft.teamId) errors.push("At least one message source is required");
  if (["teams","both"].includes(config.triageProvider) && !config.microsoft.triageWebhook) errors.push("TEAMS_TRIAGE_WEBHOOK_URL is required for the selected TRIAGE_PROVIDER");
  const appGraph=Boolean(config.microsoft.tenantId&&config.microsoft.clientId&&config.microsoft.clientSecret);
  if (config.microsoft.teamId && !appGraph) errors.push("Teams ingestion requires Microsoft Graph application credentials");
  if (!appGraph && !(config.auth.clientId&&config.auth.clientSecret)) errors.push("Either Microsoft OAuth or Graph application credentials are required");
  if (appGraph && !config.microsoft.sender && !(config.auth.clientId&&config.auth.clientSecret)) errors.push("OUTLOOK_SENDER is required for application-only email");
  return errors;
}
