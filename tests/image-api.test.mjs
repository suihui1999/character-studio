import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {Store} from '../src/store.mjs';
import {ProviderCredentials} from '../src/provider-credentials.mjs';
import {ImageApiClient} from '../src/image-api-client.mjs';
import {GenerationRunner} from '../src/codex-executor.mjs';
import {createStudio} from '../src/server.mjs';
import {IMAGE_API_PRESETS,validateImageApiPreset} from '../src/image-api-presets.mjs';
import {outputRatios,PROVIDERS} from '../src/generation-models.mjs';
import {fakeImageApi,KEYS,PNG} from './fixtures/fake-image-api.mjs';

async function setup(t,provider='image-openai',mode='success',partial=false){
  const store=await new Store(await mkdtemp(path.join(os.tmpdir(),'studio-image-api-'))).init(),remote=await fakeImageApi({mode});t.after(()=>remote.close());
  const credentials=new ProviderCredentials(store,{env:{}});await credentials.save({[provider]:KEYS[provider]});
  if(provider==='image-custom')await store.saveImageApiConfig({baseUrl:'https://fixture.example/v1',model:'custom-test-model',protocol:'openai-multipart'});
  const client=new ImageApiClient(credentials,{origins:remote.origins});
  const portrait=await store.putImage(PNG,'test-character.png'),costume=await store.addReference({id:'dress',name:'dress',kind:'costume',url:'https://ai-costume-gallery.pages.dev/img/dress.png'}),poses=[];
  for(const id of ['front','side'])poses.push(await store.addReference({id,name:id,kind:'pose',url:'https://ai-pose-depth-gallery.pages.dev/img/'+id+'.png'}));
  await store.mutate(()=>{for(const ref of [costume,...poses])Object.assign(store.state.assets[ref.id],{path:portrait.path,mime:'image/png'});});
  await store.saveDraft({provider,costumeIds:partial?[]:[costume.id],poseIds:poses.map(p=>p.id)});await store.buildQueue();await store.batchAction('start');
  const runner=new GenerationRunner(store,{runninghub:client,clientFactory:()=>{throw Error('API must not use Agent or Codex');}});t.after(()=>runner.stop(runner.activeRun));
  return {store,remote,credentials,client,runner};
}
test('all image API adapters preserve exact result bytes and send portrait, costume and pose in order',async t=>{
  for(const provider of Object.keys(KEYS)){
    const {store,remote,runner}=await setup(t,provider);await runner.start();await runner.job;
    const s=await store.refresh();assert.equal(s.batch.status,'done');assert.equal(s.tasks.length,2);assert.ok(s.tasks.every(t=>t.status==='done'));assert.equal(remote.submitted.length,2);
    for(const task of s.tasks)assert.deepEqual(await readFile(s.assets[task.resultId].path),PNG);
    const sent=remote.submitted[0];
    if(provider==='image-openai'){assert.equal(sent.route,'/images/edits');assert.equal(sent.body.images.length,3);assert.equal(sent.body.n,1);assert.equal(sent.body.size,'1152x1536');assert.equal(sent.body.prompt,s.tasks[0].prompt);}
    if(provider==='image-gemini'){assert.match(sent.route,/:generateContent$/);assert.equal(sent.body.contents[0].parts.length,4);assert.equal(sent.body.generationConfig.imageConfig.aspectRatio,'3:4');}
    if(provider==='image-seedream'){assert.equal(sent.body.image.length,3);assert.equal(sent.body.sequential_image_generation,'disabled');assert.equal(sent.body.watermark,true);const [w,h]=sent.body.size.split('x').map(Number);assert.equal(w/h,3/4);assert.ok(w*h>=3686400);}
    if(provider==='image-custom'){assert.equal((sent.raw.match(/name="image\[\]"/g)||[]).length,3);assert.match(sent.raw,/custom-test-model/);}
  }
});
test('partial references send only existing images and preserve original clothing',async t=>{
  const {store,remote,runner}=await setup(t,'image-openai','success',true);await runner.start();await runner.job;
  assert.equal(remote.submitted[0].body.images.length,2);assert.match(remote.submitted[0].body.prompt,/保留主角原图的服装/);assert.equal((await store.refresh()).batch.status,'done');
});
test('non-billable model checks do not generate, save an unsaved key or verify image capability',async t=>{
  const {client,remote,credentials,store}=await setup(t);const before=await store.refresh();
  assert.equal((await client.probe('image-openai',KEYS['image-openai'],before.batch.providerPreset)).available,true);
  const failed=await client.probe('image-openai','invalid-secret',before.batch.providerPreset);
  assert.equal(failed.available,false);assert.match(failed.reason,/401/);assert.ok(!failed.reason.includes('invalid-secret'));assert.equal(remote.submitted.length,0);assert.equal(await credentials.key('image-openai'),KEYS['image-openai']);
});
test('a rejected API combination is skipped and the next task runs without resubmission',async t=>{
  const {store,remote,runner}=await setup(t,'image-openai','reject-first');await runner.start();await runner.job;const s=await store.refresh();
  assert.equal(s.batch.status,'done');assert.equal(s.batch.failedCount,1);assert.match(s.batch.lastError,/moderation rejection/);assert.equal(remote.submitted.length,2);assert.equal(s.tasks.filter(t=>t.status==='done').length,1);
});
test('authenticated API failures pause the batch and redact keys everywhere',async t=>{
  const {store,runner}=await setup(t,'image-openai','unauthorized');await runner.start();await runner.job;const s=await store.refresh();
  assert.equal(s.batch.status,'paused');assert.match(s.execution.message,/401/);assert.ok(!JSON.stringify(s).includes(KEYS['image-openai']));
});
test('downloaded API results receive no API authorization header',async t=>{
  const {store,remote,runner}=await setup(t,'image-openai','url');await runner.start();await runner.job;
  assert.equal((await store.refresh()).batch.status,'done');assert.ok(remote.requests.filter(r=>r.route==='/').length>0);assert.ok(remote.requests.filter(r=>r.provider==='result.png').every(r=>!r.key));
});
test('safety replies and invalid image data never become successful records',async t=>{
  for(const mode of ['no-image','invalid-image']){
    const {store,runner}=await setup(t,'image-openai',mode);await runner.start();await runner.job;const s=await store.refresh();assert.equal(s.tasks.filter(t=>t.status==='done').length,0);assert.equal(s.batch.failedCount,2);
  }
});
test('built-in services cannot redirect their keys; custom endpoints reject embedded credentials and full method paths',()=>{
  const builtin=IMAGE_API_PRESETS[0];assert.equal(validateImageApiPreset({...builtin,baseUrl:'https://evil.invalid/v1'}).baseUrl,undefined);
  const custom=IMAGE_API_PRESETS.at(-1);
  for(const baseUrl of ['http://example.com/v1','https://key@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1/images/edits'])assert.throws(()=>validateImageApiPreset({...custom,baseUrl,model:'m'},{requireConfigured:true}));
  assert.ok(PROVIDERS.every(p=>!p.id.startsWith('runninghub-')));assert.deepEqual(outputRatios(IMAGE_API_PRESETS.find(p=>p.model==='gpt-image-1.5')),['2:3','1:1','3:2']);
});
test('custom endpoint settings and selected models persist without changing already queued tasks',async t=>{
  const {store}=await setup(t,'image-custom');const before=await store.refresh();
  await store.saveImageApiConfig({baseUrl:'https://another.example/v1',model:'next-model',protocol:'gemini'});
  const after=await new Store(store.root).init();assert.equal(after.snapshot().providerPresets.find(p=>p.provider==='image-custom').model,'next-model');assert.equal(after.snapshot().tasks[0].providerPreset.model,before.tasks[0].providerPreset.model);
});
test('API timeout is explicit and cancellation never submits the next task',async t=>{
  const {store,remote,runner,client}=await setup(t);
  client.timeoutMs=25;
  const original=client.fetch;
  client.fetch=(url,options)=>options.method==='POST'?new Promise((resolve,reject)=>{const fail=()=>reject(options.signal.reason);if(options.signal.aborted)fail();else options.signal.addEventListener('abort',fail,{once:true});}):original(url,options);
  const task=(await store.claimNext()).task;
  await assert.rejects(client.generate(task),/超时.*用量记录/);
  assert.equal(remote.submitted.length,0);
  await store.recordResult(task.id,{error:'fixture timeout'});
  client.timeoutMs=10000;
  await runner.start();
  for(let n=0;n<100;n++){if((await store.refresh()).tasks.some(t=>t.status==='running'))break;await new Promise(r=>setTimeout(r,5));}
  await store.batchAction('cancel');await runner.job;
  assert.equal((await store.refresh()).batch.status,'cancelled');assert.equal(remote.submitted.length,0);
});
test('confirmed image API capability test returns real bytes without replacing the queued batch',async t=>{
  const {store,remote}=await setup(t),before=await store.refresh();
  const studio=await createStudio(store.root,{credentialOptions:{env:{}},imageApiOptions:{origins:remote.origins}});
  const rejected=await studio.invoke('test_generation',{provider:'image-openai'});assert.equal(rejected.isError,true);
  assert.equal(remote.submitted.length,0);
  const started=await studio.invoke('test_generation',{provider:'image-openai',costConfirmed:true});assert.ok(!started.isError,started.content?.[0]?.text);
  let after;
  for(let n=0;n<150;n++){after=(await studio.invoke('get_state')).structuredContent;if(after.generationChecks?.['image-openai']?.status==='verified')break;await new Promise(r=>setTimeout(r,25));}
  assert.equal(after.generationChecks['image-openai'].status,'verified');assert.equal(remote.submitted.length,1);
  assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.draft,before.draft);assert.equal(after.batch.id,before.batch.id);
  assert.deepEqual(await readFile(after.assets[after.generationChecks['image-openai'].resultId].path),PNG);
});
test('server migration removes the old RH selection but retains saved successful images',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-rh-retirement-')),store=await new Store(root).init();
  const image=await store.putImage(PNG,'success.png','result');
  await store.mutate(()=>{store.state.draft.provider='runninghub-cn';store.state.tasks=[{id:'old-success',batchId:'old',portraitId:image.id,status:'done',resultId:image.id,provider:'runninghub-cn'}];});
  const studio=await createStudio(root),s=(await studio.invoke('get_state')).structuredContent;
  assert.equal(s.draft.provider,'agent');assert.equal(s.tasks[0].resultId,image.id);assert.deepEqual(await readFile(s.assets[image.id].path),PNG);assert.ok(s.providerPresets.every(p=>p.kind==='image-api'));
});
