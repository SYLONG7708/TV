import crypto from 'node:crypto';
import {AdapterError,publicUrl} from './http.mjs';
import {categoryRows,videoRows,normalizeVideo,extractEpisodes,directMedia,platformPage} from './common.mjs';

function appRoot(source){const ext=source.ext;const raw=typeof ext==='string'?ext.split('###')[0]:ext?.api||ext?.url||'';return publicUrl(raw,source.originConfig||source.baseUrl);}
export function createAppYs(source,http){
  const base=appRoot(source),v1=/\.vod(?:\/?$|\?)/.test(base),root=v1?base.replace(/\/$/,''):base.replace(/\/?$/,'/');
  const headers={'user-agent':v1?'okhttp/4.1.0':'Dart/2.14 (dart:io)'};
  const url=(suffix,params={})=>{const u=new URL(root+suffix);for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));return u.href;};
  const read=async(value)=>{const data=await http.json(value,{headers});if(data.code&&![1,200].includes(Number(data.code))&&!data.data&&!data.list)throw new AdapterError('api-rejected',String(data.msg||data.message||'Application API rejected the request').slice(0,150));return data;};
  return {kind:'appys',base,
    async categories(){const data=await read(v1?url('/types'):url('nav',{token:''}));const rows=categoryRows(data);if(!rows.length)throw new AdapterError('no-categories','App API returned no usable categories');return rows;},
    async list(category,page=1,filters={}){const data=await read(v1?url('',{type:category,page,limit:30,...filters}):url('video',{tid:category,pg:page,limit:30,...filters}));return {items:videoRows(data).map(x=>normalizeVideo(x,base)).filter(Boolean),page,pagecount:Number(data.pagecount??data.totalpage??data.data?.pagecount??0)||null};},
    async search(keyword,page=1){const data=await read(v1?url('',{wd:keyword,page}):url('search',{text:keyword,pg:page}));return videoRows(data).map(x=>normalizeVideo(x,base)).filter(Boolean);},
    async detail(id){const data=await read(v1?url('/detail',{vod_id:id}):url('video_detail',{id}));const row=data.data?.vod_info||data.data?.vod||data.data||data.list?.[0]||data;const item=normalizeVideo(row,base);if(!item)throw new AdapterError('invalid-detail','App API returned no video details');return {...item,episodes:extractEpisodes(row,base)};},
    async resolve(episode){return {...episode,direct:directMedia(episode.url)};}
  };
}

export function decodeAppGetData(data,ext){
  if(typeof data!=='string')return data;
  if(data.trimStart().startsWith('{')||data.trimStart().startsWith('['))return JSON.parse(data);
  const key=Buffer.from(String(ext.dataKey||'')),iv=Buffer.from(String(ext.dataIv||ext.dataKey||''));
  if(![16,24,32].includes(key.length)||iv.length!==16)throw new AdapterError('unsupported-key','AppGet requires its declared transport key and IV');
  try{const d=crypto.createDecipheriv(`aes-${key.length*8}-cbc`,key,iv);return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString('utf8'));}catch{throw new AdapterError('encrypted-response','AppGet transport response could not be decoded');}
}
export function createAppGet(source,http){
  const ext=typeof source.ext==='object'?source.ext:{};let base=ext.url||ext.host||'';
  async function initBase(){if(base)return publicUrl(base).replace(/\/$/,'');if(ext.site){const r=await http.request(publicUrl(ext.site,source.originConfig||source.baseUrl));const candidates=r.text.match(/https?:\/\/[^\s<>"']+/g);if(candidates?.length)base=candidates[0];}if(!base)throw new AdapterError('missing-host','AppGet configuration has no public host');base=publicUrl(base).replace(/\/$/,'');return base;}
  const device=crypto.createHash('sha256').update(JSON.stringify([source.key,ext.url])).digest('hex').slice(0,32);
  function encode(value){const key=Buffer.from(String(ext.dataKey||'')),iv=Buffer.from(String(ext.dataIv||ext.dataKey||''));if(![16,24,32].includes(key.length)||iv.length!==16)throw new AdapterError('unsupported-key','AppGet requires its declared transport key and IV');const c=crypto.createCipheriv(`aes-${key.length*8}-cbc`,key,iv);return Buffer.concat([c.update(String(value),'utf8'),c.final()]).toString('base64');}
  async function call(action,params={}){
    const time=String(Math.floor(Date.now()/1000));
    const host=await initBase();const data=await http.json(`${host}/api.php/getappapi.index/${action}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','app-user-device-id':ext.deviceId||device,'app-version-code':String(ext.version||'119'),'app-api-verify-time':time,'app-ui-mode':'light',...(action==='vodParse'?{'app-api-verify-sign':encode(time)}:{})},body:new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString()});
    if(data.code&&![1,200].includes(Number(data.code))&&!data.data)throw new AdapterError(Number(data.code)===401?'login-required':'api-rejected',String(data.msg||data.message||'AppGet request rejected').slice(0,150));
    return data.data===undefined?data:decodeAppGetData(data.data,ext);
  }
  return {kind:'appget',get base(){return base;},
    async categories(){const data=await call('initV119');const rows=categoryRows(data);if(!rows.length){const direct=data.type_list||data.types||data?.typeFilterList;return categoryRows({data:direct});}return rows;},
    async list(category,page=1,filters={}){const data=await call('typeFilterVodList',{type_id:category,page,...filters});return {items:videoRows(data).map(x=>normalizeVideo(x,base)).filter(Boolean),page,pagecount:Number(data.pagecount||0)||null};},
    async search(keyword,page=1){const data=await call('searchList',{type_id:0,keywords:keyword,page});return videoRows(data).map(x=>normalizeVideo(x,base)).filter(Boolean);},
    async detail(id){const data=await call('vodDetail',{vod_id:id});const row={...(data.vod||data.vod_info||data),vod_play_list:data.vod_play_list||(data.vod||data.vod_info||data).vod_play_list};const item=normalizeVideo(row,base);if(!item)throw new AdapterError('invalid-detail','AppGet returned no video details');return {...item,episodes:extractEpisodes(row,base)};},
    async resolve(episode){
      if(directMedia(episode.url))return {...episode,direct:true};
      if(platformPage(episode.url))throw new AdapterError('platform-player-required','This episode points to a platform watch page');
      if(!episode.parseApi)throw new AdapterError('no-parser','AppGet did not declare a player resolver');
      const data=await call('vodParse',{parse_api:episode.parseApi,url:encode(episode.rawUrl||episode.url),token:episode.token||''});
      let parsed=data.json??data;if(typeof parsed==='string'){try{parsed=JSON.parse(parsed);}catch{parsed={url:parsed};}}
      const url=parsed?.url||parsed?.data?.url||'';
      if(!directMedia(url))throw new AdapterError('no-direct-media','AppGet resolver did not return direct media');
      return {...episode,url:publicUrl(url),direct:true};
    }
  };
}
