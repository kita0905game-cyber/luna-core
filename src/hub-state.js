import { LUNA_EVENT_DOMAINS } from './luna-event.js';

export const HUB_STATE_SCHEMA_VERSION='luna-hub-state/v2';
export const LEGACY_HUB_STATE_SCHEMA_VERSION='luna-hub-state/v1';
export const HUB_TIME_ZONE='Asia/Tokyo';

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

function emptyFreshness(){
  return {
    status:'unknown',
    updatedAt:null,
    expiresAt:null
  };
}

function emptyDomain(){
  return {
    status:'unknown',
    updatedAt:null,
    source:null,
    lastEventId:null,
    lastEventType:null,
    freshness:emptyFreshness()
  };
}

function normalizeDomain(value){
  const base=emptyDomain();
  const next=mergeObjects(base,isPlainObject(value)?value:{});
  if(!isPlainObject(next.freshness)) next.freshness=emptyFreshness();
  next.freshness=mergeObjects(emptyFreshness(),next.freshness);
  return next;
}

export function createEmptyHubState(){
  return {
    schemaVersion:HUB_STATE_SCHEMA_VERSION,
    meta:{
      revision:0,
      storedUpdatedAt:null,
      timeZone:HUB_TIME_ZONE
    },
    mode:{
      current:'unknown',
      since:null,
      source:null
    },
    lastEvent:null,
    domains:Object.fromEntries(LUNA_EVENT_DOMAINS.map((name)=>[name,emptyDomain()]))
  };
}

function migrateLegacyState(value){
  const next=createEmptyHubState();
  next.meta.revision=Number(value?.revision||0);
  next.meta.storedUpdatedAt=value?.updatedAt??null;
  next.mode={
    current:typeof value?.mode==='string'&&value.mode.trim()?value.mode.trim().toLowerCase():'unknown',
    since:value?.lastEvent?.processedAt??value?.updatedAt??null,
    source:'legacy-v1'
  };
  next.lastEvent=isPlainObject(value?.lastEvent)?clone(value.lastEvent):null;

  for(const domain of LUNA_EVENT_DOMAINS){
    const legacy=normalizeDomain(value?.domains?.[domain]);
    if(legacy.updatedAt&&!legacy.freshness.updatedAt){
      legacy.freshness.updatedAt=legacy.updatedAt;
      if(legacy.freshness.status==='unknown') legacy.freshness.status='fresh';
    }
    next.domains[domain]=legacy;
  }
  return next;
}

export function normalizeHubState(value){
  if(!isPlainObject(value)) return createEmptyHubState();
  if(value.schemaVersion===LEGACY_HUB_STATE_SCHEMA_VERSION) return migrateLegacyState(value);
  if(value.schemaVersion!==HUB_STATE_SCHEMA_VERSION) return createEmptyHubState();

  const base=createEmptyHubState();
  const normalized={
    ...base,
    ...clone(value),
    schemaVersion:HUB_STATE_SCHEMA_VERSION,
    meta:mergeObjects(base.meta,value.meta??{}),
    mode:mergeObjects(base.mode,value.mode??{}),
    domains:{...base.domains}
  };

  normalized.meta.revision=Number(normalized.meta.revision||0);
  normalized.meta.timeZone=HUB_TIME_ZONE;
  normalized.mode.current=typeof normalized.mode.current==='string'&&normalized.mode.current.trim()
    ?normalized.mode.current.trim().toLowerCase()
    :'unknown';

  for(const domain of LUNA_EVENT_DOMAINS){
    normalized.domains[domain]=normalizeDomain(value.domains?.[domain]);
  }
  return normalized;
}

function nextMode(currentMode,statePatch,event,processedAt){
  const modePatch=statePatch?.mode;
  if(typeof modePatch==='string'&&modePatch.trim()){
    return {
      current:modePatch.trim().toLowerCase(),
      since:event.occurredAt,
      source:event.source
    };
  }
  if(isPlainObject(modePatch)){
    const merged=mergeObjects(currentMode,modePatch);
    if(typeof merged.current==='string'&&merged.current.trim()){
      merged.current=merged.current.trim().toLowerCase();
      merged.since=merged.since??event.occurredAt;
      merged.source=merged.source??event.source;
      return merged;
    }
  }
  return currentMode;
}

export function projectHubEvent(current,event,{processedAt=new Date().toISOString()}={}){
  const state=normalizeHubState(current);
  const statePatch=isPlainObject(event?.payload?.statePatch)?event.payload.statePatch:{};
  const previousDomain=state.domains[event.domain]??emptyDomain();
  const nextDomain=mergeObjects(previousDomain,statePatch);

  nextDomain.status=typeof statePatch.status==='string'&&statePatch.status.trim()
    ?statePatch.status.trim().toLowerCase()
    :'ready';
  nextDomain.updatedAt=event.occurredAt;
  nextDomain.source=event.source;
  nextDomain.lastEventId=event.eventId;
  nextDomain.lastEventType=event.type;
  nextDomain.freshness=mergeObjects(previousDomain.freshness??emptyFreshness(),statePatch.freshness??{});
  nextDomain.freshness.updatedAt=event.occurredAt;
  if(!statePatch.freshness?.status) nextDomain.freshness.status='fresh';

  const revision=Number(state.meta?.revision||0)+1;
  const next={
    ...state,
    schemaVersion:HUB_STATE_SCHEMA_VERSION,
    meta:{
      ...state.meta,
      revision,
      storedUpdatedAt:processedAt,
      timeZone:HUB_TIME_ZONE
    },
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

  if(event.domain==='system'){
    next.mode=nextMode(state.mode,statePatch,event,processedAt);
  }

  return next;
}
