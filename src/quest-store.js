import { DurableObject } from 'cloudflare:workers';
import { MIGRATION_VERSION, clientSaveFromGame, mergeClientMutation, applyStudyReward } from './quest-model.js';

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
  async activeStateMeta(){
    const game=await this.activeGame(),migration=await this.migrationStatus();
    return {active:Boolean(game),status:game?'active':'not-ready',source:migration?.sourceAppId??null,snapshotSha256:migration?.snapshotSha256??null,gameUpdatedAt:game?.updatedAt??migration?.gameUpdatedAt??null,migratedFieldCount:migration?.gameFieldCount??null,migrationVersion:migration?.version??MIGRATION_VERSION};
  }
  async clientBootstrap(){ const game=await this.activeGame(); return game?{save:clientSaveFromGame(game),gameUpdatedAt:game.updatedAt}:null; }
  async applyClientMutation(mutationId,before,after){
    if(typeof mutationId!=='string'||!mutationId) throw new Error('Missing mutation id');
    const key=`client_mutation:${mutationId}`,processed=await this.ctx.storage.get(key);
    if(processed) return {duplicate:true,...processed};
    const current=await this.activeGame(); if(!current) throw new Error('LIFE QUEST state is not ready');
    const next=mergeClientMutation(current,before,after); await this.ctx.storage.put('active_game_v1',next);
    const receipt={duplicate:false,save:clientSaveFromGame(next),gameUpdatedAt:next.updatedAt};
    await this.ctx.storage.put(key,receipt); return receipt;
  }
  async applyStudyEvent(event){
    const key=`study_event:${event.eventId}`,processed=await this.ctx.storage.get(key); if(processed) return {duplicate:true,...processed};
    const current=await this.activeGame(); if(!current) throw new Error('LIFE QUEST state is not ready');
    const {next,reward}=applyStudyReward(current,event);
    const receipt={duplicate:false,eventId:event.eventId,reward,lqBalance:next.lq,processedAt:new Date().toISOString()};
    await this.ctx.storage.put('active_game_v1',next); await this.ctx.storage.put(key,receipt); return receipt;
  }
}