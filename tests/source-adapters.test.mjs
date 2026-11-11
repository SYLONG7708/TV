import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createAdapter,createHttp} from '../tools/source-adapters/index.mjs';
import {publicUrl,isPrivateAddress} from '../tools/source-adapters/http.mjs';
import {parseDrpyRule} from '../tools/source-adapters/drpy-data.mjs';
import {resolveWebMedia} from '../tools/source-adapters/html-rules.mjs';
import {decodeAppGetData} from '../tools/source-adapters/app-json.mjs';
import {cssValue,textRange,getPath,template} from '../tools/source-adapters/common.mjs';
import {probeMedia} from '../tools/source-adapters/media.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {indexReviewedAdapter,selectDirectLine} from '../tools/source-adapters/catalog.mjs';
import {sourceIdentityKey} from '../tools/source-identity.mjs';

const lookup=async()=>[{address:'203.0.113.8'}];
const fixture=(fn)=>createHttp({lookup,perHostDelayMs:0,fetchImpl:async(url,options)=>{const result=await fn(new URL(url),options);return result instanceof Response?result:new Response(typeof result==='string'?result:JSON.stringify(result));}});

test('source HTTP checks literal, mapped IPv6, DNS, and redirect private addresses',async()=>{
  for(const value of ['http://127.0.0.1/','http://[::ffff:127.0.0.1]/','file:///etc/passwd','http://u:p@example.com'])assert.throws(()=>publicUrl(value));
  assert.equal(isPrivateAddress('10.1.2.3'),true);assert.equal(isPrivateAddress('::ffff:c0a8:101'),true);assert.equal(isPrivateAddress('8.8.8.8'),false);
  const privateDns=createHttp({lookup:async()=>[{address:'192.168.1.10'}],fetchImpl:async()=>{throw new Error('must not request');}});
  await assert.rejects(privateDns.request('https://catalog.example/'),e=>e.code==='private-dns');
  const redirect=fixture(()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}}));
  await assert.rejects(redirect.request('https://catalog.example/'),e=>e.code==='private-url');
});

test('application API supports categories, actual pagination, search and grouped episodes',async()=>{
  const http=fixture(url=>{
    if(url.pathname.endsWith('/nav'))return {data:[{type_id:1,type_name:'電影'}]};
    if(url.pathname.endsWith('/video'))return {pagecount:3,data:{list:[{vod_id:url.searchParams.get('pg'),vod_name:'測試電影',vod_pic:'/cover.jpg'}]}};
    if(url.pathname.endsWith('/search')){assert.equal(url.searchParams.get('text'),'測試');return {list:[{vod_id:1,vod_name:'測試電影'}]};}
    return {data:{vod_id:1,vod_name:'測試電影',vod_url_with_player:[{code:'hls',url:'第一集$https://cdn.example/one.m3u8#第二集$https://cdn.example/two.m3u8'}]}};
  });
  const adapter=await createAdapter({api:'csp_AppYsV2',ext:'https://catalog.example/api.php/app/'},{http});
  assert.equal((await adapter.categories())[0].name,'電影');assert.equal((await adapter.list('1',2)).items[0].id,'2');assert.equal((await adapter.search('測試')).length,1);
  const detail=await adapter.detail('1');assert.equal(detail.episodes.length,2);assert.equal((await adapter.resolve(detail.episodes[0])).direct,true);
});

test('AppGet uses only declared transport encryption and preserves category/filter data',async()=>{
  const ext={url:'https://catalog.example',dataKey:'1234567890123456',dataIv:'1234567890123456'};
  const encode=value=>{const c=crypto.createCipheriv('aes-128-cbc',Buffer.from(ext.dataKey),Buffer.from(ext.dataIv));return Buffer.concat([c.update(JSON.stringify(value)),c.final()]).toString('base64');};
  assert.deepEqual(decodeAppGetData(encode({ok:true}),ext),{ok:true});
  const http=fixture((url,options)=>{assert.equal(options.method,'POST');assert.equal(options.headers['content-type'],'application/x-www-form-urlencoded');return {code:1,data:encode({type_list:[{type_id:2,type_name:'動漫'}]})};});
  const adapter=await createAdapter({key:'test',api:'csp_AppGet',ext},{http});assert.equal((await adapter.categories())[0].id,'2');
});

