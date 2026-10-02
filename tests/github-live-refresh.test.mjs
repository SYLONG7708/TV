import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

test('GitHub 無 Cookie 仍可把過期 YouTube HLS 換為官方嵌入並保留直接直播',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oktv-live-refresh-'));
 try{
  await fs.mkdir(path.join(root,'sources'));
  await fs.writeFile(path.join(root,'sources/live-stable.txt'),'新聞,#genre#\nTest,https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1/id/abcdefghijk.12/playlist/index.m3u8\nDirect,https://example.com/live.m3u8\n');
  await fs.writeFile(path.join(root,'sources/youtube-live-channels.csv'),'Order,Group,Name,Url\n1,新聞,Test,https://www.youtube.com/watch?v=abcdefghijk\n2,新聞,Second,https://www.youtube.com/watch?v=bcdefghijkl\n');
  const run=spawnSync(process.execPath,['tools/build-live-channels-json.mjs','--tvRoot',root],{windowsHide:true,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const channels=JSON.parse(await fs.readFile(path.join(root,'docs/data/live-channels.json'),'utf8'));
  assert.equal(channels.length,3);
  assert.equal(channels.filter(c=>c.embedUrl?.startsWith('https://www.youtube.com/embed/')).length,2);
  assert.ok(channels.some(c=>c.url==='https://example.com/live.m3u8'));
  assert.ok(channels.every(c=>!c.url.includes('/expire/1/')));
  const summary=JSON.parse(await fs.readFile(path.join(root,'docs/data/source-summary.json'),'utf8'));
  assert.ok(Date.now()-Date.parse(summary.live.webCatalogBuiltAt)<60000);
  assert.equal(summary.live.webYouTubeFallbackCount,2);
  assert.equal(summary.live.directStreamCount,1);
  assert.equal(summary.live.lastSuccessfulAt,undefined,'catalog rebuild must not invent successful HLS extraction');
 }finally{if(!root.startsWith(path.resolve(os.tmpdir())+path.sep+'oktv-live-refresh-'))throw Error('Unsafe test path');await fs.rm(root,{recursive:true,force:true});}
});

test('每種直播重建入口皆保留公開直播，去除重複串流並同步統計',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oktv-live-refresh-'));
 try{
  await fs.mkdir(path.join(root,'sources'));
  await fs.mkdir(path.join(root,'docs/iphone'),{recursive:true});
  await fs.writeFile(path.join(root,'sources/live-stable.txt'),'新聞,#genre#\nDirect,https://example.com/live.m3u8\n');
  await fs.writeFile(path.join(root,'docs/iphone/public-sources.json'),JSON.stringify({schemaVersion:1,live:[
   {id:'public-news',name:'Public news',group:'全球官方串流',url:'https://news.example.com/live.m3u8',pageUrl:'https://news.example.com/',kind:'hls',playable:true},
   {id:'public-duplicate',url:'https://example.com/live.m3u8',pageUrl:'https://example.com/'},
   {id:'public-invalid',url:'javascript:alert(1)',pageUrl:'https://example.com/'}
  ]}));
  for(let attempt=0;attempt<2;attempt++){
   const run=spawnSync(process.execPath,['tools/build-live-channels-json.mjs','--tvRoot',root],{windowsHide:true,encoding:'utf8'});
   assert.equal(run.status,0,run.stderr);
   const channels=JSON.parse(await fs.readFile(path.join(root,'docs/data/live-channels.json'),'utf8'));
   assert.equal(channels.length,2);
   assert.equal(channels.filter(c=>c.id==='public-news').length,1);
   const summary=JSON.parse(await fs.readFile(path.join(root,'docs/data/source-summary.json'),'utf8'));
   assert.equal(summary.live.count,2);assert.equal(summary.live.directStreamCount,2);assert.equal(summary.live.playableCount,2);
  }
 }finally{if(!root.startsWith(path.resolve(os.tmpdir())+path.sep+'oktv-live-refresh-'))throw Error('Unsafe test path');await fs.rm(root,{recursive:true,force:true});}
});

test('公開來源檔損壞時拒絕覆蓋上一份直播清單',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oktv-live-refresh-'));
 try{
  await fs.mkdir(path.join(root,'sources'));
  await fs.mkdir(path.join(root,'docs/iphone'),{recursive:true});
  await fs.mkdir(path.join(root,'docs/data'),{recursive:true});
  await fs.writeFile(path.join(root,'sources/live-stable.txt'),'Direct,https://example.com/live.m3u8\n');
  const previous='[{"id":"public-preserved"}]\n';
  const output=path.join(root,'docs/data/live-channels.json');await fs.writeFile(output,previous);
  for(const broken of ['{"schemaVersion":1,','{"schemaVersion":99}']){
   await fs.writeFile(path.join(root,'docs/iphone/public-sources.json'),broken);
   const run=spawnSync(process.execPath,['tools/build-live-channels-json.mjs','--tvRoot',root],{windowsHide:true,encoding:'utf8'});
   assert.notEqual(run.status,0);assert.equal(await fs.readFile(output,'utf8'),previous);
  }
 }finally{if(!root.startsWith(path.resolve(os.tmpdir())+path.sep+'oktv-live-refresh-'))throw Error('Unsafe test path');await fs.rm(root,{recursive:true,force:true});}
});
