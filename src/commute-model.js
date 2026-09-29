const WEEKDAY='04:59 05:28 05:49 06:03 06:17 06:33 06:43 06:48 06:58 07:05 07:14 07:26 07:38 07:49 08:02 08:15 08:26 08:36 08:50 09:05 09:08 09:18 09:33 09:48 10:03 10:18 10:33 10:48 11:03 11:18 11:33 11:48 12:03 12:18 12:33 12:48 13:03 13:18 13:33 13:48 14:03 14:18 14:33 14:48 15:03 15:18 15:33 15:48 16:03 16:17 16:23 16:32 16:44 16:59 17:14 17:20 17:29 17:44 17:50 17:59 18:14 18:20 18:29 18:44 18:50 18:59 19:14 19:20 19:29 19:44 19:50 19:59 20:05 20:20 20:29 20:42 20:51 21:02 21:22 21:42 22:02 22:22 22:50 23:18 23:48 00:08'.split(' ');
const WEEKEND_AM='04:59 05:28 05:49 06:03 06:17 06:32 06:50 07:03 07:18 07:33 07:48 07:55 08:03 08:18 08:33 08:48 08:55 09:02 09:18 09:33 09:48 10:03'.split(' ');
const HOLIDAY=new Set('2026-01-01 2026-01-12 2026-02-11 2026-02-23 2026-03-20 2026-04-29 2026-05-03 2026-05-04 2026-05-05 2026-05-06 2026-07-20 2026-08-11 2026-09-21 2026-09-22 2026-09-23 2026-10-12 2026-11-03 2026-11-23 2027-01-01 2027-01-11 2027-02-11 2027-02-23 2027-03-21 2027-03-22 2027-04-29 2027-05-03 2027-05-04 2027-05-05 2027-07-19 2027-08-11 2027-09-20 2027-09-23 2027-10-11 2027-11-03 2027-11-23'.split(' '));

const TIME_ZONE='Asia/Tokyo';
const TRAVEL_MINUTES=15;
const STATION_URL='https://eki.jr-odekake.net/top?id=0620827';

function japanParts(input){
  const date=input instanceof Date?input:new Date(input);
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:TIME_ZONE,
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    weekday:'short',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  const get=(name)=>parts.find((part)=>part.type===name)?.value??'';
  return {
    date:get('year')+'-'+get('month')+'-'+get('day'),
    weekday:get('weekday'),
    hour:Number(get('hour')),
    minute:Number(get('minute'))
  };
}

function serviceClockMinutes(parts){
  const hour=parts.hour<4?parts.hour+24:parts.hour;
  return hour*60+parts.minute;
}

function timetableMinutes(value){
  const [hour,minute]=String(value).split(':').map(Number);
  return (hour<4?hour+24:hour)*60+minute;
}

function formatTime(value){
  const minute=(value+2880)%1440;
  return String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
}

function serviceContext(input){
  const date=input instanceof Date?input:new Date(input);
  const today=japanParts(date);
  const service=today.hour<4?japanParts(new Date(date.getTime()-86400000)):today;
  const weekend=['Sat','Sun'].includes(service.weekday)||HOLIDAY.has(service.date);
  return {
    now:today,
    service,
    weekend,
    times:weekend?WEEKEND_AM:WEEKDAY
  };
}

export function deriveCommuteSchedule(input=new Date()){
  const context=serviceContext(input);
  const current=serviceClockMinutes(context.now);
  const departures=context.times
    .map((time)=>({time,minute:timetableMinutes(time)}))
    .filter((train)=>train.minute-current>=10)
    .sort((a,b)=>a.minute-b.minute);

  const first=departures[0]??null;
  const second=departures[1]??null;
  const leaveMinute=first?first.minute-TRAVEL_MINUTES:null;
  const minutesUntilLeave=leaveMinute===null?null:leaveMinute-current;

  let countdown='時刻表未取得';
  let phase='unavailable';
  if(!first){
    countdown=context.weekend?'登録範囲外・公式確認':'本日の登録列車は終了';
    phase=context.weekend?'partial':'finished';
  }else if(minutesUntilLeave<0){
    countdown='出発目安から '+Math.abs(minutesUntilLeave)+' 分経過';
    phase='overdue';
  }else if(minutesUntilLeave===0){
    countdown='今すぐ出発';
    phase='leave';
  }else if(minutesUntilLeave<=5){
    countdown='あと '+minutesUntilLeave+' 分';
    phase='soon';
  }else{
    countdown='あと '+minutesUntilLeave+' 分';
    phase='normal';
  }

  return {
    route:{
      from:'加美',
      to:'JR難波',
      lineId:'jr-yamatoji',
      lineName:'大和路線',
      direction:'JR難波方面'
    },
    schedule:{
      serviceDate:context.service.date,
      dayType:context.weekend?'土休日':'平日',
      source:context.weekend?'土休日参考登録・午前のみ（公式で最終確認）':'2026年3月14日改正・登録済み平日時刻表',
      sourceUrl:STATION_URL,
      partial:context.weekend,
      holidayCoverage:context.service.date.startsWith('2026-')||context.service.date.startsWith('2027-'),
      travelMinutes:TRAVEL_MINUTES
    },
    derived:{
      firstDeparture:first?.time??null,
      nextDeparture:second?.time??null,
      leaveAt:leaveMinute===null?null:formatTime(leaveMinute),
      minutesUntilLeave,
      countdown,
      phase,
      urgent:minutesUntilLeave!==null&&minutesUntilLeave<=5
    }
  };
}
