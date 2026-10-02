import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_BUDGET_INTERNAL_HARD_CAP_USD,
  budgetStatus,
  cancelBudgetReservation,
  createBudgetLedger,
  effectiveLimitUsd,
  monthKeyFromDate,
  reconcileBudget,
  reserveBudget
} from '../src/ai-budget-model.js';

test('AI budget hard cap cannot be configured above 1.80 USD',()=>{
  assert.equal(AI_BUDGET_INTERNAL_HARD_CAP_USD,1.8);
  assert.equal(effectiveLimitUsd(9),1.8);
  assert.equal(effectiveLimitUsd(1.5),1.5);
  assert.equal(effectiveLimitUsd(undefined),1.8);
});

test('AI budget month rolls over on the OpenAI UTC calendar month',()=>{
  assert.equal(monthKeyFromDate('2026-09-30T23:59:59.999Z'),'2026-09');
  assert.equal(monthKeyFromDate('2026-10-01T00:00:00.000Z'),'2026-10');
});

test('reservations are idempotent and cannot exceed monthly cap',()=>{
  let ledger=createBudgetLedger({month:'2026-10',limitUsd:1.8});
  let r=reserveBudget(ledger,{reservationId:'a',estimatedUsd:1,purpose:'lq-gm',createdAt:'2026-10-01T00:00:00Z'});
  assert.equal(r.receipt.ok,true);
  assert.equal(r.receipt.duplicate,false);
  ledger=r.ledger;

  r=reserveBudget(ledger,{reservationId:'a',estimatedUsd:1,purpose:'lq-gm',createdAt:'2026-10-01T00:00:01Z'});
  assert.equal(r.receipt.ok,true);
  assert.equal(r.receipt.duplicate,true);
  assert.equal(r.ledger,ledger);

  r=reserveBudget(ledger,{reservationId:'b',estimatedUsd:0.8,purpose:'core',createdAt:'2026-10-01T00:00:02Z'});
  assert.equal(r.receipt.ok,true);
  ledger=r.ledger;
  assert.equal(budgetStatus(ledger).remainingUsd,0);

  const rejected=reserveBudget(ledger,{reservationId:'c',estimatedUsd:0.000001,purpose:'core',createdAt:'2026-10-01T00:00:03Z'});
  assert.equal(rejected.receipt.ok,false);
  assert.equal(rejected.receipt.reason,'ai_budget_exhausted');
  assert.equal(rejected.ledger,ledger);
});

test('same reservation id with different estimate is rejected',()=>{
  let ledger=createBudgetLedger({month:'2026-10',limitUsd:1.8});
  ledger=reserveBudget(ledger,{reservationId:'same',estimatedUsd:0.2,purpose:'core'}).ledger;
  assert.throws(
    ()=>reserveBudget(ledger,{reservationId:'same',estimatedUsd:0.3,purpose:'core'}),
    /reservation_id_conflict/
  );
});

test('reconcile releases reservation and records actual spend exactly once',()=>{
  let ledger=createBudgetLedger({month:'2026-10',limitUsd:1.8});
  ledger=reserveBudget(ledger,{reservationId:'r1',estimatedUsd:0.5,purpose:'lq-gm'}).ledger;

  let result=reconcileBudget(ledger,{reservationId:'r1',actualUsd:0.2,responseId:'resp_1',completedAt:'2026-10-01T10:00:00Z'});
  ledger=result.ledger;
  assert.equal(result.receipt.status,'reconciled');
  assert.equal(result.receipt.duplicate,false);
  assert.equal(budgetStatus(ledger).spentUsd,0.2);
  assert.equal(budgetStatus(ledger).reservedUsd,0);

  result=reconcileBudget(ledger,{reservationId:'r1',actualUsd:0.2,responseId:'resp_1',completedAt:'2026-10-01T10:00:01Z'});
  assert.equal(result.receipt.duplicate,true);
  assert.equal(result.ledger,ledger);
  assert.equal(budgetStatus(ledger).spentUsd,0.2);
});

test('cancel releases reservation without increasing spend',()=>{
  let ledger=createBudgetLedger({month:'2026-10',limitUsd:1.8});
  ledger=reserveBudget(ledger,{reservationId:'r2',estimatedUsd:0.4,purpose:'core'}).ledger;
  const result=cancelBudgetReservation(ledger,{reservationId:'r2',reason:'provider_failure',cancelledAt:'2026-10-01T11:00:00Z'});
  ledger=result.ledger;
  assert.equal(result.receipt.status,'cancelled');
  assert.equal(budgetStatus(ledger).spentUsd,0);
  assert.equal(budgetStatus(ledger).reservedUsd,0);
  assert.equal(budgetStatus(ledger).remainingUsd,1.8);
});

test('actual spend above reservation remains visible as over-limit instead of being hidden',()=>{
  let ledger=createBudgetLedger({month:'2026-10',limitUsd:1.8});
  ledger=reserveBudget(ledger,{reservationId:'r3',estimatedUsd:1.7,purpose:'core'}).ledger;
  ledger=reconcileBudget(ledger,{reservationId:'r3',actualUsd:1.9,completedAt:'2026-10-01T12:00:00Z'}).ledger;
  const status=budgetStatus(ledger);
  assert.equal(status.spentUsd,1.9);
  assert.equal(status.overLimit,true);
  assert.equal(status.remainingUsd,0);
});
