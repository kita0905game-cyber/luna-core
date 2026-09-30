import { importDocuments } from './knowledge-store.js';

const STAGING_BASE_ID='appXHHkgXH1yFwnjC';
const STAGING_TABLE_ID='tblbv3WM7V0XYa7vc';

async function fetchStagingPage(env,offset=null){
  if(!env.AIRTABLE_PAT) throw new Error('airtable_pat_not_configured');
  const url=new URL(`https://api.airtable.com/v0/${STAGING_BASE_ID}/${STAGING_TABLE_ID}`);
  url.searchParams.set('pageSize','100');
  if(offset) url.searchParams.set('offset',offset);
  const response=await fetch(url,{
    headers:{Authorization:`Bearer ${env.AIRTABLE_PAT}`}
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>'');
    throw new Error(`knowledge_staging_read_failed_${response.status}_${detail.slice(0,160)}`);
  }
  return response.json();
}

export async function fetchKnowledgeStaging(env){
  const records=[];
  let offset=null;
  do{
    const page=await fetchStagingPage(env,offset);
    records.push(...(page?.records||[]));
    offset=page?.offset||null;
  }while(offset);

  return records.map((record)=>{
    const f=record?.fields||{};
    const id=String(f['Document ID']||'').trim();
    const kind=String(f['Kind']||'').trim();
    const title=String(f['Title']||'').trim();
    const bodyMd=String(f['Body Markdown']||'');
    const status=String(f['Status']||'active').trim();
    if(!id||!kind||!title||!bodyMd) throw new Error(`invalid_staging_record_${record?.id||'unknown'}`);
    return {
      id,kind,title,bodyMd,status,
      source:'airtable-staging',
      sourceRef:record.id,
      summary:`Imported from LUNA KNOWLEDGE STAGING; source version ${f['Source Version']??'unknown'}`
    };
  });
}

export async function migrateKnowledgeFromAirtable(env){
  const documents=await fetchKnowledgeStaging(env);
  const imported=await importDocuments(env,documents,{actor:'airtable-staging-migration'});
  return {
    source:'airtable',
    sourceBaseId:STAGING_BASE_ID,
    sourceTableId:STAGING_TABLE_ID,
    sourceCount:documents.length,
    importedCount:imported.length,
    documents:imported.map((doc)=>({
      id:doc.id,
      kind:doc.kind,
      status:doc.status,
      version:doc.version,
      content_sha256:doc.content_sha256
    }))
  };
}
