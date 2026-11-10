import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchBoundedText} from './audit-upstream-sources.mjs';
import {decodeHtml} from './audit-juwan-sources.mjs';

export function sitemapUrls(xml) {
  return [...new Set([...String(xml).matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map(m=>decodeHtml(m[1])).filter(x=>{try{return new URL(x).origin==='https://www.juwanhezi.com';}catch{return false;}}))];
}

export function pageResources(html,url) {
  const title=decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').trim();
  const candidates=[...html.matchAll(/https?:\/\/[^\s<>"'`\\]+|(?:href|value)\s*=\s*["']([^"']+)["']/gi)].map(m=>decodeHtml(m[1]||m[0]).replace(/[),;。]+$/g,''));
  const externalUrls=[...new Set(candidates.filter(x=>{try{return /^https?:\/\//i.test(x)&&!new URL(x).hostname.endsWith('juwanhezi.com');}catch{return false;}}))];
  const resourceUrls=externalUrls.filter(x=>/github|gitlab|jihulab|gitee|gitcode|kstore|\.json(?:[?#]|$)|\.m3u8?(?:[?#]|$)|\.txt(?:[?#]|$)|api\.php|\/provide\/vod|epg|tvbox|\/tv\/?$|\/box\/?$/i.test(x));
  return {url,title,resourceUrls};
}

export async function crawlSite({output,delayMs=2400,timeoutMs=15000,fetchImpl=fetch,maxPages=24}={}) {
  const {text}=await fetchBoundedText('https://www.juwanhezi.com/sitemap.xml',{fetchImpl,timeoutMs,maxBytes:4000000});
  const urls=sitemapUrls(text);if(urls.length<100)throw new Error('Unexpected sitemap size; preserve previous site report');
  const previous=await fs.readFile(output,'utf8').then(JSON.parse).catch(()=>({pages:[]}));
  const rows=new Map((previous.pages||[]).filter(x=>x.status==='ok').map(x=>[x.url,x]));
  let consecutiveNetworkFailures=0,saveCounter=0,processed=0;
  const save=async()=>{const pages=[...rows.values()];const report={generatedAt:new Date().toISOString(),sitemapCount:urls.length,attempted:pages.length,succeeded:pages.filter(x=>x.status==='ok').length,failed:pages.filter(x=>x.status!=='ok').length,complete:urls.every(u=>rows.get(u)?.status==='ok'),pages};await fs.mkdir(path.dirname(output),{recursive:true});const temp=output+'.'+process.pid+'.'+saveCounter+++'.tmp';await fs.writeFile(temp,JSON.stringify(report,null,2)+'\n');await fs.rename(temp,output);return report;};
  const pending=urls.filter(u=>rows.get(u)?.status!=='ok');
  if(!pending.length&&previous.complete){if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'changed=false\n');console.log('Site checkpoint already covers this sitemap.');return previous;}
  const remaining=pending.slice(0,maxPages>0?maxPages:undefined);let cursor=0,lastStart=0;
  // Two workers share one request clock. The origin sees at most one request
  // every delayMs, including when a previous request is slow.
  let turn=Promise.resolve();
  const pace=async()=>{const previousTurn=turn;let release;turn=new Promise(r=>{release=r;});await previousTurn;await new Promise(r=>setTimeout(r,Math.max(0,lastStart+delayMs-Date.now())));lastStart=Date.now();release();};
  await Promise.all(Array.from({length:2},async()=>{while(cursor<remaining.length&&consecutiveNetworkFailures<6){const url=remaining[cursor++];await pace();try{const {text,finalUrl}=await fetchBoundedText(url,{fetchImpl,timeoutMs,maxBytes:2500000});rows.set(url,{...pageResources(text,url),finalUrl,status:'ok'});consecutiveNetworkFailures=0;}catch(e){rows.set(url,{url,status:'failed',error:e.message});if(!/HTTP 4\d\d/.test(e.message))consecutiveNetworkFailures++;}processed++;if(processed%20===0){await save();console.log(JSON.stringify({attempted:rows.size,total:urls.length}));}}}));
  const report=await save();console.log(JSON.stringify({complete:report.complete,attempted:report.attempted,succeeded:report.succeeded,failed:report.failed,sitemapCount:urls.length}));
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'changed=true\n');
  if(cursor<remaining.length||consecutiveNetworkFailures>=6)throw new Error('Origin repeatedly timed out; scan checkpoint preserved for resuming');
  return report;
}

async function main(){const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i].replace(/^--/,''),process.argv[i+1]);await crawlSite({output:path.resolve(args.get('output')||'reports/juwan-site.json'),delayMs:Number(args.get('delayMs')||2400),maxPages:Number(args.get('maxPages')||24),timeoutMs:Number(args.get('timeoutMs')||15000)});}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
