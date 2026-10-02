import { askLunaForQuestWorldGm } from './luna-ai.js';
import { createAiCostGuard } from './ai-budget-guard.js';
import { AI_BUDGET_OBJECT_NAME } from './ai-budget-model.js';

export const QUEST_AI_FOUNDATION_VERSION='0.1.0';

export function questAiConfig(env){
  const enabled=env.LQ_AI_ENABLED==='true';
  const providerConfigured=Boolean(env.OPENAI_API_KEY);
  const budgetConfigured=Boolean(env.AI_BUDGET);
  const triggerPolicyConfigured=false;
  return {
    version:QUEST_AI_FOUNDATION_VERSION,
    enabled,
    triggerPolicy:'unimplemented',
    triggerPolicyConfigured,
    providerConfigured,
    budgetConfigured,
    model:env.OPENAI_MODEL||'gpt-6-luna',
    providerCallsPossible:false,
    status:enabled?'awaiting_trigger_policy':'disabled'
  };
}

export function evaluateQuestAiTrigger(){
  return {
    eligible:false,
    ruleId:null,
    reason:'trigger_policy_unimplemented'
  };
}

function questCostGuard(env){
  return env.AI_BUDGET
    ? createAiCostGuard(env.AI_BUDGET.getByName(AI_BUDGET_OBJECT_NAME))
    : null;
}

export async function runQuestWorldGm(env,{
  eventId=null,
  context=null
}={}){
  const config=questAiConfig(env);

  if(!config.enabled){
    return {
      ok:true,
      status:'skipped_disabled',
      providerCalled:false,
      config
    };
  }

  const trigger=evaluateQuestAiTrigger({eventId,context});
  if(!trigger.eligible){
    return {
      ok:true,
      status:'skipped_trigger_policy_unimplemented',
      providerCalled:false,
      trigger,
      config
    };
  }

  if(!config.providerConfigured){
    return {
      ok:false,
      status:'provider_not_configured',
      providerCalled:false,
      error:'OPENAI_API_KEY is not configured',
      trigger,
      config
    };
  }

  if(!config.budgetConfigured){
    return {
      ok:false,
      status:'budget_guard_not_configured',
      providerCalled:false,
      error:'AI budget guard is not configured',
      trigger,
      config
    };
  }

  const reservationId=`lq-world-gm:${eventId||crypto.randomUUID()}`;
  return askLunaForQuestWorldGm(env,{context,trigger},{
    costGuard:questCostGuard(env),
    reservationId
  });
}
