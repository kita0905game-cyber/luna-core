export const MIGRATION_VERSION = 3;
export const MATERIAL_KEYS = ['stone','ironOre','copperOre','wood','crystal','ironIngot','copperIngot','gear','lantern'];
export const FISH_KEYS = ['medaka','funa','koi','bass','aji','saba','tai','salmon','eel','kingyo','rainbowTrout','moonKoi'];
export const CARD_KEYS = ['first_verified','v2_pioneer','first_catch','first_expedition','fish_collector','boss_defeated'];

const JAPANESE_FISH = { medaka:'メダカ',funa:'フナ',koi:'コイ',bass:'ブラックバス',aji:'アジ',saba:'サバ',tai:'タイ',salmon:'サケ',eel:'ウナギ',kingyo:'金魚',rainbowTrout:'ニジマス',moonKoi:'月影ゴイ' };
const FISH_BY_JAPANESE = Object.fromEntries(Object.entries(JAPANESE_FISH).map(([key,value])=>[value,key]));
const CLIENT_TO_CANONICAL_ITEM = { stone:'stone',iron:'ironOre',copper:'copperOre',wood:'wood',crystal:'crystal',ingots:'ironIngot',copperIngots:'copperIngot',gears:'gear',lanterns:'lantern' };
const CANONICAL_TO_CLIENT_ITEM = Object.fromEntries(Object.entries(CLIENT_TO_CANONICAL_ITEM).map(([a,b])=>[b,a]));
const CLIENT_TO_CANONICAL_CARD = { '最初の一歩':'first_verified','開拓者':'v2_pioneer','最初の一匹':'first_catch','世界の外へ':'first_expedition','水辺の収集家':'fish_collector','城主討伐者':'boss_defeated','簿記討伐者':'boss_defeated' };
const CANONICAL_TO_CLIENT_CARD = { first_verified:'最初の一歩',v2_pioneer:'開拓者',first_catch:'最初の一匹',first_expedition:'世界の外へ',fish_collector:'水辺の収集家',boss_defeated:'簿記討伐者' };
const SITE_TO_ZONE = { '森':'forest','山':'mountain','遺跡':'ruins' };
const ZONE_TO_SITE = { forest:'森',mountain:'山',ruins:'遺跡' };

export const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const numberOr = (value,fallback=0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clampInt = (value,min=0,max=Number.MAX_SAFE_INTEGER) => Math.max(min,Math.min(max,Math.round(numberOr(value,min))));
const addDelta = (current,before,after,min=0,max=Number.MAX_SAFE_INTEGER) => Math.max(min,Math.min(max,numberOr(current)+numberOr(after)-numberOr(before)));

export function validateLegacyGame(game){
  if(!isRecord(game)) throw new Error('Legacy payload has no game object');
  const numericKeys=['totalXp','lq','gold','chests','knowledge','bossHp','bossMax','totalVerified','dailyVerified','miningEnergy','mineLevel','workshopLevel','minedTotal','craftedTotal','chestsOpened','bait','explorationTickets','fishingTotal','explorationTotal','studyStreakDays','bestStudyStreakDays','bossLevel','bossRewards','railwayTrainCount','historicalLqAwarded'];
  for(const key of numericKeys) if(typeof game[key] !== 'number' || !Number.isFinite(game[key])) throw new Error(`Legacy game field ${key} is invalid`);
  for(const key of ['materials','fish','weaknessBonusDays','regionalWarehouses']) if(!isRecord(game[key])) throw new Error(`Legacy game field ${key} is invalid`);
  for(const key of ['discoveredItems','discoveredFish','eventCards','hallOfFame','automations','wagonTransfers']) if(!Array.isArray(game[key])) throw new Error(`Legacy game field ${key} is invalid`);
  if(typeof game.updatedAt !== 'string') throw new Error('Legacy updatedAt is invalid');
}

export async function sha256Text(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,'0')).join('');
}
export const sha256Json=(value)=>sha256Text(JSON.stringify(value));

