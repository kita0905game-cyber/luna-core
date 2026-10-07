import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiaryBackfill } from '../src/diary-summary.js';

function entry(id,date){
  return {id,fields:{Date:date}};
}

test('backfill selects old diary entries in chronological order',()=>{
  const result=selectDiaryBackfill([
    entry('c','2026-10-07'),
    entry('a','2026-09-27'),
    entry('d','2026-10-08'),
    entry('b','2026-10-05')
  ],{today:'2026-10-08',limit:10});
  assert.deepEqual(result.map((item)=>item.id),['a','b','c']);
});

test('backfill respects the per-run cap',()=>{
  const result=selectDiaryBackfill([
    entry('a','2026-09-27'),
    entry('b','2026-09-28'),
    entry('c','2026-10-05')
  ],{today:'2026-10-08',limit:2});
  assert.deepEqual(result.map((item)=>item.id),['a','b']);
});
