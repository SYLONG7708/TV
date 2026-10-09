import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildLegacyRepairs } from './legacy-playback-repairs.mjs';
const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length-2)/2) }, (_, i) => [process.argv[2+i*2].replace(/^--/, ''), process.argv[3+i*2]]));
const root = path.resolve(import.meta.dirname, '..'), base = 'https://sylong7708.github.io/TV/';
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 16 * 1024 * 1024) throw new Error('Oversize metadata');
  return JSON.parse((buffer[0] === 31 && buffer[1] === 139 ? zlib.gunzipSync(buffer) : buffer).toString('utf8').replace(/^\uFEFF/, ''));
}
const deployment = await json(base + 'docs/data/deployment-state.json?repair=' + Date.now());
if (!/^https:\/\/raw\.githubusercontent\.com\/SYLONG7708\/TV\/[a-f0-9]{40}\/docs\/data\/$/.test(deployment.dataBaseUrl)) throw new Error('Invalid immutable data base');
const latest = await json(deployment.dataBaseUrl + 'iphone-vod-latest.json');
const priority = JSON.parse(await fs.readFile(path.join(root, 'docs/iphone/playback-repair-priority.json'), 'utf8'));
const targets = latest.items.filter(row => !row.adult && row.detailPath)
  .sort((a, b) => Number(priority.titles.includes(b.title)) - Number(priority.titles.includes(a.title)));
const paths = [...new Set(targets.map(row => row.detailPath))].slice(0, 180);
const details = [], failures = []; let cursor = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (cursor < paths.length) {
    const source = paths[cursor++];
    if (!/^vod-detail\/[^?#]+\.json(?:\.gz)?$/.test(source) || source.includes('..')) continue;
    try { details.push(...(await json(deployment.dataBaseUrl + source)).items); } catch (error) { failures.push({ path: source, error: error.message }); }
    if (cursor % 20 === 0) console.log('DETAIL_PAGES', cursor, '/', paths.length);
  }
}));
if (failures.length > paths.length / 3 || !details.length) throw new Error('Insufficient detail coverage; keep previous repair feed');
const health = JSON.parse(await fs.readFile(path.join(root, 'docs/iphone/signal-health.json'), 'utf8'));
const repairs = buildLegacyRepairs(targets, details, health);
repairs.dataRevision = deployment.dataCommit; repairs.coverage = { targets: targets.length, detailPages: paths.length, failedPages: failures.length, detailItems: details.length };
if (!repairs.items.length) throw new Error('No exact-episode alternatives found; keep previous feed');
const output = path.resolve(args.output || path.join(root, 'docs/iphone/playback-repairs.json'));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(repairs) + '\n');
console.log(JSON.stringify({ output, ...repairs.counts, coverage: repairs.coverage }));
