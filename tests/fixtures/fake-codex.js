// Protocol-only test fixture. Never used by a deployed plugin or real user data.
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
const mode=process.argv[2]==='app-server'?(process.env.STUDIO_TEST_EXECUTOR_MODE||'success'):(process.argv[2]||'success');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
let turns=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
  let m;try{m=JSON.parse(line)}catch{return}if(m.id===undefined)return;
  const reply=result=>send({jsonrpc:'2.0',id:m.id,result});
  if(m.method==='initialize')return reply({userAgent:'test-fixture'});
  if(m.method==='account/read')return reply({account:mode==='notloggedin'?null:{type:'chatgpt'},requiresOpenaiAuth:true});
  if(m.method==='thread/start')return reply({thread:{id:'fixture-thread-'+randomUUID(),ephemeral:true}});
  if(m.method==='turn/start'){
    const id=randomUUID(),threadId=m.params.threadId,number=++turns;reply({turn:{id,status:'inProgress',items:[]}});
    const capabilityTest=m.params.input?.some(i=>i.type==='text'&&i.text.includes('红色陶瓷杯'));
    // These scenarios model a working image tool whose later subject request fails.
    if(capabilityTest&&['success','first-rejected','rejected','hang-once','crash','delayed-rejected'].includes(mode)){
      setTimeout(()=>{
        send({method:'item/completed',params:{threadId,turnId:id,item:{type:'imageGeneration',id:'fixture-check',status:'completed',result:png}}});
        send({method:'turn/completed',params:{threadId,turn:{id,status:'completed',items:[],error:null}}});
      },20);return;
    }
    if(mode==='hanging')return;
    if(mode==='hang-once'&&!existsSync(process.env.STUDIO_TEST_HANG_FLAG)){writeFileSync(process.env.STUDIO_TEST_HANG_FLAG,'hanging');return;}
    setTimeout(()=>{
      if(mode==='crash')return process.exit(7);
      if(mode==='rejected'||((mode==='first-rejected'||mode==='delayed-rejected')&&number===1))return send({method:'turn/completed',params:{threadId,turn:{id,status:'failed',items:[],error:{message:'moderation_blocked: fixture output rejection'}}}});
      if(mode==='unavailable')send({method:'item/completed',params:{threadId,turnId:id,item:{type:'agentMessage',id:'message',text:'当前没有可用的内置生图工具。'}}});
      else send({method:'item/completed',params:{threadId,turnId:id,item:{type:'imageGeneration',id:'fixture-image',status:'completed',result:png}}});
      send({method:'turn/completed',params:{threadId,turn:{id,status:'completed',items:[],error:null}}});
    },mode.startsWith('delayed')?400:20);return;
  }
  return send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Unsupported fixture method'}});
});
