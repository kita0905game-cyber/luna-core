export const AI_BUDGET_SCHEMA_VERSION='luna-ai-budget/v1';
export const AI_BUDGET_INTERNAL_HARD_CAP_USD=1.8;
export const USD_MICROS=1_000_000;
const HISTORY_LIMIT=200;

function finiteNumber(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

export function usdToMicros(value){
  const n=finiteNumber(value);
  if(n===null||n<0) throw new Error('invalid_usd_amount');
  return Math.round(n*USD_MICROS);
}

export function microsToUsd(value){
  const n=finiteNumber(value);
  if(n===null||n<0) throw new Error('invalid_micro_usd_amount');
  return n/USD_MICROS;
}

export function effectiveLimitUsd(value){
  const n=finiteNumber(value);
  if(n===null||n<=0) return AI_BUDGET_INTERNAL_HARD_CAP_USD;
  return Math.min(n,AI_BUDGET_INTERNAL_HARD_CAP_USD);
}

export function monthKeyFromDate(value=new Date(),timeZone='Asia/Tokyo'){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw new Error('invalid_budget_time');
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone,
    year:'numeric',
    month:'2-digit'
  }).formatToParts(date);
  const year=parts.find((part)=>part.type==='year')?.value;
  const month=parts.find((part)=>part.type==='month')?.value;
  if(!year||!month) throw new Error('budget_month_resolution_failed');
  return `${year}-${month}`;
}

function normalizeReservationId(value){
  const id=String(value??'').trim();
  if(!id||id.length>160) throw new Error('invalid_reservation_id');
  return id;
}

function normalizePurpose(value){
  const purpose=String(value??'unspecified').trim()||'unspecified';
  return purpose.slice(0,120);
}

function normalizeIso(value){
  const date=value?new Date(value):new Date();
  if(Number.isNaN(date.getTime())) throw new Error('invalid_budget_time');
  return date.toISOString();
}

function trimHistory(history){
  return Array.isArray(history)?history.slice(-HISTORY_LIMIT):[];
}

export function normalizeBudgetMonth(value){
  const month=String(value??'').trim();
  if(!/^\d{4}-\d{2}$/.test(month)) throw new Error('invalid_budget_month');
  return month;
}

export function resolveBudgetMonth({month,now,timeZone='Asia/Tokyo'}={}){
  return month===undefined||month===null
    ? monthKeyFromDate(now??new Date(),timeZone)
    : normalizeBudgetMonth(month);
}

export function createBudgetLedger({month,limitUsd=AI_BUDGET_INTERNAL_HARD_CAP_USD}){
  month=normalizeBudgetMonth(month);
  return {
    schemaVersion:AI_BUDGET_SCHEMA_VERSION,
    month,
    limitMicros:usdToMicros(effectiveLimitUsd(limitUsd)),
    spentMicros:0,
    reservedMicros:0,
    reservations:{},
    history:[]
  };
}

export function normalizeBudgetLedger(raw,{month,limitUsd=AI_BUDGET_INTERNAL_HARD_CAP_USD}){
  const base=createBudgetLedger({month,limitUsd});
  if(!raw||raw.schemaVersion!==AI_BUDGET_SCHEMA_VERSION||raw.month!==month) return base;
  const reservations=raw.reservations&&typeof raw.reservations==='object'&&!Array.isArray(raw.reservations)
    ? raw.reservations
    : {};
  const spent=Math.max(0,Math.round(finiteNumber(raw.spentMicros)??0));
  const reservedFromRows=Object.values(reservations).reduce((sum,row)=>{
    const value=finiteNumber(row?.amountMicros);
    return sum+(value!==null&&value>0?Math.round(value):0);
  },0);
  return {
    ...base,
    spentMicros:spent,
    reservedMicros:reservedFromRows,
    reservations,
    history:trimHistory(raw.history)
  };
}

function statusView(ledger){
  const committed=ledger.spentMicros+ledger.reservedMicros;
  return {
    schemaVersion:ledger.schemaVersion,
    month:ledger.month,
    limitUsd:microsToUsd(ledger.limitMicros),
    spentUsd:microsToUsd(ledger.spentMicros),
    reservedUsd:microsToUsd(ledger.reservedMicros),
    remainingUsd:microsToUsd(Math.max(0,ledger.limitMicros-committed)),
    overLimit:committed>ledger.limitMicros,
    openReservations:Object.keys(ledger.reservations).length
  };
}

export function budgetStatus(ledger){
  return statusView(ledger);
}

function priorHistoryEntry(ledger,reservationId){
  for(let i=ledger.history.length-1;i>=0;i--){
    const row=ledger.history[i];
    if(row?.reservationId===reservationId) return row;
  }
  return null;
}

