import {createHttp,AdapterError,publicUrl} from './http.mjs';
import {decodeConfig} from '../audit-juwan-sources.mjs';
import {createAppYs,createAppGet} from './app-json.mjs';
import {createHtmlRules} from './html-rules.mjs';
import {parseDrpyRule,createDrpyData} from './drpy-data.mjs';

export async function createAdapter(source,{http=createHttp(),ruleText=null}={}){
  if(source.configRef){
    const response=await http.request(publicUrl(source.configRef.url));
    const config=decodeConfig(response.text).config;
    const upstream=config.sites?.find(x=>x.key===source.configRef.key);
    if(!upstream)throw new AdapterError('upstream-rule-missing','The upstream configuration no longer declares this source');
    source={...source,api:upstream.api,ext:upstream.ext,originConfig:source.configRef.url,configRef:undefined};
  }
  if(source.api==='csp_AppYsV2'||source.adapterKind==='appys')return createAppYs(source,http);
  if(source.api==='csp_AppGet'||source.adapterKind==='appget')return createAppGet(source,http);
  const kind=source.adapterKind||(/drpy/i.test(source.api)?'drpy-data':/XYQ/i.test(source.api)?'xyq':/XBPQ|HBPQ/.test(source.api)?'xbpq':'');
  if(!kind)throw new AdapterError('unsupported-adapter','This source needs an adapter implementation');
  let rule=source.rule;
  if(!rule){
    if(source.ext&&typeof source.ext==='object')rule=source.ext;
    else{
      if(ruleText===null){const url=publicUrl(source.ruleUrl||source.ext,source.baseUrl||source.originConfig);ruleText=(await http.request(url)).text;}
      rule=kind==='drpy-data'?parseDrpyRule(ruleText):decodeConfig(ruleText).config;
    }
  }
  return kind==='drpy-data'?createDrpyData(source,rule,http):createHtmlRules(source,rule,http,{kind});
}

export {createHttp,AdapterError};
