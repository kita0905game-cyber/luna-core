import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCommuteSchedule } from '../src/commute-model.js';
import { createEmptyHubState } from '../src/hub-state.js';
import { deriveHubState } from '../src/hub-rules.js';

test('weekday commute timetable derives first train next train and leave time',()=>{
  const result=deriveCommuteSchedule('2026-09-28T21:00:00.000Z');

  assert.equal(result.schedule.serviceDate,'2026-09-29');
  assert.equal(result.schedule.dayType,'平日');
  assert.equal(result.derived.firstDeparture,'06:17');
  assert.equal(result.derived.nextDeparture,'06:33');
  assert.equal(result.derived.leaveAt,'06:02');
  assert.equal(result.derived.minutesUntilLeave,2);
  assert.equal(result.derived.phase,'soon');
});

test('weekend reference timetable reports partial once registered range ends',()=>{
  const result=deriveCommuteSchedule('2026-10-04T02:00:00.000Z');

  assert.equal(result.schedule.serviceDate,'2026-10-04');
  assert.equal(result.schedule.dayType,'土休日');
  assert.equal(result.schedule.partial,true);
  assert.equal(result.derived.firstDeparture,null);
  assert.equal(result.derived.phase,'partial');
  assert.equal(result.derived.countdown,'登録範囲外・公式確認');
});

test('HubState exposes commute as a configured CORE capability',()=>{
  const projected=deriveHubState(createEmptyHubState(),{now:'2026-09-28T21:00:00.000Z'});

  assert.equal(projected.domains.commute.status,'ready');
  assert.equal(projected.domains.commute.source,'luna-core-static-schedule');
  assert.equal(projected.domains.commute.route.from,'加美');
  assert.equal(projected.domains.commute.route.to,'JR難波');
  assert.equal(projected.domains.commute.derived.firstDeparture,'06:17');
  assert.equal(projected.capabilities.commute.configured,true);
  assert.equal(projected.capabilities.commute.status,'ready');
});
