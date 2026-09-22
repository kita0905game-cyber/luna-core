import { QuestStateStore } from './quest-store.js';
import { handleQuestRequest } from './quest-routes.js';
import { handleMorningRequest } from './morning-routes.js';
import { runScheduledMorning } from './morning-runner.js';
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
    console.log(JSON.stringify({event:'LUNA_CORE_SCHEDULED_UNKNOWN',cron:controller.cron,scheduledTime:controller.scheduledTime}));
  }
};