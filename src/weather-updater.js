import { morningDateJst } from './morning-model.js';
import { normalizeLunaEvent } from './luna-event.js';

const AIRTABLE_BASE_ID='appIJfqeiE1njGZBP';
const AIRTABLE_TABLE_ID='tblqjklqB0zyJH4Tu';
const AIRTABLE_RECORD_ID='recDpl0EjC5JfHwnN';
const HUB_OBJECT_NAME='hub-v1';

const DEFAULT_LAT=34.621;
const DEFAULT_LON=135.555;
const DEFAULT_TIMEZONE='Asia/Tokyo';
const WEATHER_TTL_MS=45*60*1000;

function numberOr(value,fallback){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
}

function roundWeather(value){
  return Number.isFinite(Number(value))?Math.round(Number(value)):null;
}

function weatherIcon(code){
  const value=Number(code);
  if(value===0) return '☀️';
  if(value===1||value===2) return '🌤️';
  if(value===3) return '☁️';
  if(value===45||value===48) return '🌫️';
  if([51,53,55,56,57].includes(value)) return '🌦️';
  if([61,63,65,66,67,80,81,82].includes(value)) return '🌧️';
  if([71,73,75,77,85,86].includes(value)) return '🌨️';
  if([95,96,99].includes(value)) return '⛈️';
  return '☀️';
}

function weatherDisplayKind(code,isDay){
  const value=Number(code);
  if(value===0) return Number(isDay)===0?'night':'sun';
  if(value===1||value===2) return 'partly';
  if(value===3) return 'cloud';
  if(value===45||value===48) return 'fog';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(value)) return 'rain';
  if([71,73,75,77,85,86].includes(value)) return 'snow';
  if([95,96,99].includes(value)) return 'thunder';
  return 'unknown';
}

function maxProbability(times,values,startHour,endHour){
  let max=null;
  for(let i=0;i<Math.min(times?.length??0,values?.length??0);i++){
    const time=String(times[i]??'');
    const hour=Number(time.slice(11,13));
    const value=Number(values[i]);
    if(!Number.isFinite(hour)||!Number.isFinite(value)) continue;
    if(hour>=startHour&&hour<endHour) max=max===null?value:Math.max(max,value);
  }
  return max===null?null:Math.round(max);
}

async function fetchAirtableRecord(env){
  if(!env.AIRTABLE_PAT) throw new Error('airtable_pat_not_configured');
  const url=`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${AIRTABLE_RECORD_ID}`;
  const response=await fetch(url,{
    headers:{Authorization:`Bearer ${env.AIRTABLE_PAT}`}
  });
  if(!response.ok){
    throw new Error(`airtable_read_failed_${response.status}`);
  }
  return response.json();
}

