import crypto from "node:crypto";
import { classify, draftKnowledge } from "./agent.js";
import { executeAction, fetchMessages } from "./connectors.js";
import { config } from "./config.js";
import { mutate, readState } from "./store.js";
import { employeeHasConsent } from "./privacy.js";
import { inc,log } from "./monitoring.js";

export async function runIntake() {
  const messages = await fetchMessages();
  return processMessages(messages);
}

export async function processMessages(messages) {
  const state = await readState();
  const seen = new Set(state.events.map(e => e.messageId));
  const unseen=messages.filter(m=>!seen.has(m.id)),fresh=[];for(const m of unseen){if(await employeeHasConsent(m.employee))fresh.push(m);else{inc("opspilot_messages_skipped_total",{reason:"no_consent"});log("info","message_skipped",{source:m.source,reason:"no_consent"})}}
  for (const message of fresh) {
    const decision = await classify(message);
    inc("opspilot_messages_processed_total",{source:message.source||"unknown"});
    const confluenceDraft=decision.actions.includes("confluence")?await draftKnowledge({title:decision.title,content:decision.summary,type:"meeting"}):null;
    await mutate(s => {
      s.stats.messagesScanned++;
      s.events.unshift({ id: crypto.randomUUID(), messageId: message.id, message, decision, at: new Date().toISOString() });
      if (decision.actionable) for (const kind of decision.actions) s.actions.unshift({ id: crypto.randomUUID(), kind, team: decision.team, title: decision.title, summary: decision.summary, draft:kind==="confluence"?confluenceDraft:undefined, severity: decision.severity, sourceId: message.id, status:kind==="confluence"?"pending":config.actionPolicy === "auto" && decision.confidence >= config.autoConfidence ? "approved" : "pending", createdAt: new Date().toISOString() });
    });
  }
  if (config.actionPolicy === "auto") {
    const latest = await readState();
    for (const action of latest.actions.filter(a => a.status === "approved")) await approveAction(action.id);
  }
  return { scanned: messages.length, new: fresh.length };
}

export async function approveAction(id,{actor,accessToken,fetchImpl}={}) {
  const action = await mutate(s => { const item=s.actions.find(a=>a.id===id); if(!item||!["pending","approved","failed"].includes(item.status))throw new Error("Action is not awaiting approval"); item.status="executing"; item.attempts=(item.attempts||0)+1; return structuredClone(item); });
  try { const result = await executeAction(action,{accessToken,fetchImpl});
    inc("opspilot_actions_total",{kind:action.kind,status:"completed"});log("info","action_completed",{actionId:action.id,kind:action.kind,team:action.team,actor:actor?.email});
    return mutate(s => {
    const item = s.actions.find(a => a.id === id); item.status = "completed"; item.result = result; item.completedAt = new Date().toISOString(); item.approvedBy=actor; delete item.error;
    const key = action.kind === "jira" ? "ticketsRaised" : action.kind === "triage" ? "incidentsOpened" : action.kind === "confluence" ? "pagesPublished" : "emailsSent"; s.stats[key]=(s.stats[key]||0)+1;
    return item;
    });
  } catch(error) { inc("opspilot_actions_total",{kind:action.kind,status:"failed"});log("error","action_failed",{actionId:action.id,kind:action.kind,error:error.message});await mutate(s=>{const item=s.actions.find(a=>a.id===id);item.status="failed";item.error=error.message;item.failedAt=new Date().toISOString()}); throw error; }
}
export async function rejectAction(id) { return mutate(s => { const a=s.actions.find(x=>x.id===id); if(!a) throw new Error("Action not found"); a.status="rejected"; return a; }); }
export async function buildDigest() {
  const s = await readState(); const today = new Date().toISOString().slice(0,10);
  const byEmployee = {};
  for (const e of s.events.filter(e => e.at.startsWith(today) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.message.employee||""))) (byEmployee[e.message.employee] ||= []).push(e.decision.title);
  return Object.entries(byEmployee).map(([employee, work]) => ({ employee, subject: `EOD work summary — ${today}`, body: work.map((x,i)=>`${i+1}. ${x}`).join("\n"), items: work.length }));
}
export async function sendDigests(deps={}) { const digests=await buildDigest(); const results=[]; for(const digest of digests){ const { sendOutlookMail }=await import("./connectors/microsoft.js"); results.push(await sendOutlookMail({to:digest.employee,subject:digest.subject,body:digest.body},deps)); } return results; }
export async function createKnowledgeDraft({title,content,type="meeting",team="support",sourceId}){const draft=await draftKnowledge({title,content,type});return mutate(s=>{const action={id:crypto.randomUUID(),kind:"confluence",team,title:draft.title,summary:content,draft,severity:type==="incident"?"sev2":"sev4",sourceId:sourceId||`${type}:${crypto.randomUUID()}`,status:"pending",createdAt:new Date().toISOString()};s.actions.unshift(action);return action})}
export async function updateKnowledgeDraft(id,draft){if(!draft?.title||!Array.isArray(draft.sections))throw Object.assign(new Error("Invalid draft"),{status:400});return mutate(s=>{const a=s.actions.find(x=>x.id===id&&x.kind==="confluence"&&["pending","failed"].includes(x.status));if(!a)throw Object.assign(new Error("Editable Confluence draft not found"),{status:404});a.title=draft.title;a.draft=draft;a.updatedAt=new Date().toISOString();return a})}
