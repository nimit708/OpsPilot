import { config } from "../config.js"; import { request } from "../http.js";
const adf = text => ({ type:"doc", version:1, content:[{ type:"paragraph", content:[{ type:"text", text }] }] });
export async function createJiraIssue(action, route, deps={}) {
  const auth=Buffer.from(`${config.jira.email}:${config.jira.token}`).toString("base64");
  const payload={ fields:{ project:{key:route.jira}, summary:action.title.slice(0,255), issuetype:{name:config.jira.issueType}, description:adf(action.summary || `Created from workplace message ${action.sourceId}`), labels:["opspilot",action.severity] }, properties:[{key:"opspilot.actionId",value:action.id}] };
  const {data}=await request(`${config.jira.baseUrl}/rest/api/3/issue`,{method:"POST",headers:{Authorization:`Basic ${auth}`,Accept:"application/json","Content-Type":"application/json","X-Atlassian-Token":"no-check"},body:JSON.stringify(payload),fetchImpl:deps.fetchImpl});
  return {externalId:data.key,destination:route.jira,url:`${config.jira.baseUrl}/browse/${data.key}`};
}
export async function jiraHealth(deps={}) { const auth=Buffer.from(`${config.jira.email}:${config.jira.token}`).toString("base64"); const {data}=await request(`${config.jira.baseUrl}/rest/api/3/myself`,{headers:{Authorization:`Basic ${auth}`,Accept:"application/json"},retries:0,fetchImpl:deps.fetchImpl}); return {ok:true,account:data.displayName||data.accountId}; }
