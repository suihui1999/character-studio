import {setTimeout as delay} from 'node:timers/promises';

// A connected waiter is an actual HTTP request from an active agent, not a
// promise that an idle desktop chat can be awakened by a browser.
export class AgentBridge{
  constructor(store,{pollMs=200,processingMs=16*60*1000}={}){this.store=store;this.pollMs=pollMs;this.processingMs=processingMs;this.connection=null;this.waiting=false;}
  unavailable(reason){if(this.waiting||this.connection?.phase==='generating')throw Error('请先结束当前等待或回填已领取任务，再报告能力缺失。');this.unavailableReason=reason;this.connection=null;return this.status();}
  status(){
    const c=this.connection;
    if(!c||c.expiresAt<=Date.now())return {connected:false,phase:'disconnected',...(this.unavailableReason?{reason:this.unavailableReason}:{})};
    return {connected:true,phase:c.phase,agentName:c.agentName,imageTool:c.imageTool,expiresAt:new Date(c.expiresAt).toISOString()};
  }
  finish(taskId){if(this.connection?.taskId===taskId){this.connection=null;}}
  disconnect(sessionId){if(this.connection?.sessionId===sessionId&&this.connection.phase==='generating')throw Error('请先回填已领取任务的结果或失败原因，再断开。');if(this.connection?.sessionId===sessionId&&!this.waiting)this.connection=null;return this.status();}
  async reconcile(){
    const c=this.connection;if(!c||c.phase!=='generating'||c.expiresAt>Date.now())return;
    this.connection=null;
    await this.store.mutate(()=>{const s=this.store.state,t=s.tasks.find(t=>t.id===c.taskId&&t.status==='running');if(!t||s.batch?.id!==t.batchId)return;const message='当前 Agent 超时未回填结果，请检查聊天是否仍在运行。任务没有自动重试。';t.status='failed';t.error=message;t.finishedAt=new Date().toISOString();s.batch.failedCount=(s.batch.failedCount||0)+1;s.batch.lastError=message;if(s.batch.status!=='cancelled')s.batch.status='paused';s.execution={batchId:t.batchId,phase:'failed',message,updatedAt:new Date().toISOString()};});
  }
  async wait({sessionId,agentName,imageTool,timeoutMs=45000},signal){
    if(this.waiting)throw Error('已有 Agent 正在等待任务，请使用当前连接，不要重复启动。');
    await this.reconcile();
    if(this.connection?.phase==='generating')throw Error('已有任务在生成，请先回填结果，不要重复领取。');
    if(this.status().connected&&this.connection.sessionId!==sessionId)throw Error('另一个 Agent 正在处理工作台任务，请等待它结束。');
    const c={sessionId,agentName,imageTool,phase:'waiting',expiresAt:Date.now()+timeoutMs+2000};
    this.connection=c;this.waiting=true;this.unavailableReason=null;
    const deadline=Date.now()+timeoutMs;
    try{
      while(Date.now()<deadline){
        signal?.throwIfAborted();
        const s=await this.store.refresh();
        if(s.batch?.provider==='agent'&&['queued','running'].includes(s.batch.status)){
          if(s.tasks.some(t=>t.batchId===s.batch.id&&t.status==='running'))return {task:null,batch:s.batch,reason:'busy'};
          const next=await this.store.claimNext(s.batch.id);
          if(next.task){
            if(signal?.aborted){await this.store.mutate(()=>{if(this.store.state.batch?.id===next.task.batchId)this.store.state.batch.status='paused';});await this.store.recordResult(next.task.id,{error:'Agent 在参考图准备期间断开，请重新连接后继续。'});signal.throwIfAborted();}
            c.phase='generating';c.taskId=next.task.id;c.expiresAt=Date.now()+this.processingMs;
            await this.store.mutate(()=>{if(this.store.state.batch?.id===next.task.batchId)this.store.state.execution={batchId:next.task.batchId,phase:'generating',message:'已交给 '+agentName+' 生成，请等待真实图片返回。',updatedAt:new Date().toISOString()};});
            return next;
          }
          return {...next,reason:next.batch?.status||'empty'};
        }
        // A manual pause never claims a task. Keep the active
        // agent waiting for the user's Continue button, without generating.
        await delay(Math.min(this.pollMs,Math.max(1,deadline-Date.now())),undefined,{signal});
      }
      return {task:null,reason:'idle'};
    }finally{
      this.waiting=false;
      if(this.connection===c&&c.phase!=='generating')this.connection=null;
    }
  }
}
