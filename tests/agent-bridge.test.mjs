import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Store} from '../src/store.mjs';
import {AgentBridge} from '../src/agent-bridge.mjs';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const input={sessionId:'session-a',agentName:'protocol fixture',imageTool:'fixture-only',timeoutMs:5000};
async function setup(options={}){
  const store=await new Store(await mkdtemp(path.join(os.tmpdir(),'studio-bridge-'))).init();const portrait=await store.putImage(PNG,'fixture.png');
  const refs=[];for(const kind of ['costume','pose'])refs.push(await store.addReference({kind,id:kind,name:'日常测试',url:`https://${kind==='pose'?'ai-pose-depth-gallery':'ai-costume-gallery'}.pages.dev/img/fixture.png`}));
  await store.mutate(()=>{for(const r of refs)store.state.assets[r.id].path=portrait.path;});
  await store.saveDraft({provider:'agent',costumeIds:[refs[0].id],poseIds:[refs[1].id]});await store.buildQueue();
  return {store,bridge:new AgentBridge(store,{pollMs:10,...options})};
}
test('an active waiter receives a newly submitted task with three local references',async()=>{
  const {store,bridge}=await setup();const waiting=bridge.wait(input);await delay(20);assert.equal(bridge.status().connected,true);await store.batchAction('start');
  const result=await waiting;assert.equal(result.task.status,'running');assert.deepEqual(result.task.references.map(r=>r.kind),['portrait','costume','pose']);
  await assert.rejects(bridge.wait(input),/先回填/);await store.recordResult(result.task.id,{base64:PNG.toString('base64')});bridge.finish(result.task.id);assert.equal(bridge.status().connected,false);
});
test('paused batches do not generate; Continue wakes the waiter',async()=>{
  const {store,bridge}=await setup();await store.mutate(()=>store.state.tasks.push({...store.state.tasks[0],id:'second'}));await store.batchAction('start');
  const first=await bridge.wait(input);await store.batchAction('pause');await store.recordResult(first.task.id,{base64:PNG.toString('base64')});bridge.finish(first.task.id);assert.equal((await store.refresh()).batch.status,'paused');
  const waiting=bridge.wait(input);await delay(40);assert.equal((await store.refresh()).tasks.find(t=>t.id==='second').attempts,0);await store.batchAction('continue');assert.equal((await waiting).task.id,'second');
});
test('aborting a waiter releases the connection and never claims a draft task',async()=>{
  const {store,bridge}=await setup();const controller=new AbortController();const waiting=bridge.wait(input,controller.signal);await delay(20);controller.abort();await assert.rejects(waiting);assert.equal(bridge.status().connected,false);assert.equal((await store.refresh()).tasks[0].attempts,0);
});
test('a native generation that never returns becomes a visible paused failure',async()=>{
  const {store,bridge}=await setup({processingMs:10});await store.batchAction('start');const next=await bridge.wait(input);await delay(25);await bridge.reconcile();
  const state=await store.refresh();assert.equal(state.batch.status,'paused');assert.equal(state.tasks.find(t=>t.id===next.task.id).status,'failed');assert.match(state.execution.message,/超时未回填/);assert.equal(bridge.status().connected,false);
});
test('idle and cancelled queues never claim; an unavailable tool is reported honestly',async()=>{
  const {store,bridge}=await setup();await store.batchAction('cancel');assert.equal((await bridge.wait({...input,timeoutMs:50})).reason,'idle');assert.equal((await store.refresh()).tasks[0].attempts,0);
  assert.match(bridge.unavailable('没有原生生图工具').reason,/没有原生/);
});
