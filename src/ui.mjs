import {App} from '@modelcontextprotocol/ext-apps';
import {PROVIDERS,isNativeProvider,outputRatios,queueInputs,queueReferences,referenceCompatibility,selectedPreset} from './generation-models.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let app,state,kind='costume',offset=0,pageSize=20,items=[],total=0,queryId=0,editing=null,saving=Promise.resolve(),referenceOps=Promise.resolve(),dispatching=false,preparing=false;
let channels={providers:PROVIDERS,credentials:{}},probeId=0;
let keyProvider,keyRequest;
let agentConnection,nativeProvider,channelProbe,verifiedCheckId;
const hostMessaging=()=>!!(app?.getHostCapabilities()?.message?.text||window.openai?.sendFollowUpMessage);
const hostName=()=>app?.getHostVersion()?.name||'当前 Agent';
const reconnectInstruction='回到打开工作台的聊天（如 Codex 或豆包），发送「重新连接人物工作台」。';
const reconnectAndCheck=reconnectInstruction+' 再回到这里，点「检测连接」。';
const currentNative=()=>hostMessaging()||agentConnection?.connected?'agent':nativeProvider||'agent';
const selectedProvider=()=>isNativeProvider(state.draft.provider||'codex')?currentNative():state.draft.provider;
const filters={portrait:{category:'',angle:'',q:''},costume:{category:'春季',angle:'',q:''},pose:{category:'站姿',angle:'正面',q:''}};
const libraryNames={portrait:'人像',costume:'服装',pose:'姿势'};
const librarySources={portrait:'https://ai-portrait-gallery.pages.dev/',costume:'https://ai-costume-gallery.pages.dev/',pose:'https://ai-pose-depth-gallery.pages.dev/'};
const imageCache=new Map();
function status(text,error=false){
  $('status').textContent=text;$('status').classList.toggle('error',error);
  if($('editor').open){$('edit-error').textContent=error?text:'';$('edit-error').hidden=!error;}
  else if($('combination-preview').open){$('preview-error').textContent=error?text:'';$('preview-error').hidden=!error;}
}
function failureSummary(message){const s=String(message);if(/moderation_blocked|safety system|safety_violations/.test(s))return '生图工具的安全检查拒绝了本次请求，未返回图片。';if(/未.*登录|login|not authenticated/i.test(s))return '当前生图渠道尚未登录，请检查账号连接。';if(/未提供.*工具|工具.*不可用|unavailable|no.*image.*tool/i.test(s))return '当前 Agent 未提供可用的生图工具。';if(/超时|timeout/i.test(s))return '生图执行超时，任务已停止。';return s.split('\n')[0].slice(0,180);}
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
  return !batch.inputs||batch.inputs===queueInputs(draft,provider,preset);
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
  const modelProblem=!isNativeProvider(provider)&&!preset?'此站的默认工作流尚未上线。':referenceCompatibility(preset,kinds,ratio);
  $('costume-count').textContent=d.costumeIds.length;
  $('pose-count').textContent=d.poseIds.length;
  $('comb-costumes').textContent=d.costumeIds.length;
  $('comb-poses').textContent=d.poseIds.length;
  $('comb-costumes').parentElement.hidden=!d.costumeIds.length&&plannedCount>0;
  $('comb-pose-summary').hidden=!d.poseIds.length&&plannedCount>0;
  $('comb-divider').hidden=!d.costumeIds.length||!d.poseIds.length;
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
  const busy=['queued','running','paused','awaiting-approval'].includes(b?.status);
  const preview=currentPreview();
  const count=preview?state.tasks.filter(t=>t.batchId===b.id&&t.status==='pending').length:plannedCount;
  $('combination-count').textContent=count;
  $('build').disabled=busy||dispatching||preparing||!portrait||!plannedCount||!!modelProblem;
  const keyMissing=!isNativeProvider(provider)&&!channels.credentials[provider]?.configured;
  $('submit').disabled=$('build').disabled||!count||keyMissing;
  $('submit').textContent=dispatching?'正在提交…':b?.status==='queued'?'等待开始…':b?.status==='running'?'正在生成…':['paused','awaiting-approval'].includes(b?.status)?'任务已暂停':'生成 '+count+' 张图片';
  $('preview-change').hidden=b?.status!=='draft'||preview;
  if($('combination-preview').open)renderPreview();
  $('start-guide').textContent=busy?'当前任务的进度和结果会显示在下方。':!portrait?'先上传一张主角图片。':!plannedCount?'选一套服装或一个姿势就可以生成。':modelProblem||(keyMissing?'填写并验证本站的 API Key 后即可生成。':'选好了，可以预览组合或直接生成。');
  $('pause').hidden=!['queued','running'].includes(b?.status);$('continue').hidden=!['paused','awaiting-approval'].includes(b?.status);$('cancel').hidden=!['draft','queued','running','paused','awaiting-approval'].includes(b?.status);
  renderExecution();
  const cards=tasks=>tasks.slice().reverse().map(t=>'<article class="job" data-task-id="'+t.id+'"><div class="job-head"><span>'+esc([a[t.costumeId]?.sourceId,t.outputStyle==='three-view'?'三视图＋特写':a[t.poseId]?.sourceId].filter(Boolean).join(' × ')||'人物图')+'</span><span class="tag '+(t.status==='failed'?'failed':'')+'">'+statuses[t.status]+'</span></div><p class="job-meta">'+esc([a[t.costumeId]?.name,a[t.poseId]?.angle].filter(Boolean).join(' · '))+'</p>'+(t.error?'<div class="job-failure"><strong>失败原因</strong><p>'+esc(failureSummary(t.error))+'</p><details><summary>查看完整信息</summary><p class="error-detail">'+esc(t.error)+'</p></details></div>':'')+(t.resultId?'<button class="tile" type="button" data-view="'+t.resultId+'"><img class="result-image" data-result-image="'+t.resultId+'" alt="真实生成结果"></button>':'')+'<div class="job-actions">'+(t.outputStyle!=='three-view'&&['done','failed','interrupted'].includes(t.status)?'<button type="button" data-retry="'+t.id+'">单张重做</button>':'')+'</div></article>').join('');
  const successes=state.tasks.filter(t=>t.status==='done');
  const activeBatch=b&&['queued','running','paused','awaiting-approval'].includes(b.status);
  $('jobs').innerHTML=cards(state.tasks.filter(t=>activeBatch&&t.batchId===b.id&&t.status!=='done'));
  $('success-count').textContent=successes.length;
  $('success-results').innerHTML=cards(successes)||'<p class="history-empty">暂无成功结果</p>';
  for(const el of document.querySelectorAll('.job')){const t=state.tasks.find(t=>t.id===el.dataset.taskId),label=channels.providers.find(p=>p.id===(t.provider||'codex'))?.name||t.provider;el.querySelector('.job-meta').textContent+=' · '+label+(t.providerPreset?' / '+t.providerPreset.name:'')+(t.remoteTaskId?' · RH '+t.remoteTaskId:'');}
  if($('success-history').open)loadSuccessImages();
  renderSelected();
}
function renderGeneration(){
  const d=state.draft,provider=selectedProvider(),presets=(state.providerPresets||[]).filter(p=>p.provider===provider);
  const selected=isNativeProvider(provider)?'agent':provider;
  for(const button of $('provider').querySelectorAll('[data-provider]')){
    button.setAttribute('aria-pressed',String(button.dataset.provider===selected));
    button.disabled=channels.available===false;
  }
  const preset=selectedPreset(presets,provider,d.providerPresetId);
  $('provider-preset').innerHTML=isNativeProvider(provider)
    ?'<option value="">'+(provider==='agent'?'当前宿主提供的模型':'本机 Codex 内置模型')+'</option>'
    :(!preset?'<option value="">'+(presets.length?'请选择工作流':'默认工作流尚未上线')+'</option>':'')+
      presets.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+(p.builtin?'（内置）':'')+'</option>').join('');
  $('provider-preset').disabled=isNativeProvider(provider)||!presets.length||presets.length===1&&!!preset;
  $('provider-preset').value=preset?.id||'';
  let hint=channels.available===false?'请重新打开工作台以加载生图渠道。':provider==='agent'?'使用当前聊天里 Agent 已有的生图能力。':provider==='codex'?'使用这台电脑上已登录的 Codex。':'';
  if(state.batch&&['queued','running','paused','awaiting-approval'].includes(state.batch.status))hint+=' 已提交的任务保持原设置。';
  $('provider-hint').textContent=hint;$('provider-hint').hidden=!hint;
  renderRunningHubSetup(provider);
  renderChannelConnection();
}
function keyStatus(message,phase=''){
  const el=$('rh-key-status');
  el.hidden=!message;el.textContent=message;el.dataset.state=phase;el.classList.toggle('error',phase==='error');
}
function renderRunningHubSetup(provider){
  const native=isNativeProvider(provider),global=provider==='runninghub-global';
  $('rh-actions').hidden=native;
  if(keyProvider!==provider){keyProvider=provider;$('provider-key').value='';keyStatus('');}
  if(native)return;
  $('rh-cn-link').hidden=global;
  $('rh-global-link').hidden=!global;
  const credential=channels.credentials[provider];
  $('rh-key-title').textContent=(global?'国际站':'国内站')+' API Key';
  $('open-rh-key').textContent=credential?.configured?'管理 API Key':'填写 API Key';
  $('rh-key-summary').textContent=credential?.configured?'已配置':'未配置';
  $('rh-key-state').textContent=credential?.configured?'本站 Key 已配置。需要更换时，粘贴新 Key。':'粘贴刚复制的 Key，再点「验证并保存」。';
  $('clear-provider-key').hidden=credential?.source!=='local';
  $('save-provider-key').disabled=!!keyRequest;
  $('clear-provider-key').disabled=!!keyRequest;
}
async function loadChannels(){try{channels={...await call('generation_channels'),available:true};}catch(e){if(!/不存在该工具|unknown tool|tool.*not found/i.test(e.message))throw e;channels.available=false;}}
function renderExecution(){
  if(!state)return;const b=state.batch,execution=state.execution?.batchId===b?.id?state.execution:null;
  const task=state.tasks.find(t=>t.batchId===b?.id&&t.status==='running');
  let message=execution?.message||(['queued','running'].includes(b?.status)?'任务已排队，等待执行器领取…':'');
  if(task?.startedAt){const elapsed=Math.max(0,Math.floor((Date.now()-Date.parse(task.startedAt))/1000));message+=' · 已用时 '+Math.floor(elapsed/60)+'分'+String(elapsed%60).padStart(2,'0')+'秒';}
  $('execution-message').hidden=!message;$('execution-message').textContent=message;$('execution-message').classList.toggle('error',execution?.phase==='failed');
}
function loadSuccessImages(){for(const img of $('success-results').querySelectorAll('[data-result-image]'))if(!img.src)imageURL(img.dataset.resultImage).then(url=>img.src=url).catch(()=>{img.alt='结果读取失败';});}
$('success-history').addEventListener('toggle',()=>{if($('success-history').open)loadSuccessImages();});
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
    $('library-count').textContent=result.total+' 张匹配 / 全库 '+result.totalInLibrary+' 张';
    $('page-number').textContent=Math.floor(offset/pageSize)+1+' / '+Math.max(1,Math.ceil(total/pageSize));
    $('previous').disabled=offset===0;$('next').disabled=offset+pageSize>=total;
    $('gallery').innerHTML=items.map(d=>'<button class="tile" type="button" data-select="'+esc(d.id)+'" aria-pressed="false" aria-label="选择 '+esc(d.name)+'"><span class="photo"><img src="'+esc(d.thumb)+'" loading="lazy" referrerpolicy="no-referrer" alt="'+esc(d.name)+'"><span class="tick" hidden>✓</span></span><span class="caption"><span>'+esc(d.id.replace(/^(full_single|full_sexy|upper80v2|pair60)_/,''))+'</span><span>'+esc(d.angle||d.category)+'</span></span><span class="name" title="'+esc(d.name)+'">'+esc(d.name)+'</span></button>').join('')||'<p class="empty">没有匹配的参考图</p>';
    renderSelected();
    for(const img of $('gallery').querySelectorAll('img'))img.onerror=()=>{img.alt='缩略图读取失败';img.parentElement.dataset.failed='true';};
  }catch(e){if(request!==queryId)return;$('gallery').innerHTML='<div class="empty">'+esc(e.message)+'<br><button type="button" id="retry-catalog">重新读取</button></div>';$('retry-catalog').onclick=()=>catalog(true);status(e.message,true);}
}
async function toggleReference(id){
  const d=items.find(d=>d.id===id);if(!d)return;
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
  const text='请使用 Character Studio 的 claim_next_task 领取本机工作台刚提交的任务。按 task.references 的 kind 识别并逐张查看任务实际返回的本地参考图，使用当前宿主已有的生图工具按 task.prompt 生图，再调用 record_result 回填真实结果。单项失败时回填具体原因，跳过该项并重新领取下一项，不自动重试或改写被拒绝的任务。每次生成前重新领取任务；如果返回暂停、取消或没有任务，请停止。没有生图工具时明确说明，不要求我填 API Key，不使用占位图。';
  try{
    if(state.batch.provider!=='agent')await call('start_generation');
    else if(hostMessaging())await sendHostMessage(text,'开始 Character Studio 生图任务');
    else{const current=await call('get_state');if(!current.agentConnection?.connected)throw Error(current.agentConnection?.reason||'Agent 未连接。'+reconnectInstruction+' 再回到这里，点「继续剩余任务」。');}
    status('任务已提交，下方显示实际执行状态、结果和失败原因。');
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
$('gallery').onclick=guarded(e=>{const b=e.target.closest('[data-select]');if(b)return toggleReference(b.dataset.select);});
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
  if(b.dataset.retry){state=await call('retry_task',{taskId:b.dataset.retry});renderState();await notifyAgent();}
  if(b.dataset.view){const url=await imageURL(b.dataset.view);$('viewer-image').src=url;$('download').href=url;$('viewer').showModal();}
}));
$('save-task').onclick=guarded(async()=>{const old=state.tasks.find(t=>t.id===editing),patch={};if($('edit-costume').value!==(old.costumeId||''))patch.costumeId=$('edit-costume').value||null;if($('edit-pose').value!==(old.poseId||''))patch.poseId=$('edit-pose').value||null;if($('edit-prompt').value!==old.prompt)patch.prompt=$('edit-prompt').value;state=await call('edit_task',{taskId:editing,patch});$('editor').close();renderState();});
for(const [id,key]of [['notes','notes'],['template','template']])$(id).onchange=()=>persist({[key]:$(id).value});
$('ratio').onchange=()=>persist({ratio:$('ratio').value});
async function saveQueueDraft(){
  await saving;
  const provider=selectedProvider();
  const patch={notes:$('notes').value,template:$('template').value};
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
  preparing=true;renderState();
  try{
    await prepareQueue();
    state=await call('control_batch',{action:'start'});renderState();await notifyAgent();
  }finally{preparing=false;renderState();}
});
$('pause').onclick=guarded(async()=>{state=await call('control_batch',{action:'pause'});renderState();status('已暂停后续任务；当前已开始的任务会继续完成。');});
$('continue').onclick=guarded(async()=>{state=await call('control_batch',{action:'continue'});renderState();await notifyAgent();});
$('cancel').onclick=guarded(async()=>{state=await call('control_batch',{action:'cancel'});renderState();status(!isNativeProvider(state.batch.provider||'codex')?'已停止本机处理和后续任务；已提交到 RunningHub 的任务可能仍在运行，可在站点任务记录中取消。':'已取消当前批次。');});
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
$('source').onclick=guarded(async()=>{const url=librarySources[kind];if(app)await app.openLink({url});else window.open(url,'_blank','noopener');});
$('expand').onclick=guarded(async()=>app.requestDisplayMode({mode:'fullscreen'}));
$('provider').onclick=guarded(async e=>{
  const button=e.target.closest('[data-provider]');
  if(!button||button.getAttribute('aria-pressed')==='true')return;
  const choice=button.dataset.provider,provider=choice==='agent'?currentNative():choice;
  if(isNativeProvider(provider))nativeProvider=provider;
  await persist({provider});
  if(choice==='agent')await probeExecutor();
});
$('check-provider').onclick=async()=>{await saving;await probeExecutor({reconnect:true});};
$('provider-preset').onchange=()=>persist({providerPresetId:$('provider-preset').value||null});
for(const [button,dialog,close] of [
  ['open-rh-guide','rh-guide','close-rh-guide'],
  ['open-rh-key','rh-key-dialog','close-rh-key']
]){
  $(button).onclick=()=>showTaskDialog($(dialog),$(button));
  $(close).onclick=()=>$(dialog).close();
}
$('rh-key-dialog').addEventListener('close',()=>{
  $('provider-key').value='';
  keyStatus('');
});
for(const id of ['rh-cn-link','rh-global-link'])$(id).onclick=guarded(async e=>{
  if(!app)return;
  e.preventDefault();
  const result=await app.openLink({url:$(id).getAttribute('href')});
  if(result?.isError)throw Error('无法打开 RunningHub 网站。');
});
async function updateRunningHubKey(remove=false){
  if(keyRequest)return;
  const provider=selectedProvider();
  if(isNativeProvider(provider))return;
  const key=remove?'':$('provider-key').value.trim();
  if(!remove&&!key){keyStatus('请先粘贴 API Key。','error');return;}
  keyRequest=provider;renderRunningHubSetup(provider);
  keyStatus(remove?'正在移除…':'正在验证 Key…');
  try{
    if(!remove){
      const probe=await call('execution_status',{provider,inputKey:key});
      if(!probe.available)throw Error(probe.reason);
    }
    channels.credentials=await call('save_provider_keys',{keys:{[provider]:key}});
    if(channelProbe?.provider===provider){probeId++;channelProbe=null;}
    if(selectedProvider()===provider){
      $('provider-key').value='';
      keyStatus(remove?'已移除本机 Key。':'连接成功，Key 已保存在本机。','ready');
    }
  }catch(e){
    if(selectedProvider()===provider)keyStatus(e.message,'error');
  }finally{
    keyRequest=null;renderState();
  }
}
$('rh-key-form').onsubmit=e=>{e.preventDefault();void updateRunningHubKey();};
$('clear-provider-key').onclick=()=>updateRunningHubKey(true);
async function init(){
  if(window.parent!==window){
    app=new App({name:'Character Studio',version:'0.2.0'},{},{autoResize:true});
    app.ontoolresult=()=>refresh().catch(e=>status(e.message,true));
    await app.connect(undefined,{timeout:10000});$('expand').hidden=false;
  }else{$('connection').textContent='正在恢复工作台…';}
  await loadChannels();await refresh();
  if(isNativeProvider(selectedProvider()))void probeExecutor();
  await catalog();
  setInterval(()=>{if(!document.hidden){renderExecution();refresh().catch(e=>status('状态刷新失败：'+e.message,true));}},2000);
}
function renderChannelConnection(){
  const provider=selectedProvider(),probe=channelProbe?.provider===provider?channelProbe:null;
  let message,phase;
  if(probe?.pending){message=probe.pending;phase='pending';}
  else if(provider==='agent'){
    if(agentConnection?.connected){message=agentConnection.agentName+' 已连接';phase='ready';}
    else if(probe?.available){message=probe.message;phase='ready';}
    else if(probe?.reason){message=probe.reason;phase='error';}
    else if(hostMessaging()){message=hostName()+' 消息已连接';phase='idle';}
    else{message=agentConnection?.reason||reconnectAndCheck;phase=agentConnection?.reason?'error':'idle';}
  }else if(probe){
    message=probe.available?probe.message:probe.reason;phase=probe.available?'ready':'error';
  }else{
    message=provider==='codex'?'等待检测本机 Codex':channels.credentials[provider]?.configured?'已配置 Key，点击检测连接。':'点击「填写 API Key」连接本站。';
    phase='idle';
  }
  const label=$('channel-status');
  label.textContent=message;label.dataset.state=phase;label.classList.toggle('error',phase==='error');
  const details=$('channel-details'),detail=phase==='error'&&probe?.details!==message?probe?.details:null;
  details.hidden=!detail;
  details.querySelector('p').textContent=detail||'';
  if(!detail)details.open=false;
  $('check-provider').disabled=phase==='pending'||channels.available===false;
  $('connection').textContent=provider==='agent'&&phase==='ready'?message:'工作台已打开';
}
function verifiedConnection(report){
  return {available:true,message:report.agentName+' 已连接 · '+report.imageTool};
}
async function reconnectAgent(request){
  const {connection,report}=await call('agent_connection_status',verifiedCheckId?{checkId:verifiedCheckId}:{});
  if(request!==probeId)return;
  agentConnection=connection;
  if(connection.connected)return;
  if(!hostMessaging())return {reason:connection.reason||reconnectAndCheck};
  if(report?.imageTool)return verifiedConnection(report);
  verifiedCheckId=null;
  channelProbe={provider:'agent',pending:'Agent 未连接，正在尝试连接…'};renderChannelConnection();
  const checkId=crypto.randomUUID();
  const text='我点击了 Character Studio 的「检测连接」。请检查本会话是否具备读取本地参考图、生图和回填实际图片的能力，调用 agent_report_connection 回报，checkId 为 '+checkId+'。填写真实 agentName 和可用的 imageTool；缺少能力时填写具体 reason。本次仅检测连接，不领取、恢复或执行任务。';
  await sendHostMessage(text,'检测 Character Studio 的 Agent 连接');
  const deadline=Date.now()+20000;
  while(request===probeId&&selectedProvider()==='agent'&&Date.now()<deadline){
    const {connection,report}=await call('agent_connection_status',{checkId});
    if(request!==probeId||selectedProvider()!=='agent')return;
    agentConnection=connection;
    if(connection.connected)return;
    if(report?.reason)return {reason:report.agentName+'：'+report.reason};
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
    }else result=await call('execution_status',{provider});
    if(request===probeId)channelProbe=result?{provider,...result}:null;
  }catch(e){
    if(request===probeId)channelProbe={provider,reason:'检测连接失败：'+e.message};
  }finally{if(request===probeId)renderChannelConnection();}
}
init().catch(e=>{status('工作台连接失败：'+e.message,true);$('connection').textContent='连接失败';$('channel-status').textContent='工作台连接失败';});
