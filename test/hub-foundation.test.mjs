import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLunaEvent } from '../src/luna-event.js';
import { createEmptyHubState, projectHubEvent } from '../src/hub-state.js';

test('normalizes a canonical event and infers its domain',()=>{
  const event=normalizeLunaEvent({
    eventId:'care-nail-2026-10-01',
    type:'care.nail.completed',
    source:'luna-home',
    occurredAt:'2026-10-01T11:00:00+09:00',
    payload:{statePatch:{nail:{lastDone:'2026-10-01',showToday:false}}}
  });

  assert.equal(event.domain,'care');
  assert.equal(event.occurredAt,'2026-10-01T02:00:00.000Z');
  assert.equal(event.payload.statePatch.nail.showToday,false);
});

test('projects only the matching domain and increments revision',()=>{
  const event=normalizeLunaEvent({
    eventId:'study-answer-1',
    type:'study.bookkeeping_answered',
    source:'airtable',
    occurredAt:'2026-10-01T12:00:00+09:00',
    payload:{statePatch:{todayCount:1,recommendedTopic:'帳簿記入'}}
  });

  const next=projectHubEvent(createEmptyHubState(),event,{processedAt:'2026-10-01T03:00:01.000Z'});

  assert.equal(next.revision,1);
  assert.equal(next.domains.study.todayCount,1);
  assert.equal(next.domains.study.recommendedTopic,'帳簿記入');
  assert.equal(next.domains.care.status,'unknown');
  assert.equal(next.lastEvent.eventId,'study-answer-1');
});

test('system events can change the global mode',()=>{
  const event=normalizeLunaEvent({
    eventId:'mode-commute-1',
    type:'system.mode.changed',
    source:'luna-core',
    occurredAt:'2026-10-01T07:00:00+09:00',
    payload:{statePatch:{mode:'commute'}}
  });

  const next=projectHubEvent(createEmptyHubState(),event,{processedAt:'2026-09-30T22:00:01.000Z'});
  assert.equal(next.mode,'commute');
  assert.equal(next.domains.system.mode,'commute');
});

test('rejects unknown event domains',()=>{
  assert.throws(()=>normalizeLunaEvent({
    eventId:'bad-1',
    type:'unknown.changed',
    source:'test',
    occurredAt:'2026-10-01T00:00:00Z'
  }),/event_domain_invalid/);
});
