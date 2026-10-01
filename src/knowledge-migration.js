import { getDocument, importDocuments, upsertDocument } from './knowledge-store.js';

function bridgeConfig(env){
  const baseId=String(env.KNOWLEDGE_AIRTABLE_BASE_ID||'').trim();
  const tableId=String(env.KNOWLEDGE_AIRTABLE_TABLE_ID||'').trim();
  if(!baseId||!tableId) throw new Error('knowledge_airtable_bridge_not_configured');
  return {baseId,tableId};
}

function airtableUrl(env,recordId=null){
  const {baseId,tableId}=bridgeConfig(env);
  const base=`https://api.airtable.com/v0/${baseId}/${tableId}`;
  return recordId?`${base}/${recordId}`:base;
}

function airtableHeaders(env){
  if(!env.AIRTABLE_PAT) throw new Error('airtable_pat_not_configured');
  return {Authorization:`Bearer ${env.AIRTABLE_PAT}`,'Content-Type':'application/json'};
}

async function fetchStagingPage(env,offset=null){
  const url=new URL(airtableUrl(env));
  url.searchParams.set('pageSize','100');
  if(offset) url.searchParams.set('offset',offset);
  const response=await fetch(url,{headers:airtableHeaders(env)});
  if(!response.ok){
    const detail=await response.text().catch(()=>'');
    let safeDetail='unknown';
    try{
      const parsed=JSON.parse(detail);
      const type=String(parsed?.error?.type||'').replace(/[^A-Z0-9_\-]/gi,'').slice(0,80);
      const message=String(parsed?.error?.message||'').replace(/[\r\n]+/g,' ').slice(0,120);
      safeDetail=[type,message].filter(Boolean).join(':')||'unknown';
    }catch{}
    throw new Error(`knowledge_bridge_read_failed_${response.status}_${safeDetail}`);
  }
  return response.json();
}

export async function patchBridgeRecord(env,recordId,fields){
  const response=await fetch(airtableUrl(env,recordId),{
    method:'PATCH',
    headers:airtableHeaders(env),
    body:JSON.stringify({fields})
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>'');
    throw new Error(`knowledge_bridge_write_failed_${response.status}_${detail.slice(0,160)}`);
  }
  return response.json();
}

function rowToDocument(record){
  const f=record?.fields||{};
  const id=String(f['Document ID']||'').trim();
  const kind=String(f['Kind']||'').trim();
  const title=String(f['Title']||'').trim();
  const bodyMd=String(f['Body Markdown']||'');
  const status=String(f['Status']||'active').trim();
  if(!id||!kind||!title||!bodyMd) throw new Error(`invalid_bridge_record_${record?.id||'unknown'}`);
  return {
    id,kind,title,bodyMd,status,
    source:'airtable-bridge',
    sourceRef:record.id,
    summary:`Synced from LUNA KNOWLEDGE bridge; Library source version ${f['Source Version']??'unknown'}`
  };
}

export async function fetchKnowledgeBridge(env){
  const records=[];
  let offset=null;
  do{
    const page=await fetchStagingPage(env,offset);
    records.push(...(page?.records||[]));
    offset=page?.offset||null;
  }while(offset);

  return records.map((record)=>({
    recordId:record.id,
    fields:record.fields||{},
    document:rowToDocument(record)
  }));
}

// Backward-compatible name used by the first migration endpoint.
export async function fetchKnowledgeStaging(env){
  return (await fetchKnowledgeBridge(env)).map((row)=>row.document);
}

async function markSynced(env,row,doc,lastWriter){
  await patchBridgeRecord(env,row.recordId,{
    'D1 Version':Number(doc.version),
    'D1 Hash':doc.content_sha256,
    'Sync State':'synced',
    'Synced At':new Date().toISOString(),
    'Last Writer':lastWriter
  });
}

export async function migrateKnowledgeFromAirtable(env){
  const rows=await fetchKnowledgeBridge(env);
  const imported=[];
  for(const row of rows){
    const doc=await upsertDocument(env,row.document,{actor:'airtable-staging-migration',action:'import'});
    await markSynced(env,row,doc,'d1-migration');
    imported.push(doc);
  }
  return {
    source:'airtable',
    sourceBaseId:bridgeConfig(env).baseId,
    sourceTableId:bridgeConfig(env).tableId,
    sourceCount:rows.length,
    importedCount:imported.length,
    documents:imported.map((doc)=>({
      id:doc.id,
      kind:doc.kind,
      status:doc.status,
      version:doc.version,
      content_sha256:doc.content_sha256,
      unchanged:doc.unchanged===true
    }))
  };
}

function numericVersion(value){
  const n=Number(value);
  return Number.isInteger(n)&&n>=1?n:null;
}

export async function syncKnowledgeBridge(env){
  const rows=await fetchKnowledgeBridge(env);
  const results=[];

  for(const row of rows){
    const bridgeState=String(row.fields['Sync State']||'staged');
    const bridgeVersion=numericVersion(row.fields['D1 Version']);
    const bridgeHash=String(row.fields['D1 Hash']||'');
    const current=await getDocument(env,row.document.id);

    try{
      if(!current){
        const created=await upsertDocument(env,{...row.document,expectedVersion:0},{actor:'airtable-bridge',action:'import'});
        await markSynced(env,row,created,'d1-create');
        results.push({id:row.document.id,direction:'airtable_to_d1',status:'created',version:created.version});
        continue;
      }

      if(bridgeState==='pending'){
        if(bridgeVersion!==current.version){
          await patchBridgeRecord(env,row.recordId,{
            'Sync State':'conflict',
            'Last Writer':'sync-conflict'
          });
          results.push({
            id:row.document.id,
            direction:'airtable_to_d1',
            status:'conflict',
            bridgeVersion,
            d1Version:current.version
          });
          continue;
        }

        const updated=await upsertDocument(env,{
          ...row.document,
          expectedVersion:current.version
        },{actor:'airtable-bridge',action:'update'});
        await markSynced(env,row,updated,'chatgpt-airtable');
        results.push({
          id:row.document.id,
          direction:'airtable_to_d1',
          status:updated.unchanged?'unchanged':'updated',
          version:updated.version
        });
        continue;
      }

      if(bridgeVersion!==current.version||bridgeHash!==current.content_sha256){
        await patchBridgeRecord(env,row.recordId,{
          'Kind':current.kind,
          'Title':current.title,
          'Body Markdown':current.body_md,
          'Status':current.status,
          'D1 Version':Number(current.version),
          'D1 Hash':current.content_sha256,
          'Sync State':'synced',
          'Synced At':new Date().toISOString(),
          'Last Writer':'d1-mirror'
        });
        results.push({id:row.document.id,direction:'d1_to_airtable',status:'mirrored',version:current.version});
        continue;
      }

      if(bridgeState!=='synced'){
        await markSynced(env,row,current,'sync-reconcile');
      }
      results.push({id:row.document.id,direction:'none',status:'in_sync',version:current.version});
    }catch(error){
      const message=error instanceof Error?error.message:'knowledge_bridge_sync_failed';
      await patchBridgeRecord(env,row.recordId,{
        'Sync State':message==='version_conflict'?'conflict':'error',
        'Last Writer':'sync-error'
      }).catch(()=>null);
      results.push({id:row.document.id,status:'error',error:message});
    }
  }

  return {
    status:results.some((r)=>r.status==='error'||r.status==='conflict')?'partial':'completed',
    sourceBaseId:bridgeConfig(env).baseId,
    sourceTableId:bridgeConfig(env).tableId,
    processed:results.length,
    results
  };
}
