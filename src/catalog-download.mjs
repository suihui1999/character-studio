import {SOURCES,portraitUrl} from './catalog.mjs';
import {imageType} from './store.mjs';
import {safeFilePart} from './batch-history.mjs';

export async function downloadCatalogImage(catalog,{kind,id},{fetchImpl=fetch}={}){
  const item=(await catalog.load(kind)).find(item=>item.id===id);
  if(!item)throw Error('找不到这张图库原图，请刷新图库后重试。');
  const url=new URL(kind==='portrait'?portraitUrl(item.url,'full'):item.url);
  if(url.origin!==new URL(SOURCES[kind]).origin||url.username||url.password)throw Error('图片必须来自所选图库。');
  let response;
  try{response=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch(error){throw Error('下载图库原图失败：'+(error.name==='TimeoutError'?'连接超时，请稍后重试。':'无法连接图库，请检查网络后重试。'),{cause:error});}
  if(!response.ok)throw Error('下载图库原图失败（HTTP '+response.status+'），请刷新后重试。');
  const chunks=[];let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024)throw Error('图库原图超过 20 MB，无法下载。');chunks.push(chunk);}}
  catch(error){throw Error(error.message.includes('20 MB')?error.message:'下载图库原图时连接中断，请稍后重试。',{cause:error});}
  const bytes=Buffer.concat(chunks),type=imageType(bytes);
  return {filename:safeFilePart(kind+'_'+item.id,'reference',100)+type.ext,mime:type.mime,base64:bytes.toString('base64')};
}
