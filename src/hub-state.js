import { LUNA_EVENT_DOMAINS } from './luna-event.js';

export const HUB_STATE_SCHEMA_VERSION='luna-hub-state/v1';

function isPlainObject(value){
  return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
}

function clone(value){
  return value===undefined?undefined:structuredClone(value);
}

function mergeObjects(base,patch){
  const result=isPlainObject(base)?clone(base):{};
  for(const [key,value] of Object.entries(patch??{})){
    if(isPlainObject(value)&&isPlainObject(result[key])) result[key]=mergeObjects(result[key],value);
    else result[key]=clone(value);
  }
  return result;
}

function emptyDomain(){
  return {
    status:'unknown',
    updatedAt:null,
    lastEventId:null,
    lastEventType:null
  };
}

export function createEmptyHubState(){
  return {
    schemaVersion:HUB_STATE_SCHEMA_VERSION,
    revision:0,
    mode:'unknown',
    updatedAt:null,
    lastEvent:null,
    domains:Object.fromEntries(LUNA_EVENT_DOMAINS.map((name)=>[name,emptyDomain()]))
  };
}

export function normalizeHubState(value){
  if(!isPlainObject(value)||value.schemaVersion!==HUB_STATE_SCHEMA_VERSION) return createEmptyHubState();
  const base=createEmptyHubState();
  const normalized={
    ...base,
    ...clone(value),
    domains:{...base.domains}
  };
  for(const domain of LUNA_EVENT_DOMAINS){
    normalized.domains[domain]=mergeObjects(base.domains[domain],value.domains?.[domain]??{});
  }
  return normalized;
}

export function projectHubEvent(current,event,{processedAt=new Date().toISOString()}={}){
  const state=normalizeHubState(current);
  const statePatch=isPlainObject(event?.payload?.statePatch)?event.payload.statePatch:{};
  const previousDomain=state.domains[event.domain]??emptyDomain();
  const nextDomain=mergeObjects(previousDomain,statePatch);

  nextDomain.updatedAt=event.occurredAt;
  nextDomain.lastEventId=event.eventId;
  nextDomain.lastEventType=event.type;

  const next={
    ...state,
    schemaVersion:HUB_STATE_SCHEMA_VERSION,
    revision:Number(state.revision||0)+1,
    updatedAt:processedAt,
    lastEvent:{
      eventId:event.eventId,
      type:event.type,
      domain:event.domain,
      source:event.source,
      occurredAt:event.occurredAt,
      processedAt
    },
    domains:{
      ...state.domains,
      [event.domain]:nextDomain
    }
  };

  if(event.domain==='system'&&typeof statePatch.mode==='string'&&statePatch.mode.trim()){
    next.mode=statePatch.mode.trim().toLowerCase();
  }

  return next;
}
