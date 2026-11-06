import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import path from 'node:path';
import {Store} from './store.mjs';
import {Catalog,SOURCES} from './catalog.mjs';
import {GenerationRunner} from './codex-executor.mjs';
import {ProviderCredentials} from './provider-credentials.mjs';
import {ImageApiClient} from './image-api-client.mjs';
import {IMAGE_API_SERVICES,isImageApi} from './image-api-presets.mjs';
import {PROVIDERS,isNativeProvider} from './generation-models.mjs';
import {AgentBridge} from './agent-bridge.mjs';
import {GenerationChecks} from './generation-checks.mjs';
import {BatchExporter} from './batch-export.mjs';
import {downloadCatalogImage} from './catalog-download.mjs';
import {VERSION,BUILD_ID,SERVICE} from './version.mjs';
import {createHash} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';

export const UI_URI='ui://character-studio/workbench.html';
const resourceMeta={ui:{prefersBorder:false,csp:{resourceDomains:[...Object.values(SOURCES).map(source=>new URL(source).origin),'data:','blob:'],connectDomains:[]}},'openai/widgetDescription':'人物、服装、姿势组合与批量任务工作台','openai/widgetPrefersBorder':false};
export async function createStudio(root,options={}){
  const store=await new Store(root,{builtinPresets:options.builtinPresets}).init(),catalog=new Catalog(store.root);
  if(store.state.draft.provider?.startsWith('runninghub-'))await store.mutate(()=>{
    const s=store.state;s.draft.provider='agent';s.draft.providerPresetId=null;
    if(s.batch?.provider?.startsWith('runninghub-')&&['queued','running','paused','draft'].includes(s.batch.status)){
      s.batch.status='cancelled';delete s.batch.resumeOnReconnect;
      s.tasks.filter(t=>t.batchId===s.batch.id&&['pending','running'].includes(t.status)).forEach(t=>t.status='cancelled');
      s.execution={batchId:s.batch.id,phase:'cancelled',message:'RunningHub 渠道已移除，请选择当前 Agent 或生图 API 创建新任务。'};
    }
  });
  const credentials=new ProviderCredentials(store,options.credentialOptions),imageApi=new ImageApiClient(credentials,options.imageApiOptions);
  const apiClient=provider=>{if(!isImageApi(provider))throw Error('RunningHub 渠道已移除，请选择当前 Agent 或生图 API。');return imageApi;};
  const runninghub={credentials,probe:(provider,...args)=>apiClient(provider).probe(provider,...args),preflight:(provider,...args)=>apiClient(provider).preflight(provider,...args),generate:(task,...args)=>apiClient(task.provider).generate(task,...args)};
  const runner=new GenerationRunner(store,{...options,runninghub});
  const agentBridge=new AgentBridge(store,options.agentBridgeOptions);
  const checks=new GenerationChecks(store,runner,runninghub,agentBridge);
  const exporter=new BatchExporter(store);
  let studio,downloadServerPromise;
  const downloadBase=async()=>{
    const server=studio.httpServer||await (downloadServerPromise??=serveHttp(studio,0).then(s=>{s.unref();return s;}).catch(e=>{downloadServerPromise=null;throw e;}));
    return 'http://127.0.0.1:'+server.address().port;
  };
  agentBridge.testWait=(args,signal)=>checks.wait(args,signal);
  const connection=()=>checks.active?.bridge?.status().connected?checks.active.bridge.status():agentBridge.status();
  const snapshot=async()=>{await agentBridge.reconcile();await checks.reconcile();return {...await store.refresh(),agentConnection:connection()};};
  const provider=z.enum(PROVIDERS.map(p=>p.id));
  const apiConfig=z.object({baseUrl:z.string().max(2000),model:z.string().max(150),protocol:z.enum(['openai-json','openai-multipart','gemini','seedream'])});
  const agentHost=z.enum(['codex','doubao']);
  const connectionReports=new Map();
  const tools={
    agent_connection_status:{schema:{checkId:z.string().uuid().optional()},read:true,appOnly:true,description:'读取当前 Agent 的连接及本次检测的回执。',run:a=>{
      const report=connectionReports.get(a.checkId);
      return {connection:connection(),report:report?.expiresAt>Date.now()?report.result:null};
    }},
    agent_report_connection:{schema:{checkId:z.string().uuid(),agentName:z.string().min(1).max(80),imageTool:z.string().min(1).max(150).optional(),reason:z.string().min(1).max(1000).optional()},modelOnly:true,description:'回应连接检测。检查本会话的看图、生图和真实文件回填工具后填写 imageTool，缺少能力时填写 reason。此回报不会试生成图片。',run:async a=>{
      if(!!a.imageTool===!!a.reason)throw Error('请填写已确认的生图工具名称或具体失败原因，两者选一。');
      if(connectionReports.size>=16)connectionReports.delete(connectionReports.keys().next().value);
      connectionReports.set(a.checkId,{expiresAt:Date.now()+60000,result:{agentName:a.agentName,imageTool:a.imageTool,reason:a.reason}});
      if(a.imageTool)await store.mutate(()=>{store.state.channelSetup={provider:'agent',agentHost:/豆包|doubao/i.test(a.agentName)?'doubao':/codex/i.test(a.agentName)?'codex':null,checkedAt:new Date().toISOString()};});
      return {received:true};
    }},
    open_workbench:{schema:{executor:z.enum(['agent','codex']).optional()},render:true,description:'打开人物服装姿势内嵌工作台；恢复本机内容。可显式指定下一批使用 agent（当前宿主原生生图）或 codex（本机 Codex）；不改变已提交批次。',run:a=>a.executor?store.saveDraft({provider:a.executor}):store.refresh()},
    get_state:{schema:{},read:true,description:'读取工作台状态与当前任务结果。',run:snapshot},
    dismiss_onboarding:{schema:{},appOnly:true,description:'记住用户已关闭使用指南，之后通过右上角按钮查看。',run:()=>store.mutate(()=>{store.state.onboardingGuideSeen=true;return store.snapshot();})},
    agent_wait:{schema:{sessionId:z.string().min(1).max(100),agentName:z.string().min(1).max(80),imageTool:z.string().min(1).max(150),timeoutMs:z.number().int().min(100).max(55000).optional(),renew:z.boolean().optional()},modelOnly:true,description:'等待并领取任务，包含独立的能力测试图。测试任务 isCapabilityTest=true，按其 prompt 生图并回填，测试后结束本次接手。idle 可继续等待，重连续接待执行任务。',run:async(a,ctx)=>(await checks.wait(a,ctx?.signal))??agentBridge.wait(a,ctx?.signal)},
    agent_ack_task:{schema:{taskId:z.string().uuid()},modelOnly:true,description:'实际收到任务且具备生图能力后，在调用生图工具前确认收到。工作台此时才显示 Agent 正在生成。',run:a=>checks.owns(a.taskId)?checks.active.bridge.acknowledge(a.taskId):agentBridge.acknowledge(a.taskId)},
    agent_disconnect:{schema:{sessionId:z.string()},modelOnly:true,description:'当前 Agent 结束工作台等待，释放连接状态。',run:a=>checks.active?.bridge?.status().connected?checks.active.bridge.disconnect(a.sessionId):agentBridge.disconnect(a.sessionId)},
    agent_unavailable:{schema:{sessionId:z.string(),reason:z.string().min(1).max(2000)},modelOnly:true,description:'当前会话缺少看图、生图或输出文件工具时，在工作台显示真实原因。',run:async a=>{if(await checks.unavailable(a.reason))return connection();const result=agentBridge.unavailable(a.reason);await store.mutate(()=>{const s=store.state;if(s.batch?.provider==='agent'&&['queued','running'].includes(s.batch.status)&&!s.tasks.some(t=>t.batchId===s.batch.id&&t.status==='running')){s.batch.status='paused';s.batch.resumeOnReconnect=true;s.execution={batchId:s.batch.id,phase:'failed',message:a.reason,updatedAt:new Date().toISOString()};}});return result;}},
    execution_status:{schema:{provider:provider.optional(),agentHost:agentHost.nullable().optional(),inputKey:z.string().max(2048).optional(),customConfig:apiConfig.optional()},appOnly:true,description:'分别检查账号、执行器与生图能力。此检测不生成图片。已连接的渠道会记住选择。',run:async a=>{
      const state=await store.refresh(),selected=a.provider||state.draft.provider||'codex';
      const c=connection();
      const probe=selected==='agent'
        ?{available:c.connected,engine:'agent',account:'host',executor:c.connected,capability:c.imageTool?'declared':'unknown',reason:c.reason,message:c.connected?'执行器已连接。':'回到打开工作台的原聊天，发送「重新连接人物工作台」。'}
        :await runner.probe(selected,a.inputKey,selected==='image-custom'&&a.customConfig?{...a.customConfig,provider:selected,id:'image-custom:default'}:undefined);
      if(a.inputKey!==undefined)return probe;
      const verified=await checks.status(selected,a.agentHost,probe);
      if(probe.available)await store.mutate(()=>{
        const current=store.state;
        current.channelSetup={provider:selected,agentHost:a.agentHost??null,checkedAt:new Date().toISOString()};
        if(current.draft.provider===state.draft.provider&&current.draft.agentHost===state.draft.agentHost){
          current.draft.provider=selected;
          if(selected==='codex')current.draft.agentHost='codex';
          else if(selected==='agent'&&a.agentHost)current.draft.agentHost=a.agentHost;
        }
      });
      return {...probe,...verified};
    }},
    test_generation:{schema:{provider,agentHost:agentHost.nullable().optional(),costConfirmed:z.boolean().optional()},appOnly:true,description:'用户确认后独立生成一张真实测试图。生图 API 必须确认费用，使用当前主角及第一组搭配。测试不替换用户批次。',run:a=>checks.start(a)},
    cancel_generation_test:{schema:{testId:z.string().uuid()},appOnly:true,description:'取消当前本机测试等待。已提交到收费渠道的远端任务可能继续运行。',run:a=>checks.cancel(a.testId)},
    generation_channels:{schema:{},read:true,appOnly:true,description:'读取生图 API 服务、内置模型预设和密钥配置状态，不返回密钥。',run:async()=>({providers:PROVIDERS,apiServices:IMAGE_API_SERVICES,credentials:Object.fromEntries(Object.entries(await credentials.status()).filter(([p])=>isImageApi(p)))})},
    save_provider_keys:{schema:{keys:z.object(Object.fromEntries(IMAGE_API_SERVICES.map(s=>[s.id,z.string().max(2048).optional()])))},appOnly:true,description:'仅在本机保存各生图 API 的 Key；空字符串删除本机保存的密钥。不返回密钥。',run:a=>credentials.save(a.keys)},
    save_image_api_config:{schema:{config:apiConfig},appOnly:true,description:'保存用户在弹窗填写的自定义 API 接口地址、协议与模型 ID，不保存 Key。',run:a=>store.saveImageApiConfig(a.config)},
    start_generation:{schema:{},appOnly:true,description:'按已提交批次锁定的渠道执行。Codex 必须先通过独立生图测试。',run:async()=>{
      if(await checks.busy())throw Error('请先等待或取消测试图。');
      const s=await store.refresh();
      if(s.batch?.provider==='codex'){
        const probe=await runner.probe('codex'),verified=await checks.status('codex',null,probe);
        if(!probe.available||verified.capability!=='confirmed')throw Error(verified.check?.reason||probe.reason||'尚未验证生图能力，请先生成一张测试图。');
      }
      return runner.start();
    }},
    reconnect_with_local_codex:{schema:{batchId:z.string().nullable()},appOnly:true,description:'用户明确选择本机 Codex 后，验证本机登录并接手当前未领取的任务。',run:async a=>{
      const probe=await runner.probe('codex');
      if(!probe.available)throw Error(probe.reason||'本机 Codex 无法连接。');
      const verified=await checks.status('codex',null,probe);
      if(verified.capability!=='confirmed'){
        await store.saveDraft({provider:'codex',agentHost:'codex'});
        return {...probe,...verified,needsTest:true,message:'账号已登录，执行器已连接。请先生成一张测试图，再接续整批。'};
      }
      if(agentBridge.status().connected)throw Error('当前 Agent 已连接，可继续使用。');
      const state=await store.useLocalCodex(a.batchId);
      if(state.batch?.status==='queued')await runner.start(state.batch.id);
      return probe;
    }},
    report_dispatch_error:{schema:{batchId:z.string(),error:z.string().min(1).max(4000)},description:'记录唤起宿主失败或缺少生图/文件回填工具的原因并暂停该批次，保留未执行任务。不打断已领取任务。',run:a=>store.mutate(()=>{
      const {batch,tasks}=store.state;
      if(batch?.id===a.batchId&&['queued','running'].includes(batch.status)&&!tasks.some(t=>t.batchId===a.batchId&&t.status==='running')){
        batch.status='paused';
        if(batch.provider==='agent')batch.resumeOnReconnect=true;
        store.state.execution={batchId:a.batchId,phase:'failed',message:a.error,updatedAt:new Date().toISOString()};
      }
      return store.snapshot();
    })},
    upload_character:{schema:{name:z.string().max(180),base64:z.string().max(17*1024*1024)},appOnly:true,description:'保存用户通过工作台文件选择器上传的主角图。',run:async a=>store.putImage(Buffer.from(a.base64,'base64'),a.name)},
    select_portrait:{schema:{id:z.string().min(1).max(100)},appOnly:true,description:'从人像库下载原图并将它设为唯一主角。',run:async a=>{
      const item=(await catalog.load('portrait')).find(entry=>entry.id===a.id);
      if(!item)throw Error('找不到这张人像，请刷新人像库后重试。');
      return store.selectPortrait(item);
    }},
    read_image:{schema:{id:z.string()},read:true,appOnly:true,description:'读取工作台本地图片供界面显示。',run:async a=>({id:a.id,...await store.image(a.id)})},
    browse_catalog:{schema:{kind:z.enum(['portrait','pose','costume']),q:z.string().optional(),category:z.string().optional(),angle:z.string().optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(60).optional(),refresh:z.boolean().optional()},read:true,description:'浏览人像、服装或姿势图库，可按分类和关键词筛选。',run:a=>catalog.query(a)},
    download_catalog_image:{schema:{kind:z.enum(['portrait','pose','costume']),id:z.string().min(1).max(100)},appOnly:true,read:true,description:'下载指定图库的真实原图，不选择素材，不更换主角，不创建生成任务。',run:a=>downloadCatalogImage(catalog,a,options.catalogDownloadOptions)},
    select_reference:{schema:{item:z.object({id:z.string(),kind:z.enum(['pose','costume']),name:z.string(),category:z.string().optional(),group:z.string().optional(),angle:z.string().optional(),url:z.string().url(),thumb:z.string().url()})},appOnly:true,description:'登记用户从图库选中的参考素材。',run:a=>store.addReference(a.item)},
    save_draft:{schema:{patch:z.object({portraitId:z.string().nullable().optional(),costumeIds:z.array(z.string()).optional(),poseIds:z.array(z.string()).optional(),ratio:z.string().regex(/^\d{1,3}:\d{1,3}$/).optional(),template:z.string().optional(),notes:z.string().optional(),provider:provider.optional(),agentHost:agentHost.nullable().optional(),providerPresetId:z.string().nullable().optional()})},appOnly:true,description:'保存用户的选择、渠道、Agent、模型预设、比例和提示词。',run:a=>store.saveDraft(a.patch)},
    build_queue:{schema:{},appOnly:true,description:'按所选服装乘姿势建立任务草稿，保留历史结果。',run:()=>store.buildQueue()},
    edit_task:{schema:{taskId:z.string(),patch:z.object({remove:z.boolean().optional(),costumeId:z.string().nullable().optional(),poseId:z.string().nullable().optional(),prompt:z.string().optional()})},appOnly:true,description:'在提交之前删除任务或调整组合及单条提示词。',run:a=>store.patchTask(a.taskId,a.patch)},
    control_batch:{schema:{action:z.enum(['start','pause','continue','cancel'])},appOnly:true,description:'提交批次、暂停后续任务、继续或取消批次。',run:async a=>{
      if(['start','continue'].includes(a.action)){
        if(await checks.busy())throw Error('测试图正在执行，完成后再提交整批。');
        const s=await store.refresh();
        if(s.batch?.provider==='codex'){
          const probe=await runner.probe('codex'),verified=await checks.status('codex',null,probe);
          if(!probe.available||verified.capability!=='confirmed')throw Error(verified.check?.reason||probe.reason||'尚未验证生图能力。请先生成一张测试图，成功后再提交整批。');
        }
      }
      return store.batchAction(a.action);
    }},
    claim_next_task:{schema:{},modelOnly:true,description:'领取使用 Codex/宿主生图的下一个已提交任务。Agent 收到后先用 agent_ack_task 确认，再生图。生图 API 任务由本机执行器处理。',run:async()=>{
      await agentBridge.reconcile();
      const s=await store.refresh();
      if(s.batch?.provider==='agent'&&s.batch.agentHost)return {task:null,batch:s.batch,error:'此批次指定了 Agent，请用 agent_wait 或 CLI wait 按宿主名称领取。'};
      if(s.batch?.provider&&!isNativeProvider(s.batch.provider))return {task:null,batch:s.batch,error:'此批次使用生图 API，请在工作台启动自动执行，不使用宿主生图工具。'};
      return store.claimNext(s.batch?.id,s.batch?.provider==='agent'?{receiptMs:agentBridge.receiptMs}:undefined);
    }},
    record_result:{schema:{taskId:z.string(),filePath:z.string().optional(),base64:z.string().optional(),error:z.string().optional()},modelOnly:true,description:'回填已领取的真实图片或失败原因。PNG、JPEG、WebP 最大 12 MB。普通任务出现在成功记录，能力测试显示在渠道检测区。',run:async a=>{if(checks.owns(a.taskId))return checks.result(a.taskId,a);const result=await store.recordResult(a.taskId,a);agentBridge.finish(a.taskId);return store.mutate(()=>{const s=store.state,b=s.batch;if(b&&b.id===result.batch?.id){const message=b.status==='done'?(b.failedCount?'本批次已处理完成，已跳过 '+b.failedCount+' 个失败任务。最近失败原因：'+b.lastError:'本批次已完成，图片已保存在成功记录。'):b.status==='paused'?'任务已暂停。':'当前图片已处理，等待下一项任务。';s.execution={batchId:b.id,phase:b.status,message,updatedAt:new Date().toISOString()};}return store.snapshot();});}},
    retry_task:{schema:{taskId:z.string()},appOnly:true,description:'用户主动重做一张图片，创建独立的重做任务。',run:a=>store.retry(a.taskId)},
    rename_batch:{schema:{batchId:z.string().min(1).max(200),name:z.string().max(80)},appOnly:true,description:'为指定历史批次命名，保留原图和任务。',run:a=>store.renameBatch(a.batchId,a.name)},
    download_batch:{schema:{batchId:z.string().min(1).max(200)},appOnly:true,description:'打包本批当前已成功生成的全部图片，返回本机 ZIP 下载链接。',run:async a=>exporter.download(a.batchId,await downloadBase())}
  };
  const invoke=async(name,args={},context={})=>{
    const t=tools[name];if(!t)throw Error('不存在该工具');const input=z.object(t.schema).parse(args);
    try{const data=await t.run(input,context);return {content:[{type:'text',text:name==='read_image'?'图片已读取':name==='upload_character'?'主角图已保存':JSON.stringify(data)}],structuredContent:name==='read_image'?{id:data.id}:{...data},...(name==='read_image'?{_meta:{image:data}}:{})};}
    catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
  };
  const server=new McpServer({name:'character-studio',version:VERSION});
  for(const [name,t]of Object.entries(tools))server.registerTool(name,{
    title:name==='open_workbench'?'打开 Character Studio':name,
    description:t.description,inputSchema:t.schema,
    annotations:{readOnlyHint:!!t.read,destructiveHint:false,openWorldHint:['browse_catalog','select_portrait','claim_next_task'].includes(name),idempotentHint:!!t.read},
    _meta:{ui:{...(t.render?{resourceUri:UI_URI}:{}),...(t.appOnly?{visibility:['app']}:t.modelOnly?{visibility:['model']}:{} )},...(t.render?{'openai/outputTemplate':UI_URI}:{}),'openai/widgetAccessible':!t.modelOnly}
  },(a,extra)=>invoke(name,a,{signal:extra.signal}));
  server.registerResource('character-studio-ui',UI_URI,{mimeType:'text/html;profile=mcp-app',_meta:resourceMeta},async()=>({contents:[{uri:UI_URI,mimeType:'text/html;profile=mcp-app',text:await readFile(new URL('./workbench.html',import.meta.url),'utf8'),_meta:resourceMeta}]}));
  studio={server,store,catalog,invoke,tools,runner,agentBridge,exporter};
  return studio;
}