export function reserveBudget(ledger,{
  reservationId,
  estimatedUsd,
  purpose='unspecified',
  createdAt
}){
  const id=normalizeReservationId(reservationId);
  const amountMicros=usdToMicros(estimatedUsd);
  if(amountMicros<=0) throw new Error('reservation_amount_must_be_positive');
  const normalizedPurpose=normalizePurpose(purpose);
  const existing=ledger.reservations[id];
  if(existing){
    if(existing.amountMicros!==amountMicros||existing.purpose!==normalizedPurpose) throw new Error('reservation_id_conflict');
    return {
      ledger,
      receipt:{
        ok:true,
        status:'reserved',
        duplicate:true,
        reservationId:id,
        estimatedUsd:microsToUsd(existing.amountMicros),
        ...statusView(ledger)
      }
    };
  }

  const historical=priorHistoryEntry(ledger,id);
  if(historical) throw new Error('reservation_id_already_finalized');

  const projected=ledger.spentMicros+ledger.reservedMicros+amountMicros;
  if(projected>ledger.limitMicros){
    return {
      ledger,
      receipt:{
        ok:false,
        status:'rejected',
        reason:'ai_budget_exhausted',
        duplicate:false,
        reservationId:id,
        estimatedUsd:microsToUsd(amountMicros),
        ...statusView(ledger)
      }
    };
  }

  const reservation={
    reservationId:id,
    amountMicros,
    purpose:normalizedPurpose,
    createdAt:normalizeIso(createdAt)
  };
  const next={
    ...ledger,
    reservations:{...ledger.reservations,[id]:reservation},
    reservedMicros:ledger.reservedMicros+amountMicros
  };
  return {
    ledger:next,
    receipt:{
      ok:true,
      status:'reserved',
      duplicate:false,
      reservationId:id,
      estimatedUsd:microsToUsd(amountMicros),
      purpose:normalizedPurpose,
      ...statusView(next)
    }
  };
}

export function reconcileBudget(ledger,{
  reservationId,
  actualUsd,
  responseId=null,
  completedAt
}){
  const id=normalizeReservationId(reservationId);
  const actualMicros=usdToMicros(actualUsd);
  const reservation=ledger.reservations[id];
  if(!reservation){
    const historical=priorHistoryEntry(ledger,id);
    if(historical?.action==='reconciled'){
      if(historical.actualMicros!==actualMicros) throw new Error('reconcile_amount_conflict');
      return {
        ledger,
        receipt:{
          ok:true,
          status:'reconciled',
          duplicate:true,
          reservationId:id,
          actualUsd:microsToUsd(actualMicros),
          ...statusView(ledger)
        }
      };
    }
    throw new Error('reservation_not_found');
  }

  const nextReservations={...ledger.reservations};
  delete nextReservations[id];
  const history=trimHistory([
    ...ledger.history,
    {
      action:'reconciled',
      reservationId:id,
      purpose:reservation.purpose,
      estimatedMicros:reservation.amountMicros,
      actualMicros,
      responseId:responseId?String(responseId).slice(0,160):null,
      completedAt:normalizeIso(completedAt)
    }
  ]);
  const next={
    ...ledger,
    spentMicros:ledger.spentMicros+actualMicros,
    reservedMicros:Math.max(0,ledger.reservedMicros-reservation.amountMicros),
    reservations:nextReservations,
    history
  };
  return {
    ledger:next,
    receipt:{
      ok:true,
      status:'reconciled',
      duplicate:false,
      reservationId:id,
      estimatedUsd:microsToUsd(reservation.amountMicros),
      actualUsd:microsToUsd(actualMicros),
      ...statusView(next)
    }
  };
}

export function cancelBudgetReservation(ledger,{
  reservationId,
  reason='cancelled',
  cancelledAt
}){
  const id=normalizeReservationId(reservationId);
  const reservation=ledger.reservations[id];
  if(!reservation){
    const historical=priorHistoryEntry(ledger,id);
    if(historical?.action==='cancelled'){
      return {
        ledger,
        receipt:{
          ok:true,
          status:'cancelled',
          duplicate:true,
          reservationId:id,
          ...statusView(ledger)
        }
      };
    }
    throw new Error('reservation_not_found');
  }

  const nextReservations={...ledger.reservations};
  delete nextReservations[id];
  const history=trimHistory([
    ...ledger.history,
    {
      action:'cancelled',
      reservationId:id,
      purpose:reservation.purpose,
      estimatedMicros:reservation.amountMicros,
      reason:String(reason??'cancelled').slice(0,200),
      cancelledAt:normalizeIso(cancelledAt)
    }
  ]);
  const next={
    ...ledger,
    reservedMicros:Math.max(0,ledger.reservedMicros-reservation.amountMicros),
    reservations:nextReservations,
    history
  };
  return {
    ledger:next,
    receipt:{
      ok:true,
      status:'cancelled',
      duplicate:false,
      reservationId:id,
      releasedUsd:microsToUsd(reservation.amountMicros),
      ...statusView(next)
    }
  };
}
