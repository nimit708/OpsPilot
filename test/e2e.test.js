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
process.env.ROUTE_IDENTITY_JIRA = "IAM";
process.chdir(mkdtempSync(path.join(tmpdir(), "opspilot-e2e-")));

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json" },
});

const seed = {
  events: [], actions: [], consents: [], privacyRequests: [],
  stats: { messagesScanned: 0, ticketsRaised: 0, incidentsOpened: 0, emailsSent: 0, pagesPublished: 0 },
};
const { processMessages, approveAction, createKnowledgeDraft } = await import("../src/workflow.js");
const { readState, writeState } = await import("../src/store.js");
test.beforeEach(async () => writeState(structuredClone(seed)));

const slackMessage = (id, text, channel = "payments-support") => ({
  id, source: "slack", channel, author: "Ada Lovelace", employee: "ada@acme.test", text,
  at: "2026-07-20T10:00:00.000Z",
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

  const summary = "Checkout is failing with 500s for all customers. Please investigate and create a Confluence incident page.";
  const message = slackMessage("slack:C-PAYMENTS:1720999999.001", summary);

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

test("Slack identity task creates only the correctly routed Jira issue", async () => {
  const calls = [];
  const message = slackMessage("slack:C-IDENTITY:1", "Please investigate the broken login redirect", "identity-help");
  assert.deepEqual(await processMessages([message]), { scanned: 1, new: 1 });
  let state = await readState();
  assert.deepEqual(state.actions.map(action => action.kind), ["jira"]);
  assert.equal(state.actions[0].team, "identity");

  await approveAction(state.actions[0].id, { fetchImpl: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return json({ key: "IAM-77" }, 201);
  }});
  state = await readState();
  assert.equal(state.actions[0].result.externalId, "IAM-77");
  assert.equal(calls[0].body.fields.project.key, "IAM");
  assert.equal(calls.length, 1);
});

test("ordinary Slack conversation creates no external actions", async () => {
  const message = slackMessage("slack:C-GENERAL:1", "Thanks everyone, have a good weekend", "general");
  assert.deepEqual(await processMessages([message]), { scanned: 1, new: 1 });
  const state = await readState();
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].decision.actionable, false);
  assert.deepEqual(state.actions, []);
});

test("duplicate Slack delivery is processed exactly once", async () => {
  const message = slackMessage("slack:C-PAYMENTS:duplicate", "Payments outage for all customers");
  assert.deepEqual(await processMessages([message]), { scanned: 1, new: 1 });
  assert.deepEqual(await processMessages([message]), { scanned: 1, new: 0 });
  const state = await readState();
  assert.equal(state.events.length, 1);
  assert.deepEqual(new Set(state.actions.map(action => action.kind)), new Set(["jira", "triage", "email"]));
});

test("failed Outlook action is retained and succeeds on explicit retry", async () => {
  await processMessages([slackMessage("slack:C-PAYMENTS:mail-retry", "Checkout outage for all customers")]);
  let state = await readState();
  const email = state.actions.find(action => action.kind === "email");
  await assert.rejects(
    () => approveAction(email.id, { accessToken: "delegated-test-token", fetchImpl: async () => json({ error: "mailbox unavailable" }, 400) }),
    /HTTP 400/,
  );
  state = await readState();
  assert.equal(state.actions.find(action => action.id === email.id).status, "failed");
  assert.equal(state.actions.find(action => action.id === email.id).attempts, 1);

  await approveAction(email.id, { accessToken: "delegated-test-token", fetchImpl: async () => new Response(null, { status: 202 }) });
  state = await readState();
  const completed = state.actions.find(action => action.id === email.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.attempts, 2);
  assert.equal(state.stats.emailsSent, 1);
});

test("resolved incident draft publishes a structured Confluence page", async () => {
  const draft = await createKnowledgeDraft({
    title: "Incident review: PAY-101",
    content: "Checkout recovered at 10:42 UTC after the payment gateway configuration was restored.",
    type: "incident",
    team: "payments",
    sourceId: "incident:PAY-101",
  });
  let sent;
  await approveAction(draft.id, { fetchImpl: async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return json({ id: "9100", _links: { webui: "/spaces/OPS/pages/9100" } }, 201);
  }});
  const state = await readState();
  assert.equal(state.actions[0].status, "completed");
  assert.equal(state.stats.pagesPublished, 1);
  assert.equal(sent.body.spaceId, "OPS");
  assert.match(sent.body.body.value, /Checkout recovered/);
  assert.match(sent.body.body.value, /Timeline/);
  assert.match(state.actions[0].result.url, /9100/);
});
