import { HUB_TIME_ZONE, normalizeHubState } from './hub-state.js';
import { deriveCommuteSchedule } from './commute-model.js';

const PLAN_LABELS={
  push:'PUSH｜胸・肩・腕',
  pull:'PULL｜背中・腕',
  legs:'LEGS｜脚・体幹',
  recovery:'回復日｜軽いストレッチ'
};

const INTEGRATED_DOMAINS=new Set(['health','care','workout','commute','study','diary','news','presence']);

function clone(value){
  return value===undefined?undefined:structuredClone(value);
}

function dateFromKey(key){
  return new Date(String(key)+'T12:00:00Z');
}

function dateKey(date){
  return date.toISOString().slice(0,10);
}

function addDays(key,days){
  const date=dateFromKey(key);
  date.setUTCDate(date.getUTCDate()+days);
  return dateKey(date);
}

function weekday(key){
  return dateFromKey(key).getUTCDay();
}

function firstThursdayOnOrAfter(key){
  const date=dateFromKey(key);
  const shift=(4-date.getUTCDay()+7)%7;
  date.setUTCDate(date.getUTCDate()+shift);
  return dateKey(date);
}

export function jstDateKey(input=new Date()){
  const date=input instanceof Date?input:new Date(input);
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:HUB_TIME_ZONE,
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(date);
  const part=(type)=>parts.find((item)=>item.type===type)?.value??'';
  return part('year')+'-'+part('month')+'-'+part('day');
}

export function weekStartMonday(key){
  return addDays(key,-((weekday(key)+6)%7));
}

export function scheduledWorkoutPlan(key){
  switch(weekday(key)){
    case 1:
    case 4:
      return 'push';
    case 2:
    case 5:
      return 'pull';
    case 3:
    case 6:
      return 'legs';
    default:
      return 'recovery';
  }
}

export function hairRemovalDue(lastDone,today){
  if(![2,4,6].includes(weekday(today))) return false;
  const yesterday=addDays(today,-1);
  return lastDone!==today&&lastDone!==yesterday;
}

export function nextNailTarget(lastDone,today){
  if(typeof lastDone!=='string'||!lastDone) return today;
  return firstThursdayOnOrAfter(addDays(lastDone,7));
}

export function nailDue(lastDone,today){
  return today>=nextNailTarget(lastDone,today);
}

