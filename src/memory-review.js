import {
  knowledgeConfigured,
  getPreferredConstitution,
  listMemoryCandidates,
  reviewMemoryCandidate
} from './knowledge-store.js';
import { askLunaForMemoryReview } from './luna-ai.js';
import { createAiCostGuard } from './ai-budget-guard.js';
import { AI_BUDGET_OBJECT_NAME } from './ai-budget-model.js';

function clampLimit(value){
  const n=Number(value);
  return Math.max(1,Math.min(10,Number.isFinite(n)?Math.floor(n):5));
}

function statusFromDecision(candidate,decision){
  if(decision==='discard') return 'discarded';
  if(decision==='ask_user') return 'ask_user';
  if(decision==='promote'){
    // Formal SB writes require an explicit target document and provenance.
    // A background AI recommendation alone never writes durable memory.
    return candidate?.source_type==='user_statement'?'ask_user':'observing';
  }
  return 'observing';
}

export async function runMemoryCandidateReview(env,{
  limit=5,
  allowDraftConstitution=false,
  manual=false,
  context=null
}={}){
  if(!knowledgeConfigured(env)) return {status:'skipped',reason:'knowledge_db_not_configured',reviewed:0};
  if(!manual&&env.LUNA_MEMORY_REVIEW_ENABLED!=='true') return {status:'skipped',reason:'memory_review_disabled',reviewed:0};
  if(!env.OPENAI_API_KEY) return {status:'skipped',reason:'openai_api_key_not_configured',reviewed:0};
  if(!env.AI_BUDGET) return {status:'skipped',reason:'ai_budget_not_configured',reviewed:0};

  const constitution=await getPreferredConstitution(env,{allowDraft:allowDraftConstitution});
  if(!constitution) return {status:'skipped',reason:'constitution_not_available',reviewed:0};

  const candidates=await listMemoryCandidates(env,{status:'observing',limit:clampLimit(limit)});
  if(candidates.length===0) return {status:'completed',constitutionId:constitution.id,reviewed:0,results:[]};

  const results=[];
  const costGuard=createAiCostGuard(env.AI_BUDGET.getByName(AI_BUDGET_OBJECT_NAME));
  for(const candidate of candidates){
    const ai=await askLunaForMemoryReview(env,{constitution,candidate,context},{
      costGuard,
      reservationId:`memory-review:${candidate.id}:${crypto.randomUUID()}`
    });
    if(!ai.ok){
      results.push({
        id:candidate.id,
        status:'error',
        error:ai.error||ai.status,
        aiStatus:ai.status??null,
        aiUsed:ai.providerCalled===true,
        budget:ai.budget??null
      });
      continue;
    }
    const decision=ai.payload?.decision||'observe';
    const nextStatus=statusFromDecision(candidate,decision);
    const reason=[
      `decision=${decision}`,
      ai.payload?.rationale||'',
      ai.payload?.suggestedMemory?`suggested=${ai.payload.suggestedMemory}`:''
    ].filter(Boolean).join(' | ').slice(0,500);
    const updated=await reviewMemoryCandidate(env,candidate.id,{status:nextStatus,reason});
    results.push({
      id:candidate.id,
      sourceType:candidate.source_type,
      decision,
      nextStatus,
      confidence:ai.payload?.confidence??null,
      summary:ai.payload?.summary??candidate.summary,
      suggestedMemory:ai.payload?.suggestedMemory??null,
      responseId:ai.responseId??null,
      budget:ai.budget??null,
      updatedAt:updated?.updated_at??null
    });
  }

  return {
    status:results.some((r)=>r.status==='error')?'partial':'completed',
    constitutionId:constitution.id,
    constitutionVersion:constitution.version,
    reviewed:results.length,
    results
  };
}