function tokyoDateKey(date=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function dayDiff(fromKey,toKey){
  if(!fromKey||!toKey) return Number.POSITIVE_INFINITY;
  const a=Date.parse(`${fromKey}T00:00:00+09:00`),b=Date.parse(`${toKey}T00:00:00+09:00`);
  return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/86400000):Number.POSITIVE_INFINITY;
}

function zeroMaterials(){
  return Object.fromEntries(MATERIAL_KEYS.map((key)=>[key,0]));
}

function cloneMaterials(input){
  const source=isRecord(input)?input:{};
  return Object.fromEntries(MATERIAL_KEYS.map((key)=>[key,clampInt(source[key])]));
}

function toClientMaterials(input){
  const stock=cloneMaterials(input);
  return {
    stone:stock.stone, iron:stock.ironOre, copper:stock.copperOre, wood:stock.wood, crystal:stock.crystal,
    ingots:stock.ironIngot, copperIngots:stock.copperIngot, gears:stock.gear, lanterns:stock.lantern
  };
}

export function settleRegionalEconomy(state,now=new Date()){
  const next={
    ...state,
    materials:cloneMaterials(state.materials),
    regionalWarehouses:Object.fromEntries(
      ['mountain','forest','waterside','industrial'].map((region)=>[region,cloneMaterials(state.regionalWarehouses?.[region])])
    ),
    wagonTransfers:Array.isArray(state.wagonTransfers)?state.wagonTransfers.map((transfer)=>({...transfer,materials:{...(transfer.materials||{})}})):[]
  };
  const mountain={...(next.regionalWarehouses.mountain??zeroMaterials())};
  const hiredUntilMs=Date.parse(next.minerHiredUntil||'');
  const lastMs=Date.parse(next.minerLastSettledAt||'');
  if(Number.isFinite(hiredUntilMs)&&Number.isFinite(lastMs)&&hiredUntilMs>lastMs){
    const settleTo=Math.min(now.getTime(),hiredUntilMs);
    const cycles=Math.max(0,Math.floor((settleTo-lastMs)/10000));
    if(cycles>0){
      mountain.stone=clampInt(mountain.stone)+cycles*2;
      mountain.ironOre=clampInt(mountain.ironOre)+cycles;
      next.minerLastSettledAt=new Date(lastMs+cycles*10000).toISOString();
    }
  }
  next.regionalWarehouses={...next.regionalWarehouses,mountain};
  const arrived=next.wagonTransfers.filter((transfer)=>Date.parse(transfer.arrivesAt)<=now.getTime());
  for(const transfer of arrived){
    for(const [key,amount] of Object.entries(transfer.materials||{})){
      if(MATERIAL_KEYS.includes(key)) next.materials[key]=clampInt(next.materials[key])+clampInt(amount);
    }
  }
  next.wagonTransfers=next.wagonTransfers.filter((transfer)=>Date.parse(transfer.arrivesAt)>now.getTime());
  return next;
}

