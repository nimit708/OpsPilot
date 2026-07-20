import test from "node:test";
import assert from "node:assert/strict";
import { zonedClock } from "../src/scheduler.js";

test("EOD scheduler observes Europe/London daylight-saving time",()=>{
  assert.deepEqual(zonedClock(new Date("2026-07-20T16:00:00Z"),"Europe/London"),{day:"2026-07-20",hour:17,minute:0});
});
