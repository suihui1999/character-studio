import {setTimeout as delay} from 'node:timers/promises';
import {matchesAgentHost} from './generation-models.mjs';

// A connected waiter is an actual HTTP request from an active agent, not a
// promise that an idle desktop chat can be awakened by a browser.
export class AgentBridge{
  constructor(store,{pollMs=200,processingMs=16*60*1000,receiptMs=90000}={}){this.store=store;this.pollMs=pollMs;this.processingMs=processingMs;this.receiptMs=receiptMs;this.connection=null;this.waiting=false;}
  unavailable(reason){if(this.waiting||this.status().connected&&this.connection?.taskId)throw Error('请先结束当前等待或回填已领取任务，再报告能力缺失。');this.unavailableReason=reason;this.connection=null;return this.status();}
  status(){
    const c=this.connection;
    if(!c||c.expiresAt<=Date.now())return {connected:false,phase:'disconnected',...(this.unavailableReason?{reason:this.unavailableReason}:{})};
    return {connected:true,phase:c.phase,agentName:c.agentName,imageTool:c.imageTool,expiresAt:new Date(c.expiresAt).toISOString()};
  }
  finish(taskId){if(this.connection?.taskId===taskId){this.connection=null;}}
  disconnect(sessionId){if(this.connection?.sessionId===sessionId&&this.status().connected&&this.connection.taskId)throw Error('请先回填已领取任务的结果或失败原因，再断开。');if(this.connection?.sessionId===sessionId&&!this.waiting)this.connection=null;return this.status();}
  async reconcile(){
    const expired=s=>s.batch?.provider==='agent'&&s.tasks.find(t=>t.batchId===s.batch.id&&t.status==='running'&&
      (t.agentDeadline||Date.parse(t.startedAt)+this.processingMs)<=Date.now());
    const s=await this.store.refresh();
    if(this.connection?.taskId&&!s.tasks.some(t=>t.id===this.connection.taskId&&t.status==='running'))this.connection=null;
    if(!expired(s))return;
    await this.store.mutate(()=>{
      const s=this.store.state,t=expired(s);
      if(!t)return;
      const message=t.agentAcknowledgedAt||!t.agentDeadline
        ?'Agent 超时未回填结果。重新连接后可继续剩余任务。'
        :'Agent 未在限时内确认收到任务。重新连接后可继续剩余任务。';
      t.status='failed';t.error=message;t.finishedAt=new Date().toISOString();
      s.batch.failedCount=(s.batch.failedCount||0)+1;s.batch.lastError=message;
      if(s.batch.status!=='paused'){
        s.batch.status='paused';s.batch.resumeOnReconnect=true;
        s.execution={batchId:t.batchId,phase:'failed',message};
      }
      this.finish(t.id);
    });
  }
  async acknowledge(taskId){
    const receipt=await this.store.acknowledgeAgentTask(taskId,this.processingMs);
    if(this.connection?.taskId===taskId){
      this.connection.phase='generating';this.connection.expiresAt=receipt.deadline;
    }
    return receipt;
  }
  async wait({sessionId,agentName,imageTool,timeoutMs=45000,renew=false},signal){
    if(this.waiting)throw Error('已有 Agent 正在等待任务，请使用当前连接，不要重复启动。');
    await this.reconcile();
    if(this.waiting)throw Error('已有 Agent 正在等待任务，请使用当前连接，不要重复启动。');
    if(this.status().connected&&this.connection.taskId)throw Error('已有任务在执行，请先回填结果，不要重复领取。');
    if(this.status().connected&&this.connection.sessionId!==sessionId)throw Error('另一个 Agent 正在处理工作台任务，请等待它结束。');
    const c={sessionId,agentName,imageTool,phase:'waiting',expiresAt:Date.now()+timeoutMs+2000};
    this.connection=c;this.waiting=true;this.unavailableReason=null;
    const deadline=Date.now()+timeoutMs;
    try{
      while(Date.now()<deadline){
        signal?.throwIfAborted();
        const test=await this.testWait?.({sessionId,agentName,imageTool,timeoutMs:Math.max(100,deadline-Date.now()),renew},signal);
        if(test)return test;
        const s=await this.store.refresh();
        if(s.batch?.provider==='agent'&&(['queued','running'].includes(s.batch.status)||s.batch.status==='paused'&&s.batch.resumeOnReconnect)){
          if(!matchesAgentHost(s.batch.agentHost,agentName))return {task:null,batch:s.batch,reason:'different_agent'};
          if(s.tasks.some(t=>t.batchId===s.batch.id&&t.status==='running'))return {task:null,batch:s.batch,reason:'busy'};
          const next=await this.store.claimNext(s.batch.id,{receiptMs:this.receiptMs,reconnect:true,agentName});
          if(next.task){
            if(signal?.aborted){
              await this.store.mutate(()=>{
                const s=this.store.state,t=s.tasks.find(t=>t.id===next.task.id&&t.status==='running');
                if(!t||s.batch?.id!==t.batchId)return;
                t.status='pending';delete t.agentDeadline;delete s.execution;
                if(s.batch.status==='running')s.batch.status='queued';
              });
              signal.throwIfAborted();
            }
            c.phase='claimed';c.taskId=next.task.id;c.expiresAt=next.task.agentDeadline;
            return next;
          }
          return {...next,reason:next.batch?.status||'empty'};
        }
        // A manual pause never claims a task. Keep the active
        // agent waiting for the user's Continue button, without generating.
        await delay(Math.min(this.pollMs,Math.max(1,deadline-Date.now())),undefined,{signal});
      }
      if(renew)c.expiresAt=Date.now()+3000;
      return {task:null,reason:'idle'};
    }finally{
      this.waiting=false;
      if(this.connection===c&&!c.taskId&&(!renew||signal?.aborted||Date.now()<deadline))this.connection=null;
    }
  }
}
