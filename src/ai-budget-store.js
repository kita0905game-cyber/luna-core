import { DurableObject } from 'cloudflare:workers';
import {
  AI_BUDGET_INTERNAL_HARD_CAP_USD,
  budgetStatus,
  cancelBudgetReservation,
  effectiveLimitUsd,
  monthKeyFromDate,
  normalizeBudgetLedger,
  reconcileBudget,
  reserveBudget
} from './ai-budget-model.js';

const AI_BUDGET_OBJECT_NAME='global-monthly-budget';

function normalizeTimeZone(value){
  const zone=String(value??'Asia/Tokyo').trim()||'Asia/Tokyo';
  try{
    new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(new Date());
    return zone;
  }catch{
    return 'Asia/Tokyo';
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

  async ledgerFor(now){
    const config=this.config();
    const month=monthKeyFromDate(now??new Date(),config.timeZone);
    const key=`ai_budget_ledger:${month}`;
    const stored=await this.ctx.storage.get(key);
    const ledger=normalizeBudgetLedger(stored,{month,limitUsd:config.limitUsd});
    return {key,ledger,config};
  }

  async status(options={}){
    const {ledger,config}=await this.ledgerFor(options?.now);
    return {
      ok:true,
      ...budgetStatus(ledger),
      timeZone:config.timeZone,
      hardCapUsd:AI_BUDGET_INTERNAL_HARD_CAP_USD
    };
  }

  async reserve(input={}){
    const {key,ledger,config}=await this.ledgerFor(input?.now);
    const result=reserveBudget(ledger,{
      reservationId:input?.reservationId,
      estimatedUsd:input?.estimatedUsd,
      purpose:input?.purpose,
      createdAt:input?.now
    });
    if(result.ledger!==ledger) await this.ctx.storage.put(key,result.ledger);
    return {
      ...result.receipt,
      timeZone:config.timeZone,
      hardCapUsd:AI_BUDGET_INTERNAL_HARD_CAP_USD
    };
  }

  async reconcile(input={}){
    const {key,ledger,config}=await this.ledgerFor(input?.now);
    const result=reconcileBudget(ledger,{
      reservationId:input?.reservationId,
      actualUsd:input?.actualUsd,
      responseId:input?.responseId,
      completedAt:input?.now
    });
    if(result.ledger!==ledger) await this.ctx.storage.put(key,result.ledger);
    return {
      ...result.receipt,
      timeZone:config.timeZone,
      hardCapUsd:AI_BUDGET_INTERNAL_HARD_CAP_USD
    };
  }

  async cancel(input={}){
    const {key,ledger,config}=await this.ledgerFor(input?.now);
    const result=cancelBudgetReservation(ledger,{
      reservationId:input?.reservationId,
      reason:input?.reason,
      cancelledAt:input?.now
    });
    if(result.ledger!==ledger) await this.ctx.storage.put(key,result.ledger);
    return {
      ...result.receipt,
      timeZone:config.timeZone,
      hardCapUsd:AI_BUDGET_INTERNAL_HARD_CAP_USD
    };
  }
}
