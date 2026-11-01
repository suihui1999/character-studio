import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudio} from '../src/server.mjs';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
async function setup(){
  let codexCalls=0;
  const studio=await createStudio(await mkdtemp(path.join(os.tmpdir(),'studio-host-')),{clientFactory:()=>{codexCalls++;throw Error('must not launch Codex');}});
  const call=async(name,args={})=>{const r=await studio.invoke(name,args);assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
  await call('open_workbench',{executor:'agent'});
  const portrait=await studio.store.putImage(PNG,'fixture.png');
  const refs=[];for(const kind of ['costume','pose'])refs.push(await studio.store.addReference({id:kind,kind,name:'普通站姿 / 日常服装',url:`https://${kind==='pose'?'ai-pose-depth-gallery':'ai-costume-gallery'}.pages.dev/img/fixture.png`}));
  await studio.store.mutate(()=>{for(const ref of refs)studio.store.state.assets[ref.id].path=portrait.path;});
  await studio.store.saveDraft({costumeIds:[refs[0].id],poseIds:[refs[1].id]});await call('build_queue');await call('control_batch',{action:'start'});
  return {studio,call,codexCalls:()=>codexCalls};
}
test('host native task can be claimed and real result bytes recorded without a Codex or RH executor',async()=>{
  const {studio,call,codexCalls}=await setup();
  const probe=await studio.runner.probe('agent');assert.equal(probe.available,false);
  await assert.rejects(studio.runner.start(),/当前 Agent/);assert.equal(codexCalls(),0);assert.equal(studio.runner.job,null);
  const claimed=await call('claim_next_task');assert.equal(claimed.task.provider,'agent');assert.equal(claimed.task.providerPreset,null);
  assert.deepEqual(claimed.task.references.map(r=>r.kind),['portrait','costume','pose']);
  await call('record_result',{taskId:claimed.task.id,base64:PNG.toString('base64')});
  const state=await call('get_state'),task=state.tasks.find(t=>t.id===claimed.task.id);
  assert.equal(task.status,'done');assert.deepEqual(await readFile(state.assets[task.resultId].path),PNG);assert.equal(codexCalls(),0);
});
test('opening with a new executor changes only the next draft; submitted native batch stays native',async()=>{
  const {call}=await setup();const s=await call('open_workbench',{executor:'codex'});
  assert.equal(s.draft.provider,'codex');assert.equal(s.batch.provider,'agent');assert.equal((await call('claim_next_task')).task.provider,'agent');
});
test('dispatch failure pauses only the matching unclaimed batch and survives reload',async()=>{
  const {studio,call}=await setup();const state=await call('get_state');
  await call('report_dispatch_error',{batchId:'stale-batch',error:'stale'});assert.equal((await call('get_state')).batch.status,'queued');
  await call('report_dispatch_error',{batchId:state.batch.id,error:'宿主未开放生图工具'});
  const reloaded=await createStudio(studio.store.root);await reloaded.store.refresh();assert.equal(reloaded.store.state.batch.status,'paused');assert.match(reloaded.store.state.execution.message,/未开放/);
  assert.equal((await call('claim_next_task')).task,null);assert.ok(reloaded.store.state.tasks.every(t=>t.attempts===0));
});
test('late dispatch failure cannot interrupt an already claimed task',async()=>{
  const {call}=await setup();const claimed=await call('claim_next_task');
  const s=await call('report_dispatch_error',{batchId:claimed.batch.id,error:'late failure'});assert.equal(s.batch.status,'running');assert.equal(s.tasks[0].status,'running');
});
