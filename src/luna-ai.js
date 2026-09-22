import { MORNING_OUTPUT_SCHEMA } from './morning-model.js';

const LUNA_MORNING_INSTRUCTIONS=[
  'You are the decision layer for LUNA MORNING.',
  'Use only the supplied facts. Never invent missing facts.',
  'Return concise Japanese suitable for a morning dashboard.',
  'Separate factual inputs from judgment. If an input is unavailable, preserve that uncertainty.',
  'Do not perform external actions. Your only task is to produce the requested structured morning payload.'
].join(' ');

function outputTextFromResponse(response){
  if(typeof response?.output_text==='string'&&response.output_text) return response.output_text;
  for(const item of response?.output??[]){
    if(item?.type!=='message') continue;
    for(const content of item?.content??[]){
      if(content?.type==='output_text'&&typeof content.text==='string') return content.text;
    }
  }
  return '';
}

export async function askLunaForMorning(env,facts){
  if(!env.OPENAI_API_KEY) return {ok:false,status:'not_configured',error:'OPENAI_API_KEY is not configured'};
  const model=env.OPENAI_MODEL||'gpt-5.6-luna';
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{
      'Authorization':`Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model,
      store:false,
      reasoning:{effort:'low'},
      instructions:LUNA_MORNING_INSTRUCTIONS,
      input:JSON.stringify(facts),
      text:{
        format:{
          type:'json_schema',
          name:'luna_morning_payload',
          strict:true,
          schema:MORNING_OUTPUT_SCHEMA
        }
      }
    })
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok){
    return {
      ok:false,
      status:'api_error',
      error:body?.error?.message||`OpenAI API returned ${response.status}`
    };
  }
  const text=outputTextFromResponse(body);
  if(!text) return {ok:false,status:'empty_response',error:'OpenAI response contained no output text'};
  try{
    return {ok:true,status:'completed',model,payload:JSON.parse(text),responseId:body?.id??null};
  }catch{
    return {ok:false,status:'invalid_json',error:'OpenAI response was not valid JSON'};
  }
}
