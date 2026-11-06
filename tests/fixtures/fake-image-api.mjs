import {createServer} from 'node:http';
export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
export const KEYS={'image-openai':'fixture-openai-key','image-gemini':'fixture-gemini-key','image-seedream':'fixture-seedream-key','image-custom':'fixture-custom-key'};
export async function fakeImageApi({mode='success',delayMs=0}={}){
  const requests=[],submitted=[];let base;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/'),provider=parts[1],route='/'+parts.slice(2).join('/');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
    const key=req.headers.authorization?.replace(/^Bearer /,'')||req.headers['x-goog-api-key'];
    requests.push({provider,route,method:req.method,key,raw,contentType:req.headers['content-type']});
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/result.png'){res.writeHead(200,{'Content-Type':'image/png'});res.end(PNG);return;}
    if(key!==KEYS[provider]||mode==='unauthorized'){json({error:{message:'Invalid key '+key}},401);return;}
    if(req.method==='GET'){
      if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
      if(route==='/models')json({data:[{id:'doubao-seedream-4-5-251128'},{id:'doubao-seedream-5-0-260128'},{id:'doubao-seedream-4-0-250828'},{id:'custom-test-model'}]});
      else json({id:decodeURIComponent(parts.at(-1)),name:'models/'+decodeURIComponent(parts.at(-1))});return;
    }
    const body=raw.startsWith('{')?JSON.parse(raw):null;submitted.push({provider,route,body,raw});
    if(mode==='reject-first'&&submitted.length===1){json({error:{message:'fixture moderation rejection'}},400);return;}
    if(mode==='no-image'){json({candidates:[{finishReason:'SAFETY'}]});return;}
    if(mode==='invalid-image'){json({data:[{b64_json:Buffer.from('not an image').toString('base64')}]});return;}
    if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
    if(provider==='image-gemini')json({candidates:[{content:{parts:[{thought:true,inlineData:{data:Buffer.from('thought is not a result').toString('base64')}},{inlineData:{mimeType:'image/png',data:PNG.toString('base64')}}]}}]});
    else if(mode==='url')json({data:[{url:base+'/result.png'}]});
    else json({data:[{b64_json:PNG.toString('base64')}]});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  return {requests,submitted,origins:Object.fromEntries(Object.keys(KEYS).map(p=>[p,base+'/'+p])),close:()=>new Promise(r=>server.close(r))};
}
