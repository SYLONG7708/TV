import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadAdapterSites} from './juwan-adapter-sources.mjs';
import {indexReviewedAdapter} from './source-adapters/catalog.mjs';
import {createHttp} from './source-adapters/index.mjs';
import {writeStableGzipJson} from './stable-gzip-json.mjs';

export async function seedAdapters({repoRoot,catalog,detailRoot,indexRoot,refreshPages=1,backfillPages=0,sourceMatch='',onProgress=console.log}){
  const sites=await loadAdapterSites(repoRoot),results=[];
  for(const site of sites){
    if(sourceMatch&&!`${site.key} ${site.name}`.includes(sourceMatch))continue;
    const previous=catalog.sources.find(x=>x.key===site.key);
    const id=previous?.id||`juwan-adapter-${crypto.createHash('sha256').update(site.key).digest('hex').slice(0,20)}`;
    const source={...site,...previous,...site,id,origin:'聚玩適配來源',host:site.configRef?new URL(site.configRef.url).host:new URL(site.ext).host,indexable:false,adult:false};
    try{
      const result=await indexReviewedAdapter(source,{detailRoot,http:createHttp({timeoutMs:12000}),refreshPages,backfillPages,onProgress:value=>onProgress(JSON.stringify(value))});
      const slug=result.source.detailPathPattern.match(/^vod-detail\/([^/]+)/)[1];const indexPath=`vod-index/${slug}.json.gz`;
      // Compact rows retain their detail pointer, which is read on selection.
      const items=result.items.map((item,index)=>{const {episodes,...row}=item;const page=Math.floor(index/80)+1;return {...row,detailPage:page,detailPath:`vod-detail/${slug}/page-${String(page).padStart(4,'0')}.json.gz`};});
      await writeStableGzipJson(path.join(indexRoot,`${slug}.json.gz`),{generatedAt:new Date().toISOString(),sourceId:id,sourceName:site.name,itemCount:items.length,items});
      result.source.indexPath=indexPath;result.source.indexMode='chunked-json-gzip';
      catalog.sources=catalog.sources.filter(x=>x.id!==id);catalog.sources.push(result.source);results.push({name:site.name,status:'indexed',items:items.length,source:result.source});
      onProgress(JSON.stringify({source:site.name,status:'indexed',items:items.length}));
    }catch(e){results.push({name:site.name,status:'failed',code:e.code||'adapter-error',error:e.message});onProgress(JSON.stringify(results.at(-1)));}
  }
  catalog.generatedAt=new Date().toISOString();catalog.totals={...catalog.totals,sources:catalog.sources.length,indexedSources:catalog.sources.filter(x=>x.indexed).length,items:catalog.sources.reduce((n,x)=>n+Number(x.itemCount||0),0),playableItems:catalog.sources.reduce((n,x)=>n+Number(x.playableCount||0),0)};
  return {catalog,results};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i].replace(/^--/,''),process.argv[i+1]);
  const repoRoot=path.resolve(args.get('repoRoot')||'.'),dataRoot=path.join(repoRoot,'docs/data'),output=path.resolve(args.get('catalog')||path.join(dataRoot,'iphone-vod-catalog.json'));
  const catalog=JSON.parse(await fs.readFile(output,'utf8'));
  const result=await seedAdapters({repoRoot,catalog,detailRoot:args.get('detailRoot')||path.join(dataRoot,'vod-detail'),indexRoot:args.get('indexRoot')||path.join(dataRoot,'vod-index'),refreshPages:Number(args.get('refreshPages')||1),backfillPages:Number(args.get('backfillPages')||0),sourceMatch:args.get('sourceMatch')||''});
  await fs.writeFile(output,JSON.stringify(result.catalog,null,2)+'\n');
  await fs.writeFile(path.join(dataRoot,'juwan-adapter-update-report.json'),JSON.stringify({generatedAt:new Date().toISOString(),results:result.results},null,2)+'\n');
  if(result.results.some(x=>x.status==='failed'))process.exitCode=1;
}
