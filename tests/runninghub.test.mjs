import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {Store} from '../src/store.mjs';
import {ProviderCredentials} from '../src/provider-credentials.mjs';
import {RunningHubClient} from '../src/runninghub-client.mjs';
import {GenerationRunner} from '../src/codex-executor.mjs';
import {remoteId,parseExample,importedNodes,validatePreset} from '../src/generation-models.mjs';
import {fakeRunningHub,PNG,KEYS,NODES} from './fixtures/fake-runninghub.mjs';
async function setup(t,provider='runninghub-cn',kind='app',mode='success'){
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-personal-')),store=await new Store(root).init();const remote=await fakeRunningHub({mode});t.after(()=>remote.close());
  const credentials=new ProviderCredentials(store,{env:{}});await credentials.save({[provider]:KEYS[provider]});
  const client=new RunningHubClient(credentials,{origins:remote.origins,pollMs:5,timeoutMs:1000});
  const imported=await client.inspect({provider,kind,link:'1877265245566922753'});
  const roles=['portrait','costume','pose','prompt','ratio','fixed'];imported.nodes.forEach((n,i)=>n.source=roles[i]);
  const preset=await store.saveProviderPreset({...imported,name:'Personal fixture'});
  const portrait=await store.putImage(PNG,'fixture.png'),c=await store.addReference({id:'c',kind:'costume',name:'fixture costume',url:'https://ai-costume-gallery.pages.dev/img/c.webp'}),p=[];
  for(const id of ['p1','p2'])p.push(await store.addReference({id,kind:'pose',name:'fixture pose',url:'https://ai-pose-depth-gallery.pages.dev/img/'+id+'.png'}));
  await store.mutate(()=>{for(const asset of [c,...p])store.state.assets[asset.id].path=portrait.path;});
  await store.saveDraft({provider,providerPresetId:preset.id,costumeIds:[c.id],poseIds:p.map(x=>x.id),mode:'all'});await store.buildQueue();await store.batchAction('start');
  const runner=new GenerationRunner(store,{runninghub:client,clientFactory:()=>{throw Error('RunningHub must never start Codex or switch channels');}});t.after(()=>runner.stop(runner.activeRun));return {store,remote,credentials,client,preset,runner};
}
test('consumer AI apps and workflows upload three references and persist actual response bytes on both sites',async t=>{
  for(const [provider,kind]of [['runninghub-cn','app'],['runninghub-global','workflow']]){
    const {store,runner,remote,preset}=await setup(t,provider,kind);await runner.start();await runner.job;const s=await store.refresh();
    assert.equal(s.batch.status,'done');assert.equal(s.tasks.length,2);assert.ok(s.tasks.every(t=>t.status==='done'&&t.remoteTaskId));assert.equal(remote.submitted.length,2);
    for(const task of s.tasks){assert.deepEqual(await readFile(s.assets[task.resultId].path),PNG);assert.equal(task.providerPreset.name,preset.name);}
    assert.equal(remote.requests.filter(r=>r.path==='/task/openapi/upload').length,6);
    const sent=remote.submitted[0].body;assert.equal(sent[kind==='app'?'webappId':'workflowId'],'1877265245566922753');assert.equal(sent.apiKey,KEYS[provider]);
    assert.equal(sent.nodeInfoList.find(n=>n.nodeId==='4').fieldValue,s.tasks[0].prompt);assert.deepEqual(sent.nodeInfoList.slice(0,3).map(n=>n.fieldValue),['api/upload-1.png','api/upload-2.png','api/upload-3.png']);
    assert.ok(remote.requests.filter(r=>r.path==='/result.png').every(r=>!r.authorization),'CDN download must not receive API key');
    assert.ok(!remote.requests.some(r=>r.path.includes('rhart-image')),'consumer keys must not use enterprise model APIs');
  }
});
test('consumer task rejection is visible and skips forward to the next independent task',async t=>{
  const {store,runner,remote}=await setup(t,'runninghub-cn','app','reject-first');await runner.start();await runner.job;const s=await store.refresh();assert.equal(s.batch.failedCount,1);assert.match(s.batch.lastError,/moderation_blocked.*remote-1/);assert.equal(s.tasks[0].status,'done');assert.equal(remote.submitted.length,2);
});
test('personal credentials survive reopening, never enter snapshots, and remain separated by site',async t=>{
  const {store,credentials}=await setup(t);assert.equal(await new ProviderCredentials(store,{env:{}}).key('runninghub-cn'),KEYS['runninghub-cn']);
  await assert.rejects(credentials.key('runninghub-global'),/尚未配置/);assert.ok(!JSON.stringify(await store.refresh()).includes(KEYS['runninghub-cn']));
  if(process.platform==='win32')assert.ok(!(await readFile(credentials.file,'utf8')).includes(KEYS['runninghub-cn']));
  await credentials.save({'runninghub-cn':''});assert.equal((await credentials.status())['runninghub-cn'].configured,false);
});
test('provider errors redact credentials and pause on authentication failure',async t=>{
  const {store,runner,remote}=await setup(t);remote.requests.length=0;runner.runninghub.origins['runninghub-cn']=runner.runninghub.origins['runninghub-global'];
  await runner.start();await runner.job;const s=await store.refresh();assert.equal(s.batch.status,'paused');assert.match(s.execution.message,/401/);assert.ok(!JSON.stringify(s).includes(KEYS['runninghub-cn']));assert.equal(remote.submitted.length,0);
});
test('poll timeout preserves remote task ID and never resubmits that task',async t=>{
  const {store,client,remote}=await setup(t,'runninghub-cn','app','hanging');client.timeoutMs=25;const task=(await store.claimNext()).task;
  await assert.rejects(client.generate(task),/超过.*remote-1/);assert.equal(remote.submitted.length,1);
});
test('batch snapshots keep provider presets stable when a draft or saved preset changes',async t=>{
  const {store,preset}=await setup(t);await store.saveProviderPreset({...preset,name:'Changed preset'});await store.saveDraft({provider:'codex'});await store.deleteProviderPreset(preset.id);
  const task=(await store.claimNext()).task;assert.equal(task.provider,'runninghub-cn');assert.equal(task.providerPreset.name,'Personal fixture');
});
test('import treats cURL as data, preserves long IDs, and rejects missing reference mappings',()=>{
  const parsed=parseExample('curl --data-raw \'{"apiKey":"not-saved","webappId":1877265245566922753,"nodeInfoList":'+JSON.stringify(NODES)+'}\'');assert.equal(parsed.webappId,'1877265245566922753');
  const nodes=importedNodes(parsed,'app');assert.ok(!JSON.stringify(nodes).includes('not-saved'));assert.throws(()=>validatePreset({provider:'runninghub-cn',kind:'app',remoteId:'123',name:'bad',nodes}),/任务提示词/);
  assert.throws(()=>remoteId('runninghub-cn','https://www.runninghub.ai/ai-detail/123'),/不同/);assert.throws(()=>remoteId('runninghub-cn','http://localhost/123'),/不同/);
});

