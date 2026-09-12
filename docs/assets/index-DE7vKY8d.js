(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const i of a)if(i.type==="childList")for(const d of i.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&s(d)}).observe(document,{childList:!0,subtree:!0});function r(a){const i={};return a.integrity&&(i.integrity=a.integrity),a.referrerPolicy&&(i.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?i.credentials="include":a.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(a){if(a.ep)return;a.ep=!0;const i=r(a);fetch(a.href,i)}})();const z="modulepreload",N=function(e){return"/"+e},k={},V=function(t,r,s){let a=Promise.resolve();if(r&&r.length>0){let f=function(p){return Promise.all(p.map(h=>Promise.resolve(h).then(m=>({status:"fulfilled",value:m}),m=>({status:"rejected",reason:m}))))};var d=f;document.getElementsByTagName("link");const u=document.querySelector("meta[property=csp-nonce]"),c=u?.nonce||u?.getAttribute("nonce");a=f(r.map(p=>{if(p=N(p),p in k)return;k[p]=!0;const h=p.endsWith(".css"),m=h?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${p}"]${m}`))return;const y=document.createElement("link");if(y.rel=h?"stylesheet":z,h||(y.as="script"),y.crossOrigin="",y.href=p,c&&y.setAttribute("nonce",c),document.head.appendChild(y),h)return new Promise((P,j)=>{y.addEventListener("load",P),y.addEventListener("error",()=>j(new Error(`Unable to preload CSS for ${p}`)))})}))}function i(u){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=u,window.dispatchEvent(c),!c.defaultPrevented)throw u}return a.then(u=>{for(const c of u||[])c.status==="rejected"&&i(c.reason);return t().catch(i)})};const C=(e,t,r=[])=>{const s=document.createElementNS("http://www.w3.org/2000/svg",e);return Object.keys(t).forEach(a=>{s.setAttribute(a,String(t[a]))}),r.length&&r.forEach(a=>{const i=C(...a);s.appendChild(i)}),s};var I=([e,t,r])=>C(e,t,r);const H=e=>Array.from(e.attributes).reduce((t,r)=>(t[r.name]=r.value,t),{}),U=e=>typeof e=="string"?e:!e||!e.class?"":e.class&&typeof e.class=="string"?e.class.split(" "):e.class&&Array.isArray(e.class)?e.class:"",_=e=>e.flatMap(U).map(r=>r.trim()).filter(Boolean).filter((r,s,a)=>a.indexOf(r)===s).join(" "),R=e=>e.replace(/(\w)(\w*)(_|-|\s*)/g,(t,r,s)=>r.toUpperCase()+s.toLowerCase()),L=(e,{nameAttr:t,icons:r,attrs:s})=>{const a=e.getAttribute(t);if(a==null)return;const i=R(a),d=r[i];if(!d)return console.warn(`${e.outerHTML} icon name was not found in the provided icons object.`);const u=H(e),[c,f,p]=d,h={...f,"data-lucide":a,...s,...u},m=_(["lucide",`lucide-${a}`,u,s]);m&&Object.assign(h,{class:m});const y=I([c,h,p]);return e.parentNode?.replaceChild(y,e)};const l={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};const D=["svg",l,[["path",{d:"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"}],["path",{d:"m6.2 5.3 3.1 3.9"}],["path",{d:"m12.4 3.4 3.1 4"}],["path",{d:"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"}]]];const K=["svg",l,[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3"}],["path",{d:"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{d:"M3 12A9 3 0 0 0 21 12"}]]];const G=["svg",l,[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{points:"7 10 12 15 17 10"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3"}]]];const W=["svg",l,[["path",{d:"M15 3h6v6"}],["path",{d:"M10 14 21 3"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]]];const B=["svg",l,[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]]];const J=["svg",l,[["polyline",{points:"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]]];const X=["svg",l,[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1"}],["rect",{width:"7",height:"7",x:"14",y:"3",rx:"1"}],["rect",{width:"7",height:"7",x:"14",y:"14",rx:"1"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1"}]]];const F=["svg",l,[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4"}]]];const Z=["svg",l,[["polygon",{points:"6 3 20 12 6 21 6 3"}]]];const Q=["svg",l,[["path",{d:"M5 16v2"}],["path",{d:"M19 16v2"}],["rect",{width:"20",height:"8",x:"2",y:"8",rx:"2"}],["path",{d:"M18 12h.01"}]]];const Y=["svg",l,[["path",{d:"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"}],["path",{d:"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"}],["circle",{cx:"12",cy:"12",r:"2"}],["path",{d:"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"}],["path",{d:"M19.1 4.9C23 8.8 23 15.1 19.1 19"}]]];const ee=["svg",l,[["circle",{cx:"11",cy:"11",r:"8"}],["path",{d:"m21 21-4.3-4.3"}]]];const te=["svg",l,[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18"}]]];const ae=["svg",l,[["path",{d:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"}],["circle",{cx:"12",cy:"12",r:"3"}]]];const ne=["svg",l,[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{d:"M12 8v4"}],["path",{d:"M12 16h.01"}]]];const re=["svg",l,[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{d:"m9 12 2 2 4-4"}]]];const se=["svg",l,[["line",{x1:"21",x2:"14",y1:"4",y2:"4"}],["line",{x1:"10",x2:"3",y1:"4",y2:"4"}],["line",{x1:"21",x2:"12",y1:"12",y2:"12"}],["line",{x1:"8",x2:"3",y1:"12",y2:"12"}],["line",{x1:"21",x2:"16",y1:"20",y2:"20"}],["line",{x1:"12",x2:"3",y1:"20",y2:"20"}],["line",{x1:"14",x2:"14",y1:"2",y2:"6"}],["line",{x1:"8",x2:"8",y1:"10",y2:"14"}],["line",{x1:"16",x2:"16",y1:"18",y2:"22"}]]];const ie=["svg",l,[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2"}],["path",{d:"M12 18h.01"}]]];const oe=["svg",l,[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]]];const le=["svg",l,[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{points:"17 8 12 3 7 8"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15"}]]];const ce=["svg",l,[["path",{d:"M18 6 6 18"}],["path",{d:"m6 6 12 12"}]]];const de=({icons:e={},nameAttr:t="data-lucide",attrs:r={}}={})=>{if(!Object.values(e).length)throw new Error(`Please provide an icons object.
If you want to use all the icons you can import it like:
 \`import { createIcons, icons } from 'lucide';
lucide.createIcons({icons});\``);if(typeof document>"u")throw new Error("`createIcons()` only works in a browser environment.");const s=document.querySelectorAll(`[${t}]`);if(Array.from(s).forEach(a=>L(a,{nameAttr:t,icons:e,attrs:r})),t==="data-lucide"){const a=document.querySelectorAll("[icon-name]");a.length>0&&(console.warn("[Lucide] Some icons were found with the now deprecated icon-name attribute. These will still be replaced for backwards compatibility, but will no longer be supported in v1.0 and you should switch to data-lucide"),Array.from(a).forEach(i=>L(i,{nameAttr:"icon-name",icons:e,attrs:r})))}},ue=[{id:"home",label:"首頁",icon:"home"},{id:"vod",label:"點播",icon:"clapperboard"},{id:"live",label:"直播",icon:"radio"},{id:"sources",label:"來源",icon:"server"},{id:"settings",label:"設定",icon:"settings"}],pe={Clapperboard:D,Database:K,Download:G,ExternalLink:W,Home:B,Inbox:J,LayoutGrid:X,Lock:F,Play:Z,Radio:Y,RadioReceiver:Q,Search:ee,Server:te,Settings:ae,ShieldAlert:ne,ShieldCheck:re,SlidersHorizontal:se,Smartphone:ie,Star:oe,Upload:le,X:ce},S=[{id:"orbit-echo",title:"軌道回聲",category:"電影",year:"2026",rating:"8.6",duration:"12m",tag:"授權示範",streamUrl:"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",tone:"cyan",summary:"高對比科幻短片版位，作為 HLS 播放測試內容。"},{id:"city-loop",title:"城市夜巡",category:"劇集",year:"2025",rating:"8.2",duration:"24m",tag:"自製樣片",streamUrl:"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",tone:"violet",summary:"深夜城市與科技介面的示範劇集卡片。"},{id:"signal-room",title:"信號室",category:"紀錄",year:"2026",rating:"8.9",duration:"18m",tag:"公共素材",streamUrl:"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",tone:"green",summary:"面向直播與信號監控場景的視覺占位內容。"},{id:"frame-zero",title:"第零幀",category:"動漫",year:"2024",rating:"8.0",duration:"10m",tag:"授權示範",streamUrl:"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",tone:"amber",summary:"動漫分類的海報格示範，不使用第三方角色素材。"}],E={generatedAt:null,vod:{count:0,typeCounts:{}},live:{count:0,playableCount:0,externalCount:0,networkOnlyCount:0,groups:[]},notes:[]},M=document.querySelector("#app");if(!M)throw new Error("App root is missing.");const ve=M,n={activeTab:"home",query:"",selectedVodType:"all",selectedLiveGroup:"all",selectedLiveKind:"all",vodSources:[],liveChannels:[],summary:E,favorites:new Set(ye("favorites")),playerTitle:"",playerSubtitle:"",playerUrl:"",playerOpen:!1};let g=null;function ye(e){try{const t=localStorage.getItem(`yingshi:${e}`),r=t?JSON.parse(t):[];return Array.isArray(r)?r.map(String):[]}catch{return[]}}function he(e,t){localStorage.setItem(`yingshi:${e}`,JSON.stringify(t))}function o(e){return String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}function T(e){return[...e.replace(/\s+/g,"")].slice(0,2).join("")||"影視"}async function x(e,t){try{const r=await fetch(e,{cache:"no-store"});return r.ok?await r.json():t}catch{return t}}async function me(){const[e,t,r]=await Promise.all([x("/data/vod-sources.json",[]),x("/data/live-channels.json",[]),x("/data/source-summary.json",E)]);n.vodSources=e,n.liveChannels=t,n.summary=r,v(),"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(()=>{})}function v(){ve.innerHTML=`
    <div class="app-shell">
      ${ge()}
      <main class="screen">${fe()}</main>
      ${Ce()}
      ${Ee()}
    </div>
  `,Me(),de({icons:pe}),n.playerOpen&&n.playerUrl&&Oe(n.playerUrl)}function ge(){return`
    <header class="topbar">
      <div class="brand">
        <img class="brand-icon" src="/assets/icon.png" alt="影視" />
        <div>
          <strong>影視</strong>
          <span>VOD · IPTV · 本地配置</span>
        </div>
      </div>
      <div class="topbar-actions">
        <button class="icon-btn" type="button" data-action="focus-search" aria-label="搜尋">
          <i data-lucide="search"></i>
        </button>
        <button class="icon-btn" type="button" data-tab="settings" aria-label="設定">
          <i data-lucide="settings"></i>
        </button>
      </div>
    </header>
  `}function fe(){return n.activeTab==="vod"?we():n.activeTab==="live"?$e():n.activeTab==="sources"?xe():n.activeTab==="settings"?Se():be()}function be(){const e=n.liveChannels.filter(r=>r.playable).length,t=n.summary.vod.reviewRequiredCount??n.vodSources.length;return`
    <section class="hero">
      <div class="hero-media"></div>
      <div class="hero-content">
        <div class="hero-kicker">影視</div>
        <h1>深色系跨平台播放器</h1>
        <p>點播、直播、來源管理與播放器已整合為同一套 Android/iOS 原型。</p>
        <div class="hero-actions">
          <button class="primary-btn" type="button" data-tab="vod">
            <i data-lucide="play"></i>
            開始播放
          </button>
          <button class="secondary-btn" type="button" data-tab="sources">
            <i data-lucide="server"></i>
            來源中心
          </button>
        </div>
      </div>
    </section>

    <section class="stats-grid" aria-label="來源狀態">
      ${b("點播來源",n.summary.vod.count,"clapperboard","待授權審核")}
      ${b("直播頻道",n.summary.live.count,"radio",`${e} 可直連`)}
      ${b("外部直播",n.summary.live.externalCount,"external-link","YouTube 類")}
      ${b("待審核",t,"shield-alert","預設關閉")}
    </section>

    <section class="section-head">
      <div>
        <span>推薦</span>
        <h2>示範片庫</h2>
      </div>
      <button class="text-btn" type="button" data-tab="vod">全部</button>
    </section>

    <div class="content-rail">
      ${S.map(q).join("")}
    </div>

    <section class="section-head">
      <div>
        <span>影片分析</span>
        <h2>介面結構</h2>
      </div>
    </section>
    <div class="analysis-list">
      <article>
        <i data-lucide="layout-grid"></i>
        <strong>分類膠囊 + 海報網格</strong>
        <span>保留快速切換與密集瀏覽能力，改為更克制的深色視覺。</span>
      </article>
      <article>
        <i data-lucide="sliders-horizontal"></i>
        <strong>篩選浮層</strong>
        <span>年份、地區、類型以底部面板呈現，適合單手操作。</span>
      </article>
      <article>
        <i data-lucide="radio-receiver"></i>
        <strong>線路狀態</strong>
        <span>解析、爬蟲、直播源都先進入審核狀態，避免誤播未授權內容。</span>
      </article>
    </div>
  `}function we(){const e=["all",...new Set(n.vodSources.map(a=>a.typeLabel))],t=n.query.trim().toLowerCase(),r=n.vodSources.filter(a=>n.selectedVodType==="all"||a.typeLabel===n.selectedVodType).filter(a=>t?`${a.name} ${a.key} ${a.categories.join(" ")}`.toLowerCase().includes(t):!0),s=S.filter(a=>t?`${a.title} ${a.category} ${a.tag}`.toLowerCase().includes(t):!0);return`
    ${O("搜尋片名、分類、來源")}
    <div class="chip-row">
      ${e.map(a=>`
            <button class="chip ${n.selectedVodType===a?"is-active":""}" type="button" data-vod-type="${o(a)}">
              ${o(a==="all"?"全部":a)}
            </button>
          `).join("")}
    </div>

    <section class="section-head">
      <div>
        <span>點播</span>
        <h2>授權示範內容</h2>
      </div>
    </section>
    <div class="poster-grid">
      ${s.map(q).join("")||w("沒有符合的示範內容")}
    </div>

    <section class="section-head compact">
      <div>
        <span>來源</span>
        <h2>本地 VOD 配置</h2>
      </div>
      <button class="icon-text-btn" type="button" data-action="open-source-file">
        <i data-lucide="upload"></i>
        匯入
      </button>
    </section>
    <div class="source-list">
      ${r.slice(0,80).map(ke).join("")||w("尚未匯入來源")}
    </div>
  `}function $e(){const e=["all",...n.summary.live.groups],t=["all","hls","stream","external","network"],r=n.query.trim().toLowerCase(),s=n.liveChannels.filter(a=>n.selectedLiveGroup==="all"||a.group===n.selectedLiveGroup).filter(a=>n.selectedLiveKind==="all"||a.kind===n.selectedLiveKind).filter(a=>r?`${a.name} ${a.group} ${a.kind}`.toLowerCase().includes(r):!0);return`
    ${O("搜尋頻道、分組、協議")}
    <div class="segmented-row">
      ${t.map(a=>`
            <button class="segment ${n.selectedLiveKind===a?"is-active":""}" type="button" data-live-kind="${a}">
              ${$(a)}
            </button>
          `).join("")}
    </div>
    <div class="chip-row horizontal">
      ${e.map(a=>`
            <button class="chip ${n.selectedLiveGroup===a?"is-active":""}" type="button" data-live-group="${o(a)}">
              ${o(a==="all"?"全部分組":a)}
            </button>
          `).join("")}
    </div>

    <section class="channel-list">
      ${s.slice(0,160).map(Le).join("")||w("沒有符合的直播頻道")}
    </section>
  `}function xe(){return`
    <section class="source-console">
      <div>
        <span class="eyebrow">Source Console</span>
        <h2>來源中心</h2>
        <p>本機配置已轉成摘要資料，未授權接口預設不啟用。</p>
      </div>
      <button class="primary-btn" type="button" data-action="open-source-file">
        <i data-lucide="upload"></i>
        匯入配置
      </button>
    </section>

    <div class="source-panels">
      <article class="panel">
        <div class="panel-title">
          <i data-lucide="clapperboard"></i>
          <span>VOD 類型</span>
        </div>
        ${Object.entries(n.summary.vod.typeCounts).map(([t,r])=>`
        <div class="type-row">
          <span>${o(t)}</span>
          <strong>${r}</strong>
        </div>
      `).join("")||w("沒有 VOD 統計")}
      </article>
      <article class="panel">
        <div class="panel-title">
          <i data-lucide="radio"></i>
          <span>IPTV 協議</span>
        </div>
        ${Ae()}
      </article>
    </div>

    <article class="compliance-panel">
      <div>
        <i data-lucide="shield-check"></i>
      </div>
      <div>
        <strong>正式版上架規則</strong>
        <p>只接入自有、授權、公開合法或已取得轉播權的內容；第三方解析、VIP 破解、站點爬蟲與未授權配置不進入預設播放。</p>
      </div>
    </article>

    <input class="hidden-file" id="source-file" type="file" accept=".json,.m3u,.m3u8,.txt,application/json" />
  `}function Se(){const e=n.summary.generatedAt?new Date(n.summary.generatedAt).toLocaleString("zh-Hant"):"尚未產生";return`
    <section class="settings-stack">
      <article class="settings-card">
        <div class="settings-card-head">
          <i data-lucide="smartphone"></i>
          <div>
            <strong>跨平台建置</strong>
            <span>Capacitor Android / iOS</span>
          </div>
        </div>
        <div class="settings-row">
          <span>Android APK</span>
          <strong>需 Android SDK</strong>
        </div>
        <div class="settings-row">
          <span>iOS IPA</span>
          <strong>需 macOS + Xcode</strong>
        </div>
      </article>

      <article class="settings-card">
        <div class="settings-card-head">
          <i data-lucide="database"></i>
          <div>
            <strong>資料快照</strong>
            <span>${o(e)}</span>
          </div>
        </div>
        <div class="settings-row">
          <span>VOD</span>
          <strong>${n.summary.vod.count}</strong>
        </div>
        <div class="settings-row">
          <span>IPTV</span>
          <strong>${n.summary.live.count}</strong>
        </div>
      </article>

      <article class="settings-card">
        <div class="settings-card-head">
          <i data-lucide="download"></i>
          <div>
            <strong>文件</strong>
            <span>零基礎修改教學已放在 docs 目錄</span>
          </div>
        </div>
        <a class="wide-link" href="/docs/zero-basic-guide.html" target="_blank" rel="noreferrer">
          開啟網頁教學
          <i data-lucide="external-link"></i>
        </a>
      </article>
    </section>
  `}function b(e,t,r,s){return`
    <article class="stat-card">
      <i data-lucide="${r}"></i>
      <strong>${t}</strong>
      <span>${o(e)}</span>
      <small>${o(s)}</small>
    </article>
  `}function O(e){return`
    <label class="search-box">
      <i data-lucide="search"></i>
      <input id="global-search" value="${o(n.query)}" placeholder="${o(e)}" autocomplete="off" />
      ${n.query?'<button class="icon-btn small" type="button" data-action="clear-search" aria-label="清除"><i data-lucide="x"></i></button>':""}
    </label>
  `}function q(e){const t=n.favorites.has(e.id);return`
    <article class="poster-card">
      <button class="poster-button" type="button" data-play-demo="${e.id}">
        <div class="poster-art ${e.tone}">
          <span>${o(T(e.title))}</span>
        </div>
        <div class="poster-meta">
          <strong>${o(e.title)}</strong>
          <span>${o(e.category)} · ${o(e.year)} · ${o(e.rating)}</span>
        </div>
      </button>
      <div class="poster-actions">
        <span>${o(e.tag)}</span>
        <button class="icon-btn tiny ${t?"is-on":""}" type="button" data-favorite="${e.id}" aria-label="收藏">
          <i data-lucide="star"></i>
        </button>
      </div>
    </article>
  `}function ke(e){const t=e.categories.slice(0,4).map(r=>`<span>${o(r)}</span>`).join("");return`
    <article class="source-row">
      <div class="source-main">
        <div class="source-icon">${o(e.typeLabel.slice(0,2))}</div>
        <div>
          <strong>${o(e.name)}</strong>
          <span>${o(e.typeLabel)} · ${e.searchable?"可搜尋":"不可搜尋"} · ${e.quickSearch?"快搜":"標準"}</span>
        </div>
      </div>
      <div class="category-strip">${t||"<span>未分類</span>"}</div>
      <div class="source-status">
        <span class="status-badge">需授權</span>
        <small>${o(e.endpointHost||e.origin)}</small>
      </div>
    </article>
  `}function Le(e){const t=e.kind==="external"?"external-link":e.playable?"play":"lock",r=e.kind==="external"?"外部":e.playable?"播放":"不可播";return`
    <article class="channel-row">
      <button class="channel-main" type="button" data-live-channel="${e.id}" ${e.playable||e.kind==="external"?"":"disabled"}>
        <div class="channel-avatar">${o(T(e.name))}</div>
        <div>
          <strong>${o(e.name)}</strong>
          <span>${o(e.group)} · ${$(e.kind)}</span>
        </div>
      </button>
      <button class="icon-text-btn ${e.playable||e.kind==="external"?"":"is-disabled"}" type="button" data-live-channel="${e.id}" ${e.playable||e.kind==="external"?"":"disabled"}>
        <i data-lucide="${t}"></i>
        ${r}
      </button>
    </article>
  `}function Ae(){const e=n.liveChannels.reduce((t,r)=>(t[r.kind]=(t[r.kind]||0)+1,t),{});return["hls","stream","external","network","unknown"].map(t=>`
        <div class="type-row">
          <span>${$(t)}</span>
          <strong>${e[t]||0}</strong>
        </div>
      `).join("")}function Ce(){return`
    <nav class="bottom-tabs" aria-label="主分頁">
      ${ue.map(e=>`
            <button class="${n.activeTab===e.id?"is-active":""}" type="button" data-tab="${e.id}">
              <i data-lucide="${e.icon}"></i>
              <span>${e.label}</span>
            </button>
          `).join("")}
    </nav>
  `}function Ee(){return`
    <div class="player-sheet ${n.playerOpen?"is-open":""}" aria-hidden="${n.playerOpen?"false":"true"}">
      <div class="player-backdrop" data-action="close-player"></div>
      <section class="player-panel">
        <div class="player-head">
          <div>
            <span>${o(n.playerSubtitle||"播放器")}</span>
            <strong>${o(n.playerTitle||"影視")}</strong>
          </div>
          <button class="icon-btn" type="button" data-action="close-player" aria-label="關閉">
            <i data-lucide="x"></i>
          </button>
        </div>
        <video id="video-player" class="video-player" controls playsinline poster="/assets/hero-cinema.png"></video>
        <div class="player-line">
          <span>HLS / MP4</span>
          <span>自動播放需瀏覽器允許</span>
        </div>
      </section>
    </div>
  `}function w(e){return`
    <div class="empty-state">
      <i data-lucide="inbox"></i>
      <span>${o(e)}</span>
    </div>
  `}function $(e){return{all:"全部",hls:"M3U8",stream:"HTTP",external:"外部",network:"內網",unknown:"未知"}[e]||e.toUpperCase()}function Me(){document.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{const t=e.dataset.tab;t&&(n.activeTab=t,v())})}),document.querySelectorAll("[data-play-demo]").forEach(e=>{e.addEventListener("click",()=>{const t=S.find(r=>r.id===e.dataset.playDemo);t&&A(t.title,`${t.category} · ${t.duration}`,t.streamUrl)})}),document.querySelectorAll("[data-favorite]").forEach(e=>{e.addEventListener("click",t=>{t.stopPropagation();const r=e.dataset.favorite;r&&(n.favorites.has(r)?n.favorites.delete(r):n.favorites.add(r),he("favorites",[...n.favorites]),v())})}),document.querySelectorAll("[data-vod-type]").forEach(e=>{e.addEventListener("click",()=>{n.selectedVodType=e.dataset.vodType||"all",v()})}),document.querySelectorAll("[data-live-group]").forEach(e=>{e.addEventListener("click",()=>{n.selectedLiveGroup=e.dataset.liveGroup||"all",v()})}),document.querySelectorAll("[data-live-kind]").forEach(e=>{e.addEventListener("click",()=>{n.selectedLiveKind=e.dataset.liveKind||"all",v()})}),document.querySelectorAll("[data-live-channel]").forEach(e=>{e.addEventListener("click",()=>{const t=n.liveChannels.find(r=>r.id===e.dataset.liveChannel);if(t){if(t.kind==="external"){window.open(t.url,"_blank","noopener,noreferrer");return}t.playable&&A(t.name,`${t.group} · ${$(t.kind)}`,t.url)}})}),document.querySelectorAll("[data-action]").forEach(e=>{e.addEventListener("click",()=>{const t=e.dataset.action;t==="focus-search"&&(n.activeTab=n.activeTab==="home"?"vod":n.activeTab,v(),window.setTimeout(()=>document.querySelector("#global-search")?.focus(),30)),t==="clear-search"&&(n.query="",v()),t==="close-player"&&Te(),t==="open-source-file"&&document.querySelector("#source-file")?.click()})}),document.querySelector("#global-search")?.addEventListener("input",e=>{n.query=e.target.value,v(),window.setTimeout(()=>{const t=document.querySelector("#global-search");t?.focus(),t?.setSelectionRange(n.query.length,n.query.length)},0)}),document.querySelector("#source-file")?.addEventListener("change",qe)}function A(e,t,r){n.playerTitle=e,n.playerSubtitle=t,n.playerUrl=r,n.playerOpen=!0,v()}function Te(){g?.destroy(),g=null;const e=document.querySelector("#video-player");e&&(e.pause(),e.removeAttribute("src"),e.load()),n.playerOpen=!1,n.playerUrl="",v()}async function Oe(e){const t=document.querySelector("#video-player");if(t){if(g?.destroy(),g=null,e.toLowerCase().includes(".m3u8")){const r=(await V(async()=>{const{default:s}=await import("./hls-D1fSjlvU.js");return{default:s}},[])).default;if(!r.isSupported()&&t.canPlayType("application/vnd.apple.mpegurl")){t.src=e,t.play().catch(()=>{});return}g=new r({lowLatencyMode:!0,enableWorker:!0}),g.loadSource(e),g.attachMedia(t)}else t.src=e;t.play().catch(()=>{})}}async function qe(e){const t=e.target.files?.[0];if(!t)return;const r=await t.text();if(t.name.toLowerCase().endsWith(".json")){const s=Pe(r,t.name);n.vodSources=s,n.summary={...n.summary,generatedAt:new Date().toISOString(),vod:{count:s.length,typeCounts:s.reduce((a,i)=>(a[i.typeLabel]=(a[i.typeLabel]||0)+1,a),{}),reviewRequiredCount:s.length}}}else{const s=je(r,t.name);n.liveChannels=s,n.summary={...n.summary,generatedAt:new Date().toISOString(),live:{count:s.length,playableCount:s.filter(a=>a.playable).length,externalCount:s.filter(a=>a.kind==="external").length,networkOnlyCount:s.filter(a=>a.kind==="network").length,groups:[...new Set(s.map(a=>a.group))].sort((a,i)=>a.localeCompare(i))}}}n.activeTab="sources",v()}function Pe(e,t){const r=JSON.parse(e),s={0:"CMS XML/API",1:"CMS JSON/API",2:"解析接口",3:"站點/爬蟲"};return(r.sites||[]).map((a,i)=>{const d=Number(a.type??-1),u=Array.isArray(a.categories)?a.categories.map(String).filter(Boolean):[],c=String(a.api||"");return{id:`${String(a.key||a.name||"source").replace(/[^\p{Letter}\p{Number}]+/gu,"-")}-${i+1}`,key:String(a.key||""),name:String(a.name||a.key||`來源 ${i+1}`),type:d,typeLabel:s[d]||"未知",mode:d===3?"spider":d===2?"parse":"api",searchable:Number(a.searchable||0)===1,quickSearch:Number(a.quickSearch||0)===1,categories:u,endpointHost:Ve(c),enabled:!1,status:"review_required",reviewNote:"需要確認授權後才可啟用。",origin:t}})}function je(e,t){const r=e.split(/\r?\n/).map(i=>i.trim()),s=[];let a=null;for(const i of r){if(!i||i==="#EXTM3U")continue;if(i.startsWith("#EXTINF")){const c=i.lastIndexOf(","),f=c>=0?i.slice(0,c):i,p=ze(f);a={name:c>=0?i.slice(c+1).trim():`頻道 ${s.length+1}`,group:p["group-title"]||"未分類",logo:p["tvg-logo"]||""};continue}if(i.startsWith("#"))continue;const d=a||{name:`頻道 ${s.length+1}`,group:"未分類",logo:""},u=Ne(i);s.push({id:`${d.name.replace(/[^\p{Letter}\p{Number}]+/gu,"-")}-${s.length+1}`,name:d.name,group:d.group||"未分類",url:i,logo:d.logo,kind:u.kind,playable:u.playable,origin:t}),a=null}return s}function ze(e){const t={},r=/([A-Za-z0-9_-]+)="([^"]*)"/g;let s;for(;s=r.exec(e);)t[s[1]]=s[2];return t}function Ne(e){const t=e.toLowerCase();return/youtube\.com|youtu\.be/.test(t)?{kind:"external",playable:!1}:t.includes(".m3u8")?{kind:"hls",playable:!0}:/^(udp|rtp|rtsp):/i.test(e)?{kind:"network",playable:!1}:/^https?:\/\//i.test(e)?{kind:"stream",playable:!0}:{kind:"unknown",playable:!1}}function Ve(e){try{return new URL(e).host}catch{return""}}me();
//# sourceMappingURL=index-DE7vKY8d.js.map