test('XBPQ literal selectors preserve link prefixes and support public player pages',async()=>{
  const rule={'主页url':'https://catalog.example/','分类':'電影$1#劇集$2','分类url':'/show/{cateId}/{catePg}','数组':'<a class="video"&&</a>','标题':'title="&&"','图片':'src="&&"','链接':'/detail/+&&"','搜索url':'/search/{wd}/{pg}','播放数组':'<ul class="episodes"&&</ul>','播放列表':'<a&&</a>','播放链接':'href="&&"','播放标题':'>&&<'};
  const http=fixture(url=>url.pathname.startsWith('/detail')?'<h1>測試電影</h1><ul class="episodes"><a href="/play/1">正片</a></ul>':url.pathname.startsWith('/play')?'<script>var player_data={"url":"https://cdn.example/video.m3u8","encrypt":0};</script>':'<a class="video" href="/detail/1" title="測試電影"><img src="/cover.jpg"></a>');
  const a=await createAdapter({api:'csp_XBPQ',ext:rule},{http});assert.equal((await a.categories()).length,2);const item=(await a.list('1',1)).items[0];assert.equal(item.id,'https://catalog.example/detail/1');assert.equal((await a.search('測試')).length,1);
  const detail=await a.detail(item.id);assert.equal(detail.episodes.length,1);const media=await a.resolve(detail.episodes[0]);assert.equal(media.url,'https://cdn.example/video.m3u8');
});

test('XYQ JSONP lists and DOM search/detail rules operate without executing scripts',async()=>{
  const rule={'分类链接':'https://catalog.example/list?typeId={cateId}&page={catePg}&callback=jsonp','分类名称':'兒歌&故事','分类名称替换词':'2&3','分类截取模式':'0','分类Json数据二次截取':'jsonp(&&);','分类列表数组规则':'data.items','分类片单标题':'name','分类片单链接':'video_id','分类片单图片':'image','分类片单链接加前缀':'https://catalog.example/play/','搜索链接':'https://catalog.example/search?key={wd}','搜索截取模式':'1','搜索列表数组规则':'.items','搜索片单标题':'.title&&Text','搜索片单链接':'a&&href','搜索片单图片':'img&&src','播放列表数组规则':'body','选集列表数组规则':'.video','选集标题':"'立即播放'",'选集链接':'mip-search-video&&video-src'};
  const http=fixture(url=>url.pathname==='/list'?'jsonp({"data":{"items":[{"name":"兒歌一","video_id":9,"image":"https://cdn.example/a.jpg"}]}});':url.pathname==='/search'?'<div class="items"><a href="/play/9"><span class="title">兒歌一</span><img src="/pic.jpg"></a></div>':'<h1>兒歌一</h1><div class="video"><mip-search-video video-src="https://cdn.example/a.mp4"></mip-search-video></div>');
  const a=await createAdapter({api:'csp_XYQHiker',ext:rule},{http});const items=(await a.list('2',2)).items;assert.equal(items[0].id,'https://catalog.example/play/9');assert.equal((await a.search('兒歌')).length,1);const d=await a.detail(items[0].id);assert.equal(d.episodes[0].url,'https://cdn.example/a.mp4');
});

test('drpy parsing extracts declarative data and never evaluates JavaScript side effects',()=>{
  const result=parseDrpyRule("globalThis.__sourceExecuted=true; var HOST='https://catalog.example';var rule={host:HOST,class_name:'電影',class_url:'1',一级:'.items;a&&Text;img&&src;.note&&Text;a&&href',二级:()=>process.env};");
  assert.equal(globalThis.__sourceExecuted,undefined);assert.equal(result.host,'https://catalog.example');assert.equal(result['二级'].unsupportedExpression,'ArrowFunctionExpression');
  assert.throws(()=>parseDrpyRule('var rule=buildRemoteConfig();'),e=>e.code==='runtime-required');
});

test('drpy JSON list supports a real keyword and page request',async()=>{
  const rule=parseDrpyRule("var rule={host:'https://catalog.example',class_name:'電影',class_url:'1',url:'/list?tid=fyclass&pg=fypage',searchUrl:'/search?wd=**&pg=fypage',一级:'json:data;title;pic;note;id',搜索:'*'};");
  const http=fixture(url=>{if(url.pathname==='/search')assert.equal(url.searchParams.get('wd'),'測試');else assert.equal(url.searchParams.get('pg'),'2');return {data:[{id:3,title:'測試',pic:'https://cdn.example/a.jpg'}]};});
  const a=await createAdapter({api:'drpy',rule},{http});assert.equal((await a.list('1',2)).items[0].id,'3');assert.equal((await a.search('測試')).length,1);
});

