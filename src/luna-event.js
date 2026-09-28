export const LUNA_EVENT_SCHEMA_VERSION='luna-event/v1';

export const LUNA_EVENT_DOMAINS=Object.freeze([
  'system',
  'calendar',
  'commute',
  'weather',
  'health',
  'care',
  'workout',
  'study',
  'diary',
  'couple',
  'lifequest',
  'mail',
  'presence',
  'news'
]);

const DOMAIN_SET=new Set(LUNA_EVENT_DOMAINS);

function isPlainObject(value){
  return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
}

function requiredString(value,name,maxLength=160){
  if(typeof value!=='string'||!value.trim()) throw new Error(`${name}_required`);
  const result=value.trim();
  if(result.length>maxLength) throw new Error(`${name}_too_long`);
  return result;
}

function validIsoDate(value){
  return typeof value==='string'&&value.length>0&&Number.isFinite(Date.parse(value));
}

export function eventDomainFromType(type){
  if(typeof type!=='string') return null;
  const domain=type.split('.')[0].trim().toLowerCase();
  return DOMAIN_SET.has(domain)?domain:null;
}

export function normalizeLunaEvent(input){
  if(!isPlainObject(input)) throw new Error('event_object_required');

  const eventId=requiredString(input.eventId,'event_id',128);
  const type=requiredString(input.type,'event_type',96).toLowerCase();
  if(!/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/.test(type)) throw new Error('event_type_invalid');

  const inferredDomain=eventDomainFromType(type);
  const domain=(typeof input.domain==='string'&&input.domain.trim()?input.domain.trim().toLowerCase():inferredDomain);
  if(!domain||!DOMAIN_SET.has(domain)) throw new Error('event_domain_invalid');

  const source=requiredString(input.source,'event_source',96);
  const occurredAt=input.occurredAt??input.occurred_at;
  if(!validIsoDate(occurredAt)) throw new Error('event_occurred_at_invalid');

  const payload=input.payload===undefined?{}:input.payload;
  if(!isPlainObject(payload)) throw new Error('event_payload_invalid');
  if(payload.statePatch!==undefined&&!isPlainObject(payload.statePatch)) throw new Error('event_state_patch_invalid');

  const metadata=input.metadata===undefined?{}:input.metadata;
  if(!isPlainObject(metadata)) throw new Error('event_metadata_invalid');

  return {
    schemaVersion:LUNA_EVENT_SCHEMA_VERSION,
    eventId,
    type,
    domain,
    source,
    occurredAt:new Date(occurredAt).toISOString(),
    payload,
    metadata
  };
}
