import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../src/server.mjs';
import {CodexClient} from '../src/codex-executor.mjs';

const fixture=path.resolve('tests/fixtures/fake-codex.js');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
async function setup(mode='success'){
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-capability-'));
  return createStudio(root,{clientFactory:()=>new CodexClient({launch:()=>({command:process.execPath,args:[fixture,mode]})})});
}
async function call(studio,name,args={}){
  const result=await studio.invoke(name,args);
  assert.equal(result.isError,undefined,result.content?.[0]?.text);
  return result.structuredContent;
}
async function finished(studio,key){
  for(let i=0;i<150;i++){
    const check=(await call(studio,'get_state')).generationChecks?.[key];
    if(check&&['verified','failed'].includes(check.status))return check;
    await delay(30);
  }
  throw Error('Fixture test did not finish');
}
test('login and executor handshake do not confirm image generation, a real returned image does',async()=>{
  const studio=await setup();
  const probe=await call(studio,'execution_status',{provider:'codex'});
  assert.equal(probe.account,'confirmed');assert.equal(probe.executor,true);assert.equal(probe.capability,'unknown');
  assert.equal((await call(studio,'get_state')).batch,null);
  await call(studio,'test_generation',{provider:'codex'});
  const check=await finished(studio,'codex');assert.equal(check.status,'verified');
  const after=await call(studio,'get_state');
  assert.equal(after.batch,null);assert.deepEqual(after.tasks,[]);assert.equal(after.draft.portraitId,null);
  assert.ok(after.assets[check.resultId]);
  assert.equal((await call(studio,'execution_status',{provider:'codex'})).capability,'confirmed');
});
test('missing image tool is exposed before any batch is submitted',async()=>{
  const studio=await setup('unavailable');
  await call(studio,'test_generation',{provider:'codex'});
  const check=await finished(studio,'codex');
  assert.equal(check.status,'failed');assert.match(check.reason,/没有可用的内置生图工具/);
  const probe=await call(studio,'execution_status',{provider:'codex'});
  assert.equal(probe.executor,true);assert.equal(probe.capability,'failed');
  assert.equal((await call(studio,'get_state')).tasks.length,0);
});
test('native Agent test follows wait, ack, result without replacing selected images or tasks',async()=>{
  const studio=await setup();
  const portrait=await call(studio,'upload_character',{name:'protocol-fixture.png',base64:png});
  const before=(await call(studio,'get_state')).draft;
  await call(studio,'test_generation',{provider:'agent',agentHost:'doubao'});
  const wrong=await call(studio,'agent_wait',{sessionId:'wrong',agentName:'Codex',imageTool:'protocol-fixture-only',timeoutMs:100});
  assert.equal(wrong.task,null);
  const next=await call(studio,'agent_wait',{sessionId:'doubao-test',agentName:'豆包工作',imageTool:'protocol-fixture-only',timeoutMs:100});
  assert.equal(next.task.isCapabilityTest,true);assert.deepEqual(next.task.references,[]);
  await call(studio,'agent_ack_task',{taskId:next.task.id});
  await call(studio,'record_result',{taskId:next.task.id,base64:png});
  const s=await call(studio,'get_state');
  assert.deepEqual(s.draft,before);assert.equal(s.draft.portraitId,portrait.id);assert.equal(s.batch,null);assert.equal(s.tasks.length,0);
  assert.equal(s.generationChecks['agent:doubao'].status,'verified');
});
test('paid test requires a separate explicit confirmation and preserves state on rejection',async()=>{
  const studio=await setup();
  const rejected=await studio.invoke('test_generation',{provider:'image-openai'});
  assert.equal(rejected.isError,true);assert.match(rejected.content[0].text,/产生费用/);
  assert.equal((await call(studio,'get_state')).generationChecks,undefined);
});
test('two simultaneous test requests start at most one isolated job',async()=>{
  const studio=await setup('delayed');
  const requests=await Promise.all([studio.invoke('test_generation',{provider:'codex'}),studio.invoke('test_generation',{provider:'codex'})]);
  assert.equal(requests.filter(r=>!r.isError).length,1);
  await finished(studio,'codex');
});
test('an already waiting Agent receives an isolated test and returns exact bytes',async()=>{
  const studio=await setup();
  const pending=call(studio,'agent_wait',{sessionId:'waiting-test',agentName:'豆包工作',imageTool:'protocol-fixture-only',timeoutMs:3000});
  await delay(50);
  await call(studio,'test_generation',{provider:'agent',agentHost:'doubao'});
  const next=await pending;assert.equal(next.task.isCapabilityTest,true);
  await call(studio,'agent_ack_task',{taskId:next.task.id});
  await call(studio,'record_result',{taskId:next.task.id,base64:png});
  assert.equal((await call(studio,'get_state')).generationChecks['agent:doubao'].status,'verified');
});
test('cancelling a queued native test releases the channel and preserves the draft',async()=>{
  const studio=await setup();
  const before=(await call(studio,'get_state')).draft;
  const test=await call(studio,'test_generation',{provider:'agent',agentHost:'doubao'});
  await call(studio,'cancel_generation_test',{testId:test.id});
  const s=await call(studio,'get_state');assert.equal(s.generationChecks['agent:doubao'].status,'cancelled');
  assert.deepEqual(s.draft,before);assert.equal(s.batch,null);
});
test('late completion of a cancelled test cannot overwrite a newer test',async()=>{
  const studio=await setup('delayed');
  const first=await call(studio,'test_generation',{provider:'codex'});
  await call(studio,'cancel_generation_test',{testId:first.id});
  const next=await call(studio,'test_generation',{provider:'codex'});
  const check=await finished(studio,'codex');
  assert.equal(check.id,next.id);assert.equal(check.status,'verified');
});
