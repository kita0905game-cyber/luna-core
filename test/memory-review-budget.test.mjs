import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_REVIEW_MAX_OUTPUT_TOKENS,
  askLunaForMemoryReview,
  buildMemoryReviewResponseRequest
} from '../src/luna-ai.js';

function env(){
  return {OPENAI_API_KEY:'test-key',OPENAI_MODEL:'gpt-6-luna'};
}

function input(){
  return {
    constitution:{body_md:'# Constitution\nUse explicit evidence.'},
    candidate:{id:'cand-1',source_type:'user_statement',summary:'Test candidate'},
    context:null
  };
}

function fakeGuard({reserveOk=true}={}){
  const calls=[];
  return {
    calls,
    async reserve(request){
      calls.push({method:'reserve',input:request});
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
    async reconcile(request){
      calls.push({method:'reconcile',input:request});
      return {
        ok:true,
        status:'reconciled',
        actual:{actualUsd:0.001},
        budget:{ok:true,status:'reconciled',month:request.budgetMonth,actualUsd:0.001,remainingUsd:1.799}
      };
    },
    async cancel(request){
      calls.push({method:'cancel',input:request});
      return {
        ok:true,
        status:'cancelled',
        budget:{ok:true,status:'cancelled',month:request.budgetMonth,remainingUsd:1.8}
      };
    }
  };
}

test('Memory Review request is bounded and uses guarded GPT-6 Luna standard tier',()=>{
  const request=buildMemoryReviewResponseRequest(env(),input());
  assert.equal(request.model,'gpt-6-luna');
  assert.equal(request.store,false);
  assert.equal(request.service_tier,'default');
  assert.equal(request.max_output_tokens,MEMORY_REVIEW_MAX_OUTPUT_TOKENS);
  assert.equal(request.max_output_tokens,1024);
  assert.equal(request.reasoning.effort,'medium');
  assert.equal(typeof request.instructions,'string');
  assert.equal(typeof request.input,'string');
});

test('Memory Review budget rejection prevents provider call',async()=>{
  const guard=fakeGuard({reserveOk:false});
  let fetchCalls=0;
  const result=await askLunaForMemoryReview(env(),input(),{
    costGuard:guard,
    reservationId:'memory-review:test-reject',
    fetchImpl:async()=>{fetchCalls++; throw new Error('must not call');}
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'budget_rejected');
  assert.equal(result.providerCalled,false);
  assert.equal(fetchCalls,0);
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve']);
});

test('successful Memory Review reconciles provider usage',async()=>{
  const guard=fakeGuard();
  let sentBody=null;
  const result=await askLunaForMemoryReview(env(),input(),{
    costGuard:guard,
    reservationId:'memory-review:test-success',
    fetchImpl:async(_url,init)=>{
      sentBody=JSON.parse(init.body);
      return {
        ok:true,
        status:200,
        async json(){
          return {
            id:'resp_memory_1',
            output_text:JSON.stringify({
              decision:'observe',
              summary:'summary',
              rationale:'reason',
              confidence:0.8,
              suggestedMemory:null
            }),
            usage:{
              input_tokens:600,
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
  assert.equal(result.responseId,'resp_memory_1');
  assert.equal(result.payload.decision,'observe');
  assert.equal(sentBody.max_output_tokens,1024);
  assert.equal(sentBody.service_tier,'default');
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve','reconcile']);
  assert.equal(guard.calls[1].input.budgetMonth,'2026-10');
  assert.equal(guard.calls[1].input.responseId,'resp_memory_1');
});

test('Memory Review HTTP failure without usage releases reservation',async()=>{
  const guard=fakeGuard();
  const result=await askLunaForMemoryReview(env(),input(),{
    costGuard:guard,
    reservationId:'memory-review:test-http-error',
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

test('Memory Review transport ambiguity holds reservation',async()=>{
  const guard=fakeGuard();
  const result=await askLunaForMemoryReview(env(),input(),{
    costGuard:guard,
    reservationId:'memory-review:test-network',
    fetchImpl:async()=>{throw new Error('connection reset');}
  });
  assert.equal(result.ok,false);
  assert.equal(result.status,'transport_error_budget_held');
  assert.equal(result.budgetHeld,true);
  assert.deepEqual(guard.calls.map((x)=>x.method),['reserve']);
});
