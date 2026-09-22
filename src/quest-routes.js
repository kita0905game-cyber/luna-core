import { validateLegacyGame, sha256Text, sha256Json } from './quest-model.js';

const QUEST_OBJECT_NAME='primary';
const MIGRATION_TOKEN_SHA256='f68b243c55704de21b3187a174d9c657fb50b80143f37963a1a15cd282d0e5d3';
const CLIENT_TOKEN_SHA256='0a5855c3306ad2afde78e17debf90b4d3dbd432725e776a8dc5c5c4674c3f927';

const questStore=(env)=>env.QUEST_STATE.getByName(QUEST_OBJECT_NAME);
const questJson=(data,init={})=>{const headers=new Headers(init.headers||{});headers.set('Access-Control-Allow-Origin','*');headers.set('Cache-Control','no-store');return Response.json(data,{...init,headers});};

function browserPairingBridge(){
  const html=`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>LIFE QUEST Safari接続</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4efd9;background:#08110f}
*{box-sizing:border-box}
body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% -10%,rgba(73,112,83,.3),transparent 45%),#08110f}
main{width:min(100%,460px);padding:24px;border:1px solid rgba(225,194,116,.4);border-radius:22px;background:linear-gradient(145deg,rgba(22,52,44,.98),rgba(8,25,23,.98));box-shadow:0 18px 50px rgba(0,0,0,.34)}
small{color:#9db6a7;font-weight:800;letter-spacing:.12em}
h1{margin:12px 0 10px;color:#ffe7a2;font-size:24px}
p{margin:0;color:#d6dfd9;line-height:1.65}
.guide{margin:18px 0;padding:14px;border-radius:14px;background:rgba(4,15,14,.55);color:#c9d8d0;font-size:13px;line-height:1.6}
.actions{display:grid;gap:10px;margin-top:18px}
a,button{display:flex;align-items:center;justify-content:center;min-height:50px;width:100%;border:1px solid rgba(225,194,116,.45);border-radius:12px;font:inherit;font-weight:900;text-decoration:none}
.primary{color:#102019;background:linear-gradient(180deg,#ffe39a,#d8ad55)}
.secondary{color:#d9e6de;background:rgba(18,42,36,.84)}
.note{margin-top:14px;color:#7f9489;font-size:11px;line-height:1.55}
.ok{margin-top:10px;color:#bfe3c7;font-size:12px}
.error{color:#ffd6cf}
</style>
</head>
<body>
<main>
<small>LUNA CORE</small>
<h1>Safari接続ページ</h1>
<p>このページに接続情報を保持しています。ここからLIFE QUESTの接続URLを開くか、Safariへ渡してください。</p>
<div class="guide">
<b>ChatGPT内ブラウザの場合</b><br>
「共有メニューを開く」または「接続URLをコピー」を使ってSafariへ渡します。Safariで接続URLを開けば、そのブラウザだけに接続情報が保存されます。
</div>
<div id="error" class="guide error" hidden></div>
<div id="actions" class="actions">
<a id="open" class="primary" href="#" rel="noreferrer">LIFE QUEST接続URLを開く</a>
<button id="share" class="secondary" type="button" hidden>共有メニューを開く</button>
<button id="copy" class="secondary" type="button">接続URLをコピー</button>
</div>
<p id="result" class="ok" aria-live="polite"></p>
<p class="note">接続URLにはLUNA COREの接続情報が含まれます。他人へ共有しないでください。接続情報はURLの # 以降に保持され、このページを取得するHTTPリクエストには含まれません。</p>
</main>
<script>
(() => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = params.get('lqToken');
  const error = document.getElementById('error');
  const actions = document.getElementById('actions');
  const open = document.getElementById('open');
  const copy = document.getElementById('copy');
  const share = document.getElementById('share');
  const result = document.getElementById('result');
  if (!token) {
    actions.hidden = true;
    error.hidden = false;
    error.textContent = '接続情報がありません。接続済みのLIFE QUESTから、もう一度このページを開いてください。';
    return;
  }
  const target = 'https://life-quest-88o.pages.dev/#lqToken=' + encodeURIComponent(token);
  open.href = target;

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  copy.addEventListener('click', async () => {
    try {
      await copyText(target);
      result.textContent = '接続URLをコピーしました。Safariのアドレス欄へ貼り付けて開いてください。';
    } catch {
      result.textContent = 'コピーできませんでした。共有メニューからSafariへ渡してください。';
    }
  });

  if (navigator.share) {
    share.hidden = false;
    share.addEventListener('click', async () => {
      try {
        await navigator.share({ title: 'LIFE QUEST 接続', url: target });
      } catch {
        // User cancellation is harmless.
      }
    });
  }
})();
</script>
</body>
</html>`;
  return new Response(html,{
    status:200,
    headers:{
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff'
    }
  });
}

async function verify(request,header,expected,bearer=false){let token=request.headers.get(header)??'';if(bearer){if(!token.startsWith('Bearer '))return false;token=token.slice(7).trim();}return Boolean(token)&&(await sha256Text(token))===expected;}

export async function handleQuestRequest(request,env){
  const url=new URL(request.url); if(!url.pathname.startsWith('/quest')) return null;
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Luna-Migration-Token','Access-Control-Max-Age':'86400'}});
  if(url.pathname==='/quest/browser-pair'&&request.method==='GET') return browserPairingBridge();
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
  if(url.pathname==='/quest/action'&&request.method==='POST'){
    if(!(await verify(request,'Authorization',CLIENT_TOKEN_SHA256,true))) return questJson({ok:false,error:'unauthorized'},{status:401});
    try{
      const body=await request.json();
      const receipt=await questStore(env).applyGameAction(body?.actionId,{action:body?.action,automation:body?.automation});
      return questJson({ok:true,service:'LUNA CORE',module:'LIFE QUEST',receipt,time:new Date().toISOString()});
    }catch(error){
      return questJson({ok:false,error:error instanceof Error?error.message:'invalid_game_action'},{status:400});
    }
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