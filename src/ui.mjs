import {App} from '@modelcontextprotocol/ext-apps';
import {ArrowDown,createElement} from 'lucide';
import {VERSION} from './version.mjs';
import {PROVIDERS,isNativeProvider,matchesAgentHost,outputRatios,queueInputs,queueReferences,referenceCompatibility,selectedPreset} from './generation-models.mjs';
import {batchLabel,resultFilename} from './batch-history.mjs';
import {IMAGE_API_SERVICES,isImageApi,imageApiService} from './image-api-presets.mjs';
const $=id=>document.getElementById(id);
const downloadIcon=createElement(ArrowDown,{width:20,height:20,'stroke-width':1.5,'aria-hidden':'true',focusable:'false'}).outerHTML;
for(const icon of document.querySelectorAll('[data-download-icon]'))icon.outerHTML=downloadIcon;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let app,state,kind='costume',offset=0,pageSize=12,items=[],total=0,queryId=0,editing=null,referencePreview=null,saving=Promise.resolve(),referenceOps=Promise.resolve(),dispatching=false,preparing=false,submitting=false;
let channels={providers:PROVIDERS,credentials:{}},probeId=0;
let keyProvider,keyRequest,lastApi='image-openai';
let testTarget;
const historyExpanded=new Set(),historyNames=new Map(),historyBusy=new Set(),historyFeedback=new Map();
let historyNewest;
let agentConnection,nativeProvider,channelProbe,verifiedCheckId;
const hostMessaging=()=>!!(app?.getHostCapabilities()?.message?.text||window.openai?.sendFollowUpMessage);
const hostName=()=>app?.getHostVersion()?.name||'当前 Agent';
const doubaoPage=new URLSearchParams(location.search).get('host')==='doubao';
const doubaoHost=()=>doubaoPage||/豆包|doubao/i.test(hostName());
const selectedAgent=()=>state.draft.agentHost||state.channelSetup?.agentHost||(doubaoHost()?'doubao':null);
const batchAgent=()=>state.batch?.agentHost||selectedAgent();
const codexMessaging=()=>hostMessaging()&&!doubaoHost();
const codexChat=()=>codexMessaging()&&(/codex|chatgpt|openai/i.test(hostName())||!!window.openai?.sendFollowUpMessage);
const matchesConnection=(connection,host)=>!!connection?.connected&&matchesAgentHost(host,connection.agentName);
const connectedFor=host=>matchesConnection(agentConnection,host);
const doubaoHandoff='处理工作台里待生成的图片';
const agentReconnect='重新连接人物工作台';
const reconnectInstruction='回到打开工作台的聊天（如 Codex 或豆包），发送「重新连接人物工作台」。';
const reconnectAndCheck=reconnectInstruction+' 连接后会继续待生成任务。';
const agentTaskInstructions='请按 Character Studio 技能流程执行。先确认本会话能查看参考图、生成图片并取得真实图片文件或字节。缺少能力时调用 agent_unavailable 或 CLI unavailable 回报原因。具备能力时调用 agent_wait 持续等待并领取任务，空闲时以相同 sessionId 立即续等；命令行使用 wait --follow。收到任务后逐张查看实际提供的 task.references，调用 agent_ack_task（或 CLI ack --task 任务ID），再按 task.prompt 生图。调用 record_result 回填 taskId 加真实文件绝对路径或纯 base64，或用 error 回填失败原因。isCapabilityTest=true 时是独立测试，可能没有参考图，回填后结束本次测试。普通任务回填后继续领取，处理整批。不要生成占位图。';
const currentNative=()=>{
  if(selectedAgent()==='doubao')return 'agent';
  if(selectedAgent()==='codex')return codexChat()?'agent':'codex';
  return hostMessaging()||agentConnection?.connected?'agent':nativeProvider||'agent';
};
const selectedProvider=()=>isNativeProvider(state.draft.provider||'codex')?currentNative():state.draft.provider;
const selectedCheckKey=()=>selectedProvider()==='agent'?'agent:'+(selectedAgent()||'current'):selectedProvider();
function generationReadiness(){
  const provider=selectedProvider(),probe=channelProbe?.provider===provider?channelProbe:null;
  const check=state.generationChecks?.[selectedCheckKey()];
  const connected=provider==='agent'?connectedFor(selectedAgent()):!!probe?.executor;
  const scope=provider==='agent'&&connected?JSON.stringify([agentConnection.agentName,agentConnection.imageTool]):probe?.checkScope;
  const fresh=check&&(check.scope===scope&&scope||provider==='agent'&&!scope)&&Date.now()-Date.parse(check.updatedAt)<24*60*60*1000;
  const running=check&&['preparing','queued','running'].includes(check.status)&&check.deadline>Date.now();
  const reportedFailure=provider==='agent'&&(agentConnection?.reason||(probe?.unavailable?probe.reason:null));
  const capability=reportedFailure?'failed':fresh&&check.status==='verified'?'confirmed':fresh&&check.status==='failed'?'failed':provider==='agent'&&(connected&&agentConnection.imageTool||probe?.toolConfirmed)?'declared':'unknown';
  const reason=reportedFailure||(capability==='failed'?check?.reason:provider==='agent'?agentConnection?.reason||probe?.reason:probe?.reason);
  const blocked=running||provider==='codex'&&capability!=='confirmed'||!isNativeProvider(provider)&&!probe?.available||provider==='agent'&&(capability==='failed'||Boolean(agentConnection?.reason)||probe?.unavailable===true);
  return {provider,probe,check,connected,capability,reason,running,blocked};
}
const filters={portrait:{category:'',angle:'',q:''},costume:{category:'',angle:'',q:''},pose:{category:'',angle:'正面',q:''}};
const libraryNames={portrait:'人像',costume:'服装',pose:'姿势'};
const librarySources={portrait:'https://ai-portrait-gallery.pages.dev/',costume:'https://ai-costume-gallery.pages.dev/',pose:'https://ai-pose-depth-gallery.pages.dev/'};
const imageCache=new Map();
function status(text,error=false){
  $('status').textContent=text;$('status').classList.toggle('error',error);
  if($('editor').open){$('edit-error').textContent=error?text:'';$('edit-error').hidden=!error;}
  else if($('combination-preview').open){$('preview-error').textContent=error?text:'';$('preview-error').hidden=!error;}
}
const legacyFetchFailure='网络请求失败。这条旧记录没有保存出错环节或错误码。';
function failureSummary(message){
  const firstLine=message.split('\n')[0];
  if(/^准备(?:主角|服装|姿势)参考图/.test(firstLine))return firstLine;
  if(firstLine==='fetch failed')return legacyFetchFailure;
  if(/moderation_blocked|safety system|safety_violations/.test(message))return '生图工具的安全检查拒绝了本次请求，未返回图片。';
  if(/未.*登录|login|not authenticated/i.test(message))return '当前生图渠道尚未登录，请检查账号连接。';
  if(/未提供.*工具|工具.*不可用|unavailable|no.*image.*tool/i.test(message))return '当前 Agent 未提供可用的生图工具。';
  if(/超时|timeout/i.test(message))return '生图执行超时，任务已停止。';
  return firstLine.slice(0,180);
}
async function rawCall(name,args={}){
  let r;
  if(app)r=await app.callServerTool({name,arguments:args});
  else if(window.openai?.callTool)r=await window.openai.callTool(name,args);
  else{const res=await fetch('/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});if(!res.ok)throw Error((await res.json()).error||'本地连接失败');r=await res.json();}
  if(r.isError)throw Error(r.content?.find(x=>x.type==='text')?.text||'操作失败');return r;
}
async function call(name,args={}){return (await rawCall(name,args)).structuredContent;}
async function imageURL(id){
  if(imageCache.has(id))return imageCache.get(id);
  const promise=rawCall('read_image',{id}).then(r=>{const i=r._meta.image;return 'data:'+i.mime+';base64,'+i.base64;}).catch(e=>{imageCache.delete(id);throw e});imageCache.set(id,promise);return promise;
}
function persist(patch){saving=saving.then(async()=>{state=await call('save_draft',{patch});if(isNativeProvider(patch.provider))nativeProvider=patch.provider;renderState();}).catch(e=>status(e.message,true));return saving;}
async function refresh(){
  const s=await call('get_state');
  const connectionChanged=JSON.stringify(s.agentConnection)!==JSON.stringify(agentConnection);
  agentConnection=s.agentConnection;
  if((!state||s.revision>=state.revision)&&isNativeProvider(s.draft.provider||'codex'))nativeProvider=s.draft.provider||'codex';
  if(!state||s.revision>state.revision){state=s;renderState();}
  else if(connectionChanged)renderState();
}
const statuses={pending:'待生成',running:'生成中',done:'已完成',failed:'失败',interrupted:'已中断',cancelled:'已取消'};
function currentPreview(){
  const {draft,batch,providerPresets}=state;
  if(batch?.status!=='draft')return false;
  const provider=selectedProvider(),preset=selectedPreset(providerPresets||[],provider,draft.providerPresetId);
  if(state.tasks.some(t=>t.batchId===batch.id&&t.outputStyle==='three-view'))return false;
  return (batch.agentHost??null)===(provider==='agent'?selectedAgent():null)&&(!batch.inputs||batch.inputs===queueInputs(draft,provider,preset));
}
function taskResultFilename(task){
  const batch=state.batches?.[task.batchId],siblings=state.tasks.filter(t=>t.batchId===task.batchId&&t.status==='done');
  return batch?resultFilename(batch,task,state.assets,siblings.findIndex(t=>t.id===task.id)):'character-result.png';
}
function resultCard(task){
  const id=esc(task.resultId);
  return '<div class="result-frame"><button class="tile" type="button" data-view="'+id+'" aria-label="查看结果大图"><img class="result-image" data-result-image="'+id+'" alt="真实生成结果"></button><a class="result-download" data-download-result="'+id+'" aria-label="下载原图" aria-disabled="true" title="下载原图" download="'+esc(taskResultFilename(task))+'">'+downloadIcon+'</a></div>';
}
function renderPreview(){
  const tasks=state.batch?.status==='draft'?state.tasks.filter(t=>t.batchId===state.batch.id&&t.status==='pending'):[];
  $('preview-count').textContent=tasks.length?'共 '+tasks.length+' 张图片。可以调整或删除单张组合。':'当前没有组合。';
  $('restore-combinations').hidden=tasks.length!==0||state.batch?.status!=='draft';
  const thumbnail=(id,label)=>{
    const asset=state.assets[id];
    return '<div>'+(asset?.thumb?'<img src="'+esc(asset.thumb)+'" alt="'+esc(label)+'" loading="lazy" referrerpolicy="no-referrer">':'')+
      '<small title="'+esc(asset?.name||'')+'">'+label+' '+esc((asset?.sourceId||'').replace(/^(full_single|full_sexy|upper80v2|pair60)_/,''))+'</small></div>';
  };
  $('preview-list').innerHTML=tasks.map(t=>'<article class="preview-card"><div class="preview-pair">'+
    (t.costumeId?thumbnail(t.costumeId,'服装'):'<small>沿用原服装</small>')+
    (t.poseId?thumbnail(t.poseId,'姿势'):'<small>沿用原姿势</small>')+'</div><div class="job-actions">'+
    '<button type="button" data-edit="'+t.id+'">调整</button><button type="button" data-delete="'+t.id+'">删除</button></div></article>').join('');
}
function renderState(){
  const d=state.draft,a=state.assets,b=state.batch;
  const {costumes,poses,count:plannedCount}=queueReferences(d);
  const ratio=d.ratio;
  const provider=selectedProvider(),preset=selectedPreset(state.providerPresets||[],provider,d.providerPresetId);
  const kinds=['portrait',...(costumes[0]?['costume']:[]),...(poses[0]?['pose']:[])];
  const modelProblem=!isNativeProvider(provider)&&!preset?'请选择生图模型。':referenceCompatibility(preset,kinds,ratio);
  $('costume-count').textContent=d.costumeIds.length;
  $('pose-count').textContent=d.poseIds.length;
  for(const [field,ids]of [['selected-costumes',d.costumeIds],['selected-poses',d.poseIds]])$(field).innerHTML=ids.map(id=>{
    const ref=a[id],label=(ref?.sourceId||ref?.name||id).replace(/^(full_single|full_sexy|upper80v2|pair60)_/,'');
    return '<div class="selected-reference" title="'+esc((ref?.sourceId||id)+' · '+(ref?.name||''))+'">'+(ref?.thumb?'<img class="selected-reference-image" src="'+esc(ref.thumb)+'" alt="'+esc(ref.name||label)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'<span class="selected-reference-missing" aria-label="预览不可用">—</span>')+'<div class="selected-reference-text"><span>'+esc(label)+'</span><small>'+esc(ref?.angle||ref?.category||'')+'</small></div><button type="button" class="selected-reference-remove" data-remove="'+esc(id)+'" aria-label="移除 '+esc(ref?.name||label)+'">×</button></div>';
  }).join('');
  const ratioSelect=$('ratio'),ratios=outputRatios(preset);
  if(Array.from(ratioSelect.options,o=>o.value).join()!==ratios.join()){
    ratioSelect.replaceChildren(...ratios.map(value=>new Option(value,value)));
  }
  ratioSelect.value=ratio;
  ratioSelect.disabled=!ratios.length;
  for(const [id,val]of [['template',d.template],['notes',d.notes]])if(document.activeElement!==$(id))$(id).value=val;
  const portrait=d.portraitId&&a[d.portraitId];
  $('portrait-name').textContent=portrait?.name||'PNG、JPEG、WebP · 最大 12 MB';
  $('portrait-name').title=portrait?.name||'';
  $('upload-portrait').textContent=portrait?'上传新主角图':'上传主角图';
  if(portrait){
    imageURL(portrait.id).then(url=>{
      if(state.draft.portraitId!==portrait.id)return;
      $('portrait-preview').src=url;
      $('portrait-frame').hidden=false;
    }).catch(e=>status(e.message,true));
  }else $('portrait-frame').hidden=true;
  renderGeneration();
  const busy=['queued','running','paused'].includes(b?.status);
  const preview=currentPreview();
  const count=preview?state.tasks.filter(t=>t.batchId===b.id&&t.status==='pending').length:plannedCount;
  $('combination-count').textContent=count;
  $('build').disabled=busy||dispatching||preparing||!portrait||!plannedCount||!!modelProblem;
  const keyMissing=!isNativeProvider(provider)&&!channels.credentials[provider]?.configured;
  $('submit').disabled=$('build').disabled||!count||keyMissing||generationReadiness().blocked;
  const received=b?.provider!=='agent'||state.tasks.some(t=>t.batchId===b.id&&t.status==='running'&&t.agentAcknowledgedAt);
  $('submit').textContent=submitting||dispatching?'正在提交…':b?.status==='queued'?'等待领取…':b?.status==='running'?(received?'正在生成…':'等待 Agent 确认…'):b?.status==='paused'?(b.resumeOnReconnect?'等待重连…':'任务已暂停'):'生成 '+count+' 张图片';
  $('preview-change').hidden=b?.status!=='draft'||preview;
  if($('combination-preview').open)renderPreview();
  const guide=busy?'':!portrait?'先选择或上传主角。':!plannedCount?'选一套服装或一个姿势。':modelProblem||(keyMissing?'点击「管理 API Key」填写并验证后即可生成。':'');
  $('start-guide').textContent=guide;
  $('start-guide').hidden=!guide;
  $('pause').hidden=!['queued','running'].includes(b?.status)&&!b?.resumeOnReconnect;$('continue').hidden=b?.status!=='paused'||!!b.resumeOnReconnect;$('cancel').hidden=!['draft','queued','running','paused'].includes(b?.status);
  renderExecution();
  renderOnboarding();
  const cards=tasks=>tasks.slice().reverse().map(t=>'<article class="job" data-task-id="'+t.id+'"><div class="job-head"><span>'+esc([a[t.costumeId]?.sourceId,t.outputStyle==='three-view'?'三视图＋特写':a[t.poseId]?.sourceId].filter(Boolean).join(' × ')||'人物图')+'</span><span class="tag '+(t.status==='failed'?'failed':'')+'">'+statuses[t.status]+'</span></div><p class="job-meta">'+esc([a[t.costumeId]?.name,a[t.poseId]?.angle].filter(Boolean).join(' · '))+'</p>'+(t.error?'<div class="job-failure"><strong>失败原因</strong><p>'+esc(failureSummary(t.error))+'</p><details><summary>查看完整信息</summary><p class="error-detail">'+esc(t.error)+'</p></details></div>':'')+(t.resultId?resultCard(t):'')+'<div class="job-actions">'+(t.outputStyle!=='three-view'&&['done','failed','interrupted'].includes(t.status)?'<button type="button" data-retry="'+t.id+'">单张重做</button>':'')+'</div></article>').join('');
  const successes=state.tasks.filter(t=>t.status==='done');
  const activeBatch=b&&['queued','running','paused'].includes(b.status);
  $('jobs').innerHTML=cards(state.tasks.filter(t=>activeBatch&&t.batchId===b.id&&t.status!=='done'));
  $('success-count').textContent=successes.length;
  renderBatchHistory(cards);
  for(const el of document.querySelectorAll('.job')){const t=state.tasks.find(t=>t.id===el.dataset.taskId),label=channels.providers.find(p=>p.id===(t.provider||'codex'))?.name||t.provider;el.querySelector('.job-meta').textContent+=' · '+label+(t.providerPreset?' / '+t.providerPreset.name:'')+(t.remoteTaskId?' · API '+t.remoteTaskId:'');}
  if($('success-history').open)loadSuccessImages();
  renderSelected();
}
function renderGeneration(){
  const d=state.draft,provider=selectedProvider(),presets=(state.providerPresets||[]).filter(p=>p.provider===provider);
  const selected=isNativeProvider(provider)?'agent':'image-api';
  if(isImageApi(provider))lastApi=provider;
  for(const button of $('provider').querySelectorAll('[data-provider]')){
    button.setAttribute('aria-pressed',String(button.dataset.provider===selected));
    button.disabled=channels.available===false;
  }
  const preset=selectedPreset(presets,provider,d.providerPresetId);
  const native=isNativeProvider(provider);
  $('agent-field').hidden=!native;
  $('api-service-field').hidden=native;
  if(!native)$('api-service').value=provider;
  $('provider-preset-field').hidden=native;
  const active=['queued','running','paused'].includes(state.batch?.status);
  $('agent-choice').value=(active?state.batch.agentHost:null)||selectedAgent()||(provider==='codex'||codexMessaging()?'codex':'');
  $('agent-choice').disabled=channels.available===false||preparing||dispatching||active;
  $('provider-preset').innerHTML=native?'':(!preset?'<option value="">请选择模型</option>':'')+
      presets.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+(p.builtin?'（内置）':'')+'</option>').join('');
  $('provider-preset').disabled=isNativeProvider(provider)||!presets.length||presets.length===1&&!!preset;
  $('provider-preset').value=preset?.id||'';
  let hint=channels.available===false?'请重新打开工作台以加载生图渠道。':provider==='agent'?'使用当前聊天里 Agent 已有的生图能力。':provider==='codex'?'使用这台电脑上已登录的 Codex。':'';
  if(channels.available!==false&&provider==='agent'&&selectedAgent()==='doubao')hint='';
  $('provider-hint').textContent=hint;$('provider-hint').hidden=!hint;
  renderApiSetup(provider);
  renderChannelConnection();
}
function keyStatus(message,phase=''){
  const el=$('api-key-status');
  el.hidden=!message;el.textContent=message;el.dataset.state=phase;el.classList.toggle('error',phase==='error');
}
function renderApiSetup(provider){
  const native=isNativeProvider(provider),service=imageApiService(provider);
  $('api-actions').hidden=native;
  if(keyProvider!==provider){keyProvider=provider;$('provider-key').value='';keyStatus('');}
  if(native||!service)return;
  for(const [id,url]of [['api-key-link',service.keyUrl],['api-docs-link',service.docsUrl]]){
    $(id).hidden=!url;if(url)$(id).href=url;else $(id).removeAttribute('href');
  }
  $('api-guide-title').textContent='获取 '+service.name+' API Key';
  $('api-key-steps').innerHTML=service.steps.map(step=>'<li>'+esc(step)+'</li>').join('');
  $('api-key-note').textContent=service.note;
  const credential=channels.credentials[provider];
  $('api-key-title').textContent=service.name+' API Key';
  $('open-api-key').textContent='管理 API Key';
  $('api-key-summary').textContent=credential?.configured?'已配置':'未配置';
  $('api-key-state').textContent=credential?.configured?'Key 已保存在本机。更换时粘贴新 Key，再验证并保存。':'粘贴刚复制的 Key，再点「验证并保存」。';
  $('custom-api-fields').hidden=provider!=='image-custom';
  $('clear-provider-key').hidden=credential?.source!=='local';
  $('save-provider-key').disabled=!!keyRequest;
  $('clear-provider-key').disabled=!!keyRequest;
}
async function loadChannels(){try{channels={...await call('generation_channels'),available:true};}catch(e){if(!/不存在该工具|unknown tool|tool.*not found/i.test(e.message))throw e;channels.available=false;}}
function renderExecution(){
  if(!state)return;const b=state.batch,execution=state.execution?.batchId===b?.id?state.execution:null;
  const task=state.tasks.find(t=>t.batchId===b?.id&&t.status==='running');
  let message=execution?.message||(['queued','running'].includes(b?.status)?'任务已排队，等待执行器领取…':'');
  if(submitting)message='正在保存设置并准备任务…';
  if(dispatching)message='任务已提交，正在联系生图渠道…';
  if(!submitting&&!dispatching&&b?.provider==='agent'){
    if(b.status==='queued')message=connectedFor(batchAgent())?'任务已排队，等待 Agent 领取…':'任务已排队，Agent 尚未领取。'+reconnectAndCheck;
    if(b.status==='running'&&!task?.agentAcknowledgedAt)message='等待 Agent 确认收到任务。';
    if(b.status==='paused'&&b.resumeOnReconnect)message=(execution?.message||'Agent 已断开。')+' '+reconnectAndCheck;
  }
  const doubaoQueue=batchAgent()==='doubao'&&b?.provider==='agent'&&!connectedFor('doubao')&&!submitting&&!dispatching;
  // The agent finishes its result call before it can request the next image.
  const betweenImages=doubaoQueue&&b.status==='queued'&&!agentConnection?.reason&&state.tasks.some(t=>
    t.batchId===b.id&&t.agentAcknowledgedAt&&Date.now()-Date.parse(t.finishedAt)<10000);
  const needsDoubao=Boolean(doubaoQueue&&!betweenImages&&(b.status==='queued'||b.status==='paused'&&b.resumeOnReconnect));
  if(betweenImages)message='等待豆包领取下一张…';
  if(needsDoubao)message=agentConnection?.reason?'任务已保存。豆包暂时无法接手：'+agentConnection.reason:'任务已保存，等待豆包接手。';
  $('doubao-handoff').hidden=!needsDoubao;
  if(!needsDoubao)$('doubao-copy-status').textContent='';
  if(task?.startedAt&&(b.provider!=='agent'||task.agentAcknowledgedAt)){const elapsed=Math.max(0,Math.floor((Date.now()-Date.parse(task.agentAcknowledgedAt||task.startedAt))/1000));message+=' · 已用时 '+Math.floor(elapsed/60)+'分'+String(elapsed%60).padStart(2,'0')+'秒';}
  message=message.replace(/(^|最近失败原因：)fetch failed$/,'$1'+legacyFetchFailure);
  const progress=$('execution-message');
  progress.hidden=!message;progress.textContent=message;
  progress.dataset.working=String(submitting||dispatching||b?.status==='running'||b?.status==='queued'&&(b.provider!=='agent'||connectedFor(batchAgent())));
  progress.classList.toggle('error',!submitting&&!dispatching&&execution?.phase==='failed');
}
function renderBatchHistory(cards){
  const batches=Object.values(state.batches||{}).filter(b=>b.successCount>0).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')||b.id.localeCompare(a.id));
  if(batches.length&&historyNewest!==batches[0].id){historyExpanded.add(batches[0].id);historyNewest=batches[0].id;}
  $('success-results').innerHTML=batches.map(batch=>{
    const id=esc(batch.id),expanded=historyExpanded.has(batch.id),busy=historyBusy.has(batch.id),feedback=historyFeedback.get(batch.id);
    const name=historyNames.get(batch.id)??batch.name;
    const date=batch.createdAt&&Number.isFinite(Date.parse(batch.createdAt))?new Date(batch.createdAt).toLocaleString():'创建时间未记录';
    const failed=batch.countsIncomplete?(batch.failedCount?'至少 '+batch.failedCount+' 张（旧记录不完整）':'未记录'):batch.failedCount+' 张';
    const portrait=state.assets[batch.portraitId];
    const tasks=state.tasks.filter(t=>t.batchId===batch.id&&t.status==='done');
    return '<section class="batch-record" data-history-batch="'+id+'"><div class="batch-heading">'+
      (portrait?'<img class="batch-portrait" data-history-portrait="'+esc(portrait.id)+'" alt="本批主角">':'<span class="small">主角未记录</span>')+
      '<div class="batch-description"><label class="field"><span>批次名称</span><input data-batch-name="'+id+'" aria-label="批次名称" maxlength="80" placeholder="'+esc(batchLabel(batch))+'" value="'+esc(name)+'"'+(busy?' disabled':'')+'></label>'+
      '<time datetime="'+esc(batch.createdAt||'')+'">'+esc(date)+'</time><p>成功 '+batch.successCount+' 张 · 失败 '+esc(failed)+'</p></div></div>'+
      '<div class="job-actions"><button type="button" data-history-action="rename"'+(busy?' disabled':'')+'>保存名称</button>'+
      '<button type="button" data-history-action="download"'+(busy?' disabled':'')+'>下载本批全部图片</button>'+
      '<button type="button" data-history-action="toggle" aria-expanded="'+expanded+'">'+(expanded?'收起图片':'查看 '+batch.successCount+' 张图片')+'</button></div>'+
      '<p class="status'+(feedback?.error?' error':'')+'" data-history-feedback role="status"'+(!feedback?' hidden':'')+'>'+esc(feedback?.text||'')+'</p>'+
      '<div class="batch-results"'+(!expanded?' hidden':'')+'>'+cards(tasks)+'</div></section>';
  }).join('')||'<p class="history-empty">暂无成功结果</p>';
}
function loadSuccessImages(){
  for(const img of $('success-results').querySelectorAll('[data-result-image],[data-history-portrait]')){
    if(img.src||img.closest('[hidden]'))continue;
    imageURL(img.dataset.resultImage||img.dataset.historyPortrait).then(url=>{
      img.src=url;
      const download=img.closest('.result-frame')?.querySelector('[data-download-result]');
      if(download){download.href=url;download.removeAttribute('aria-disabled');}
    }).catch(()=>{img.alt='图片读取失败';});
  }
}
$('success-results').oninput=e=>{if(e.target.dataset.batchName)historyNames.set(e.target.dataset.batchName,e.target.value);};
$('success-results').onclick=async e=>{
  const button=e.target.closest('[data-history-action]');if(!button)return;
  const section=button.closest('[data-history-batch]'),id=section.dataset.historyBatch,action=button.dataset.historyAction;
  if(action==='toggle'){
    const opened=historyExpanded.has(id);if(opened)historyExpanded.delete(id);else historyExpanded.add(id);
    section.querySelector('.batch-results').hidden=opened;button.setAttribute('aria-expanded',String(!opened));
    button.textContent=opened?'查看 '+state.batches[id].successCount+' 张图片':'收起图片';loadSuccessImages();return;
  }
  if(historyBusy.has(id))return;
  historyBusy.add(id);
  const feedback=section.querySelector('[data-history-feedback]');
  const pending=action==='rename'?'正在保存…':'正在准备本批图片…';historyFeedback.set(id,{text:pending});
  feedback.hidden=false;feedback.classList.remove('error');feedback.textContent=pending;
  for(const control of section.querySelectorAll('button,input'))control.disabled=true;
  try{
    let message;
    if(action==='rename'){
      const name=section.querySelector('[data-batch-name]').value;
      state=await call('rename_batch',{batchId:id,name});historyNames.delete(id);message='批次名称已保存。';
    }else{
      const result=await call('download_batch',{batchId:id});
      if(app){const opened=await app.openLink({url:result.downloadUrl});if(opened?.isError)throw Error('无法打开下载链接，请重试。');}
      else{const a=document.createElement('a');a.href=result.downloadUrl;a.download=result.filename;a.click();}
      message='已准备 '+result.count+' 张图片的 ZIP 下载。';
    }
    historyFeedback.set(id,{text:message});
  }catch(error){historyFeedback.set(id,{text:error.message,error:true});}
  finally{historyBusy.delete(id);renderState();}
};
$('open-success-history').onclick=()=>{showTaskDialog($('success-history'),$('open-success-history'));loadSuccessImages();};
$('doubao-prompt').textContent=doubaoHandoff;
$('copy-doubao-handoff').onclick=async()=>{
  try{
    await navigator.clipboard.writeText(doubaoHandoff);
    $('doubao-copy-status').textContent='已复制，回到豆包粘贴并发送。';
  }catch{
    $('doubao-copy-status').textContent='无法自动复制，请选中上面的文字复制。';
  }
};
$('close-success-history').onclick=()=>$('success-history').close();
$('open-disclaimer').onclick=()=>showTaskDialog($('disclaimer'),$('open-disclaimer'));
$('close-disclaimer').onclick=()=>$('disclaimer').close();
function renderSelected(){
  if(!state)return;
  const {portraitId,costumeIds,poseIds}=state.draft;
  const selected={portrait:[portraitId],costume:costumeIds,pose:poseIds}[kind];
  for(const tile of $('gallery').querySelectorAll('[data-select]')){
    const on=selected.includes(kind+':'+tile.dataset.select);
    tile.setAttribute('aria-pressed',String(on));
    tile.querySelector('.tick').hidden=!on;
  }
}
async function catalog(refresh=false){
  const request=++queryId,f={...filters[kind]};
  $('gallery').innerHTML='<p class="empty">正在读取'+libraryNames[kind]+'库…</p>';
  try{
    const result=await call('browse_catalog',{kind,...f,offset,limit:pageSize,refresh});if(request!==queryId)return;
    items=result.items;total=result.total;
    $('category').innerHTML='<option value="">全部分类</option>'+result.categories.map(c=>'<option>'+esc(c)+'</option>').join('');
    if(filters[kind].category&&!result.categories.includes(filters[kind].category)){filters[kind].category='';offset=0;return catalog();}
    $('category').value=f.category;$('angle').hidden=kind!=='pose';$('angle').value=f.angle;
    $('gallery').classList.toggle('fixed-angle',kind==='pose'&&Boolean(f.angle));
    $('library-count').textContent=result.total+' 张匹配 / 全库 '+result.totalInLibrary+' 张';
    $('page-number').textContent=Math.floor(offset/pageSize)+1+' / '+Math.max(1,Math.ceil(total/pageSize));
    $('previous').disabled=offset===0;$('next').disabled=offset+pageSize>=total;
    $('gallery').innerHTML=items.map(d=>'<button class="tile" type="button" data-select="'+esc(d.id)+'" aria-pressed="false" aria-label="选择 '+esc(d.name)+'"><span class="photo"><img src="'+esc(d.thumb)+'" loading="lazy" referrerpolicy="no-referrer" alt="'+esc(d.name)+'"><span class="tick" hidden>✓</span></span><span class="caption"><span>'+esc(d.id.replace(/^(full_single|full_sexy|upper80v2|pair60)_/,''))+'</span><span>'+esc(d.angle||d.category)+'</span></span><span class="name" title="'+esc(d.name)+'">'+esc(d.name)+'</span></button>').join('')||'<p class="empty">没有匹配的参考图</p>';
    renderSelected();
    renderOnboarding();
    for(const img of $('gallery').querySelectorAll('img'))img.onerror=()=>{img.alt='缩略图读取失败';img.parentElement.dataset.failed='true';};
  }catch(e){if(request!==queryId)return;$('gallery').innerHTML='<div class="empty">'+esc(e.message)+'<br><button type="button" id="retry-catalog">重新读取</button></div>';$('retry-catalog').onclick=()=>catalog(true);status(e.message,true);}
}
async function toggleReference(d){
  const {id}=d;
  if(d.kind==='portrait'){
    return changePortrait('正在读取人像原图…',()=>call('select_portrait',{id}),'已从人像库选定主角');
  }
  const key=d.kind==='costume'?'costumeIds':'poseIds';
  referenceOps=referenceOps.then(async()=>{const ref=await call('select_reference',{item:d});const chosen=state.draft[key];await persist({[key]:chosen.includes(ref.id)?chosen.filter(id=>id!==ref.id):[...chosen,ref.id]});}).catch(e=>status(e.message,true));
  return referenceOps;
}
function changePortrait(pending,change,success){
  const message=$('portrait-status');
  referenceOps=referenceOps.then(async()=>{
    message.hidden=false;
    message.classList.remove('error');
    message.textContent=pending;
    await change();
    await refresh();
    message.textContent=success;
  }).catch(e=>{
    message.classList.add('error');
    message.textContent=e.message;
  });
  return referenceOps;
}
async function sendHostMessage(text,title){
  if(app?.getHostCapabilities()?.message?.text){
    const result=await app.sendMessage({role:'user',content:[{type:'text',text}]},{timeout:10000});
    if(result.isError)throw Error('宿主未接收工作台消息');
  }else await window.openai.sendFollowUpMessage({prompt:text,title});
}
async function notifyAgent(){
  if(dispatching)return;dispatching=true;renderState();
  const batchId=state.batch.id;
  try{
    if(state.batch.provider!=='agent')await call('start_generation');
    else{
      const current=await call('get_state');
      if(!matchesConnection(current.agentConnection,batchAgent())&&codexMessaging()&&batchAgent()!=='doubao')await sendHostMessage('请使用宿主名称 Codex。'+agentTaskInstructions,'开始 Character Studio 生图任务');
    }
    status('');
  }catch(e){
    const message='自动提交失败：'+e.message;
    try{await call('report_dispatch_error',{batchId,error:message});}catch{}
    status(message,true);
  }finally{dispatching=false;await refresh();renderState();}
}
function showTaskDialog(dialog,anchor){
  if(app){
    const top=anchor.getBoundingClientRect().top+window.scrollY;
    dialog.classList.add('anchored-dialog');
    dialog.style.top=Math.max(12,top-150)+'px';
  }
  dialog.showModal();
}
function guarded(fn){return async(...args)=>{try{await fn(...args)}catch(e){status(e.message,true)}}}
$('upload-portrait').onclick=()=>$('portrait-file').click();
$('portrait-file').onchange=guarded(async e=>{
  const file=e.target.files[0];if(!file)return;
  e.target.value='';
  await changePortrait('正在保存主角图…',async()=>{
    if(file.size>12*1024*1024)throw Error('主角图不能超过 12 MB');
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('读取主角图片失败'));r.readAsDataURL(file);});
    await call('upload_character',{name:file.name,base64:data.split(',')[1]});
  },'已上传主角图');
});
$('gallery').onclick=guarded(e=>{
  const button=e.target.closest('[data-select]');
  if(!button)return;
  const item=items.find(item=>item.id===button.dataset.select);
  if(!item)return;
  referencePreview=item;
  const img=$('reference-image'),confirm=$('reference-confirm'),message=$('reference-image-status');
  $('reference-title').textContent=item.name;
  confirm.textContent=item.kind!=='portrait'&&button.getAttribute('aria-pressed')==='true'?'确认移除':'确认选择';
  confirm.disabled=true;
  message.textContent='正在加载大图…';
  img.alt=item.name;
  img.onload=()=>{message.textContent='';confirm.disabled=false;};
  img.onerror=()=>{message.textContent='大图读取失败，请关闭后重试。';};
  img.src=item.url;
  showTaskDialog($('reference-viewer'),button);
});
$('close-reference-viewer').onclick=()=>$('reference-viewer').close();
$('reference-download').onclick=guarded(async()=>{
  const item=referencePreview;if(!item)return;
  const button=$('reference-download'),message=$('reference-image-status');
  button.disabled=true;button.setAttribute('aria-busy','true');message.textContent='正在下载原图…';
  try{
    const result=await call('download_catalog_image',{kind:item.kind,id:item.id});
    const a=document.createElement('a');a.href='data:'+result.mime+';base64,'+result.base64;a.download=result.filename;a.click();
    if(referencePreview===item)message.textContent='已开始下载原图。';
  }catch(error){if(referencePreview===item)message.textContent=error.message;}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
});
$('reference-confirm').onclick=guarded(async()=>{
  const item=referencePreview;
  $('reference-viewer').close();
  if(item)await toggleReference(item);
});
document.addEventListener('click',guarded(async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.remove){const k=b.dataset.remove.startsWith('pose:')?'poseIds':'costumeIds';await persist({[k]:state.draft[k].filter(id=>id!==b.dataset.remove)});}
  if(b.dataset.delete){state=await call('edit_task',{taskId:b.dataset.delete,patch:{remove:true}});renderState();}
  if(b.dataset.edit){
    editing=b.dataset.edit;
    const task=state.tasks.find(t=>t.id===editing);
    for(const [id,kind,value]of [['edit-costume','costume',task.costumeId],['edit-pose','pose',task.poseId]]){
      const select=$(id);
      select.innerHTML='<option value="">沿用原图</option>'+Object.values(state.assets)
        .filter(a=>a.kind===kind).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.sourceId||a.name)+'</option>').join('');
      select.value=value||'';
    }
    $('edit-error').hidden=true;
    $('edit-prompt').value=task.prompt;
    showTaskDialog($('editor'),b);
  }
  if(b.dataset.retry){state=await call('retry_task',{taskId:b.dataset.retry});$('success-history').close();renderState();await notifyAgent();}
  if(b.dataset.view){
    const url=await imageURL(b.dataset.view);
    $('viewer-image').src=url;
    $('download').href=url;
    const task=state.tasks.find(t=>t.resultId===b.dataset.view&&t.id===b.closest('[data-task-id]')?.dataset.taskId);
    $('download').download=task?taskResultFilename(task):'character-result.'+(url.match(/^data:image\/(png|jpeg|webp);/)?.[1]||'png');
    $('viewer').showModal();
  }
}));
$('save-task').onclick=guarded(async()=>{const old=state.tasks.find(t=>t.id===editing),patch={};if($('edit-costume').value!==(old.costumeId||''))patch.costumeId=$('edit-costume').value||null;if($('edit-pose').value!==(old.poseId||''))patch.poseId=$('edit-pose').value||null;if($('edit-prompt').value!==old.prompt)patch.prompt=$('edit-prompt').value;state=await call('edit_task',{taskId:editing,patch});$('editor').close();renderState();});
for(const [id,key]of [['notes','notes'],['template','template']])$(id).onchange=()=>persist({[key]:$(id).value});
$('ratio').onchange=()=>persist({ratio:$('ratio').value});
async function saveQueueDraft(){
  await saving;
  const provider=selectedProvider();
  const patch={notes:$('notes').value,template:$('template').value};
  if(provider==='agent')patch.agentHost=selectedAgent();
  if(provider!==state.draft.provider)patch.provider=provider;
  state=await call('save_draft',{patch});
  if(isNativeProvider(provider))nativeProvider=provider;
}
async function prepareQueue(rebuild=false){
  await saving;await referenceOps;
  if(rebuild||!currentPreview()){
    await saveQueueDraft();
    state=await call('build_queue');
  }
}
async function openPreview(rebuild=false){
  if(preparing||dispatching)return;
  preparing=true;renderState();
  try{
    await prepareQueue(rebuild);
    $('preview-error').hidden=true;
    renderPreview();
    if(!$('combination-preview').open)showTaskDialog($('combination-preview'),$('build'));
  }finally{preparing=false;renderState();}
}
$('build').onclick=guarded(()=>openPreview());
$('restore-combinations').onclick=guarded(()=>openPreview(true));
$('close-preview').onclick=()=>$('combination-preview').close();
$('submit').onclick=guarded(async()=>{
  if(preparing||dispatching)return;
  preparing=true;submitting=true;status('');renderState();
  try{
    await prepareQueue();
    state=await call('control_batch',{action:'start'});submitting=false;await notifyAgent();
  }finally{preparing=false;submitting=false;renderState();}
});
$('pause').onclick=guarded(async()=>{state=await call('control_batch',{action:'pause'});renderState();status('已暂停后续任务；当前已开始的任务会继续完成。');});
$('continue').onclick=guarded(async()=>{state=await call('control_batch',{action:'continue'});renderState();await notifyAgent();});
$('cancel').onclick=guarded(async()=>{state=await call('control_batch',{action:'cancel'});renderState();status(!isNativeProvider(state.batch.provider||'codex')?'已停止本机处理和后续任务；已提交的 API 请求可能仍在服务端运行，请在服务商后台查看。':'已取消当前批次。');});
$('refresh').onclick=guarded(async()=>{await saving;await refresh();await probeExecutor();status('已恢复本机保存状态');});
$('close-editor').onclick=()=>$('editor').close();$('close-viewer').onclick=()=>$('viewer').close();
let searchTimer;
function switchLibrary(k){
  clearTimeout(searchTimer);
  kind=k;
  offset=0;
  $('search').value=filters[k].q;
  $('search').placeholder=k==='portrait'?'搜索发型、关键词或编号':'搜索编号、关键词或动作';
  for(const t of Object.keys(filters))$(t+'-tab').setAttribute('aria-selected',String(t===k));
  $('library-panel').setAttribute('aria-labelledby',k+'-tab');
  catalog();
}
for(const k of Object.keys(filters))$(k+'-tab').onclick=()=>switchLibrary(k);
$('open-portrait-gallery').onclick=()=>{switchLibrary('portrait');$('portrait-tab').focus();};
$('category').onchange=()=>{filters[kind].category=$('category').value;offset=0;catalog();};$('angle').onchange=()=>{filters[kind].angle=$('angle').value;offset=0;catalog();};
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{filters[kind].q=$('search').value;offset=0;catalog()},250)};
$('previous').onclick=()=>{offset=Math.max(0,offset-pageSize);catalog();};$('next').onclick=()=>{offset+=pageSize;catalog();};$('reload-catalog').onclick=()=>catalog(true);
$('gallery-page-size').onchange=()=>{
  pageSize=Number($('gallery-page-size').value);
  $('gallery').dataset.pageSize=String(pageSize);
  offset=0;
  catalog();
};
$('source').onclick=guarded(async()=>{const url=librarySources[kind];if(app)await app.openLink({url});else window.open(url,'_blank','noopener');});
$('expand').onclick=guarded(async()=>app.requestDisplayMode({mode:'fullscreen'}));
$('provider').onclick=guarded(async e=>{
  const button=e.target.closest('[data-provider]');
  if(!button||button.getAttribute('aria-pressed')==='true')return;
  const choice=button.dataset.provider,provider=choice==='agent'?currentNative():lastApi;
  if(isNativeProvider(provider))nativeProvider=provider;
  await persist({provider});
  await probeExecutor();
});
$('check-provider').onclick=async()=>{await saving;await probeExecutor({reconnect:true});};
$('agent-choice').onchange=guarded(async()=>{
  const agentHost=$('agent-choice').value;
  probeId++;channelProbe=null;verifiedCheckId=null;
  await persist({agentHost,provider:agentHost==='codex'&&!codexChat()?'codex':'agent'});
  await probeExecutor();
});
$('reconnect-local-codex').onclick=guarded(async()=>{
  await saving;
  const request=++probeId;
  channelProbe={provider:'agent',pending:'正在连接本机 Codex…'};
  renderChannelConnection();
  try{
    const result=await call('reconnect_with_local_codex',{batchId:state.batch?.id??null});
    if(request===probeId)channelProbe={provider:'codex',...result};
    await refresh();
  }catch(e){
    if(request===probeId)channelProbe={provider:'agent',reason:'本机 Codex 连接失败：'+e.message};
    await refresh();
  }finally{renderChannelConnection();}
});
$('provider-preset').onchange=guarded(async()=>{probeId++;channelProbe=null;await persist({providerPresetId:$('provider-preset').value||null});await probeExecutor();});
$('api-service').onchange=guarded(async()=>{probeId++;channelProbe=null;await persist({provider:$('api-service').value});await probeExecutor();});
for(const [button,dialog,close] of [
  ['open-api-guide','api-guide','close-api-guide'],
  ['open-api-key','api-key-dialog','close-api-key']
]){
  $(button).onclick=()=>{
    if(button==='open-api-key'){
      const preset=selectedPreset(state.providerPresets,selectedProvider(),state.draft.providerPresetId);
      $('api-base-url').value=preset?.baseUrl||'';$('api-model').value=preset?.model||'';$('api-protocol').value=preset?.protocol||'openai-multipart';
    }
    showTaskDialog($(dialog),$(button));
  };
  $(close).onclick=()=>$(dialog).close();
}
$('api-key-dialog').addEventListener('close',()=>{
  $('provider-key').value='';
  keyStatus('');
});
for(const id of ['api-key-link','api-docs-link'])$(id).onclick=guarded(async e=>{
  if(!app)return;
  e.preventDefault();
  const result=await app.openLink({url:$(id).getAttribute('href')});
  if(result?.isError)throw Error('无法打开官方页面。');
});
$('guide-open-key').onclick=()=>{$('api-guide').close();$('open-api-key').click();};
async function updateApiKey(remove=false){
  if(keyRequest)return;
  const provider=selectedProvider();
  if(isNativeProvider(provider))return;
  const key=remove?'':$('provider-key').value.trim();
  if(!remove&&!key){keyStatus('请先粘贴 API Key。','error');return;}
  keyRequest=provider;renderApiSetup(provider);
  keyStatus(remove?'正在移除…':'正在验证 Key…');
  try{
    if(!remove){
      const customConfig=provider==='image-custom'?{baseUrl:$('api-base-url').value.trim(),model:$('api-model').value.trim(),protocol:$('api-protocol').value}:undefined;
      const probe=await call('execution_status',{provider,inputKey:key,...(customConfig?{customConfig}:{})});
      if(!probe.available)throw Error(probe.reason);
      if(customConfig)state=await call('save_image_api_config',{config:customConfig});
    }
    channels.credentials=await call('save_provider_keys',{keys:{[provider]:key}});
    if(channelProbe?.provider===provider){probeId++;channelProbe=null;}
    if(selectedProvider()===provider){
      $('provider-key').value='';
      keyStatus(remove?'已移除本机 Key。':'连接成功，Key 已保存在本机。','ready');
    }
    await probeExecutor();
  }catch(e){
    if(selectedProvider()===provider)keyStatus(e.message,'error');
  }finally{
    keyRequest=null;renderState();
  }
}
$('api-key-form').onsubmit=e=>{e.preventDefault();void updateApiKey();};
$('clear-provider-key').onclick=()=>updateApiKey(true);
async function init(){
  if(window.parent!==window){
    app=new App({name:'Character Studio',version:VERSION},{},{autoResize:true});
    app.ontoolresult=()=>refresh().catch(e=>status(e.message,true));
    await app.connect(undefined,{timeout:10000});$('expand').hidden=false;
  }else{$('connection').textContent='正在恢复工作台…';}
  await loadChannels();await refresh();
  if(!state.onboardingGuideSeen)openOnboarding();
  void probeExecutor();
  await catalog();
  setInterval(()=>{if(!document.hidden){renderExecution();refresh().catch(e=>status('状态刷新失败：'+e.message,true));}},2000);
}
function renderChannelConnection(){
  const provider=selectedProvider(),probe=channelProbe?.provider===provider?channelProbe:null;
  let message,phase;
  if(probe?.pending){message=probe.pending;phase='pending';}
  else if(provider==='agent'){
    if(connectedFor(selectedAgent())){message=agentConnection.agentName+' 已连接';phase='ready';}
    else if(selectedAgent()==='doubao'){
      message=agentConnection?.reason||'豆包未连接。可先提交任务，再回豆包接手整批。';
      phase=agentConnection?.reason?'error':'idle';
    }
    else if(probe?.available){message=probe.message;phase='idle';}
    else if(probe?.reason){message=probe.reason;phase='error';}
    else if(hostMessaging()){message=hostName()+' 可接收消息，Agent 尚未开始等待任务。';phase='idle';}
    else{message=agentConnection?.reason||'当前 Agent 未连接。可以直接改用本机 Codex。';phase=agentConnection?.reason?'error':'idle';}
  }else if(probe){
    message=probe.available?probe.message:probe.reason;phase=probe.available?'ready':'error';
  }else{
    message=provider==='codex'?'等待检测本机 Codex':channels.credentials[provider]?.configured?'已配置 Key，点击检测连接。':'点击「管理 API Key」连接所选服务。';
    phase='idle';
  }
  const readiness=generationReadiness();
  if(provider==='codex'&&probe?.available){
    const result=readiness.running?'正在验证生图能力…':readiness.capability==='confirmed'?'测试图已成功回填。':readiness.capability==='failed'?'生图测试失败，请查看下面的原因。':'尚未验证生图能力。';
    message='本机 Codex 已登录。'+result;
    phase=readiness.capability==='confirmed'?'ready':readiness.capability==='failed'?'error':'idle';
  }
  if(!isNativeProvider(provider)&&probe?.available&&readiness.capability==='confirmed')message='API 已连接，测试图已成功回填。';
  const label=$('channel-status');
  label.textContent=message;label.dataset.state=phase;label.classList.toggle('error',phase==='error');
  const details=$('channel-details'),detail=phase==='error'&&probe?.details!==message?probe?.details:null;
  details.hidden=!detail;
  details.querySelector('p').textContent=detail||'';
  if(!detail)details.open=false;
  $('check-provider').disabled=phase==='pending'||channels.available===false;
  $('check-provider').textContent=provider==='agent'&&codexMessaging()&&selectedAgent()!=='doubao'&&!connectedFor(selectedAgent())?'重新连接 Agent':'检测连接';
  const resumeCodex=provider==='codex'&&state.batch?.provider==='agent'&&['queued','paused'].includes(state.batch.status)&&generationReadiness().capability==='confirmed';
  $('local-reconnect').hidden=!resumeCodex&&(provider!=='agent'||selectedAgent()==='doubao'||hostMessaging()||!!agentConnection?.connected);
  $('reconnect-local-codex').disabled=phase==='pending'||preparing||dispatching||channels.available===false;
  $('connection').hidden=true;
  renderCapability();
}
function renderCapability(){
  const r=generationReadiness(),native=r.provider==='agent';
  const stage=(id,text,value)=>{const el=$(id);el.textContent=text;el.dataset.state=value;};
  stage('account-stage',native?'账号由原聊天管理':r.probe?.account==='confirmed'?'账号已登录':'账号尚未确认',native?'host':r.probe?.account);
  stage('executor-stage',r.connected?'执行器已连接':'执行器尚未连接',r.connected?'confirmed':'unknown');
  const title=r.running?'正在验证生图能力…':r.capability==='confirmed'?'生图能力已确认（已返回图片）':r.capability==='declared'?'生图工具已确认（尚未试生成）':r.capability==='failed'?'生图能力验证失败':'尚未验证生图能力';
  stage('capability-stage',title,r.capability==='failed'?'failed':r.capability==='confirmed'?'confirmed':'unknown');
  const needsReferences=!isNativeProvider(r.provider)&&(!state.draft.portraitId||!queueReferences(state.draft).count);
  const missing=r.reason||(needsReferences&&r.connected?'已连接。选择主角和搭配后，可先生成一张测试图。':!r.connected&&native?'回到打开工作台的原聊天，发送「重新连接人物工作台」。连接后保留当前主角和搭配。':!r.connected?r.probe?.solution||'先完成登录或点击「管理 API Key」，再点「检测连接」。':r.capability==='unknown'?'先生成一张测试图，确认能返回图片后再提交整批。':'');
  const solution=r.capability==='failed'?missing+(isNativeProvider(r.provider)?' 请回原聊天检查生图工具，或选择生图 API。':' 请检查 Key、模型权限和余额，再重新测试。'):missing;
  $('channel-solution').textContent=solution;$('channel-solution').hidden=!solution;
  $('test-generation').disabled=r.running||r.probe?.pending||preparing||needsReferences||Boolean(state.tasks.some(t=>t.status==='running'))||!native&&!r.probe?.available;
  $('test-generation').textContent=r.running?'测试图执行中…':'生成一张测试图';
  $('copy-agent-reconnect').hidden=!native||r.connected;
  $('copy-agent-reconnect').textContent=r.running?'复制测试指令':'复制重连指令';
  $('test-status').hidden=!r.check;
  $('test-status').textContent=r.running?(native&&!r.connected?'测试已排队。回原聊天发送「处理工作台的测试图」。':'正在生成测试图，请稍候…'):r.check?.status==='verified'?'上次测试已返回图片，时间 '+new Date(r.check.updatedAt).toLocaleString():r.check?.reason||'';
  $('view-test-result').hidden=!r.check?.resultId;
  $('cancel-test').hidden=!r.running;
}
function renderOnboarding(){
  const r=generationReadiness();
  const remembered=state.channelSetup?.provider===r.provider&&(r.provider!=='agent'||state.channelSetup.agentHost===selectedAgent());
  const connected=r.provider==='codex'?r.capability==='confirmed':remembered||r.connected||r.probe?.toolConfirmed||r.capability==='confirmed';
  const step=!connected?'channel':!state.draft.portraitId?'portrait':'outfit';
  for(const id of ['channel','portrait','outfit'])$('setup-'+id).setAttribute('aria-current',step===id?'step':'false');
  $('setup-next').textContent=step==='channel'?(r.provider==='codex'&&r.connected?'先生成一张测试图，确认生图能力后再选择主角和搭配。':'先连接生图渠道，确认可用后再选择主角和搭配。'):step==='portrait'?'下一步，上传主角图片或从人像库选角。':queueReferences(state.draft).count?'搭配已选好。确认渠道能力后，可以预览组合并生成。':'下一步，选择服装或姿势。';
  const firstUse=!state.draft.portraitId&&!state.tasks.length&&!connected;
  $('upload-portrait').disabled=firstUse;$('open-portrait-gallery').disabled=firstUse;
  $('setup-portrait').disabled=firstUse;$('setup-outfit').disabled=firstUse;
  for(const tile of $('gallery').querySelectorAll('[data-select]'))tile.disabled=firstUse;
}
function openOnboarding(){
  const channel=isNativeProvider(selectedProvider())?(selectedAgent()==='doubao'?'doubao':'codex'):'api';
  selectGuide(channel);
  $('open-onboarding').hidden=true;
  if(!$('onboarding-guide').open)$('onboarding-guide').showModal();
}
const channelGuides={
  doubao:{title:'用豆包工作生图',steps:[
    '右侧选择「当前 Agent 生图」，Agent 选择「豆包工作」。',
    '点击「复制重连指令」，回到豆包原聊天粘贴并发送。',
    '选择或上传一位主角，多选服装和姿势，预览后生成。若显示等待接手，把工作台给出的指令回豆包原聊天发送。',
  ],note:'断开后保留当前选择。回原聊天发送「重新连接人物工作台」即可继续。'},
  codex:{title:'用 Codex 生图',steps:[
    '右侧选择「当前 Agent 生图」和「Codex」，点击「检测连接」。',
    '先生成一张测试图，确认生图能力，再选择主角和搭配。',
    '预览后生成，完成的图片在「成功记录」中按批次查看和下载。',
  ],note:'账号已登录和执行器已连接，仍需要确认生图工具能返回图片。'},
  api:{title:'用生图 API 生图',steps:[
    '右侧选择「生图 API」，再选择服务和模型。OpenAI、Google Gemini、火山方舟已预设。',
    '点击「获取 Key 教程」打开官方页面。点击「管理 API Key」，粘贴对应服务的 Key，验证并保存。',
    '选择一位主角及服装或姿势，预览后生成。图片完成后自动保存在成功记录。',
  ],note:'API 按所选服务计费。连接检测不会生成图片，测试图和正式生成会使用该服务的额度。'},
};
function selectGuide(channel){
  const guide=channelGuides[channel];if(!guide)return;
  document.querySelector('.guide-screenshots').classList.remove('is-zoomed');
  $('guide-zoom').textContent='放大图解';$('guide-zoom').setAttribute('aria-pressed','false');
  for(const name of Object.keys(channelGuides)){
    $('guide-'+name+'-tab').setAttribute('aria-selected',String(name===channel));
    $('guide-'+name+'-tab').tabIndex=name===channel?0:-1;
    $('guide-'+name+'-image').hidden=name!==channel;
  }
  $('guide-panel').setAttribute('aria-labelledby','guide-'+channel+'-tab');
  $('guide-channel-title').textContent=guide.title;
  $('guide-instructions').innerHTML=guide.steps.map(step=>'<li>'+esc(step)+'</li>').join('');
  $('guide-note').textContent=guide.note;
}
$('guide-zoom').onclick=()=>{
  const zoomed=document.querySelector('.guide-screenshots').classList.toggle('is-zoomed');
  $('guide-zoom').textContent=zoomed?'缩小图解':'放大图解';
  $('guide-zoom').setAttribute('aria-pressed',String(zoomed));
};
for(const channel of Object.keys(channelGuides))$('guide-'+channel+'-tab').onclick=()=>selectGuide(channel);
document.querySelector('.guide-tabs').onkeydown=e=>{
  const tabs=[...document.querySelectorAll('[data-guide]')],index=tabs.indexOf(e.target);
  if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();
  const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
  selectGuide(tabs[next].dataset.guide);tabs[next].focus();
};
function closeOnboarding(){ $('onboarding-guide').close(); }
$('open-onboarding').onclick=openOnboarding;
$('close-onboarding').onclick=closeOnboarding;
$('finish-onboarding').onclick=closeOnboarding;
$('onboarding-guide').addEventListener('close',async()=>{
  $('open-onboarding').hidden=false;
  if(state?.onboardingGuideSeen)return;
  try{state=await call('dismiss_onboarding');renderState();}
  catch(e){status('指南关闭状态未保存：'+e.message,true);}
});
$('setup-channel').onclick=()=>{closeOnboarding();$('channel-setup').scrollIntoView({block:'start'});$('check-provider').focus();};
$('setup-portrait').onclick=()=>{closeOnboarding();$('open-portrait-gallery').click();$('upload-portrait').focus();};
$('setup-outfit').onclick=()=>{closeOnboarding();switchLibrary('costume');$('costume-tab').focus();};
$('copy-agent-reconnect').onclick=guarded(async()=>{
  const instruction=generationReadiness().running?'处理工作台的测试图':agentReconnect;
  try{await navigator.clipboard.writeText(instruction);status('已复制。回到原来的豆包或 Codex 聊天，粘贴并发送。');}
  catch{status('回到原聊天，发送「'+instruction+'」。');}
});
$('test-generation').onclick=()=>{
  testTarget={provider:selectedProvider(),agentHost:selectedAgent()};
  const paid=!isNativeProvider(testTarget.provider);
  $('test-description').textContent=paid?'这次会把当前主角和第一组搭配发送到所选 API 服务，生成一张图片，并按该服务规则计费。测试独立于整批任务。':'这次会用所选 Agent 生成一张红色陶瓷杯图片，验证真实图片能否回填。会使用当前账号的生图额度。豆包未连接时，需要回原聊天接手测试。';
  $('confirm-test').textContent=paid?'确认费用，生成测试图':'生成测试图';
  showTaskDialog($('test-confirmation'),$('test-generation'));
};
$('close-test').onclick=()=>$('test-confirmation').close();
$('cancel-test').onclick=guarded(async()=>{
  const check=state.generationChecks?.[selectedCheckKey()];
  if(!check)return;
  await call('cancel_generation_test',{testId:check.id});await refresh();
  if(!isNativeProvider(check.provider))status('已停止本机等待。已提交的 API 请求可能仍在服务端运行，请在服务商后台查看。');
});
$('confirm-test').onclick=guarded(async()=>{
  const target=testTarget;
  $('confirm-test').disabled=true;
  try{
    await saving;await call('test_generation',{...target,costConfirmed:!isNativeProvider(target.provider)});
    $('test-confirmation').close();await refresh();
    if(target.provider==='agent'&&target.agentHost!=='doubao'&&codexMessaging())await sendHostMessage('请按人物工作台技能接手独立测试图，调用 agent_wait 领取，真实回填后结束本次测试。'+agentTaskInstructions,'验证人物工作台生图能力');
  }finally{$('confirm-test').disabled=false;}
});
$('view-test-result').onclick=guarded(async()=>{
  const check=state.generationChecks?.[selectedCheckKey()];
  if(!check?.resultId)return;
  const url=await imageURL(check.resultId);
  $('viewer-image').src=url;$('download').href=url;$('download').download='channel-test.png';$('viewer').showModal();
});
function verifiedConnection(report){
  return {available:true,toolConfirmed:true,message:report.agentName+' 的生图工具已确认，等待它开始领取任务。'};
}
async function reconnectAgent(request){
  const {connection,report}=await call('agent_connection_status',verifiedCheckId?{checkId:verifiedCheckId}:{});
  if(request!==probeId)return;
  agentConnection=connection;
  if(matchesConnection(connection,selectedAgent()))return;
  if(selectedAgent()==='doubao')return;
  if(!hostMessaging())return {reason:connection.reason||reconnectAndCheck};
  verifiedCheckId=null;
  channelProbe={provider:'agent',pending:'Agent 未连接，正在尝试连接…'};renderChannelConnection();
  const checkId=crypto.randomUUID();
  const text='我点击了 Character Studio 的「重新连接 Agent」，请使用宿主名称 Codex 重新连接工作台。可调用 agent_report_connection 回报能力，checkId 为 '+checkId+'。'+agentTaskInstructions;
  await sendHostMessage(text,'检测 Character Studio 的 Agent 连接');
  const deadline=Date.now()+20000;
  while(request===probeId&&selectedProvider()==='agent'&&Date.now()<deadline){
    const {connection,report}=await call('agent_connection_status',{checkId});
    if(request!==probeId||selectedProvider()!=='agent')return;
    agentConnection=connection;
    if(matchesConnection(connection,selectedAgent()))return;
    if(report?.reason)return {reason:report.agentName+'：'+report.reason,unavailable:true};
    if(report?.imageTool){verifiedCheckId=checkId;return verifiedConnection(report);}
    await new Promise(resolve=>setTimeout(resolve,800));
  }
  return {reason:'Agent 连接超时。'+reconnectAndCheck};
}
async function probeExecutor({reconnect=false}={}){
  const request=++probeId,provider=selectedProvider();
  channelProbe={provider,pending:'正在检测连接…'};renderChannelConnection();
  try{
    let result;
    if(provider==='agent'){
      if(reconnect)result=await reconnectAgent(request);
      else await refresh();
      if(!result)result=await call('execution_status',{provider,agentHost:selectedAgent()});
    }else result=await call('execution_status',{provider});
    if(request===probeId)channelProbe=result?{provider,...result}:null;
  }catch(e){
    if(request===probeId)channelProbe={provider,reason:'检测连接失败：'+e.message};
  }finally{if(request===probeId)renderState();}
}
init().catch(e=>{status('工作台连接失败：'+e.message,true);$('connection').hidden=false;$('connection').textContent='连接失败';$('channel-status').textContent='工作台连接失败';});
