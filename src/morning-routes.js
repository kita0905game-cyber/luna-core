import { morningStatus, runMorning } from './morning-runner.js';

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
