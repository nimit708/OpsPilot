import { config } from "./config.js"; import { runIntake, sendDigests } from "./workflow.js";import {applyRetention} from "./privacy.js";
let pollTimer,eodTimer,lastEod="";
export function startScheduler(log=console) { if(!config.scheduler.enabled)return; const poll=async()=>{try{await runIntake()}catch(e){log.error("Scheduled intake failed",e.message)}}; pollTimer=setInterval(poll,config.scheduler.pollMs); poll(); eodTimer=setInterval(async()=>{const now=new Date(),day=now.toISOString().slice(0,10);if(now.getHours()===config.scheduler.eodHour&&lastEod!==day){try{await sendDigests();await applyRetention();lastEod=day}catch(e){log.error("EOD delivery failed",e.message)}}},60000); }
export function stopScheduler(){clearInterval(pollTimer);clearInterval(eodTimer)}
