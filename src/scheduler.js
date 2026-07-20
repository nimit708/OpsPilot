import { config } from "./config.js";
import { delegatedApproverSession, delegatedToken } from "./auth.js";
import { runIntake, sendDigests } from "./workflow.js";
import { applyRetention } from "./privacy.js";
import { mutate, readState } from "./store.js";

let pollTimer,eodTimer,eodRunning=false;

export function zonedClock(date=new Date(),timeZone=config.scheduler.timeZone){const values=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));return {day:`${values.year}-${values.month}-${values.day}`,hour:Number(values.hour),minute:Number(values.minute)}}
export async function recordEodDelivery(day=zonedClock().day){await mutate(s=>{s.scheduler||={};s.scheduler.lastEodDelivery=day;s.scheduler.lastEodDeliveryAt=new Date().toISOString()})}

export function startScheduler(log=console){
  if(!config.scheduler.enabled)return;
  const poll=async()=>{try{await runIntake()}catch(e){log.error("Scheduled intake failed",e.message)}};
  const deliverEod=async()=>{if(eodRunning)return;const clock=zonedClock();if(clock.hour!==config.scheduler.eodHour)return;eodRunning=true;try{const state=await readState();if(state.scheduler?.lastEodDelivery===clock.day)return;const session=delegatedApproverSession();if(!session)throw new Error("No active approver Outlook session; sign in and use Send EOD summaries");const accessToken=await delegatedToken(session),results=await sendDigests({accessToken});await applyRetention();await recordEodDelivery(clock.day);log.info?.("EOD delivery completed",`${results.length} summary email(s)`)}catch(e){log.error("EOD delivery failed",e.message)}finally{eodRunning=false}};
  pollTimer=setInterval(poll,config.scheduler.pollMs);poll();
  eodTimer=setInterval(deliverEod,60000);deliverEod();
}
export function stopScheduler(){clearInterval(pollTimer);clearInterval(eodTimer)}
