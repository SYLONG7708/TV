import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
const root = path.resolve(args.codeRoot || '.'), device = false;
const out = path.resolve(args.output || 'functional-audit'); await fs.mkdir(out, { recursive: true });
const browser = device ? await chromium.connectOverCDP('http://127.0.0.1:9224') : await chromium.launch({ headless: true, channel: process.env.OKTV_CHROME_CHANNEL || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = device ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1280, height: 800 } });
if (args.codeRoot) await context.route('https://sylong7708.github.io/TV/docs/iphone/**', async route => {
  const name = new URL(route.request().url()).pathname.split('/').at(-1) || 'index.html';
  if (!/\.(html|mjs|css)$/.test(name)) return route.continue();
  try { await route.fulfill({ body: await fs.readFile(path.join(root, 'docs/iphone', name)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript' }); } catch { await route.continue(); }
});
const page = device ? context.pages().find(page => page.url().includes('/TV/docs/iphone/')) : await context.newPage();
page.setDefaultTimeout(15000);
const report = { checkedAt: new Date().toISOString(), platform: device ? 'UIS7870 WebView' : 'Chrome desktop', checks: [], pageErrors: [], playback: [] };
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('console', message => { if (message.text().startsWith('yingshi-playback')) report.playback.push(message.text()); });
const snap = async name => page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});
async function check(name, action) {
  const started = Date.now();
  try { const detail = await action(); report.checks.push({ name, passed: true, elapsedMs: Date.now() - started, detail }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, elapsedMs: Date.now() - started, error: error.message.slice(0, 800) }); console.log(`FAIL ${name}: ${error.message.slice(0, 200)}`); await snap(`failed-${name}`); }
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
const videoInfo = () => page.locator('#player').evaluate(video => ({ time: video.currentTime, duration: video.duration, paused: video.paused, ready: video.readyState, width: video.videoWidth, height: video.videoHeight, decodedFrames: video.webkitDecodedFrameCount || 0, decodedAudioBytes: video.webkitAudioDecodedByteCount || 0, error: video.error?.code || 0 }));
async function playing(timeout = 30000) {
  await page.waitForFunction(() => { const video = document.querySelector('#player'); return video && video.currentTime > 0.3 && video.videoWidth > 0 && !video.paused && video.readyState >= 2; }, undefined, { timeout });
  const before = await videoInfo(); await page.waitForTimeout(1200); const after = await videoInfo();
  assert.ok(after.time > before.time && after.decodedFrames > before.decodedFrames, 'decoded frames/time did not advance'); return after;
}
async function closePlayer() {
  await page.evaluate(() => window.YingshiVoice.execute('CLOSE_PLAYER'));
  if (await page.locator('#detailSheet.is-open').count()) await page.locator('#detailSheet button[data-close-detail]').click();
  if (await page.locator('#filterSheet.is-open').count()) await page.locator('#filterSheet button[data-close-filter]').click();
}
async function search(text) { await page.evaluate(query => window.YingshiVoice.execute('SEARCH', query), text); }
try {
  await check('startup-cloud-only', async () => {
    if (!device) await page.goto('https://sylong7708.github.io/TV/docs/iphone/index.html?qa=acceptance', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => window.YingshiDiagnostics?.snapshot()?.ready, undefined, { timeout: 60000 });
    const info = await page.evaluate(() => window.YingshiDiagnostics.snapshot()); assert.equal(info.sources, 83); assert.ok(info.indexedRecords > 1e6); return info;
  });
  for (const tab of ['home', 'movie', 'series', 'short', 'anime', 'variety', 'rank', 'live']) await check(`category-${tab}`, async () => {
    await page.locator(`[data-tab="${tab}"]`).click(); await page.waitForTimeout(200);
    const cards = await page.locator('#screen [data-open-detail],#screen [data-live-play]').count();
    assert.ok(cards > 0, 'category had no rendered records'); assert.equal((await page.evaluate(() => window.YingshiDiagnostics.snapshot())).tab, tab);
    return { cards };
  });
  await check('series-subcategories', async () => {
    await page.locator('[data-tab="series"]').click();
    const values = await page.locator('[data-quick-filter-key="seriesCategory"]').evaluateAll(nodes => nodes.map(node => node.dataset.quickFilterValue));
    const results = [];
    for (const value of values) {
      const target = page.locator(`[data-quick-filter-key="seriesCategory"][data-quick-filter-value=${JSON.stringify(value)}]`);
      await target.click(); await page.waitForTimeout(100); results.push({ value, selected: await target.evaluate(el => el.classList.contains('is-active')) });
    }
    assert.ok(results.length >= 3); assert.ok(results.every(row => row.selected));
    await page.locator('[data-quick-filter-key="seriesCategory"][data-quick-filter-value="all"]').click(); return results;
  });
  await check('filter-reset-and-literal-no-results', async () => {
    await page.locator('[data-tab="movie"]').click();
    await page.locator('[data-open-filter]').first().click();
    for (const key of ['year', 'area', 'genre', 'sort']) {
      const choices = page.locator(`#filterSheet [data-filter-key="${key}"]`);
      if (await choices.count() > 1) await choices.nth(1).click();
    }
    await page.locator('[data-reset-filter]').click();
    if (await page.locator('#filterSheet.is-open').count()) await page.locator('#filterSheet button[data-close-filter]').click();
    await search('zqxj-ThisTitleDoesNotExist-730103');
    assert.equal(await page.locator('#screen [data-open-detail]').count(), 0);
    const result = await page.evaluate(() => window.YingshiVoice.execute('PLAY_SEARCH', 'zqxj-ThisTitleDoesNotExist-730103'));
    assert.equal(result.ok, false); return result;
  });
  await check('real-vod-and-name', async () => {
    await search('Big Buck Bunny');
    const title = await page.locator('#screen [data-open-detail]').first().innerText(); assert.match(title, /Big Buck Bunny/);
    await page.locator('#screen [data-open-detail]').first().click();
    assert.match(await page.locator('#detailTitle').innerText(), /Big Buck Bunny/);
    await page.locator('#detailBody [data-episode]').first().click();
    const media = await playing(45000); assert.ok(media.decodedAudioBytes > 0, 'no decoded audio'); await snap('real-vod'); return media;
  });
  await check('pause-seek-speed-volume', async () => {
    await page.locator('#playerToggle').click(); const time = (await videoInfo()).time; await page.waitForTimeout(1300); assert.ok(Math.abs((await videoInfo()).time - time) < .15);
    await page.locator('#playerSpeed').selectOption('1.5');
    await page.locator('#playerVolume').fill('45'); await page.locator('#playerVolume').dispatchEvent('input');
    await page.locator('#playerMute').click(); assert.equal(await page.locator('#player').evaluate(v => v.muted), true);
    await page.locator('#playerMute').click();
    await page.locator('#playerSeek').fill('40'); await page.locator('#playerSeek').dispatchEvent('change');
    await page.waitForFunction(() => Math.abs(document.querySelector('#player').currentTime - 40) < 2);
    assert.equal(await page.locator('#player').evaluate(v => v.playbackRate), 1.5); return await videoInfo();
  });
  await check('quality-switch-keeps-pause-and-position', async () => {
    const select = page.locator('#playerQuality'); const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));
    assert.ok(options.length > 1, 'real source has no multiple qualities'); const previous = await select.inputValue(); const chosen = options.find(row => row.value !== previous);
    const time = (await videoInfo()).time; await select.selectOption(chosen.value);
    await page.waitForFunction(() => document.querySelector('#player').readyState >= 2, undefined, { timeout: 30000 });
    await page.waitForTimeout(1200); const after = await videoInfo(); assert.equal(after.paused, true); assert.ok(Math.abs(after.time - time) < 2); await snap('quality-controls'); return { options, selected: chosen, media: after };
  });
  await check('audio-and-subtitle-truthfulness', async () => {
    const audio = await page.locator('#playerAudio option').allTextContents();
    if (audio.length < 2) assert.equal(await page.locator('#playerAudio').isDisabled(), true);
    const supplied = await page.locator('#playerSubtitles option').allTextContents();
    if (supplied.length === 1) assert.match(supplied[0], /未提供/);
    await page.locator('#playerSubtitleFile').setInputFiles({ name: 'qa-only.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:39,000 --> 00:00:45,000\n字幕功能測試\n') });
    await page.waitForFunction(() => Array.from(document.querySelector('#player').textTracks).some(track => track.cues?.length > 0));
    const tracks = await page.locator('#player').evaluate(video => Array.from(video.textTracks).map(track => ({ mode: track.mode, cues: Array.from(track.cues || []).map(cue => cue.text) })));
    assert.ok(tracks.some(track => track.cues.includes('字幕功能測試')));
    await page.locator('#playerSubtitles').selectOption('off'); assert.ok((await page.locator('#player').evaluate(video => Array.from(video.textTracks).map(track => track.mode))).every(mode => mode === 'disabled'));
    return { audio, supplied, importedTestFixture: tracks };
  });
  await check('play-resume-and-fullscreen', async () => {
    await page.locator('#playerToggle').click(); const media = await playing();
    await page.locator('#playerFullscreen').click(); await page.waitForFunction(() => window.YingshiPlayerPresentation.active()); await snap('fullscreen');
    await page.locator('#playerExpand').click(); await page.waitForFunction(() => !window.YingshiPlayerPresentation.active()); return media;
  });
  await closePlayer();
  await check('real-official-live', async () => {
    await page.evaluate(() => window.YingshiVoice.execute('LIVE'));
    await page.locator('[data-tab="live"]').click();
    const rows = page.locator('[data-live-play]');
    const ids = await rows.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.livePlay, text: node.closest('article').innerText })));
    const official = ids.find(row => /public-/.test(row.id) && /France 24.*English|France 24.*英/i.test(row.text)) || ids.find(row => /public-/.test(row.id));
    assert.ok(official); await page.locator(`[data-live-play=${JSON.stringify(official.id)}]`).click(); const media = await playing(40000); await snap('real-live'); return { channel: official.text, media };
  });
  await closePlayer();
  await check('youtube-live-confirmed-state', async () => {
    await page.evaluate(() => window.YingshiVoice.execute('LIVE'));
    await page.locator('[data-tab="live"]').click();
    const target = page.locator('[data-live-play]').filter({ hasText: '播放' });
    const id = await target.evaluateAll(nodes => nodes.find(node => /三立.*iNEWS/i.test(node.closest('article').innerText))?.dataset.livePlay);
    assert.ok(id); await page.locator(`[data-live-play=${JSON.stringify(id)}]`).click();
    let officialSkipClicks = 0;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && await page.locator('#playerStatus').innerText() !== '播放中') {
      const frame = page.frames().find(frame => /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//.test(frame.url()));
      const skip = frame?.locator('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button').first();
      if (skip && await skip.isVisible().catch(() => false)) { await skip.click({ timeout: 1500 }).then(() => officialSkipClicks++).catch(() => {}); }
      await page.waitForTimeout(500);
    }
    assert.equal(await page.locator('#playerStatus').innerText(), '播放中', 'Official content did not report playing within the observation window');
    await snap('youtube-live'); return { status: await page.locator('#playerStatus').innerText(), officialSkipClicks, evidence: report.playback.slice(-2) };
  });
  await closePlayer();
  await check('cloud-cache-offline-online-recovery', async () => {
    await search(''); await context.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.YingshiDiagnostics?.snapshot()?.ready, undefined, { timeout: 45000 });
    const offline = await page.evaluate(() => window.YingshiDiagnostics.snapshot()); assert.ok(offline.sources > 0); assert.match(await page.locator('#bootNotice').innerText(), /下載的目錄/);
    await snap('offline-downloaded-cache'); await context.setOffline(false);
    await page.waitForTimeout(2500); await page.waitForFunction(() => window.YingshiDiagnostics?.snapshot()?.ready, undefined, { timeout: 60000 }); return { offline, restored: await page.evaluate(() => navigator.onLine) };
  });
} finally {
  await context.setOffline(false).catch(() => {});
  report.summary = { passed: report.checks.filter(row => row.passed).length, failed: report.checks.filter(row => !row.passed).length, pageErrors: report.pageErrors.length };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.summary));
  await browser.close();
  if (report.summary.failed || report.summary.pageErrors) process.exitCode = 1;
}
