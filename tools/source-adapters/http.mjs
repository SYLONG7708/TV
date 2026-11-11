import dns from 'node:dns/promises';
import net from 'node:net';

export class AdapterError extends Error {
  constructor(code,message){super(message);this.name='AdapterError';this.code=code;}
}

export function isPrivateAddress(address){
  const ip=String(address).toLowerCase().replace(/^\[|\]$/g,'');
  if(net.isIPv4(ip)){
    const [a,b]=ip.split('.').map(Number);
    return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19));
  }
  if(net.isIPv6(ip)){
    if(ip==='::'||ip==='::1'||/^f[cd]|^fe[89ab]|^ff/.test(ip))return true;
    if(ip.startsWith('::ffff:')){const tail=ip.slice(7);if(tail.includes('.'))return isPrivateAddress(tail);const parts=tail.split(':');if(parts.length===2){const n=(parseInt(parts[0],16)*65536)+parseInt(parts[1],16);return isPrivateAddress([n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.'));}}
  }
  return false;
}

export function publicUrl(value,base){
  let u;try{u=new URL(value,base);}catch{throw new AdapterError('invalid-url','Invalid source URL');}
  const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||host==='localhost'||/\.(?:local|localhost|internal)$/.test(host)||isPrivateAddress(host))throw new AdapterError('private-url','Source URL is not a public HTTP address');
  u.hash='';return u.href;
}

export function createHttp({fetchImpl=fetch,lookup=dns.lookup,timeoutMs=12000,maxBytes=4194304,perHostDelayMs=150}={}){
  const resolved=new Map(),lastRequest=new Map();
  let requests=0;
  async function validate(url){
    const u=new URL(publicUrl(url)),host=u.hostname.replace(/^\[|\]$/g,'');
    if(!resolved.has(host))resolved.set(host,Promise.resolve(lookup(host,{all:true})).then(rows=>{if(!rows.length||rows.some(x=>isPrivateAddress(x.address)))throw new AdapterError('private-dns','Source hostname resolves to a private address');return true;}));
    await resolved.get(host);return u;
  }
  async function request(value,{method='GET',headers={},body,maxResponseBytes=maxBytes,rangeBytes=0,charset='utf-8'}={}){
    let url=publicUrl(value);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      for(let redirect=0;redirect<6;redirect++){
        const u=await validate(url),host=u.host;
        const slot=Math.max(Date.now(),(lastRequest.get(host)||0)+perHostDelayMs);lastRequest.set(host,slot);const wait=slot-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
        requests++;
        const sent={'user-agent':'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/130 Safari/537.36',accept:'application/json,text/html,text/plain,*/*',...headers};
        if(Object.keys(sent).some(x=>/^(cookie|authorization|proxy-authorization)$/i.test(x)))throw new AdapterError('login-required','Account headers require a user-owned session');
        if(rangeBytes)sent.range=`bytes=0-${rangeBytes-1}`;
        const response=await fetchImpl(url,{method,headers:sent,body,signal:controller.signal,redirect:'manual'});
        if([301,302,303,307,308].includes(response.status)){
          const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new AdapterError('redirect','Redirect has no destination');
          url=publicUrl(location,url);if(response.status===303||(response.status===302&&method==='POST')){method='GET';body=undefined;}continue;
        }
        if(!response.ok){await response.body?.cancel();throw new AdapterError(response.status===401?'login-required':response.status===403?'access-denied':response.status===404?'not-found':response.status===429?'rate-limited':'http-error',`HTTP ${response.status}`);}
        const reader=response.body?.getReader();if(!reader)throw new AdapterError('empty-response','Empty source response');const chunks=[];let size=0;
        try{while(true){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.length;if(!rangeBytes&&size>maxResponseBytes){await reader.cancel();throw new AdapterError('response-limit','Source response exceeds its size limit');}chunks.push(chunk);if(rangeBytes&&size>=rangeBytes){await reader.cancel();break;}}}finally{reader.releaseLock();}
        const bytes=Buffer.concat(chunks);const data=rangeBytes?bytes.subarray(0,rangeBytes):bytes;
        let text;try{text=new TextDecoder(charset).decode(data);}catch{text=data.toString('utf8');}
        return {url,finalUrl:url,status:response.status,headers:response.headers,bytes:data,text:text.replace(/^\uFEFF/,'')};
      }
      throw new AdapterError('redirect-limit','Too many source redirects');
    }catch(error){if(error instanceof AdapterError)throw error;throw new AdapterError(controller.signal.aborted?'timeout':'network-error',controller.signal.aborted?'Source request timed out':String(error.message));}finally{clearTimeout(timer);}
  }
  return {request,json:async(url,options)=>{const r=await request(url,options);try{return JSON.parse(r.text);}catch{throw new AdapterError('non-json',/^\s*</.test(r.text)?'Source returned HTML instead of API data':'Source did not return JSON');}},get requests(){return requests;}};
}
