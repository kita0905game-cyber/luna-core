// Text-only Responses API pricing, reviewed against official OpenAI model documentation
// on 2026-10-02. Update before changing models or service tier.
// All prices are USD per million tokens, standard processing, short context.
export const AI_PRICE_TABLE_REVIEWED_AT='2026-10-02';
export const AI_TEXT_PRICE_USD_PER_MILLION=Object.freeze({
  'gpt-6-luna':Object.freeze({input:0.10,cachedInput:0.01,cacheWrite:0.125,output:0.50})
});

export const AI_MAX_REQUEST_BYTES=32*1024;
export const AI_INPUT_OVERHEAD_TOKENS=4096;
export const AI_MAX_OUTPUT_TOKENS=4096;
const ESTIMATE_MARGIN=1.10;
const ALLOWED_FIELDS=new Set([
  'model','store','service_tier','reasoning','instructions','input',
  'text','max_output_tokens'
]);

function priceFor(model){
  const rate=AI_TEXT_PRICE_USD_PER_MILLION[model];
  if(!rate) throw new Error('ai_price_unknown_model');
  return rate;
}

function tokenCount(value,name){
  if(!Number.isSafeInteger(value)||value<0) throw new Error('ai_invalid_'+name);
  return value;
}

function moneyFromMicro(micros){
  if(!Number.isSafeInteger(micros)||micros<0) throw new Error('ai_invalid_cost');
  return micros/1_000_000;
}

/**
 * Conservative reservation estimate for a single text-only Responses request.
 * No tools, remote prompts, previous responses, multimodal content, Batch,
 * Flex/Fast, or regional processing. Input is restricted to a single string.
 * For UTF-8 text, serialized wire bytes bound the tokenizable bytes; add
 * 4096 tokens for provider overhead. Count all input at cache-write pricing.
 * output_tokens includes invisible reasoning and formatting tokens.
 *
 * This function does not send an API request or mutate the budget ledger.
 */
export function estimateTextResponseCost(request){
  if(!request||typeof request!=='object'||Array.isArray(request)){
    throw new Error('ai_invalid_request');
  }
  for(const field of Object.keys(request)){
    if(!ALLOWED_FIELDS.has(field)) throw new Error('ai_unsupported_request_field');
  }
  const rate=priceFor(request.model);
  if(typeof request.instructions!=='string'||typeof request.input!=='string'){
    throw new Error('ai_text_only_request_required');
  }
  if(request.service_tier!==undefined&&request.service_tier!=='default'){
    throw new Error('ai_unsupported_service_tier');
  }
  const outputLimit=request.max_output_tokens;
  if(!Number.isSafeInteger(outputLimit)||outputLimit<1||outputLimit>AI_MAX_OUTPUT_TOKENS){
    throw new Error('ai_output_limit_required');
  }
  if(request.store!==false) throw new Error('ai_store_must_be_false');
  const json=JSON.stringify(request);
  if(typeof json!=='string') throw new Error('ai_invalid_request');
  const requestBytes=new TextEncoder().encode(json).byteLength;
  if(requestBytes>AI_MAX_REQUEST_BYTES) throw new Error('ai_input_too_large');

  const maximumInputTokens=requestBytes+AI_INPUT_OVERHEAD_TOKENS;
  // All noncached input is costed at the higher cache-write rate,
  // even when the provider would normally charge less.
  const estimatedMicroUsd=Math.ceil(
    (maximumInputTokens*rate.cacheWrite+outputLimit*rate.output)*ESTIMATE_MARGIN
  );
  return {
    model:request.model,
    priceReviewedAt:AI_PRICE_TABLE_REVIEWED_AT,
    requestBytes,
    maximumInputTokens,
    maximumOutputTokens:outputLimit,
    estimatedMicroUsd,
    estimatedUsd:moneyFromMicro(estimatedMicroUsd),
    assumptions:'text-only/default-tier/short-context/no-tools/no-multimodal'
  };
}

/**
 * Bill response usage, including reasoning tokens within output_tokens.
 * input_tokens includes cached tokens and cache_write_tokens.
 * Where cache-write detail is omitted, charge all noncached input at the
 * more expensive cache-write rate rather than undercount the bill.
 */
export function calculateTextResponseCost(model,usage){
  const rate=priceFor(model);
  if(!usage||typeof usage!=='object') throw new Error('ai_usage_missing');
  const input=tokenCount(usage.input_tokens,'input_tokens');
  const output=tokenCount(usage.output_tokens,'output_tokens');
  const details=usage.input_tokens_details??{};
  if(!details||typeof details!=='object') throw new Error('ai_invalid_input_details');
  const cached=details.cached_tokens===undefined?0:tokenCount(details.cached_tokens,'cached_tokens');
  const hasWriteTokens=details.cache_write_tokens!==undefined;
  const written=hasWriteTokens?tokenCount(details.cache_write_tokens,'cache_write_tokens'):0;
  if(cached+written>input) throw new Error('ai_invalid_usage_breakdown');
  const unclassified=input-cached-written;
  const noncachedRate=hasWriteTokens?rate.input:rate.cacheWrite;
  const actualMicroUsd=Math.ceil(
    cached*rate.cachedInput+
    written*rate.cacheWrite+
    unclassified*noncachedRate+
    output*rate.output
  );
  return {
    model,
    priceReviewedAt:AI_PRICE_TABLE_REVIEWED_AT,
    inputTokens:input,
    cachedInputTokens:cached,
    cacheWriteTokens:hasWriteTokens?written:null,
    outputTokens:output,
    reasoningTokens:usage.output_tokens_details?.reasoning_tokens??null,
    actualMicroUsd,
    actualUsd:moneyFromMicro(actualMicroUsd),
    conservativeWithoutCacheWriteDetails:!hasWriteTokens
  };
}
