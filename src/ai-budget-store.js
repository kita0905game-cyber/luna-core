import { DurableObject } from 'cloudflare:workers';
import {
  AI_BUDGET_INTERNAL_HARD_CAP_USD,
  AI_BUDGET_OBJECT_NAME,
  budgetStatus,
  cancelBudgetReservation,
  effectiveLimitUsd,
  normalizeBudgetLedger,
  reconcileBudget,
  reserveBudget,
  resolveBudgetMonth
} from './ai-budget-model.js';

function normalizeTimeZone(value){
  const zone=String(value??'UTC').trim()||'UTC';
  try{
    new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(new Date());
    return zone;
  }catch{
    return 'UTC';
  }
}

export function aiBudgetConfigured(env){
  return Boolean(env?.AI_BUDGET);
}

export function aiBudgetStore(env){
  if(!aiBudgetConfigured(env)) throw new Error('ai_budget_store_not_configured');
  return env.AI_BUDGET.getByName(AI_BUDGET_OBJECT_NAME);
}

export class AiBudgetStore extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.env=env;
  }

  config(){
    return {
      limitUsd:effectiveLimitUsd(this.env?.AI_BUDGET_INTERNAL_LIMIT_USD??AI_BUDGET_INTERNAL_HARD_CAP_USD),
      timeZone:normalizeTimeZone(this.env?.AI_BUDGET_TIME_ZONE)
    };
  }

  ledgerLocation({month,now}={}){
    const config=this.config();
    const resolvedMonth=resolveBudgetMonth({month,now,timeZone:config.timeZone});
    return {
      config,
      month:resolvedMonth,
      key:`ai_budget_ledger:${resolvedMonth}`
    };
  }

  async status(options={}){
    const {config,month,key}=this.ledgerLocation(options);
    const stored=await this.ctx.storage.get(key);
    const ledger=normalizeBudgetLedger(stored,{month,limitUsd:config.limitUsd});
    return {
      ok:true,
      ...budgetStatus(ledger),
      timeZone:config.timeZone,
      hardCapUsd:AI_BUDGET_INTERNAL_HARD_CAP_USD
    };
  }

  async mutate(locationOptions,mutator){
    const {config,month,key}=this.ledgerLocation(locationOptions);
    const receipt=await this.ctx.storage.transaction(async(txn)=>{
      const stored=await txn.get(key);
      const ledger=normalizeBudgetLedger(stored,{month,limitUsd:config.limitUsd});
      const result=mutator(ledger);
      if(result.ledger!==ledger) await txn.put(key,result.ledger);
      return result.receipt;
    });
    return {
      ...receipt,
      timeZone:config.timeZone,
      hardCapUsd:AI_BUDGET_INTERNAL_HARD_CAP_USD
    };
  }

  async reserve(input={}){
    return this.mutate({now:input?.now},(ledger)=>reserveBudget(ledger,{
      reservationId:input?.reservationId,
      estimatedUsd:input?.estimatedUsd,
      purpose:input?.purpose,
      createdAt:input?.now
    }));
  }

  async reconcile(input={}){
    if(!input?.month) throw new Error('budget_month_required');
    return this.mutate({month:input.month},(ledger)=>reconcileBudget(ledger,{
      reservationId:input?.reservationId,
      actualUsd:input?.actualUsd,
      responseId:input?.responseId,
      completedAt:input?.now
    }));
  }

  async cancel(input={}){
    if(!input?.month) throw new Error('budget_month_required');
    return this.mutate({month:input.month},(ledger)=>cancelBudgetReservation(ledger,{
      reservationId:input?.reservationId,
      reason:input?.reason,
      cancelledAt:input?.now
    }));
  }
}
