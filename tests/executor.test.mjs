import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexClient,GenerationRunner} from '../src/codex-executor.mjs';
import {Store} from '../src/store.mjs';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const fixture=path.resolve('tests/fixtures/fake-codex.js');
async function setup(mode='success',execution='sample'){
  const root=await mkdtemp(path.join(os.tmpdir(),'character-executor-test-')),store=await new Store(root).init();
  const portrait=await store.putImage(PNG,'fixture.png');
  const costume=await store.addReference({id:'c',kind:'costume',name:'普通服装测试',url:'https://ai-costume-gallery.pages.dev/img/c.webp'});
  const poses=[];for(const id of ['p1','p2'])poses.push(await store.addReference({id,kind:'pose',name:'站姿测试',url:'https://ai-pose-depth-gallery.pages.dev/img/'+id+'.png'}));
  await store.mutate(()=>{for(const a of [costume,...poses])store.state.assets[a.id].path=portrait.path;});
  await store.saveDraft({mode:execution,costumeIds:[costume.id],poseIds:poses.map(p=>p.id)});await store.buildQueue();await store.batchAction('start');
  const runner=new GenerationRunner(store,{clientFactory:()=>new CodexClient({launch:()=>({command:process.execPath,args:[fixture,mode]})})});return {store,runner};
}
test('automatic executor performs protocol round-trip, persists result, stops at sample gate',async()=>{
  const {store,runner}=await setup();const started=await runner.start();assert.equal(started.started,true);await runner.job;
  const state=await store.refresh();assert.equal(state.batch.status,'awaiting-approval');assert.equal(state.tasks.filter(t=>t.status==='done').length,1);assert.equal(state.tasks.filter(t=>t.status==='pending').length,1);
  const result=state.assets[state.tasks.find(t=>t.status==='done').resultId];assert.deepEqual(await readFile(result.path),PNG);
});
test('double click starts only one executor; whole batch finishes once',async()=>{
  const {store,runner}=await setup('success','all');const responses=await Promise.all([runner.start(),runner.start()]);assert.equal(responses.filter(r=>r.alreadyRunning).length,1);await runner.job;
  const state=await store.refresh();assert.equal(state.batch.status,'done');assert.ok(state.tasks.every(t=>t.status==='done'&&t.attempts===1));
});
test('a rejected task is skipped and the next independent task succeeds without retry',async()=>{
  const {store,runner}=await setup('first-rejected','all');const ids=store.state.tasks.map(t=>t.id);await runner.start();await runner.job;const state=await store.refresh();
  assert.equal(state.batch.status,'done');assert.equal(state.batch.failedCount,1);assert.match(state.batch.lastError,/moderation_blocked/);
  assert.ok(!state.tasks.some(t=>t.id===ids[0]));assert.equal(state.tasks.find(t=>t.id===ids[1]).status,'done');assert.equal(state.tasks.find(t=>t.id===ids[1]).attempts,1);
  assert.match(state.execution.message,/跳过 1 个失败任务/);
});

test('a fully rejected batch finishes after attempting each task once, then clears failed history',async()=>{
  const {store,runner}=await setup('rejected','all');await runner.start();await runner.job;const state=await store.refresh();
  assert.equal(state.batch.status,'done');assert.equal(state.batch.failedCount,2);assert.match(state.batch.lastError,/moderation_blocked/);assert.equal(state.tasks.length,0);assert.ok(!Object.values(state.assets).some(a=>a.kind==='result'));
});
test('missing built-in generator is a visible task failure, never a placeholder',async()=>{
  const {store,runner}=await setup('unavailable');await runner.start();await runner.job;const state=await store.refresh();assert.equal(state.batch.failedCount,2);assert.match(state.execution.message,/内置生图工具/);assert.equal(state.batch.status,'done');assert.ok(!Object.values(state.assets).some(a=>a.kind==='result'));
});

