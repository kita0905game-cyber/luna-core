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
    discoveredItems:(game.discoveredItems||[]).map((key)=>CANONICAL_TO_CLIENT_ITEM[key]??key),eventCards:(game.eventCards||[]).map((key)=>CANONICAL_TO_CLIENT_CARD[key]??key),hallOfFame,railwayTrainCount:clampInt(game.railwayTrainCount),railwayDepotUnlocked:Boolean(game.railwayDepotUnlocked),updatedAt:Date.parse(game.updatedAt)||Date.now()
  };
}

export function mergeClientMutation(game,before,after){
  if(!isRecord(before)||!isRecord(after)) throw new Error('Invalid LIFE QUEST client mutation');
  const next={...game,materials:{...(game.materials||{})},fish:{...(game.fish||{})},clientV03:{...(isRecord(game.clientV03)?game.clientV03:{})},updatedAt:new Date().toISOString()};
  next.totalXp=clampInt(addDelta(game.totalXp,before.xp,after.xp));
  next.gold=clampInt(addDelta(game.gold,before.gold,after.gold));
  next.knowledge=clampInt(addDelta(game.knowledge,before.knowledge,after.knowledge));
  next.chests=clampInt(addDelta(game.chests,before.chests,after.chests));
  next.miningEnergy=clampInt(addDelta(game.miningEnergy,before.energy,after.energy),0,12);
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