export function applyGameAction(game,input,now=new Date()){
  const current=settleRegionalEconomy(game,now);
  const next={
    ...current,
    materials:{...current.materials},
    regionalWarehouses:Object.fromEntries(Object.entries(current.regionalWarehouses||{}).map(([region,stock])=>[region,{...stock}])),
    wagonTransfers:[...(current.wagonTransfers||[])],
    automations:[...(current.automations||[])],
    updatedAt:now.toISOString()
  };
  let message='';
  let reward={};

  if(input?.action==='railway_build_first_freight'){
    if(clampInt(current.railwayTrainCount)>0) throw new Error('初期簡易貨物列車はすでに製造済みです。');
    if(clampInt(current.materials?.ironOre)<100) throw new Error('初期簡易貨物列車には鉄鉱石100が必要です。');
    next.materials.ironOre=clampInt(next.materials.ironOre)-100;
    next.railwayTrainCount=1;
    next.railwayDepotUnlocked=true;
    reward={train:'初期簡易貨物列車',ironOre:-100};
    message='初期簡易貨物列車が完成。連動して簡易車庫が開設された！';
  }else if(input?.action==='hire_miner'){
    if(clampInt(current.gold)<1200) throw new Error('鉱夫を1時間雇うには1200G必要です。');
    const activeUntil=Date.parse(current.minerHiredUntil||'');
    const startMs=Number.isFinite(activeUntil)&&activeUntil>now.getTime()?activeUntil:now.getTime();
    next.gold=clampInt(next.gold)-1200;
    next.minerLastSettledAt=Number.isFinite(activeUntil)&&activeUntil>now.getTime()?current.minerLastSettledAt:now.toISOString();
    next.minerHiredUntil=new Date(startMs+60*60*1000).toISOString();
    reward={minerMinutes:60};
    message='鉱夫を1時間・1200Gで雇用。10秒ごとに採掘し、産出物は山岳倉庫へ保管される。';
  }else if(input?.action==='wagon_mountain_to_main'){
    if(clampInt(current.gold)<50) throw new Error('馬車を出すには50G必要です。');
    const mountain={...(next.regionalWarehouses.mountain??zeroMaterials())};
    const cargo={};
    for(const key of MATERIAL_KEYS) if(clampInt(mountain[key])>0) cargo[key]=clampInt(mountain[key]);
    if(Object.keys(cargo).length===0) throw new Error('山岳倉庫に運ぶ物資がありません。');
    for(const key of MATERIAL_KEYS) mountain[key]=0;
    const arrivesAt=new Date(now.getTime()+30*60*1000);
    next.gold=clampInt(next.gold)-50;
    next.regionalWarehouses={...next.regionalWarehouses,mountain};
    next.wagonTransfers=[...next.wagonTransfers,{id:`wagon-${now.getTime()}`,from:'mountain',to:'main',materials:cargo,startedAt:now.toISOString(),arrivesAt:arrivesAt.toISOString()}].slice(-20);
    reward={wagonCost:50};
    message='馬車を50Gで手配。山岳倉庫の物資を積み込み、30分後にメイン開発拠点へ到着する。';
  }else if(input?.action==='unlock_automation'){
    const costs={freight_load:30,freight_unload:30,maintenance:30,depot:30,reserve:60};
    const key=typeof input?.automation==='string'?input.automation:'';
    const cost=costs[key];
    if(!cost) throw new Error('不明な自動化です。');
    if(next.automations.includes(key)) throw new Error('この自動化は解放済みです。');
    if(clampInt(current.lq)<cost) throw new Error(`この自動化には${cost} LQ必要です。`);
    next.lq=clampInt(next.lq)-cost;
    next.automations=[...next.automations,key];
    const labels={freight_load:'貨物積み込み自動化',freight_unload:'貨物荷下ろし自動化',maintenance:'整備自動化',depot:'入出庫自動化',reserve:'予備編成交代'};
    reward={automation:key};
    message=`${labels[key]}を解放した。`;
  }else{
    throw new Error('未対応のLIFE QUESTアクションです。');
  }

  return {next:applyProgression(next),message,reward};
}

export function applyProgression(state,completedAt=new Date().toISOString()){
  const cards=new Set(Array.isArray(state.eventCards)?state.eventCards:[]);
  if(clampInt(state.totalVerified)>=1) cards.add('first_verified');
  if(clampInt(state.minedTotal)>=1||clampInt(state.craftedTotal)>=1) cards.add('v2_pioneer');
  if(clampInt(state.fishingTotal)>=1) cards.add('first_catch');
  if(clampInt(state.explorationTotal)>=1) cards.add('first_expedition');
  if((state.discoveredFish||[]).length>=5) cards.add('fish_collector');
  if(clampInt(state.bossRewards)>0||clampInt(state.bossHp,1)===0) cards.add('boss_defeated');
  const next={...state,eventCards:[...cards],v31Initialized:true};
  const status={
    chapter1:clampInt(next.totalVerified)>=5,
    chapter2:false,
    chapter3:false
  };
  status.chapter2=status.chapter1&&clampInt(next.mineLevel,1)>=3&&clampInt(next.workshopLevel,1)>=3&&(next.discoveredItems||[]).length>=MATERIAL_KEYS.length;
  status.chapter3=status.chapter2&&(next.discoveredFish||[]).length>=FISH_KEYS.length&&clampInt(next.explorationTotal)>=10&&['first_catch','first_expedition','fish_collector'].every((card)=>cards.has(card));
  const hall=new Map((Array.isArray(next.hallOfFame)?next.hallOfFame:[]).map((entry)=>[entry.chapterId,entry]));
  for(const chapterId of ['chapter1','chapter2','chapter3']) if(status[chapterId]&&!hall.has(chapterId)) hall.set(chapterId,{chapterId,completedAt});
  next.hallOfFame=[...hall.values()];
  return next;
}