test('HLS verification follows variants, checks a bounded segment, and rejects HTML',async()=>{
  const segment=Buffer.alloc(1000,0);segment[0]=0x47;segment[188]=0x47;
  const http=fixture(url=>url.pathname==='/master.m3u8'?'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=50000\nmedia.m3u8':url.pathname==='/media.m3u8'?'#EXTM3U\n#EXTINF:6,\nsegment.ts':new Response(segment,{headers:{'content-type':'video/mp2t'}}));
  const r=await probeMedia({url:'https://cdn.example/master.m3u8'},http);assert.equal(r.transportSync,true);assert.equal(r.segmentBytes,1000);
  await assert.rejects(probeMedia({url:'https://cdn.example/error.m3u8'},fixture(()=>'<html>denied</html>')),e=>e.code==='invalid-hls');
});

test('public player extraction cannot execute page scripts or use a platform watch page as media',async()=>{
  const http=fixture(()=>'<script>globalThis.__playerExecuted=true;var player_x={"url":"https://cdn.example/a.m3u8","encrypt":0};</script>');
  assert.equal((await resolveWebMedia({url:'https://catalog.example/play/1'},http)).direct,true);assert.equal(globalThis.__playerExecuted,undefined);
  await assert.rejects(resolveWebMedia({url:'https://v.qq.com/x/cover/example.html'},http),e=>e.code==='platform-player-required');
});

test('shared spider class names do not merge independent AppGet providers',()=>{
  const a={type:3,api:'csp_AppGet',configRef:{url:'https://config.example/a.json',key:'a'}};
  assert.notEqual(sourceIdentityKey(a),sourceIdentityKey({...a,configRef:{...a.configRef,key:'b'}}));
  assert.equal(sourceIdentityKey({type:1,api:'https://cms.example/api'}),'https://cms.example/api');
});

test('matching direct lines become failover variants without mixing episodes or trailers',()=>{
  const result=selectDirectLine([{from:'主線',name:'第01集',url:'https://a.example/1.m3u8'},{from:'主線',name:'第02集',url:'https://a.example/2.m3u8'},{from:'備用',name:'1',url:'https://b.example/1.m3u8'},{from:'備用',name:'2',url:'https://b.example/2.m3u8'},{from:'預告',name:'第01集',url:'https://c.example/trailer.mp4'}]);
  assert.equal(result.episodes.length,2);assert.equal(result.episodes[0].variants.length,2);assert.equal(result.episodes[1].variants[1].url,'https://b.example/2.m3u8');
});

