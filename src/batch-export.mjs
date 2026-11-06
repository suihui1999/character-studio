import {mkdir,copyFile,rename,realpath,stat} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import yazl from 'yazl';
import {batchLabel,resultFilename,safeFilePart} from './batch-history.mjs';

export class BatchExporter{
  constructor(store){
    this.store=store;this.root=path.join(store.root,'exports');
    this.jobs=new Map();this.downloads=new Map();
  }
  async inside(file){
    const root=await realpath(this.store.root),resolved=await realpath(file);
    const relative=path.relative(root,resolved);
    if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('保存路径超出人物工作台的数据目录。');
    return resolved;
  }
  async prepare(batchId){
    const state=await this.store.refresh();
    const batch=Object.hasOwn(state.batches,batchId)?state.batches[batchId]:null;
    if(!batch)throw Error('找不到这个批次，请刷新后重试。');
    const tasks=state.tasks.filter(t=>t.batchId===batchId&&t.status==='done'&&t.resultId);
    if(!tasks.length)throw Error('本批还没有成功生成的图片。');
    const digest=createHash('sha256').update(JSON.stringify([batch.id,batch.name,tasks.map(t=>[t.id,t.resultId,t.costumeId,t.poseId])])).digest('hex').slice(0,20);
    const jobKey=batchId+':'+digest;
    if(this.jobs.has(jobKey))return this.jobs.get(jobKey);
    const job=this.writeFiles(state,batch,tasks,digest).finally(()=>this.jobs.delete(jobKey));
    this.jobs.set(jobKey,job);return job;
  }
  async writeFiles(state,batch,tasks,digest){
    // IDs are hashed before becoming directories, including legacy batch IDs.
    const batchDir=createHash('sha256').update(batch.id).digest('hex').slice(0,24);
    const parent=path.join(this.root,batchDir),folder=path.join(parent,digest);
    await mkdir(this.root,{recursive:true});await this.inside(this.root);
    await mkdir(parent,{recursive:true});await this.inside(parent);
    const files=tasks.map((task,index)=>({name:resultFilename(batch,task,state.assets,index),asset:state.assets[task.resultId]}));
    const ready=await stat(folder).then(s=>s.isDirectory(),e=>{if(e.code==='ENOENT')return false;throw e;});
    if(!ready){
      const stage=path.join(parent,'.preparing-'+randomUUID());
      await mkdir(stage);await this.inside(stage);
      for(const file of files){
        const source=file.asset?.path;
        try{
          if(!source)throw Error('missing');
          const resolved=await this.inside(source);
          await copyFile(resolved,path.join(stage,file.name));
        }catch(e){
          throw Error('无法导出「'+file.name+'」：原图不存在或无法读取。请在成功记录中查看或重做这张图。',{cause:e});
        }
      }
      try{await rename(stage,folder);}
      catch(e){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(e.code)||!await stat(folder).then(s=>s.isDirectory(),()=>false))throw e;}
    }
    await this.inside(folder);
    const archive=path.join(parent,digest+'.zip');
    return {batchId:batch.id,folder:await this.inside(folder),archive,files:files.map(f=>f.name),
      filename:safeFilePart(batchLabel(batch),'批次',50)+'__'+safeFilePart(batch.id,'batch',8)+'.zip',count:files.length};
  }
  async writeArchive(prepared){
    const key='archive:'+prepared.archive;
    if(this.jobs.has(key))return this.jobs.get(key);
    const job=this.writeZip(prepared).finally(()=>this.jobs.delete(key));this.jobs.set(key,job);return job;
  }
  async writeZip({folder,archive,files}){
    const exists=await stat(archive).then(s=>s.isFile(),e=>{if(e.code==='ENOENT')return false;throw e;});
    if(!exists){
      const temporary=path.join(path.dirname(archive),'.archive-'+randomUUID()+'.zip');
      const zip=new yazl.ZipFile();
      const output=createWriteStream(temporary,{flags:'wx'});
      zip.once('error',e=>zip.outputStream.destroy(e));
      const writing=pipeline(zip.outputStream,output);
      for(const file of files)zip.addFile(path.join(folder,file),file,{compress:false});
      zip.end();await writing;
      try{await rename(temporary,archive);}
      catch(e){if(!['EEXIST','EPERM'].includes(e.code)||!await stat(archive).then(s=>s.isFile(),()=>false))throw e;}
    }
    return this.inside(archive);
  }
  async download(batchId,baseUrl){
    const prepared=await this.prepare(batchId);
    await this.writeArchive(prepared);
    for(const [key,value] of this.downloads)if(value.expiresAt<=Date.now())this.downloads.delete(key);
    if(this.downloads.size>=128)this.downloads.delete(this.downloads.keys().next().value);
    const token=randomUUID();this.downloads.set(token,{...prepared,expiresAt:Date.now()+60*60*1000});
    return {batchId,count:prepared.count,filename:prepared.filename,downloadUrl:baseUrl+'/api/exports/'+token,folder:prepared.folder};
  }
  async send(token,response,head=false){
    const download=this.downloads.get(token);
    if(!download||download.expiresAt<=Date.now()){
      response.writeHead(404);response.end('下载链接已过期，请重新点击下载本批图片。');return;
    }
    const file=await this.inside(download.archive),info=await stat(file);
    response.writeHead(200,{'Content-Type':'application/zip','Content-Length':info.size,
      'Content-Disposition':'attachment; filename="character-studio-batch.zip"; filename*=UTF-8\'\''+encodeURIComponent(download.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())});
    if(head)response.end();else await pipeline(createReadStream(file),response);
  }
}
