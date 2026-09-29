import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyHubState } from '../src/hub-state.js';
import {
  deriveHubState,
  hairRemovalDue,
  jstDateKey,
  nailDue,
  nextNailTarget,
  scheduledWorkoutPlan,
  weekStartMonday
} from '../src/hub-rules.js';

test('uses Asia/Tokyo date at read time',()=>{
  assert.equal(jstDateKey('2026-09-28T23:30:00Z'),'2026-09-29');
});

test('morning record hides the body-record card only for the recorded day',()=>{
  const state=createEmptyHubState();
  state.domains.health.morning={lastRecordedDate:'2026-09-29'};
  const sameDay=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});
  const nextDay=deriveHubState(state,{now:'2026-09-30T03:00:00Z'});

  assert.equal(sameDay.domains.health.morning.completedToday,true);
  assert.equal(sameDay.domains.health.morning.showToday,false);
  assert.equal(nextDay.domains.health.morning.completedToday,false);
  assert.equal(nextDay.domains.health.morning.showToday,true);
});

test('hair removal follows Tue Thu Sat targets with previous-day suppression',()=>{
  assert.equal(hairRemovalDue('2026-09-28','2026-09-29'),false);
  assert.equal(hairRemovalDue('2026-09-27','2026-09-29'),true);
  assert.equal(hairRemovalDue('2026-09-30','2026-10-01'),false);
  assert.equal(hairRemovalDue('2026-10-02','2026-10-03'),false);
  assert.equal(hairRemovalDue(null,'2026-10-04'),false);
});

test('nails allow Tue or Wed early completion and carry missed Thursday forward',()=>{
  assert.equal(nextNailTarget('2026-09-29','2026-10-01'),'2026-10-08');
  assert.equal(nailDue('2026-09-29','2026-10-01'),false);

  assert.equal(nextNailTarget('2026-09-24','2026-10-01'),'2026-10-01');
  assert.equal(nailDue('2026-09-24','2026-10-01'),true);
  assert.equal(nailDue('2026-09-24','2026-10-02'),true);
  assert.equal(nailDue('2026-09-24','2026-10-05'),true);
});

test('workout projection matches the current PPL schedule and weekly count',()=>{
  assert.equal(scheduledWorkoutPlan('2026-09-28'),'push');
  assert.equal(scheduledWorkoutPlan('2026-09-29'),'pull');
  assert.equal(scheduledWorkoutPlan('2026-09-30'),'legs');
  assert.equal(scheduledWorkoutPlan('2026-10-04'),'recovery');
  assert.equal(weekStartMonday('2026-09-29'),'2026-09-28');

  const state=createEmptyHubState();
  state.domains.workout={
    recentCompletedDates:['2026-09-28','2026-09-29','2026-09-29'],
    lastCompletedDate:'2026-09-29',
    lastPlan:'pull',
    lastKind:'full'
  };
  const projected=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});

  assert.equal(projected.domains.workout.todayPlan,'pull');
  assert.equal(projected.domains.workout.weekCount,2);
  assert.equal(projected.domains.workout.completedToday,true);
  assert.equal(projected.domains.workout.actionNeeded,false);
  assert.equal(projected.domains.workout.showToday,true);
});

test('care projection exposes HOME-ready pending state',()=>{
  const state=createEmptyHubState();
  state.domains.care={
    hairRemoval:{lastDone:'2026-09-28'},
    nails:{lastDone:'2026-09-24'}
  };
  const projected=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});

  assert.equal(projected.domains.care.hairRemoval.showToday,false);
  assert.equal(projected.domains.care.nails.showToday,false);
  assert.deepEqual(projected.domains.care.pending,[]);
  assert.equal(projected.domains.care.showToday,false);
});
