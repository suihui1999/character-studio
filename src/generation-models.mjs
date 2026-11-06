import {IMAGE_API_SERVICES,isImageApi,validateImageApiPreset} from './image-api-presets.mjs';
export const PROVIDERS=[{id:'codex',name:'本机 Codex 生图'},{id:'agent',name:'当前 Agent 原生生图'},...IMAGE_API_SERVICES.map(({id,name})=>({id,name}))];
export const isNativeProvider=provider=>provider==='codex'||provider==='agent';
export function matchesAgentHost(host,name){
  if(!host)return true;
  return host==='doubao'?/豆包|doubao/i.test(name||''):/codex/i.test(name||'');
}
export const REFERENCE_LABELS={portrait:'主角',costume:'服装',pose:'姿势'};
const DEFAULT_RATIOS=['3:4','1:1','4:3','9:16','16:9'];
export function outputRatios(preset){
  if(preset?.kind==='image-api')return preset.ratios;
  const choices=preset?.nodes.find(n=>n.source==='ratio'&&n.options?.length)?.options;
  return choices?choices.map(o=>o.value).filter(v=>typeof v==='string'&&/^\d{1,3}:\d{1,3}$/.test(v)):DEFAULT_RATIOS;
}
export function queueReferences(draft){
  const costumes=draft.costumeIds.length?draft.costumeIds:[null];
  const poses=draft.poseIds.length?draft.poseIds:[null];
  return {costumes,poses,count:costumes[0]||poses[0]?costumes.length*poses.length:0};
}
export function queueInputs(draft,provider,preset){
  // Keep saved single-image previews valid across the removal of sample mode.
  return JSON.stringify([draft.portraitId,draft.costumeIds,draft.poseIds,draft.mode||'all',draft.ratio,draft.template,draft.notes,provider,preset||null]);
}
export function referenceCompatibility(preset,kinds,ratio){
  if(!preset)return '';
  if(preset.kind==='image-api')return preset.ratios.includes(ratio)?'':'当前模型不支持 '+ratio+'，请更换模型或输出比例。';
  const sources=new Set(preset.nodes.map(n=>n.source));
  for(const kind of Object.keys(REFERENCE_LABELS)){
    if(!kinds.includes(kind)&&(sources.has(kind)||sources.has('references')&&!preset.allowPartialReferences)){
      return '当前模型需要'+REFERENCE_LABELS[kind]+'参考图，请先补齐再生成。';
    }
  }
  if(preset.nodes.some(n=>n.source==='ratio'&&n.options?.length&&!n.options.some(o=>o.value===ratio))){
    return '当前模型不支持 '+ratio+'，请更换模型或输出比例。';
  }
  return '';
}
export function selectedPreset(presets,provider,id){
  if(isNativeProvider(provider))return null;
  return presets.find(p=>p.provider===provider&&p.id===id)||
    presets.find(p=>p.provider===provider&&p.builtin)||null;
}
export const RH_ORIGINS={'runninghub-cn':'https://www.runninghub.cn','runninghub-global':'https://www.runninghub.ai'};
export const INPUT_SOURCES=[['fixed','保留原值'],['portrait','主角参考图'],['costume','服装参考图'],['pose','姿势参考图'],['references','参考图列表（JSON）'],['prompt','任务提示词'],['ratio','输出比例'],['width','输出宽度'],['height','输出高度']];
export function checkProvider(provider){if(!PROVIDERS.some(p=>p.id===provider)&&!RH_ORIGINS[provider])throw Error('未知生图渠道');return provider;}
export function remoteId(provider,value){
  if(!RH_ORIGINS[provider])throw Error('请选择 RunningHub 站点');value=String(value).trim();if(/^\d{1,30}$/.test(value))return value;
  let url;try{url=new URL(value);}catch{throw Error('请输入应用/工作流链接或数字 ID');}
  const host=new URL(RH_ORIGINS[provider]).hostname.replace(/^www\./,'');
  if(url.protocol!=='https:'||![host,'www.'+host].includes(url.hostname))throw Error('链接所属站点与所选渠道不同');
  const id=url.pathname.split('/').filter(s=>/^\d{1,30}$/.test(s)).at(-1)||url.searchParams.get('webappId')||url.searchParams.get('workflowId');
  if(!id||!/^\d{1,30}$/.test(id))throw Error('链接中未找到应用或工作流 ID');return id;
}
function parseJSON(text){return JSON.parse(text.replace(/("(?:webappId|workflowId)"\s*:\s*)(\d{15,})(?=\s*[,}])/g,'$1"$2"'));}
export function parseExample(value){
  if(typeof value!=='string')return value;
  const text=value.trim();try{return parseJSON(text);}catch{}
  // Imported examples are data, never executable commands.
  for(let start=text.indexOf('{');start>=0;start=text.indexOf('{',start+1)){
    let depth=0,quoted=false,escaped=false;
    for(let n=start;n<text.length;n++){const c=text[n];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return parseJSON(text.slice(start,n+1));}catch{break;}}}
  }throw Error('无法读取调用示例，请粘贴请求体 JSON、cURL 或工作流 API JSON');
}
export function importedNodes(example,kind){
  let data=parseExample(example);if(data?.data)data=data.data;
  if(data?.curl)data=parseExample(data.curl);
  if(data?.prompt)data=parseExample(data.prompt);
  let nodes=data?.nodeInfoList;
  if(!nodes&&kind==='workflow'){
    const graph=typeof data==='string'?parseExample(data):data;
    nodes=Object.entries(graph||{}).flatMap(([nodeId,n])=>Object.entries(n?.inputs||{}).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v)).map(([fieldName,fieldValue])=>({nodeId,fieldName,fieldValue,description:n._meta?.title||n.class_type||''})));
  }
  if(!Array.isArray(nodes)||!nodes.length)throw Error('未找到 nodeInfoList；请导入应用 API 调用示例或工作流的 API 格式 JSON');
  if(nodes.length>300)throw Error('可配置输入过多，请先精简工作流');
  return nodes.map(n=>{
    if(!n||!n.nodeId||!n.fieldName||/api.?key|secret|token|password/i.test(n.fieldName))throw Error('输入字段无效或包含密钥字段；请将鉴权信息留在渠道设置');
    let options;try{const f=typeof n.fieldData==='string'?JSON.parse(n.fieldData):n.fieldData;if(Array.isArray(f))options=f.filter(x=>x.index!==undefined||x.name!==undefined).map(x=>({value:x.index??x.name,label:x.description||x.name||String(x.index)}));}catch{}
    return {nodeId:String(n.nodeId),fieldName:String(n.fieldName),value:n.fieldValue??'',description:String(n.description||n.fieldName).slice(0,200),...(options?.length?{options}:{}),source:'fixed',format:'fileName'};
  });
}
export function validatePreset(preset){
  if(isImageApi(preset?.provider))return validateImageApiPreset(preset);
  checkProvider(preset.provider);if(!RH_ORIGINS[preset.provider]||!['app','workflow'].includes(preset.kind))throw Error('请选择个人版 AI 应用或工作流');
  const id=remoteId(preset.provider,preset.remoteId);if(!preset.name?.trim()||preset.name.length>150)throw Error('请填写模型预设名称');
  if(!Array.isArray(preset.nodes)||!preset.nodes.length||preset.nodes.length>300)throw Error('请先导入输入字段');
  const seen=new Set(),sources=new Set();const nodes=preset.nodes.map(n=>{
    if(!/^[\w:.\-]{1,100}$/.test(n.nodeId)||!n.fieldName||n.fieldName.length>150||/api.?key|secret|token|password/i.test(n.fieldName))throw Error('节点字段无效');
    const key=n.nodeId+'##'+n.fieldName;if(seen.has(key))throw Error('同一节点字段不能重复映射');seen.add(key);
    if(!INPUT_SOURCES.some(([s])=>s===n.source)||!['fileName','url'].includes(n.format||'fileName'))throw Error('输入映射无效');sources.add(n.source);
    if((typeof n.value==='object'&&n.value!==null)||JSON.stringify(n.value??'').length>12000)throw Error('节点固定值过长或格式不受支持');
    if(n.source==='fixed'&&n.options?.length&&!n.options.some(o=>o.value===n.value))throw Error('节点固定值不在应用提供的选项中：'+n.fieldName);
    return {nodeId:n.nodeId,fieldName:n.fieldName,value:n.value??'',description:String(n.description||'').slice(0,200),source:n.source,format:n.format||'fileName',...(n.options?{options:n.options}: {})};
  });
  if(!sources.has('prompt'))throw Error('请指定一个“任务提示词”输入');
  if(!sources.has('references')&&!['portrait','costume','pose'].every(s=>sources.has(s)))throw Error('请映射主角、服装、姿势三张图，或映射“参考图列表”输入');
  return {id:preset.id,provider:preset.provider,kind:preset.kind,remoteId:id,name:preset.name.trim(),nodes,...(preset.kind==='workflow'&&preset.apiVersion===2?{apiVersion:2}:{}),...(sources.has('references')&&preset.allowPartialReferences?{allowPartialReferences:true}:{})};
}
export function personalPayload(task,files){
  const preset=validatePreset(task.providerPreset);if(preset.provider!==task.provider)throw Error('任务渠道与模型预设不一致');
  const kinds=Object.keys(REFERENCE_LABELS).filter(kind=>files.some(file=>file.kind===kind));
  if(!kinds.includes('portrait'))throw Error('缺少主角参考图');
  const problem=referenceCompatibility(preset,kinds,task.ratio);
  if(problem)throw Error(problem);
  const [a,b]=task.ratio.split(':').map(Number),unit=Math.ceil(1024/Math.max(a,b)/8)*8;
  return {preset,nodeInfoList:preset.nodes.map(n=>{
    let value=n.value;const ref=s=>files.find(f=>f.kind===s)?.[n.format==='url'?'url':'fileName'];
    if(['portrait','costume','pose'].includes(n.source))value=ref(n.source);
    if(n.source==='references'){const values=kinds.map(ref);if(values.some(v=>!v))throw Error('参考图列表中的图片上传不完整');value=JSON.stringify(values);}
    if(n.source==='prompt')value=task.prompt;
    if(n.source==='ratio')value=n.options?.find(o=>o.value===task.ratio)?.fieldValue??task.ratio;
    if(n.source==='width')value=a*unit;if(n.source==='height')value=b*unit;
    if(value===undefined)throw Error('缺少映射的参考图：'+n.source);
    return {nodeId:n.nodeId,fieldName:n.fieldName,fieldValue:value};
  })};
}
