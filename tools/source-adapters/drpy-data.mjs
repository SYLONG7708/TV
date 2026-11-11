import {parse} from 'acorn';
import {load} from 'cheerio';
import {AdapterError,publicUrl} from './http.mjs';
import {absolute,cleanText,cssAll,cssValue,getPath,template,directMedia,excludedContent,normalizeVideo,extractEpisodes} from './common.mjs';
import {ruleHeaders,resolveWebMedia} from './html-rules.mjs';

export function parseDrpyRule(text){
  let tree;try{tree=parse(String(text),{ecmaVersion:'latest',allowReturnOutsideFunction:true});}catch{throw new AdapterError('invalid-script','drpy rule is not valid JavaScript data');}
  const environment=new Map();
  function read(node){
    if(!node)return undefined;
    if(node.type==='Literal')return node.value;
    if(node.type==='Identifier')return environment.get(node.name);
    if(node.type==='TemplateLiteral'&&node.expressions.length===0)return node.quasis[0].value.cooked;
    if(node.type==='BinaryExpression'&&node.operator==='+'){const a=read(node.left),b=read(node.right);if(['string','number'].includes(typeof a)&&['string','number'].includes(typeof b))return a+b;}
    if(node.type==='UnaryExpression'&&node.operator==='-'&&node.argument.type==='Literal')return -node.argument.value;
    if(node.type==='ArrayExpression')return node.elements.map(read);
    if(node.type==='ObjectExpression'){const result={};for(const p of node.properties){if(p.type!=='Property'||p.computed)continue;const key=p.key.name??p.key.value;if(['__proto__','constructor','prototype'].includes(key))continue;result[key]=read(p.value);}return result;}
    return {unsupportedExpression:node.type};
  }
  let rule;
  for(const statement of tree.body){
    if(statement.type==='VariableDeclaration')for(const d of statement.declarations){if(d.id.type==='Identifier'){const value=read(d.init);environment.set(d.id.name,value);if(d.id.name==='rule')rule=value;}}
    else if(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression'){
      const a=statement.expression;if(a.left.type==='Identifier'&&a.left.name==='rule')rule=read(a.right);
      if(a.left.type==='MemberExpression'&&a.left.object?.name==='rule'&&rule){const key=a.left.computed?read(a.left.property):a.left.property.name;if(typeof key==='string'&&!['__proto__','constructor','prototype'].includes(key))rule[key]=read(a.right);}
    }
  }
  if(!rule||typeof rule!=='object'||typeof rule.host!=='string')throw new AdapterError('runtime-required','drpy rule needs its JavaScript runtime to build the host configuration');
  return rule;
}

function urlTemplate(value,rule,args){
  let raw=String(value||'');const filter=typeof rule.filter_url==='string'?template(rule.filter_url,args):'';
  raw=raw.replace(/fyfilter/g,filter).replace(/fyid/g,encodeURIComponent(String(args.id||'')));
  raw=template(raw,args);
  raw=raw.replace(/\(\s*(\d+)\s*-\s*1\s*\)/g,(_,n)=>String(Number(n)-1));
  return publicUrl(raw,rule.host);
}

export function createDrpyData(source,rule,http){
  const base=publicUrl(rule.host),headers=ruleHeaders(rule.headers);let classes=[];
  if(typeof rule.class_name==='string'&&typeof rule.class_url==='string'){const names=rule.class_name.split('&'),ids=rule.class_url.split('&');classes=names.map((name,i)=>({name,id:ids[i]})).filter(x=>x.id&&!excludedContent.test(x.name));}
  async function fetchText(url){return (await http.request(url,{headers,charset:typeof rule['编码']==='string'?rule['编码']:'utf-8'})).text;}
  function parseList(text,schema){
    if(typeof schema!=='string'||schema.startsWith('js:'))throw new AdapterError('runtime-required','This drpy list needs executable JavaScript');
    const [array,title,pic,remarks,id]=schema.split(';');let items=[];
    if(array.startsWith('json:')){
      let payload;try{payload=JSON.parse(text);}catch{throw new AdapterError('non-json','drpy list did not return JSON');}
      const rows=getPath(payload,array);if(!Array.isArray(rows))throw new AdapterError('invalid-list','drpy JSON selector did not produce a list');
      items=rows.map(row=>({id:String(getPath(row,id)||''),title:cleanText(getPath(row,title)),poster:absolute(getPath(row,pic),base),remarks:cleanText(getPath(row,remarks)),raw:row}));
    }else{
      items=cssAll(text,array).map(html=>({id:absolute(cssValue(html,id||'a&&href'),base),title:cssValue(html,title||'a&&title'),poster:absolute(cssValue(html,pic||'img&&src'),base),remarks:cssValue(html,remarks),raw:{}}));
    }
    return items.filter(x=>x.id&&x.title&&!excludedContent.test(x.title));
  }
  return {kind:'drpy-data',base,
    async categories(){
      if(classes.length)return classes;
      if(typeof rule.class_parse!=='string')throw new AdapterError('runtime-required','This drpy category list needs executable JavaScript');
      const [array,name,link]=rule.class_parse.split(';');const text=await fetchText(publicUrl(rule.homeUrl||base,base));
      classes=cssAll(text,array).map(html=>{const href=absolute(cssValue(html,link||'a&&href'),base);let id='';try{id=new URL(href).pathname.split('/').filter(Boolean).at(-1).replace(/\.html?$/,'');}catch{}return {name:cssValue(html,name||'a&&Text'),id};}).filter(x=>x.id&&x.name&&!excludedContent.test(x.name));
      return classes;
    },
    async list(category,page=1,filters={}){const url=urlTemplate(rule.url,rule,{category,page,filters});return {items:parseList(await fetchText(url),rule['一级']),page,pagecount:null};},
    async search(keyword,page=1){if(!rule.searchUrl)throw new AdapterError('no-search','drpy rule has no search endpoint');const text=await fetchText(urlTemplate(rule.searchUrl,rule,{keyword,page}));return parseList(text,rule['搜索']==='*'||!rule['搜索']?rule['一级']:rule['搜索']);},
    async detail(id){
      const url=/^https?:/.test(id)?publicUrl(id):urlTemplate(rule.detailUrl||rule.url,rule,{id,category:id,page:1});
      const text=await fetchText(url);let data;try{data=JSON.parse(text);}catch{}
      if(data){const row=data.data?.vod_info||data.data?.vod||data.list?.[0]||data.data||data;const item=normalizeVideo(row,base);if(item)return {...item,episodes:extractEpisodes(row,base)};}
      const d=rule['二级'];if(!d||typeof d!=='object'||d.unsupportedExpression)throw new AdapterError('runtime-required','This drpy detail page needs executable JavaScript');
      const title=cssValue(text,String(d.title||'h1&&Text').split(';')[0]);const poster=absolute(cssValue(text,d.img||'img&&src'),url);const episodes=[];
      const tabs=d.tabs?cssAll(text,d.tabs):[''];for(let group=0;group<Math.max(1,tabs.length);group++){
        const selector=String(d.lists||'.module-play-list a').replace(/#id/g,String(group));
        for(const html of cssAll(text,selector)){const $=load(html),a=$('a').first(),value=a.attr('href');if(!value)continue;const address=absolute(value,url);if(address)episodes.push({name:cleanText(a.text())||'正片',url:address,from:String(group),direct:directMedia(address)});}
      }
      if(!title)throw new AdapterError('invalid-detail','drpy detail rule returned no video title');return {id,title,poster,episodes,raw:{vod_id:id,vod_name:title}};
    },
    async resolve(episode){return resolveWebMedia(episode,http,{headers,base});}
  };
}
