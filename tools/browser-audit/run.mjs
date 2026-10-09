import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { signalKey } from '../../docs/iphone/signal-priority.mjs';
const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
const base = args.base || 'https://sylong7708.github.io/TV';
const output = path.resolve(args.output || 'browser-audit'); await fs.mkdir(output, { recursive: true });
const report = { checkedAt: new Date().toISOString(), mode: args.codeRoot ? 'candidate-code-real-cloud-data' : 'deployed-site', interface: [], live: [], errors: [] };
const browser = await chromium.launch({ headless: true, channel: process.env.OKTV_CHROME_CHANNEL || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
if (args.codeRoot) await context.route(`${base}/docs/iphone/**`, async route => {
  const name = new URL(route.request().url()).pathname.split('/').at(-1) || 'index.html';
  if (!/\.(?:html|mjs|css)$/.test(name)) return route.continue();
  try { await route.fulfill({ body: await fs.readFile(path.join(args.codeRoot, 'docs/iphone', name)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript' }); } catch { await route.continue(); }
});
const response = await fetch(`${base}/docs/data/live-channels.json`, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Cloud live catalog HTTP ${response.status}`);
const channels = await response.json();
const maxWait = Number(args.timeoutMs || 18000);
let cursor = 0;
const save = () => fs.writeFile(path.join(output, 'browser-audit.json'), JSON.stringify(report, null, 2));
try {
  await Promise.all(Array.from({ length: Math.min(Number(args.concurrency || 3), channels.length) }, async (_, worker) => {
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push({ worker, message: error.message.slice(0, 300) }));
    await page.goto(`${base}/docs/iphone/index.html`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.locator('[data-tab="live"]').waitFor({ timeout: 60000 });
    if (worker === 0) {
      for (const tab of ['home', 'movie', 'series', 'short', 'anime', 'variety', 'rank', 'live']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        const cards = await page.locator('#screen [data-open-detail],#screen [data-live-play]').count();
        report.interface.push({ tab, cards, passed: cards > 0 });
      }
    } else await page.locator('[data-tab="live"]').click();
    while (cursor < channels.length) {
      const channel = channels[cursor++], started = Date.now();
      const result = { id: channel.id, requestedKey: signalKey(channel.embedUrl || channel.url), kind: channel.kind, status: 'unverified' };
      try {
        const button = page.locator(`[data-live-play=${JSON.stringify(channel.id)}]`);
        if (!await button.count()) { result.status = 'missing-from-ui'; continue; }
        await button.click();
        let first = null;
        while (Date.now() - started < maxWait) {
          const active = await page.evaluate(() => window.YingshiDiagnostics?.snapshot()?.activeSignal);
          if (!active?.key) { await page.waitForTimeout(450); continue; }
          if (result.key !== active.key) first = null;
          result.key = active.key;
          const frame = active.kind === 'embed' ? page.frames().find(frame => /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//.test(frame.url())) : page.mainFrame();
          const video = frame?.locator('video').first();
          if (video && await video.count().catch(() => 0)) {
            const data = await video.evaluate(media => ({ time: media.currentTime, width: media.videoWidth, height: media.videoHeight,
              paused: media.paused, ready: media.readyState, frames: media.webkitDecodedFrameCount || 0,
              audioBytes: media.webkitAudioDecodedByteCount || 0, error: media.error?.code || 0,
              advertisement: Boolean(document.querySelector('.ad-showing')) })).catch(() => null);
            if (data?.advertisement) { result.status = 'advertisement-only'; first = null; }
            else if (data?.width && !data.paused && data.ready >= 2) {
              if (first && data.time > first.time + .4 && data.frames > first.frames) {
                Object.assign(result, { status: 'decoded-playback', ...data, elapsedMs: Date.now() - started }); break;
              }
              first ||= data;
            }
            if (data?.error) { result.status = 'media-error'; result.error = data.error; break; }
          }
          const status = await page.locator('#playerStatus').innerText();
          if (/目前無可用來源|播放器回報錯誤/.test(status)) { result.status = 'player-reported-failure'; result.reason = status; break; }
          await page.waitForTimeout(450);
        }
      } catch (error) { result.status = 'test-error'; result.error = error.message.slice(0, 250); }
      finally {
        report.live.push(result);
        // Each worker writes a separate incremental file; final report is atomic
        // after all workers finish, so overlapping writes cannot corrupt it.
        await fs.writeFile(path.join(output, `worker-${worker}.json`), JSON.stringify(report.live.filter(row => row.worker === worker || row === result)));
        result.worker = worker;
        console.log(`live ${report.live.length}/${channels.length}: ${result.status}`);
        if (await page.locator('#playerSheet.is-open button[data-close-player]').count()) await page.locator('#playerSheet button[data-close-player]').click().catch(() => {});
      }
    }
    await page.close();
  }));
} finally {
  report.summary = { configured: channels.length, attempted: report.live.length, decoded: report.live.filter(row => row.status === 'decoded-playback').length,
    outcomes: Object.fromEntries([...new Set(report.live.map(row => row.status))].map(status => [status, report.live.filter(row => row.status === status).length])),
    interfacePassed: report.interface.filter(row => row.passed).length, errors: report.errors.length };
  await save(); console.log(JSON.stringify(report.summary)); await browser.close();
}
