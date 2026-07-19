import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const file = path.resolve("data/state.json");
const seed = {
  events: [], actions: [], consents:[], privacyRequests:[],
  stats: { messagesScanned: 0, ticketsRaised: 0, incidentsOpened: 0, emailsSent: 0, pagesPublished: 0 },
};
let writeQueue = Promise.resolve();

export async function readState() {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return structuredClone(seed); }
}
export async function writeState(state) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2));
}
export async function mutate(fn) {
  const operation = writeQueue.then(async () => { const state=await readState(); const result=await fn(state); await writeState(state); return result; });
  writeQueue = operation.catch(() => {});
  return operation;
}
