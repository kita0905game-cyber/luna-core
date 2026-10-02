import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_MAX_REQUEST_BYTES,
  AI_MAX_OUTPUT_TOKENS,
  AI_TEXT_PRICE_USD_PER_MILLION,
  calculateTextResponseCost,
  estimateTextResponseCost
} from '../src/ai-pricing.js';

function request(overrides={}){
  return {
    model:'gpt-6-luna',
    store:false,
    service_tier:'default',
    reasoning:{effort:'low'},
    instructions:'Use the supplied facts.',
    input:JSON.stringify({facts:['日本語の入力','English input']}),
    text:{format:{type:'text'}},
    max_output_tokens:512,
    ...overrides
  };
}

test('guarded price table approves only GPT-6 Luna standard text usage',()=>{
  assert.deepEqual(Object.keys(AI_TEXT_PRICE_USD_PER_MILLION),['gpt-6-luna']);
  assert.deepEqual(AI_TEXT_PRICE_USD_PER_MILLION['gpt-6-luna'],{
    input:0.10,
    cachedInput:0.01,
    cacheWrite:0.125,
    output:0.50
  });
});

test('reservation estimates all UTF-8 wire bytes, provider overhead, and output limit',()=>{
  const input=request();
  const amount=estimateTextResponseCost(input);
  assert.equal(amount.requestBytes,new TextEncoder().encode(JSON.stringify(input)).length);
  assert.equal(amount.maximumInputTokens,amount.requestBytes+4096);
  assert.equal(amount.maximumOutputTokens,512);
  assert.equal(amount.estimatedMicroUsd,Math.ceil(
    (amount.maximumInputTokens*0.125+512*0.50)*1.10
  ));
  assert.ok(amount.estimatedUsd>0);
});

test('unapproved models fail closed even if OpenAI offers them',()=>{
  assert.throws(()=>estimateTextResponseCost(request({model:'gpt-6-sol'})),/ai_price_unknown_model/);
  assert.throws(()=>estimateTextResponseCost(request({model:'gpt-unknown'})),/ai_price_unknown_model/);
});

test('unsupported tier, tools, history, and multimodal input fail closed',()=>{
  assert.throws(()=>estimateTextResponseCost(request({service_tier:'fast'})),/ai_unsupported_service_tier/);
  assert.throws(()=>estimateTextResponseCost(request({tools:[{type:'web_search'}]})),/ai_unsupported_request_field/);
  assert.throws(()=>estimateTextResponseCost(request({previous_response_id:'resp_123'})),/ai_unsupported_request_field/);
  assert.throws(()=>estimateTextResponseCost(request({input:[{type:'input_image',image_url:'https://x'}]})),/ai_text_only_request_required/);
  assert.throws(()=>estimateTextResponseCost(request({store:true})),/ai_store_must_be_false/);
});

test('input byte cap and mandatory output cap reject unbounded cost',()=>{
  assert.throws(()=>estimateTextResponseCost(request({input:'x'.repeat(AI_MAX_REQUEST_BYTES)})),/ai_input_too_large/);
  assert.throws(()=>estimateTextResponseCost(request({max_output_tokens:undefined})),/ai_output_limit_required/);
  assert.throws(()=>estimateTextResponseCost(request({max_output_tokens:AI_MAX_OUTPUT_TOKENS+1})),/ai_output_limit_required/);
});

test('usage counts cached input, cache writes and all output including reasoning',()=>{
  const result=calculateTextResponseCost('gpt-6-luna',{
    input_tokens:1000,
    input_tokens_details:{cached_tokens:200,cache_write_tokens:100},
    output_tokens:300,
    output_tokens_details:{reasoning_tokens:175}
  });
  assert.equal(result.actualMicroUsd,Math.ceil(200*0.01+100*0.125+700*0.10+300*0.50));
  assert.equal(result.reasoningTokens,175);
  assert.equal(result.actualUsd,result.actualMicroUsd/1_000_000);
});

test('unknown cache write detail conservatively prices all noncached input as writes',()=>{
  const result=calculateTextResponseCost('gpt-6-luna',{
    input_tokens:1000,
    input_tokens_details:{cached_tokens:200},
    output_tokens:0
  });
  assert.equal(result.actualMicroUsd,Math.ceil(200*0.01+800*0.125));
  assert.equal(result.conservativeWithoutCacheWriteDetails,true);
});

test('missing usage and malformed usage cannot turn into zero cost',()=>{
  assert.throws(()=>calculateTextResponseCost('gpt-6-luna',null),/ai_usage_missing/);
  assert.throws(()=>calculateTextResponseCost('gpt-6-luna',{input_tokens:100,output_tokens:undefined}),/ai_invalid_output_tokens/);
  assert.throws(()=>calculateTextResponseCost('gpt-6-luna',{
    input_tokens:100,input_tokens_details:{cached_tokens:70,cache_write_tokens:50},output_tokens:10
  }),/ai_invalid_usage_breakdown/);
});
