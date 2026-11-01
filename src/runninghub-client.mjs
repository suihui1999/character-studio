import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {RH_ORIGINS,remoteId,importedNodes,personalPayload,validatePreset} from './generation-models.mjs';
import {imageType} from './store.mjs';
export class RunningHubClient{
  constructor(credentials,{origins=RH_ORIGINS,pollMs=5000,timeoutMs=15*60*1000,probeTimeoutMs=10000,fetchImpl=fetch}={}){this.credentials=credentials;this.origins=origins;this.pollMs=pollMs;this.timeoutMs=timeoutMs;this.probeTimeoutMs=probeTimeoutMs;this.fetch=fetchImpl;}
  async request(provider,key,endpoint,body,{signal,multipart=false,method='POST',timeoutMs=60000}={}){
    try{
      const response=await this.fetch(this.origins[provider]+endpoint,{method,headers:{Authorization:'Bearer '+key,...(multipart||method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:multipart?body:JSON.stringify(body)}),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)]),redirect:'error'});
      const j=await response.json().catch(()=>{throw Error('RunningHub 返回了无法读取的响应（HTTP '+response.status+'）');});
      if(!response.ok||(j.code!==undefined&&!['0','200'].includes(String(j.code)))){
        const detail=[j.errorCode,j.errorMessage,j.errorMsg,j.message,j.msg,j.data?.failedReason,j.data?.exception_message,typeof j.error==='string'?j.error:j.error?.message].filter(Boolean).join(' · ')||'请求失败';
        const e=Error('RunningHub HTTP '+response.status+(j.code!==undefined?' / '+j.code:'')+'：'+detail);
        e.providerCode=String(j.code??'');e.httpStatus=response.status;
        e.fatal=[401,402,403].includes(response.status)||/api.?key|unauthorized|insufficient|余额|额度|欠费|鉴权/i.test(detail);throw e;
      }return j;
    }catch(e){const message=key&&e.message?e.message.replaceAll(key,'[Key 已隐藏]').replaceAll(encodeURIComponent(key),'[Key 已隐藏]'):e.message;
      if(message!==e.message){const redacted=Error(message);Object.assign(redacted,{name:e.name,fatal:e.fatal,providerCode:e.providerCode,httpStatus:e.httpStatus});throw redacted;}throw e;}
  }
  async preflight(provider,preset){validatePreset(preset);return this.credentials.key(provider);}
  async probe(provider,inputKey){try{
    const key=inputKey?.trim()||await this.credentials.key(provider);if(/[\r\n]/.test(key))throw Error('Key 不能包含换行，请只填写密钥本身');await this.request(provider,key,'/uc/openapi/accountStatus',{apikey:key},{timeoutMs:this.probeTimeoutMs});
    return {available:true,engine:provider,message:'RunningHub 个人版连接成功（未生成图片）'};
  }catch(e){
    let reason=e.message;
    if(e.providerCode==='806')reason='RunningHub 返回 806：未找到此 Key 关联的用户。请核对所选站点和 Key 是否复制完整。';
    else if(e.providerCode==='802'||e.httpStatus===401)reason='RunningHub 未接受此 Key：可能未授权、已失效或不属于所选站点。';
    else if(e.providerCode==='801')reason='此账户暂不支持个人版 API，请在对应站点确认 API 权限。';
    else if(e.name==='TimeoutError'||e.name==='AbortError')reason='连接 RunningHub 超时（'+Math.round(this.probeTimeoutMs/1000)+' 秒），请检查网络后重试。';
    else if(e.message==='fetch failed')reason='无法连接 RunningHub，请检查网络连接后重试。';
    return {available:false,engine:provider,reason,details:e.message,...(e.providerCode?{code:e.providerCode}:{})};
  }}
  async inspect({provider,kind,link,example}){
    if(!['app','workflow'].includes(kind))throw Error('请选择 AI 应用或工作流');const id=remoteId(provider,link);let data;
    if(example?.trim())data=example;
    else{const key=await this.credentials.key(provider);data=kind==='app'?await this.request(provider,key,'/api/webapp/apiCallDemo?'+new URLSearchParams({apiKey:key,webappId:id}),null,{method:'GET'}):await this.request(provider,key,'/api/openapi/getJsonApiFormat',{apiKey:key,workflowId:id});}
    return {provider,kind,remoteId:id,nodes:importedNodes(data,kind)};
  }
  async generate(task,{signal,onProgress=async()=>{},onRemote=async()=>{}}={}){
    const key=await this.preflight(task.provider,task.providerPreset),preset=validatePreset(task.providerPreset),files=[];
    if(task.references.length!==3)throw Error('需要按主角、服装、姿势提供三张参考图');
    personalPayload(task,['portrait','costume','pose'].map(kind=>({kind,fileName:'validation.png',url:'https://example.invalid/validation.png'})));
    for(let i=0;i<task.references.length;i++){
      signal?.throwIfAborted();const ref=task.references[i],bytes=await readFile(ref.path),type=imageType(bytes);if(bytes.length>30*1024*1024)throw Error('参考图超过 RunningHub 30 MB 限制');
      const formats=new Set(preset.nodes.filter(n=>n.source===ref.kind||n.source==='references').map(n=>n.format));const file={kind:ref.kind};
      await onProgress('正在上传参考图 '+(i+1)+'/3…');
      for(const format of formats){const form=new FormData();form.set('file',new Blob([bytes],{type:type.mime}),'reference-'+(i+1)+type.ext);
        if(format==='url'){const upload=await this.request(task.provider,key,'/openapi/v2/media/upload/binary',form,{signal,multipart:true});file.url=upload.data?.download_url;if(!file.url||!/^https?:\/\//.test(file.url))throw Error('RunningHub 上传未返回图片 URL');}
        else{form.set('apiKey',key);form.set('fileType','input');const upload=await this.request(task.provider,key,'/task/openapi/upload',form,{signal,multipart:true});file.fileName=upload.data?.fileName;if(!file.fileName)throw Error('RunningHub 上传未返回 fileName');}
      }files.push(file);
    }
    const {nodeInfoList}=personalPayload(task,files);await onProgress('正在提交到 RunningHub 个人版…');
    const submitted=await this.request(task.provider,key,preset.kind==='app'?'/task/openapi/ai-app/run':'/task/openapi/create',{apiKey:key,[preset.kind==='app'?'webappId':'workflowId']:preset.remoteId,nodeInfoList});
    const taskId=submitted.data?.taskId||submitted.taskId;if(!taskId)throw Error('RunningHub 未返回 taskId，未自动重提以避免重复计费');
    await onRemote({remoteTaskId:String(taskId),providerStatus:'CREATE'});const deadline=Date.now()+this.timeoutMs;
    try{
      while(Date.now()<deadline){
        signal?.throwIfAborted();const raw=await this.request(task.provider,key,'/task/openapi/status',{apiKey:key,taskId},{signal});const status=typeof raw.data==='string'?raw.data:raw.data?.status||raw.data?.taskStatus;
        if(!['CREATE','QUEUED','RUNNING','SUCCESS','FAILED','CANCEL','CANCELED','CANCELLED'].includes(status))throw Error('RunningHub 返回未知任务状态：'+status);
        await onRemote({remoteTaskId:String(taskId),providerStatus:status});
        if(status==='SUCCESS'||status==='FAILED'){
          const outputs=await this.request(task.provider,key,'/task/openapi/outputs',{apiKey:key,taskId},{signal});
          if(status==='FAILED')throw Error('RunningHub 生成失败，未返回可用结果');
          const output=(Array.isArray(outputs.data)?outputs.data:[]).find(r=>(!r.fileType||/^(png|jpe?g|webp|image)$/i.test(r.fileType))&&r.fileUrl),url=output?.fileUrl;
          if(!url)throw Error('RunningHub 报告成功但未返回图片地址');
          const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&new URL(this.origins[task.provider]).protocol==='http:'))throw Error('结果图片地址协议不受支持');
          await onProgress('生成完成，正在保存图片…');
          const response=await this.fetch(url,{signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]),redirect:'error'});if(!response.ok)throw Error('结果图片下载失败 HTTP '+response.status);
          const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>12*1024*1024)throw Error('结果图片超过本地 12 MB 保存限制');chunks.push(chunk);}
          const bytes=Buffer.concat(chunks);imageType(bytes);await onRemote({remoteTaskId:String(taskId),providerStatus:status,outputUrl:url});return {base64:bytes.toString('base64')};
        }
        if(status.startsWith('CANCEL'))throw Error('RunningHub 远端任务已取消');
        await onProgress((status==='RUNNING'?'RunningHub 正在生成':'RunningHub 排队中')+' · 任务 '+taskId);
        await delay(Math.min(this.pollMs,Math.max(1,deadline-Date.now())),undefined,{signal});
      }throw Error('RunningHub 等待结果超过 '+Math.round(this.timeoutMs/60000)+' 分钟；远端任务可能仍在执行，可用任务编号查询，未自动重提');
    }catch(e){const failure=Error((e.message+'（RunningHub 任务 '+taskId+'）').replaceAll(key,'[Key 已隐藏]'));Object.assign(failure,{name:e.name,fatal:e.fatal});throw failure;}
  }
}