export async function serveHttp(studio,port=43127){
  const server=createServer(async(req,res)=>{
    const origin='http://127.0.0.1:'+server.address().port;
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){res.writeHead(403);res.end('Forbidden origin');return;}
    const url=new URL(req.url,origin);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    try{
      if(req.method==='GET'&&url.pathname==='/api/health'){
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:SERVICE,version:VERSION,buildId:BUILD_ID,pid:process.pid,homeId:createHash('sha256').update(studio.store.root).digest('hex'),features:['agent-cli-v1','agent-wait-v1']}));return;
      }
      if(req.method==='GET'&&url.pathname==='/'){
        res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await readFile(new URL('./workbench.html',import.meta.url)));return;
      }
      if(['GET','HEAD'].includes(req.method)&&url.pathname.startsWith('/api/exports/')){
        await studio.exporter.send(url.pathname.slice('/api/exports/'.length),res,req.method==='HEAD');return;
      }
      if(req.method==='POST'&&url.pathname==='/api/tool'){
        if(!req.headers['content-type']?.startsWith('application/json'))throw Error('需要 JSON 请求');
        let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>18*1024*1024)throw Error('请求过大');chunks.push(c);}
        const {name,arguments:args}=JSON.parse(Buffer.concat(chunks));
        const controller=new AbortController();res.once('close',()=>controller.abort());
        const result=await studio.invoke(name,args,{signal:controller.signal});if(res.destroyed)return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      res.writeHead(404);res.end('Not found');
    }catch(e){if(res.headersSent){res.destroy();return;}res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});studio.httpServer=server;return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const studio=await createStudio();
  if(process.argv.includes('--http')){
    const portIndex=process.argv.indexOf('--port');const server=await serveHttp(studio,portIndex<0?43127:Number(process.argv[portIndex+1]));
    const address={service:SERVICE,version:VERSION,buildId:BUILD_ID,pid:process.pid,port:server.address().port,homeId:createHash('sha256').update(studio.store.root).digest('hex')};
    const discovery=path.join(studio.store.root,'service.json'),tmp=discovery+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(address));await rename(tmp,discovery);
    process.send?.(address);console.log('Character Studio: http://127.0.0.1:'+server.address().port);
  }else await studio.server.connect(new StdioServerTransport());
}
