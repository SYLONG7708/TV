import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseJsonc, normalizeApi, fetchBoundedText, probeCms} from './audit-upstream-sources.mjs';

const BASE = 'https://www.juwanhezi.com';
const EXCLUDED = /18\+|🔞|成人|情色|色情|伦理|倫理|麻豆|无码|無碼|有码|有碼|自慰|口交|性交|强奸|強姦|乱伦|亂倫|幼女|萝莉|蘿莉|偷拍|偷窥|偷窺|探花|淫|兽交|獸交|福利姬|嫩模|性爱|性愛|三级|三級|里番|裏番|JAV|porn|hentai|avzy|souav|apiyutu|jkun|xiangjiao|naixxzy|apidanaizi/i;
const GENERAL_CATEGORY = /电影|電影|剧|劇|综艺|綜藝|动漫|動漫|动画|動畫|卡通|少儿|少兒|纪录|紀錄|动作|動作|喜剧|喜劇|科幻|悬疑|懸疑|言情|穿越|古装|古裝|都市|恋爱|戀愛/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const decodeHtml = value => String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(?:x([a-f0-9]+)|(\d+));/gi,(_,h,d)=>String.fromCodePoint(parseInt(h||d,h?16:10)));
const attributes = text => Object.fromEntries([...text.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m=>[m[1].toLowerCase(),decodeHtml(m[3])]));

export function publicHttp(value, base) {
  const u = new URL(value,base);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('Not a public HTTP URL');
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if (/^(localhost$|0\.0\.0\.0$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][a-f0-9]{2}:|fe80:)/.test(h) || /\.(local|localhost|internal)$/.test(h)) throw new Error('Private address excluded');
  u.hash='';return u.href;
}