test('adapter snapshots keep full episode lines, resume backfill, and retain details after upstream failures',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingshi-adapter-'));
  try{
    const source={id:'adapter-test',key:'test',name:'測試來源',adapterKind:'appget'};
    const calls=[];let fail=false;
    const adapter={kind:'appget',categories:async()=>[{id:'1',name:'動漫'}],list:async(id,page)=>{calls.push(page);return {items:page<4?[{id:String(page),title:`作品${page}`}]:[]};},detail:async id=>{if(fail)throw new Error('upstream down');return {id,title:`作品${id}`,episodes:[{from:'opaque',name:'第一集',url:'https://app.example/id'},{from:'hls',name:'第一集',url:`https://cdn.example/${id}-1.m3u8`},{from:'hls',name:'第二集',url:`https://cdn.example/${id}-2.m3u8`}]};}};
    const first=await indexReviewedAdapter(source,{detailRoot:path.join(root,'vod-detail'),adapter,refreshPages:1,backfillPages:1,verifyPlayback:false});
    assert.equal(first.items.length,2);assert.equal(first.items[0].episodeCount,2);assert.equal(first.source.complete,false);assert.equal(first.source.adapterState.cursors['1'],3);
    calls.length=0;
    const second=await indexReviewedAdapter(first.source,{detailRoot:path.join(root,'vod-detail'),adapter,refreshPages:1,backfillPages:2,verifyPlayback:false});
    assert.deepEqual(calls,[1,3,4]);assert.equal(second.items.length,3);assert.equal(second.source.complete,true);
    fail=true;
    const third=await indexReviewedAdapter(second.source,{detailRoot:path.join(root,'vod-detail'),adapter,refreshPages:1,backfillPages:2,verifyPlayback:false});
    assert.equal(third.items.length,3);assert.equal(third.items[0].episodes[1].url,'https://cdn.example/1-2.m3u8');assert.equal(third.source.complete,false);assert.equal(third.source.adapterState.pendingDetails[0].id,'1');assert.equal(third.source.adapterState.cursors['1'],4);
    const noHttp={request:async()=>{throw new Error('snapshot unavailable');}};
    await assert.rejects(indexReviewedAdapter(second.source,{detailRoot:path.join(root,'missing/vod-detail'),adapter,http:noHttp}),/snapshot unavailable/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('XBPQ default episode extraction excludes navigation and XYQ replaces search page tokens',async()=>{
  const rule={'主页url':'https://catalog.example','分类':'電影$1'};
  const http=fixture(()=>'<h1>測試電影</h1><nav><a href="/">首頁</a></nav><ul class="stui-content__playlist"><li><a href="/play/1">第一集</a></li></ul>');
  const a=await createAdapter({api:'csp_XBPQ',ext:rule},{http});const d=await a.detail('https://catalog.example/detail/1');assert.equal(d.episodes.length,1);assert.equal(d.episodes[0].name,'第一集');
  assert.equal(template('/search/{wd}/{SearchPg}',{keyword:'測試',page:2}),'/search/%E6%B8%AC%E8%A9%A6/2');
});

test('AppGet opaque IDs use the source transport resolver and never become fake relative media URLs',async()=>{
  const ext={url:'https://catalog.example',dataKey:'1234567890123456',dataIv:'1234567890123456'};
  const encode=value=>{const c=crypto.createCipheriv('aes-128-cbc',Buffer.from(ext.dataKey),Buffer.from(ext.dataIv));return Buffer.concat([c.update(JSON.stringify(value)),c.final()]).toString('base64');};
  const http=fixture((url,options)=>{
    if(url.pathname.endsWith('/vodDetail'))return {data:encode({vod:{vod_id:1,vod_name:'測試'},vod_play_list:[{player_info:{show:'line',parse:'public-transport'},urls:[{name:'第一集',url:'opaque-id',token:''}]}]})};
    assert.ok(url.pathname.endsWith('/vodParse'));const form=new URLSearchParams(options.body);assert.equal(form.get('parse_api'),'public-transport');assert.ok(options.headers['app-api-verify-sign']);return {data:encode({json:JSON.stringify({url:'https://cdn.example/first.m3u8'})})};
  });
  const a=await createAdapter({api:'csp_AppGet',key:'test',ext},{http});const detail=await a.detail('1');assert.equal(detail.episodes[0].rawUrl,'opaque-id');assert.equal((await a.resolve(detail.episodes[0])).url,'https://cdn.example/first.m3u8');
});

test('daily catalog rebuild preserves distinct object configurations and adapter checkpoints',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingshi-adapter-rebuild-'));
  try{
    await fs.mkdir(path.join(root,'sources'),{recursive:true});await fs.mkdir(path.join(root,'docs/data'),{recursive:true});
    const sites=['a','b'].map(key=>({key,name:key,type:3,api:'csp_AppGet',adapterKind:'appget',ext:{url:`https://${key}.example`,dataKey:'fixture-key'}}));
    await fs.writeFile(path.join(root,'sources/juwan-adapter-sources.json'),JSON.stringify({sites}));
    await fs.writeFile(path.join(root,'sources/current.json'),JSON.stringify({sites:[]}));
    const output=path.join(root,'docs/data/iphone-vod-catalog.json');
    await fs.writeFile(output,JSON.stringify({sources:sites.map(x=>({...x,id:`stable-${x.key}`,indexed:true,itemCount:1,playableCount:1,adapterState:{cursors:{'1':8}},indexPath:`vod-index/${x.key}.json.gz`,detailPathPattern:`vod-detail/${x.key}/page-{page}.json.gz`})),items:[],filters:{},totals:{items:2,playableItems:2}}));
    const script=fileURLToPath(new URL('../tools/build-iphone-vod-catalog.mjs',import.meta.url));
    execFileSync(process.execPath,[script,'--tvRoot',root,'--output',output,'--currentVodInput',path.join(root,'sources/current.json'),'--includeLegacySources','false','--mergeExisting','true'],{encoding:'utf8',timeout:15000});
    const result=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(result.sources.length,2);
    for(const source of result.sources){assert.equal(source.id,`stable-${source.key}`);assert.equal(source.ext.url,`https://${source.key}.example`);assert.equal(source.adapterState.cursors['1'],8);assert.equal(source.indexPath,`vod-index/${source.key}.json.gz`);}
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
