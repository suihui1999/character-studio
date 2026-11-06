import {readFile} from 'node:fs/promises';
import {imageType} from './store.mjs';
import {imageApiService,validateImageApiPreset} from './image-api-presets.mjs';

export class ImageApiClient{
  constructor(credentials,{fetchImpl=fetch,origins={},probeTimeoutMs=10000,timeoutMs=15*60*1000}={}){
    Object.assign(this,{credentials,fetch:fetchImpl,origins,probeTimeoutMs,timeoutMs});
  }
  config(preset){
    const p=validateImageApiPreset(preset,{requireConfigured:true}),service=imageApiService(p.provider);
    return {...p,baseUrl:this.origins[p.provider]||p.baseUrl||service.baseUrl,protocol:p.protocol||service.protocol,service};
  }
  async json(response,maxBytes=24*1024*1024){
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw Error('API 响应超过本机保存上限');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('API 返回的不是有效 JSON（HTTP '+response.status+'），请检查接口地址和协议');}
  }
  async request(config,key,route,{method='GET',body,signal,timeoutMs=this.timeoutMs}={}){
    const multipart=body instanceof FormData;
    try{
      const response=await this.fetch(config.baseUrl+route,{method,headers:{...(config.protocol==='gemini'?{'x-goog-api-key':key}:{Authorization:'Bearer '+key}),...(!body||multipart?{}:{'Content-Type':'application/json'})},...(body?{body:multipart?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)])});
      const data=await this.json(response,method==='GET'?2*1024*1024:24*1024*1024);
      if(!response.ok||data.error){
        const error=data.error,detail=typeof error==='string'?error:error?.message||data.message||'请求失败';
        const e=Error(config.service.name+' HTTP '+response.status+'：'+detail);
        Object.assign(e,{httpStatus:response.status,fatal:[401,402,403,429].includes(response.status)});throw e;
      }
      return data;
    }catch(error){
      let message=error.message;
      if(error.name==='TimeoutError'||error.name==='AbortError')message='连接或等待 '+config.service.name+' 超时，请检查网络。已提交的请求可能仍在服务端执行，请先查看平台用量记录再重做。';
      else if(message==='fetch failed')message='无法连接 '+config.service.name+'，请检查网络、代理和接口地址。'+(error.cause?.code?' 网络错误码：'+error.cause.code:'');
      message=String(message).replaceAll(key,'[Key 已隐藏]').replaceAll(encodeURIComponent(key),'[Key 已隐藏]');
      const redacted=Error(message);Object.assign(redacted,{name:error.name,httpStatus:error.httpStatus,fatal:error.fatal});throw redacted;
    }
  }
  async preflight(provider,preset){const config=this.config(preset);if(config.provider!==provider)throw Error('任务渠道与模型不匹配');await this.credentials.key(provider);return config;}
  async probe(provider,inputKey,preset){
    try{
      const config=this.config(preset),key=inputKey?.trim()||await this.credentials.key(provider);
      if(/[\r\n]/.test(key))throw Error('Key 不能包含换行，请只填写密钥本身');
      const route=config.protocol==='gemini'?'/models/'+encodeURIComponent(config.model):config.protocol==='seedream'||provider==='image-custom'?'/models':'/models/'+encodeURIComponent(config.model);
      const response=await this.request(config,key,route,{timeoutMs:this.probeTimeoutMs});
      if((config.protocol==='seedream'||provider==='image-custom')&&Array.isArray(response.data)&&!response.data.some(m=>m.id===config.model))throw Error('Key 已被接受，但账号的模型列表中没有 '+config.model+'。请开通该模型或更换模型。');
      return {available:true,engine:provider,message:'API 已连接，模型信息可访问。尚未验证生图能力。'};
    }catch(error){return {available:false,engine:provider,reason:error.message,details:error.message};}
  }
  size(ratio,protocol,model){
    const [a,b]=ratio.split(':').map(Number);
    if(!a||!b)throw Error('图片比例无效');
    if(model==='gpt-image-1.5')return a===b?'1024x1024':a>b?'1536x1024':'1024x1536';
    const unit=protocol==='seedream'?Math.ceil(Math.sqrt(4194304/(a*b))/16)*16:Math.floor(1536/Math.max(a,b)/16)*16;
    return a*unit+'x'+b*unit;
  }
  async generate(task,{signal,onProgress=async()=>{},onRemote=async()=>{}}={}){
    const config=await this.preflight(task.provider,task.providerPreset),key=await this.credentials.key(task.provider);
    if(!task.references.some(r=>r.kind==='portrait')||task.references.length<2||task.references.length>3)throw Error('生图需要一张主角图，以及服装或姿势参考图');
    const images=[];
    for(const ref of task.references){signal?.throwIfAborted();const bytes=await readFile(ref.path),type=imageType(bytes);if(bytes.length>10*1024*1024)throw Error('参考图超过 API 的 10 MB 上传限制');images.push({bytes,mime:type.mime,ext:type.ext});}
    const size=this.size(task.ratio,config.protocol,config.model);let route,body;
    if(config.protocol==='gemini'){
      route='/models/'+encodeURIComponent(config.model)+':generateContent';
      body={contents:[{role:'user',parts:[{text:task.prompt},...images.map(i=>({inlineData:{mimeType:i.mime,data:i.bytes.toString('base64')}}))]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:task.ratio}}};
    }else if(config.protocol==='seedream'){
      route='/images/generations';body={model:config.model,prompt:task.prompt,image:images.map(i=>'data:'+i.mime+';base64,'+i.bytes.toString('base64')),size,response_format:'b64_json',sequential_image_generation:'disabled',watermark:true};
    }else{
      route='/images/edits';
      if(config.protocol==='openai-multipart'){
        body=new FormData();body.set('model',config.model);body.set('prompt',task.prompt);body.set('n','1');body.set('size',size);
        for(let n=0;n<images.length;n++)body.append('image[]',new Blob([images[n].bytes],{type:images[n].mime}),'reference-'+(n+1)+images[n].ext);
      }else body={model:config.model,prompt:task.prompt,n:1,size,output_format:'png',images:images.map(i=>({image_url:'data:'+i.mime+';base64,'+i.bytes.toString('base64')}))};
    }
    await onProgress('正在将 '+images.length+' 张参考图发送到 '+config.service.name+'，等待生成…');
    const result=await this.request(config,key,route,{method:'POST',body,signal});
    if(result.id||result.request_id)await onRemote({remoteTaskId:result.id||result.request_id,providerStatus:'returned'});
    const parts=result.candidates?.flatMap(c=>c.content?.parts||[])||[];
    const inline=parts.find(p=>!p.thought&&(p.inlineData||p.inline_data));
    const encoded=inline?.inlineData?.data||inline?.inline_data?.data||result.data?.[0]?.b64_json;
    let bytes;
    if(encoded){
      if(typeof encoded!=='string'||encoded.length>17*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded))throw Error('API 返回的图片编码无效或超过本机 12 MB 保存上限');
      bytes=Buffer.from(encoded,'base64');
    }else if(result.data?.[0]?.url){
      const url=new URL(result.data[0].url);
      if(url.protocol!=='https:'&&!(url.protocol==='http:'&&this.origins[task.provider]?.startsWith('http://127.0.0.1:')))throw Error('API 返回了不受支持的图片地址');
      await onProgress('生成完成，正在下载并保存图片…');
      await onRemote({outputUrl:url.href,providerStatus:'generated'});
      try{
        const response=await this.fetch(url,{redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)])});
        if(!response.ok)throw Error('HTTP '+response.status);
        const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>12*1024*1024)throw Error('结果图片超过本机 12 MB 保存上限');chunks.push(chunk);}bytes=Buffer.concat(chunks);
      }catch(error){
        const reason=error.message==='fetch failed'?'无法连接结果图片服务器'+(error.cause?.code?'（'+error.cause.code+'）':''):error.message;
        throw Error(('图片已生成，但下载保存失败：'+reason+'。请先到服务商后台查看结果，再决定是否重做。').replaceAll(key,'[Key 已隐藏]'));
      }
    }else{
      const reason=result.promptFeedback?.blockReason||result.candidates?.[0]?.finishReason||parts.map(p=>p.text||'').join(' ').slice(0,800)||result.data?.[0]?.error?.message||'未返回可保存的图片';
      throw Error(config.service.name+' 未生成图片：'+String(reason).replaceAll(key,'[Key 已隐藏]'));
    }
    if(bytes.length>12*1024*1024)throw Error('结果图片超过本机 12 MB 保存上限');imageType(bytes);
    await onProgress('图片已返回，正在保存到成功记录…');
    return {base64:bytes.toString('base64')};
  }
}
