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

test('morning record derives HOME state without changing the stored fact',()=>{
  const state=createEmptyHubState();
  state.domains.health.morning={lastRecordedDate:'2026-09-29'};
  const sameDay=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});
  const nextDay=deriveHubState(state,{now:'2026-09-30T03:00:00Z'});

  assert.equal(sameDay.domains.health.morning.derived.completedToday,true);
  assert.equal(sameDay.domains.health.morning.derived.showToday,false);
  assert.equal(nextDay.domains.health.morning.derived.completedToday,false);
  assert.equal(nextDay.domains.health.morning.derived.showToday,true);
  assert.equal(state.domains.health.morning.derived,undefined);
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

test('workout projection matches current PPL schedule and weekly count',()=>{
  assert.equal(scheduledWorkoutPlan('2026-09-28'),'push');
  assert.equal(scheduledWorkoutPlan('2026-09-29'),'pull');
  assert.equal(scheduledWorkoutPlan('2026-09-30'),'legs');
  assert.equal(scheduledWorkoutPlan('2026-10-04'),'recovery');
  assert.equal(weekStartMonday('2026-09-29'),'2026-09-28');

  const state=createEmptyHubState();
  state.domains.workout={
    ...state.domains.workout,
    recentCompletedDates:['2026-09-28','2026-09-29','2026-09-29'],
    lastCompletedDate:'2026-09-29',
    lastPlan:'pull',
    lastKind:'full'
  };
  const projected=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});

  assert.equal(projected.domains.workout.derived.todayPlan,'pull');
  assert.equal(projected.domains.workout.derived.weekCount,2);
  assert.equal(projected.domains.workout.derived.completedToday,true);
  assert.equal(projected.domains.workout.derived.actionNeeded,false);
  assert.equal(projected.domains.workout.derived.showToday,true);
});

test('current response exposes HOME-ready cards actions and capabilities',()=>{
  const state=createEmptyHubState();
  state.domains.health={
    ...state.domains.health,
    status:'ready',
    morning:{lastRecordedDate:'2026-09-28'}
  };
  state.domains.care={
    ...state.domains.care,
    status:'ready',
    hairRemoval:{lastDone:'2026-09-27'},
    nails:{lastDone:'2026-09-24'}
  };
  state.domains.workout={
    ...state.domains.workout,
    status:'ready',
    recentCompletedDates:['2026-09-28']
  };

  const projected=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});
  const bodyCard=projected.home.cards.find((card)=>card.id==='morning-body');
  const careCard=projected.home.cards.find((card)=>card.id==='care');
  const workoutCard=projected.home.cards.find((card)=>card.id==='workout');

  assert.equal(projected.meta.localDate,'2026-09-29');
  assert.equal(projected.meta.timeZone,'Asia/Tokyo');
  assert.equal(bodyCard.visible,true);
  assert.equal(bodyCard.reasonCode,'not_recorded_today');
  assert.equal(careCard.visible,true);
  assert.deepEqual(careCard.data.pending,['hairRemoval']);
  assert.equal(workoutCard.visible,true);
  assert.equal(workoutCard.state,'todo');
  assert.equal(projected.home.alerts.length,0);
  assert.equal(projected.home.actions.find((action)=>action.id==='health.recordMorning').enabled,true);
  assert.equal(projected.capabilities.health.status,'ready');
  assert.equal(projected.capabilities.calendar.status,'planned');
});

test('freshness expires dynamic data when expiresAt passes',()=>{
  const state=createEmptyHubState();
  state.domains.weather={
    ...state.domains.weather,
    status:'ready',
    updatedAt:'2026-09-29T00:00:00.000Z',
    freshness:{
      status:'fresh',
      updatedAt:'2026-09-29T00:00:00.000Z',
      expiresAt:'2026-09-29T01:00:00.000Z'
    }
  };
  const projected=deriveHubState(state,{now:'2026-09-29T02:00:00.000Z'});
  assert.equal(projected.domains.weather.freshness.status,'expired');
});


test('study projection resets daily counters when snapshot date is not today',()=>{
  const state=createEmptyHubState();
  state.domains.study={
    ...state.domains.study,
    status:'ready',
    bookkeeping:{
      snapshotDate:'2026-09-28',
      attemptedTotal:120,
      correctTotal:100,
      todayCount:8,
      todayCorrect:7,
      latestCategory:'帳簿記入',
      recommendedTopic:'帳簿記入',
      weakness:[{category:'帳簿記入',status:'苦手候補',score:55}]
    }
  };

  const projected=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});
  assert.equal(projected.domains.study.bookkeeping.derived.todayCount,0);
  assert.equal(projected.domains.study.bookkeeping.derived.todayCorrect,0);
  assert.equal(projected.domains.study.bookkeeping.derived.studiedToday,false);
  assert.equal(projected.domains.study.bookkeeping.attemptedTotal,120);
});

test('study projection exposes HOME-ready bookkeeping card and recommendation',()=>{
  const state=createEmptyHubState();
  state.domains.study={
    ...state.domains.study,
    status:'ready',
    bookkeeping:{
      snapshotDate:'2026-09-29',
      attemptedTotal:128,
      correctTotal:107,
      todayCount:8,
      todayCorrect:7,
      lastAttemptAt:'2026-09-29T02:50:00.000Z',
      latestCategory:'帳簿記入',
      weakness:[{category:'帳簿記入',status:'苦手候補',score:55}],
      recommendedTopic:'帳簿記入'
    }
  };

  const projected=deriveHubState(state,{now:'2026-09-29T03:00:00Z'});
  const study=projected.domains.study.bookkeeping.derived;
  const card=projected.home.cards.find((item)=>item.id==='study');

  assert.equal(study.todayCount,8);
  assert.equal(study.todayCorrect,7);
  assert.equal(study.studiedToday,true);
  assert.equal(study.recommendedTopic,'帳簿記入');
  assert.equal(card.state,'done');
  assert.equal(card.subtitle,'今日 8問・正解 7問');
  assert.equal(card.data.recommendedTopic,'帳簿記入');
  assert.equal(projected.home.actions.find((action)=>action.id==='study.openBookkeeping').enabled,true);
  assert.equal(projected.capabilities.study.status,'ready');
});
