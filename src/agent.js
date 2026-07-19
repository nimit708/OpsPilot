import { config, teamRouting } from "./config.js";

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    actionable: { type: "boolean" },
    category: { type: "string", enum: ["incident", "task", "question", "noise"] },
    team: { type: "string", enum: Object.keys(teamRouting) },
    severity: { type: "string", enum: ["sev1", "sev2", "sev3", "sev4"] },
    confidence: { type: "number" }, title: { type: "string" }, summary: { type: "string" },
    actions: { type: "array", items: { type: "string", enum: ["jira", "triage", "email", "confluence"] } },
  }, required: ["actionable", "category", "team", "severity", "confidence", "title", "summary", "actions"]
};

export function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text;
  const parts = (response?.output || []).flatMap(item => item?.content || []).filter(part => part?.type === "output_text" && typeof part.text === "string");
  const text = parts.map(part => part.text).join("");
  if (!text.trim()) throw new Error("OpenAI response did not contain text output");
  return text;
}

function structuredResponse(response) {
  const text = extractResponseText(response);
  try { return JSON.parse(text); }
  catch { throw new Error("OpenAI response was not valid structured JSON"); }
}

export async function classify(message) {
  if (!config.openaiKey) return heuristic(message);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiModel,
      instructions: `You are an operations intake agent. Convert workplace messages into safe workflow proposals. Never invent impact. Incidents require explicit outage, severe degradation, security exposure, or customer impact. Route to one of: ${Object.keys(teamRouting).join(", ")}. Email only for sev1/sev2 or explicit stakeholder notification. Add confluence when someone explicitly asks to create/document a Confluence page or meeting notes. Return only the schema.`,
      input: JSON.stringify(message),
      text: { format: { type: "json_schema", name: "workflow_decision", strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const data = await response.json();
  return structuredResponse(data);
}

function heuristic(m) {
  const t = `${m.channel} ${m.text}`.toLowerCase();
  const team = t.includes("payment") || t.includes("checkout") ? "payments" : t.includes("login") || t.includes("auth") ? "identity" : t.includes("api") || t.includes("latency") ? "platform" : "support";
  const incident = /down|outage|failing|500|breach|degraded/.test(t);
  const severity = /all customers|outage|breach/.test(t) ? "sev1" : incident ? "sev2" : "sev3";
  const actionable = incident || /please|need|bug|investigate|broken/.test(t);
  const confluence=/confluence|meeting notes|minutes of meeting|\bmom\b/.test(t); return { actionable:actionable||confluence, category: incident ? "incident" : actionable||confluence ? "task" : "noise", team, severity, confidence: .86, title: m.text.slice(0, 76), summary: m.text, actions: actionable||confluence ? [...(actionable?["jira"]:[]), ...(incident?["triage","email"]:[]), ...(confluence?["confluence"]:[])] : [] };
}

export async function draftKnowledge({title,content,type="meeting"}) {
  if(!config.openaiKey)return {title:title||`${type==="incident"?"Incident review":"Meeting notes"} — ${new Date().toISOString().slice(0,10)}`,sections:type==="incident"?[{heading:"Summary",text:content,items:[]},{heading:"Impact",text:"",items:["Confirm impact before publishing"]},{heading:"Timeline",text:"",items:["Add verified event timeline"]},{heading:"Root cause and resolution",text:"",items:["Pending investigation"]},{heading:"Follow-ups",text:"",items:["Assign owners and dates"]}]:[{heading:"Summary",text:content,items:[]},{heading:"Decisions",text:"",items:["Confirm decisions from the meeting"]},{heading:"Action items",text:"",items:["Confirm owners and due dates"]},{heading:"Open questions",text:"",items:["Review unresolved topics"]}]};
  const draftSchema={type:"object",additionalProperties:false,properties:{title:{type:"string"},sections:{type:"array",items:{type:"object",additionalProperties:false,properties:{heading:{type:"string"},text:{type:"string"},items:{type:"array",items:{type:"string"}}},required:["heading","text","items"]}}},required:["title","sections"]};
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${config.openaiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:config.openaiModel,instructions:`Create a factual ${type} Confluence draft from supplied evidence. Preserve names, decisions, owners, dates, impact and timeline only when stated. Mark missing facts as pending confirmation. For meetings include summary, decisions, action items with owners/dates, and open questions. For incidents include summary, impact, timeline, root cause, resolution, and follow-ups.`,input:JSON.stringify({title,content}),text:{format:{type:"json_schema",name:"knowledge_draft",strict:true,schema:draftSchema}}})});
  if(!response.ok)throw new Error(`OpenAI draft request failed (${response.status})`);const data=await response.json();return structuredResponse(data);
}
