import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.mjs';
import {BatchExporter} from '../src/batch-export.mjs';
import {createStudio,serveHttp} from '../src/server.mjs';

// Protocol fixture bytes, never presented as a generated image to real users.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
async function setup(){
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-batches 中文 '));
  const store=await new Store(root).init(),portrait=await store.putImage(PNG,'主角.png');
  const costume=await store.addReference({id:'C-001',kind:'costume',name:'fixture outfit',url:'https://ai-costume-gallery.pages.dev/img/C-001.png'});
  const poses=[];
  for(const id of ['P001_front','P002_front'])poses.push(await store.addReference({id,kind:'pose',name:'fixture pose',url:'https://ai-pose-depth-gallery.pages.dev/img/'+id+'.png'}));
  await store.mutate(()=>{for(const r of [costume,...poses])store.state.assets[r.id].path=portrait.path;});
  await store.saveDraft({provider:'agent',costumeIds:[costume.id],poseIds:poses.map(p=>p.id)});
  return {root,store,portrait};
}
async function complete(store,failFirst=false){
  await store.buildQueue();await store.batchAction('start');const id=store.state.batch.id;
  for(let i=0;i<2;i++){
    const {task}=await store.claimNext();
    await store.recordResult(task.id,failFirst&&i===0?{error:'fixture failure'}:{base64:PNG.toString('base64')});
  }
  return id;
}
test('batch aggregates survive failed-detail cleanup, new batches, renaming and reopening',async()=>{
  const {root,store,portrait}=await setup();
  const first=await complete(store,true);await store.renameBatch(first,'冬日搭配');
  assert.ok(!store.state.tasks.some(t=>t.status==='failed'));
  const second=await complete(store);
  const reopened=await new Store(root).init(),record=reopened.state.batches[first];
  assert.equal(record.name,'冬日搭配');assert.equal(record.successCount,1);assert.equal(record.failedCount,1);
  assert.equal(record.totalCount,2);assert.equal(record.portraitId,portrait.id);assert.ok(record.createdAt);
  assert.equal(record.countsIncomplete,false);assert.equal(reopened.state.batches[second].successCount,2);
  assert.notEqual(first,second);
});
test('legacy success tasks recover their original batch and portrait, while lost failures are marked unknown',async()=>{
  const {root,store,portrait}=await setup();const first=await complete(store);
  await complete(store);
  const old=JSON.parse(await readFile(store.file,'utf8'));delete old.batches;
  await writeFile(store.file,JSON.stringify(old));
  const reopened=await new Store(root).init(),record=reopened.state.batches[first];
  assert.equal(record.successCount,2);assert.equal(record.portraitId,portrait.id);assert.equal(record.countsIncomplete,true);
});
test('batch ZIP and saved folder contain matching, safe, distinct names and exact image bytes',async()=>{
  const {store}=await setup();const id=await complete(store);
  await store.renameBatch(id,'冬日 / 搭配:<1>');
  const exporter=new BatchExporter(store);
  const [one,two]=await Promise.all([exporter.prepare(id),exporter.prepare(id)]);
  await exporter.writeArchive(one);
  assert.equal(one.folder,two.folder);
  const files=await readdir(one.folder);assert.equal(files.length,2);assert.equal(new Set(files).size,2);
  for(const name of files){
    assert.match(name,/冬日/);assert.ok(name.includes(id.slice(0,8)));assert.match(name,/服装_C-001__姿势_P00[12]_front/);
    assert.ok(!/[<>:"/\\|?*]/.test(name));assert.deepEqual(await readFile(path.join(one.folder,name)),PNG);
  }
  assert.equal((await readFile(one.archive)).readUInt32LE(0),0x04034b50);
  assert.ok(path.relative(store.root,one.folder).startsWith('exports'+path.sep));
});
test('download route serves only registered ZIPs, supports UTF-8 names and rejects unknown IDs',async t=>{
  const {root,store}=await setup();const id=await complete(store);await store.renameBatch(id,'中文批次');
  const studio=await createStudio(root);
  const server=await serveHttp(studio,0);t.after(()=>server.close());
  const result=await studio.invoke('download_batch',{batchId:id});assert.equal(result.isError,undefined);
  const response=await fetch(result.structuredContent.downloadUrl);
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/zip/);
  assert.ok(response.headers.get('content-disposition').includes(encodeURIComponent('中文批次')));
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);
  assert.equal((await fetch(result.structuredContent.downloadUrl.replace(/[^/]+$/,'unregistered'))).status,404);
  const invalid=await studio.invoke('download_batch',{batchId:'../../provider-credentials.json'});assert.equal(invalid.isError,true);
});
test('MCP-only studio starts its local download endpoint on demand',async t=>{
  const {root,store}=await setup();const id=await complete(store);
  const studio=await createStudio(root);assert.equal(studio.httpServer,undefined);
  const result=await studio.invoke('download_batch',{batchId:id});assert.equal(result.isError,undefined);
  t.after(()=>studio.httpServer.close());
  assert.equal((await fetch(result.structuredContent.downloadUrl)).status,200);
});
