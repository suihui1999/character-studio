import {App} from '@modelcontextprotocol/ext-apps';
import {PROVIDERS,isNativeProvider} from './generation-models.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let app,state,kind='costume',offset=0,pageSize=20,items=[],total=0,queryId=0,editing=null,saving=Promise.resolve(),referenceOps=Promise.resolve(),dispatching=false,preparing=false;
let channels={providers:PROVIDERS,inputSources:[],credentials:{}},presetDraft=null,probeId=0,connectionAttempt=0;
const filters={costume:{category:'春季',angle:'',q:''},pose:{category:'站姿',angle:'正面',q:''}};
const imageCache=new Map();
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
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
function persist(patch){saving=saving.then(async()=>{state=await call('save_draft',{patch});renderState();}).catch(e=>status(e.message,true));return saving;}
async function refresh(){const s=await call('get_state');if(!state||s.revision>state.revision||JSON.stringify(s.agentConnection)!==JSON.stringify(state.agentConnection)){state=s;renderState();}}
const statuses={pending:'待生成',running:'生成中',done:'已完成',failed:'失败',interrupted:'已中断',cancelled:'已取消'};
function renderState(){
  const d=state.draft,a=state.assets,b=state.batch;
  $('costume-count').textContent=d.costumeIds.length;$('pose-count').textContent=d.poseIds.length;
  $('comb-costumes').textContent=d.costumeIds.length;$('comb-poses').textContent=d.poseIds.length;$('combination-count').textContent=d.costumeIds.length*d.poseIds.length;
  for(const [field,ids]of [['selected-costumes',d.costumeIds],['selected-poses',d.poseIds]])$(field).innerHTML=ids.map(id=>{
    const ref=a[id],label=(ref?.sourceId||ref?.name||id).replace(/^(full_single|full_sexy|upper80v2|pair60)_/,'');
    return '<div class="selected-reference" title="'+esc((ref?.sourceId||id)+' · '+(ref?.name||''))+'">'+(ref?.thumb?'<img class="selected-reference-image" src="'+esc(ref.thumb)+'" alt="'+esc(ref.name||label)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'<span class="selected-reference-missing" aria-label="预览不可用">—</span>')+'<div class="selected-reference-text"><span>'+esc(label)+'</span><small>'+esc(ref?.angle||ref?.category||'')+'</small></div><button type="button" class="selected-reference-remove" data-remove="'+esc(id)+'" aria-label="移除 '+esc(ref?.name||label)+'">×</button></div>';
  }).join('');
  for(const [id,val]of [['ratio',d.ratio],['mode',d.mode],['template',d.template],['notes',d.notes]])if(document.activeElement!==$(id))$(id).value=val;
  const portrait=d.portraitId&&a[d.portraitId];$('portrait-name').textContent=portrait?.name||'PNG、JPEG、WebP · 最大 12 MB';$('portrait-name').title=portrait?.name||'';$('upload-label').textContent=portrait?'更换主角图片':'上传一张主角图';$('upload-symbol').hidden=!!portrait;
  if(portrait){imageURL(portrait.id).then(url=>{if(state.draft.portraitId===portrait.id){$('portrait-preview').src=url;$('portrait-preview').hidden=false;}}).catch(e=>status(e.message,true));}else $('portrait-preview').hidden=true;
  renderGeneration();
  $('build').disabled=!portrait||!d.costumeIds.length||!d.poseIds.length||(!isNativeProvider(d.provider||'codex')&&!d.providerPresetId);
  const busy=['queued','running','paused','awaiting-approval'].includes(b?.status);
  $('submit').disabled=busy||dispatching||preparing||$('build').disabled;
  const count=b?.status==='draft'?state.tasks.filter(t=>t.batchId===b.id&&t.status==='pending').length:d.costumeIds.length*d.poseIds.length;
  $('submit').textContent=dispatching?'正在提交…':b?.status==='queued'?'等待开始…':b?.status==='running'?'正在生成…':b?.status==='awaiting-approval'?'样图已完成，等待确认':b?.status==='paused'?'任务已暂停':(b?.status==='draft'?b.mode:d.mode)==='sample'?'先生成 1 张样图':'生成 '+count+' 张图片';
  $('start-guide').textContent=!portrait?'先上传一张主角图片。':!d.costumeIds.length?'选一套或多套服装。':!d.poseIds.length?'再选一个或多个姿势。':!isNativeProvider(d.provider||'codex')&&!d.providerPresetId?'还没有可用模型，请在生图设置中添加。':busy?'当前任务的进度和结果会显示在下方。':'选好了，点击生成即可；图片会保存在本机。';
  if(d.provider==='agent'&&!app&&!window.openai?.sendFollowUpMessage){const c=state.agentConnection;$('connection').textContent=c?.connected?(c.agentName+' 已连接'):'等待 Agent 连接';$('executor-note').hidden=!!c?.connected;$('executor-note').textContent=c?.reason||'回到 Agent 聊天说“打开人物工作台”即可连接。';}
  $('pause').hidden=!['queued','running'].includes(b?.status);$('continue').hidden=!['paused','awaiting-approval'].includes(b?.status);$('continue').textContent=b?.status==='paused'?'继续剩余任务':'确认样图，继续整批';$('cancel').hidden=!['draft','queued','running','paused','awaiting-approval'].includes(b?.status);
  renderExecution();
  const cards=tasks=>tasks.slice().reverse().map(t=>'<article class="job" data-task-id="'+t.id+'"><div class="job-head"><span>'+esc(a[t.costumeId]?.sourceId||'服装')+' × '+esc(a[t.poseId]?.sourceId||'姿势')+'</span><span class="tag '+(t.status==='failed'?'failed':'')+'">'+statuses[t.status]+'</span></div><p class="job-meta">'+esc(a[t.costumeId]?.name)+' · '+esc(a[t.poseId]?.angle)+'</p>'+(t.error?'<div class="job-failure"><strong>失败原因</strong><p>'+esc(failureSummary(t.error))+'</p><details><summary>查看完整信息</summary><p class="error-detail">'+esc(t.error)+'</p></details></div>':'')+(t.resultId?'<button class="tile" type="button" data-view="'+t.resultId+'"><img class="result-image" data-result-image="'+t.resultId+'" alt="真实生成结果"></button>':'')+'<div class="job-actions">'+(t.status==='pending'&&b?.status==='draft'&&t.batchId===b.id?'<button type="button" data-edit="'+t.id+'">调整</button><button type="button" data-delete="'+t.id+'">删除</button>':'')+(['done','failed','interrupted'].includes(t.status)?'<button type="button" data-retry="'+t.id+'">单张重做</button>':'')+'</div></article>').join('');
  const successes=state.tasks.filter(t=>t.status==='done');
  const activeBatch=b&&['draft','queued','running','paused','awaiting-approval'].includes(b.status);
  $('jobs').innerHTML=cards(state.tasks.filter(t=>activeBatch&&t.batchId===b.id&&t.status!=='done'));
  $('success-count').textContent=successes.length;
  $('success-results').innerHTML=cards(successes)||'<p class="history-empty">暂无成功结果</p>';
  for(const el of document.querySelectorAll('.job')){const t=state.tasks.find(t=>t.id===el.dataset.taskId),label=channels.providers.find(p=>p.id===(t.provider||'codex'))?.name||t.provider;el.querySelector('.job-meta').textContent+=' · '+label+(t.providerPreset?' / '+t.providerPreset.name:'')+(t.remoteTaskId?' · RH '+t.remoteTaskId:'');}
  if($('success-history').open)loadSuccessImages();
  renderSelected();
}
function renderGeneration(){
  $('provider').innerHTML=channels.providers.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  const d=state.draft,provider=d.provider||'codex',presets=(state.providerPresets||[]).filter(p=>p.provider===provider);$('provider').value=provider;
  $('provider').disabled=channels.available===false;$('open-provider-settings').disabled=channels.available===false;
  $('provider-preset').innerHTML=isNativeProvider(provider)?'<option value="">'+(provider==='agent'?'当前宿主提供的模型':'本机 Codex 内置模型')+'</option>':'<option value="">'+(presets.length?'请选择模型预设':'请先导入应用 / 工作流')+'</option>'+presets.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  $('provider-preset').disabled=isNativeProvider(provider);$('provider-preset').value=d.providerPresetId||'';
  let hint=channels.available===false?'请重新打开工作台以加载生图设置。':provider==='agent'?'使用当前聊天里 Agent 已有的生图能力。':provider==='codex'?'使用这台电脑上已登录的 Codex。':'个人消费级 API · '+(channels.credentials[provider]?.configured?'已连接账号':'首次使用请在生图设置中填写 Key')+'。';
  if(state.batch&&['draft','queued','running','paused','awaiting-approval'].includes(state.batch.status))hint+=' 当前批次已固定渠道与预设，新选择用于下一批。';$('provider-hint').textContent=hint;
}
function settingsStatus(message,error=false){$('provider-settings-status').textContent=message;$('provider-settings-status').classList.toggle('error',error);}
function connectionStatus(message,error=false){const el=$('provider-connection-status');el.hidden=!message;el.textContent=message;el.classList.toggle('error',error);}
function resetConnection(){connectionAttempt++;$('test-provider').disabled=false;$('test-provider').textContent='测试连接';connectionStatus('');}
function settingsGuard(fn){return async()=>{try{await fn();}catch(e){settingsStatus(e.message,true);}};}
function renderProviderSettings(){
  const provider=$('config-provider').value,credential=channels.credentials[provider];$('key-state').textContent=credential?.configured?'已配置'+(credential.source==='environment'?'（来自本机环境变量）':'（本机保存）'):'尚未配置';
  const presets=(state.providerPresets||[]).filter(p=>p.provider===provider);$('managed-presets').innerHTML='<option value="">'+(presets.length?'选择预设以编辑或删除':'尚未导入模型预设')+'</option>'+presets.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
}
function renderMapping(){
  $('save-provider-preset').disabled=!presetDraft;$('preset-mapping').innerHTML=(presetDraft?.nodes||[]).map((n,i)=>{
    const value=n.options?.length?'<select data-node-value="'+i+'" aria-label="'+esc(n.fieldName)+' 固定值">'+n.options.map(o=>'<option value="'+esc(JSON.stringify(o.value))+'"'+(o.value===n.value?' selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>':'<input data-node-value="'+i+'" aria-label="'+esc(n.fieldName)+' 固定值" value="'+esc(n.value)+'" '+(typeof n.value==='number'?'type="number" step="any"':'')+'>';
    return '<div class="mapping-row"><div><strong>'+esc(n.description||n.fieldName)+'</strong><br><small>'+esc(n.nodeId+' / '+n.fieldName)+'</small></div><select data-node-source="'+i+'" aria-label="'+esc(n.fieldName)+' 输入来源">'+channels.inputSources.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===n.source?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select><div class="mapping-value">'+(n.source==='fixed'?value:['portrait','costume','pose','references'].includes(n.source)?'<label class="field"><span>图片传入方式</span><select data-node-format="'+i+'"><option value="fileName"'+(n.format==='fileName'?' selected':'')+'>上传文件名（LoadImage 等节点）</option><option value="url"'+(n.format==='url'?' selected':'')+'>公开图片 URL（URL 输入节点）</option></select></label>':'<small>运行时自动填入'+esc(channels.inputSources.find(([v])=>v===n.source)?.[1])+'</small>')+'</div></div>';
  }).join('');
}
function suggestMappings(nodes){
  const used=new Set();for(const n of nodes){const label=n.description+' '+n.fieldName;
    if(/negative|负面/i.test(label))continue;
    let source=/portrait|character|主角|人像|身份/i.test(label)?'portrait':/costume|cloth|服装|衣服/i.test(label)?'costume':/pose|姿势|姿态/i.test(label)?'pose':/prompt|提示词|^text$/i.test(n.fieldName)?'prompt':/aspect.?ratio|宽高比|比例/i.test(label)?'ratio':n.fieldName==='width'?'width':n.fieldName==='height'?'height':null;
    if(source&&!used.has(source)){n.source=source;used.add(source);}
  }
  const images=nodes.filter(n=>n.source==='fixed'&&/image|图片|图像/i.test(n.fieldName+' '+n.description));const remaining=['portrait','costume','pose'].filter(s=>!used.has(s));
  if(images.length===remaining.length)images.forEach((n,i)=>n.source=remaining[i]);
}
async function loadChannels(){try{channels={...await call('generation_channels'),available:true};}catch(e){if(!/不存在该工具|unknown tool|tool.*not found/i.test(e.message))throw e;channels.available=false;}}
async function inspectPreset(){
  const button=$('inspect-provider-preset');button.disabled=true;settingsStatus('正在读取字段，不会启动生图…');
  try{const data=await call('inspect_provider_preset',{provider:$('config-provider').value,kind:$('preset-kind').value,link:$('preset-link').value.trim(),example:$('preset-example').value});presetDraft={...data,name:$('preset-name').value};suggestMappings(presetDraft.nodes);$('preset-example').value='';renderMapping();settingsStatus('已读取 '+data.nodes.length+' 个字段，请确认三张参考图和任务提示词的映射后保存。');}finally{button.disabled=false;}
}
function renderExecution(){
  if(!state)return;const b=state.batch,execution=state.execution?.batchId===b?.id?state.execution:null;
  const task=state.tasks.find(t=>t.batchId===b?.id&&t.status==='running');
  let message=execution?.message||(['queued','running'].includes(b?.status)?'任务已排队，等待执行器领取…':'');
  if(task?.startedAt){const elapsed=Math.max(0,Math.floor((Date.now()-Date.parse(task.startedAt))/1000));message+=' · 已用时 '+Math.floor(elapsed/60)+'分'+String(elapsed%60).padStart(2,'0')+'秒';}
  $('execution-message').hidden=!message;$('execution-message').textContent=message;$('execution-message').classList.toggle('error',execution?.phase==='failed');
}
function loadSuccessImages(){for(const img of $('success-results').querySelectorAll('[data-result-image]'))if(!img.src)imageURL(img.dataset.resultImage).then(url=>img.src=url).catch(()=>{img.alt='结果读取失败';});}
$('success-history').addEventListener('toggle',()=>{if($('success-history').open)loadSuccessImages();});
function renderSelected(){const selected=kind==='costume'?state.draft.costumeIds:state.draft.poseIds;for(const tile of document.querySelectorAll('[data-select]')){const on=selected.includes(kind+':'+tile.dataset.select);tile.setAttribute('aria-pressed',String(on));const tick=tile.querySelector('.tick');if(tick)tick.hidden=!on;}}
async function catalog(refresh=false){
  const request=++queryId,f={...filters[kind]},requestedKind=kind;
  $('gallery').innerHTML='<p class="empty">正在读取 '+(kind==='costume'?'服装':'姿势')+' 图库…</p>';
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
  const key=d.kind==='costume'?'costumeIds':'poseIds';
  referenceOps=referenceOps.then(async()=>{const ref=await call('select_reference',{item:d});const chosen=state.draft[key];await persist({[key]:chosen.includes(ref.id)?chosen.filter(id=>id!==ref.id):[...chosen,ref.id]});});
  return referenceOps.catch(e=>{status(e.message,true);referenceOps=Promise.resolve();});
}
async function notifyAgent(){
  if(dispatching)return;dispatching=true;renderState();
  const batchId=state.batch.id;
  const text='请使用 Character Studio 的 claim_next_task 领取本机工作台刚提交的任务。逐张查看任务返回的三张本地参考图，使用当前宿主已有的生图工具按 task.prompt 生图，再调用 record_result 回填真实结果。单项失败时回填具体原因，跳过该项并重新领取下一项，不自动重试或改写被拒绝的任务。每次生成前重新领取任务；如果返回暂停、样图待确认、取消或没有任务，请停止。没有生图工具时明确说明，不要求我填 API Key，不使用占位图。';
  try{
    if(state.batch.provider!=='agent')await call('start_generation');
    else if(app){const r=await app.sendMessage({role:'user',content:[{type:'text',text}]});if(r.isError)throw Error('宿主未接收任务消息');}
    else if(window.openai?.sendFollowUpMessage)await window.openai.sendFollowUpMessage({prompt:text,title:'开始 Character Studio 生图任务'});
    else{const current=await call('get_state');if(!current.agentConnection?.connected)throw Error(current.agentConnection?.reason||'当前页面没有连接宿主聊天。请回到 Agent 聊天说“打开人物工作台”，连接后点击“继续剩余任务”。也可以在生图设置中选择已经配置好的其他渠道。');}
    status('任务已提交，下方显示实际执行状态、结果和失败原因。');
  }catch(e){
    const message='自动提交失败：'+e.message;
    try{await call('report_dispatch_error',{batchId,error:message});}catch{}
    status(message,true);
  }finally{dispatching=false;await refresh();renderState();}
}
function guarded(fn){return async(...args)=>{try{await fn(...args)}catch(e){status(e.message,true)}}}
$('portrait-file').onchange=guarded(async e=>{
  const file=e.target.files[0];if(!file)return;if(file.size>12*1024*1024)throw Error('主角图不能超过 12 MB');
  status('正在保存主角图…');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  await call('upload_character',{name:file.name,base64:data.split(',')[1]});await refresh();status('主角图已保存到本机');
});
$('gallery').onclick=guarded(e=>{const b=e.target.closest('[data-select]');if(b)return toggleReference(b.dataset.select);});
document.addEventListener('click',guarded(async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.remove){const k=b.dataset.remove.startsWith('pose:')?'poseIds':'costumeIds';await persist({[k]:state.draft[k].filter(id=>id!==b.dataset.remove)});}
  if(b.dataset.delete){state=await call('edit_task',{taskId:b.dataset.delete,patch:{remove:true}});renderState();}
  if(b.dataset.edit){editing=b.dataset.edit;const t=state.tasks.find(t=>t.id===editing);for(const [id,k]of [['edit-costume','costumeId'],['edit-pose','poseId']]){$(id).innerHTML=Object.values(state.assets).filter(a=>a.kind===(k==='costumeId'?'costume':'pose')).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.sourceId||a.name)+'</option>').join('');$(id).value=t[k];}$('edit-prompt').value=t.prompt;$('editor').showModal();}
  if(b.dataset.retry){state=await call('retry_task',{taskId:b.dataset.retry});renderState();await notifyAgent();}
  if(b.dataset.view){const url=await imageURL(b.dataset.view);$('viewer-image').src=url;$('download').href=url;$('viewer').showModal();}
}));
$('save-task').onclick=guarded(async()=>{const old=state.tasks.find(t=>t.id===editing),patch={};if($('edit-costume').value!==old.costumeId)patch.costumeId=$('edit-costume').value;if($('edit-pose').value!==old.poseId)patch.poseId=$('edit-pose').value;if($('edit-prompt').value!==old.prompt)patch.prompt=$('edit-prompt').value;state=await call('edit_task',{taskId:editing,patch});$('editor').close();renderState();});
for(const [id,key]of [['notes','notes'],['template','template']])$(id).onchange=()=>persist({[key]:$(id).value});
for(const [id,key]of [['ratio','ratio'],['mode','mode']])$(id).onchange=()=>persist({[key]:$(id).value});
$('build').onclick=guarded(async()=>{await persist({notes:$('notes').value,template:$('template').value});state=await call('build_queue');renderState();status('队列已建立，可逐条调整后提交');});
$('submit').onclick=guarded(async()=>{if(preparing||dispatching)return;preparing=true;renderState();try{await saving;await referenceOps;if(state.batch?.status!=='draft'){await persist({notes:$('notes').value,template:$('template').value});state=await call('build_queue');}state=await call('control_batch',{action:'start'});renderState();await notifyAgent();}finally{preparing=false;renderState();}});
$('pause').onclick=guarded(async()=>{state=await call('control_batch',{action:'pause'});renderState();status('已暂停后续任务；当前已开始的任务会继续完成。');});
$('continue').onclick=guarded(async()=>{state=await call('control_batch',{action:'continue'});renderState();await notifyAgent();});
$('cancel').onclick=guarded(async()=>{state=await call('control_batch',{action:'cancel'});renderState();status(!isNativeProvider(state.batch.provider||'codex')?'已停止本机处理和后续任务；已提交到 RunningHub 的任务可能仍在运行，可在站点任务记录中取消。':'已取消当前批次。');});
$('refresh').onclick=guarded(async()=>{await saving;await refresh();if(!app)await probeExecutor();status('已恢复本机保存状态');});
$('close-editor').onclick=()=>$('editor').close();$('close-viewer').onclick=()=>$('viewer').close();
for(const k of ['pose','costume'])$(k+'-tab').onclick=()=>{kind=k;offset=0;$('search').value=filters[k].q;for(const t of ['costume','pose'])$(t+'-tab').setAttribute('aria-selected',String(t===k));$('library-panel').setAttribute('aria-labelledby',k+'-tab');catalog();};
$('category').onchange=()=>{filters[kind].category=$('category').value;offset=0;catalog();};$('angle').onchange=()=>{filters[kind].angle=$('angle').value;offset=0;catalog();};
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{filters[kind].q=$('search').value;offset=0;catalog()},250)};
$('previous').onclick=()=>{offset=Math.max(0,offset-pageSize);catalog();};$('next').onclick=()=>{offset+=pageSize;catalog();};$('reload-catalog').onclick=()=>catalog(true);
$('source').onclick=guarded(async()=>{const url=kind==='pose'?'https://ai-pose-depth-gallery.pages.dev/':'https://ai-costume-gallery.pages.dev/';if(app)await app.openLink({url});else window.open(url,'_blank','noopener');});
$('expand').onclick=guarded(async()=>app.requestDisplayMode({mode:'fullscreen'}));
$('provider').onchange=guarded(async()=>{await persist({provider:$('provider').value});await probeExecutor();});
$('provider-preset').onchange=()=>persist({providerPresetId:$('provider-preset').value||null});
$('open-provider-settings').onclick=guarded(async()=>{await loadChannels();if(!state)await refresh();$('config-provider').value=state.draft.provider==='runninghub-global'?'runninghub-global':'runninghub-cn';renderProviderSettings();settingsStatus('');$('provider-settings').showModal();});
$('close-provider-settings').onclick=()=>{$('provider-key').value='';$('preset-example').value='';$('provider-settings').close();};
$('provider-settings').addEventListener('close',()=>{$('provider-key').value='';$('preset-example').value='';resetConnection();});
$('config-provider').onchange=()=>{$('provider-key').value='';presetDraft=null;$('preset-name').value='';$('preset-link').value='';$('preset-example').value='';resetConnection();renderMapping();renderProviderSettings();settingsStatus('');};
$('save-provider-key').onclick=settingsGuard(async()=>{const key=$('provider-key').value.trim();if(!key)throw Error('请输入新 Key；留空不会修改已保存的 Key');channels.credentials=await call('save_provider_keys',{keys:{[$('config-provider').value]:key}});$('provider-key').value='';resetConnection();renderProviderSettings();renderGeneration();settingsStatus('Key 已保存在本机。');});
$('clear-provider-key').onclick=settingsGuard(async()=>{channels.credentials=await call('save_provider_keys',{keys:{[$('config-provider').value]:''}});$('provider-key').value='';resetConnection();renderProviderSettings();renderGeneration();settingsStatus(channels.credentials[$('config-provider').value]?.source==='environment'?'本机保存的 Key 已删除；环境变量仍然生效。':'本机保存的 Key 已删除。');});
$('test-provider').onclick=async()=>{
  const attempt=++connectionAttempt,provider=$('config-provider').value,inputKey=$('provider-key').value.trim(),button=$('test-provider');button.disabled=true;button.textContent='测试中…';
  connectionStatus(inputKey?'正在测试输入框中的 Key，不会保存或生成图片…':'正在测试此站点已保存的 Key，不会生成图片…');
  try{const result=await call('execution_status',{provider,...(inputKey?{inputKey}:{})});if(attempt!==connectionAttempt)return;connectionStatus((result.available?result.message:result.reason)+(inputKey?'\n本次测试使用输入框中的 Key，尚未保存。':''),!result.available);}
  catch(e){if(attempt===connectionAttempt)connectionStatus('测试连接失败：'+e.message,true);}
  finally{if(attempt===connectionAttempt){button.disabled=false;button.textContent='测试连接';}}
};
$('inspect-provider-preset').onclick=settingsGuard(inspectPreset);
for(const id of ['preset-kind','preset-link'])$(id).onchange=()=>{presetDraft=null;renderMapping();};
$('preset-file').onchange=settingsGuard(async()=>{const file=$('preset-file').files[0];if(!file)return;if(file.size>150000)throw Error('导入文件不能超过 150 KB');$('preset-example').value=await file.text();settingsStatus('已读取文件，请点击“读取输入字段”。');});
$('preset-mapping').onchange=e=>{const index=e.target.dataset.nodeSource??e.target.dataset.nodeFormat??e.target.dataset.nodeValue;if(index===undefined||!presetDraft)return;const n=presetDraft.nodes[Number(index)];if(e.target.dataset.nodeSource!==undefined){n.source=e.target.value;renderMapping();}else if(e.target.dataset.nodeFormat!==undefined)n.format=e.target.value;else n.value=e.target.tagName==='SELECT'?JSON.parse(e.target.value):typeof n.value==='number'?Number(e.target.value):typeof n.value==='boolean'?e.target.value==='true':e.target.value;};
$('save-provider-preset').onclick=settingsGuard(async()=>{if(!presetDraft)throw Error('请先读取输入字段');const saved=await call('save_provider_preset',{preset:{...presetDraft,name:$('preset-name').value.trim(),provider:$('config-provider').value,kind:$('preset-kind').value}});await refresh();await persist({provider:saved.provider,providerPresetId:saved.id});presetDraft=structuredClone(saved);renderProviderSettings();settingsStatus('模型预设已保存，可在工作台下拉框中选择。');});
$('edit-provider-preset').onclick=settingsGuard(async()=>{const p=(state.providerPresets||[]).find(p=>p.id===$('managed-presets').value);if(!p)throw Error('请选择已保存的预设');presetDraft=structuredClone(p);$('preset-name').value=p.name;$('preset-kind').value=p.kind;$('preset-link').value=p.remoteId;renderMapping();settingsStatus('修改后点击“保存模型预设”，已提交任务使用原来的配置。');});
$('delete-provider-preset').onclick=settingsGuard(async()=>{const id=$('managed-presets').value;if(!id)throw Error('请选择要删除的预设');state=await call('delete_provider_preset',{id});presetDraft=null;renderMapping();renderState();renderProviderSettings();settingsStatus('预设已删除，历史结果保留。');});
async function init(){
  if(window.parent!==window){
    app=new App({name:'Character Studio',version:'0.2.0'},{},{autoResize:true});
    app.ontoolresult=()=>refresh().catch(e=>status(e.message,true));
    await app.connect(undefined,{timeout:10000});$('connection').textContent='Agent 已连接';$('expand').hidden=false;
  }else{$('connection').textContent='正在恢复工作台…';}
  await loadChannels();await refresh();if(!app)await probeExecutor();await catalog();
  setInterval(()=>{if(!document.hidden){renderExecution();refresh().catch(e=>status('状态刷新失败：'+e.message,true));}},2000);
}
async function probeExecutor(){const request=++probeId;if(state?.draft.provider==='agent'&&(app?.getHostCapabilities()?.message?.text||window.openai?.sendFollowUpMessage||state.agentConnection?.connected)){$('connection').textContent=state.agentConnection?.connected?state.agentConnection.agentName+' 已连接':'Agent 消息已连接';$('executor-note').hidden=true;return;}try{const result=await call('execution_status',state?{provider:state.draft.provider||'codex'}:{});if(request!==probeId)return;$('connection').textContent=result.available?'一键生成已连接':'自动生成未就绪';$('executor-note').hidden=result.available;$('executor-note').textContent=result.reason||'';}catch(e){if(request!==probeId)return;$('connection').textContent='自动生成连接失败';$('executor-note').hidden=false;$('executor-note').textContent=e.message;}}
init().catch(e=>{status('工作台连接失败：'+e.message,true);$('connection').textContent='连接失败';});