export function clientSaveFromGame(game){
  const ext=isRecord(game.clientV03)?game.clientV03:{};
  const fishRecords=isRecord(ext.fishRecords)?ext.fishRecords:{};
  const discoveredFish=(Array.isArray(game.discoveredFish)?game.discoveredFish:[]).map((key)=>JAPANESE_FISH[key]).filter(Boolean);
  const fishInventory={};
  for(const key of FISH_KEYS) fishInventory[JAPANESE_FISH[key]]=clampInt(game.fish?.[key]);
  const hallOfFame={};
  for(const entry of Array.isArray(game.hallOfFame)?game.hallOfFame:[]) if(entry?.chapterId&&entry?.completedAt) hallOfFame[entry.chapterId]=Date.parse(entry.completedAt)||Date.now();
  const expedition=game.exploration&&ZONE_TO_SITE[game.exploration.zone]?{site:ZONE_TO_SITE[game.exploration.zone],startedAt:Date.parse(game.exploration.startedAt),returnsAt:Date.parse(game.exploration.returnsAt)}:null;
  return {
    version:3,depth:clampInt(ext.depth,1),energy:clampInt(game.miningEnergy),stone:clampInt(game.materials?.stone),iron:clampInt(game.materials?.ironOre),copper:clampInt(game.materials?.copperOre),wood:clampInt(game.materials?.wood),crystal:clampInt(game.materials?.crystal),
    ingots:clampInt(game.materials?.ironIngot),copperIngots:clampInt(game.materials?.copperIngot),gears:clampInt(game.materials?.gear),lanterns:clampInt(game.materials?.lantern),fishCaught:clampInt(game.fishingTotal),fishRecords,discoveredFish,fishInventory,bait:clampInt(game.bait),
    discoveries:clampInt(game.explorationTotal),loot:clampInt(ext.loot),explorationTickets:clampInt(game.explorationTickets),expedition,xp:clampInt(game.totalXp),lq:clampInt(game.lq),gold:clampInt(game.gold),knowledge:clampInt(game.knowledge),chests:clampInt(game.chests),bossHp:clampInt(game.bossHp),bossMax:clampInt(game.bossMax,1),
    mineLevel:clampInt(game.mineLevel,1,3),workshopLevel:clampInt(game.workshopLevel,1,3),rocksBroken:clampInt(game.minedTotal),casts:clampInt(ext.casts),crafted:clampInt(game.craftedTotal),chestsOpened:clampInt(game.chestsOpened),exploredLocations:isRecord(ext.exploredLocations)?ext.exploredLocations:{},guildRewardClaimed:Boolean(ext.guildRewardClaimed),
    discoveredItems:(game.discoveredItems||[]).map((key)=>CANONICAL_TO_CLIENT_ITEM[key]??key),eventCards:(game.eventCards||[]).map((key)=>CANONICAL_TO_CLIENT_CARD[key]??key),hallOfFame,
    railwayTrainCount:clampInt(game.railwayTrainCount),railwayDepotUnlocked:Boolean(game.railwayDepotUnlocked),
    automations:[...(Array.isArray(game.automations)?game.automations:[])],
    regionalWarehouses:Object.fromEntries(Object.entries(game.regionalWarehouses||{}).map(([region,stock])=>[region,toClientMaterials(stock)])),
    wagonTransfers:(Array.isArray(game.wagonTransfers)?game.wagonTransfers:[]).map((transfer)=>({
      id:transfer.id,from:transfer.from,to:transfer.to,materials:toClientMaterials(transfer.materials),
      startedAt:transfer.startedAt,arrivesAt:transfer.arrivesAt
    })),
    minerHiredUntil:typeof game.minerHiredUntil==='string'?game.minerHiredUntil:'',
    minerLastSettledAt:typeof game.minerLastSettledAt==='string'?game.minerLastSettledAt:'',
    updatedAt:Date.parse(game.updatedAt)||Date.now()
  };
}