async function patchAirtablePayload(env,payload){
  const url=`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${AIRTABLE_RECORD_ID}`;
  const response=await fetch(url,{
    method:'PATCH',
    headers:{
      Authorization:`Bearer ${env.AIRTABLE_PAT}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      fields:{
        Payload:JSON.stringify(payload),
        UpdatedAt:new Date().toISOString()
      }
    })
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>'');
    throw new Error(`airtable_write_failed_${response.status}_${detail.slice(0,160)}`);
  }
  return response.json();
}

function weatherConfig(env){
  return {
    latitude:numberOr(env.WEATHER_LAT,DEFAULT_LAT),
    longitude:numberOr(env.WEATHER_LON,DEFAULT_LON),
    timeZone:env.WEATHER_TIMEZONE||DEFAULT_TIMEZONE,
    label:typeof env.WEATHER_LABEL==='string'&&env.WEATHER_LABEL.trim()
      ?env.WEATHER_LABEL.trim()
      :'大阪市平野区'
  };
}

export function buildWeatherHubPatch(weather,{observedAt=new Date().toISOString()}={}){
  const expiry=new Date(Date.parse(observedAt)+WEATHER_TTL_MS).toISOString();
  return {
    location:{
      label:weather.location.label,
      latitude:weather.location.latitude,
      longitude:weather.location.longitude,
      timeZone:weather.location.timeZone
    },
    current:{
      observedAt,
      temperatureC:weather.current.temperatureC,
      feelsLikeC:weather.current.feelsLikeC,
      conditionCode:weather.current.conditionCode,
      icon:weather.current.icon,
      displayKind:weather.current.displayKind??null,
      precipitationMm:weather.current.precipitationMm
    },
    today:{
      lowC:weather.today.lowC,
      highC:weather.today.highC,
      rainChanceAmPct:weather.today.rainChanceAmPct,
      rainChancePmPct:weather.today.rainChancePmPct
    },
    freshness:{
      status:'fresh',
      expiresAt:expiry
    }
  };
}

async function fetchWeather(env){
  const config=weatherConfig(env);

  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',String(config.latitude));
  url.searchParams.set('longitude',String(config.longitude));
  url.searchParams.set('timezone',config.timeZone);
  url.searchParams.set('forecast_days','1');
  url.searchParams.set('current','temperature_2m,apparent_temperature,weather_code,precipitation,is_day');
  url.searchParams.set('hourly','precipitation_probability');
  url.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min');

  const response=await fetch(url.toString(),{
    headers:{'User-Agent':'LUNA-CORE/1.0'}
  });
  if(!response.ok) throw new Error(`weather_fetch_failed_${response.status}`);

  const body=await response.json();
  const times=body?.hourly?.time??[];
  const probs=body?.hourly?.precipitation_probability??[];
  const code=roundWeather(body?.current?.weather_code??body?.daily?.weather_code?.[0]);
  const icon=weatherIcon(code);

  const legacy={
    icon,
    low:roundWeather(body?.daily?.temperature_2m_min?.[0]),
    high:roundWeather(body?.daily?.temperature_2m_max?.[0]),
    rain_am:maxProbability(times,probs,6,12),
    rain_pm:maxProbability(times,probs,16,23)
  };

  return {
    legacy,
    hub:{
      location:config,
      current:{
        temperatureC:roundWeather(body?.current?.temperature_2m),
        feelsLikeC:roundWeather(body?.current?.apparent_temperature),
        conditionCode:code,
        icon,
        displayKind:weatherDisplayKind(code,body?.current?.is_day),
        precipitationMm:Number.isFinite(Number(body?.current?.precipitation))
          ?Number(body.current.precipitation)
          :null
      },
      today:{
        lowC:legacy.low,
        highC:legacy.high,
        rainChanceAmPct:legacy.rain_am,
        rainChancePmPct:legacy.rain_pm
      }
    }
  };
}

async function publishWeatherHub(env,weather,scheduledTime){
  const occurredAt=new Date(scheduledTime).toISOString();
  const event=normalizeLunaEvent({
    eventId:'weather-refresh-'+String(scheduledTime),
    type:'weather.current_refreshed',
    source:'luna-core-weather',
    occurredAt,
    payload:{statePatch:buildWeatherHubPatch(weather,{observedAt:occurredAt})}
  });
  return env.QUEST_STATE.getByName(HUB_OBJECT_NAME).applyHubEvent(event);
}

async function updateLegacyMorning(env,today,weather){
  try{
    const record=await fetchAirtableRecord(env);
    const raw=record?.fields?.Payload;
    if(typeof raw!=='string'||!raw) return {status:'skipped_payload_missing'};

    let payload;
    try{
      payload=JSON.parse(raw);
    }catch{
      return {status:'skipped_payload_invalid_json'};
    }

    if(payload?.date!==today){
      return {
        status:'skipped_stale_morning',
        expectedDate:today,
        payloadDate:payload?.date??null
      };
    }

    payload.weather=weather;
    await patchAirtablePayload(env,payload);
    return {status:'updated'};
  }catch(error){
    return {
      status:'failed',
      error:error instanceof Error?error.message:'unknown_airtable_weather_error'
    };
  }
}

export async function runWeatherRefresh(env,{scheduledTime=Date.now()}={}){
  const startedAt=new Date().toISOString();
  const today=morningDateJst(scheduledTime);

  try{
    const weather=await fetchWeather(env);

    let hubSynced=false;
    let hubReceipt=null;
    let hubError=null;
    try{
      hubReceipt=await publishWeatherHub(env,weather.hub,scheduledTime);
      hubSynced=true;
    }catch(error){
      hubError=error instanceof Error?error.message:'unknown_hub_weather_error';
    }

    const legacy=await updateLegacyMorning(env,today,weather.legacy);
    const finishedAt=new Date().toISOString();

    return {
      status:hubSynced?(legacy.status==='updated'?'updated':'updated_hub_only'):(legacy.status==='updated'?'updated_legacy_only':'failed'),
      date:today,
      weather:weather.legacy,
      hubSynced,
      hubReceipt,
      hubError,
      legacy,
      startedAt,
      finishedAt
    };
  }catch(error){
    return {
      status:'failed',
      error:error instanceof Error?error.message:'unknown_weather_error',
      hubSynced:false,
      startedAt,
      finishedAt:new Date().toISOString()
    };
  }
}
