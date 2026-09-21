import { validateLegacyGame, sha256Text, sha256Json } from './quest-model.js';

const QUEST_OBJECT_NAME='primary';
const MIGRATION_TOKEN_SHA256='f68b243c55704de21b3187a174d9c657fb50b80143f37963a1a15cd282d0e5d3';
const CLIENT_TOKEN_SHA256='0a5855c3306ad2afde78e17debf90b4d3dbd432725e776a8dc5c5c4674c3f927';

const questStore=(env)=>env.QUEST_STATE.getByName(QUEST_OBJECT_NAME);
const questJson=(data,init={})=>{const headers=new Headers(init.headers||{});headers.set('Access-Control-Allow-Origin','*');headers.set('Cache-Control','no-store');return Response.json(data,{...init,headers});};
async function verify(request,header,expected,bearer=false){let token=request.headers.get(header)??'';if(bearer){if(!token.startsWith('Bearer '))return false;token=token.slice(7).trim();}return Boolean(token)&&(await sha256Text(token))===expected;}

export async function handleQuestRequest(request,env){
  const url=new URL(request.url); if(!url.pathname.startsWith('/quest')) return null;
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Luna-Migration-Token','Access-Control-Max-Age':'86400'}});
  if(url.pathname==='/quest'){
    const state=await questStore(env).activeStateMeta();
    return questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',status:state.active?'operational':'migration-pending',message:state.active?'LIFE QUEST is operational on LUNA CORE.':'LIFE QUEST game-state migration is pending.',time:new Date().toISOString()});
  }
  if(url.pathname==='/quest/migration/status'){
    const migration=await questStore(env).migrationStatus(); return questJson({ok:migration?.status==='active',service:'LUNA CORE',module:'LIFE QUEST',migration,time:new Date().toISOString()});
  }
  if(url.pathname==='/quest/migration/import'&&request.method==='POST'){
    const store=questStore(env),current=await store.migrationStatus();
    if(current?.status==='active') return questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',migration:current,message:'Migration already completed.',time:new Date().toISOString()});
    if(!(await verify(request,'X-Luna-Migration-Token',MIGRATION_TOKEN_SHA256))) return questJson({ok:false,error:'invalid_migration_token'},{status:403});
    try{
      const payload=await request.json(); if(payload?.sourceAppId!=='3-qiawue') throw new Error('Unexpected migration source');
      const game=payload?.game; validateLegacyGame(game); const checksum=await sha256Json(game);
      const meta={source:'appdeploy-client-push',sourceAppId:'3-qiawue',fetchedAt:new Date().toISOString(),snapshotSha256:checksum,gameUpdatedAt:game.updatedAt,gameFieldCount:Object.keys(game).length,schema:'appdeploy-life-quest-v31',bookkeepingMigrated:false};
      const migration=await store.activateMigratedGame(game,meta); return questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',migration,time:new Date().toISOString()},{status:201});
    }catch(error){const migration=await store.recordMigrationError(error instanceof Error?error.message:'Unknown migration error');return questJson({ok:false,service:'LUNA CORE',module:'LIFE QUEST',migration,time:new Date().toISOString()},{status:400});}
  }
  if(url.pathname==='/quest/state'){
    const state=await questStore(env).activeStateMeta(); return questJson({ok:state.active,service:'LUNA CORE',module:'LIFE QUEST',state,time:new Date().toISOString()},{status:state.active?200:503});
  }
  if(url.pathname==='/quest/client/bootstrap'&&request.method==='GET'){
    if(!(await verify(request,'Authorization',CLIENT_TOKEN_SHA256,true))) return questJson({ok:false,error:'unauthorized'},{status:401});
    const payload=await questStore(env).clientBootstrap(); return payload?questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',...payload,time:new Date().toISOString()}):questJson({ok:false,error:'state_not_ready'},{status:503});
  }
  if(url.pathname==='/quest/client/mutation'&&request.method==='PUT'){
    if(!(await verify(request,'Authorization',CLIENT_TOKEN_SHA256,true))) return questJson({ok:false,error:'unauthorized'},{status:401});
    try{const body=await request.json(),payload=await questStore(env).applyClientMutation(body?.mutationId,body?.before,body?.after);return questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',...payload,time:new Date().toISOString()});}
    catch(error){return questJson({ok:false,error:error instanceof Error?error.message:'invalid_mutation'},{status:400});}
  }
  if(url.pathname==='/quest/study/event'&&request.method==='POST'){
    if(!(await verify(request,'Authorization',CLIENT_TOKEN_SHA256,true))) return questJson({ok:false,error:'unauthorized'},{status:401});
    try{
      const body=await request.json(); if(body?.source!=='airtable-mirrored-study'||typeof body?.eventId!=='string'||!body.eventId||typeof body?.category!=='string'||typeof body?.correct!=='boolean') throw new Error('Invalid study event');
      const receipt=await questStore(env).applyStudyEvent({eventId:body.eventId,category:body.category,correct:body.correct,masteryStatus:typeof body.masteryStatus==='string'?body.masteryStatus:'未判定',answeredAt:typeof body.answeredAt==='string'?body.answeredAt:new Date().toISOString()});
      return questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',receipt,time:new Date().toISOString()});
    }catch(error){return questJson({ok:false,error:error instanceof Error?error.message:'invalid_study_event'},{status:400});}
  }
  return questJson({ok:false,error:'not_found'},{status:404});
}