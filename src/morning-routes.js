import { morningStatus, runMorning } from './morning-runner.js';
import { sha256Text } from './quest-model.js';

const MORNING_INGEST_TOKEN_SHA256='42bcc09d922c20145a59489309336eeddf33dce6efbee4cd1727b63ab44e39aa';
const MORNING_WIDGET_TOKEN_SHA256='fa1690871af95e0a99c2e7039bd84c9ca9147e2e0bd4993c33458b9357da2aeb';

const morningJson=(data,init={})=>{
  const headers=new Headers(init.headers||{});
  headers.set('Cache-Control','no-store');
  return Response.json(data,{...init,headers});
};

function secureEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

function authorized(request,env){
  const expected=env.MORNING_ADMIN_TOKEN;
  if(!expected) return false;
  const header=request.headers.get('Authorization')||'';
  if(!header.startsWith('Bearer ')) return false;
  return secureEqual(header.slice(7).trim(),expected);
}

async function verifyHashedToken(request,headerName,expectedSha256,bearer=false){
  let token=request.headers.get(headerName)||'';
  if(bearer){
    if(!token.startsWith('Bearer ')) return false;
    token=token.slice(7).trim();
  }
  return Boolean(token)&&(await sha256Text(token))===expectedSha256;
}

function normalizeWidgetPayload(body){
  let payload=body?.payload;
  if(typeof payload==='string'){
    try{ payload=JSON.parse(payload); }catch{ throw new Error('payload_not_valid_json'); }
  }
  if(!payload||typeof payload!=='object'||Array.isArray(payload)) throw new Error('payload_required');
  if(typeof payload.date!=='string'||!payload.date) throw new Error('payload_date_required');
  if(typeof payload.generated_at!=='string'||!payload.generated_at) throw new Error('payload_generated_at_required');
  return payload;
}

export async function handleMorningRequest(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/morning')) return null;

  if(url.pathname==='/morning'&&request.method==='GET'){
    const status=await morningStatus(env);
    return morningJson({
      ok:true,
      service:'LUNA CORE',
      module:'LUNA MORNING',
      phase:'foundation',
      ...status,
      time:new Date().toISOString()
    });
  }

  if(url.pathname==='/morning/status'&&request.method==='GET'){
    const status=await morningStatus(env);
    return morningJson({ok:true,service:'LUNA CORE',module:'LUNA MORNING',...status,time:new Date().toISOString()});
  }

  if(url.pathname==='/morning/ingest'&&request.method==='POST'){
    if(!(await verifyHashedToken(request,'X-Luna-Morning-Token',MORNING_INGEST_TOKEN_SHA256))){
      return morningJson({ok:false,error:'unauthorized'},{status:401});
    }
    try{
      const body=await request.json();
      const payload=normalizeWidgetPayload(body);
      const stored=await env.QUEST_STATE.getByName('morning-v1').ingestMorningWidget(payload,{
        source:typeof body?.source==='string'?body.source:'external',
        sourceStatus:typeof body?.status==='string'?body.status:null,
        sourceUpdatedAt:typeof body?.updatedAt==='string'?body.updatedAt:null
      });
      return morningJson({ok:true,service:'LUNA CORE',module:'LUNA MORNING',stored,time:new Date().toISOString()},{status:201});
    }catch(error){
      return morningJson({ok:false,error:error instanceof Error?error.message:'invalid_payload'},{status:400});
    }
  }

  if(url.pathname==='/morning/widget'&&request.method==='GET'){
    if(!(await verifyHashedToken(request,'Authorization',MORNING_WIDGET_TOKEN_SHA256,true))){
      return morningJson({ok:false,error:'unauthorized'},{status:401});
    }
    const widget=await env.QUEST_STATE.getByName('morning-v1').morningWidget();
    return widget
      ? morningJson({ok:true,service:'LUNA CORE',module:'LUNA MORNING',...widget,time:new Date().toISOString()})
      : morningJson({ok:false,error:'widget_payload_not_ready'},{status:404});
  }

  if(url.pathname==='/morning/run'&&request.method==='POST'){
    if(!env.MORNING_ADMIN_TOKEN) return morningJson({ok:false,error:'morning_admin_token_not_configured'},{status:503});
    if(!authorized(request,env)) return morningJson({ok:false,error:'unauthorized'},{status:401});
    const body=await request.json().catch(()=>({}));
    const result=await runMorning(env,{
      trigger:'manual',
      scheduledTime:Date.now(),
      useAI:body?.useAI===true,
      facts:body?.facts??null
    });
    return morningJson({ok:!['failed'].includes(result.status),service:'LUNA CORE',module:'LUNA MORNING',result,time:new Date().toISOString()},{status:result.status==='failed'?400:200});
  }

  if(url.pathname==='/morning/latest'&&request.method==='GET'){
    if(!env.MORNING_ADMIN_TOKEN) return morningJson({ok:false,error:'morning_admin_token_not_configured'},{status:503});
    if(!authorized(request,env)) return morningJson({ok:false,error:'unauthorized'},{status:401});
    const latest=await env.QUEST_STATE.getByName('morning-v1').latestMorningRun();
    return morningJson({ok:Boolean(latest),service:'LUNA CORE',module:'LUNA MORNING',latest,time:new Date().toISOString()},{status:latest?200:404});
  }

  return morningJson({ok:false,error:'not_found'},{status:404});
}
