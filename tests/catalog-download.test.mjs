import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createStudio} from '../src/server.mjs';
import {SOURCES} from '../src/catalog.mjs';
import {downloadCatalogImage} from '../src/catalog-download.mjs';
import {PNG} from './fixtures/fake-image-api.mjs';

test('three library downloads return original bytes without selecting materials or replacing the character',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-download-'));await mkdir(path.join(root,'catalog'));
  const requested=[];
  for(const kind of Object.keys(SOURCES))await writeFile(path.join(root,'catalog',kind+'.json'),JSON.stringify([{id:'test-'+kind,url:SOURCES[kind]+(kind==='portrait'?'img/full/':'img/')+'original.png'}]));
  const studio=await createStudio(root,{catalogDownloadOptions:{fetchImpl:async(url,options)=>{requested.push({url,options});return new Response(PNG);}}});
  const before=(await studio.invoke('get_state')).structuredContent;
  for(const kind of Object.keys(SOURCES)){
    const result=await studio.invoke('download_catalog_image',{kind,id:'test-'+kind});assert.ok(!result.isError,result.content?.[0]?.text);
    const image=result.structuredContent;assert.deepEqual(Buffer.from(image.base64,'base64'),PNG);assert.equal(image.mime,'image/png');assert.equal(image.filename,kind+'_test-'+kind+'.png');
    assert.equal(requested.at(-1).url,SOURCES[kind]+(kind==='portrait'?'img/full/':'img/')+'original.png');assert.equal(requested.at(-1).options.redirect,'error');
  }
  const after=(await studio.invoke('get_state')).structuredContent;
  assert.deepEqual(after.draft,before.draft);assert.deepEqual(after.assets,before.assets);assert.deepEqual(after.tasks,before.tasks);
});
test('library downloads reject unknown IDs, foreign origins, invalid images and HTTP failures',async()=>{
  const options={fetchImpl:async()=>new Response(PNG)};
  await assert.rejects(downloadCatalogImage({load:async()=>[]},{kind:'pose',id:'missing'},options),/找不到/);
  await assert.rejects(downloadCatalogImage({load:async()=>[{id:'bad',url:'https://evil.invalid/image.png'}]},{kind:'pose',id:'bad'},options),/来自所选图库/);
  const catalog={load:async()=>[{id:'test',url:SOURCES.costume+'img/original.png'}]},args={kind:'costume',id:'test'};
  await assert.rejects(downloadCatalogImage(catalog,args,{fetchImpl:async()=>new Response('html')}),/有效的 PNG/);
  await assert.rejects(downloadCatalogImage(catalog,args,{fetchImpl:async()=>new Response('',{status:404})}),/HTTP 404/);
  await assert.rejects(downloadCatalogImage(catalog,args,{fetchImpl:async()=>{throw Error('fetch failed');}}),/无法连接图库/);
});
