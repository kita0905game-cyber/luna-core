import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateQuestAiTrigger,
  questAiConfig,
  runQuestWorldGm
} from '../src/quest-ai.js';
import {
  QUEST_WORLD_GM_MAX_OUTPUT_TOKENS,
  askLunaForQuestWorldGm,
  buildQuestWorldGmResponseRequest
} from '../src/luna-ai.js';

test('LIFE QUEST API Luna is disabled by default and cannot call provider',async()=>{
  const config=questAiConfig({OPENAI_API_KEY:'present',AI_BUDGET:{}});
  assert.equal(config.enabled,false);
  assert.equal(config.triggerPolicyConfigured,false);
  assert.equal(config.providerCallsPossible,false);
  assert.equal(config.status,'disabled');

  const result=await runQuestWorldGm({
    OPENAI_API_KEY:'present',
    AI_BUDGET:{}
  },{
    eventId:'evt-1',
    context:{kind:'test'}
  });
  assert.equal(result.status,'skipped_disabled');
  assert.equal(result.providerCalled,false);
});

test('even an enabled flag cannot activate API Luna before trigger policy is implemented',async()=>{
  const trigger=evaluateQuestAiTrigger({eventId:'evt-2'});
  assert.equal(trigger.eligible,false);
  assert.equal(trigger.reason,'trigger_policy_unimplemented');

  const result=await runQuestWorldGm({
    LQ_AI_ENABLED:'true',
    OPENAI_API_KEY:'present',
    AI_BUDGET:{}
  },{
    eventId:'evt-2',
    context:{kind:'test'}
  });
  assert.equal(result.status,'skipped_trigger_policy_unimplemented');
  assert.equal(result.providerCalled,false);
});

test('World GM provider request is bounded, standard tier, and GPT-6 Luna',()=>{
  const request=buildQuestWorldGmResponseRequest({
    OPENAI_MODEL:'gpt-6-luna'
  },{
    context:{zone:'forest'},
    trigger:{eligible:true,ruleId:'future-rule'}
  });
  assert.equal(request.model,'gpt-6-luna');
  assert.equal(request.store,false);
  assert.equal(request.service_tier,'default');
  assert.equal(request.max_output_tokens,QUEST_WORLD_GM_MAX_OUTPUT_TOKENS);
  assert.equal(request.max_output_tokens,1024);
  assert.equal(typeof request.input,'string');
});

test('direct World GM adapter still fails closed on budget rejection before fetch',async()=>{
  const calls=[];
  const guard={
    async reserve(input){
      calls.push({method:'reserve',input});
      return {
        ok:false,
        status:'rejected',
        budgetMonth:'2026-10',
        estimate:{estimatedUsd:0.01},
        budget:{ok:false,status:'rejected',reason:'ai_budget_exhausted',month:'2026-10',remainingUsd:0}
      };
    },
    async reconcile(input){calls.push({method:'reconcile',input});throw new Error('must not reconcile');},
    async cancel(input){calls.push({method:'cancel',input});throw new Error('must not cancel');}
  };
  let fetchCalls=0;
  const result=await askLunaForQuestWorldGm({
    OPENAI_API_KEY:'test-key',
    OPENAI_MODEL:'gpt-6-luna'
  },{
    context:{zone:'forest'},
    trigger:{eligible:true,ruleId:'future-rule'}
  },{
    costGuard:guard,
    reservationId:'lq-world-gm:test',
    fetchImpl:async()=>{fetchCalls++;throw new Error('must not fetch');}
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'budget_rejected');
  assert.equal(result.providerCalled,false);
  assert.equal(fetchCalls,0);
  assert.deepEqual(calls.map((x)=>x.method),['reserve']);
});
