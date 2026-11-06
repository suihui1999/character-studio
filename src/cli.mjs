import {readFile,writeFile,mkdir,unlink,rmdir,open as openFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {VERSION,BUILD_ID,SERVICE} from './version.mjs';

const root=path.resolve(process.env.CHARACTER_STUDIO_HOME||path.join(os.homedir(),'.character-studio'));
const homeId=createHash('sha256').update(root).digest('hex');
const args=process.argv.slice(2),command=args.shift()||'help',flags={};
for(let i=0;i<args.length;i++){
  if(!args[i].startsWith('--'))throw Error('参数需要以 -- 开头');
  const key=args[i].slice(2);if(flags[key]!==undefined)throw Error('重复参数：'+key);
  flags[key]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;
}
const output=data=>process.stdout.write(JSON.stringify(data)+'\n');
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const serverPath=fileURLToPath(new URL('./server.mjs',import.meta.url));
function endpoint(port){if(!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535)throw Error('无效的本机端口');return 'http://127.0.0.1:'+Number(port);}
async function health(port){try{const r=await fetch(endpoint(port)+'/api/health',{signal:AbortSignal.timeout(1200)});if(!r.ok)return null;const h=await r.json();return h.service===SERVICE&&h.homeId===homeId&&h.buildId===BUILD_ID&&h.features?.includes('agent-cli-v1')?{...h,port:Number(port)}:null;}catch{return null;}}
async function discover(){
  try{const d=JSON.parse(await readFile(path.join(root,'service.json'),'utf8'));const h=await health(d.port);if(h)return h;}catch{}
  return flags.port?health(flags.port):health(43127);
}
async function withLaunchLock(fn){
  await mkdir(root,{recursive:true});const lock=path.join(root,'.launch-lock'),owner=path.join(lock,'owner');
  let locked=false;
  for(let n=0;n<120;n++){
    try{await mkdir(lock);await writeFile(owner,String(process.pid));locked=true;break;}
    catch(e){if(e.code!=='EEXIST')throw e;try{const pid=Number(await readFile(owner,'utf8'));if(pid&&!alive(pid)){await unlink(owner);await rmdir(lock);}}catch{}await delay(100);}
  }
  if(!locked)throw Error('工作台正在启动，请稍后再试；没有修改宿主的 MCP 设置。');
  try{return await fn();}finally{await unlink(owner).catch(()=>{});await rmdir(lock).catch(()=>{});}
}
async function launch(port){
  const log=await openFile(path.join(root,'service.log'),'a');
  const child=spawn(process.execPath,[serverPath,'--http','--port',String(port)],{detached:true,windowsHide:true,env:{...process.env,CHARACTER_STUDIO_HOME:root},stdio:['ignore','ignore',log.fd,'ipc']});
  try{
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>done(Error('工作台启动超时，请运行 doctor 查看状态。')),15000);
      const done=(error,value)=>{clearTimeout(timer);child.removeAllListeners('message');child.removeAllListeners('error');child.removeAllListeners('exit');if(child.connected)child.disconnect();child.unref();error?reject(error):resolve(value);};
      child.once('error',e=>done(e));child.once('exit',(code)=>done(Error('工作台未能启动（'+code+'），请查看本机 service.log。')));
      child.on('message',m=>{if(m?.service===SERVICE&&m.homeId===homeId&&m.buildId===BUILD_ID)done(null,m);});
    });
  }finally{await log.close();}
}
async function ensure(){
  const known=await discover();if(known)return known;
  return withLaunchLock(async()=>{
    const existing=await discover();if(existing)return existing;
    let started;
    try{started=await launch(flags.port?Number(flags.port):43127);}
    catch(error){if(flags.port)throw error;started=await launch(0);}
    // IPC tells us which port was selected. Verify HTTP readiness separately
    // before handing the first user action to a cold Windows process.
    for(let n=0;n<30;n++){const ready=await health(started.port);if(ready)return ready;await delay(100);}
    throw Error('程序已启动，但本机连接尚未就绪。请运行 doctor 查看状态。');
  });
}
async function call(service,name,input={},timeout=45000){
  let response;
  try{response=await fetch(endpoint(service.port)+'/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:input}),signal:AbortSignal.timeout(timeout)});}catch(e){throw Error('本机连接失败：'+(e.cause?.code||e.message)+'。任务未自动重试，请检查工作台连接。');}
  const r=await response.json();if(!response.ok||r.isError)throw Error(r.error||r.content?.find(x=>x.type==='text')?.text||'工作台操作失败');return r.structuredContent;
}
async function sessionId(){
  if(typeof flags.session==='string')return flags.session;
  const file=path.join(root,'agent-session.json');
  try{return JSON.parse(await readFile(file,'utf8')).id;}catch{}
  const id=randomUUID();try{await writeFile(file,JSON.stringify({id}),{flag:'wx'});return id;}catch(e){if(e.code!=='EEXIST')throw e;return JSON.parse(await readFile(file,'utf8')).id;}
}
async function openBrowser(url){
  let executable,parameters;
  if(process.platform==='win32'){executable='rundll32.exe';parameters=['url.dll,FileProtocolHandler',url];}
  else if(process.platform==='darwin'){executable='open';parameters=[url];}
  else{executable='xdg-open';parameters=[url];}
  await new Promise((resolve,reject)=>{const child=spawn(executable,parameters,{detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
async function main(){
  if(command==='help')return output({service:SERVICE,version:VERSION,commands:{open:'自动启动并打开工作台；--no-browser 可由宿主面板展示',doctor:'检查本机服务，不修改宿主连接',state:'读取工作台状态',wait:'--agent 豆包工作 --image-tool 实际工具名；等待并领取用户提交的任务',claim:'手动领取下一项，通常使用 wait',result:'--task 任务ID，配合 --file 真实结果路径或 --error 失败原因',disconnect:'结束当前 Agent 的连接'},note:'这些命令由 Agent 执行，用户不需要填写 MCP 设置。'});
  if(command==='doctor'){
    const service=await discover();return output({service:SERVICE,version:VERSION,ready:!!service,home:root,runtime:process.version,...(service?{url:endpoint(service.port),buildId:service.buildId}:{message:'尚未启动，运行 open 会自动启动。'})});
  }
  if(!['open','state','wait','claim','ack','result','disconnect','unavailable'].includes(command))throw Error('未知命令，请运行 help。');
  const service=await ensure();
  if(command==='open'){
    const current=await call(service,'get_state');
    const executor=flags.executor||(current.channelSetup?'keep':'agent');if(!['agent','codex','keep'].includes(executor))throw Error('executor 只能为 agent、codex 或 keep');
    if(flags.host!==undefined&&flags.host!=='doubao')throw Error('host 目前只支持 doubao');
    await call(service,'open_workbench',executor==='keep'?{}:{executor});
    const url=endpoint(service.port)+(flags.host==='doubao'?'/?host=doubao':'');if(!flags['no-browser']){try{await openBrowser(url);}catch{throw Error('工作台已启动，但无法自动打开浏览器。请打开 '+url);}}
    const agentStep=flags.host==='doubao'
      ?'按安装目录中的技能先引导连接渠道。使用豆包时先检查本会话看图、生图和真实文件回填能力，建立真实等待；缺少工具用 unavailable 报告原因。已保存的其他渠道保持原选择。提交后可发送「处理工作台里待生成的图片」接手整批；测试图使用同样的 wait/ack/result 流程。'
      :'确认本会话有看图、生图和结果文件工具后，运行 wait --follow --agent 宿主名 --image-tool 实际工具名，保持等待用户提交。没有相应工具则运行 unavailable --reason 具体原因。';
    return output({opened:true,url,browserRequested:!flags['no-browser'],version:VERSION,buildId:service.buildId,agentStep});
  }
  if(command==='state')return output(await call(service,'get_state'));
  if(command==='claim')return output(await call(service,'claim_next_task'));
  if(command==='ack'){
    if(typeof flags.task!=='string')throw Error('ack 需要 --task 任务ID');
    return output(await call(service,'agent_ack_task',{taskId:flags.task}));
  }
  if(command==='result'){
    if(typeof flags.task!=='string'||(typeof flags.file==='string')===(typeof flags.error==='string'))throw Error('result 需要 --task，以及 --file 或 --error 中的一项');
    return output(await call(service,'record_result',{taskId:flags.task,...(flags.file?{filePath:path.resolve(flags.file)}:{error:flags.error})}));
  }
  const id=await sessionId();
  if(command==='disconnect')return output(await call(service,'agent_disconnect',{sessionId:id}));
  if(command==='unavailable'){
    if(typeof flags.reason!=='string')throw Error('需要 --reason 说明缺少的能力');
    return output(await call(service,'agent_unavailable',{sessionId:id,reason:flags.reason}));
  }
  if(typeof flags.agent!=='string'||typeof flags['image-tool']!=='string')throw Error('等待前需填写 --agent 和本会话实际可用的 --image-tool 名称；不能凭客户端有生图按钮宣称已接通。');
  const timeoutMs=flags.timeout?Number(flags.timeout)*1000:45000;
  const renew=flags.follow===true;
  for(;;){
    const result=await call(service,'agent_wait',{sessionId:id,agentName:flags.agent,imageTool:flags['image-tool'],timeoutMs,renew},timeoutMs+100000);
    if(!renew||result.reason!=='idle')return output(result);
  }
}
main().catch(error=>{output({ok:false,error:error.message});process.exitCode=1;});
