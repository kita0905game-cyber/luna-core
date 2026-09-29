const TIME_ZONE='Asia/Tokyo';

const PLAN_LABELS={
  push:'PUSH｜胸・肩・腕',
  pull:'PULL｜背中・腕',
  legs:'LEGS｜脚・体幹',
  recovery:'回復日｜軽いストレッチ'
};

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
    timeZone:TIME_ZONE,
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

function deriveHealth(domain,today){
  const next=clone(domain??{});
  const morning={...(next.morning??{})};
  const completedToday=morning.lastRecordedDate===today;
  next.morning={
    ...morning,
    completedToday,
    showToday:!completedToday
  };
  return next;
}

function deriveCare(domain,today){
  const next=clone(domain??{});
  const hairRemoval={...(next.hairRemoval??{})};
  const nails={...(next.nails??{})};
  const hairDue=hairRemovalDue(hairRemoval.lastDone,today);
  const nailTarget=nextNailTarget(nails.lastDone,today);
  const nailsDue=nailDue(nails.lastDone,today);

  next.hairRemoval={
    ...hairRemoval,
    dueToday:hairDue,
    showToday:hairDue
  };
  next.nails={
    ...nails,
    targetDate:nailTarget,
    dueToday:nailsDue,
    showToday:nailsDue
  };
  next.pending=[
    ...(hairDue?['hairRemoval']:[]),
    ...(nailsDue?['nails']:[])
  ];
  next.showToday=next.pending.length>0;
  return next;
}

function deriveWorkout(domain,today){
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
    recentCompletedDates:recentDates.slice(-120),
    todayPlan:plan,
    todayPlanLabel:PLAN_LABELS[plan],
    completedToday,
    actionNeeded:!completedToday,
    showToday:true,
    weekStart:start,
    weekCount,
    weekGoal:7
  };
}

export function deriveHubState(current,{now=new Date()}={}){
  const next=clone(current);
  const today=jstDateKey(now);
  next.localDate=today;
  next.timeZone=TIME_ZONE;
  next.derivedAt=(now instanceof Date?now:new Date(now)).toISOString();
  next.domains={...(next.domains??{})};
  next.domains.health=deriveHealth(next.domains.health,today);
  next.domains.care=deriveCare(next.domains.care,today);
  next.domains.workout=deriveWorkout(next.domains.workout,today);
  return next;
}
