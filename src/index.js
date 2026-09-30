import { QuestStateStore } from './quest-store.js';
import { handleQuestRequest } from './quest-routes.js';
import { handleMorningRequest } from './morning-routes.js';
import { handleHubRequest } from './hub-routes.js';
import { handleKnowledgeRequest } from './knowledge-routes.js';
import { runScheduledMorning } from './morning-runner.js';
import { runWeatherRefresh } from './weather-updater.js';
import { runtimeMetadata } from './runtime-meta.js';
import { runMemoryCandidateReview } from './memory-review.js';
export { QuestStateStore };

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health') return Response.json({ok:true,service:'LUNA CORE',deployment:runtimeMetadata(env),time:new Date().toISOString()});
    const hubResponse=await handleHubRequest(request,env); if(hubResponse) return hubResponse;
    const knowledgeResponse=await handleKnowledgeRequest(request,env); if(knowledgeResponse) return knowledgeResponse;
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
      if(result.status==='failed'||result.hubSynced===false) throw new Error(result.hubError||result.error||'weather_hub_refresh_failed');
      return;
    }

    if(controller.cron==='20 18 * * *'){
      const result=await runMemoryCandidateReview(env,{limit:5});
      console.log(JSON.stringify({
        event:'LUNA_MEMORY_REVIEW',
        cron:controller.cron,
        scheduledTime:controller.scheduledTime,
        ...result
      }));
      return;
    }

    console.log(JSON.stringify({event:'LUNA_CORE_SCHEDULED_UNKNOWN',cron:controller.cron,scheduledTime:controller.scheduledTime}));
  }
};
