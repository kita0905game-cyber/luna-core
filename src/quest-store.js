import { DurableObject } from 'cloudflare:workers';
import { MIGRATION_VERSION, clientSaveFromGame, mergeClientMutation, applyStudyReward, settleRegionalEconomy, applyGameAction, sha256Text } from './quest-model.js';

export class QuestStateStore extends DurableObject {
  async migrationStatus(){ return (await this.ctx.storage.get('migration_game_meta_v3'))??{status:'empty',version:MIGRATION_VERSION}; }
  async activateMigratedGame(game,meta){
    const existing=await this.ctx.storage.get('migration_game_meta_v3');
    if(existing?.status==='active') return existing;
    const activeMeta={...meta,version:MIGRATION_VERSION,scope:'game-only',status:'active',immutableSourceSnapshot:true,activatedAt:new Date().toISOString()};
    await this.ctx.storage.put('migration_game_snapshot_v3',game);
    await this.ctx.storage.put('active_game_v1',game);
    await this.ctx.storage.put('migration_game_meta_v3',activeMeta);
    return activeMeta;
  }
  async recordMigrationError(message){
    const meta={status:'error',version:MIGRATION_VERSION,scope:'game-only',attemptAt:new Date().toISOString(),lastError:String(message).slice(0,500)};
    await this.ctx.storage.put('migration_game_meta_v3',meta); return meta;
  }
  async activeGame(){ return (await this.ctx.storage.get('active_game_v1'))??null; }
  async settledGame(){
    const current=await this.activeGame(); if(!current) return null;
    const settled=settleRegionalEconomy(current);
    if(JSON.stringify(settled)!==JSON.stringify(current)){
      settled.updatedAt=new Date().toISOString();
      await this.ctx.storage.put('active_game_v1',settled);
    }
    return settled;
  }
  async activeStateMeta(){
    const game=await this.activeGame(),migration=await this.migrationStatus();
    return {active:Boolean(game),status:game?'active':'not-ready',source:migration?.sourceAppId??null,snapshotSha256:migration?.snapshotSha256??null,gameUpdatedAt:game?.updatedAt??migration?.gameUpdatedAt??null,migratedFieldCount:migration?.gameFieldCount??null,migrationVersion:migration?.version??MIGRATION_VERSION};
  }
  async clientBootstrap(){ const game=await this.settledGame(); return game?{save:clientSaveFromGame(game),gameUpdatedAt:game.updatedAt}:null; }

  async verifyClientToken(token){
    if(typeof token!=='string'||!token) return false;
    const digest=await sha256Text(token);
    const tokens=(await this.ctx.storage.get('quest_client_tokens_v1'))??[];
    return tokens.some((entry)=>entry?.sha256===digest);
  }

