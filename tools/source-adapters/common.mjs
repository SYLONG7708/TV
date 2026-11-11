import {load} from 'cheerio';
import {AdapterError,publicUrl} from './http.mjs';

export const excludedContent=/成人|情色|色情|伦理|倫理|18\+|🔞|麻豆|里番|裏番|擦边|擦邊|写真热舞|寫真熱舞|两性课堂|兩性課堂/i;
export const cleanText=value=>load(String(value??''),null,false).text().replace(/\s+/g,' ').trim();
export const directMedia=url=>/^https?:\/\//i.test(String(url||''))&&/\.(?:m3u8|mp4|m4v|webm|mov|flv|ts)(?:[?#]|$)/i.test(url);
export const platformPage=url=>/(?:^|\.)(?:iqiyi\.com|v\.qq\.com|youku\.com|mgtv\.com|bilibili\.com)$/i.test((()=>{try{return new URL(url).hostname;}catch{return '';}})());
export function absolute(value,base){if(!String(value??'').trim())return '';try{return publicUrl(String(value).replace(/&amp;/g,'&'),base);}catch{return '';}}
export function getPath(value,expression){
  let rows=[value];const bits=String(expression||'').replace(/^json:/,'').replace(/^\$\.?/,'').replace(/\[(\d+|\*)\]/g,'.$1').split('.').filter(Boolean);
  for(const bit of bits){if(['__proto__','constructor','prototype'].includes(bit))throw new AdapterError('invalid-selector','Invalid object selector');rows=rows.flatMap(row=>bit==='*'?(Array.isArray(row)?row:Object.values(row||{})):[row?.[bit]]).filter(x=>x!==undefined&&x!==null);}
  return rows.length===1?rows[0]:rows;
}
export function videoRows(payload){
  if(Array.isArray(payload)&&payload.some(x=>x&&typeof x==='object'&&(x.vod_id!==undefined||x.vod_name||x.name&&x.pic)))return payload;
  for(const key of ['list','recommend_list','search_list','data.list','data.vod_list','data.vlist','data','vod_list','vlist','result.list','result']){const v=getPath(payload,key);if(Array.isArray(v)&&v.some(x=>x?.vod_id!==undefined||x?.vod_name||x?.nextlink||x?.id!==undefined&&(x.title||x.name)))return v;}
  return [];
}
export function categoryRows(payload){
  for(const key of ['class','data.type_list','data.list','data','list','types','data.types','data.class']){const v=getPath(payload,key);if(Array.isArray(v)&&v.some(x=>x?.type_id!==undefined||x?.list_id!==undefined))return v.map(x=>({id:String(x.type_id??x.list_id??x.id??''),name:cleanText(x.type_name??x.list_name??x.name??''),filters:x.type_extend||{}})).filter(x=>x.id&&x.name&&!excludedContent.test(x.name));}
  return [];
}
export function normalizeVideo(row,base){
  const title=cleanText(row.vod_name??row.name??row.title);const id=String(row.vod_id??row.id??row.vodid??row.nextlink??row.url??'');
  if(!id||!title||excludedContent.test([title,row.type_name,row.categoryName].join(' ')))return null;
  return {id,title,poster:absolute(row.vod_pic??row.pic??row.cover??row.image,base),remarks:cleanText(row.vod_remarks??row.remarks??row.note??row.state),year:String(row.vod_year??row.year??''),area:cleanText(row.vod_area??row.area),category:cleanText(row.type_name??row.vod_class??row.categoryName),updatedAt:String(row.vod_time??row.update_time??''),raw:row};
}
export function episodesFromRaw(raw,base,from=''){
  if(typeof raw!=='string'||!raw.trim())return [];
  return raw.split('$$$').flatMap((group,groupIndex)=>group.split('#').map((part,index)=>{const i=part.lastIndexOf('$');const value=i<0?part:part.slice(i+1);const url=absolute(value,base);return url?{name:cleanText(i<0?`第${index+1}集`:part.slice(0,i)),url,from:from||String(groupIndex),direct:directMedia(url),platform:platformPage(url)}:null;}).filter(Boolean));
}
export function extractEpisodes(row,base){
  const result=episodesFromRaw(row.vod_play_url??row.vod_play??row.play_url??'',base);
  for(const key of ['vod_url_with_player','vod_play_list','play_list','playList','urls']){
    const groups=row[key];if(!Array.isArray(groups))continue;
    for(const group of groups){const from=String(group.code??group.name??group.player_info?.from??group.player_info?.show??'');if(typeof group.url==='string')result.push(...episodesFromRaw(group.url,base,from));const list=group.urls??group.list??group.episodes;if(Array.isArray(list))for(const ep of list){const rawUrl=String(ep.url??ep.play_url??''),url=absolute(rawUrl,base);if(url)result.push({name:cleanText(ep.name??ep.title??'正片'),url,from,direct:directMedia(url),platform:platformPage(url),rawUrl,parseApi:String(group.player_info?.parse??''),parseApiUrl:String(ep.parse_api_url??''),token:String(ep.token??'')});}}
  }
  const seen=new Set();return result.filter(x=>{const k=x.from+'\0'+x.url;if(seen.has(k))return false;seen.add(k);return true;});
}
export function template(value,{category='',page=1,keyword='',filters={}}={}){
  return String(value||'').replace(/\{(?:cateId|tid|classId)\}|fyclass/g,String(category)).replace(/\{(?:catePg|SearchPg|pg|page)\}|fypage/g,String(page)).replace(/\{(?:wd|keyword|key)\}|\*\*|fykey/g,encodeURIComponent(keyword)).replace(/\{\{\s*fl\.([\w]+)\s*\}\}|\{(area|year|lang|class|by|letter)\}/g,(_,a,b)=>encodeURIComponent(filters[a||b]||''));
}
export function cssAll(html,rule){
  const $=load(String(html||''));let selection=$.root();
  for(const part of String(rule||'').split('&&').filter(Boolean)){try{selection=selection.find(part.replace(/,(\-?\d+)$/,(m,n)=>`:eq(${n})`));}catch(e){throw new AdapterError('unsupported-selector',`Unsupported CSS selector: ${part.slice(0,90)}`);}}
  return selection.toArray().map(node=>$.html(node));
}
export function cssValue(html,rule){
  if(!rule)return '';
  const [selection,...rest]=String(rule).split('&&');const pieces=String(rule).split('&&');const valueRule=pieces.length>1?pieces.pop():'Text';const selector=pieces.length?pieces.join('&&'):selection;
  const $=load(String(html||''));let node=$.root();
  for(const part of selector.split('&&').filter(x=>x&&x!=='*')){try{node=node.find(part.replace(/,(\-?\d+)$/,(m,n)=>`:eq(${n})`));}catch{return '';}}
  const [attrs,...remove]=valueRule.split('!');let value='';for(const attr of attrs.split('||')){value=/^text$/i.test(attr)?node.first().text():/^html$/i.test(attr)?node.first().html()||'':node.first().attr(attr)||'';if(value)break;}for(const token of remove)value=value.replaceAll(token,'');return cleanText(value);
}
export function textRange(text,rule,{blocks=false}={}){
  if(!rule||rule==='空'||rule==='*')return blocks?[String(text)]:String(text||'');
  let expression=String(rule).replace(/\[(?:不包含|包含):[^\]]*\]/g,'');
  const i=expression.indexOf('&&');if(i<0)return blocks?[]:'';
  let before=expression.slice(0,i),after=expression.slice(i+2);let prefix='',suffix='';
  if(before.includes('+')){const at=before.indexOf('+');prefix=before.slice(0,at);before=before.slice(at+1);if(!before)before=prefix;}
  if(after.includes('+')){const at=after.lastIndexOf('+');suffix=after.slice(at+1);after=after.slice(0,at);}
  // Asterisks in these data rules separate literal anchors; they are not code.
  const anchors=before.split('*').filter(Boolean);const values=[];let cursor=0;
  while(cursor<String(text).length){let start=cursor,first=-1;for(const anchor of anchors){const at=String(text).indexOf(anchor,start);if(at<0){start=-1;break;}if(first<0)first=at;start=at+anchor.length;}if(start<0)break;if(!anchors.length)first=start;
    const end=after?String(text).indexOf(after,start):String(text).length;if(end<0)break;
    const value=blocks?String(text).slice(first,end+after.length):prefix+String(text).slice(start,end)+suffix;values.push(value);cursor=end+Math.max(after.length,1);if(!blocks)break;
  }
  return blocks?values:values[0]||'';
}
