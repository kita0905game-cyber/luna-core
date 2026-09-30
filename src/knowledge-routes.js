import {
  knowledgeConfigured,
  knowledgeStatus,
  getActiveConstitution,
  getDocument,
  listDocuments,
  searchDocuments,
  upsertDocument,
  importDocuments,
  createMemoryCandidate,
  listMemoryCandidates,
  reviewMemoryCandidate
} from './knowledge-store.js';
import { migrateKnowledgeFromAirtable, syncKnowledgeBridge } from './knowledge-migration.js';
import { runMemoryCandidateReview } from './memory-review.js';
import { runtimeMetadata } from './runtime-meta.js';

const json=(data,init={})=>{
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
  const expected=env.LUNA_KNOWLEDGE_TOKEN;
  if(!expected) return false;
  const header=request.headers.get('Authorization')||'';
  if(!header.startsWith('Bearer ')) return false;
  return secureEqual(header.slice(7).trim(),expected);
}

function authFailure(env){
  return env.LUNA_KNOWLEDGE_TOKEN
    ? json({ok:false,error:'unauthorized'},{status:401})
    : json({ok:false,error:'luna_knowledge_token_not_configured'},{status:503});
}

function dbFailure(){
  return json({ok:false,error:'knowledge_db_not_configured'},{status:503});
}

export async function handleKnowledgeRequest(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/knowledge')) return null;

  if(request.method==='OPTIONS'){
    return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type, Authorization',
      'Access-Control-Max-Age':'86400'
    }});
  }

  if(url.pathname==='/knowledge'&&request.method==='GET'){
    return json({
      ok:true,
      service:'LUNA CORE',
      module:'LUNA KNOWLEDGE',
      phase:'d1-v1',
      databaseConfigured:knowledgeConfigured(env),
      protectedApiConfigured:Boolean(env.LUNA_KNOWLEDGE_TOKEN),
      deployment:runtimeMetadata(env),
      time:new Date().toISOString()
    });
  }

  if(!authorized(request,env)) return authFailure(env);
  if(!knowledgeConfigured(env)) return dbFailure();

  try{
    if(url.pathname==='/knowledge/status'&&request.method==='GET'){
      return json({ok:true,status:await knowledgeStatus(env),time:new Date().toISOString()});
    }

    if(url.pathname==='/knowledge/constitution'&&request.method==='GET'){
      const document=await getActiveConstitution(env);
      return document
        ? json({ok:true,document,time:new Date().toISOString()})
        : json({ok:false,error:'active_constitution_not_found'},{status:404});
    }

    if(url.pathname==='/knowledge/documents'&&request.method==='GET'){
      const documents=await listDocuments(env,{
        kind:url.searchParams.get('kind'),
        status:url.searchParams.get('status'),
        limit:url.searchParams.get('limit')
      });
      return json({ok:true,documents,time:new Date().toISOString()});
    }

    if(url.pathname==='/knowledge/search'&&request.method==='GET'){
      const q=url.searchParams.get('q')||'';
      if(!q.trim()) return json({ok:false,error:'query_required'},{status:400});
      const documents=await searchDocuments(env,q,{
        kind:url.searchParams.get('kind'),
        limit:url.searchParams.get('limit')
      });
      return json({ok:true,query:q,documents,time:new Date().toISOString()});
    }

    if(url.pathname.startsWith('/knowledge/document/')&&request.method==='GET'){
      const id=decodeURIComponent(url.pathname.slice('/knowledge/document/'.length));
      const document=await getDocument(env,id);
      return document
        ? json({ok:true,document,time:new Date().toISOString()})
        : json({ok:false,error:'document_not_found'},{status:404});
    }

    if(url.pathname==='/knowledge/document'&&request.method==='POST'){
      const document=await upsertDocument(env,await request.json(),{actor:'knowledge-api'});
      return json({ok:true,document,time:new Date().toISOString()},{status:201});
    }

    if(url.pathname==='/knowledge/import'&&request.method==='POST'){
      const body=await request.json();
      const documents=await importDocuments(env,body?.documents,{actor:body?.actor||'library-migration'});
      return json({ok:true,count:documents.length,documents,time:new Date().toISOString()},{status:201});
    }

    if(url.pathname==='/knowledge/migrate/airtable'&&request.method==='POST'){
      const migration=await migrateKnowledgeFromAirtable(env);
      return json({ok:true,migration,time:new Date().toISOString()},{status:201});
    }

    if(url.pathname==='/knowledge/sync'&&request.method==='POST'){
      const sync=await syncKnowledgeBridge(env);
      return json({ok:sync.status!=='failed',sync,time:new Date().toISOString()});
    }

    if(url.pathname==='/knowledge/ai/review-candidates'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      const review=await runMemoryCandidateReview(env,{
        limit:body?.limit,
        allowDraftConstitution:body?.allowDraftConstitution===true,
        manual:true,
        context:body?.context??null
      });
      return json({ok:true,review,time:new Date().toISOString()});
    }

    if(url.pathname==='/knowledge/candidate'&&request.method==='POST'){
      const candidate=await createMemoryCandidate(env,await request.json());
      return json({ok:true,candidate,time:new Date().toISOString()},{status:201});
    }

    if(url.pathname==='/knowledge/candidates'&&request.method==='GET'){
      const candidates=await listMemoryCandidates(env,{
        status:url.searchParams.get('status')||'observing',
        limit:url.searchParams.get('limit')
      });
      return json({ok:true,candidates,time:new Date().toISOString()});
    }

    if(url.pathname.startsWith('/knowledge/candidate/')&&request.method==='PATCH'){
      const id=decodeURIComponent(url.pathname.slice('/knowledge/candidate/'.length));
      const candidate=await reviewMemoryCandidate(env,id,await request.json());
      return candidate
        ? json({ok:true,candidate,time:new Date().toISOString()})
        : json({ok:false,error:'candidate_not_found'},{status:404});
    }

    return json({ok:false,error:'not_found'},{status:404});
  }catch(error){
    const message=error instanceof Error?error.message:'knowledge_error';
    const status=message==='version_conflict'?409:400;
    return json({ok:false,error:message},{status});
  }
}
