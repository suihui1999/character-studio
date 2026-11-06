import {readFile,writeFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {RH_ORIGINS} from './generation-models.mjs';
import {IMAGE_API_SERVICES} from './image-api-presets.mjs';
const knownProviders=[...Object.keys(RH_ORIGINS),...IMAGE_API_SERVICES.map(s=>s.id)];
const envNames={'runninghub-cn':'RUNNINGHUB_CN_API_KEY','runninghub-global':'RUNNINGHUB_GLOBAL_API_KEY','image-openai':'OPENAI_API_KEY','image-gemini':'GEMINI_API_KEY','image-seedream':'ARK_API_KEY','image-custom':'CHARACTER_STUDIO_IMAGE_API_KEY'};
function dpapi(value,decrypt){return new Promise((resolve,reject)=>{
  const script="$ErrorActionPreference='Stop';[Console]::InputEncoding=[System.Text.Encoding]::UTF8;[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;[void][System.Reflection.Assembly]::LoadWithPartialName('System.Security');$v=[Console]::In.ReadToEnd();"+(decrypt?"$bytes=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([System.Text.Encoding]::UTF8.GetString($bytes))":"$bytes=[System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($v),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($bytes))");
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  const timer=setTimeout(()=>{child.kill();reject(Error('本机密钥加密操作超时'));},15000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',s=>out+=s);child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('无法访问 Windows 本机密钥保护'));});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(out.replace(/^\uFEFF/,'')):reject(Error('本机密钥加解密失败，请重新保存 Key'));});child.stdin.on('error',()=>{});child.stdin.end(value);
});}
export class ProviderCredentials{
  constructor(store,{env=process.env}={}){this.store=store;this.env=env;this.file=path.join(store.root,'provider-credentials.json');}
  async load(){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw Error('本机渠道密钥配置读取失败');}}
  async status(){const saved=await this.load();return Object.fromEntries(knownProviders.map(p=>[p,{configured:!!(this.env[envNames[p]]||saved[p]),source:this.env[envNames[p]]?'environment':saved[p]?'local':null}]));}
  async key(provider){if(!knownProviders.includes(provider))throw Error('未知 API 服务');const env=this.env[envNames[provider]];if(env)return env;
    const value=(await this.load())[provider];if(!value){const e=Error('尚未配置本站 API Key，请点击「填写 API Key」。');e.fatal=true;throw e;}
    if(value.scheme==='dpapi')return dpapi(value.value,true);if(value.scheme==='file')return value.value;throw Error('不支持的本机密钥格式');
  }
  async save(keys){const unlock=await this.store.lock();try{const saved=await this.load();for(const [p,key]of Object.entries(keys)){
    if(!knownProviders.includes(p)||typeof key!=='string'||key.length>2048||/[\r\n]/.test(key))throw Error('渠道或 Key 格式无效');
    if(!key.trim()){delete saved[p];continue;}const win=process.platform==='win32';saved[p]={scheme:win?'dpapi':'file',value:win?await dpapi(key.trim(),false):key.trim()};
  }const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(saved),{mode:0o600});await rename(tmp,this.file);}finally{await unlock();}return this.status();}
}
