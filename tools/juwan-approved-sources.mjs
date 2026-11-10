import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeApi} from './audit-upstream-sources.mjs';
import {writeStableGzipJson} from './stable-gzip-json.mjs';

export async function loadApprovedSites(repoRoot) {
  try {
    const registry=JSON.parse(await fs.readFile(path.join(repoRoot,'sources/juwan-approved-sources.json'),'utf8'));
    if(!Array.isArray(registry.sites))throw new Error('Approved source registry has no sites array');
    for(const site of registry.sites){if(![0,1].includes(Number(site.type))||!site.key||!site.name)throw new Error('Invalid approved CMS source');normalizeApi(site.api);}
    return registry.sites;
  }catch(e){if(e.code==='ENOENT')return [];throw e;}
}

export function mergeApprovedSites(sites,approved) {
  const keys=new Set(sites.map(x=>x.key)),apis=new Set(sites.flatMap(x=>{try{return [normalizeApi(x.api,true)];}catch{return [];}}));
  const result=[...sites];
  for(const site of approved){const api=normalizeApi(site.api,true);if(keys.has(site.key)||apis.has(api))continue;result.push({...site});keys.add(site.key);apis.add(api);}
  return result;
}

export function sourceAllowsItem(source,item) {
  if(!source?.generalOnly)return true;
  if((source.excludedCategoryIds||[]).map(String).includes(String(item.type_id||item.categoryId||'')))return false;
  return !item.adult && item.kind!=='adult' && !/成人|情色|色情|伦理|倫理|三级|三級|里番|裏番|两性课堂|兩性課堂|写真热舞|寫真熱舞|擦边|擦邊/i.test(String(item.type_name||item.categoryName||''));
}

export async function ensureApprovedIndexes(dataRoot,catalog,approved) {
  const allowed=new Set(approved.map(x=>normalizeApi(x.api)));
  let created=0;
  for(const source of catalog.sources){
    let api;try{api=normalizeApi(source.api);}catch{continue;}
    if(!allowed.has(api)||source.indexPath)continue;
    const items=catalog.items.filter(x=>x.sourceId===source.id);
    if(items.length!==Number(source.itemCount)||!items.length)throw new Error('Approved source seed does not cover its declared index');
    const slug=String(`${source.host||source.key||source.name}-${source.id}`).toLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,80);
    const indexPath=`vod-index/${slug}.json.gz`;
    await fs.mkdir(path.join(dataRoot,'vod-index'),{recursive:true});
    await writeStableGzipJson(path.join(dataRoot,indexPath),{generatedAt:new Date().toISOString(),sourceId:source.id,sourceName:source.name,itemCount:items.length,items});
    source.indexPath=indexPath;source.indexMode='chunked-json-gzip';source.complete=false;created++;
  }
  return created;
}
