import {load} from 'cheerio';
import {parse} from 'acorn';
import {AdapterError,publicUrl} from './http.mjs';
import {absolute,cleanText,cssAll,cssValue,textRange,getPath,template,directMedia,excludedContent,platformPage} from './common.mjs';

const MOBILE='Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const DESKTOP='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
export function ruleHeaders(value){
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>/^(?:user-agent|referer|accept|content-type)$/i.test(key)).map(([key,v])=>[key,/^(?:PC_UA|桌面|电脑)$/i.test(v)?DESKTOP:/^(?:MOBILE_UA|UC_UA|手机)$/i.test(v)?MOBILE:String(v)]));
  if(!value||value==='手机')return {'user-agent':MOBILE};if(value==='电脑')return {'user-agent':DESKTOP};
  const result={};for(const part of String(value).split('#')){const at=part.search(/[$@]/);if(at<0)continue;const key=part.slice(0,at),v=part.slice(at+1);if(/^(?:user-agent|referer|accept|content-type)$/i.test(key))result[key]=/^(?:MOBILE_UA|UC_UA|手机)$/i.test(v)?MOBILE:/^(?:PC_UA|电脑)$/i.test(v)?DESKTOP:v;}
  return result;
}
function choose(rule,search=false){const parts=String(rule||'').split('||');const marked=parts.find(x=>x.startsWith(search?'搜索--':'默认--'));return (marked||parts.find(x=>!/^搜索--|^默认--/.test(x))||parts[0]||'').replace(/^(?:搜索|默认)--/,'');}
function literalValue(html,rule,search=false){let value=choose(rule,search);const decode=value.startsWith('urlDecode(')&&value.endsWith(')');if(decode)value=value.slice(10,-1);let out=textRange(html,value);if(decode){try{out=decodeURIComponent(out);}catch{}}return cleanText(out);}
function categoryPairs(names,values){
  const a=String(names||'').split(/[&#]/).map(x=>x.trim()).filter(Boolean),b=String(values||'').split('&');
  return a.map((part,i)=>{const p=part.lastIndexOf('$');return p>=0?{name:part.slice(0,p),id:part.slice(p+1)}:{name:part,id:values==='*'?part:b[i]||String(i+1)};}).filter(x=>x.id&&!excludedContent.test(x.name));
}
function jsonPayload(text,extract){
  let value=String(text).trim();if(extract)value=textRange(value,extract);
  if(!value.startsWith('{')&&!value.startsWith('[')){const start=value.indexOf('('),end=value.lastIndexOf(')');if(start>=0&&end>start)value=value.slice(start+1,end);}
  try{return JSON.parse(value);}catch{throw new AdapterError('non-json','The rule expected JSON or JSONP data');}
}
function typed(row){return {...row,raw:{vod_id:row.id,vod_name:row.title,vod_pic:row.poster,vod_remarks:row.remarks,type_name:row.category||''}};}

export function createHtmlRules(source,rule,http,{kind='xbpq'}={}){
  const xyq=kind==='xyq';
  const root=rule['主页url']||rule['首页推荐链接']||rule['分类链接']||rule['分类url']||source.originConfig||source.baseUrl;
  const base=publicUrl(root,source.originConfig||source.baseUrl);
  const headers=ruleHeaders(rule[xyq?'请求头参数':'请求头']);
  const charset=rule['网页编码格式']||rule['编码']||'utf-8';
  let categories=categoryPairs(rule[xyq?'分类名称':'分类'],rule[xyq?'分类名称替换词':'分类值']);
  async function request(raw,options={}){
    const target=String(raw||'').split(';;')[0].replace(/;post$/i,'');
    return http.request(publicUrl(target,base),{headers,charset,...options});
  }
  function parseRows(text,search=false){
    const mode=xyq?String(rule[search?'搜索截取模式':'分类截取模式']??(search?rule.search_mode:'1')):String(rule['搜索模式']||'1');
    const arrayRule=xyq?(search?rule['搜索列表数组规则']||rule.sea_arr_rule:rule['分类列表数组规则']):choose(rule[search?'搜索数组':'数组']||rule['数组'],search);
    const field=name=>{
      if(!xyq)return rule[(search?'搜索':'')+name]||rule[name]||'';
      const map={标题:'标题',图片:'图片',副标题:'副标题',链接:'链接'};const old={标题:'sea_title',图片:'sea_pic',副标题:'搜索片单副标题',链接:'sea_url'};
      return rule[(search?'搜索':'分类')+'片单'+map[name]]||(search?rule[old[name]]:'')||'';
    };
    const prefix=xyq?rule[(search?'搜索':'分类')+'片单链接加前缀']||'':'';
    const suffix=xyq?rule[(search?'搜索':'分类')+'片单链接加后缀']||'':'';
    let items=[];
    if((xyq&&mode==='0')||/^\s*[\[{]|^\s*\w+\(/.test(text)&&arrayRule&&!arrayRule.includes('&&')){
      const payload=jsonPayload(text,rule[search?'搜索Json数据二次截取':'分类Json数据二次截取']);
      let rows=getPath(payload,arrayRule||'list');if(!Array.isArray(rows))rows=payload.list||payload.data?.items||payload.data||[];
      if(!Array.isArray(rows))throw new AdapterError('invalid-list','JSON rule returned no video list');
      items=rows.map(row=>{const value=name=>getPath(row,field(name))??'';const id=String(value('链接'));return typed({id:absolute(prefix+id+suffix,base),title:cleanText(value('标题')),poster:absolute(value('图片'),base),remarks:cleanText(value('副标题'))});});
    }else if(xyq){
      const rows=cssAll(text,arrayRule||'a:has(img)');
      items=rows.map(html=>typed({id:absolute(prefix+cssValue(html,field('链接')||'a&&href')+suffix,base),title:cssValue(html,field('标题')||'a&&title'),poster:absolute(cssValue(html,field('图片')||'img&&data-original||src'),base),remarks:cssValue(html,field('副标题'))}));
    }else{
      const rows=textRange(text,arrayRule||'<a&&/a>',{blocks:true});
      items=rows.map(html=>typed({id:absolute(literalValue(html,field('链接')||'href="&&"',search),base),title:literalValue(html,field('标题')||'title="&&"',search),poster:absolute(literalValue(html,field('图片')||'data-original="&&"',search),base),remarks:literalValue(html,field('副标题'),search)}));
    }
    const seen=new Set();return items.filter(x=>x.id&&x.title&&!excludedContent.test(x.title)&&!seen.has(x.id)&&seen.add(x.id));
  }
  async function page(templateValue,args,search=false){
    if(!templateValue)throw new AdapterError('no-search','This rule does not declare a search endpoint');
    const raw=template(templateValue,args),body=search?rule['POST请求数据']||rule.sea_PtBody||'':'';
    const response=await request(raw,{headers:{...headers,...ruleHeaders(rule[xyq?'搜索请求头参数':'搜索请求头'])},...(/;post$/.test(raw)||body?{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded'},body:template(body,args)}:{})});
    return parseRows(response.text,search);
  }
  return {kind,base,
    async categories(){if(!categories.length){const html=(await request(base)).text;const $=load(html);const found=[];for(const node of $('nav a,.nav a,.module-tab a').toArray()){const a=$(node),name=a.text().trim(),id=a.attr('href');if(name&&id&&!excludedContent.test(name)&&name.length<15)found.push({name,id:absolute(id,base)});}categories=found;}if(!categories.length)throw new AdapterError('no-categories','Rule has no usable categories');return categories;},
    async list(category,pageNumber=1,filters={}){const value=xyq?rule['分类链接']:rule['分类url'];return {items:await page(value,{category,page:pageNumber,filters}),page:pageNumber,pagecount:null};},
    async search(keyword,pageNumber=1){const value=xyq?rule['搜索链接']||rule.search_url:rule['搜索url'];return page(value,{keyword,page:pageNumber},true);},
    async detail(id){
      const response=await request(id);const html=response.text,$=load(html);const title=cleanText($('h1').first().text()||$('meta[property="og:title"]').attr('content')||$('title').text());
      if(!title||excludedContent.test(title))throw new AdapterError('invalid-detail','Rule returned no general video detail');
      const episodes=[];
      if(xyq){const groups=cssAll(html,rule['播放列表数组规则']||'body');for(let group=0;group<groups.length;group++){const rows=cssAll(groups[group],rule['选集列表数组规则']||'a');for(const row of rows){const value=cssValue(row,rule['选集链接']||'a&&href');const url=absolute((rule['选集链接加前缀']||'')+value+(rule['选集链接加后缀']||''),response.finalUrl);const nameRule=rule['选集标题']||'a&&Text';const name=/^['"].*['"]$/.test(nameRule)?nameRule.slice(1,-1):cssValue(row,nameRule);if(url)episodes.push({name:name||'正片',url,from:String(group),direct:directMedia(url),platform:platformPage(url)});}}}
      else{
        const section=rule['播放二次截取']?textRange(html,rule['播放二次截取']):html;
        let groups=rule['播放数组']?textRange(section,rule['播放数组'],{blocks:true}):cssAll(section,'.stui-content__playlist,.myui-content__list,.module-play-list,.anthology-list-play,.playlist ul,#playlist ul,.play-list ul,.play_list ul');
        if(!groups.length&&rule['播放列表'])groups=[section];
        for(let group=0;group<groups.length;group++){const rows=textRange(groups[group],rule['播放列表']||'<a&&/a>',{blocks:true});for(const row of rows){const url=absolute(literalValue(row,rule['播放链接']||'href="&&"'),response.finalUrl);if(url)episodes.push({name:literalValue(row,rule['播放标题']||'>&&<')||'正片',url,from:String(group),direct:directMedia(url),platform:platformPage(url)});}}
      }
      if(!episodes.length){for(const node of $('video,source,mip-search-video').toArray()){const n=$(node),url=absolute(n.attr('src')||n.attr('video-src'),response.finalUrl);if(url)episodes.push({name:'正片',url,from:'direct',direct:directMedia(url),platform:false});}}
      if(rule['是否反转选集序列']==='1'||rule['倒序']==='1')episodes.reverse();
      return {id,title,poster:absolute($('meta[property="og:image"]').attr('content')||$('img').first().attr('data-original')||$('img').first().attr('src'),response.finalUrl),category:'',episodes,raw:{vod_id:id,vod_name:title}};
    },
    async resolve(episode){return resolveWebMedia(episode,http,{headers,rule,base});}
  };
}

function literalObject(node){
  if(node.type==='Literal')return node.value;
  if(node.type==='ObjectExpression'){const out={};for(const p of node.properties){if(p.type==='Property'&&!p.computed){const key=p.key.name??p.key.value;if(['__proto__','constructor','prototype'].includes(key))continue;out[key]=literalObject(p.value);}}return out;}
  if(node.type==='ArrayExpression')return node.elements.map(literalObject);
  return undefined;
}
export async function resolveWebMedia(episode,http,{headers={},rule={},base=episode.url,depth=0}={}){
  if(directMedia(episode.url))return {...episode,direct:true,headers};
  if(platformPage(episode.url))throw new AdapterError('platform-player-required','This episode points to a platform watch page');
  if(depth>2)throw new AdapterError('parse-depth','Player page nesting is unsupported');
  const response=await http.request(publicUrl(episode.url,base),{headers});const html=response.text;let media='';
  try{const data=JSON.parse(html);media=data.url||data.data?.url||data.data?.play_url||'';}catch{}
  const $=load(html);if(!media)media=$('video source,video,source,mip-search-video').first().attr('src')||$('mip-search-video').first().attr('video-src')||'';
  if(!media){
    for(const node of $('script').toArray()){
      const text=$(node).html()||'';if(!/player_[\w]*\s*=/.test(text))continue;
      try{
        const tree=parse(text,{ecmaVersion:'latest'});
        for(const statement of tree.body){
          const declarations=statement.type==='VariableDeclaration'?statement.declarations:statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression'?[{id:statement.expression.left,init:statement.expression.right}]:[];
          for(const d of declarations){
            if(!/^player_/.test(d.id?.name||'')||!d.init)continue;
            const value=literalObject(d.init);
            if(value?.url){media=String(value.url);if(String(value.encrypt)==='1'){try{media=decodeURIComponent(media);}catch{}}else if(String(value.encrypt)==='2'){try{media=Buffer.from(media,'base64').toString('utf8');}catch{}}break;}
          }
        }
      }catch{}
    }
  }
  if(!media&&rule['跳转播放链接'])media=literalValue(html,rule['跳转播放链接']);
  if(media){const url=absolute(media,response.finalUrl);if(directMedia(url))return {...episode,url,direct:true,headers};}
  const frame=$('iframe').first().attr('src');if(frame&&absolute(frame,response.finalUrl))return resolveWebMedia({...episode,url:absolute(frame,response.finalUrl)},http,{headers,rule,base:response.finalUrl,depth:depth+1});
  throw new AdapterError('no-direct-media','Player page did not expose a direct HLS or MP4 URL');
}