export function mergeClientMutation(game,before,after){
  if(!isRecord(before)||!isRecord(after)) throw new Error('Invalid LIFE QUEST client mutation');
  const next={...game,materials:{...(game.materials||{})},fish:{...(game.fish||{})},clientV03:{...(isRecord(game.clientV03)?game.clientV03:{})},updatedAt:new Date().toISOString()};
  next.totalXp=clampInt(addDelta(game.totalXp,before.xp,after.xp));
  next.gold=clampInt(addDelta(game.gold,before.gold,after.gold));
  next.knowledge=clampInt(addDelta(game.knowledge,before.knowledge,after.knowledge));
  next.chests=clampInt(addDelta(game.chests,before.chests,after.chests));
  next.miningEnergy=clampInt(addDelta(game.miningEnergy,before.energy,after.energy),0);
  next.bait=clampInt(addDelta(game.bait,before.bait,after.bait));
  next.explorationTickets=clampInt(addDelta(game.explorationTickets,before.explorationTickets,after.explorationTickets));
  next.bossHp=clampInt(addDelta(game.bossHp,before.bossHp,after.bossHp),0,Math.max(1,clampInt(game.bossMax,1)));
  next.mineLevel=clampInt(addDelta(game.mineLevel,before.mineLevel,after.mineLevel),1,3);
  next.workshopLevel=clampInt(addDelta(game.workshopLevel,before.workshopLevel,after.workshopLevel),1,3);
  next.minedTotal=clampInt(addDelta(game.minedTotal,before.rocksBroken,after.rocksBroken));
  next.craftedTotal=clampInt(addDelta(game.craftedTotal,before.crafted,after.crafted));
  next.chestsOpened=clampInt(addDelta(game.chestsOpened,before.chestsOpened,after.chestsOpened));
  next.fishingTotal=clampInt(addDelta(game.fishingTotal,before.fishCaught,after.fishCaught));
  next.explorationTotal=clampInt(addDelta(game.explorationTotal,before.discoveries,after.discoveries));
  for(const [clientKey,canonicalKey] of Object.entries(CLIENT_TO_CANONICAL_ITEM)) next.materials[canonicalKey]=clampInt(addDelta(game.materials?.[canonicalKey],before[clientKey],after[clientKey]));
  const beforeFish=isRecord(before.fishInventory)?before.fishInventory:{},afterFish=isRecord(after.fishInventory)?after.fishInventory:{};
  for(const key of FISH_KEYS){const jp=JAPANESE_FISH[key];next.fish[key]=clampInt(addDelta(game.fish?.[key],beforeFish[jp],afterFish[jp]));}
  if(!before.expedition&&after.expedition?.site&&SITE_TO_ZONE[after.expedition.site]) next.exploration={zone:SITE_TO_ZONE[after.expedition.site],startedAt:new Date(after.expedition.startedAt).toISOString(),returnsAt:new Date(after.expedition.returnsAt).toISOString()};
  else if(before.expedition&&!after.expedition) next.exploration=null;
  const mappedItems=(Array.isArray(after.discoveredItems)?after.discoveredItems:[]).map((key)=>CLIENT_TO_CANONICAL_ITEM[key]??key).filter((key)=>MATERIAL_KEYS.includes(key));
  next.discoveredItems=[...new Set([...(game.discoveredItems||[]),...mappedItems])];
  const mappedFish=(Array.isArray(after.discoveredFish)?after.discoveredFish:[]).map((name)=>FISH_BY_JAPANESE[name]).filter((key)=>FISH_KEYS.includes(key));
  for(const key of FISH_KEYS) if(next.fish[key]>0) mappedFish.push(key);
  next.discoveredFish=[...new Set([...(game.discoveredFish||[]),...mappedFish])];
  const mappedCards=(Array.isArray(after.eventCards)?after.eventCards:[]).map((key)=>CLIENT_TO_CANONICAL_CARD[key]??key).filter((key)=>CARD_KEYS.includes(key));
  next.eventCards=[...new Set([...(game.eventCards||[]),...mappedCards])];
  const hall=new Map((Array.isArray(game.hallOfFame)?game.hallOfFame:[]).map((entry)=>[entry.chapterId,entry]));
  if(isRecord(after.hallOfFame)) for(const [chapterId,value] of Object.entries(after.hallOfFame)) if(!hall.has(chapterId)&&['chapter1','chapter2','chapter3'].includes(chapterId)) hall.set(chapterId,{chapterId,completedAt:new Date(numberOr(value,Date.now())).toISOString()});
  next.hallOfFame=[...hall.values()];
  next.clientV03={...next.clientV03,depth:clampInt(addDelta(numberOr(next.clientV03.depth,1),before.depth,after.depth),1),casts:clampInt(addDelta(numberOr(next.clientV03.casts),before.casts,after.casts)),loot:clampInt(addDelta(numberOr(next.clientV03.loot),before.loot,after.loot)),fishRecords:isRecord(after.fishRecords)?after.fishRecords:(next.clientV03.fishRecords||{}),exploredLocations:isRecord(after.exploredLocations)?after.exploredLocations:(next.clientV03.exploredLocations||{}),guildRewardClaimed:Boolean(after.guildRewardClaimed)};
  return applyProgression(next);
}

