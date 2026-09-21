import { QuestStateStore } from './quest-store.js';
import { handleQuestRequest } from './quest-routes.js';
export { QuestStateStore };

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health') return Response.json({ok:true,service:'LUNA CORE',time:new Date().toISOString()});
    const questResponse=await handleQuestRequest(request,env); if(questResponse) return questResponse;
    return new Response('LUNA CORE is running');
  },
  scheduled(controller){
    console.log(JSON.stringify({event:'LUNA_CORE_SCHEDULED',cron:controller.cron,scheduledTime:controller.scheduledTime}));
  }
};