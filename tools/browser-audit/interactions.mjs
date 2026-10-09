import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const args=new Map(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]?.startsWith('--')?'true':a[i+1]||'true']:null).filter(Boolean));
const root=path.resolve(args.get('codeRoot')||path.join(import.meta.dirname,'../..'));
const out=path.resolve(args.get('output')||'interaction-audit'),device=args.has('device');
await fs.mkdir(out,{recursive:true});
const run=promisify(execFile),adb=process.env.ADB_PATH||'C:/Users/Long/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const command=async list=>(await run(adb,['-d',...list],{windowsHide:true,timeout:30000,maxBuffer:12*1024*1024})).stdout.trim();
if(device) assert.match(await command(['shell','getprop','ro.product.model']),/7870/);
const browser=device?await chromium.connectOverCDP('http://127.0.0.1:9224'):await chromium.launch({headless:true,channel:process.env.OKTV_CHROME_CHANNEL||undefined,args:['--autoplay-policy=no-user-gesture-required']});
const context=device?browser.contexts()[0]:await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
if(!device) await context.route('https://sylong7708.github.io/TV/docs/iphone/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1)||'index.html';
  if(!/\.(html|css|mjs)$/.test(name)) return route.continue();
  try{await route.fulfill({body:await fs.readFile(path.join(root,'docs/iphone',name)),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/javascript'});}catch{await route.continue();}
});
const page=device?context.pages().find(p=>p.url().includes('/TV/docs/iphone/')):await context.newPage();
page.setDefaultTimeout(12000);
const report={at:new Date().toISOString(),platform:device?'UIS7870 real touch/keys':'Chrome browser real interactions',checks:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
async function screenshot(name){
  if(device){const {stdout}=await run(adb,['-d','exec-out','screencap','-p'],{encoding:'buffer',windowsHide:true,maxBuffer:12*1024*1024});await fs.writeFile(path.join(out,`${name}.png`),stdout);}
  else await page.screenshot({path:path.join(out,`${name}.png`)});
}
async function check(name,action){
  const start=Date.now();
  try{const detail=await action();report.checks.push({name,passed:true,ms:Date.now()-start,detail});}
  catch(error){report.checks.push({name,passed:false,ms:Date.now()-start,error:error.message});await screenshot(`failed-${name}`).catch(()=>{});}
  console.log(`${report.checks.at(-1).passed?'PASS':'FAIL'} ${name}${report.checks.at(-1).error?': '+report.checks.at(-1).error.slice(0,300):''}`);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
async function tap(selector){
  const locator=typeof selector==='string'?page.locator(selector).first():selector;
  await locator.scrollIntoViewIfNeeded();
  if(!device) return locator.click();
  const b=await locator.boundingBox(),dpr=await page.evaluate(()=>devicePixelRatio); assert.ok(b,'missing tap target');
  await command(['shell','input','tap',String(Math.round((b.x+b.width/2)*dpr)),String(Math.round((b.y+b.height/2)*dpr))]);
}
const back=()=>device?command(['shell','input','keyevent','4']):page.keyboard.press('Escape');
const voice=async (action,query='')=>device?command(['shell','am','start','-n','tw.com.sylong.tvcar/.MainActivity','-a','tw.com.sylong.tvcar.action.VOICE_COMMAND','--es','tw.com.sylong.tvcar.extra.VOICE_COMMAND',action,...(query?['--es','tw.com.sylong.tvcar.extra.VOICE_QUERY','"'+query.replaceAll('"','')+'"']:[])]):page.evaluate(([a,q])=>window.YingshiVoice.execute(a,q),[action,query]);
const expanded=()=>page.evaluate(()=>window.YingshiPlayerPresentation.active());
const waitExpanded=value=>page.waitForFunction(value=>window.YingshiPlayerPresentation.active()===value,value);
const playerInfo=()=>page.locator('#player').evaluate(v=>({time:v.currentTime,paused:v.paused,width:v.videoWidth,height:v.videoHeight,frames:v.webkitDecodedFrameCount||0,audioBytes:v.webkitAudioDecodedByteCount||0}));
async function playing(){await page.waitForFunction(()=>{const v=document.querySelector('#player');return v.currentTime>.2&&!v.paused&&v.videoWidth>0},undefined,{timeout:45000});const a=await playerInfo();await page.waitForTimeout(650);const b=await playerInfo();assert.ok(b.frames>a.frames&&b.time>a.time,'decoded video did not advance');return b;}
async function openMovie(){
  await voice('HOME'); await page.waitForFunction(()=>!document.querySelector('.sheet.is-open'));
  await page.evaluate(()=>window.YingshiVoice.execute('SEARCH','Big Buck Bunny'));
  await tap('#screen [data-open-detail]'); await tap('#detailBody [data-episode]');return playing();
}
async function headerVisible(){
  const details=await page.locator('#playerSheet .player-window-button').evaluateAll(nodes=>nodes.map(n=>{
    const b=n.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
    return {text:n.textContent,x:b.x,y:b.y,w:b.width,h:b.height,within:b.x>=0&&b.y>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,hit:n===hit||n.contains(hit)};
  }));
  assert.equal(details.length,2);assert.ok(details.every(x=>x.within&&x.hit&&x.w>=44&&x.h>=44),'header exit controls clipped or covered: '+JSON.stringify(details));return details;
}
async function gridCheck(){
  const info=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],width:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.poster-card')].map(n=>{
    const rect=s=>{const r=(s?n.querySelector(s):n).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
    return{id:n.dataset.openDetail,title:n.querySelector('.poster-title').textContent,alt:n.querySelector('.poster-art img')?.alt,card:rect(),art:rect('.poster-art'),label:rect('.poster-title'),sub:rect('.poster-sub')};
  })}));
  assert.ok(info.cards.length>0);assert.ok(info.width<=info.viewport[0]+1,'page horizontally overflows');
  const rows=new Map();for(const c of info.cards){const key=Math.round(c.card.y);if(!rows.has(key))rows.set(key,[]);rows.get(key).push(c);assert.ok(Math.abs(c.art.y-c.card.y)<1,'poster is vertically centered by metadata');assert.ok(Math.abs(c.art.w/c.art.h-.72)<.015,'poster aspect changed');if(c.alt)assert.equal(c.alt,c.title);}
  for(const row of rows.values()) for(const field of ['art','label','sub'])assert.ok(Math.max(...row.map(c=>c[field].y))-Math.min(...row.map(c=>c[field].y))<1,`${field} is not row-aligned`);
  assert.equal(new Set(info.cards.map(c=>c.id)).size,info.cards.length,'duplicate detail targets');
  return {viewport:info.viewport,cards:info.cards.length,rows:rows.size,maxPosterOffset:Math.max(...info.cards.map(c=>Math.abs(c.art.y-c.card.y)))};
}
try{
  if(!device)await page.goto('https://sylong7708.github.io/TV/docs/iphone/index.html?qa=interactions',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.YingshiDiagnostics?.snapshot()?.ready,undefined,{timeout:60000});
  const widths=device?[null]:[{width:360,height:800},{width:844,height:390},{width:1280,height:800},{width:1920,height:1200}];
  for(const size of widths){
    if(size)await page.setViewportSize(size);
    for(const tab of ['home','movie','series','short','anime','variety'])await check(`grid-${size?.width||'car'}-${tab}`,async()=>{
      await voice('HOME');await tap(`[data-tab="${tab}"]`);await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,620));await page.waitForTimeout(150);
      const first=await gridCheck();await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(500);const loaded=await gridCheck();
      await page.evaluate(()=>scrollTo(0,400));if(tab==='movie')await screenshot(`aligned-movie-${size?.width||'car'}`);return {first,loaded};
    });
  }
  if(!device)await page.setViewportSize({width:1280,height:800});
  await check('voice-title-search-from-another-category',async()=>{
    await voice('VARIETY');await voice('PLAY_SEARCH','Big Buck Bunny（60fps 版本）');
    await page.waitForFunction(()=>document.querySelector('#playerSheet.is-open'),undefined,{timeout:45000});
    assert.match(await page.locator('#playerTitle').innerText(),/Big Buck Bunny/);assert.equal(await page.locator('#searchBox').inputValue(),'Big Buck Bunny（60fps 版本）');return playing();
  });
  await check('fullscreen-controls-hide-and-touch-reveal-without-closing',async()=>{
    await tap('#playerExpand');await waitExpanded(true);
    await page.waitForFunction(()=>document.querySelector('#playerSheet.is-chrome-hidden'),undefined,{timeout:6000});
    const geometry=await page.locator('#player').evaluate(v=>{const b=v.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,vw:innerWidth,vh:innerHeight,time:v.currentTime,paused:v.paused};});
    assert.ok(Math.abs(geometry.y)<1&&Math.abs(geometry.h-geometry.vh)<1,'hidden header must leave full video height');
    assert.equal(await page.locator('#playerExpand').isVisible(),false);
    await screenshot('fullscreen-controls-hidden');
    const restore=await page.locator('#playerExpand').boundingBox();
    const close=await page.locator('#playerSheet button[data-close-player]').boundingBox();
    const point={x:close.x+close.width/2,y:close.y+close.height/2};
    if(device){const d=await page.evaluate(()=>devicePixelRatio);await command(['shell','input','tap',String(Math.round(point.x*d)),String(Math.round(point.y*d))]);}
    else await page.touchscreen.tap(point.x,point.y);
    await page.waitForFunction(()=>!document.querySelector('#playerSheet.is-chrome-hidden'));
    assert.equal(await expanded(),true);assert.equal(await page.locator('#playerSheet.is-open').count(),1);await headerVisible();
    const after=await playerInfo();assert.ok(after.time>geometry.time&&!after.paused,'first reveal tap interrupted playback');
    await screenshot('fullscreen-controls-revealed');await tap('#playerExpand');await waitExpanded(false);
    await page.waitForTimeout(3200);await headerVisible();
    return {autoHideMs:3000,geometry,oldClosePositionRevealOnly:true,inlineControlsStayVisible:true,restore};
  });
  if(!device)for(const size of [{width:360,height:800},{width:844,height:390}])await check(`player-small-screen-${size.width}`,async()=>{
    await page.setViewportSize(size);await headerVisible();await tap('#playerExpand');await waitExpanded(true);await headerVisible();
    await page.locator('#playerSpeed').scrollIntoViewIfNeeded();await headerVisible();await screenshot(`player-${size.width}`);
    await tap('#playerExpand');await waitExpanded(false);return headerVisible();
  });
  if(!device)await page.setViewportSize({width:1280,height:800});
  await check('touch-expand-restore-repeat-8-times',async()=>{
    await page.evaluate(()=>window.YingshiVoice.execute('PAUSE'));const before=await playerInfo();
    for(let i=0;i<8;i++){await tap('#playerExpand');await waitExpanded(true);await headerVisible();await tap('#playerExpand');await waitExpanded(false);await headerVisible();}
    const after=await playerInfo();assert.equal(after.paused,true);assert.ok(Math.abs(after.time-before.time)<.2);return {cycles:8,before,after};
  });
  await check('expanded-settings-scroll-retains-close-and-restore',async()=>{
    await tap('#playerExpand');await waitExpanded(true);
    await page.locator('#playerSpeed').scrollIntoViewIfNeeded();await headerVisible();await screenshot('expanded-settings');
    await tap('#playerExpand');await waitExpanded(false);await headerVisible();return {exitsRemainReachable:true};
  });
  await check('back-shrinks-first-then-closes-player-then-detail',async()=>{
    await tap('#playerExpand');await waitExpanded(true);await back();await waitExpanded(false);
    assert.equal(await page.locator('#playerSheet.is-open').count(),1);await back();await page.waitForFunction(()=>!document.querySelector('#playerSheet.is-open'));
    assert.equal(await page.locator('#detailSheet.is-open').count(),1);await back();await page.waitForFunction(()=>!document.querySelector('.sheet.is-open'));
    return {threeStepBack:true,url:page.url()};
  });
  await check('expanded-close-stops-audio-and-reopen-restores-size',async()=>{
    await openMovie();await tap('#playerExpand');await waitExpanded(true);await screenshot('expanded-video');await tap('#playerSheet button[data-close-player]');
    await page.waitForFunction(()=>!document.querySelector('#playerSheet.is-open'));
    assert.equal(await expanded(),false);assert.equal(await page.locator('#player').evaluate(v=>v.paused&&!v.getAttribute('src')),true);
    await tap('#detailBody [data-episode]');await playing();assert.equal(await expanded(),false);return headerVisible();
  });
  await check('reopen-starts-at-video-after-scrolling-settings',async()=>{
    await page.locator('#playerSpeed').scrollIntoViewIfNeeded();await tap('#playerSheet button[data-close-player]');await page.waitForFunction(()=>!document.querySelector('#playerSheet.is-open'));
    await tap('#detailBody [data-episode]');await playing();assert.equal(await page.locator('#playerSheet .sheet-panel').evaluate(p=>p.scrollTop),0);
    const video=await page.locator('#player').boundingBox();assert.ok(video.y>=0&&video.y<(await page.evaluate(()=>innerHeight)));return {videoVisibleOnReopen:true};
  });
  await check('voice-expand-restore-close',async()=>{
    await voice('FULLSCREEN_ON');await waitExpanded(true);await voice('FULLSCREEN_OFF');await waitExpanded(false);
    await voice('FULLSCREEN_ON');await waitExpanded(true);await voice('CLOSE_PLAYER');await page.waitForFunction(()=>!document.querySelector('#playerSheet.is-open'));
    assert.equal(await expanded(),false);return {allVoiceExits:true};
  });
  await check('rapid-open-close-does-not-resurrect-player',async()=>{
    for(let i=0;i<4;i++){await tap('#detailBody [data-episode]');await tap('#playerExpand');await tap('#playerSheet button[data-close-player]');}
    await page.waitForTimeout(1600);assert.equal(await expanded(),false);assert.equal(await page.locator('#playerSheet.is-open').count(),0);
    assert.equal(await page.locator('#player').evaluate(v=>v.paused&&!v.getAttribute('src')),true);return {cycles:4,noDelayedPlayback:true};
  });
  await check('filter-modal-back-and-focus-restoration',async()=>{
    await voice('HOME');await page.waitForFunction(()=>!document.querySelector('.sheet.is-open'));await tap('[data-open-filter]');
    await back();await page.waitForFunction(()=>!document.querySelector('.sheet.is-open'));
    assert.equal(await page.evaluate(()=>document.querySelector('.app').inert),false);return {backgroundUsable:true};
  });
  if(!device)await check('typed-search-submit-and-result-open',async()=>{
    await voice('HOME');await page.locator('#searchBox').fill('Big Buck Bunny');await page.locator('#searchBox').press('Enter');
    await page.waitForFunction(()=>window.YingshiDiagnostics.snapshot().search.status==='complete',undefined,{timeout:45000});
    assert.equal(await page.locator('#searchBox').inputValue(),'Big Buck Bunny');await tap('#screen [data-open-detail]');assert.match(await page.locator('#detailTitle').innerText(),/Big Buck Bunny/);return {queryPreserved:true,detailOpened:true};
  });
  if(!device)await check('keyboard-tab-trap-and-escape',async()=>{
    await openMovie();await page.locator('#playerExpand').focus();const focus=[];
    for(let i=0;i<32;i++){await page.keyboard.press('Tab');focus.push(await page.evaluate(()=>Boolean(document.activeElement.closest('#playerSheet'))));}
    assert.ok(focus.every(Boolean),'keyboard focus escaped the dialog');await page.locator('#playerExpand').focus();await page.keyboard.press('Enter');await waitExpanded(true);
    await page.keyboard.press('Escape');await waitExpanded(false);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#playerSheet.is-open'));
    return {tabSteps:32,escapeRestoresThenCloses:true};
  });
  if(device)await check('remote-focus-remains-in-player-and-adjusts-settings',async()=>{
    await openMovie();await page.locator('#playerExpand').focus();await command(['shell','input','keyevent','23']);await waitExpanded(true);
    await command(['shell','input','keyevent','23']);await waitExpanded(false);
    const focused=[];for(let i=0;i<15;i++){await command(['shell','input','keyevent','20']);focused.push(await page.evaluate(()=>({id:document.activeElement.id,inside:Boolean(document.activeElement.closest('#playerSheet'))})));}
    assert.ok(focused.every(x=>x.inside),'remote focus leaked behind modal');
    await page.locator('#playerSpeed').focus();await page.locator('#playerSpeed').selectOption('1');await command(['shell','input','keyevent','22']);
    assert.equal(await page.locator('#player').evaluate(v=>v.playbackRate),1.25);await command(['shell','input','keyevent','21']);
    assert.equal(await page.locator('#player').evaluate(v=>v.playbackRate),1);return {focused,remoteRateChanged:true};
  });
  await check('zero-javascript-errors',async()=>{assert.deepEqual(report.errors,[]);return true;});
}finally{
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();
}
if(report.checks.some(x=>!x.passed))process.exitCode=1;
