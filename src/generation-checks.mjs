import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {Store} from './store.mjs';
import {AgentBridge} from './agent-bridge.mjs';
import {GenerationRunner} from './codex-executor.mjs';
import {isNativeProvider,matchesAgentHost,queueReferences,referenceCompatibility,selectedPreset} from './generation-models.mjs';

const lifetime=24*60*60*1000;
const activeStates=['preparing','queued','running'];
export const checkKey=(provider,agentHost)=>provider==='agent'?'agent:'+(agentHost||'current'):provider;

// Test tasks use their own store so a test cannot replace a user's draft or batch.
export class GenerationChecks{
  constructor(store,runner,runninghub,agentBridge){
    this.store=store;this.runner=runner;this.runninghub=runninghub;this.agentBridge=agentBridge;
    this.active=null;this.starting=false;
  }
  async scope(provider,agentHost){
    if(provider==='agent'){
      const c=this.agentBridge.status();
      return c.connected&&matchesAgentHost(agentHost,c.agentName)?JSON.stringify([c.agentName,c.imageTool]):null;
    }
    if(provider==='codex')return (await this.runner.probe(provider)).accountId||null;
    const s=await this.store.refresh();
    const preset=selectedPreset(s.providerPresets,provider,s.draft.providerPresetId);
    const key=await this.runninghub.credentials.key(provider);
    return createHash('sha256').update(key).update(JSON.stringify(preset)).digest('hex');
  }
  async status(provider,agentHost,probe){
    const s=await this.store.refresh(),key=checkKey(provider,agentHost),check=s.generationChecks?.[key];
    let scope;
    if(provider==='codex')scope=probe?.accountId;
    else if(provider==='agent')scope=await this.scope(provider,agentHost);
    else if(probe?.available)scope=await this.scope(provider,agentHost);
    const fresh=check&&(check.scope===scope||provider==='agent'&&!scope)&&Date.now()-Date.parse(check.updatedAt)<lifetime;
    const active=check&&activeStates.includes(check.status)&&check.deadline>Date.now();
    return {key,checkScope:scope,capability:fresh&&check.status==='verified'?'confirmed':fresh&&check.status==='failed'?'failed':'unknown',check:active||fresh?check:null};
  }
  async patch(key,id,patch){
    return this.store.mutate(()=>{
      const check=this.store.state.generationChecks?.[key];
      if(check?.id===id&&check.status!=='cancelled')Object.assign(check,patch,{updatedAt:new Date().toISOString()});
      return check;
    });
  }
  async start({provider,agentHost,costConfirmed=false}){
    if(this.starting)throw Error('测试正在准备，请稍候。');
    this.starting=true;
    try{
      const s=await this.store.refresh();
      if(this.runner.job||s.tasks.some(t=>t.status==='running'))throw Error('请先等当前图片完成，再测试渠道。');
      if(!isNativeProvider(provider)&&!costConfirmed)throw Error('生图 API 测试会提交一张图片并产生费用，请先确认。');
      const scope=await this.scope(provider,agentHost);
      if(provider!=='agent'&&!scope)throw Error('请先连接并登录所选渠道。');
      const id=randomUUID(),key=checkKey(provider,agentHost),deadline=Date.now()+16*60*1000;
      await this.store.mutate(()=>{
        const state=this.store.state;
        if(this.runner.job||state.tasks.some(t=>t.status==='running'))throw Error('当前图片正在执行，请稍后测试。');
        const busy=Object.values(state.generationChecks||{}).find(c=>activeStates.includes(c.status)&&c.deadline>Date.now());
        if(busy)throw Error('已有测试图在执行，请等待它完成。');
        state.generationChecks??={};
        state.generationChecks[key]={id,key,provider,agentHost,scope,status:'preparing',deadline,workerPid:process.pid,updatedAt:new Date().toISOString()};
      });
      this.active={id,key,provider,agentHost};
      try{
        const testStore=await new Store(path.join(this.store.root,'checks',id),{builtinPresets:[]}).init();
        const task={id,batchId:id,provider,agentHost,status:'pending',attempts:0,ratio:'1:1',prompt:'请生成一张灰色纯色背景上的红色陶瓷杯照片，方形构图，柔和影棚光线。直接生成图片。',isCapabilityTest:true,createdAt:new Date().toISOString()};
        if(!isNativeProvider(provider)){
          const {costumes,poses,count}=queueReferences(s.draft);
          const preset=selectedPreset(s.providerPresets,provider,s.draft.providerPresetId);
          const problem=referenceCompatibility(preset,['portrait',...(costumes[0]?['costume']:[]),...(poses[0]?['pose']:[])],s.draft.ratio);
          if(!s.draft.portraitId||!count||!preset||problem)throw Error(problem||'先选择主角和一套搭配，再使用当前工作流测试一张。');
          Object.assign(task,{portraitId:s.draft.portraitId,costumeId:costumes[0],poseId:poses[0],ratio:s.draft.ratio,providerPreset:preset,prompt:this.store.prompt(s.assets[costumes[0]],s.assets[poses[0]],s.draft)});
        }
        await testStore.mutate(()=>{
          testStore.state.assets=structuredClone(s.assets);
          testStore.state.tasks=[task];testStore.state.batch={id,status:'queued',provider,agentHost,providerPreset:task.providerPreset??null};
        });
        const bridge=new AgentBridge(testStore);
        Object.assign(this.active,{store:testStore,bridge});
        const queued=await this.patch(key,id,{status:'queued'});
        if(queued?.status==='cancelled')return {started:false,cancelled:true,id,key};
        if(provider!=='agent'){
          const runner=new GenerationRunner(testStore,{clientFactory:this.runner.clientFactory,runninghub:this.runninghub});
          this.active.runner=runner;
          const active=this.active;
          await runner.start(id);
          void runner.job.then(()=>this.finish(active)).catch(e=>this.patch(key,id,{status:'failed',reason:e.message}));
        }
        return {started:true,id,key};
      }catch(e){await this.patch(key,id,{status:'failed',reason:e.message});throw e;}
    }finally{this.starting=false;}
  }
  owns(taskId){return this.active?.id===taskId&&!!this.active.store;}
  async waiting(){
    if(this.active?.provider!=='agent'||!this.active.store)return null;
    const check=(await this.store.refresh()).generationChecks?.[this.active.key];
    return check&&activeStates.includes(check.status)?this.active:null;
  }
  async busy(){
    const s=await this.store.refresh();
    return Object.values(s.generationChecks||{}).some(c=>activeStates.includes(c.status)&&c.deadline>Date.now());
  }
  async unavailable(reason){
    if(!await this.waiting())return false;
    const active=this.active;
    active.bridge.unavailable(reason);
    await this.patch(active.key,active.id,{status:'failed',reason});return true;
  }
  async cancel(id){
    const active=this.active;
    if(!active||active.id!==id)throw Error('当前测试已变化，请刷新后重试。');
    active.runner?.stop(active.runner.activeRun);
    if(active.store)await active.store.batchAction('cancel');
    await this.patch(active.key,id,{status:'cancelled',reason:'已取消测试。'});
    return {cancelled:true};
  }
  async wait(args,signal){
    const active=await this.waiting();
    if(!active)return null;
    const next=await active.bridge.wait(args,signal);
    if(next.task){
      const scope=JSON.stringify([args.agentName,args.imageTool]);
      await this.patch(active.key,active.id,{status:'running',scope});
    }
    return next;
  }
  async result(taskId,result){
    const active=this.active;
    await active.store.recordResult(taskId,result);active.bridge.finish(taskId);
    if(result.error)await this.patch(active.key,active.id,{status:'failed',reason:result.error});
    else await this.finish(active);
    return this.store.refresh();
  }
  async finish(active=this.active){
    if(!active?.store)return;
    const s=await active.store.refresh(),task=s.tasks.find(t=>t.id===active.id);
    const check=(await this.store.refresh()).generationChecks?.[active.key];
    if(!check||!activeStates.includes(check.status))return;
    if(task?.status==='done'){
      const output=s.assets[task.resultId];
      const {base64}=await active.store.image(output.id);
      const asset=await this.store.putImage(Buffer.from(base64,'base64'),'channel-test.png','check-result');
      await this.patch(active.key,active.id,{status:'verified',resultId:asset.id});
      await this.store.mutate(()=>{this.store.state.channelSetup={provider:active.provider,agentHost:active.agentHost??null,checkedAt:new Date().toISOString()};});
    }else{
      await this.patch(active.key,active.id,{status:'failed',reason:task?.error||s.execution?.message||'测试未返回可回填的图片，请检查生图工具后重试。'});
    }
  }
  async reconcile(){
    if(await this.waiting()){
      await this.active.bridge.reconcile();
      const test=await this.active.store.refresh();
      if(['done','paused'].includes(test.batch?.status))await this.finish();
    }
    const s=await this.store.refresh();
    const pending=Object.values(s.generationChecks||{}).filter(c=>activeStates.includes(c.status));
    for(const c of pending){
      let alive=true;try{process.kill(c.workerPid,0);}catch{alive=false;}
      if(!alive||c.deadline<=Date.now())await this.patch(c.key,c.id,{status:'failed',reason:'测试执行中断或超过 16 分钟。请重新连接渠道，再测试一张。'});
    }
  }
}
