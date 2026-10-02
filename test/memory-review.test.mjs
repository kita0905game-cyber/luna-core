import test from 'node:test';
import assert from 'node:assert/strict';
import { runMemoryCandidateReview } from '../src/memory-review.js';

test('scheduled memory review is inert without D1',async()=>{
  const result=await runMemoryCandidateReview({}, {});
  assert.equal(result.status,'skipped');
  assert.equal(result.reason,'knowledge_db_not_configured');
  assert.equal(result.reviewed,0);
});

test('scheduled memory review is disabled by default',async()=>{
  const fakeDb={};
  const result=await runMemoryCandidateReview({KNOWLEDGE_DB:fakeDb}, {});
  assert.equal(result.status,'skipped');
  assert.equal(result.reason,'memory_review_disabled');
});

test('manual memory review also fails closed when AI budget is not configured',async()=>{
  const fakeDb={};
  const result=await runMemoryCandidateReview({
    KNOWLEDGE_DB:fakeDb,
    OPENAI_API_KEY:'test-key'
  },{
    manual:true
  });
  assert.equal(result.status,'skipped');
  assert.equal(result.reason,'ai_budget_not_configured');
  assert.equal(result.reviewed,0);
});