test('sample mode skips a failed first task, then waits for approval of the first successful sample',async()=>{
  const {store,runner}=await setup('first-rejected');await store.mutate(()=>store.state.tasks.push({...store.state.tasks[1],id:'third-task'}));
  await runner.start();await runner.job;const state=await store.refresh();assert.equal(state.batch.status,'awaiting-approval');assert.equal(state.batch.failedCount,1);assert.equal(state.tasks.filter(t=>t.status==='done').length,1);assert.equal(state.tasks.filter(t=>t.status==='pending').length,1);
  assert.equal(state.tasks.find(t=>t.status==='failed').attempts,1);
});

test('pause or cancel during a failed task still stops the next task',async()=>{
  for(const action of ['pause','cancel']){
    const {store,runner}=await setup('delayed-rejected','all');await runner.start();
    for(let i=0;i<100;i++){if((await store.refresh()).execution?.phase==='generating')break;await new Promise(r=>setTimeout(r,10));}
    await store.batchAction(action);await runner.job;const state=await store.refresh();assert.equal(state.batch.status,action==='pause'?'paused':'cancelled');assert.equal(state.tasks[1]?.attempts??state.tasks[0].attempts,0);
  }
});

test('executor connection loss stops the batch instead of claiming more tasks',async()=>{
  const {store,runner}=await setup('crash','all');await runner.start();await runner.job;const state=await store.refresh();assert.equal(state.batch.status,'paused');assert.equal(state.tasks[0].status,'failed');assert.equal(state.tasks[1].attempts,0);
});
test('login failure is shown without asking for or switching to an API key',async()=>{
  const {store,runner}=await setup('notloggedin');await runner.start();await runner.job;const state=await store.refresh();assert.match(state.tasks[0].error,/登录/);assert.equal(state.tasks[0].attempts,0);assert.equal(state.execution.phase,'failed');
});
test('pause during a generation retains current result and does not start the next task',async()=>{
  const {store,runner}=await setup('delayed','all');await runner.start();
  for(let i=0;i<100;i++){if((await store.refresh()).tasks[0].status==='running')break;await new Promise(r=>setTimeout(r,10));}
  await store.batchAction('pause');await runner.job;const state=await store.refresh();assert.equal(state.batch.status,'paused');assert.equal(state.tasks[0].status,'done');assert.equal(state.tasks[1].status,'pending');
});
test('an already paused batch is never started automatically',async()=>{
  const {store,runner}=await setup();await store.batchAction('pause');await assert.rejects(runner.start(),/没有已提交/);assert.equal(store.state.tasks[0].attempts,0);
});

test('a cancelled hanging generation cannot block a newly submitted batch',{timeout:5000},async t=>{
  const {store,runner}=await setup('hanging','all');t.after(()=>runner.stop(runner.activeRun));await runner.start();const oldJob=runner.job;
  for(let i=0;i<100;i++){if((await store.refresh()).execution?.phase==='generating')break;await new Promise(r=>setTimeout(r,10));}
  await store.batchAction('cancel');await store.buildQueue();await store.batchAction('start');
  runner.clientFactory=()=>new CodexClient({launch:()=>({command:process.execPath,args:[fixture,'success']})});
  const launched=await runner.start();assert.ok(!launched.alreadyRunning,'new batch must get its own executor');
  await runner.job;await oldJob;const state=await store.refresh();assert.equal(state.batch.status,'done');assert.equal(state.tasks.filter(t=>t.status==='done').length,2);assert.ok(state.tasks.every(t=>t.attempts===1));
});

test('cancel releases a hanging worker without waiting for its 15-minute timeout',async()=>{
  const {store,runner}=await setup('hanging','all');await runner.start();const job=runner.job;
  for(let i=0;i<100;i++){if((await store.refresh()).execution?.phase==='generating')break;await new Promise(r=>setTimeout(r,10));}
  await store.batchAction('cancel');await job;
  const state=await store.refresh();assert.equal(state.batch.status,'cancelled');assert.ok(state.tasks.every(t=>t.status==='cancelled'));assert.equal(runner.job,null);
});
