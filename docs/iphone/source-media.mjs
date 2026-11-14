export function needsSourceMedia(value) {
  try { const u=new URL(value);return u.protocol==='http:'&&u.hostname==='ccc.oiio.fun'&&!u.username&&!u.password&&(!u.port||u.port==='80')&&!u.hash; } catch { return false; }
}
export function sourcePlaybackUrl(value,base) {
  const raw=String(value||'').trim();if(!raw)return '';
  try{const url=new URL(raw,base);if(needsSourceMedia(url.href))return url.href;if(url.protocol==='http:')url.protocol='https:';if(url.protocol!=='https:')return '';url.username='';url.password='';return url.href;}catch{return '';}
}
export function createSourceMediaResolver({bridge=globalThis.window?.CarBridge,events=globalThis.window,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let serial=0;
  return {
    supported:()=>typeof bridge?.resolveSourceMedia==='function',
    open(value) {
      const requestId=`source_${Date.now().toString(36)}_${++serial}`;let finish,timer,closed=false;
      const close=()=>{if(closed)return;closed=true;clearTimer(timer);events.removeEventListener('yingshi-source-media',receive);try{bridge?.cancelSourceMedia?.(requestId);}catch{}};
      const receive=event=>{const result=event.detail;if(closed||result?.requestId!==requestId)return;clearTimer(timer);events.removeEventListener('yingshi-source-media',receive);
        if(!result.ok){finish.reject(new Error(result.message||'此播放線目前無法連線。'));return;}
        try{const u=new URL(result.url);if(result.backend!=='source-media'||u.origin!=='https://sylong7708.github.io'||!/^\/TV\/__source_media__\/[a-f0-9-]{36}\/video\.mp4$/.test(u.pathname)||u.search||u.hash)throw new Error();finish.resolve({url:u.href,backend:'source-media'});}catch{finish.reject(new Error('播放連線驗證失敗。'));}
      };
      const promise=new Promise((resolve,reject)=>{finish={resolve,reject};if(!needsSourceMedia(value)){reject(new Error('播放網址無效。'));return;}if(typeof bridge?.resolveSourceMedia!=='function'){reject(new Error('此播放線需要影視 Android 1.4.32 以上，正在檢查其他訊號。'));return;}
        events.addEventListener('yingshi-source-media',receive);timer=setTimer(()=>{close();reject(new Error('播放連線準備逾時。'));},15000);
        try{bridge.resolveSourceMedia(value,requestId);}catch{close();reject(new Error('播放連線尚未就緒。'));}
      });
      return {promise,close};
    },
  };
}
