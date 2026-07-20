import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dashboard navigation exposes a matching view for every sidebar tab", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  const views = [...html.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tabs, ["overview", "inbox", "automations", "approvals", "activity"]);
  assert.deepEqual(views, tabs);
  for (const tab of tabs) assert.match(html, new RegExp(`href="#${tab}"`));
});