function normalizedDates(values){
  const list=Array.isArray(values)?values:[];
  return [...new Set(list.filter((value)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
}

function derivedFreshness(domain,nowIso){
  const next={...(domain?.freshness??{})};
  const updatedAt=next.updatedAt??domain?.updatedAt??null;
  const expiresAt=next.expiresAt??null;
  if(domain?.status==='unavailable'||domain?.status==='error'||domain?.status==='not_configured'){
    return {...next,status:'unavailable',updatedAt,expiresAt};
  }
  if(expiresAt&&Number.isFinite(Date.parse(expiresAt))&&Date.parse(nowIso)>Date.parse(expiresAt)){
    return {...next,status:'expired',updatedAt,expiresAt};
  }
  if(next.status==='stale'){
    return {...next,status:'stale',updatedAt,expiresAt};
  }
  if(updatedAt){
    return {...next,status:'fresh',updatedAt,expiresAt};
  }
  return {...next,status:'unknown',updatedAt:null,expiresAt};
}

function deriveHealth(domain,today,nowIso){
  const next=clone(domain??{});
  const morning={...(next.morning??{})};
  const completedToday=morning.lastRecordedDate===today;
  next.freshness=derivedFreshness(next,nowIso);
  next.morning={
    ...morning,
    derived:{
      ...(morning.derived??{}),
      completedToday,
      showToday:!completedToday
    }
  };
  return next;
}

function deriveCare(domain,today,nowIso){
  const next=clone(domain??{});
  const hairRemoval={...(next.hairRemoval??{})};
  const nails={...(next.nails??{})};
  const hairDue=hairRemovalDue(hairRemoval.lastDone,today);
  const nailTarget=nextNailTarget(nails.lastDone,today);
  const nailsDue=nailDue(nails.lastDone,today);
  const pending=[
    ...(hairDue?['hairRemoval']:[]),
    ...(nailsDue?['nails']:[])
  ];

  next.freshness=derivedFreshness(next,nowIso);
  next.hairRemoval={
    ...hairRemoval,
    derived:{
      ...(hairRemoval.derived??{}),
      dueToday:hairDue,
      showToday:hairDue
    }
  };
  next.nails={
    ...nails,
    derived:{
      ...(nails.derived??{}),
      targetDate:nailTarget,
      dueToday:nailsDue,
      showToday:nailsDue
    }
  };
  next.derived={
    ...(next.derived??{}),
    pending,
    showToday:pending.length>0
  };
  return next;
}

function deriveWorkout(domain,today,nowIso){
  const next=clone(domain??{});
  const recentDates=normalizedDates([
    ...(Array.isArray(next.recentCompletedDates)?next.recentCompletedDates:[]),
    ...(typeof next.lastCompletedDate==='string'?[next.lastCompletedDate]:[])
  ]);
  const start=weekStartMonday(today);
  const end=addDays(start,6);
  const weekCount=recentDates.filter((key)=>key>=start&&key<=end).length;
  const plan=scheduledWorkoutPlan(today);
  const completedToday=recentDates.includes(today);

  return {
    ...next,
    freshness:derivedFreshness(next,nowIso),
    recentCompletedDates:recentDates.slice(-120),
    derived:{
      ...(next.derived??{}),
      todayPlan:plan,
      todayPlanLabel:PLAN_LABELS[plan],
      completedToday,
      actionNeeded:!completedToday,
      showToday:true,
      weekStart:start,
      weekCount,
      weekGoal:7
    }
  };
}

function deriveCommute(domain,now){
  const next=clone(domain??{});
  const schedule=deriveCommuteSchedule(now);
  return {
    ...next,
    status:'ready',
    source:next.source??'luna-core-static-schedule',
    freshness:derivedFreshness(next,now.toISOString()),
    route:schedule.route,
    schedule:schedule.schedule,
    derived:{
      ...(next.derived??{}),
      ...schedule.derived
    }
  };
}

function deriveStudy(domain,today,nowIso){
  const next=clone(domain??{});
  const bookkeeping={...(next.bookkeeping??{})};
  const sameDay=bookkeeping.snapshotDate===today;
  const todayCount=sameDay?Number(bookkeeping.todayCount??0):0;
  const todayCorrect=sameDay?Number(bookkeeping.todayCorrect??0):0;
  const weakness=Array.isArray(bookkeeping.weakness)?bookkeeping.weakness.slice(0,2):[];
  next.freshness=derivedFreshness(next,nowIso);
  next.bookkeeping={
    ...bookkeeping,
    derived:{
      ...(bookkeeping.derived??{}),
      todayCount,
      todayCorrect,
      studiedToday:todayCount>0,
      recommendedTopic:bookkeeping.recommendedTopic??weakness[0]?.category??bookkeeping.latestCategory??'帳簿記入',
      weakness
    }
  };
  return next;
}

function deriveDiary(domain,today,nowIso){
  const next=clone(domain??{});
  const sameDay=next.snapshotDate===today;
  const todayState={...(next.today??{})};
  const yesterdayKey=addDays(today,-1);
  const yesterday=next.yesterday?.date===yesterdayKey?clone(next.yesterday):null;
  const todayWritten=sameDay&&Boolean(todayState.written);

  next.freshness=derivedFreshness(next,nowIso);
  next.today={
    ...todayState,
    date:today,
    derived:{
      ...(todayState.derived??{}),
      written:todayWritten
    }
  };
  next.yesterday=yesterday;
  next.derived={
    ...(next.derived??{}),
    todayWritten,
    yesterdayAvailable:Boolean(yesterday),
    yesterdayDisplayText:yesterday?.summary??yesterday?.preview??'',
    yesterdayHasSummary:Boolean(yesterday?.summary)
  };
  return next;
}

function deriveNews(domain,nowIso){
  const next=clone(domain??{});
  const items=Array.isArray(next.items)
    ?next.items
      .filter((item)=>item&&typeof item.title==='string'&&typeof item.url==='string')
      .sort((a,b)=>Date.parse(b.publishedAt??0)-Date.parse(a.publishedAt??0))
      .slice(0,6)
    :[];
  next.items=items;
  next.freshness=derivedFreshness(next,nowIso);
  next.derived={
    ...(next.derived??{}),
    available:next.status==='ready'&&items.length>0&&next.freshness.status!=='expired',
    itemCount:items.length
  };
  return next;
}

function derivePresence(domain,nowIso){
  const next=clone(domain??{});
  const freshness=derivedFreshness(next,nowIso);
  const rawMode=['returning_home','home'].includes(next.mode)?next.mode:'unknown';
  const effectiveMode=freshness.status==='expired'?'unknown':rawMode;
  next.freshness=freshness;
  next.derived={
    ...(next.derived??{}),
    effectiveMode,
    returningHome:effectiveMode==='returning_home',
    atHome:effectiveMode==='home',
    known:effectiveMode!=='unknown'
  };
  return next;
}

function deriveOtherDomains(domains,nowIso){
  const next={...domains};
  for(const [name,domain] of Object.entries(next)){
    if(['health','care','workout','commute','study','diary','news','presence'].includes(name)) continue;
    next[name]={
      ...domain,
      freshness:derivedFreshness(domain,nowIso)
    };
  }
  return next;
}

function careSubtitle(pending){
  if(pending.length===2) return '脱毛・爪切りが対象です';
  if(pending[0]==='hairRemoval') return '脱毛が対象です';
  if(pending[0]==='nails') return '爪切りが対象です';
  return '今日のケアは完了しています';
}

function buildHome(domains){
  const morning=domains.health?.morning?.derived??{};
  const care=domains.care?.derived??{};
  const workout=domains.workout?.derived??{};
  const study=domains.study?.bookkeeping?.derived??{};
  const diary=domains.diary?.derived??{};
  const diaryYesterday=domains.diary?.yesterday??null;
  const news=domains.news?.derived??{};
  const newsItems=Array.isArray(domains.news?.items)?domains.news.items:[];
  const pending=Array.isArray(care.pending)?care.pending:[];

  const cards=[
    {
      id:'morning-body',
      domain:'health',
      variant:'habit',
      priority:90,
      visible:Boolean(morning.showToday),
      state:morning.completedToday?'done':'todo',
      title:'からだ記録',
      subtitle:morning.completedToday?'今日の記録済み':'今日の記録がまだです',
      actionId:'health.recordMorning',
      reasonCode:morning.completedToday?'recorded_today':'not_recorded_today'
    },
    {
      id:'care',
      domain:'care',
      variant:'habit',
      priority:70,
      visible:Boolean(care.showToday),
      state:care.showToday?'todo':'done',
      title:'ケア',
      subtitle:careSubtitle(pending),
      actionId:'care.open',
      reasonCode:care.showToday?'care_due_today':'care_complete_today',
      data:{pending}
    },
    {
      id:'workout',
      domain:'workout',
      variant:'habit',
      priority:60,
      visible:true,
      state:workout.completedToday?'done':'todo',
      title:'今日の習慣・筋トレ',
      subtitle:(workout.todayPlanLabel??'今日のメニュー')+'・今週 '+Number(workout.weekCount??0)+' / '+Number(workout.weekGoal??7)+'日'+(workout.completedToday?'・実施済み':''),
      actionId:'workout.open',
      reasonCode:workout.completedToday?'completed_today':'workout_pending'
    },
    {
      id:'study',
      domain:'study',
      variant:'shortcut',
      priority:50,
      visible:true,
      state:study.studiedToday?'done':'todo',
      title:'勉強',
      subtitle:study.studiedToday
        ?'今日 '+Number(study.todayCount??0)+'問・正解 '+Number(study.todayCorrect??0)+'問'
        :'今日の学習を始めよう',
      actionId:'study.openBookkeeping',
      reasonCode:study.studiedToday?'studied_today':'study_not_started',
      data:{
        recommendedTopic:study.recommendedTopic??'帳簿記入',
        weakness:Array.isArray(study.weakness)?study.weakness:[]
      }
    },
    {
      id:'diary',
      domain:'diary',
      variant:'shortcut',
      priority:40,
      visible:true,
      state:diary.todayWritten?'done':'todo',
      title:'昨日の日記',
      subtitle:diary.yesterdayAvailable
        ?String(diary.yesterdayDisplayText??'').slice(0,160)
        :'昨日の日記はまだありません。',
      actionId:'diary.write',
      reasonCode:diary.todayWritten?'written_today':'not_written_today',
      data:{
        yesterdayDate:diaryYesterday?.date??null,
        tomorrowAction:diaryYesterday?.tomorrowAction??'',
        mood:diaryYesterday?.mood??null,
        summaryStatus:diaryYesterday?.summaryStatus??null,
        hasSummary:Boolean(diary.yesterdayHasSummary)
      }
    },
    {
      id:'news',
      domain:'news',
      variant:'feed',
      priority:30,
      visible:true,
      state:news.available?'ready':'unavailable',
      title:'ニュース',
      subtitle:news.available
        ?String(domains.news?.sourceName??'ニュース')+'・'+Number(news.itemCount??0)+'件'
        :'最新ニュースを取得できませんでした。',
      actionId:'news.openSource',
      reasonCode:news.available?'news_ready':'news_unavailable',
      data:{
        sourceName:domains.news?.sourceName??'',
        sourceUrl:domains.news?.sourceUrl??'',
        updatedAt:domains.news?.updatedAt??'',
        items:newsItems
      }
    }
  ].sort((a,b)=>b.priority-a.priority);

  const actions=[
    {id:'health.recordMorning',enabled:!morning.completedToday,label:'からだ記録',target:'health'},
    {id:'care.recordHairRemoval',enabled:pending.includes('hairRemoval'),label:'脱毛を記録',target:'care'},
    {id:'care.recordNails',enabled:pending.includes('nails'),label:'爪切りを記録',target:'care'},
    {id:'workout.open',enabled:true,label:'筋トレを開く',target:'workout'},
    {id:'study.openBookkeeping',enabled:true,label:'簿記を開く',target:'study'},
    {id:'diary.write',enabled:true,label:'日記を書く',target:'diary'},
    {id:'news.openSource',enabled:Boolean(news.available),label:'ニュースを開く',target:'news'}
  ];

  return {
    cards,
    alerts:[],
    actions
  };
}

function buildCapabilities(domains){
  return Object.fromEntries(Object.keys(domains).map((name)=>{
    const domain=domains[name]??{};
    const configured=INTEGRATED_DOMAINS.has(name)||domain.status!=='unknown';
    return [name,{
      supported:true,
      configured,
      status:configured
        ?(domain.status==='error'||domain.status==='unavailable'?'error':'ready')
        :'planned'
    }];
  }));
}

export function deriveHubState(current,{now=new Date()}={}){
  const stored=normalizeHubState(current);
  const next=clone(stored);
  const nowDate=now instanceof Date?now:new Date(now);
  const nowIso=nowDate.toISOString();
  const today=jstDateKey(nowDate);

  next.meta={
    ...next.meta,
    generatedAt:nowIso,
    localDate:today,
    timeZone:HUB_TIME_ZONE
  };

  next.domains={...(next.domains??{})};
  next.domains.health=deriveHealth(next.domains.health,today,nowIso);
  next.domains.care=deriveCare(next.domains.care,today,nowIso);
  next.domains.workout=deriveWorkout(next.domains.workout,today,nowIso);
  next.domains.commute=deriveCommute(next.domains.commute,nowDate);
  next.domains.study=deriveStudy(next.domains.study,today,nowIso);
  next.domains.diary=deriveDiary(next.domains.diary,today,nowIso);
  next.domains.news=deriveNews(next.domains.news,nowIso);
  next.domains.presence=derivePresence(next.domains.presence,nowIso);
  next.domains=deriveOtherDomains(next.domains,nowIso);
  next.home=buildHome(next.domains);
  next.capabilities=buildCapabilities(next.domains);
  return next;
}