  async issueClientPairingTicket(){
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codeBytes=new Uint8Array(10);
    crypto.getRandomValues(codeBytes);
    const code=Array.from(codeBytes,(value)=>alphabet[value%alphabet.length]).join('');
    const tokenBytes=new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const deviceToken=Array.from(tokenBytes,(value)=>value.toString(16).padStart(2,'0')).join('');
    const createdAt=Date.now();
    const expiresAt=createdAt+10*60*1000;
    await this.ctx.storage.put(`quest_pair_ticket:${code}`,{deviceToken,createdAt,expiresAt});
    return {code,createdAt:new Date(createdAt).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
  }

  async redeemClientPairingTicket(rawCode){
    const code=String(rawCode??'').trim().toUpperCase();
    if(!/^[A-Z2-9]{10}$/.test(code)) throw new Error('invalid_pairing_code');
    const key=`quest_pair_ticket:${code}`;
    const ticket=await this.ctx.storage.get(key);
    if(!ticket) throw new Error('pairing_code_not_found');
    if(!Number.isFinite(ticket.expiresAt)||ticket.expiresAt<Date.now()){
      await this.ctx.storage.delete(key);
      throw new Error('pairing_code_expired');
    }
    await this.ctx.storage.delete(key);

    const sha256=await sha256Text(ticket.deviceToken);
    const current=(await this.ctx.storage.get('quest_client_tokens_v1'))??[];
    const next=[
      ...current.filter((entry)=>entry?.sha256!==sha256).slice(-19),
      {sha256,createdAt:new Date().toISOString(),source:'pairing-ticket'}
    ];
    await this.ctx.storage.put('quest_client_tokens_v1',next);

    const payload=await this.clientBootstrap();
    if(!payload) throw new Error('state_not_ready');
    return {token:ticket.deviceToken,...payload};
  }
  async applyClientMutation(mutationId,before,after){
    if(typeof mutationId!=='string'||!mutationId) throw new Error('Missing mutation id');
    const key=`client_mutation:${mutationId}`,processed=await this.ctx.storage.get(key);
    if(processed) return {duplicate:true,...processed};
    const current=await this.settledGame(); if(!current) throw new Error('LIFE QUEST state is not ready');
    const next=mergeClientMutation(current,before,after); await this.ctx.storage.put('active_game_v1',next);
    const receipt={duplicate:false,save:clientSaveFromGame(next),gameUpdatedAt:next.updatedAt};
    await this.ctx.storage.put(key,receipt); return receipt;
  }
  async applyStudyEvent(event){
    const key=`study_event:${event.eventId}`,processed=await this.ctx.storage.get(key); if(processed) return {duplicate:true,...processed};
    const current=await this.settledGame(); if(!current) throw new Error('LIFE QUEST state is not ready');
    const {next,reward}=applyStudyReward(current,event);
    const receipt={duplicate:false,eventId:event.eventId,reward,lqBalance:next.lq,processedAt:new Date().toISOString()};
    await this.ctx.storage.put('active_game_v1',next); await this.ctx.storage.put(key,receipt); return receipt;
  }
  async applyGameAction(actionId,input){
    if(typeof actionId!=='string'||!actionId) throw new Error('Missing action id');
    const key=`game_action:${actionId}`,processed=await this.ctx.storage.get(key);
    if(processed) return {duplicate:true,...processed};
    const current=await this.settledGame(); if(!current) throw new Error('LIFE QUEST state is not ready');
    const {next,message,reward}=applyGameAction(current,input);
    await this.ctx.storage.put('active_game_v1',next);
    const receipt={duplicate:false,actionId,message,reward,save:clientSaveFromGame(next),gameUpdatedAt:next.updatedAt,processedAt:new Date().toISOString()};
    await this.ctx.storage.put(key,receipt); return receipt;
  }

  async recordMorningRun(run){
    const safeRun={...run};
    await this.ctx.storage.put('morning_latest_run_v1',safeRun);
    const history=(await this.ctx.storage.get('morning_run_history_v1'))??[];
    const meta={...safeRun};
    delete meta.payload;
    history.unshift(meta);
    await this.ctx.storage.put('morning_run_history_v1',history.slice(0,20));
    return safeRun;
  }
  async latestMorningRun(){ return (await this.ctx.storage.get('morning_latest_run_v1'))??null; }
  async ingestMorningWidget(payload,meta={}){
    const value={
      payload,
      meta:{
        source:meta.source??'external',
        sourceStatus:meta.sourceStatus??null,
        sourceUpdatedAt:meta.sourceUpdatedAt??null,
        ingestedAt:new Date().toISOString()
      }
    };
    await this.ctx.storage.put('morning_widget_payload_v1',value);
    return {date:payload.date,generatedAt:payload.generated_at,...value.meta};
  }
  async morningWidget(){ return (await this.ctx.storage.get('morning_widget_payload_v1'))??null; }
  async morningStatus(){
    const latest=await this.latestMorningRun();
    const history=(await this.ctx.storage.get('morning_run_history_v1'))??[];
    return {
      initialized:Boolean(latest),
      latest:latest?{
        runId:latest.runId,
        status:latest.status,
        trigger:latest.trigger,
        date:latest.date,
        startedAt:latest.startedAt,
        finishedAt:latest.finishedAt,
        aiUsed:Boolean(latest.aiUsed),
        published:Boolean(latest.published),
        error:latest.error??null
      }:null,
      recentRuns:history.slice(0,5)
    };
  }
}