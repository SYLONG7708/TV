import fs from 'node:fs/promises';
import path from 'node:path';

const kinds=new Set(['appget','appys','xbpq','xyq','drpy-data']);
export async function loadAdapterSites(repoRoot){
  let registry;try{registry=JSON.parse(await fs.readFile(path.join(repoRoot,'sources/juwan-adapter-sources.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
  if(!Array.isArray(registry.sites))throw new Error('Adapter registry has no sites array');
  const seen=new Set();
  for(const site of registry.sites){
    if(Number(site.type)!==3||!site.key||!site.name||!kinds.has(site.adapterKind)||seen.has(site.key))throw new Error('Invalid or duplicate reviewed adapter source');
    if(!site.configRef&&!site.ext&&!site.rule)throw new Error('Adapter source has no configuration');
    if(site.configRef&&(!/^https?:\/\//i.test(site.configRef.url)||!site.configRef.key))throw new Error('Invalid adapter configuration reference');
    seen.add(site.key);
  }
  return registry.sites;
}
