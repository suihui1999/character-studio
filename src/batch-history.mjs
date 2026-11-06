// Save aggregate counts before detailed failed tasks are removed from history.
export function updateBatchHistory(state){
  state.batches??={};
  const groups=new Map();
  for(const task of state.tasks){
    if(!task.batchId)continue;
    if(!groups.has(task.batchId))groups.set(task.batchId,[]);
    groups.get(task.batchId).push(task);
  }
  if(state.batch&&!groups.has(state.batch.id))groups.set(state.batch.id,[]);
  for(const [id,tasks] of groups){
    const previous=Object.hasOwn(state.batches,id)?state.batches[id]:null;
    const current=state.batch?.id===id?state.batch:null;
    const dates=tasks.map(t=>t.createdAt||t.startedAt||t.finishedAt).filter(Boolean).sort();
    const failed=tasks.filter(t=>['failed','interrupted'].includes(t.status)).length;
    const failedCount=Math.max(previous?.failedCount||0,current?.failedCount||0,failed);
    const successCount=tasks.filter(t=>t.status==='done').length;
    state.batches[id]={
      id,name:previous?.name||'',createdAt:previous?.createdAt||current?.createdAt||dates[0]||null,
      portraitId:previous?.portraitId||current?.portraitId||tasks[0]?.portraitId||null,
      status:current?.status||previous?.status||'done',successCount,failedCount,
      totalCount:current?.status==='draft'?tasks.length:Math.max(previous?.totalCount||0,tasks.length,successCount+failedCount),
      countsIncomplete:previous?.countsIncomplete??!current,
    };
  }
}

export function batchLabel(batch){
  return batch.name||'批次 '+batch.id.slice(0,8);
}

export function safeFilePart(value,fallback,maxLength=32){
  let text=String(value||fallback).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'_').trim().replace(/[. ]+$/g,'');
  text=Array.from(text).slice(0,maxLength).join('').replace(/[. ]+$/g,'')||fallback;
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text))text='_'+text;
  return text;
}

export function resultFilename(batch,task,assets,index=0){
  const code=(id,kind)=>assets[id]?.sourceId||id?.replace(new RegExp('^'+kind+':'),'')||(kind==='costume'?'原服装':'原姿势');
  const asset=assets[task.resultId];
  const ext={ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[asset?.mime]||asset?.path?.match(/\.(png|jpe?g|webp)$/i)?.[0]||'.png';
  return [safeFilePart(batchLabel(batch),'批次',28),safeFilePart(batch.id,'batch',8),
    '服装_'+safeFilePart(code(task.costumeId,'costume'),'原服装'),
    '姿势_'+safeFilePart(code(task.poseId,'pose'),'原姿势',40),String(index+1).padStart(3,'0')].join('__')+ext;
}
