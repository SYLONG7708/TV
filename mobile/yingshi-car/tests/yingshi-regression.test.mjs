import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
const assets = path.resolve('app/src/main/assets');
const html = fs.readFileSync(path.join(assets, 'iphone/index.html'), 'utf8');
const script = html.match(/<script\s+data-csp-hash[^>]*>([\s\S]*?)<\/script>/)[1];
const main = fs.readFileSync('app/src/main/java/tw/com/sylong/tvcar/MainActivity.java', 'utf8');
test('APK contains executable UI but no packaged source catalogs or media', () => {
  const files = fs.readdirSync(assets, { recursive: true });
  assert.deepEqual(files.filter(name => /\.(?:json|gz|m3u8?|mp4|ts|vtt|srt)$/i.test(name)), []);
  assert.ok(!main.includes('bundledDataAsset')); assert.ok(html.includes('deployment-state.json'));
});
test('generated executable parses and exact CSP hashes authorize script and style', () => {
  new vm.Script(script);
  for (const text of [script, html.match(/<style\s+data-csp-hash[^>]*>([\s\S]*?)<\/style>/)[1]]) {
    const digest = crypto.createHash('sha256').update(text).digest('base64');
    assert.ok(html.includes(`'sha256-${digest}'`));
  }
});
test('native and bundled voice bridge retain commands and exact title selection', () => {
  assert.ok(script.includes('window.YingshiVoice')); assert.ok(script.includes('exactVoiceMatch'));
  for (const cmd of ['PLAY_SEARCH', 'PLAY_LIVE', 'PAUSE', 'NEXT', 'SEEK_FORWARD', 'FULLSCREEN_ON']) {
    assert.ok(script.includes(cmd)); assert.ok(main.includes(`"${cmd}"`));
  }
});
test('TV remote, existing license gate and scoped subtitle picker are retained', () => {
  const remote = fs.readFileSync(path.join(assets, 'tv-remote.js'), 'utf8');
  const manifest = fs.readFileSync('app/src/main/AndroidManifest.xml', 'utf8');
  for (const marker of ['__yingshiTvRemote', 'PAGE_DOWN', 'PLAY_PAUSE']) assert.ok(remote.includes(marker));
  assert.ok(main.includes('KEYCODE_DPAD_DOWN')); assert.ok(main.includes('checkActiveLicense'));
  assert.ok(main.includes('Intent.ACTION_OPEN_DOCUMENT')); assert.ok(main.includes('"content".equals'));
  assert.ok(manifest.includes('android.intent.category.LEANBACK_LAUNCHER'));
});
