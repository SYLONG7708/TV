import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceMediaResolver,needsSourceMedia} from '../docs/iphone/source-media.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function fixture(){const events=new EventTarget(),calls=[],cancelled=[];const bridge={resolveSourceMedia:(url,id)=>calls.push({url,id}),cancelSourceMedia:id=>cancelled.push(id)};const resolver=createSourceMediaResolver({bridge,events});return {resolver,calls,cancelled,reply(value,index=0){const event=new Event('yingshi-source-media');event.detail={requestId:calls[index].id,...value};events.dispatchEvent(event);}};}
test('source media requests are limited to the declared public HTTP gateway',()=>{
  assert.equal(needsSourceMedia('http://ccc.oiio.fun/file.mp4'),true);
  for(const url of ['http://127.0.0.1/file.mp4','http://ccc.oiio.fun:8080/file.mp4','http://u:p@ccc.oiio.fun/file.mp4','https://ccc.oiio.fun/file.mp4','http://ccc.oiio.fun/file.mp4#x'])assert.equal(needsSourceMedia(url),false);
});
test('source resolver accepts only the native app-local session and closes it on change',async()=>{
  const f=fixture(),operation=f.resolver.open('http://ccc.oiio.fun/file.mp4');
  f.reply({ok:true,url:'https://sylong7708.github.io/TV/__source_media__/01234567-89ab-cdef-0123-456789abcdef/video.mp4',backend:'source-media'});
  const result=await operation.promise;assert.equal(result.backend,'source-media');assert.ok(!result.url.includes('ccc.oiio.fun'));
  operation.close();assert.deepEqual(f.cancelled,[f.calls[0].id]);
});
test('source resolver rejects external and stale callback URLs and explains unsupported clients',async()=>{
  const f=fixture(),operation=f.resolver.open('http://ccc.oiio.fun/file.mp4');
  f.reply({ok:true,url:'https://media.ctyun.cn/file.mp4?signature=temporary',backend:'source-media'});
  await assert.rejects(operation.promise,/驗證失敗/);operation.close();
  const old=f.resolver.open('http://ccc.oiio.fun/old.mp4');let accepted=false;old.promise.then(()=>accepted=true).catch(()=>{});old.close();
  f.reply({ok:true,url:'https://sylong7708.github.io/TV/__source_media__/01234567-89ab-cdef-0123-456789abcdef/video.mp4',backend:'source-media'},1);
  await Promise.resolve();assert.equal(accepted,false);
  await assert.rejects(createSourceMediaResolver({bridge:{},events:new EventTarget()}).open('http://ccc.oiio.fun/file.mp4').promise,/Android 1.4.32/);
});
test('native range transport renews expiring redirects, preserves seeking and releases cancelled streams',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),out=await fs.mkdtemp(path.join(os.tmpdir(),'source-media-java-'));
  const javaHome=process.env.JAVA_HOME||(process.platform==='win32'?'C:/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot':'');
  const tool=name=>javaHome?path.join(javaHome,'bin',name+(process.platform==='win32'?'.exe':'')):name;
  try{
    execFileSync(tool('javac'),['-encoding','UTF-8','-d',out,path.join(root,'mobile/yingshi-car/app/src/main/java/tw/com/sylong/tvcar/SourceMediaTransport.java'),path.join(root,'tests/fixtures/SourceMediaTransportContract.java')],{timeout:20000});
    const report=execFileSync(tool('java'),['-cp',out,'tw.com.sylong.tvcar.SourceMediaTransportContract'],{encoding:'utf8',timeout:10000});assert.match(report,/PASS SourceMediaTransport/);
  }finally{await fs.rm(out,{recursive:true,force:true});}
});
