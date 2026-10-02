import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBudgetMonth } from '../src/ai-budget-model.js';
import { createAiCostGuard } from '../src/ai-budget-guard.js';

function request(overrides={}){
  return {
    model:'gpt-5.6-luna',
    store:false,
    service_tier:'default',
    reasoning:{effort:'low'},
    instructions:'Use only supplied facts.',
    input:JSON.stringify({facts:['a','b']}),
    text:{format:{type:'text'}},
    max_output_tokens:256,
    ...overrides
  };
}

function fakeStore(){
  const calls=[];
  return {
    calls,
    async reserve(input){
      calls.push({method:'reserve',input});
      return {
        ok:true,
        status:'reserved',
        month:'2026-09',
        estimatedUsd:input.estimatedUsd,
        spentUsd:0,
        reservedUsd:input.estimatedUsd,
        remainingUsd:1.8-input.estimatedUsd
      };
    },
    async reconcile(input){
      calls.push({method:'reconcile',input});
      return {
        ok:true,
        status:'reconciled',
        month:input.month,
        estimatedUsd:0.01,
        actualUsd:input.actualUsd,
        spentUsd:input.actualUsd,
        reservedUsd:0,
        remainingUsd:1.8-input.actualUsd
      };
    },
    async cancel(input){
      calls.push({method:'cancel',input});
      return {
        ok:true,
        status:'cancelled',
        month:input.month,
        releasedUsd:0.01,
        spentUsd:0,
        reservedUsd:0,
        remainingUsd:1.8
      };
    },
    async status(input){
      calls.push({method:'status',input});
      return {ok:true,month:'2026-10',limitUsd:1.8};
    }
  };
}

test('explicit reservation month survives a later calendar month',()=>{
  assert.equal(resolveBudgetMonth({
    month:'2026-09',
    now:'2026-10-01T00:30:00+09:00',
    timeZone:'UTC'
  }),'2026-09');

  assert.equal(resolveBudgetMonth({
    now:'2026-10-01T09:00:00+09:00',
    timeZone:'UTC'
  }),'2026-10');
});

test('guard reserves conservative estimate before provider call',async()=>{
  const store=fakeStore();
  const guard=createAiCostGuard(store);
  const result=await guard.reserve({
    reservationId:'req-1',
    purpose:'lq-world-gm',
    request:request(),
    now:'2026-09-30T23:59:59+09:00'
  });
  assert.equal(result.ok,true);
  assert.equal(result.budgetMonth,'2026-09');
  assert.ok(result.estimate.estimatedUsd>0);
  assert.equal(store.calls.length,1);
  assert.equal(store.calls[0].method,'reserve');
  assert.equal(store.calls[0].input.estimatedUsd,result.estimate.estimatedUsd);
});

test('guard reconciles against the original reservation month after midnight',async()=>{
  const store=fakeStore();
  const guard=createAiCostGuard(store);
  const result=await guard.reconcile({
    reservationId:'req-1',
    budgetMonth:'2026-09',
    model:'gpt-5.6-luna',
    usage:{
      input_tokens:500,
      input_tokens_details:{cached_tokens:0},
      output_tokens:100,
      output_tokens_details:{reasoning_tokens:40}
    },
    responseId:'resp_1',
    now:'2026-10-01T00:00:05+09:00'
  });
  assert.equal(result.ok,true);
  assert.equal(result.budgetMonth,'2026-09');
  assert.equal(store.calls[0].method,'reconcile');
  assert.equal(store.calls[0].input.month,'2026-09');
  assert.ok(store.calls[0].input.actualUsd>0);
});

test('guard cancels against the original reservation month after provider failure',async()=>{
  const store=fakeStore();
  const guard=createAiCostGuard(store);
  const result=await guard.cancel({
    reservationId:'req-2',
    budgetMonth:'2026-09',
    reason:'provider_failure',
    now:'2026-10-01T00:00:05+09:00'
  });
  assert.equal(result.ok,true);
  assert.equal(store.calls[0].method,'cancel');
  assert.equal(store.calls[0].input.month,'2026-09');
});

test('guard fails closed before touching the ledger for unknown model or unbounded output',async()=>{
  const store=fakeStore();
  const guard=createAiCostGuard(store);

  await assert.rejects(
    guard.reserve({reservationId:'bad-model',purpose:'test',request:request({model:'gpt-unknown'})}),
    /ai_price_unknown_model/
  );
  await assert.rejects(
    guard.reserve({reservationId:'no-cap',purpose:'test',request:request({max_output_tokens:undefined})}),
    /ai_output_limit_required/
  );
  assert.equal(store.calls.length,0);
});

test('reconcile and cancel require the original budget month',async()=>{
  const store=fakeStore();
  const guard=createAiCostGuard(store);
  await assert.rejects(
    guard.reconcile({
      reservationId:'r',
      model:'gpt-5.6-luna',
      usage:{input_tokens:1,input_tokens_details:{cached_tokens:0},output_tokens:1}
    }),
    /budget_month_required/
  );
  await assert.rejects(
    guard.cancel({reservationId:'r'}),
    /budget_month_required/
  );
  assert.equal(store.calls.length,0);
});
