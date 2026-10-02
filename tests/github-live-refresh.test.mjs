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
