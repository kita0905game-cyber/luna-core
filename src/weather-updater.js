import { morningDateJst } from './morning-model.js';

const AIRTABLE_BASE_ID='appT6Hykt7068qoEQ';
const AIRTABLE_TABLE_ID='tblqjklqB0zyJH4Tu';
const AIRTABLE_RECORD_ID='recDpl0EjC5JfHwnN';

const DEFAULT_LAT=34.6937;
const DEFAULT_LON=135.5023;
const DEFAULT_TIMEZONE='Asia/Tokyo';

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

async function fetchWeather(env){
  const latitude=numberOr(env.WEATHER_LAT,DEFAULT_LAT);
  const longitude=numberOr(env.WEATHER_LON,DEFAULT_LON);
  const timezone=env.WEATHER_TIMEZONE||DEFAULT_TIMEZONE;

  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',String(latitude));
  url.searchParams.set('longitude',String(longitude));
  url.searchParams.set('timezone',timezone);
  url.searchParams.set('forecast_days','1');
  url.searchParams.set('current','temperature_2m,apparent_temperature,weather_code,precipitation');
  url.searchParams.set('hourly','precipitation_probability');
  url.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min');

  const response=await fetch(url.toString(),{
    headers:{'User-Agent':'LUNA-CORE/1.0'}
  });
  if(!response.ok) throw new Error(`weather_fetch_failed_${response.status}`);

  const body=await response.json();
  const times=body?.hourly?.time??[];
  const probs=body?.hourly?.precipitation_probability??[];

  return {
    icon:weatherIcon(body?.current?.weather_code??body?.daily?.weather_code?.[0]),
    low:roundWeather(body?.daily?.temperature_2m_min?.[0]),
    high:roundWeather(body?.daily?.temperature_2m_max?.[0]),
    rain_am:maxProbability(times,probs,0,12),
    rain_pm:maxProbability(times,probs,12,24)
  };
}

export async function runWeatherRefresh(env,{scheduledTime=Date.now()}={}){
  const startedAt=new Date().toISOString();
  const today=morningDateJst(scheduledTime);

  try{
    const record=await fetchAirtableRecord(env);
    const raw=record?.fields?.Payload;
    if(typeof raw!=='string'||!raw){
      return {status:'skipped_payload_missing',startedAt,finishedAt:new Date().toISOString()};
    }

    let payload;
    try{
      payload=JSON.parse(raw);
    }catch{
      return {status:'skipped_payload_invalid_json',startedAt,finishedAt:new Date().toISOString()};
    }

    if(payload?.date!==today){
      return {
        status:'skipped_stale_morning',
        expectedDate:today,
        payloadDate:payload?.date??null,
        startedAt,
        finishedAt:new Date().toISOString()
      };
    }

    const weather=await fetchWeather(env);
    payload.weather=weather;
    await patchAirtablePayload(env,payload);

    return {
      status:'updated',
      date:today,
      weather,
      startedAt,
      finishedAt:new Date().toISOString()
    };
  }catch(error){
    return {
      status:'failed',
      error:error instanceof Error?error.message:'unknown_weather_error',
      startedAt,
      finishedAt:new Date().toISOString()
    };
  }
}
