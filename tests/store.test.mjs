import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {parseCatalog} from '../src/catalog.mjs';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'character-studio-test-')),s=await new Store(root).init();
  const p=await s.putImage(PNG,'主角.png');const cs=[],ps=[];
  for(let n=0;n<2;n++){
    cs.push((await s.addReference({id:'c'+n,kind:'costume',name:'服装'+n,url:'https://ai-costume-gallery.pages.dev/img/c'+n+'.webp'})).id);
    ps.push((await s.addReference({id:'p'+n,kind:'pose',name:'姿势'+n,angle:'正面',url:'https://ai-pose-depth-gallery.pages.dev/img/p'+n+'.png'})).id);
  }
  // Real cached raster fixture: tests never call a generator or report these as generated images.
  for(const id of [...cs,...ps])s.state.assets[id].path=p.path;
  await s.persist();await s.saveDraft({costumeIds:cs,poseIds:ps});return {s,root,p,cs,ps};
}
test('reselecting a cached reference keeps its original file for reuse',async()=>{
  const {s,cs,p}=await fixture();const a=s.state.assets[cs[0]];
  await s.addReference({id:a.sourceId,kind:a.kind,name:'重新选择',url:a.url,thumb:'https://ai-costume-gallery.pages.dev/thumbs/c0.png'});
  assert.equal((await s.refresh()).assets[cs[0]].path,p.path);assert.equal(await s.downloadAsset(cs[0]),p.path);
});
test('Cartesian queue snapshots references and continues after the first image',async()=>{
  const {s}=await fixture();await s.buildQueue();assert.equal(s.state.tasks.length,4);
  const portrait=s.state.draft.portraitId;await s.batchAction('start');const r=await s.claimNext();
  assert.equal(r.task.references.length,3);assert.equal(r.task.portraitId,portrait);
  await assert.rejects(s.claimNext(),/已有任务/);
  await s.recordResult(r.task.id,{base64:PNG.toString('base64')});
  assert.equal(s.state.batch.status,'queued');
  const second=await s.claimNext();assert.ok(second.task);assert.notEqual(second.task.id,r.task.id);
});
test('pause/cancel stop pending work and completion does not unpause',async()=>{
  const {s}=await fixture();await s.buildQueue();await s.batchAction('start');
  const r=await s.claimNext();await s.batchAction('pause');await s.recordResult(r.task.id,{base64:PNG.toString('base64')});
  assert.equal(s.state.batch.status,'paused');assert.equal((await s.claimNext()).task,null);
  await s.batchAction('cancel');assert.equal((await s.claimNext()).task,null);assert.equal(s.state.tasks.filter(t=>t.status==='cancelled').length,3);
});
test('independent server instances serialize claiming and preserve one another changes',async()=>{
  const {s,root}=await fixture();await s.buildQueue();await s.batchAction('start');const other=await new Store(root).init();
  const results=await Promise.allSettled([s.claimNext(),other.claimNext()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await other.saveDraft({notes:'另一窗口的要求'});await s.refresh();assert.equal(s.state.draft.notes,'另一窗口的要求');assert.equal(s.state.tasks.filter(t=>t.status==='running').length,1);
});
test('UI polling during an awaited reference download cannot overwrite a claim',async()=>{
  const {s}=await fixture();await s.buildQueue();await s.batchAction('start');
  const download=s.downloadAsset.bind(s);let release,entered;
  const blocked=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  let first=true;s.downloadAsset=async id=>{if(first){first=false;entered();await blocked;}return download(id);};
  const claiming=s.claimNext();await started;
  const refreshing=s.refresh();release();const claimed=await claiming;const visible=await refreshing;
  assert.equal(visible.tasks.find(t=>t.id===claimed.task.id).status,'running');
  await s.recordResult(claimed.task.id,{error:'Expected test failure'});
  assert.equal(s.state.tasks.find(t=>t.id===claimed.task.id).status,'failed');
  assert.equal(s.state.batch.status,'queued');
});
test('main character and real result bytes persist across reopening',async()=>{
  const {s,root,p}=await fixture();await s.buildQueue();await s.batchAction('start');const r=await s.claimNext();
  await s.recordResult(r.task.id,{base64:PNG.toString('base64')});const restored=await new Store(root).init();
  assert.equal(restored.state.draft.portraitId,p.id);assert.equal(restored.state.tasks[0].status,'done');
  const result=await restored.image(restored.state.tasks[0].resultId);assert.deepEqual(Buffer.from(result.base64,'base64'),PNG);
});
test('task editing and deletion only affect a draft batch',async()=>{
  const {s,cs}=await fixture();await s.buildQueue();const t=s.state.tasks[0];await s.patchTask(t.id,{costumeId:cs[1],prompt:'单独修改'});
  assert.equal(s.state.tasks[0].prompt,'单独修改');await s.patchTask(s.state.tasks[1].id,{remove:true});assert.equal(s.state.tasks.length,3);
  await s.batchAction('start');await assert.rejects(s.patchTask(t.id,{remove:true}),/提交前/);
});
test('source adapters preserve depth source and reject HTML script execution or image escapes',()=>{
  const pose=parseCatalog('const D=[{"id":"p1","ポーズ名":"站姿","分類":"立ち","アングル":"正面","原寸":"img/p1.png","サムネ":"thumbs/p1.jpg"}];','pose');
  assert.equal(pose[0].url,'https://ai-pose-depth-gallery.pages.dev/img/p1.png');assert.equal(pose[0].category,'站姿');
  assert.throws(()=>parseCatalog('const D=(()=>alert(1))();','pose'),/格式/);
  assert.throws(()=>parseCatalog('const D=[{"id":"p","原寸":"https://evil.example/a","サムネ":"thumbs/p.jpg"}];','pose'),/越界/);
});
test('uploads reject non-images and foreign reference origins',async()=>{
  const {s}=await fixture();await assert.rejects(s.putImage(Buffer.from('<svg/>'),'bad.svg'),/仅支持/);
  await assert.rejects(s.addReference({id:'bad',kind:'pose',name:'bad',url:'https://evil.example/image.png'}),/指定图库/);
});
test('failed history is removed automatically while current errors and successful images survive',async()=>{
  const {s,root}=await fixture();await s.buildQueue();await s.batchAction('start');
  const first=await s.claimNext();await s.recordResult(first.task.id,{error:'Current failure'});
  assert.equal((await s.refresh()).tasks.find(t=>t.id===first.task.id).error,'Current failure');
  await s.batchAction('cancel');assert.ok(!s.state.tasks.some(t=>t.id===first.task.id));
  await s.buildQueue();await s.batchAction('start');const second=await s.claimNext();await s.recordResult(second.task.id,{base64:PNG.toString('base64')});
  const resultId=s.state.tasks.find(t=>t.id===second.task.id).resultId;await s.batchAction('cancel');await s.buildQueue();
  const restored=await new Store(root).init();assert.ok(restored.state.tasks.some(t=>t.id===second.task.id&&t.status==='done'));
  assert.deepEqual(Buffer.from((await restored.image(resultId)).base64,'base64'),PNG);
  assert.ok(!JSON.parse(await readFile(restored.file,'utf8')).tasks.some(t=>t.status==='failed'));
});

test('reference download failure skips that task and claims the next without pausing',async()=>{
  const {s}=await fixture();await s.buildQueue();await s.batchAction('start');
  const download=s.downloadAsset.bind(s);let first=true;s.downloadAsset=async id=>{if(first){first=false;throw Error('fixture missing reference');}return download(id);};
  const next=await s.claimNext();assert.ok(next.task);assert.equal(s.state.tasks[0].status,'failed');assert.equal(next.task.id,s.state.tasks[1].id);assert.equal(s.state.batch.failedCount,1);assert.match(s.state.tasks[0].error,/missing reference/);
});

test('an old executor cannot claim a task from a replacement batch',async()=>{
  const {s}=await fixture();await s.buildQueue();await s.batchAction('start');const oldId=s.state.batch.id;
  await s.batchAction('cancel');await s.buildQueue();await s.batchAction('start');
  assert.equal((await s.claimNext(oldId)).task,null);assert.ok(s.state.tasks.every(t=>t.attempts===0));
});

test('partial references preserve the original clothing or pose',async()=>{
  const {s,ps}=await fixture();
  for(const [patch,kinds,expected] of [
    [{poseIds:[]},['portrait','costume'],/保留主角原图的姿势/],
    [{costumeIds:[],poseIds:ps},['portrait','pose'],/【图2（姿势参考）】[\s\S]*保留主角原图的服装/]
  ]){
    await s.saveDraft(patch);
    await s.buildQueue();
    assert.equal(s.state.tasks.filter(t=>t.batchId===s.state.batch.id).length,2);
    await s.batchAction('start');
    const {task}=await s.claimNext();
    assert.deepEqual(task.references.map(r=>r.kind),kinds);
    assert.match(task.prompt,expected);
    await s.batchAction('cancel');
  }
});
test('a legacy batch waiting for sample approval reopens as paused and can finish',async()=>{
  const {s,root}=await fixture();
  await s.buildQueue();await s.batchAction('start');
  const {task}=await s.claimNext();
  await s.recordResult(task.id,{base64:PNG.toString('base64')});
  await s.mutate(()=>{s.state.batch.status='awaiting-approval';});
  const reopened=await new Store(root).init();
  assert.equal(reopened.state.batch.status,'paused');
  assert.equal((await reopened.claimNext()).task,null);
  await reopened.batchAction('continue');
  assert.ok((await reopened.claimNext()).task);
});
