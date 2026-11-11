import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {parseSourceRows,publicHttp,decodeConfig,inspectConfig,classifySite,discoverIndex} from '../tools/audit-juwan-sources.mjs';
import {sitemapUrls,pageResources,crawlSite} from '../tools/crawl-juwan-site.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('source inputs preserve names and escaped URLs without reading script content',()=>{
  const rows=parseSourceRows('<input value="https://example.com/a?x=1&amp;y=2"><a data-name="來源甲" data-status="0">複製</a><input value="https://example.com/b"><a data-name="來源乙">複製</a>','https://example.com/');
  assert.deepEqual(rows.map(x=>[x.name,x.url]),[['來源甲','https://example.com/a?x=1&y=2'],['來源乙','https://example.com/b']]);
});
test('unsafe schemes, credentials, and private addresses are excluded',()=>{
  for(const url of ['file:///etc/passwd','http://127.0.0.1/','http://10.1.2.3/','http://172.16.0.1/','http://[::1]/','http://[fd12::1]/','http://localhost/','https://user:pass@example.com/'])assert.throws(()=>publicHttp(url));
  assert.equal(publicHttp('https://fdmovies.example/'),'https://fdmovies.example/');
});
test('JSONC and base64 data parse without evaluating executable input',()=>{
  const config={sites:[{name:'電影',type:1,api:'https://example.com/api'}]};
  assert.deepEqual(decodeConfig('// comment\n'+JSON.stringify(config)).config,config);
  assert.deepEqual(decodeConfig('token**'+Buffer.from(JSON.stringify(config)).toString('base64')).config,config);
  assert.throws(()=>decodeConfig('(()=>{throw new Error("executed")})()'));
  assert.throws(()=>decodeConfig('<html>blocked</html>'));
});
test('standard self-contained CBC envelope decodes as data and rejects truncated payloads',()=>{
  const config={sites:[{name:'電影',type:1,api:'https://example.com/api'}]};
  const key='123',iv='1234567890123';
  const cipher=crypto.createCipheriv('aes-128-cbc',Buffer.from(key.padEnd(16,'0')),Buffer.from(iv.padEnd(16,'0')));
  const data=Buffer.concat([cipher.update(JSON.stringify(config)),cipher.final()]);
  const envelope=Buffer.from('$#'+key+'#$').toString('hex')+data.toString('hex')+Buffer.from(iv).toString('hex');
  assert.deepEqual(decodeConfig(envelope).config,config);
  assert.throws(()=>decodeConfig(envelope.slice(0,-30)));
});
test('nested repository addresses resolve while executable adapters stay classified',()=>{
  const data=inspectConfig({urls:[{name:'next',url:'./config.json'}],sites:[{name:'短劇',type:3,api:'csp_Drama'}],lives:[{name:'live',url:'https://example.com/live.m3u'}]},'https://example.com/path/root.json');
  assert.equal(data.children[0].url,'https://example.com/path/config.json');
  assert.equal(classifySite(data.sites[0]),'requires-spider');
  assert.equal(classifySite({name:'一般電影',type:1,api:'https://example.com/api'}),'cms-candidate');
  assert.equal(classifySite({name:'成人',type:1,api:'https://example.com/api'}),'excluded-content');
});
test('discovery follows load-more through the final page and reports incomplete lists',async()=>{
  const row=(n)=>`<input value="https://example.com/${n}.json"><a data-name="${n}"></a>`;
  let posts=0;
  const mock=async(url,opts={})=>{
    if(opts.method==='POST'){posts++;assert.equal(opts.body.get('page'),'source');return new Response(posts===1?row(2):'');}
    return new Response(String(url).includes('/jsonlist')?'本页共 2 条线路'+row(1)+'<a class="dposts-ajax-load" data-page="source" data-type="one" data-action="load" data-paged="2" data-append="list-home"></a>':'');
  };
  const report=await discoverIndex({fetchImpl:mock});assert.equal(report.complete,true);assert.equal(report.listedCount,2);assert.equal(posts,2);
  const incomplete=await discoverIndex({fetchImpl:async()=>new Response('本页共 2 条线路'+row(1))});assert.equal(incomplete.complete,false);
});
test('site scan deduplicates the sitemap and extracts API and repository references',()=>{
  assert.deepEqual(sitemapUrls('<loc>https://www.juwanhezi.com/</loc><loc>https://www.juwanhezi.com/</loc><loc>https://other.example/</loc>'),['https://www.juwanhezi.com/']);
  const result=pageResources('<title>接口 &amp; 工具</title><code>https://example.com/vod.json</code><a href="https://github.com/org/repo">repo</a><a href="/item/1">next</a>','https://www.juwanhezi.com/item/1');
  assert.equal(result.title,'接口 & 工具');assert.deepEqual(result.resourceUrls,['https://example.com/vod.json','https://github.com/org/repo']);
});
test('site batches retain their checkpoint and do not label partial coverage complete',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'juwan-site-test-'));
  const output=path.join(root,'site.json');const urls=Array.from({length:101},(_,i)=>`https://www.juwanhezi.com/item/${i}`);
  const mock=async url=>new Response(String(url).endsWith('sitemap.xml')?urls.map(x=>`<loc>${x}</loc>`).join(''):'<title>測試頁</title>');
  const a=await crawlSite({output,fetchImpl:mock,delayMs:0,maxPages:3});assert.equal(a.succeeded,3);assert.equal(a.complete,false);
  const b=await crawlSite({output,fetchImpl:mock,delayMs:0,maxPages:2});assert.equal(b.succeeded,5);assert.equal(b.complete,false);
});

test('full site scanning stops on source throttling and preserves a resumable checkpoint',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'juwan-throttle-test-')),output=path.join(root,'site.json');
  const sitemap=Array.from({length:101},(_,i)=>`<loc>https://www.juwanhezi.com/item/${i}</loc>`).join('');let pages=0;
  try{
    const fetchImpl=async url=>{if(String(url).endsWith('sitemap.xml'))return new Response(sitemap);pages++;return new Response('busy',{status:429});};
    await assert.rejects(crawlSite({output,fetchImpl,delayMs:0,maxPages:0}),/limited requests/);
    const report=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(report.complete,false);assert.ok(pages<=2);assert.equal(report.failed,pages);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