test('provider response text cannot echo an API key into the workbench',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-key-redaction-')),store=await new Store(root).init(),remote=await fakeRunningHub({mode:'leaked-error'});t.after(()=>remote.close());
  const credentials=new ProviderCredentials(store,{env:{RUNNINGHUB_CN_API_KEY:KEYS['runninghub-cn']}}),client=new RunningHubClient(credentials,{origins:remote.origins});
  const result=await client.probe('runninghub-cn');assert.equal(result.available,false);assert.match(result.reason,/Key 已隐藏/);assert.ok(!result.reason.includes(KEYS['runninghub-cn']));
});

test('cancelling a personal batch stops local polling and leaves remaining tasks unsubmitted',async t=>{
  const {store,runner,remote}=await setup(t,'runninghub-cn','app','hanging');await runner.start();const job=runner.job;
  for(let i=0;i<150;i++){if((await store.refresh()).tasks.some(t=>t.remoteTaskId))break;await new Promise(r=>setTimeout(r,10));}
  await store.batchAction('cancel');await job;const state=await store.refresh();assert.equal(state.batch.status,'cancelled');assert.ok(state.tasks.every(t=>t.status==='cancelled'));assert.equal(remote.submitted.length,1);
});

test('connection probe tests an unsaved key and reports 806 without changing the saved key',async t=>{
  const {client,credentials}=await setup(t);const result=await client.probe('runninghub-cn','not-found-fixture');assert.equal(result.available,false);assert.equal(result.code,'806');assert.match(result.reason,/未找到.*用户/);
  assert.equal(await credentials.key('runninghub-cn'),KEYS['runninghub-cn']);assert.equal((await client.probe('runninghub-cn')).available,true);
});

test('connection probes return a readable timeout instead of waiting indefinitely',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-probe-timeout-')),store=await new Store(root).init(),remote=await fakeRunningHub({accountDelayMs:200});t.after(()=>remote.close());
  const credentials=new ProviderCredentials(store,{env:{RUNNINGHUB_CN_API_KEY:KEYS['runninghub-cn']}}),client=new RunningHubClient(credentials,{origins:remote.origins,probeTimeoutMs:30});
  const result=await client.probe('runninghub-cn');assert.equal(result.available,false);assert.match(result.reason,/超时/);assert.ok(!JSON.stringify(result).includes(KEYS['runninghub-cn']));
});
