import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
const run=promisify(execFile),cli=path.resolve('plugins/character-studio/dist/cli.mjs');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
async function fixture(t){
  const home=await mkdtemp(path.join(os.tmpdir(),'studio-cli 中文 '));
  const command=async(...args)=>JSON.parse((await run(process.execPath,[cli,...args],{env:{...process.env,CHARACTER_STUDIO_HOME:home},timeout:20000})).stdout.trim());
  const opened=await command('open','--no-browser','--port','0');const health=await fetch(opened.url+'/api/health').then(r=>r.json());
  t.after(()=>{try{process.kill(health.pid);}catch{}});
  const tool=async(name,args={})=>{const r=await fetch(opened.url+'/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})}).then(r=>r.json());assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
  return {home,command,opened,health,tool};
}
test('CLI opens and reuses the daemon without MCP registration, including concurrent opens',async t=>{
  const f=await fixture(t);assert.equal((await f.command('doctor')).ready,true);assert.equal((await f.command('state')).draft.provider,'agent');
  const opened=await Promise.all([f.command('open','--no-browser'),f.command('open','--no-browser')]);assert.ok(opened.every(o=>o.url===f.opened.url));assert.equal((await fetch(f.opened.url+'/api/health').then(r=>r.json())).pid,f.health.pid);
  assert.equal(JSON.parse(await readFile(path.join(f.home,'service.json'),'utf8')).pid,f.health.pid);
});
test('opening again keeps the successfully configured channel instead of resetting to Agent',async t=>{
  const f=await fixture(t),store=await new Store(f.home).init();
  await store.saveDraft({provider:'image-openai'});
  await store.mutate(()=>{store.state.channelSetup={provider:'image-openai',checkedAt:new Date().toISOString()};});
  await f.command('open','--no-browser');
  assert.equal((await f.command('state')).draft.provider,'image-openai');
});
test('CLI wait wakes on submission and persists exact returned result bytes',async t=>{
  const f=await fixture(t),store=await new Store(f.home).init(),portrait=await store.putImage(PNG,'fixture.png');
  const refs=[];for(const kind of ['costume','pose'])refs.push(await store.addReference({kind,id:kind,name:'日常测试',url:`https://${kind==='pose'?'ai-pose-depth-gallery':'ai-costume-gallery'}.pages.dev/img/fixture.png`}));
  await store.mutate(()=>{for(const r of refs)store.state.assets[r.id].path=portrait.path;});await store.saveDraft({costumeIds:[refs[0].id],poseIds:[refs[1].id]});await store.buildQueue();
  const waiting=f.command('wait','--agent','test fixture','--image-tool','fixture-only','--timeout','4');
  for(let i=0;i<80;i++){if((await f.tool('get_state')).agentConnection.connected)break;await delay(25);}
  assert.equal((await f.tool('get_state')).agentConnection.connected,true);await f.tool('control_batch',{action:'start'});const next=await waiting;
  assert.equal(next.task.references.length,3);await f.command('result','--task',next.task.id,'--file',portrait.path);
  const state=await f.command('state'),task=state.tasks.find(t=>t.id===next.task.id);assert.equal(task.status,'done');assert.deepEqual(await readFile(state.assets[task.resultId].path),PNG);assert.equal(state.agentConnection.connected,false);
});
test('missing native generator is visible in workbench state and does not use Codex',async t=>{
  const f=await fixture(t);await f.command('unavailable','--reason','本会话没有原生生图工具');assert.match((await f.command('state')).agentConnection.reason,/没有原生/);assert.equal((await f.command('state')).draft.provider,'agent');
});
