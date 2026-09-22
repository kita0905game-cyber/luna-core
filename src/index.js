import { QuestStateStore } from './quest-store.js';
import { handleQuestRequest } from './quest-routes.js';
import { handleMorningRequest } from './morning-routes.js';
import { runScheduledMorning } from './morning-runner.js';
import { runWeatherRefresh } from './weather-updater.js';
export { QuestStateStore };

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health') return Response.json({ok:true,service:'LUNA CORE',time:new Date().toISOString()});
    const morningResponse=await handleMorningRequest(request,env); if(morningResponse) return morningResponse;
    const questResponse=await handleQuestRequest(request,env); if(questResponse) return questResponse;
    return new Response('LUNA CORE is running');
  },
  async scheduled(controller,env){
    if(controller.cron==='5 20 * * *'){
      await runScheduledMorning(controller,env);
      return;
    }

    if(controller.cron==='10,40 * * * *'){
      const result=await runWeatherRefresh(env,{scheduledTime:controller.scheduledTime});
      console.log(JSON.stringify({
        event:'LUNA_WEATHER_REFRESH',
        cron:controller.cron,
        scheduledTime:controller.scheduledTime,
        ...result
      }));
      if(result.status==='failed') throw new Error(result.error||'weather_refresh_failed');
      return;
    }

    console.log(JSON.stringify({event:'LUNA_CORE_SCHEDULED_UNKNOWN',cron:controller.cron,scheduledTime:controller.scheduledTime}));
  }
};
