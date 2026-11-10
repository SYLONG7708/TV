import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {loadApprovedSites,ensureApprovedIndexes} from './juwan-approved-sources.mjs';
import {normalizeApi} from './audit-upstream-sources.mjs';

const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i].replace(/^--/,''),process.argv[i+1]);
const root=path.resolve(args.get('repoRoot')||path.join(import.meta.dirname,'..'));
const catalogPath=path.resolve(args.get('catalog')||path.join(root,'docs/data/iphone-vod-catalog.json'));
const original=JSON.parse(await fs.readFile(catalogPath,'utf8'));
const approved=await loadApprovedSites(root),apis=new Set(approved.map(x=>normalizeApi(x.api)));
const apiKey=value=>{try{return normalizeApi(value);}catch{return '';}};
const existingApis=new Set(original.sources.map(x=>apiKey(x.api)));
if(approved.every(x=>existingApis.has(normalizeApi(x.api)))){
  const indexes=await ensureApprovedIndexes(path.dirname(catalogPath),original,approved);
  if(indexes)await fs.writeFile(catalogPath,JSON.stringify(original)+'\n');
  console.log(JSON.stringify({sourcesAlreadyPresent:true,indexesCreated:indexes}));process.exit(0);
}
let seed;
if(args.has('seedInput'))seed=JSON.parse(await fs.readFile(args.get('seedInput'),'utf8'));
else{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'juwan-vod-seed-'));
  execFileSync(process.execPath,[path.join(root,'tools/build-iphone-vod-catalog.mjs'),'--tvRoot',root,'--currentVodInput',path.join(root,'sources/TVBOX'),'--output',path.join(temp,'catalog.json'),'--reportOutput',path.join(temp,'report.json'),'--sourceMatch','聚玩','--maxItemsPerSource','200','--maxCategoriesPerSource','5','--maxPagesPerQuery','3','--maxPagesPerSource','15','--includeAdult','false','--timeoutMs','15000'],{windowsHide:true,stdio:'inherit'});
  seed=JSON.parse(await fs.readFile(path.join(temp,'catalog.json'),'utf8'));
}
const added=seed.sources.filter(x=>apis.has(apiKey(x.api))&&!existingApis.has(apiKey(x.api)));
if(added.length!==approved.filter(x=>!existingApis.has(normalizeApi(x.api))).length||added.some(x=>!x.indexed||x.playableCount<10))throw new Error('New source seeding failed; existing catalog preserved');
const ids=new Set(added.map(x=>x.id));const items=seed.items.filter(x=>ids.has(x.sourceId));
const sources=[...original.sources,...added];
const totals={...original.totals,sources:sources.length,indexedSources:sources.filter(x=>x.indexed).length,items:sources.reduce((n,x)=>n+Number(x.itemCount||0),0),playableItems:sources.reduce((n,x)=>n+Number(x.playableCount||0),0)};
const kinds={movie:'movies',series:'series',anime:'anime',short:'short',variety:'variety',adult:'adult',other:'other'};
for(const item of items){const k=kinds[item.kind]||'other';totals[k]=Number(totals[k]||0)+1;}
const next={...original,generatedAt:new Date().toISOString(),sources,totals,items:[...(original.items||[]),...items]};
await ensureApprovedIndexes(path.dirname(catalogPath),next,approved);
await fs.writeFile(catalogPath,JSON.stringify(next)+'\n');
const reportPath=path.join(path.dirname(catalogPath),'iphone-vod-catalog-report.json');
const priorReport=JSON.parse(await fs.readFile(reportPath,'utf8'));
await fs.writeFile(reportPath,JSON.stringify({...priorReport,generatedAt:next.generatedAt,totals,approvedSourceSeed:{added:added.map(x=>({id:x.id,name:x.name,itemCount:x.itemCount,playableCount:x.playableCount})),note:'Initial searchable sample; the existing daily updater appends detail pages and refreshes latest content.'}})+'\n');
console.log(JSON.stringify({added:added.map(x=>({name:x.name,items:x.itemCount,playable:x.playableCount})),totals}));
