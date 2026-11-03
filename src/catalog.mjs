import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
export const SOURCES={pose:'https://ai-pose-depth-gallery.pages.dev/',costume:'https://ai-costume-gallery.pages.dev/',portrait:'https://ai-portrait-gallery.pages.dev/'};
const categories={'立ち':'站姿','座り':'坐姿','膝立ち':'跪姿','寝そべり':'躺卧','しゃがみ':'蹲姿','前かがみ':'前倾','横座り・女の子座り':'侧坐','のけぞり・反り':'后仰','ひねり':'转身','春':'春季','夏':'夏季','秋':'秋季','冬':'冬季','パーティ':'礼服','水着':'泳装','ランジェリー':'内衣睡衣','セクシー':'造型'};
const hairNames={'ショート':'短发','ミディアム':'中发','セミロング':'中长发','ロング':'长发'};
export function portraitUrl(relative,folder){
  const url=new URL(relative,SOURCES.portrait);
  if(url.origin!==new URL(SOURCES.portrait).origin||!url.pathname.startsWith('/img/'+folder+'/')){
    throw Error('人像图片来源无效');
  }
  return url.href;
}
function parsePortraitCatalog(script){
  const match=script.match(/^\s*window\.GALLERY_IMAGES\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if(!match)throw Error('人像库数据格式发生变化');
  const records=JSON.parse(match[1]);
  if(!records.length)throw Error('人像库索引为空');
  return records.map(({id,section,hair,style,full,thumb})=>{
    if(!id||!full||!thumb)throw Error('人像库条目缺少字段');
    const category=section==='styling'?'人物造型':'正面人像';
    const group=hairNames[hair]||hair||'';
    return {id,kind:'portrait',name:style||group||category,category,group,angle:'',url:portraitUrl(full,'full'),thumb:portraitUrl(thumb,'thumb')};
  });
}
export function parseCatalog(html,kind){
  if(kind==='portrait')return parsePortraitCatalog(html);
  const match=html.match(/const\s+D\s*=\s*(\[[\s\S]*?\]);/);if(!match)throw Error('图库数据格式发生变化');
  const records=JSON.parse(match[1]);if(!Array.isArray(records)||!records.length)throw Error('图库索引为空');
  return records.map(d=>{
    const category=d['分類']||d['カテゴリ']||'',name=d['ポーズ名']||d['キーワード']||d.id;
    const original=d['画像']||d['原寸'];
    if(!d.id||!original||!d['サムネ'])throw Error('图库条目缺少字段');
    const url=new URL(original,SOURCES[kind]),thumb=new URL(d['サムネ'],SOURCES[kind]);
    if(url.origin!==new URL(SOURCES[kind]).origin||thumb.origin!==url.origin)throw Error('图库图片来源越界');
    const angle=({'正面':'正面','上から':'俯视','下から':'仰视','横':'侧面','斜め':'斜侧'})[d['アングル']]||'';
    return {id:d.id,kind,name,category:categories[category]||category,group:d['系統']||category,angle,url:url.href,thumb:thumb.href};
  });
}
export class Catalog{
  constructor(root){this.root=path.join(root,'catalog');this.inflight=new Map();}
  async load(kind,refresh=false){
    if(!SOURCES[kind])throw Error('未知图库');
    const file=path.join(this.root,kind+'.json');
    if(!refresh){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(this.inflight.has(kind))return this.inflight.get(kind);
    const job=(async()=>{
      const index=kind==='portrait'?new URL('data/images.js',SOURCES[kind]):SOURCES[kind];
      const r=await fetch(index,{headers:{'User-Agent':'Mozilla/5.0 CharacterStudio/0.1'},signal:AbortSignal.timeout(25000)});
      if(!r.ok)throw Error('图库暂时无法访问：'+r.status);
      const data=parseCatalog(await r.text(),kind);await mkdir(this.root,{recursive:true});await writeFile(file,JSON.stringify(data));return data;
    })().finally(()=>this.inflight.delete(kind));
    this.inflight.set(kind,job);return job;
  }
  async query({kind,q='',category='',angle='',offset=0,limit=18,refresh=false}){
    const all=await this.load(kind,refresh),term=q.toLowerCase();
    const categories=[...new Set(all.map(d=>d.category))];
    const filtered=all.filter(d=>(!category||d.category===category)&&(!angle||d.angle===angle)&&(!term||[d.name,d.id,d.category,d.group].join(' ').toLowerCase().includes(term)));
    return {items:filtered.slice(offset,offset+Math.min(limit,60)),total:filtered.length,totalInLibrary:all.length,categories,source:SOURCES[kind]};
  }
}
