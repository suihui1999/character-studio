import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import path from 'node:path';
import {Store} from './store.mjs';
import {Catalog} from './catalog.mjs';
import {GenerationRunner} from './codex-executor.mjs';
import {ProviderCredentials} from './provider-credentials.mjs';
import {RunningHubClient} from './runninghub-client.mjs';
import {PROVIDERS,INPUT_SOURCES,isNativeProvider} from './generation-models.mjs';
import {AgentBridge} from './agent-bridge.mjs';
import {VERSION,BUILD_ID,SERVICE} from './version.mjs';
import {createHash} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';

export const UI_URI='ui://character-studio/workbench.html';
const resourceMeta={ui:{prefersBorder:false,csp:{resourceDomains:['https://ai-pose-depth-gallery.pages.dev','https://ai-costume-gallery.pages.dev','data:','blob:'],connectDomains:[]}},'openai/widgetDescription':'人物、服装、姿势组合与批量任务工作台','openai/widgetPrefersBorder':false};
export async function createStudio(root,options={}){
  const store=await new Store(root).init(),catalog=new Catalog(store.root);
  const credentials=new ProviderCredentials(store),runninghub=new RunningHubClient(credentials,options.runninghubOptions);
  const runner=new GenerationRunner(store,{...options,runninghub});
  const agentBridge=new AgentBridge(store,options.agentBridgeOptions);
  const snapshot=async()=>{await agentBridge.reconcile();return {...await store.refresh(),agentConnection:agentBridge.status()};};
  const provider=z.enum(['codex','agent','runninghub-cn','runninghub-global']),rhProvider=z.enum(['runninghub-cn','runninghub-global']);
  const scalar=z.union([z.string().max(12000),z.number(),z.boolean(),z.null()]);
  const preset=z.object({id:z.string().optional(),provider:rhProvider,kind:z.enum(['app','workflow']),remoteId:z.string().max(2000),name:z.string().max(150),nodes:z.array(z.object({nodeId:z.string().max(100),fieldName:z.string().max(150),value:scalar,description:z.string().max(200).optional(),source:z.enum(INPUT_SOURCES.map(([s])=>s)),format:z.enum(['fileName','url']).optional(),options:z.array(z.object({value:scalar,label:z.string().max(500)})).optional()})).max(300)});
  const tools={
    open_workbench:{schema:{executor:z.enum(['agent','codex']).optional()},render:true,description:'打开人物服装姿势内嵌工作台；恢复本机内容。可显式指定下一批使用 agent（当前宿主原生生图）或 codex（本机 Codex）；不改变已提交批次。',run:a=>a.executor?store.saveDraft({provider:a.executor}):store.refresh()},
    get_state:{schema:{},read:true,description:'读取工作台状态与当前任务结果。',run:snapshot},
    agent_wait:{schema:{sessionId:z.string().min(1).max(100),agentName:z.string().min(1).max(80),imageTool:z.string().min(1).max(150),timeoutMs:z.number().int().min(100).max(55000).optional()},modelOnly:true,description:'已确认具备原生生图工具的当前 Agent 等待用户提交，最多 55 秒；返回任务时已领取，必须先看三张图再生成。idle 可继续等待，不能凭连接状态宣称已生成。',run:(a,ctx)=>agentBridge.wait(a,ctx?.signal)},
    agent_disconnect:{schema:{sessionId:z.string()},modelOnly:true,description:'当前 Agent 结束工作台等待，释放连接状态。',run:a=>agentBridge.disconnect(a.sessionId)},
    agent_unavailable:{schema:{sessionId:z.string(),reason:z.string().min(1).max(2000)},modelOnly:true,description:'当前会话缺少看图、生图或输出文件工具时，在工作台显示真实原因。',run:async a=>{const connection=agentBridge.unavailable(a.reason);await store.mutate(()=>{const s=store.state;if(s.batch?.provider==='agent'&&['queued','running'].includes(s.batch.status)&&!s.tasks.some(t=>t.batchId===s.batch.id&&t.status==='running')){s.batch.status='paused';s.execution={batchId:s.batch.id,phase:'failed',message:a.reason,updatedAt:new Date().toISOString()};}});return connection;}},
    execution_status:{schema:{provider:provider.optional(),inputKey:z.string().max(2048).optional()},read:true,appOnly:true,description:'检查所选渠道的登录或个人版 API 连接，不生成图片。可临时测试用户当前输入的 Key，不保存或返回 Key。',run:a=>runner.probe(a.provider,a.inputKey)},
    generation_channels:{schema:{},read:true,appOnly:true,description:'读取生图渠道、个人版模型预设和密钥配置状态，不返回密钥。',run:async()=>({providers:PROVIDERS,inputSources:INPUT_SOURCES,credentials:await credentials.status()})},
    save_provider_keys:{schema:{keys:z.object({'runninghub-cn':z.string().max(2048).optional(),'runninghub-global':z.string().max(2048).optional()})},appOnly:true,description:'仅在本机保存 RunningHub 个人版 API Key；空字符串删除本机保存的该站点密钥。不返回密钥。',run:a=>credentials.save(a.keys)},
    inspect_provider_preset:{schema:{provider:rhProvider,kind:z.enum(['app','workflow']),link:z.string().max(2000),example:z.string().max(150000).optional()},appOnly:true,description:'读取 AI 应用/工作流输入，或解析用户粘贴的调用示例，不执行导入代码、不提交生图。',run:a=>runninghub.inspect(a)},
    save_provider_preset:{schema:{preset},appOnly:true,description:'保存用户确认的个人版应用/工作流模型预设与输入映射。',run:a=>store.saveProviderPreset(a.preset)},
    delete_provider_preset:{schema:{id:z.string()},appOnly:true,description:'删除本机模型预设，不影响已提交任务和历史结果。',run:a=>store.deleteProviderPreset(a.id)},
    start_generation:{schema:{},appOnly:true,description:'按已提交批次锁定的渠道，使用 Codex 内置生图或 RunningHub 个人版应用/工作流执行。失败原因回填任务卡，不自动切换渠道。',run:()=>runner.start()},
    report_dispatch_error:{schema:{batchId:z.string(),error:z.string().min(1).max(4000)},description:'记录唤起宿主失败或缺少生图/文件回填工具的原因并暂停该批次，保留未执行任务。不打断已领取任务。',run:a=>store.mutate(()=>{const s=store.state;if(s.batch?.id===a.batchId&&['queued','running'].includes(s.batch.status)&&!s.tasks.some(t=>t.batchId===a.batchId&&t.status==='running')){s.batch.status='paused';s.execution={batchId:a.batchId,phase:'failed',message:a.error,updatedAt:new Date().toISOString()};}return store.snapshot();})},
    upload_character:{schema:{name:z.string().max(180),base64:z.string().max(17*1024*1024)},appOnly:true,description:'保存用户通过工作台文件选择器上传的主角图。',run:async a=>store.putImage(Buffer.from(a.base64,'base64'),a.name)},
    read_image:{schema:{id:z.string()},read:true,appOnly:true,description:'读取工作台本地图片供界面显示。',run:async a=>({id:a.id,...await store.image(a.id)})},
    browse_catalog:{schema:{kind:z.enum(['pose','costume']),q:z.string().optional(),category:z.string().optional(),angle:z.string().optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(60).optional(),refresh:z.boolean().optional()},read:true,description:'浏览指定的外部姿势或服装图库，可按分类、视角和关键词筛选。',run:a=>catalog.query(a)},
    select_reference:{schema:{item:z.object({id:z.string(),kind:z.enum(['pose','costume']),name:z.string(),category:z.string().optional(),group:z.string().optional(),angle:z.string().optional(),url:z.string().url(),thumb:z.string().url()})},appOnly:true,description:'登记用户从图库选中的参考素材。',run:a=>store.addReference(a.item)},
    save_draft:{schema:{patch:z.object({portraitId:z.string().nullable().optional(),costumeIds:z.array(z.string()).optional(),poseIds:z.array(z.string()).optional(),mode:z.enum(['sample','all']).optional(),ratio:z.enum(['3:4','1:1','4:3','9:16','16:9']).optional(),template:z.string().optional(),notes:z.string().optional(),provider:provider.optional(),providerPresetId:z.string().nullable().optional()})},appOnly:true,description:'保存用户的选择、渠道、模型预设、执行模式和提示词。',run:a=>store.saveDraft(a.patch)},
    build_queue:{schema:{},appOnly:true,description:'按所选服装乘姿势建立任务草稿，保留历史结果。',run:()=>store.buildQueue()},
    edit_task:{schema:{taskId:z.string(),patch:z.object({remove:z.boolean().optional(),costumeId:z.string().optional(),poseId:z.string().optional(),prompt:z.string().optional()})},appOnly:true,description:'在提交之前删除任务或调整组合及单条提示词。',run:a=>store.patchTask(a.taskId,a.patch)},
    control_batch:{schema:{action:z.enum(['start','pause','continue','cancel'])},appOnly:true,description:'提交批次、暂停后续任务、确认样图继续或取消批次。',run:a=>store.batchAction(a.action)},
    claim_next_task:{schema:{},modelOnly:true,description:'领取使用 Codex/宿主生图的下一个已提交任务。RunningHub 任务由本机执行器处理；样图待确认、暂停或取消时不领取。',run:async()=>{const s=await store.refresh();return s.batch?.provider&&!isNativeProvider(s.batch.provider)?{task:null,batch:s.batch,error:'此批次使用 RunningHub，请在工作台启动自动执行，不使用宿主生图工具。'}:store.claimNext(s.batch?.id);}},
    record_result:{schema:{taskId:z.string(),filePath:z.string().optional(),base64:z.string().optional(),error:z.string().optional()},modelOnly:true,description:'回填真实生图工具返回的结果文件或失败原因，不得使用占位图充当生图。结果复制到本地并按任务展示。',run:async a=>{const result=await store.recordResult(a.taskId,a);agentBridge.finish(a.taskId);return store.mutate(()=>{const s=store.state,b=s.batch;if(b?.id===result.batch?.id){const message=b.status==='done'?(b.failedCount?'本批次已处理完成，已跳过 '+b.failedCount+' 个失败任务。最近失败原因：'+b.lastError:'本批次已完成，图片已保存在成功记录。'):b.status==='awaiting-approval'?'样图已完成，确认后继续生成。':b.status==='paused'?'任务已暂停。':'当前图片已处理，等待下一项任务。';s.execution={batchId:b.id,phase:b.status,message,updatedAt:new Date().toISOString()};}return store.snapshot();});}},
    retry_task:{schema:{taskId:z.string()},appOnly:true,description:'用户主动重做一张图片，创建独立的重做任务。',run:a=>store.retry(a.taskId)}
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
    annotations:{readOnlyHint:!!t.read,destructiveHint:false,openWorldHint:name==='browse_catalog'||name==='claim_next_task',idempotentHint:!!t.read},
    _meta:{ui:{...(t.render?{resourceUri:UI_URI}:{}),...(t.appOnly?{visibility:['app']}:t.modelOnly?{visibility:['model']}:{} )},...(t.render?{'openai/outputTemplate':UI_URI}:{}),'openai/widgetAccessible':!t.modelOnly}
  },a=>invoke(name,a));
  server.registerResource('character-studio-ui',UI_URI,{mimeType:'text/html;profile=mcp-app',_meta:resourceMeta},async()=>({contents:[{uri:UI_URI,mimeType:'text/html;profile=mcp-app',text:await readFile(new URL('./workbench.html',import.meta.url),'utf8'),_meta:resourceMeta}]}));
  return {server,store,catalog,invoke,tools,runner,agentBridge};
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
      if(req.method==='POST'&&url.pathname==='/api/tool'){
        if(!req.headers['content-type']?.startsWith('application/json'))throw Error('需要 JSON 请求');
        let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>18*1024*1024)throw Error('请求过大');chunks.push(c);}
        const {name,arguments:args}=JSON.parse(Buffer.concat(chunks));
        const controller=new AbortController();res.once('close',()=>controller.abort());
        const result=await studio.invoke(name,args,{signal:controller.signal});if(res.destroyed)return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      res.writeHead(404);res.end('Not found');
    }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
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
