import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeApprovedSites,sourceAllowsItem} from '../tools/juwan-approved-sources.mjs';
import {parseVodPayload} from '../tools/vod-payload-parser.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {ensureApprovedIndexes} from '../tools/juwan-approved-sources.mjs';

test('approved sources append without removing or duplicating existing sources',()=>{
  const existing=[{key:'old',api:'http://www.example.com/api.php/provide/vod/'}];
  const approved=[{key:'mirror',api:'https://example.com/api.php/provide/vod/at/json/'},{key:'new',api:'https://new.example/api'}];
  const merged=mergeApprovedSites(existing,approved);
  assert.equal(merged.length,2);assert.equal(merged[0],existing[0]);assert.equal(merged[1].key,'new');assert.equal(mergeApprovedSites(merged,approved).length,2);
});
test('Taopian pagination aliases retain declared count and ordinary CMS is unchanged',()=>{
  const payload={pageindex:2,pagecount:3228,pagesize:30,recordcount:96831,list:[{vod_id:4}]};
  const parsed=parseVodPayload(JSON.stringify(payload));assert.equal(parsed.page,2);assert.equal(parsed.total,96831);assert.equal(parsed.limit,30);assert.equal(parsed.pagecount,3228);
  assert.deepEqual(parseVodPayload('{"list":[]}'),{list:[]});
});
test('reviewed general sources exclude their blocked categories without changing other sources',()=>{
  const source={generalOnly:true,excludedCategoryIds:['55']};
  assert.equal(sourceAllowsItem(source,{type_id:55,type_name:'unknown'}),false);
  assert.equal(sourceAllowsItem(source,{type_name:'伦理片'}),false);
  assert.equal(sourceAllowsItem(source,{type_name:'国产剧'}),true);
  assert.equal(sourceAllowsItem({}, {kind:'adult'}),true);
});
test('approved seeds publish an index with playable rows without rewriting existing sources',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'juwan-index-test-'));
  const original={id:'old',api:'https://old.example/api',indexPath:'vod-index/old.json.gz',itemCount:50000};
  const source={id:'new',api:'https://new.example/api',host:'new.example',name:'新來源',itemCount:1};
  const item={id:'new::1',sourceId:'new',title:'sample',episodes:[{url:'https://cdn.example/a.m3u8'}]};
  const catalog={sources:[original,source],items:[item]};
  assert.equal(await ensureApprovedIndexes(root,catalog,[{api:source.api}]),1);
  const data=JSON.parse(gunzipSync(await fs.readFile(path.join(root,source.indexPath))));
  assert.deepEqual(data.items,[item]);assert.equal(data.sourceId,'new');assert.equal(original.itemCount,50000);assert.equal(source.complete,false);
  assert.equal(await ensureApprovedIndexes(root,catalog,[{api:source.api}]),0);
});
