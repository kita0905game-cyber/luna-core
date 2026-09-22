export const MORNING_VERSION='0.1.0';

export const MORNING_OUTPUT_SCHEMA={
  type:'object',
  additionalProperties:false,
  properties:{
    date:{type:'string'},
    generated_at:{type:'string'},
    day_type:{type:'string',enum:['workday','holiday']},
    day_type_reason:{type:'string'},
    today_events:{type:'array',items:{type:'string'},maxItems:3},
    weather:{
      type:'object',
      additionalProperties:false,
      properties:{
        icon:{type:['string','null']},
        low:{type:['number','null']},
        high:{type:['number','null']},
        rain_am:{type:['number','null']},
        rain_pm:{type:['number','null']}
      },
      required:['icon','low','high','rain_am','rain_pm']
    },
    comment:{type:'string'},
    news:{type:'array',items:{type:'string'},maxItems:2},
    bookkeeping:{type:'string'},
    commute:{
      anyOf:[
        {type:'null'},
        {
          type:'object',
          additionalProperties:false,
          properties:{
            status:{type:'string'},
            trains:{
              type:'array',
              items:{
                type:'object',
                additionalProperties:false,
                properties:{
                  train:{type:'string'},
                  leave_home:{type:'string'}
                },
                required:['train','leave_home']
              },
              maxItems:3
            }
          },
          required:['status','trains']
        }
      ]
    }
  },
  required:['date','generated_at','day_type','day_type_reason','today_events','weather','comment','news','bookkeeping','commute']
};

export function morningDateJst(timestamp=Date.now()){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Tokyo',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(new Date(timestamp));
  const map=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function morningGeneratedAtJst(timestamp=Date.now()){
  const date=new Date(timestamp);
  const parts=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Asia/Tokyo',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  const map=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+09:00`;
}
