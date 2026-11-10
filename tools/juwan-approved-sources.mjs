import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeApi} from './audit-upstream-sources.mjs';

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
