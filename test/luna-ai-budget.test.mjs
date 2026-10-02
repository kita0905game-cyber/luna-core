import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MORNING_MAX_OUTPUT_TOKENS,
  askLunaForMorning,
  buildMorningResponseRequest
} from '../src/luna-ai.js';

function fakeGuard({reserveOk=true}={}){
  const calls=[];
  return {
    calls,
    async reserve(input){
      calls.push({method:'reserve',input});
      return {
        ok:reserveOk,
        status:reserveOk?'reserved':'rejected',
        budgetMonth:'2026-10',
        estimate:{estimatedUsd:0.01},
        budget:reserveOk
          ? {ok:true,status:'reserved',month:'2026-10',estimatedUsd:0.01,remainingUsd:1.79}
          : {ok:false,status:'rejected',reason:'ai_budget_exhausted',month:'2026-10',remainingUsd:0}
      };
    },
    async reconcile(input){
      calls.push({method:'reconcile',input});
      return {
        ok:true,
        status:'reconciled',
        actual:{actualUsd:0.001},
        budget:{ok:true,status:'reconciled',month:input.budgetMonth,actualUsd:0.001,remainingUsd:1.799}
      };
    },
    async cancel(input){
      calls.push({method:'cancel',input});
      return {
        ok:true,
        status:'cancelled',
        budget:{ok:true,status:'cancelled',month:input.budgetMonth,remainingUsd:1.8}
      };
    }
  };
}

function env(){
  return {OPENAI_API_KEY:'test-key',OPENAI_MODEL:'gpt-6-luna'};
}

test('morning request is bounded and standard-tier for budget estimation',()=>{
  const request=buildMorningResponseRequest(env(),{date:'2026-10-02',facts:{weather:'sunny'}});
  assert.equal(request.model,'gpt-6-luna');
  assert.equal(request.store,false);
  assert.equal(request.service_tier,'default');
  assert.equal(request.max_output_tokens,MORNING_MAX_OUTPUT_TOKENS);
  assert.equal(request.max_output_tokens,1024);
  assert.equal(typeof request.input,'string');
});

test('budget rejection prevents any OpenAI request',async()=>{
  const guard=fakeGuard({reserveOk:false});
  let fetchCalls=0;
  const result=await askLunaForMorning(env(),{facts:{a:1}},{
    costGuard:guard,
    reservationId:'morning:test-reject',
    fetchImpl:async()=>{fetchCalls++; throw new Error('must not call');}
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'budget_rejected');
  assert.equal(result.providerCalled,false);
  assert.equal(fetchCalls,0);
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve']);
});

test('successful Morning call reserves before fetch and reconciles provider usage',async()=>{
  const guard=fakeGuard();
  let requestedBody=null;
  const result=await askLunaForMorning(env(),{facts:{a:1}},{
    costGuard:guard,
    reservationId:'morning:test-success',
    fetchImpl:async(_url,init)=>{
      requestedBody=JSON.parse(init.body);
      return {
        ok:true,
        status:200,
        async json(){
          return {
            id:'resp_test_1',
            output_text:JSON.stringify({hello:'morning'}),
            usage:{
              input_tokens:500,
              input_tokens_details:{cached_tokens:0},
              output_tokens:120,
              output_tokens_details:{reasoning_tokens:40}
            }
          };
        }
      };
    }
  });
  assert.equal(result.ok,true);
  assert.equal(result.providerCalled,true);
  assert.equal(result.responseId,'resp_test_1');
  assert.deepEqual(result.payload,{hello:'morning'});
  assert.equal(requestedBody.max_output_tokens,1024);
  assert.equal(requestedBody.service_tier,'default');
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve','reconcile']);
  assert.equal(guard.calls[1].input.budgetMonth,'2026-10');
  assert.equal(guard.calls[1].input.responseId,'resp_test_1');
});

test('HTTP failure without usage releases reservation',async()=>{
  const guard=fakeGuard();
  const result=await askLunaForMorning(env(),{facts:{a:1}},{
    costGuard:guard,
    reservationId:'morning:test-http-error',
    fetchImpl:async()=>({
      ok:false,
      status:403,
      async json(){ return {error:{message:'forbidden'}}; }
    })
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'api_error');
  assert.equal(result.providerCalled,true);
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve','cancel']);
});

test('transport ambiguity holds reservation instead of risking overspend',async()=>{
  const guard=fakeGuard();
  const result=await askLunaForMorning(env(),{facts:{a:1}},{
    costGuard:guard,
    reservationId:'morning:test-network',
    fetchImpl:async()=>{throw new Error('connection reset');}
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'transport_error_budget_held');
  assert.equal(result.budgetHeld,true);
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve']);
});

test('successful HTTP response without usage holds reservation',async()=>{
  const guard=fakeGuard();
  const result=await askLunaForMorning(env(),{facts:{a:1}},{
    costGuard:guard,
    reservationId:'morning:test-no-usage',
    fetchImpl:async()=>({
      ok:true,
      status:200,
      async json(){ return {id:'resp_no_usage',output_text:'{}'}; }
    })
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'usage_missing_budget_held');
  assert.equal(result.budgetHeld,true);
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve']);
});
