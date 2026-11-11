import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createAdapter,createHttp,AdapterError} from './index.mjs';
import {cleanText,directMedia,excludedContent} from './common.mjs';
import {writeStableGzipJson} from '../stable-gzip-json.mjs';
import {probeMedia} from './media.mjs';
import {episodeIdentity} from '../../docs/iphone/signal-priority.mjs';

export function adapterSlug(source){return `adapter-${crypto.createHash('sha256').update(source.key||source.id).digest('hex').slice(0,20)}`;}
export async function mapLimit(items,limit,worker){const result=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await worker(items[i],i);}}));return result;}
function kindOf(value){return /短剧|短劇/.test(value)?'short':/动漫|動漫|动画|動畫|番剧|番劇/.test(value)?'anime':/综艺|綜藝/.test(value)?'variety':/剧|劇|电视剧|電視劇/.test(value)?'series':'movie';}

// The player takes one episode list plus per-episode variants. Keep episode
// numbers stable while exposing matching alternative lines to its failover.
export function selectDirectLine(episodes){
  const groups=new Map();
  for(const ep of episodes){if(!directMedia(ep.url)||ep.platform)continue;const key=ep.from||'direct';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({name:cleanText(ep.name),url:ep.url});}
  const lines=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length),best=lines[0];if(!best)return {name:'',episodes:[]};
  return {name:best[0],episodes:best[1].map((ep,index)=>{
    const variants=[{label:best[0],url:ep.url}],seen=new Set([ep.url]);
    for(const [label,list] of lines.slice(1)){
      if(/预告|預告|花絮|片花/.test(label)&&!/预告|預告|花絮|片花/.test(best[0]))continue;
      const other=list.find(x=>episodeIdentity(x.name)===episodeIdentity(ep.name))||(list.length===1&&best[1].length===1?list[0]:null);
      if(other&&!seen.has(other.url)){variants.push({label,url:other.url});seen.add(other.url);}
    }
    return {...ep,...(variants.length>1?{variants}:{})};
  })};
}

export function catalogItem(source,category,detail,line){
  const raw=detail.raw||{},categoryName=detail.category||category.name,slug=adapterSlug(source);
  return {id:`${source.id}::${detail.id}`,sourceId:source.id,sourceName:source.name,vodId:String(detail.id),title:detail.title,originalName:'',kind:source.categoryKind||kindOf(categoryName),categoryId:String(category.id),categoryName,year:String(detail.year||'').match(/(?:19|20)\d{2}/)?.[0]||'',area:detail.area||'',genre:[categoryName].filter(Boolean),remarks:detail.remarks||'',actor:cleanText(raw.vod_actor||''),director:cleanText(raw.vod_director||''),content:cleanText(raw.vod_content||raw.content||'').slice(0,300),score:Number(raw.vod_score)||0,views:Number(raw.vod_hits)||0,hot:0,updatedAt:detail.updatedAt||'',poster:detail.poster||'',episodes:line.episodes,episodeCount:line.episodes.length,playLine:line.name,playable:true,adult:false,lazyEpisodes:true,detailPage:1,detailPath:`vod-detail/${slug}/page-0001.json.gz`};
}

async function previousItems(source,detailRoot,http,publicDataBase){
  const expected=Number(source.itemCount||0);
  if(!source.indexed||!expected)return [];
  const pattern=source.detailPathPattern;
  const count=Number(source.detailPageCount||0);
  if(!pattern||!count)throw new AdapterError('previous-snapshot-missing','Existing adapter catalog has no detail snapshot; preserving it');
  const pages=await mapLimit(Array.from({length:count},(_,i)=>i+1),3,async page=>{
    const relative=pattern.replace('{page}',String(page).padStart(4,'0'));
    if(!/^vod-detail\/[a-z0-9-]+\/page-\d+\.json\.gz$/.test(relative))throw new AdapterError('invalid-snapshot-path','Invalid previous adapter detail path');
    let bytes;try{bytes=await fs.readFile(path.join(detailRoot,'..',relative));}catch(e){if(e.code!=='ENOENT')throw e;bytes=(await http.request(new URL(relative,publicDataBase).href,{maxResponseBytes:16*1024*1024})).bytes;}
    const payload=JSON.parse(gunzipSync(bytes,{maxOutputLength:64*1024*1024}).toString('utf8'));
    if(payload.sourceId!==source.id||!Array.isArray(payload.items))throw new AdapterError('invalid-snapshot','Previous adapter snapshot identity does not match');
    return payload.items;
  });
  const items=pages.flat();if(items.length<expected)throw new AdapterError('previous-snapshot-incomplete',`Previous adapter snapshot has ${items.length} of ${expected} items; preserving it`);
  return items;
}