export function applyStudyReward(game,event){
  const today=tokyoDateKey(new Date(event.answeredAt||Date.now()));
  const previousDaily=game.dayKey===today?clampInt(game.dailyVerified):0;
  const dailyVerified=previousDaily+1,totalVerified=clampInt(game.totalVerified)+1,earnedBait=totalVerified%2===0?1:0;
  const isWeak=event.masteryStatus==='苦手'||event.masteryStatus==='苦手候補';
  const weaknessAlreadyPaid=game.weaknessBonusDays?.[event.category]===today;
  const weaknessBonus=event.correct&&isWeak&&!weaknessAlreadyPaid?2:0;
  const newStudyDay=game.lastStudyDay!==today,consecutive=newStudyDay&&dayDiff(game.lastStudyDay,today)===1;
  const studyStreakDays=newStudyDay?(consecutive?clampInt(game.studyStreakDays)+1:1):clampInt(game.studyStreakDays);
  const continuationBonus=newStudyDay&&studyStreakDays>=2?5+(studyStreakDays%5===0?1:0):0;
  const lqReward=1+weaknessBonus+continuationBonus,bossDamage=isWeak?10:3;
  let bossHp=Math.max(0,clampInt(game.bossHp)-bossDamage),bossLevel=Math.max(1,clampInt(game.bossLevel,1)),bossMax=Math.max(1,clampInt(game.bossMax,1)),bossRewards=clampInt(game.bossRewards),gold=clampInt(game.gold);
  if(bossHp===0){gold+=500;bossRewards+=1;bossLevel+=1;bossMax=Math.max(1,Math.round(bossMax*1.2));bossHp=bossMax;}
  const next=applyProgression({...game,totalXp:clampInt(game.totalXp)+5,lq:clampInt(game.lq)+lqReward,gold,knowledge:clampInt(game.knowledge)+1,bossHp,bossMax,bossLevel,bossRewards,totalVerified,dayKey:today,dailyVerified,dailyBonusClaimed:false,studyStreakDays,bestStudyStreakDays:Math.max(clampInt(game.bestStudyStreakDays),studyStreakDays),lastStudyDay:newStudyDay?today:game.lastStudyDay,weaknessBonusDays:weaknessBonus>0?{...(game.weaknessBonusDays||{}),[event.category]:today}:(game.weaknessBonusDays||{}),miningEnergy:clampInt(game.miningEnergy)+1,bait:clampInt(game.bait)+earnedBait,updatedAt:new Date().toISOString()});
  return {next,reward:{lq:lqReward,xp:5,miningEnergy:1,bait:earnedBait,bossDamage,weaknessBonus,continuationBonus}};
}