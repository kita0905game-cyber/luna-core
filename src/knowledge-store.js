const nowIso=()=>new Date().toISOString();

export const KNOWLEDGE_SCHEMA_VERSION='luna-knowledge/v1';

export function knowledgeConfigured(env){
  return Boolean(env?.KNOWLEDGE_DB);
}

export async function sha256Text(value){
  const bytes=new TextEncoder().encode(String(value??''));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

function clampLimit(value,fallback=20,max=100){
  const n=Number(value);
  return Math.max(1,Math.min(max,Number.isFinite(n)?Math.floor(n):fallback));
}

function normalizeKind(value){
  const allowed=new Set(['constitution','second_brain','system_spec','bootstrap']);
  return allowed.has(value)?value:null;
}

function normalizeStatus(value){
  const allowed=new Set(['draft','active','archived']);
  return allowed.has(value)?value:null;
}

export async function knowledgeStatus(env){
  if(!knowledgeConfigured(env)) return {configured:false,schema:KNOWLEDGE_SCHEMA_VERSION};
  const meta=await env.KNOWLEDGE_DB.prepare(
    "SELECT value,updated_at FROM knowledge_meta WHERE key='schema_version'"
  ).first();
  const counts=await env.KNOWLEDGE_DB.prepare(
    "SELECT kind,status,COUNT(*) AS count FROM knowledge_documents GROUP BY kind,status ORDER BY kind,status"
  ).all();
  return {
    configured:true,
    schema:meta?.value||KNOWLEDGE_SCHEMA_VERSION,
    schemaUpdatedAt:meta?.updated_at||null,
    documents:counts?.results||[]
  };
}

export async function getDocument(env,id){
  if(!knowledgeConfigured(env)) return null;
  return env.KNOWLEDGE_DB.prepare(
    'SELECT * FROM knowledge_documents WHERE id=?'
  ).bind(id).first();
}

export async function getActiveConstitution(env){
  if(!knowledgeConfigured(env)) return null;
  return env.KNOWLEDGE_DB.prepare(
    "SELECT * FROM knowledge_documents WHERE kind='constitution' AND status='active' ORDER BY updated_at DESC LIMIT 1"
  ).first();
}

export async function getPreferredConstitution(env,{allowDraft=false}={}){
  const active=await getActiveConstitution(env);
  if(active||!allowDraft||!knowledgeConfigured(env)) return active;
  return env.KNOWLEDGE_DB.prepare(
    "SELECT * FROM knowledge_documents WHERE kind='constitution' AND status='draft' ORDER BY updated_at DESC LIMIT 1"
  ).first();
}

export async function listDocuments(env,{kind=null,status=null,limit=20}={}){
  if(!knowledgeConfigured(env)) return [];
  const where=[],bind=[];
  if(kind){const k=normalizeKind(kind);if(!k) throw new Error('invalid_kind');where.push('kind=?');bind.push(k);}
  if(status){const s=normalizeStatus(status);if(!s) throw new Error('invalid_status');where.push('status=?');bind.push(s);}
  const sql='SELECT id,kind,title,status,version,source,source_ref,content_sha256,created_at,updated_at FROM knowledge_documents'
    +(where.length?' WHERE '+where.join(' AND '):'')
    +' ORDER BY updated_at DESC LIMIT ?';
  bind.push(clampLimit(limit));
  const result=await env.KNOWLEDGE_DB.prepare(sql).bind(...bind).all();
  return result?.results||[];
}

export async function searchDocuments(env,query,{kind=null,limit=20}={}){
  if(!knowledgeConfigured(env)) return [];
  const q=String(query??'').trim();
  if(!q) return [];
  const where=['(title LIKE ? OR body_md LIKE ?)'],bind=[`%${q}%`,`%${q}%`];
  if(kind){const k=normalizeKind(kind);if(!k) throw new Error('invalid_kind');where.push('kind=?');bind.push(k);}
  bind.push(clampLimit(limit));
  const result=await env.KNOWLEDGE_DB.prepare(
    'SELECT id,kind,title,status,version,source,source_ref,content_sha256,updated_at FROM knowledge_documents WHERE '
    +where.join(' AND ')+' ORDER BY updated_at DESC LIMIT ?'
  ).bind(...bind).all();
  return result?.results||[];
}

function validateDocumentInput(input){
  const id=String(input?.id??'').trim();
  const title=String(input?.title??'').trim();
  const bodyMd=String(input?.bodyMd??input?.body_md??'');
  const kind=normalizeKind(input?.kind);
  const status=normalizeStatus(input?.status??'active');
  if(!id||id.length>160) throw new Error('invalid_id');
  if(!title||title.length>240) throw new Error('invalid_title');
  if(!kind) throw new Error('invalid_kind');
  if(!status) throw new Error('invalid_status');
  if(!bodyMd) throw new Error('body_required');
  return {
    id,title,bodyMd,kind,status,
    source:input?.source?String(input.source).slice(0,120):null,
    sourceRef:input?.sourceRef?String(input.sourceRef).slice(0,500):null,
    expectedVersion:Number.isInteger(input?.expectedVersion)?input.expectedVersion:null,
    summary:input?.summary?String(input.summary).slice(0,500):null
  };
}

export async function upsertDocument(env,input,{actor='luna-core',action=null}={}){
  if(!knowledgeConfigured(env)) throw new Error('knowledge_db_not_configured');
  const doc=validateDocumentInput(input);
  const current=await getDocument(env,doc.id);
  if(current&&doc.expectedVersion!==null&&doc.expectedVersion!==current.version) throw new Error('version_conflict');
  if(!current&&doc.expectedVersion!==null&&doc.expectedVersion!==0) throw new Error('version_conflict');

  const timestamp=nowIso();
  const hash=await sha256Text(doc.bodyMd);
  const unchanged=Boolean(current)
    &&current.content_sha256===hash
    &&current.kind===doc.kind
    &&current.title===doc.title
    &&current.status===doc.status
    &&String(current.source??'')===String(doc.source??'')
    &&String(current.source_ref??'')===String(doc.sourceRef??'');
  if(unchanged) return {...current,unchanged:true};

  const nextVersion=current?Number(current.version)+1:1;
  const changeAction=action||(current?'update':'create');

  const docStmt=env.KNOWLEDGE_DB.prepare(
    `INSERT INTO knowledge_documents
      (id,kind,title,body_md,status,version,source,source_ref,content_sha256,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,title=excluded.title,body_md=excluded.body_md,status=excluded.status,
      version=excluded.version,source=excluded.source,source_ref=excluded.source_ref,
      content_sha256=excluded.content_sha256,updated_at=excluded.updated_at`
  ).bind(
    doc.id,doc.kind,doc.title,doc.bodyMd,doc.status,nextVersion,doc.source,doc.sourceRef,hash,
    current?.created_at||timestamp,timestamp
  );

  const changeStmt=env.KNOWLEDGE_DB.prepare(
    `INSERT INTO knowledge_changes
      (document_id,action,from_version,to_version,actor,summary,content_sha256,changed_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(doc.id,changeAction,current?.version??null,nextVersion,actor,doc.summary,hash,timestamp);

  await env.KNOWLEDGE_DB.batch([docStmt,changeStmt]);
  return getDocument(env,doc.id);
}

export async function importDocuments(env,documents,{actor='migration'}={}){
  if(!Array.isArray(documents)||documents.length===0) throw new Error('documents_required');
  if(documents.length>50) throw new Error('too_many_documents');
  const results=[];
  for(const document of documents) results.push(await upsertDocument(env,document,{actor,action:'import'}));
  return results;
}

export async function createMemoryCandidate(env,input){
  if(!knowledgeConfigured(env)) throw new Error('knowledge_db_not_configured');
  const summary=String(input?.summary??'').trim();
  const domain=String(input?.domain??'general').trim();
  const sourceType=String(input?.sourceType??'other');
  const allowed=new Set(['user_statement','luna_analysis','journal','health','study','other']);
  if(!summary) throw new Error('summary_required');
  if(!allowed.has(sourceType)) throw new Error('invalid_source_type');
  const timestamp=nowIso();
  const id=String(input?.id??crypto.randomUUID());
  const evidence=JSON.stringify(Array.isArray(input?.evidence)?input.evidence:[]);
  const confidence=input?.confidence==null?null:Number(input.confidence);
  const status=input?.status??'observing';
  if(!['observing','ask_user'].includes(status)) throw new Error('invalid_candidate_status');

  await env.KNOWLEDGE_DB.prepare(
    `INSERT INTO memory_candidates
      (id,domain,summary,evidence_json,source_type,confidence,status,review_reason,
       first_observed_at,last_observed_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
      domain=excluded.domain,summary=excluded.summary,evidence_json=excluded.evidence_json,
      source_type=excluded.source_type,confidence=excluded.confidence,status=excluded.status,
      review_reason=excluded.review_reason,last_observed_at=excluded.last_observed_at,
      updated_at=excluded.updated_at`
  ).bind(
    id,domain,summary,evidence,sourceType,Number.isFinite(confidence)?confidence:null,status,
    input?.reviewReason?String(input.reviewReason).slice(0,500):null,
    input?.firstObservedAt||timestamp,input?.lastObservedAt||timestamp,timestamp,timestamp
  ).run();

  return env.KNOWLEDGE_DB.prepare('SELECT * FROM memory_candidates WHERE id=?').bind(id).first();
}

export async function listMemoryCandidates(env,{status='observing',limit=20}={}){
  if(!knowledgeConfigured(env)) return [];
  const allowed=new Set(['observing','ask_user','promoted','discarded']);
  if(!allowed.has(status)) throw new Error('invalid_candidate_status');
  const result=await env.KNOWLEDGE_DB.prepare(
    'SELECT * FROM memory_candidates WHERE status=? ORDER BY updated_at DESC LIMIT ?'
  ).bind(status,clampLimit(limit)).all();
  return result?.results||[];
}

export async function reviewMemoryCandidate(env,id,{status,reason=null}={}){
  if(!knowledgeConfigured(env)) throw new Error('knowledge_db_not_configured');
  if(!['observing','ask_user','promoted','discarded'].includes(status)) throw new Error('invalid_candidate_status');
  await env.KNOWLEDGE_DB.prepare(
    'UPDATE memory_candidates SET status=?,review_reason=?,updated_at=? WHERE id=?'
  ).bind(status,reason?String(reason).slice(0,500):null,nowIso(),id).run();
  return env.KNOWLEDGE_DB.prepare('SELECT * FROM memory_candidates WHERE id=?').bind(id).first();
}
