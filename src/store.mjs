import {mkdir,readFile,writeFile,rename,rm,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {checkProvider,validatePreset,isNativeProvider,matchesAgentHost,outputRatios,queueInputs,queueReferences,referenceCompatibility,selectedPreset,REFERENCE_LABELS} from './generation-models.mjs';
import {IMAGE_API_PRESETS,validateImageApiPreset} from './image-api-presets.mjs';
import {portraitUrl} from './catalog.mjs';
import {updateBatchHistory} from './batch-history.mjs';

const PREVIOUS_DEFAULT_TEMPLATE=`请结合提供的参考图，融合成一张完整的人物图像：
• 【图1（人像参考）】：保持上传主角的五官脸型、身份、发色与发型气质一致，不添加未出现在参考图中的固定发型描述。
• 【图2（服装参考）】：穿上服装参考中的完整服饰「{{costume}}」，还原面料质感、颜色、图案与剪裁。
• 【图3（姿势参考）】：身体姿态与镜头透视遵循姿势参考「{{pose}}」【{{angle}}】，仅参考骨架动作，忽略素体白模材质。
• 【画风要求】：写实商业摄影级质感，85mm 人像镜头，自然柔和光影，真实肌肤纹理与织物细节，8k 高清画质。人物比例协调，手部与五官自然，光影统一。
输出比例：{{ratio}}。每个任务单独生成一张图片，不拼图。
{{notes}}`;

export const DEFAULT_TEMPLATE=PREVIOUS_DEFAULT_TEMPLATE.replace(
  '• 【画风要求】',
  '• 【背景要求】：若未另行指定，使用中性浅灰色无缝影棚背景，地面与背景自然过渡，无布景和道具。\n• 【画风要求】'
);

export function initialState(){return {version:1,revision:0,assets:{},providerPresets:[],draft:{portraitId:null,costumeIds:[],poseIds:[],ratio:'3:4',template:DEFAULT_TEMPLATE,notes:'',provider:'codex',providerPresetId:null},tasks:[],batch:null};}
const uid=()=>randomUUID();
function referenceNetworkError(error){
  const causes=[error,error.cause,...(error.cause?.errors||[])].filter(Boolean);
  const codes=[...new Set(causes.map(c=>c.code).filter(c=>typeof c==='string'))];
  let reason='与图库的网络请求失败，请检查网络后重试。';
  if(causes.some(c=>c.name==='TimeoutError')||codes.some(c=>/TIMEOUT|ETIMEDOUT/.test(c)))reason='连接图库超时，请稍后重试。';
  else if(codes.some(c=>c==='ENOTFOUND'||c==='EAI_AGAIN'))reason='无法解析图库域名（DNS），请检查网络后重试。';
  else if(codes.some(c=>/CERT|TLS|SSL/.test(c)))reason='无法建立到图库的 HTTPS 安全连接。';
  else if(codes.some(c=>['ECONNRESET','UND_ERR_SOCKET'].includes(c)))reason='下载时网络连接中断，请稍后重试。';
  else if(codes.includes('ECONNREFUSED'))reason='图库服务器拒绝了网络连接，请稍后重试。';
  return Error(reason+(codes.length?'\n网络错误码：'+codes.join('、'):''),{cause:error});
}
function retainedTasks(state){
  const active=state.batch&&['draft','queued','running','paused'].includes(state.batch.status);
  return state.tasks.filter(t=>t.status!=='failed'||(active&&t.batchId===state.batch.id));
}
export function imageType(b){
  if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'.png'};
  if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return {mime:'image/jpeg',ext:'.jpg'};
  if(b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'.webp'};
  throw Error('仅支持有效的 PNG、JPEG、WebP 图片');
}
export class Store{
  constructor(root=process.env.CHARACTER_STUDIO_HOME||path.join(os.homedir(),'.character-studio'),{builtinPresets=IMAGE_API_PRESETS}={}){this.builtinPresets=builtinPresets.map(p=>({...validatePreset(p),builtin:true}));this.root=path.resolve(root);this.file=path.join(this.root,'state.json');this.chain=Promise.resolve();}
  async init(){
    await mkdir(path.join(this.root,'assets'),{recursive:true});
    try{this.state=JSON.parse(await readFile(this.file,'utf8'));if(this.state.version!==1)throw Error('不支持此数据版本');}
    catch(e){if(e.code!=='ENOENT')throw e;this.state=initialState();await this.persist();}
    if(this.state.draft.template===PREVIOUS_DEFAULT_TEMPLATE)await this.mutate(()=>{
      if(this.state.draft.template===PREVIOUS_DEFAULT_TEMPLATE)this.state.draft.template=DEFAULT_TEMPLATE;
    });
    const alive=pid=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}};
    if(this.state.tasks.some(t=>t.status==='running'&&!alive(t.workerPid)))await this.mutate(()=>{
      const {tasks,batch}=this.state;
      const interrupted=tasks.filter(t=>t.status==='running'&&!alive(t.workerPid));
      for(const task of interrupted){
        task.status='interrupted';task.error='上次执行中断，可在任务卡重做。';
      }
      if(batch&&interrupted.some(t=>t.batchId===batch.id)&&['queued','running'].includes(batch.status)){
        batch.status='paused';
        if(batch.provider==='agent')batch.resumeOnReconnect=true;
      }
    });
    if(this.state.batch?.status==='awaiting-approval')await this.mutate(()=>{
      const {batch,execution}=this.state;
      if(batch?.status!=='awaiting-approval')return;
      batch.status=this.state.tasks.some(t=>t.batchId===batch.id&&t.status==='pending')?'queued':'done';
      if(execution?.batchId===batch.id)delete this.state.execution;
    });
    if(!this.state.batches||retainedTasks(this.state).length!==this.state.tasks.length)await this.mutate(()=>{});
    return this;
  }
  async persist(){updateBatchHistory(this.state);this.state.tasks=retainedTasks(this.state);this.state.revision++;const tmp=this.file+'.'+uid()+'.tmp';await writeFile(tmp,JSON.stringify(this.state,null,2));await rename(tmp,this.file);}
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
  availablePresets(){return [...this.builtinPresets.map(p=>p.provider==='image-custom'&&this.state.imageApiCustom?{...validateImageApiPreset({...p,...this.state.imageApiCustom}),builtin:true}:p),...(this.state.providerPresets||[])];}
  saveImageApiConfig(config){const validated=validateImageApiPreset({...config,id:'image-custom:default',provider:'image-custom'},{requireConfigured:true});return this.mutate(()=>{this.state.imageApiCustom={baseUrl:validated.baseUrl,model:validated.model,protocol:validated.protocol};return this.snapshot();});}
  renameBatch(id,name){return this.mutate(()=>{
    updateBatchHistory(this.state);
    const batch=Object.hasOwn(this.state.batches,id)?this.state.batches[id]:null;
    if(!batch)throw Error('找不到这个批次，请刷新后重试。');
    if(typeof name!=='string'||name.trim().length>80||/[\x00-\x1f\x7f]/.test(name))throw Error('批次名称最多 80 个字符，不能包含控制字符。');
    batch.name=name.trim();return this.snapshot();
  });}
  snapshot(){updateBatchHistory(this.state);return structuredClone({...this.state,providerPresets:this.availablePresets(),tasks:retainedTasks(this.state)});}
  async putImage(bytes,name,kind='portrait',sourceId){
    if(bytes.length>12*1024*1024)throw Error('单张图片不能超过 12 MB');
    const type=imageType(bytes),hash=createHash('sha256').update(bytes).digest('hex');
    const id=sourceId?kind+':'+sourceId:kind+'-'+hash.slice(0,20),file=path.join(this.root,'assets',hash+type.ext);
    await writeFile(file,bytes);
    return this.mutate(()=>{
      const asset={id,kind,name:path.basename(name).slice(0,180),mime:type.mime,path:file,createdAt:new Date().toISOString(),...(sourceId?{sourceId}:{})};
      this.state.assets[id]=asset;if(kind==='portrait')this.state.draft.portraitId=id;return asset;
    });
  }
  async selectPortrait(item){
    const id='portrait:'+item.id;
    const cached=(await this.refresh()).assets[id];
    if(cached?.path){
      const exists=await access(cached.path).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;});
      if(exists){
        await this.saveDraft({portraitId:id});
        return cached;
      }
    }
    const response=await fetch(portraitUrl(item.url,'full'),{signal:AbortSignal.timeout(25000),redirect:'error'});
    if(!response.ok||!response.body)throw Error('人像原图读取失败（HTTP '+response.status+'），请重试。');
    const chunks=[];
    let size=0;
    for await(const chunk of response.body){
      size+=chunk.length;
      if(size>12*1024*1024)throw Error('人像原图超过 12 MB，请选择另一张。');
      chunks.push(chunk);
    }
    return this.putImage(Buffer.concat(chunks),item.name+' · '+item.id,'portrait',item.id);
  }
  async addReference(item){
    if(!['costume','pose'].includes(item.kind)||!item.id||!item.url)throw Error('参考图类型或编号无效');
    const expected=item.kind==='pose'?'https://ai-pose-depth-gallery.pages.dev/':'https://ai-costume-gallery.pages.dev/';
    for(const u of [item.url,item.thumb])if(u&&!(new URL(u).href.startsWith(expected)))throw Error('参考图必须来自指定图库');
    const key=item.kind+':'+item.id;
    return this.mutate(()=>{const previous=this.state.assets[key],cached=previous?.url===item.url?{path:previous.path,mime:previous.mime}:{};this.state.assets[key]={...cached,...item,id:key,sourceId:item.id};return this.state.assets[key];});
  }
  saveDraft(patch){return this.mutate(()=>{
    const {draft:d,batch}=this.state;
    if(batch?.status==='draft'&&!batch.inputs)batch.inputs=queueInputs(d,batch.provider||'codex',batch.providerPreset);
    if(patch.provider!==undefined){d.provider=checkProvider(patch.provider);if(isNativeProvider(d.provider)||!this.availablePresets().some(p=>p.id===d.providerPresetId&&p.provider===d.provider))d.providerPresetId=null;}
    if(patch.agentHost!==undefined)d.agentHost=patch.agentHost;
    if(patch.providerPresetId!==undefined){if(patch.providerPresetId!==null&&!this.availablePresets().some(p=>p.id===patch.providerPresetId&&p.provider===(d.provider||'codex')))throw Error('该模型预设不属于所选渠道');d.providerPresetId=patch.providerPresetId;}
    for(const key of ['costumeIds','poseIds'])if(patch[key]){
      if(!Array.isArray(patch[key])||patch[key].some(id=>this.state.assets[id]?.kind!==(key==='poseIds'?'pose':'costume')))throw Error('选择包含无效的参考图');
      d[key]=[...new Set(patch[key])];
    }
    if(patch.portraitId!==undefined){if(patch.portraitId!==null&&this.state.assets[patch.portraitId]?.kind!=='portrait')throw Error('主角图片无效');d.portraitId=patch.portraitId;}
    const ratios=outputRatios(selectedPreset(this.availablePresets(),d.provider||'codex',d.providerPresetId));
    if(patch.ratio!==undefined){
      if(!ratios.includes(patch.ratio))throw Error('当前模型不支持这个图片比例');
      d.ratio=patch.ratio;
    }else if((patch.provider!==undefined||patch.providerPresetId!==undefined)&&ratios.length&&!ratios.includes(d.ratio)){
      d.ratio=ratios.includes('3:4')?'3:4':ratios[0];
    }
    for(const key of ['template','notes'])if(patch[key]!==undefined){if(typeof patch[key]!=='string'||patch[key].length>12000)throw Error('提示词过长');d[key]=patch[key];}
    return this.snapshot();
  });}
  useLocalCodex(expectedBatchId){return this.mutate(()=>{
    const {batch,draft,tasks}=this.state;
    if((batch?.id??null)!==expectedBatchId)throw Error('当前批次已变化，请刷新后再试。');
    if(!isNativeProvider(draft.provider||'codex'))throw Error('请先选择当前 Agent 生图。');
    const active=batch&&['queued','running','paused'].includes(batch.status);
    if(active&&batch.provider!=='agent'&&batch.provider!=='codex')throw Error('当前批次正在使用其他生图渠道。');
    if(active&&tasks.some(task=>task.batchId===batch.id&&task.status==='running'))throw Error('当前图片已被领取，请等它完成再切换。');
    const matchingPreview=batch?.status==='draft'&&batch.provider==='agent'&&batch.inputs===queueInputs(draft,'agent',null);
    draft.provider='codex';
    draft.agentHost='codex';
    draft.providerPresetId=null;
    if(active||matchingPreview){
      batch.provider='codex';
      delete batch.agentHost;
      batch.providerPreset=null;
      for(const task of tasks){
        if(task.batchId===batch.id&&task.status==='pending'){task.provider='codex';task.providerPreset=null;delete task.agentHost;}
      }
      if(matchingPreview)batch.inputs=queueInputs(draft,'codex',null);
      if(batch.resumeOnReconnect){batch.status='queued';delete batch.resumeOnReconnect;}
      if(batch.status==='queued')delete this.state.execution;
    }
    return this.snapshot();
  });}
  saveProviderPreset(preset){const validated=validatePreset(preset);return this.mutate(()=>{
    const presets=this.state.providerPresets??=[];if(validated.id&&!presets.some(p=>p.id===validated.id))throw Error('找不到该模型预设');
    const saved={...validated,id:validated.id||uid()};const at=presets.findIndex(p=>p.id===saved.id);if(at<0)presets.push(saved);else presets[at]=saved;return saved;
  });}
  deleteProviderPreset(id){return this.mutate(()=>{this.state.providerPresets=(this.state.providerPresets||[]).filter(p=>p.id!==id);if(this.state.draft.providerPresetId===id)this.state.draft.providerPresetId=null;return this.snapshot();});}
  updateRemoteTask(taskId,patch){return this.mutate(()=>{const t=this.state.tasks.find(t=>t.id===taskId);if(t?.status==='running')for(const key of ['remoteTaskId','providerStatus','outputUrl'])if(patch[key]!==undefined)t[key]=String(patch[key]);});}
  prompt(costume,pose,draft=this.state.draft){
    let template=draft.template;
    if(!costume||!pose){
      template=template.split('\n').filter(line=>
        (costume||!line.includes('【图2（服装参考）】'))&&
        (pose||!line.includes('【图3（姿势参考）】'))
      ).join('\n');
      if(!costume&&pose)template=template.replace('【图3（姿势参考）】','【图2（姿势参考）】');
    }
    const values={costume:costume?.name||'主角原图的服装',pose:pose?.name||'主角原图的姿势',angle:pose?.angle||'参考图视角',ratio:draft.ratio,notes:draft.notes};
    const prompt=template.replace(/\{\{(costume|pose|angle|ratio|notes)\}\}/g,(_,key)=>values[key]);
    if(costume&&pose)return prompt;
    return [
      prompt.trim(),
      !costume&&'保留主角原图的服装。',
      !pose&&'保留主角原图的姿势。'
    ].filter(Boolean).join('\n');
  }
  buildQueue(){return this.mutate(()=>{
    const s=this.state,d=s.draft;
    const provider=d.provider||'codex',providerPreset=selectedPreset(this.availablePresets(),provider,d.providerPresetId);
    if(!isNativeProvider(provider)&&!providerPreset)throw Error('请选择可用的生图模型');
    if(providerPreset?.kind==='image-api')validateImageApiPreset(providerPreset,{requireConfigured:true});
    if(!d.portraitId)throw Error('请先上传主角图片');
    const {costumes,poses,count}=queueReferences(d),ratio=d.ratio;
    if(!count)throw Error('请至少选择一套服装或一个姿势');
    const kinds=['portrait',...(costumes[0]?['costume']:[]),...(poses[0]?['pose']:[])];
    const problem=referenceCompatibility(providerPreset,kinds,ratio);
    if(problem)throw Error(problem);
    if(s.batch&&['queued','running','paused'].includes(s.batch.status))throw Error('请先完成或取消当前批次');
    if(count>200)throw Error('每批最多 200 个任务，请减少选择');
    const batchId=uid(),agentTarget=provider==='agent'&&d.agentHost?{agentHost:d.agentHost}:{};
    s.tasks=s.tasks.filter(t=>t.status==='done'||t.status==='failed'||t.status==='interrupted');
    for(const c of costumes)for(const p of poses)s.tasks.push({id:uid(),batchId,portraitId:d.portraitId,costumeId:c,poseId:p,prompt:this.prompt(s.assets[c],s.assets[p]),ratio,provider,...agentTarget,providerPreset:providerPreset?structuredClone(providerPreset):null,status:'pending',createdAt:new Date().toISOString(),attempts:0});
    s.batch={id:batchId,status:'draft',portraitId:d.portraitId,inputs:queueInputs(d,provider,providerPreset),provider,...agentTarget,providerPreset:providerPreset?structuredClone(providerPreset):null,createdAt:new Date().toISOString()};delete s.execution;return this.snapshot();
  });}
  patchTask(taskId,patch){return this.mutate(()=>{
    const s=this.state,t=s.tasks.find(t=>t.id===taskId);if(!t)throw Error('找不到任务');
    if(s.batch?.status!=='draft'||t.batchId!==s.batch.id)throw Error('只能调整提交前的当前队列');
    if(patch.remove){s.tasks=s.tasks.filter(t=>t.id!==taskId);return this.snapshot();}
    const costumeId=patch.costumeId===undefined?t.costumeId:patch.costumeId;
    const poseId=patch.poseId===undefined?t.poseId:patch.poseId;
    for(const [id,kind]of [[costumeId,'costume'],[poseId,'pose']]){
      if(id&&s.assets[id]?.kind!==kind)throw Error('参考图无效');
    }
    if(!costumeId&&!poseId)throw Error('请保留一张服装或姿势参考图');
    const problem=referenceCompatibility(t.providerPreset,['portrait',...(costumeId?['costume']:[]),...(poseId?['pose']:[])],t.ratio);
    if(problem)throw Error(problem);
    if(costumeId!==t.costumeId||poseId!==t.poseId){
      t.costumeId=costumeId;t.poseId=poseId;
      t.prompt=this.prompt(s.assets[costumeId],s.assets[poseId],{...s.draft,ratio:t.ratio});
    }
    if(patch.prompt!==undefined){if(typeof patch.prompt!=='string'||patch.prompt.length>16000)throw Error('提示词无效');t.prompt=patch.prompt;}return this.snapshot();
  });}
  batchAction(action){return this.mutate(()=>{
    const b=this.state.batch;if(!b)throw Error('请先建立队列');
    if(action==='start'){
      if(b.status!=='draft')throw Error('该批次已提交');
      const pending=this.state.tasks.filter(t=>t.batchId===b.id&&t.status==='pending');
      if(!pending.length)throw Error('队列为空');
      if(pending.some(t=>t.outputStyle==='three-view'))throw Error('请重新预览当前搭配后生成');
      b.status='queued';
    }
    else if(action==='pause'){if(['queued','running','paused'].includes(b.status)){b.status='paused';delete b.resumeOnReconnect;}}
    else if(action==='continue'){if(b.status!=='paused')throw Error('当前批次无需继续');b.status='queued';delete b.resumeOnReconnect;delete this.state.execution;}
    else if(action==='cancel'){b.status='cancelled';delete b.resumeOnReconnect;delete this.state.execution;this.state.tasks.filter(t=>t.batchId===b.id&&['pending','running'].includes(t.status)).forEach(t=>t.status='cancelled');}
    else throw Error('未知批次操作');return this.snapshot();
  });}
  async downloadAsset(id){
    const a=this.state.assets[id];if(!a)throw Error('参考图不存在');if(a.path){try{await access(a.path);return a.path;}catch(e){if(e.code!=='ENOENT')throw e;delete a.path;delete a.mime;if(a.kind==='portrait')throw Error('主角图片文件已丢失，请重新上传。');}}
    if(!a.url)throw Error('参考图没有来源');
    let r,bytes;
    const host=new URL(a.url).hostname;
    try{
      r=await fetch(a.url,{headers:{'User-Agent':'CharacterStudio/0.1 reference-fetch'},signal:AbortSignal.timeout(30000),redirect:'error'});
      if(r.ok)bytes=Buffer.from(await r.arrayBuffer());
    }catch(e){
      const failure=referenceNetworkError(e);
      throw Error(failure.message+'\n图库来源：'+host,{cause:failure});
    }
    if(!r.ok){
      const reason=r.status===404?'图库中找不到这张原图，请重新选择。':'图库未返回原图，请稍后重试或重新选择。';
      throw Error(reason+'（HTTP '+r.status+'）\n图库来源：'+host);
    }
    if(bytes.length>20*1024*1024)throw Error('参考图超过 20 MB，请重新选择。');
    const type=imageType(bytes),f=path.join(this.root,'assets',createHash('sha256').update(bytes).digest('hex')+type.ext);await writeFile(f,bytes);a.path=f;a.mime=type.mime;return f;
  }
  claimNext(expectedBatchId,agentClaim){return this.mutate(async()=>{
    const s=this.state,b=s.batch;
    if(expectedBatchId&&b?.id!==expectedBatchId)return {task:null,batch:b};
    if(b?.provider==='agent'&&!matchesAgentHost(b.agentHost,agentClaim?.agentName))return {task:null,batch:b,reason:'different_agent'};
    if(agentClaim?.reconnect&&b?.provider==='agent'&&b.status==='paused'&&b.resumeOnReconnect){
      b.status='queued';delete b.resumeOnReconnect;delete s.execution;
    }
    if(!b||!['queued','running'].includes(b.status))return {task:null,batch:b};
    if(s.tasks.some(t=>t.batchId===b.id&&t.status==='running'))throw Error('已有任务执行中，请先回填结果');
    while(true){
    const t=s.tasks.find(t=>t.batchId===b.id&&t.status==='pending');if(!t){b.status='done';return {task:null,batch:b};}
    const refs=[];
    let referenceError;
    for(const [kind,id] of [['portrait',t.portraitId],['costume',t.costumeId],['pose',t.poseId]]){
      if(!id)continue;
      try{refs.push({kind,path:await this.downloadAsset(id),id});}
      catch(e){
        const asset=s.assets[id],label=REFERENCE_LABELS[kind]+'参考图';
        const identifier=asset?.sourceId||(kind==='portrait'?asset?.name:id);
        referenceError='准备'+label+(identifier?'「'+identifier+'」':'')+'失败：'+e.message;
        break;
      }
    }
    if(referenceError){
      t.status='failed';t.error=referenceError;t.finishedAt=new Date().toISOString();
      b.failedCount=(b.failedCount||0)+1;b.lastError=referenceError.split('\n')[0];
      continue;
    }
    t.status='running';t.workerPid=process.pid;t.attempts++;t.startedAt=new Date().toISOString();b.status='running';
    if(agentClaim){
      t.agentDeadline=Date.now()+agentClaim.receiptMs;
      delete t.agentAcknowledgedAt;
      s.execution={batchId:b.id,phase:'claimed',message:'已领取任务，等待 Agent 确认收到并开始生成。'};
    }
    return {task:{...t,references:refs},batch:b};
    }
  });}
  acknowledgeAgentTask(taskId,processingMs){return this.mutate(()=>{
    const s=this.state,t=s.tasks.find(t=>t.id===taskId&&t.status==='running');
    if(!t?.agentDeadline||t.agentDeadline<=Date.now()||s.batch?.id!==t.batchId)throw Error('任务未领取或已超时，请重新连接工作台。');
    if(!t.agentAcknowledgedAt){
      t.agentAcknowledgedAt=new Date().toISOString();
      t.agentDeadline=Date.now()+processingMs;
      s.execution={batchId:t.batchId,phase:'generating',message:'Agent 已确认收到任务，正在生成。'};
    }
    return {taskId,deadline:t.agentDeadline};
  });}
  async recordResult(taskId,{filePath,base64,error}){
    const supplied=[filePath,base64,error].filter(v=>typeof v==='string'&&v.trim());
    if(supplied.length!==1)throw Error('回填时请提供一项：真实图片绝对路径、图片 base64 或失败原因。');
    let asset;
    if(!error){
      if(filePath&&!path.isAbsolute(filePath))throw Error('请提供真实生成图片的本机绝对路径。');
      if(base64&&!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error('请传纯 base64 图片内容，不含 data: 前缀。');
      const bytes=base64?Buffer.from(base64,'base64'):await readFile(await realpath(filePath));
      asset=await this.putImage(bytes,path.basename(filePath||'generated'+imageType(bytes).ext),'result');
    }
    return this.mutate(()=>{
      const s=this.state,t=s.tasks.find(t=>t.id===taskId);if(!t||t.status!=='running')throw Error('该任务未在执行中，不能回填结果');
      t.status=error?'failed':'done';t.error=error||null;t.resultId=asset?.id||null;t.finishedAt=new Date().toISOString();
      const b=s.batch;if(error&&b?.id===t.batchId){b.failedCount=(b.failedCount||0)+1;b.lastError=error;}
      if(b?.id===t.batchId&&!['paused','cancelled'].includes(b.status)){
        const remain=s.tasks.some(t=>t.batchId===b.id&&t.status==='pending');
        b.status=remain?'queued':'done';
      }
      return this.snapshot();
    });
  }
  retry(taskId){return this.mutate(()=>{
    const s=this.state,t=s.tasks.find(t=>t.id===taskId);if(!t||!['done','failed','interrupted'].includes(t.status))throw Error('该任务无法重做');
    if(t.outputStyle==='three-view')throw Error('该记录仅供查看，请创建新的单张人物图任务');
    if(s.batch&&s.tasks.some(t=>t.batchId===s.batch.id&&['pending','running'].includes(t.status))&&s.batch.status!=='cancelled')throw Error('请先处理当前批次');
    const id=uid(),createdAt=new Date().toISOString();s.tasks.push({...t,id,batchId:id,status:'pending',resultId:null,error:null,attempts:0,remoteTaskId:null,providerStatus:null,outputUrl:null,createdAt});s.batch={id,status:'queued',portraitId:t.portraitId,createdAt,provider:t.provider||'codex',...(t.agentHost?{agentHost:t.agentHost}:{}),providerPreset:t.providerPreset||null};delete s.execution;return this.snapshot();
  });}
  async image(id){const a=this.state.assets[id];if(!a?.path)throw Error('本地图片不存在');const bytes=await readFile(a.path);return {mime:a.mime||imageType(bytes).mime,base64:bytes.toString('base64')};}
}
