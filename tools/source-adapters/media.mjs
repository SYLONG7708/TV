import {AdapterError,publicUrl} from './http.mjs';
import {directMedia} from './common.mjs';

export async function probeMedia(episode,http){
  if(!directMedia(episode.url))throw new AdapterError('not-direct-media','Episode is not a direct media URL');
  const headers=episode.headers||{};
  if(/\.m3u8(?:[?#]|$)/i.test(episode.url)){
    let response=await http.request(episode.url,{headers,maxResponseBytes:1048576});let depth=0;
    while(true){
      const text=response.text.trimStart();if(!text.startsWith('#EXTM3U'))throw new AdapterError('invalid-hls','Media URL returned a non-HLS response');
      if(/#EXT-X-KEY:[^\r\n]*(?:METHOD=SAMPLE-AES|KEYFORMAT="(?!identity))/.test(text))throw new AdapterError('drm-required','This stream requires a supported licensed DRM player');
      const lines=text.split(/\r?\n/).map(x=>x.trim());const index=lines.findIndex(x=>x.startsWith('#EXT-X-STREAM-INF'));
      if(index>=0){if(depth++>=3)throw new AdapterError('hls-depth','HLS variants nest too deeply');const child=lines.slice(index+1).find(x=>x&&!x.startsWith('#'));response=await http.request(publicUrl(child,response.finalUrl),{headers,maxResponseBytes:1048576});continue;}
      const segment=lines.find(x=>x&&!x.startsWith('#'));if(!segment)throw new AdapterError('empty-hls','HLS has no media segments');
      const sample=await http.request(publicUrl(segment,response.finalUrl),{headers,rangeBytes:65536});
      const html=/^\s*<(?:!doctype|html|\?xml)/i.test(sample.bytes.subarray(0,200).toString('utf8'));
      if(html||sample.bytes.length<32)throw new AdapterError('invalid-segment','The media segment is HTML or empty');
      const transportSync=[0,1,188,376].some(i=>sample.bytes[i]===0x47),fragmented=/ftyp|styp|moof|mdat/.test(sample.bytes.subarray(0,64).toString('latin1'));
      return {status:'ok',kind:'hls',manifest:true,segmentBytes:sample.bytes.length,segmentStatus:sample.status,transportSync,fragmentedMp4:fragmented,encrypted:/#EXT-X-KEY:METHOD=AES-128/.test(text),cors:response.headers.get('access-control-allow-origin'),host:new URL(episode.url).hostname};
    }
  }
  const response=await http.request(episode.url,{headers,rangeBytes:65536});
  if(response.bytes.length<32||/^\s*</.test(response.bytes.subarray(0,64).toString('utf8')))throw new AdapterError('invalid-media','Direct media URL returned HTML or no media bytes');
  return {status:'ok',kind:'direct',bytes:response.bytes.length,cors:response.headers.get('access-control-allow-origin'),host:new URL(episode.url).hostname};
}
