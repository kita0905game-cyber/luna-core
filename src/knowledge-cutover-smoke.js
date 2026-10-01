import { getDocument, getPreferredConstitution } from './knowledge-store.js';
import { askLunaForMemoryReview } from './luna-ai.js';
import { fetchKnowledgeBridge, patchBridgeRecord, syncKnowledgeBridge } from './knowledge-migration.js';

const META_KEY='cutover_smoke_v1';

async function readMeta(env){
  const row=await env.KNOWLEDGE_DB.prepare(
    'SELECT value,updated_at FROM knowledge_meta WHERE key=?'
  ).bind(META_KEY).first();
  if(!row?.value) return null;
  try{return {...JSON.parse(row.value),metaUpdatedAt:row.updated_at};}
  catch{return {status:'invalid_meta',metaUpdatedAt:row.updated_at};}
}

async function writeMeta(env,value){
  const now=new Date().toISOString();
  await env.KNOWLEDGE_DB.prepare(
    `INSERT INTO knowledge_meta(key,value,updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
  ).bind(META_KEY,JSON.stringify(value),now).run();
  return {...value,metaUpdatedAt:now};
}

function safeError(error){
  return String(error instanceof Error?error.message:error||'cutover_smoke_failed')
    .replace(/[\r\n]+/g,' ')
    .slice(0,220);
}

function stateName(value){
  return typeof value==='object'&&value?String(value.name||''):String(value||'');
}

async function bridgeRow(env,id){
  const rows=await fetchKnowledgeBridge(env);
  return rows.find((row)=>row.document.id===id)||null;
}

async function restoreBridgeFromD1(env,row,current,lastWriter='cutover-smoke-restore'){
  if(!row||!current) return;
  await patchBridgeRecord(env,row.recordId,{
    'Kind':current.kind,
    'Title':current.title,
    'Body Markdown':current.body_md,
    'Status':current.status,
    'D1 Version':Number(current.version),
    'D1 Hash':current.content_sha256,
    'Sync State':'synced',
    'Synced At':new Date().toISOString(),
    'Last Writer':lastWriter
  });
}

export async function getKnowledgeCutoverSmokeStatus(env){
  if(!env?.KNOWLEDGE_DB) return null;
  return readMeta(env);
}

export async function runKnowledgeCutoverSmoke(env){
  if(env.LUNA_KNOWLEDGE_CUTOVER_SMOKE_ENABLED!=='true'){
    return {status:'skipped',reason:'disabled'};
  }
  if(!env.KNOWLEDGE_DB) return {status:'skipped',reason:'knowledge_db_not_configured'};

  const existing=await readMeta(env);
  if(existing?.status==='completed') return existing;

  const startedAt=new Date().toISOString();
  const targetId='luna-knowledge-architecture-v0.1';
  let target=null;
  let current=null;

  const report={
    status:'running',
    startedAt,
    bridgeConflictProtection:false,
    d1ToAirtableMirror:false,
    apiLuna:false,
    activeConstitution:false,
    activeBootstrap:false
  };
  await writeMeta(env,report);

  try{
    target=await bridgeRow(env,targetId);
    if(!target) throw new Error('smoke_target_not_found');
    current=await getDocument(env,targetId);
    if(!current) throw new Error('smoke_target_missing_in_d1');

    // 1) Stale-version protection: pending edit with the wrong D1 version must conflict.
    await patchBridgeRecord(env,target.recordId,{
      'D1 Version':Number(current.version)+1,
      'D1 Hash':current.content_sha256,
      'Sync State':'pending',
      'Last Writer':'cutover-smoke-conflict'
    });
    const conflictSync=await syncKnowledgeBridge(env);
    const conflictResult=conflictSync.results?.find((r)=>r.id===targetId);
    const afterConflict=await bridgeRow(env,targetId);
    if(conflictResult?.status!=='conflict'||stateName(afterConflict?.fields?.['Sync State'])!=='conflict'){
      throw new Error('conflict_protection_failed');
    }
    report.bridgeConflictProtection=true;

    // Repair without changing D1 content.
    await patchBridgeRecord(env,target.recordId,{
      'D1 Version':Number(current.version),
      'D1 Hash':current.content_sha256,
      'Sync State':'pending',
      'Last Writer':'cutover-smoke-repair'
    });
    await syncKnowledgeBridge(env);
    const afterRepair=await bridgeRow(env,targetId);
    if(stateName(afterRepair?.fields?.['Sync State'])!=='synced'){
      throw new Error('conflict_repair_failed');
    }

    // 2) D1 -> Airtable mirror: force only the bridge hash stale and confirm D1 wins.
    await patchBridgeRecord(env,target.recordId,{
      'D1 Hash':'cutover-smoke-mismatch',
      'Sync State':'synced',
      'Last Writer':'cutover-smoke-mirror-probe'
    });
    const mirrorSync=await syncKnowledgeBridge(env);
    const mirrorResult=mirrorSync.results?.find((r)=>r.id===targetId);
    const afterMirror=await bridgeRow(env,targetId);
    if(
      mirrorResult?.status!=='mirrored'||
      String(afterMirror?.fields?.['D1 Hash']||'')!==String(current.content_sha256)||
      String(afterMirror?.fields?.['Body Markdown']||'')!==String(current.body_md)
    ){
      throw new Error('d1_to_airtable_mirror_failed');
    }
    report.d1ToAirtableMirror=true;

    // 3) Production API Luna with the active Constitution. Synthetic data only.
    const constitution=await getPreferredConstitution(env,{allowDraft:false});
    if(!constitution||constitution.status!=='active') throw new Error('active_constitution_missing');
    report.activeConstitution=true;

    const ai=await askLunaForMemoryReview(env,{
      constitution,
      candidate:{
        id:'cutover-smoke-synthetic',
        domain:'system_test',
        summary:'Synthetic LUNA Knowledge cutover smoke test. This is not user knowledge and must not be promoted.',
        evidence_json:'[]',
        source_type:'other',
        confidence:1,
        status:'observing'
      },
      context:'Production cutover smoke test. Treat this as synthetic test data only; do not infer or preserve any user fact.'
    });
    if(!ai.ok) throw new Error(`api_luna_${ai.status||'failed'}_${ai.error||''}`);
    report.apiLuna=true;
    report.apiLunaDecision=ai.payload?.decision||null;
    report.apiLunaModel=ai.model||null;
    report.apiLunaResponseId=ai.responseId||null;

    const bootstrap=await getDocument(env,'luna-bootstrap-v0.1');
    if(!bootstrap||bootstrap.status!=='active'||Number(bootstrap.version)<2){
      throw new Error('active_bootstrap_not_synced');
    }
    report.activeBootstrap=true;
    report.bootstrapVersion=Number(bootstrap.version);
    report.constitutionVersion=Number(constitution.version);

    report.status='completed';
    report.completedAt=new Date().toISOString();
    return await writeMeta(env,report);
  }catch(error){
    report.status='failed';
    report.error=safeError(error);
    report.failedAt=new Date().toISOString();
    await writeMeta(env,report);
    return report;
  }finally{
    try{
      if(target&&current) await restoreBridgeFromD1(env,target,current);
    }catch{}
  }
}
