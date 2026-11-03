// Isolated protocol fixture. Never a deployed provider or a real generated result.
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
export const KEYS={'runninghub-cn':'cn-personal-fixture','runninghub-global':'global-personal-fixture'};
const QWEN_WORKFLOW_IDS={'runninghub-cn':'2117565399293321218','runninghub-global':'2117590622597468162'};
export const NODES=[...['portrait','costume','pose'].map((kind,i)=>({nodeId:String(i+1),fieldName:'image',fieldValue:kind+'.png',description:kind})),{nodeId:'4',fieldName:'prompt',fieldValue:'fixture prompt',description:'任务提示词'},{nodeId:'5',fieldName:'aspect_ratio',fieldValue:'3:4',description:'输出比例',fieldData:JSON.stringify(['1:1','3:4','4:3','9:16','16:9'].map(value=>({name:value,index:value})))},{nodeId:'6',fieldName:'model',fieldValue:'fixture-v1',description:'模型版本',fieldData:JSON.stringify([{name:'fixture-v1',index:'fixture-v1'},{name:'fixture-v2',index:'fixture-v2'}])}];
export async function fakeRunningHub({mode='success',accountDelayMs=0}={}){
  const requests=[],submitted=[],polls=new Map();let address;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,address||'http://localhost'),chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),multipart=req.headers['content-type']?.includes('multipart/form-data');
    let body={};if(bytes.length&&!multipart)try{body=JSON.parse(bytes.toString());}catch{}
    const provider=url.pathname.startsWith('/cn/')?'runninghub-cn':'runninghub-global',key=KEYS[provider],route=url.pathname.replace(/^\/(cn|global)/,'');
    requests.push({provider,path:route,authorization:req.headers.authorization,body,multipart,bytes});
    const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    if(url.pathname==='/result.png'){res.setHeader('Content-Type','image/png');res.end(PNG);return;}
    if(route==='/uc/openapi/accountStatus'&&accountDelayMs)await delay(accountDelayMs);
    if(route==='/uc/openapi/accountStatus'&&req.headers.authorization==='Bearer not-found-fixture')return json({code:806,msg:'APIKEY_USER_NOT_FOUND'});
    if(req.headers.authorization!=='Bearer '+key){res.statusCode=401;return json({code:401,msg:'invalid api key'});}
    if(mode==='leaked-error')return json({code:403,msg:'rejected key '+key});
    if(route==='/uc/openapi/accountStatus')return json(body.apikey===key?{code:0,data:{apiType:'NORMAL',remainCoins:'100'}}:{code:806,msg:'APIKEY_USER_NOT_FOUND'});
    if(route==='/api/webapp/apiCallDemo')return json({code:0,data:{curl:"curl --data-raw '"+JSON.stringify({apiKey:key,webappId:url.searchParams.get('webappId'),nodeInfoList:NODES})+"'"}});
    if(route==='/api/openapi/getJsonApiFormat')return json({code:0,data:{prompt:JSON.stringify(Object.fromEntries(NODES.map(n=>[n.nodeId,{inputs:{[n.fieldName]:n.fieldValue},class_type:'FixtureNode',_meta:{title:n.description}}])))}});
    if(route==='/task/openapi/upload')return json({code:0,data:{fileName:'api/upload-'+requests.filter(r=>r.path===route).length+'.png',fileType:'input'}});
    if(route==='/openapi/v2/media/upload/binary')return json({code:0,data:{fileName:'openapi/reference-'+requests.filter(r=>r.path===route).length+'.png',download_url:address+'/uploaded.png'}});
    if(route==='/openapi/v2/run/workflow/'+QWEN_WORKFLOW_IDS[provider]){
      const taskId='2117565399293321'+String(submitted.length+1).padStart(3,'0');
      const ratio=body.nodeInfoList?.find(n=>n.nodeId==='4'&&n.fieldName==='aspect_ratio');
      if(body.apiKey||body.addMetadata!==true||body.instanceType!=='default'||body.usePersonalQueue!=='false'||
        !body.nodeInfoList?.find(n=>n.nodeId==='10'&&n.fieldName==='prompt'&&n.fieldValue)||
        !/^\d+:\d+ \(.+\)$/.test(ratio?.fieldValue)||
        !['1','2','3'].every(id=>body.nodeInfoList.some(n=>n.nodeId===id&&n.fieldName==='image'&&/^openapi\/reference-\d+\.png$/.test(n.fieldValue)))){
        return json({errorCode:'INVALID_INPUT',errorMessage:'Invalid workflow fixture inputs'});
      }
      submitted.push({taskId,provider,body});
      return json({taskId,status:'QUEUED'});
    }
    if(route==='/openapi/v2/query'){
      const job=submitted.find(j=>j.taskId===body.taskId&&j.provider===provider);
      if(!job)return json({errorCode:'UNKNOWN_TASK',errorMessage:'Invalid fixture task ID'});
      return json({taskId:body.taskId,status:'SUCCESS',results:[{url:address+'/result.png',outputType:'png'}]});
    }
    if(route==='/task/openapi/ai-app/run'||route==='/task/openapi/create'){
      const taskId='remote-'+(submitted.length+1);submitted.push({taskId,provider,body});return json({code:0,data:{taskId,taskStatus:'QUEUED'}});
    }
    if(route==='/task/openapi/status'){
      const count=(polls.get(body.taskId)||0)+1;polls.set(body.taskId,count);
      const status=mode==='hanging'?'RUNNING':mode==='reject-first'&&body.taskId==='remote-1'?'FAILED':count===1?'QUEUED':count===2?'RUNNING':'SUCCESS';
      return json({code:0,data:status});
    }
    if(route==='/task/openapi/outputs'){
      if(mode==='reject-first'&&body.taskId==='remote-1')return json({code:999,msg:'moderation_blocked: isolated fixture rejection'});
      return json({code:0,data:[{fileUrl:address+'/result.png',fileType:'png'}]});
    }
    res.statusCode=404;json({code:404,msg:'Unsupported fixture route'});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));address='http://127.0.0.1:'+server.address().port;
  return {origins:{'runninghub-cn':address+'/cn','runninghub-global':address+'/global'},requests,submitted,close:()=>new Promise(r=>server.close(r))};
}
