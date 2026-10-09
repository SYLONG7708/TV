import fs from 'node:fs/promises';
const [healthFile, browserFile, target] = process.argv.slice(2);
const health = JSON.parse(await fs.readFile(healthFile, 'utf8'));
const browser = JSON.parse(await fs.readFile(browserFile, 'utf8'));
if (health.schemaVersion !== 1 || !Array.isArray(browser.live)) throw new Error('Invalid audit data');
for (const row of browser.live) {
  if (!/^[a-f0-9]{8}$/.test(row.key || '')) continue;
  const previous = health.signals[row.key] || {};
  if (row.status === 'decoded-playback') health.signals[row.key] = { ...previous, verified: true, status: 'decoded-playback', elapsedMs: row.elapsedMs, height: row.height, decodedAudio: row.audioBytes > 0 };
  else if (row.status === 'media-error' || (row.status === 'player-reported-failure' && row.reason)) health.signals[row.key] = { ...previous, verified: false, status: 'failed', reason: row.status };
  // Ads, automation errors and deadlines are inconclusive, not broken streams.
}
await fs.writeFile(target, JSON.stringify({ ...health, browserCheckedAt: browser.checkedAt, browserSummary: browser.summary }, null, 2));
