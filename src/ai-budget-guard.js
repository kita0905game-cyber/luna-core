import {
  calculateTextResponseCost,
  estimateTextResponseCost
} from './ai-pricing.js';

const ALLOWED_AI_PURPOSES=new Set(['diary-summary']);

function assertStore(store){
  if(!store||typeof store.reserve!=='function'||typeof store.reconcile!=='function'||typeof store.cancel!=='function'){
    throw new Error('ai_budget_store_invalid');
  }
  return store;
}

function requireBudgetMonth(value){
  const month=String(value??'').trim();
  if(!/^\d{4}-\d{2}$/.test(month)) throw new Error('budget_month_required');
  return month;
}

export function isAiPurposeAllowed(purpose){
  return ALLOWED_AI_PURPOSES.has(String(purpose??'').trim());
}

export function createAiCostGuard(store){
  const budget=assertStore(store);

  return {
    async reserve({reservationId,purpose,request,now}){
      if(!isAiPurposeAllowed(purpose)){
        return {
          ok:false,
          status:'purpose_not_allowed',
          reservationId,
          budgetMonth:null,
          estimate:null,
          budget:{ok:false,status:'rejected',reason:'purpose_not_allowed'}
        };
      }
      const estimate=estimateTextResponseCost(request);
      const receipt=await budget.reserve({
        reservationId,
        estimatedUsd:estimate.estimatedUsd,
        purpose,
        now
      });
      return {
        ok:Boolean(receipt?.ok),
        status:receipt?.status??'unknown',
        reservationId,
        budgetMonth:receipt?.month??null,
        estimate,
        budget:receipt
      };
    },

    async reconcile({reservationId,budgetMonth,model,usage,responseId=null,now}){
      const month=requireBudgetMonth(budgetMonth);
      const actual=calculateTextResponseCost(model,usage);
      const receipt=await budget.reconcile({
        reservationId,
        month,
        actualUsd:actual.actualUsd,
        responseId,
        now
      });
      const estimatedUsd=Number(receipt?.estimatedUsd);
      return {
        ok:Boolean(receipt?.ok),
        status:receipt?.status??'unknown',
        reservationId,
        budgetMonth:month,
        actual,
        estimateExceeded:Number.isFinite(estimatedUsd)?actual.actualUsd>estimatedUsd:false,
        budget:receipt
      };
    },

    async cancel({reservationId,budgetMonth,reason='provider_failure',now}){
      const month=requireBudgetMonth(budgetMonth);
      const receipt=await budget.cancel({
        reservationId,
        month,
        reason,
        now
      });
      return {
        ok:Boolean(receipt?.ok),
        status:receipt?.status??'unknown',
        reservationId,
        budgetMonth:month,
        budget:receipt
      };
    },

    async status(options={}){
      if(typeof budget.status!=='function') throw new Error('ai_budget_status_unavailable');
      return budget.status(options);
    }
  };
}
