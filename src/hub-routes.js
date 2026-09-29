import { normalizeLunaEvent, LUNA_EVENT_SCHEMA_VERSION } from './luna-event.js';
import { HUB_STATE_SCHEMA_VERSION } from './hub-state.js';

const HUB_OBJECT_NAME='hub-v1';

const hubStore=(env)=>env.QUEST_STATE.getByName(HUB_OBJECT_NAME);

const hubJson=(data,init={})=>{
  const headers=new Headers(init.headers||{});
  headers.set('Access-Control-Allow-Origin','*');
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
  const expected=env.LUNA_HUB_TOKEN;
  if(!expected) return false;
  const header=request.headers.get('Authorization')||'';
  if(!header.startsWith('Bearer ')) return false;
  return secureEqual(header.slice(7).trim(),expected);
}

function authFailure(env){
  return env.LUNA_HUB_TOKEN
    ? hubJson({ok:false,error:'unauthorized'},{status:401})
    : hubJson({ok:false,error:'luna_hub_token_not_configured'},{status:503});
}

export async function handleHubRequest(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/hub')) return null;

  if(request.method==='OPTIONS'){
    return new Response(null,{
      status:204,
      headers:{
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type, Authorization',
        'Access-Control-Max-Age':'86400'
      }
    });
  }

  if(url.pathname==='/hub'&&request.method==='GET'){
    return hubJson({
      ok:true,
      service:'LUNA CORE',
      module:'LUNA HUB',
      phase:'hub-state-v2',
      eventSchema:LUNA_EVENT_SCHEMA_VERSION,
      stateSchema:HUB_STATE_SCHEMA_VERSION,
      protectedApiConfigured:Boolean(env.LUNA_HUB_TOKEN),
      time:new Date().toISOString()
    });
  }

  if(!authorized(request,env)) return authFailure(env);

  if(url.pathname==='/hub/current'&&request.method==='GET'){
    const state=await hubStore(env).hubCurrent();
    return hubJson({ok:true,service:'LUNA CORE',module:'LUNA HUB',state,time:new Date().toISOString()});
  }

  if(url.pathname==='/hub/status'&&request.method==='GET'){
    const status=await hubStore(env).hubStatus();
    return hubJson({ok:true,service:'LUNA CORE',module:'LUNA HUB',status,time:new Date().toISOString()});
  }

  if(url.pathname==='/hub/events'&&request.method==='GET'){
    const requested=Number(url.searchParams.get('limit')||20);
    const limit=Math.max(1,Math.min(100,Number.isFinite(requested)?Math.floor(requested):20));
    const events=await hubStore(env).recentHubEvents(limit);
    return hubJson({ok:true,service:'LUNA CORE',module:'LUNA HUB',events,time:new Date().toISOString()});
  }

  if(url.pathname==='/hub/event'&&request.method==='POST'){
    try{
      const event=normalizeLunaEvent(await request.json());
      const receipt=await hubStore(env).applyHubEvent(event);
      return hubJson({
        ok:true,
        service:'LUNA CORE',
        module:'LUNA HUB',
        receipt,
        time:new Date().toISOString()
      },{status:receipt.duplicate?200:201});
    }catch(error){
      return hubJson({ok:false,error:error instanceof Error?error.message:'invalid_hub_event'},{status:400});
    }
  }

  return hubJson({ok:false,error:'not_found'},{status:404});
}
