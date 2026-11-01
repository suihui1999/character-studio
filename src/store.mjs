import {mkdir,readFile,writeFile,rename,rm,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {checkProvider,validatePreset,isNativeProvider} from './generation-models.mjs';

export const DEFAULT_TEMPLATE=`请结合提供的参考图，融合成一张完整的人物图像：
• 【图1（人像参考）】：保持上传主角的五官脸型、身份、发色与发型气质一致，不添加未出现在参考图中的固定发型描述。
• 【图2（服装参考）】：穿上服装参考中的完整服饰「{{costume}}」，还原面料质感、颜色、图案与剪裁。
• 【图3（姿势参考）】：身体姿态与镜头透视遵循姿势参考「{{pose}}」【{{angle}}】，仅参考骨架动作，忽略素体白模材质。
• 【画风要求】：写实商业摄影级质感，85mm 人像镜头，自然柔和光影，真实肌肤纹理与织物细节，8k 高清画质。人物比例协调，手部与五官自然，光影统一。
输出比例：{{ratio}}。每个任务单独生成一张图片，不拼图。
{{notes}}`;

export function initialState(){return {version:1,revision:0,assets:{},providerPresets:[],draft:{portraitId:null,costumeIds:[],poseIds:[],mode:'sample',ratio:'3:4',template:DEFAULT_TEMPLATE,notes:'',provider:'codex',providerPresetId:null},tasks:[],batch:null};}
const uid=()=>randomUUID();
function retainedTasks(state){
  const active=state.batch&&['draft','queued','running','paused','awaiting-approval'].includes(state.batch.status);
  return state.tasks.filter(t=>t.status!=='failed'||(active&&t.batchId===state.batch.id));
}
export function imageType(b){
  if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'.png'};
  if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return {mime:'image/jpeg',ext:'.jpg'};
  if(b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'.webp'};
  throw Error('仅支持有效的 PNG、JPEG、WebP 图片');
}
export class Store{
  constructor(root=process.env.CHARACTER_STUDIO_HOME||path.join(os.homedir(),'.character-studio')){this.root=path.resolve(root);this.file=path.join(this.root,'state.json');this.chain=Promise.resolve();}
  async init(){
    await mkdir(path.join(this.root,'assets'),{recursive:true});
    try{this.state=JSON.parse(await readFile(this.file,'utf8'));if(this.state.version!==1)throw Error('不支持此数据版本');}
    catch(e){if(e.code!=='ENOENT')throw e;this.state=initialState();await this.persist();}
    const alive=pid=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}};
    if(this.state.tasks.some(t=>t.status==='running'&&!alive(t.workerPid)))await this.mutate(()=>{this.state.tasks.filter(t=>t.status==='running'&&!alive(t.workerPid)).forEach(t=>{t.status='interrupted';t.error='上次执行中断，请确认后重试';});if(this.state.batch)this.state.batch.status='paused';});
    if(retainedTasks(this.state).length!==this.state.tasks.length)await this.mutate(()=>{});
    return this;
  }
  async persist(){this.state.tasks=retainedTasks(this.state);this.state.revision++;const tmp=this.file+'.'+uid()+'.tmp';await writeFile(tmp,JSON.stringify(this.state,null,2));await rename(tmp,this.file);}
  async reload(){this.state=JSON.parse(await readFile(this.file,'utf8'));return this.snapshot();}
  refresh(){const run=this.chain.then(()=>this.reload());this.chain=run.catch(()=>{});return run;}
  async lock(){
    const dir=path.join(this.root,'.write-lock');
    if(path.dirname(dir)!==this.root)throw Error('保存锁路径越界');
    for(let n=0;n<400;n++){
      try{await mkdir(dir);await writeFile(path.join(dir,'owner'),String(process.pid));return ()=>rm(dir,{recursive:true,force:true});}
      catch(e){if(e.code!=='EEXIST')throw e;
        try{const pid=Number(await readFile(path.join(dir,'owner'),'utf8'));try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')await rm(dir,{recursive:true,force:true});}}catch{}
        await new Promise(r=>setTimeout(r,50));
      }
    }throw Error('工作台正在保存，请稍后重试');
  }
  mutate(fn){const run=this.chain.then(async()=>{const unlock=await this.lock();try{await this.reload();const result=await fn();await this.persist();if(result?.version===1&&typeof result.revision==='number')result.revision=this.state.revision;return result;}finally{await unlock();}});this.chain=run.catch(()=>{});return run;}
  snapshot(){return structuredClone({...this.state,tasks:retainedTasks(this.state)});}
  async putImage(bytes,name,kind='portrait'){
    if(bytes.length>12*1024*1024)throw Error('单张图片不能超过 12 MB');
    const type=imageType(bytes),hash=createHash('sha256').update(bytes).digest('hex');
    const id=kind+'-'+hash.slice(0,20),file=path.join(this.root,'assets',hash+type.ext);
    await writeFile(file,bytes);
    return this.mutate(()=>{
      const asset={id,kind,name:path.basename(name).slice(0,180),mime:type.mime,path:file,createdAt:new Date().toISOString()};
      this.state.assets[id]=asset;if(kind==='portrait')this.state.draft.portraitId=id;return asset;
    });
  }
  async addReference(item){
    if(!['costume','pose'].includes(item.kind)||!item.id||!item.url)throw Error('参考图类型或编号无效');
    const expected=item.kind==='pose'?'https://ai-pose-depth-gallery.pages.dev/':'https://ai-costume-gallery.pages.dev/';
    for(const u of [item.url,item.thumb])if(u&&!(new URL(u).href.startsWith(expected)))throw Error('参考图必须来自指定图库');
    const key=item.kind+':'+item.id;
    return this.mutate(()=>{const previous=this.state.assets[key],cached=previous?.url===item.url?{path:previous.path,mime:previous.mime}:{};this.state.assets[key]={...cached,...item,id:key,sourceId:item.id};return this.state.assets[key];});
  }
  saveDraft(patch){return this.mutate(()=>{
    const d=this.state.draft;
    if(patch.provider!==undefined){d.provider=checkProvider(patch.provider);if(isNativeProvider(d.provider)||!(this.state.providerPresets||[]).some(p=>p.id===d.providerPresetId&&p.provider===d.provider))d.providerPresetId=null;}
    if(patch.providerPresetId!==undefined){if(patch.providerPresetId!==null&&!(this.state.providerPresets||[]).some(p=>p.id===patch.providerPresetId&&p.provider===(d.provider||'codex')))throw Error('该模型预设不属于所选渠道');d.providerPresetId=patch.providerPresetId;}
    for(const key of ['costumeIds','poseIds'])if(patch[key]){
      if(!Array.isArray(patch[key])||patch[key].some(id=>this.state.assets[id]?.kind!==(key==='poseIds'?'pose':'costume')))throw Error('选择包含无效的参考图');
      d[key]=[...new Set(patch[key])];
    }
    if(patch.portraitId!==undefined){if(patch.portraitId!==null&&this.state.assets[patch.portraitId]?.kind!=='portrait')throw Error('主角图片无效');d.portraitId=patch.portraitId;}
    if(patch.mode!==undefined){if(!['sample','all'].includes(patch.mode))throw Error('执行模式无效');d.mode=patch.mode;}
    if(patch.ratio!==undefined){if(!['3:4','1:1','4:3','9:16','16:9'].includes(patch.ratio))throw Error('比例无效');d.ratio=patch.ratio;}
    for(const key of ['template','notes'])if(patch[key]!==undefined){if(typeof patch[key]!=='string'||patch[key].length>12000)throw Error('提示词过长');d[key]=patch[key];}
    return this.snapshot();
  });}
  saveProviderPreset(preset){const validated=validatePreset(preset);return this.mutate(()=>{
    const presets=this.state.providerPresets??=[];if(validated.id&&!presets.some(p=>p.id===validated.id))throw Error('找不到该模型预设');
    const saved={...validated,id:validated.id||uid()};const at=presets.findIndex(p=>p.id===saved.id);if(at<0)presets.push(saved);else presets[at]=saved;return saved;
  });}
  deleteProviderPreset(id){return this.mutate(()=>{this.state.providerPresets=(this.state.providerPresets||[]).filter(p=>p.id!==id);if(this.state.draft.providerPresetId===id)this.state.draft.providerPresetId=null;return this.snapshot();});}
  updateRemoteTask(taskId,patch){return this.mutate(()=>{const t=this.state.tasks.find(t=>t.id===taskId);if(t?.status==='running')for(const key of ['remoteTaskId','providerStatus','outputUrl'])if(patch[key]!==undefined)t[key]=String(patch[key]);});}
  prompt(costume,pose,draft=this.state.draft){return draft.template.replace(/\{\{(costume|pose|angle|ratio|notes)\}\}/g,(_,k)=>({costume:costume.name,pose:pose.name,angle:pose.angle||'参考图视角',ratio:draft.ratio,notes:draft.notes}[k]));}
  buildQueue(){return this.mutate(()=>{
    const s=this.state,d=s.draft;
    const provider=d.provider||'codex',providerPreset=isNativeProvider(provider)?null:(s.providerPresets||[]).find(p=>p.id===d.providerPresetId&&p.provider===provider);
    if(!isNativeProvider(provider)&&!providerPreset)throw Error('请先导入并选择该站点的 AI 应用或工作流模型预设');
    if(!d.portraitId)throw Error('请先上传主角图片');
    if(!d.costumeIds.length||!d.poseIds.length)throw Error('请至少选择一套服装和一个姿势');
    if(s.batch&&['queued','running','paused','awaiting-approval'].includes(s.batch.status))throw Error('请先完成或取消当前批次');
    if(d.costumeIds.length*d.poseIds.length>200)throw Error('每批最多 200 个任务，请减少选择');
    const batchId=uid();s.tasks=s.tasks.filter(t=>t.status==='done'||t.status==='failed'||t.status==='interrupted');
    for(const c of d.costumeIds)for(const p of d.poseIds)s.tasks.push({id:uid(),batchId,portraitId:d.portraitId,costumeId:c,poseId:p,prompt:this.prompt(s.assets[c],s.assets[p]),ratio:d.ratio,provider,providerPreset:providerPreset?structuredClone(providerPreset):null,status:'pending',createdAt:new Date().toISOString(),attempts:0});
    s.batch={id:batchId,status:'draft',mode:d.mode,approved:d.mode==='all',provider,providerPreset:providerPreset?structuredClone(providerPreset):null,createdAt:new Date().toISOString()};delete s.execution;return this.snapshot();
  });}
  patchTask(taskId,patch){return this.mutate(()=>{
    const s=this.state,t=s.tasks.find(t=>t.id===taskId);if(!t)throw Error('找不到任务');
    if(s.batch?.status!=='draft'||t.batchId!==s.batch.id)throw Error('只能调整提交前的当前队列');
    if(patch.remove){s.tasks=s.tasks.filter(t=>t.id!==taskId);return this.snapshot();}
    for(const [k,kind]of [['costumeId','costume'],['poseId','pose']])if(patch[k]){if(s.assets[patch[k]]?.kind!==kind)throw Error('参考图无效');t[k]=patch[k];t.prompt=this.prompt(s.assets[t.costumeId],s.assets[t.poseId]);}
    if(patch.prompt!==undefined){if(typeof patch.prompt!=='string'||patch.prompt.length>16000)throw Error('提示词无效');t.prompt=patch.prompt;}return this.snapshot();
  });}
  batchAction(action){return this.mutate(()=>{
    const b=this.state.batch;if(!b)throw Error('请先建立队列');
    if(action==='start'){if(b.status!=='draft')throw Error('该批次已提交');if(!this.state.tasks.some(t=>t.batchId===b.id&&t.status==='pending'))throw Error('队列为空');b.status='queued';}
    else if(action==='pause'){if(['queued','running','awaiting-approval'].includes(b.status))b.status='paused';}
    else if(action==='continue'){if(!['awaiting-approval','paused'].includes(b.status))throw Error('当前批次无需继续');b.approved=true;b.status='queued';}
    else if(action==='cancel'){b.status='cancelled';this.state.tasks.filter(t=>t.batchId===b.id&&['pending','running'].includes(t.status)).forEach(t=>t.status='cancelled');}
    else throw Error('未知批次操作');return this.snapshot();
  });}
  async downloadAsset(id){
    const a=this.state.assets[id];if(!a)throw Error('参考图不存在');if(a.path){try{await access(a.path);return a.path;}catch(e){if(e.code!=='ENOENT')throw e;delete a.path;delete a.mime;if(a.kind==='portrait')throw Error('主角图片文件已丢失，请重新上传。');}}
    if(!a.url)throw Error('参考图没有来源');
    const r=await fetch(a.url,{headers:{'User-Agent':'CharacterStudio/0.1 reference-fetch'},signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!r.ok)throw Error('读取参考图失败 '+r.status+': '+a.sourceId);
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>20*1024*1024)throw Error('参考图超过大小限制');
    const type=imageType(bytes),f=path.join(this.root,'assets',createHash('sha256').update(bytes).digest('hex')+type.ext);await writeFile(f,bytes);a.path=f;a.mime=type.mime;return f;
  }
  claimNext(expectedBatchId){return this.mutate(async()=>{
    const s=this.state,b=s.batch;
    if(expectedBatchId&&b?.id!==expectedBatchId)return {task:null,batch:b};
    if(!b||!['queued','running'].includes(b.status))return {task:null,batch:b};
    if(s.tasks.some(t=>t.batchId===b.id&&t.status==='running'))throw Error('已有任务执行中，请先回填结果');
    if(b.mode==='sample'&&!b.approved&&s.tasks.some(t=>t.batchId===b.id&&t.status==='done')){b.status='awaiting-approval';return {task:null,batch:b};}
    while(true){
    const t=s.tasks.find(t=>t.batchId===b.id&&t.status==='pending');if(!t){b.status='done';return {task:null,batch:b};}
    const refs=[];
    try{for(const id of [t.portraitId,t.costumeId,t.poseId])refs.push({kind:s.assets[id].kind,path:await this.downloadAsset(id),id});}
    catch(e){t.status='failed';t.error=e.message;t.finishedAt=new Date().toISOString();b.failedCount=(b.failedCount||0)+1;b.lastError=e.message;continue;}
    t.status='running';t.workerPid=process.pid;t.attempts++;t.startedAt=new Date().toISOString();b.status='running';
    return {task:{...t,references:refs},batch:b};
    }
  });}
  async recordResult(taskId,{filePath,base64,error}){
    let asset;
    if(!error){const bytes=base64?Buffer.from(base64,'base64'):await readFile(await realpath(filePath));asset=await this.putImage(bytes,path.basename(filePath||'generated.png'),'result');}
    return this.mutate(()=>{
      const s=this.state,t=s.tasks.find(t=>t.id===taskId);if(!t||t.status!=='running')throw Error('该任务未在执行中，不能回填结果');
      t.status=error?'failed':'done';t.error=error||null;t.resultId=asset?.id||null;t.finishedAt=new Date().toISOString();
      const b=s.batch;if(error&&b?.id===t.batchId){b.failedCount=(b.failedCount||0)+1;b.lastError=error;}
      if(b?.id===t.batchId&&!['paused','cancelled'].includes(b.status)){
        const remain=s.tasks.some(t=>t.batchId===b.id&&t.status==='pending');
        b.status=!remain?'done':!error&&b.mode==='sample'&&!b.approved?'awaiting-approval':'queued';
      }
      return this.snapshot();
    });
  }
  retry(taskId){return this.mutate(()=>{
    const s=this.state,t=s.tasks.find(t=>t.id===taskId);if(!t||!['done','failed','interrupted'].includes(t.status))throw Error('该任务无法重做');
    if(s.batch&&s.tasks.some(t=>t.batchId===s.batch.id&&['pending','running'].includes(t.status))&&s.batch.status!=='cancelled')throw Error('请先处理当前批次');
    const id=uid();s.tasks.push({...t,id,batchId:id,status:'pending',resultId:null,error:null,attempts:0,remoteTaskId:null,providerStatus:null,outputUrl:null});s.batch={id,status:'queued',mode:'all',approved:true,provider:t.provider||'codex',providerPreset:t.providerPreset||null};delete s.execution;return this.snapshot();
  });}
  async image(id){const a=this.state.assets[id];if(!a?.path)throw Error('本地图片不存在');const bytes=await readFile(a.path);return {mime:a.mime||imageType(bytes).mime,base64:bytes.toString('base64')};}
}
