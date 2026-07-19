import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.APP_MODE = "production";
process.env.ACTION_POLICY = "approval";
process.env.REQUIRE_EMPLOYEE_CONSENT = "false";
process.env.OPENAI_API_KEY = "";
process.env.TRIAGE_PROVIDER = "slack";
process.env.JIRA_BASE_URL = "https://acme.atlassian.net";
process.env.JIRA_EMAIL = "automation@acme.test";
process.env.JIRA_API_TOKEN = "jira-test-token";
process.env.JIRA_ISSUE_TYPE = "Incident";
process.env.CONFLUENCE_BASE_URL = "https://acme.atlassian.net";
process.env.CONFLUENCE_EMAIL = "automation@acme.test";
process.env.CONFLUENCE_API_TOKEN = "confluence-test-token";
process.env.CONFLUENCE_SPACE_ID = "OPS";
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.ROUTE_PAYMENTS_JIRA = "PAY";
process.env.ROUTE_PAYMENTS_SLACK = "C-INCIDENTS";
process.env.ROUTE_PAYMENTS_EMAIL = "payments-oncall@acme.test";
process.chdir(mkdtempSync(path.join(tmpdir(), "opspilot-e2e-")));

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("Slack incident summary completes Jira, triage, email, and Confluence workflow", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method || "GET", body });
    if (String(url).endsWith("/rest/api/3/issue")) return json({ key: "PAY-101" }, 201);
    if (String(url).endsWith("/chat.postMessage")) return json({ ok: true, ts: "1721000000.001", message: { permalink: "https://slack.test/incident" } });
    if (String(url).endsWith("/me/sendMail")) return new Response(null, { status: 202 });
    if (String(url).endsWith("/wiki/api/v2/pages")) return json({ id: "9001", _links: { webui: "/spaces/OPS/pages/9001" } }, 201);
    throw new Error(`Unexpected external request: ${url}`);
  };

  const { processMessages, approveAction } = await import("../src/workflow.js");
  const { readState } = await import("../src/store.js");
  const summary = "Checkout is failing with 500s for all customers. Please investigate and create a Confluence incident page.";
  const message = {
    id: "slack:C-PAYMENTS:1720999999.001",
    source: "slack",
    channel: "payments-support",
    author: "Ada Lovelace",
    employee: "ada@acme.test",
    text: summary,
    at: "2026-07-20T10:00:00.000Z",
  };

  assert.deepEqual(await processMessages([message]), { scanned: 1, new: 1 });
  let state = await readState();
  assert.deepEqual(new Set(state.actions.map(action => action.kind)), new Set(["jira", "triage", "email", "confluence"]));

  for (const action of state.actions) {
    await approveAction(action.id, {
      actor: { email: "approver@acme.test", role: "approver" },
      accessToken: "delegated-test-token",
      fetchImpl,
    });
  }

  state = await readState();
  assert.ok(state.actions.every(action => action.status === "completed"));
  assert.deepEqual(state.stats, {
    messagesScanned: 1,
    ticketsRaised: 1,
    incidentsOpened: 1,
    emailsSent: 1,
    pagesPublished: 1,
  });

  const jira = calls.find(call => call.url.endsWith("/rest/api/3/issue"));
  const slack = calls.find(call => call.url.endsWith("/chat.postMessage"));
  const email = calls.find(call => call.url.endsWith("/me/sendMail"));
  const confluence = calls.find(call => call.url.endsWith("/wiki/api/v2/pages"));
  assert.match(jira.body.fields.description.content[0].content[0].text, /Checkout is failing/);
  assert.match(slack.body.text, /Checkout is failing/);
  assert.match(email.body.message.body.content, /Checkout is failing/);
  assert.match(confluence.body.body.value, /Checkout is failing/);
  assert.equal(jira.body.fields.project.key, "PAY");
  assert.equal(slack.body.channel, "C-INCIDENTS");
  assert.equal(email.body.message.toRecipients[0].emailAddress.address, "payments-oncall@acme.test");
  assert.equal(confluence.body.spaceId, "OPS");
});