export function parseSourceRows(html, originUrl) {
  const result=[];
  const matches=[...String(html).matchAll(/<input\b([^>]+)>/gi)];
  for(let i=0;i<matches.length;i++){
    const m=matches[i], a=attributes(m[1]);if(!/^https?:\/\//i.test(a.value||''))continue;
    const after=html.slice(m.index+m[0].length,matches[i+1]?.index||html.length).slice(0,2500);
    const name=decodeHtml(after.match(/data-name\s*=\s*(["'])(.*?)\1/s)?.[2]||'');
    const before=html.slice(Math.max(0,m.index-650),m.index);
    const fallback=[...before.matchAll(/<(?:p|span|h\d)[^>]*>([^<>]+)<\//g)].at(-1)?.[1]?.trim();
    try{result.push({name:name||fallback||a.value,url:publicHttp(a.value,originUrl),originUrl,listedStatus:after.match(/data-status=["']([^"']+)/)?.[1]??null});}catch{}
  }
  return result;
}

export async function mapLimit(items, concurrency, work) {
  const result=Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await work(items[i],i);}}));return result;
}

export async function discoverIndex({fetchImpl=fetch,timeoutMs=18000}={}) {
  const pages=[],entries=[];let advertisedCount=0;
  for(const kind of ['one','live']){
    const url=kind==='one'?`${BASE}/jsonlist`:kind==='many'?`${BASE}/jsonlist?type=many`:kind==='live'?`${BASE}/live`:`${BASE}/live?type=${kind}`;
    let first;
    try{first=await fetchBoundedText(url,{fetchImpl,timeoutMs,maxBytes:2500000});}catch(e){pages.push({url,status:'failed',error:e.message});continue;}
    let html=first.text;
    if(kind==='one')advertisedCount=Number(html.match(/本页共\s*(\d+)\s*条线路/)?.[1]||0);
    for(let page=1;page<=30;page++){
      const rows=parseSourceRows(html,url);
      pages.push({url,kind,page,status:'ok',rowCount:rows.length,sha256:hash(html)});
      entries.push(...rows.map(x=>({...x,kind,page})));
      const pager=html.match(/<a\b[^>]*class=["'][^"']*dposts-ajax-load[^"']*["'][^>]*>/i)?.[0];
      const attrs=pager?attributes(pager):{};
      if(page===1 && !pager)break;
      if(!rows.length)break;
      if(page===1){first.pager=attrs;if(!attrs['data-page'])break;}
      const p=first.pager;
      const form=new URLSearchParams(Object.entries(p).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v]));
      form.set('paged',String(page+1));
      const response=await fetchImpl(`${BASE}/ajax/load`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',referer:url},body:form,signal:AbortSignal.timeout(timeoutMs)});
      if(!response.ok){pages.push({url,kind,page:page+1,status:'failed',error:`HTTP ${response.status}`});break;}
      html=await response.text();if(html.length>2500000)throw new Error('Index page exceeds size limit');
      if(!html.trim())break;
      if(page>1 && hash(html)===pages.at(-1).sha256)throw new Error('Index pagination repeated');
    }
  }
  const unique=new Map();for(const row of entries){const key=`${row.kind}:${row.url}`;if(!unique.has(key))unique.set(key,{...row,aliases:[row.name]});else unique.get(key).aliases.push(row.name);}
  const oneRows=entries.filter(x=>x.kind==='one');
  return {advertisedCount,listedCount:oneRows.length,complete:advertisedCount>0&&oneRows.length===advertisedCount,pages,entries:[...unique.values()]};
}

export function decodeConfig(text) {
  const clean=String(text).trim();
  try{return {config:parseJsonc(clean),encoding:'jsonc'};}catch(e){
    const base64=clean.replace(/^[\w]{0,12}\*\*/,'');
    if(base64.length>20&&/^[A-Za-z\d+/=\r\n]+$/.test(base64)){
      const decoded=Buffer.from(base64,'base64').toString('utf8');
      if(decoded.trimStart().startsWith('{'))return {config:parseJsonc(decoded),encoding:'base64-json'};
    }
    throw new Error(/^\s*</.test(clean)?'HTML instead of a configuration':'Encrypted, unsupported, or malformed configuration');
  }
}

export function inspectConfig(config, configUrl) {
  const sites=(Array.isArray(config.sites)?config.sites:[]).map(site=>({name:String(site.name||site.key||''),key:String(site.key||''),type:Number(site.type),api:String(site.api||''),ext:typeof site.ext==='string'?site.ext:null,originConfig:configUrl}));
  const childEntries=[...(Array.isArray(config.urls)?config.urls:[]),...(Array.isArray(config.storeHouse)?config.storeHouse:[])];
  const children=childEntries.map(x=>typeof x==='string'?{url:x}:{name:x.name||x.sourceName,url:x.url||x.sourceUrl}).filter(x=>x.url).flatMap(x=>{try{return [{name:x.name||x.url,url:publicHttp(x.url,configUrl)}];}catch{return [];}});
  const lives=(Array.isArray(config.lives)?config.lives:[]).flatMap(x=>{try{return x.url?[{name:String(x.name||'live'),url:publicHttp(x.url,configUrl),originConfig:configUrl}]:[];}catch{return [];}});
  return {sites,children,lives};
}

export function classifySite(site) {
  if(EXCLUDED.test([site.name,site.key,site.api].join(' ')))return 'excluded-content';
  if(![0,1].includes(site.type))return site.type===3?'requires-spider':'requires-adapter';
  try{const u=new URL(publicHttp(site.api));if(/\.(?:js|py|jar|dex|so|exe|apk)$/i.test(u.pathname))return 'requires-adapter';return 'cms-candidate';}catch{return 'unsupported-address';}
}

function directGithubUrl(url) {
  const m=url.match(/(?:https?:\/\/)?raw\.githubusercontent\.com\/+(.*)$/i);return m?`https://raw.githubusercontent.com/${m[1]}`:null;
}

export async function crawlConfigurations(entries,{fetchImpl=fetch,timeoutMs=18000,maxConfigs=600}={}) {
  const queue=entries.filter(x=>!['live','local','epg'].includes(x.kind)).map(x=>({...x,depth:0}));
  const seen=new Set(),configs=[],allSites=[],lives=[];
  while(queue.length && configs.length<maxConfigs){
    const batch=[];
    while(queue.length&&batch.length<6&&configs.length+batch.length<maxConfigs){const row=queue.shift();if(seen.has(row.url))continue;seen.add(row.url);batch.push(row);}
    const results=await mapLimit(batch,6,async row=>{
      try{
        let response;
        try{response=await fetchBoundedText(publicHttp(row.url),{fetchImpl,timeoutMs,maxBytes:4194304});}catch(e){const raw=directGithubUrl(row.url);if(!raw||raw===row.url)throw e;response=await fetchBoundedText(raw,{fetchImpl,timeoutMs,maxBytes:4194304});}
        const {config,encoding}=decodeConfig(response.text), inspected=inspectConfig(config,response.finalUrl);
        if(!inspected.sites.length&&!inspected.children.length&&!inspected.lives.length)throw new Error('No sites, repository entries, or live lists');
        return {...row,status:'ok',encoding,finalUrl:response.finalUrl,sha256:hash(response.text),...inspected};
      }catch(e){return {...row,status:'failed',error:e.message};}
    });
    for(const row of results){const {sites=[],children=[],lives:foundLives=[],...meta}=row;configs.push({...meta,siteCount:sites.length,childCount:children.length,liveCount:foundLives.length});allSites.push(...sites);lives.push(...foundLives);if(row.depth<3)queue.push(...children.map(x=>({...x,originUrl:row.url,kind:'nested',depth:row.depth+1})));}
  }
  return {configurations:configs,sites:allSites,lives,truncated:queue.length>0};
}

export async function auditJuwan({configuredSites,extraEntries=[],fetchImpl=fetch,timeoutMs=12000,skipProbes=false}={}) {
  const index=await discoverIndex({fetchImpl,timeoutMs});
  if(!index.complete)throw new Error(`Incomplete source list: ${index.listedCount}/${index.advertisedCount}; preserve previous report and sources`);
  const crawled=await crawlConfigurations([...index.entries,...extraEntries],{fetchImpl,timeoutMs});
  if(!crawled.configurations.some(x=>x.status==='ok'))throw new Error('All configurations failed; preserve previous sources');
  const baseline=new Map(configuredSites.filter(x=>classifySite(x)==='cms-candidate').flatMap(x=>{try{return [[normalizeApi(x.api),x]];}catch{return [];}}));
  const logical=new Set([...baseline.keys()].map(x=>normalizeApi(x,true)));
  const cms=new Map(),counts={};
  const adapters=[];
  for(const site of crawled.sites){const kind=classifySite(site);counts[kind]=(counts[kind]||0)+1;if(kind!=='cms-candidate'){adapters.push({...site,classification:kind});continue;}const api=normalizeApi(site.api);if(!cms.has(api))cms.set(api,{name:site.name,api,type:site.type,originConfigs:[],aliases:[],alreadyConfigured:baseline.has(api),sameLogicalEndpoint:logical.has(normalizeApi(api,true))});cms.get(api).originConfigs.push(site.originConfig);cms.get(api).aliases.push(site.name);}
  const probeApis=[...new Set([...cms.keys(),...baseline.keys()])];
  const probes=skipProbes?[]:await mapLimit(probeApis,8,async api=>({api,...await probeCms(api,{fetchImpl,timeoutMs})}));
  const health=new Map(probes.map(x=>[x.api,x]));
  const sources=[...cms.values()].map(row=>{const h=health.get(row.api)||{status:'not-probed'};const matches=h.headFingerprint?probes.filter(p=>p.api!==row.api&&baseline.has(p.api)&&p.headFingerprint===h.headFingerprint).map(p=>({api:p.api,name:baseline.get(p.api).name})):[];return {...row,originConfigs:[...new Set(row.originConfigs)],aliases:[...new Set(row.aliases)],health:h,matchesExisting:matches,disposition:row.alreadyConfigured?'configured':row.sameLogicalEndpoint?'url-variant':matches.length?'probable-mirror':h.status==='ok'?'needs-playback-check':'unavailable'};});
  return {schemaVersion:1,generatedAt:new Date().toISOString(),index,configurations:crawled.configurations,configurationScanTruncated:crawled.truncated,siteClassifications:counts,adapterSites:adapters,liveLists:[...new Map([...crawled.lives,...index.entries.filter(x=>['live','local','epg'].includes(x.kind))].map(x=>[x.url,x])).values()],sources,baselineHealth:probes.filter(x=>baseline.has(x.api)),totals:{configurations:crawled.configurations.length,configurationOk:crawled.configurations.filter(x=>x.status==='ok').length,siteEntries:crawled.sites.length,cmsApis:sources.length,configured:sources.filter(x=>x.alreadyConfigured).length,candidates:sources.filter(x=>!x.alreadyConfigured).length,candidateOk:sources.filter(x=>!x.alreadyConfigured&&x.health.status==='ok').length,needsPlaybackCheck:sources.filter(x=>x.disposition==='needs-playback-check').length}};
}

export function markdownReport(report) {
  const cell=x=>String(x??'').replace(/[|\r\n]/g,' ');
  return ['# 聚玩盒子接口與影視相容性檢查','',`檢查時間：${report.generatedAt}。公開列表 ${report.index.listedCount}/${report.index.advertisedCount} 條，配置 ${report.totals.configurationOk}/${report.totals.configurations} 可讀。`,`配置內共 ${report.totals.siteEntries} 筆站點設定；去重後一般 CMS ${report.totals.cmsApis} 個，已設定 ${report.totals.configured} 個。`,`候選 ${report.totals.candidates} 個，目錄回應成功 ${report.totals.candidateOk} 個；待播放驗證 ${report.totals.needsPlaybackCheck} 個。`,'','目錄回應成功不等於全部影片可播；需要 Spider／JAR／Python／登入的來源列入相容性報告，不執行上游程式。新發現網址不會未經驗證直接加入播放清單。','','|來源|API|分類|目錄狀態|上游最新時間|','|---|---|---|---|---|',...report.sources.map(x=>`|${cell(x.name)}|${cell(x.api)}|${x.disposition}|${x.health.status}|${cell(x.health.latestUpdate)}|`),''].join('\n');
}

async function main(){
  const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i].replace(/^--/,''),process.argv[i+1]);
  const repoRoot=path.resolve(args.get('repoRoot')||path.join(import.meta.dirname,'..'));
  const configuredSites=[];for(const file of ['sources/TVBOX','sources/All on-demand sources']){const data=parseJsonc(await fs.readFile(path.join(repoRoot,file),'utf8'));configuredSites.push(...data.sites||[]);}
  const extraEntries=args.has('extraEntries')?JSON.parse(await fs.readFile(args.get('extraEntries'),'utf8')):[];
  const report=await auditJuwan({configuredSites,extraEntries,timeoutMs:Number(args.get('timeoutMs')||12000),skipProbes:args.get('skipProbes')==='true'});
  const out=path.resolve(args.get('output')||path.join(repoRoot,'reports/juwan-latest.json'));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');await fs.writeFile(out.replace(/\.json$/,'.md'),markdownReport(report));console.log(JSON.stringify({output:out,totals:report.totals,siteClassifications:report.siteClassifications}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
