import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const projectRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(projectRoot, '..');
const dataRoot = path.join(repoRoot, 'docs', 'data');
const outputRoot = path.join(projectRoot, 'app', 'src', 'main', 'assets', 'iphone-data');
const fallbackTitle = /王牌特工|王牌特務|金特务|金特務|kingsman/i;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const catalog = readJson(path.join(dataRoot, 'iphone-vod-catalog.json'));
const latest = readJson(path.join(dataRoot, 'iphone-vod-latest.json'));
const live = readJson(path.join(dataRoot, 'live-channels.json'));
const items = Array.isArray(latest.items) ? [...latest.items] : [];
const seen = new Set(items.map((item) => item?.id).filter(Boolean));
const detailCache = new Map();
let added = 0;

function hydrateOfflineItem(item) {
  const relative = String(item?.detailPath || '').replaceAll('/', path.sep);
  const file = path.resolve(dataRoot, relative);
  if (!relative || !file.startsWith(dataRoot + path.sep) || !fs.existsSync(file)) return item;
  let detailItems = detailCache.get(file);
  if (!detailItems) {
    try {
      const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
      detailItems = Array.isArray(payload?.items) ? payload.items : [];
    } catch {
      detailItems = [];
    }
    detailCache.set(file, detailItems);
  }
  const detail = detailItems.find((candidate) =>
    candidate?.id === item.id
      || (candidate?.sourceId === item.sourceId && String(candidate?.vodId) === String(item?.vodId)),
  );
  return detail ? { ...item, ...detail, lazyEpisodes: false } : item;
}

for (const name of fs.readdirSync(path.join(dataRoot, 'vod-search'))) {
  if (!name.endsWith('.json.gz')) continue;
  const file = path.join(dataRoot, 'vod-search', name);
  let payload;
  try {
    payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  } catch {
    continue;
  }
  for (const item of Array.isArray(payload?.items) ? payload.items : []) {
    const title = String(item?.title || item?.vod_name || '');
    if (!item?.id || seen.has(item.id) || item.adult || !item.playable || !fallbackTitle.test(title)) continue;
    seen.add(item.id);
    items.push(hydrateOfflineItem(item));
    added += 1;
  }
}

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(
  path.join(outputRoot, 'iphone-vod-catalog.json'),
  JSON.stringify(catalog),
  'utf8',
);
fs.writeFileSync(
  path.join(outputRoot, 'iphone-vod-latest.json'),
  JSON.stringify({ ...latest, items, offlineFallbackItems: added }),
  'utf8',
);
fs.writeFileSync(
  path.join(outputRoot, 'live-channels.json'),
  JSON.stringify(live),
  'utf8',
);

const playableFallbackItems = items.slice(-added).filter((item) => Array.isArray(item?.episodes) && item.episodes.length).length;
console.log(JSON.stringify({ latestItems: items.length, addedFallbackItems: added, playableFallbackItems, live: live.length }));
