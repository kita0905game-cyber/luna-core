import { askLunaForMorning } from './luna-ai.js';
import { MORNING_VERSION, morningDateJst, morningGeneratedAtJst } from './morning-model.js';
import { createAiCostGuard } from './ai-budget-guard.js';
import { AI_BUDGET_OBJECT_NAME } from './ai-budget-model.js';

const MORNING_OBJECT_NAME='morning-v1';
const morningStore=(env)=>env.QUEST_STATE.getByName(MORNING_OBJECT_NAME);
const morningCostGuard=(env)=>env.AI_BUDGET?createAiCostGuard(env.AI_BUDGET.getByName(AI_BUDGET_OBJECT_NAME)):null;

export function morningConfig(env){
  return {
    version:MORNING_VERSION,
    enabled:env.MORNING_ENABLED==='true',
    aiConfigured:Boolean(env.OPENAI_API_KEY),
    budgetConfigured:Boolean(env.AI_BUDGET),
    budgetLimitUsd:Number(env.AI_BUDGET_INTERNAL_LIMIT_USD||1.8),
    budgetTimeZone:env.AI_BUDGET_TIME_ZONE||'UTC',
    model:env.OPENAI_MODEL||'gpt-6-luna',
    publishConfigured:false,
    collectors:{
      calendar:false,
      weather:false,
      news:false,
      bookkeeping:false,
      secondBrain:false
    }
  };
}

export async function morningStatus(env){
  const state=await morningStore(env).morningStatus();
  return {config:morningConfig(env),state};
}

export async function runMorning(env,{
  trigger='manual',
  scheduledTime=Date.now(),
  useAI=false,
  facts=null
}={}){
  const runId=crypto.randomUUID();
  const startedAt=new Date().toISOString();
  const date=morningDateJst(scheduledTime);
  const store=morningStore(env);
  await store.recordMorningRun({
    runId,
    status:'running',
    trigger,
    date,
    startedAt,
    finishedAt:null,
    aiUsed:false,
    published:false,
    error:null
  });

  if(trigger==='cron'&&env.MORNING_ENABLED!=='true'){
    const skipped={
      runId,
      status:'skipped_disabled',
      trigger,
      date,
      startedAt,
      finishedAt:new Date().toISOString(),
      aiUsed:false,
      published:false,
      error:null
    };
    await store.recordMorningRun(skipped);
    return skipped;
  }

  if(!useAI){
    const ready={
      runId,
      status:'foundation_ready',
      trigger,
      date,
      startedAt,
      finishedAt:new Date().toISOString(),
      aiUsed:false,
      published:false,
      error:null,
      note:'Collectors and publisher are intentionally not connected yet.'
    };
    await store.recordMorningRun(ready);
    return ready;
  }

  if(!facts||typeof facts!=='object'){
    const failed={
      runId,
      status:'failed',
      trigger,
      date,
      startedAt,
      finishedAt:new Date().toISOString(),
      aiUsed:false,
      published:false,
      error:'facts_required_for_ai_run'
    };
    await store.recordMorningRun(failed);
    return failed;
  }

  try{
    const ai=await askLunaForMorning(env,{
      date,
      generated_at:morningGeneratedAtJst(),
      facts
    },{
      costGuard:morningCostGuard(env),
      reservationId:`morning:${runId}`
    });
    if(!ai.ok){
      const failed={
        runId,
        status:'failed',
        trigger,
        date,
        startedAt,
        finishedAt:new Date().toISOString(),
        aiUsed:ai.providerCalled===true,
        published:false,
        error:ai.error,
        aiStatus:ai.status,
        budget:ai.budget??null
      };
      await store.recordMorningRun(failed);
      return failed;
    }
    const completed={
      runId,
      status:'generated_unpublished',
      trigger,
      date,
      startedAt,
      finishedAt:new Date().toISOString(),
      aiUsed:true,
      published:false,
      error:null,
      model:ai.model,
      responseId:ai.responseId,
      budget:ai.budget??null,
      payload:ai.payload
    };
    await store.recordMorningRun(completed);
    return completed;
  }catch(error){
    const failed={
      runId,
      status:'failed',
      trigger,
      date,
      startedAt,
      finishedAt:new Date().toISOString(),
      aiUsed:true,
      published:false,
      error:error instanceof Error?error.message:'unknown_morning_error'
    };
    await store.recordMorningRun(failed);
    return failed;
  }
}

export async function runScheduledMorning(controller,env){
  const result=await runMorning(env,{
    trigger:'cron',
    scheduledTime:controller.scheduledTime,
    useAI:false
  });
  console.log(JSON.stringify({
    event:'LUNA_MORNING_SCHEDULED',
    cron:controller.cron,
    scheduledTime:controller.scheduledTime,
    runId:result.runId,
    status:result.status
  }));
  return result;
}


export async function runMorningAiSmokeOnce(env,{
  scheduledTime=Date.now()
}={}){
  const version=String(env.MORNING_AI_SMOKE_VERSION??'').trim();
  if(!version) return {status:'skipped_disabled',version:null};

  const store=morningStore(env);
  const claim=await store.claimMorningAiSmoke(version);
  if(!claim.claimed){
    return {
      status:'skipped_already_attempted',
      version,
      previous:claim
    };
  }

  const result=await runMorning(env,{
    trigger:'ai-smoke',
    scheduledTime,
    useAI:true,
    facts:{
      smoke_test:true,
      day_type:'holiday',
      day_type_reason:'Production smoke test only.',
      today_events:[],
      weather:{icon:null,low:null,high:null,rain_am:null,rain_pm:null},
      comment:'LUNA MORNING production API smoke test.',
      news:[],
      bookkeeping:'not_checked',
      commute:null
    }
  });

  const summary={
    status:result.status,
    version,
    aiUsed:Boolean(result.aiUsed),
    error:result.error??null,
    model:result.model??null,
    responseId:result.responseId??null,
    budget:result.budget??null
  };
  await store.completeMorningAiSmoke(version,summary);
  return summary;
}