export async function indexReviewedAdapter(source,{
  detailRoot,http=createHttp(),adapter=null,publicDataBase='https://raw.githubusercontent.com/SYLONG7708/TV/gh-pages/docs/data/',
  refreshPages=2,backfillPages=4,maxPagesPerCategory=200,detailConcurrency=4,outputPageSize=80,maxDetailsPerSource=120,
  verifyPlayback=true,
  onProgress=()=>{},
}={}){
  const oldItems=await previousItems(source,detailRoot,http,publicDataBase);
  const old=new Map(oldItems.map(x=>[String(x.vodId),x]));
  adapter=adapter||await createAdapter(source,{http});
  const allCategories=await adapter.categories();
  const categories=allCategories.filter(x=>!excludedContent.test(x.name)&&(!['0','all'].includes(String(x.id))||allCategories.length===1));
  if(!categories.length)throw new AdapterError('no-categories','Adapter returned no general categories');
  const cursors={...(source.adapterState?.cursors||{})},completed=new Set(source.adapterState?.completedCategories||[]);
  const rows=new Map(),categoryChecks=[],pageFailures=[];
  for(const pending of source.adapterState?.pendingDetails||[])if(pending?.id&&pending.category?.id)rows.set(pending.id,{item:{id:pending.id,title:pending.title,poster:pending.poster||''},category:pending.category,page:pending.page||1});
  for(const category of categories){
    const cursor=Math.max(refreshPages+1,Number(cursors[category.id]||1));
    const pages=new Set(Array.from({length:refreshPages},(_,i)=>i+1));
    if(!completed.has(String(category.id)))for(let p=cursor;p<Math.min(cursor+backfillPages,maxPagesPerCategory+1);p++)pages.add(p);
    let lastSignature='';
    for(const page of [...pages].sort((a,b)=>a-b)){
      try{
        const result=await adapter.list(category.id,page);const signature=result.items.map(x=>x.id).join('\0');
        categoryChecks.push({id:category.id,page,count:result.items.length});
        if(result.items.length&&signature===lastSignature){pageFailures.push({category:category.id,page,code:'repeated-page'});break;}
        lastSignature=signature;
        for(const item of result.items)if(!rows.has(item.id))rows.set(item.id,{item,category,page});
        if(!result.items.length||result.pagecount&&page>=result.pagecount){completed.add(String(category.id));break;}
        if(page>=cursor)cursors[category.id]=page+1;
      }catch(e){pageFailures.push({category:category.id,page,code:e.code||'list-error'});break;}
    }
  }
  if(!rows.size&&!old.size)throw new AdapterError('empty-list','Adapter category pages returned no usable titles');
  const failures=[],freshIds=[];let updated=0;
  const pendingIds=new Set((source.adapterState?.pendingDetails||[]).map(x=>x.id));
  const queued=[...rows.values()],newRows=queued.filter(x=>!old.has(String(x.item.id))&&!pendingIds.has(x.item.id));
  const retries=queued.filter(x=>pendingIds.has(x.item.id)).slice(0,Math.max(1,Math.floor(maxDetailsPerSource/6)));
  const refresh=queued.filter(x=>old.has(String(x.item.id))&&!pendingIds.has(x.item.id));
  const refreshOffset=refresh.length?Number(source.adapterState?.refreshOffset||0)%refresh.length:0;
  const rotatingRefresh=[...refresh.slice(refreshOffset),...refresh.slice(0,refreshOffset)];
  const refreshBudget=Math.max(1,Math.floor(maxDetailsPerSource/3));
  const preferred=[...rotatingRefresh.slice(0,refreshBudget),...newRows.slice(0,Math.ceil(maxDetailsPerSource/2)),...retries,...newRows,...rotatingRefresh];
  const uniqueTargets=new Map(preferred.map(x=>[x.item.id,x]));
  const targets=[...uniqueTargets.values()].slice(0,maxDetailsPerSource),targetIds=new Set(targets.map(x=>x.item.id));
  const deferred=queued.filter(x=>!targetIds.has(x.item.id)&&(!old.has(String(x.item.id))||pendingIds.has(x.item.id))).map(x=>({id:x.item.id,title:x.item.title,poster:x.item.poster||'',category:x.category,page:x.page,code:'deferred'}));
  await mapLimit(targets,detailConcurrency,async({item,category,page})=>{
    try{
      const detail=await adapter.detail(item.id);if(excludedContent.test([detail.title,detail.category,category.name].join(' ')))return;
      detail.title=item.title||detail.title;detail.poster=item.poster||detail.poster;
      let line=selectDirectLine(detail.episodes);
      // Resolve the source's own public transport IDs only when no direct line
      // exists. Keep all episodes in that line together; never publish a half line.
      if(!line.episodes.length){
        const first=detail.episodes.find(x=>!x.platform);const group=first?detail.episodes.filter(x=>x.from===first.from&&!x.platform):[];
        if(!group.length)throw new AdapterError('no-episodes','Detail has no usable episode line');
        const resolved=await mapLimit(group,2,ep=>adapter.resolve(ep));line=selectDirectLine(resolved);
        if(line.episodes.length!==group.length)throw new AdapterError('incomplete-play-line','Player resolver did not resolve the complete episode line');
      }
      if(!line.episodes.length)throw new AdapterError('no-direct-media','No direct media in episode line');
      old.set(String(detail.id),catalogItem(source,category,detail,line));freshIds.push(String(detail.id));updated++;
    }catch(e){failures.push({id:item.id,title:item.title,poster:item.poster||'',category:{id:category.id,name:category.name},page,code:e.code||'detail-error'});}
    if((updated+failures.length)%100===0)onProgress({source:source.name,updated,failed:failures.length});
  });
  const pending=[...failures,...deferred],pendingDetails=pending.slice(0,512);
  for(const failure of pending.slice(512)){const id=failure.category.id;cursors[id]=Math.min(Number(cursors[id]||failure.page),failure.page);completed.delete(String(id));}
  const items=[...old.values()];if(!items.length)throw new AdapterError('empty-snapshot','Adapter produced no usable detail records');
  const mediaChecks=[];
  if(verifyPlayback){
    const candidates=freshIds.length?freshIds.map(id=>old.get(id)):items;
    for(const item of candidates.slice(0,4)){
      const episode=item.episodes[0];try{mediaChecks.push({id:item.vodId,...await probeMedia(episode,http)});break;}catch(e){mediaChecks.push({id:item.vodId,status:'failed',code:e.code||'media-error'});}
    }
    if(!mediaChecks.some(x=>x.status==='ok'))throw new AdapterError('playback-check-failed','No sampled adapter title passed manifest and media-segment verification; preserving the previous snapshot');
  }
  const slug=adapterSlug(source),pageCount=Math.ceil(items.length/outputPageSize);
  const complete=categories.every(c=>completed.has(String(c.id)))&&!pending.length&&!pageFailures.length;
  const checks=[{label:'reviewed-source-adapter',ok:true,kind:adapter.kind,updated,retained:items.length-updated,failedDetails:failures.length,deferredDetails:deferred.length,pageFailures,categoryPages:categoryChecks,scope:'metadata-and-direct-episodes',mediaVerifiedPerItem:false},{label:'adapter-media-sample',ok:mediaChecks.some(x=>x.status==='ok'),samples:mediaChecks}];
  const sourceDir=path.join(detailRoot,slug);await fs.mkdir(sourceDir,{recursive:true});
  for(let page=1;page<=pageCount;page++){
    const pageItems=items.slice((page-1)*outputPageSize,page*outputPageSize).map(item=>({...item,detailPage:page,detailPath:`vod-detail/${slug}/page-${String(page).padStart(4,'0')}.json.gz`}));
    await writeStableGzipJson(path.join(sourceDir,`page-${String(page).padStart(4,'0')}.json.gz`),{generatedAt:new Date().toISOString(),sourceId:source.id,sourceName:source.name,page,pagecount:pageCount,total:items.length,complete,checks,items:pageItems});
  }
  return {source:{...source,spiderEngine:`reviewed-${adapter.kind}-v1`,spiderIndexable:true,indexed:true,itemCount:items.length,playableCount:items.length,sourceTotalCount:items.length,detailMode:'spider-json-gzip',detailPathPattern:`vod-detail/${slug}/page-{page}.json.gz`,detailPageCount:pageCount,detailExpectedPages:pageCount,complete,adapterState:{cursors,completedCategories:[...completed],pendingDetails,refreshOffset:refresh.length?(refreshOffset+Math.min(refreshBudget,refresh.length))%refresh.length:0,lastUpdatedAt:new Date().toISOString(),backfillComplete:complete},checks,error:''},items};
}
