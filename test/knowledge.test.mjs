import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE_SCHEMA_VERSION, knowledgeConfigured, sha256Text } from '../src/knowledge-store.js';

test('knowledge schema version is stable',()=>{
  assert.equal(KNOWLEDGE_SCHEMA_VERSION,'luna-knowledge/v1');
});

test('knowledgeConfigured only requires a D1 binding',()=>{
  assert.equal(knowledgeConfigured({}),false);
  assert.equal(knowledgeConfigured({KNOWLEDGE_DB:{}}),true);
});

test('sha256Text is deterministic',async()=>{
  const a=await sha256Text('LUNA');
  const b=await sha256Text('LUNA');
  const c=await sha256Text('LUNA2');
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.match(a,/^[a-f0-9]{64}$/);
});
