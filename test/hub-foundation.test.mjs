import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLunaEvent } from '../src/luna-event.js';
import {
  HUB_STATE_SCHEMA_VERSION,
  createEmptyHubState,
  normalizeHubState,
  projectHubEvent
} from '../src/hub-state.js';

test('normalizes a canonical event and infers its domain',()=>{
  const event=normalizeLunaEvent({
    eventId:'care-nail-2026-10-01',
    type:'care.nail.completed',
    source:'luna-home',
    occurredAt:'2026-10-01T11:00:00+09:00',
    payload:{statePatch:{nails:{lastDone:'2026-10-01'}}}
  });

  assert.equal(event.domain,'care');
  assert.equal(event.occurredAt,'2026-10-01T02:00:00.000Z');
  assert.equal(event.payload.statePatch.nails.lastDone,'2026-10-01');
});

test('projects only the matching domain and increments v2 revision',()=>{
  const event=normalizeLunaEvent({
    eventId:'study-answer-1',
    type:'study.bookkeeping_answered',
    source:'airtable',
    occurredAt:'2026-10-01T12:00:00+09:00',
    payload:{statePatch:{todayCount:1,recommendedTopic:'帳簿記入'}}
  });

  const next=projectHubEvent(createEmptyHubState(),event,{processedAt:'2026-10-01T03:00:01.000Z'});

  assert.equal(next.schemaVersion,HUB_STATE_SCHEMA_VERSION);
  assert.equal(next.meta.revision,1);
  assert.equal(next.meta.storedUpdatedAt,'2026-10-01T03:00:01.000Z');
  assert.equal(next.domains.study.todayCount,1);
  assert.equal(next.domains.study.recommendedTopic,'帳簿記入');
  assert.equal(next.domains.study.status,'ready');
  assert.equal(next.domains.study.source,'airtable');
  assert.equal(next.domains.study.freshness.status,'fresh');
  assert.equal(next.domains.care.status,'unknown');
  assert.equal(next.lastEvent.eventId,'study-answer-1');
});

test('system events change the structured global mode',()=>{
  const event=normalizeLunaEvent({
    eventId:'mode-commute-1',
    type:'system.mode.changed',
    source:'luna-core',
    occurredAt:'2026-10-01T07:00:00+09:00',
    payload:{statePatch:{mode:'commute'}}
  });

  const next=projectHubEvent(createEmptyHubState(),event,{processedAt:'2026-09-30T22:00:01.000Z'});
  assert.equal(next.mode.current,'commute');
  assert.equal(next.mode.since,'2026-09-30T22:00:00.000Z');
  assert.equal(next.mode.source,'luna-core');
  assert.equal(next.domains.system.mode,'commute');
});

test('migrates legacy v1 state without losing domain facts',()=>{
  const legacy={
    schemaVersion:'luna-hub-state/v1',
    revision:7,
    mode:'home',
    updatedAt:'2026-09-29T01:00:00.000Z',
    lastEvent:{eventId:'legacy-7',processedAt:'2026-09-29T01:00:00.000Z'},
    domains:{
      health:{
        status:'unknown',
        updatedAt:'2026-09-29T00:30:00.000Z',
        morning:{lastRecordedDate:'2026-09-29'}
      },
      care:{
        nails:{lastDone:'2026-09-24'}
      }
    }
  };

  const next=normalizeHubState(legacy);
  assert.equal(next.schemaVersion,HUB_STATE_SCHEMA_VERSION);
  assert.equal(next.meta.revision,7);
  assert.equal(next.meta.storedUpdatedAt,'2026-09-29T01:00:00.000Z');
  assert.equal(next.mode.current,'home');
  assert.equal(next.domains.health.morning.lastRecordedDate,'2026-09-29');
  assert.equal(next.domains.care.nails.lastDone,'2026-09-24');
  assert.equal(next.domains.health.freshness.updatedAt,'2026-09-29T00:30:00.000Z');
});

test('rejects unknown event domains',()=>{
  assert.throws(()=>normalizeLunaEvent({
    eventId:'bad-1',
    type:'unknown.changed',
    source:'test',
    occurredAt:'2026-10-01T00:00:00Z'
  }),/event_domain_invalid/);
});
