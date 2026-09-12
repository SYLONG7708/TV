import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const tvRoot = path.resolve(args.get('tvRoot') || path.resolve(import.meta.dirname, '..'));
const catalogPath = path.resolve(args.get('catalog') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog.json'));
const output = path.resolve(args.get('output') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-latest.json'));
const dataRoot = path.resolve(args.get('dataRoot') || path.join(tvRoot, 'docs', 'data'));
const maxItems = Math.max(100, Number(args.get('maxItems') || 3600));
const maxItemsPerSource = Math.max(10, Number(args.get('maxItemsPerSource') || 80));
const embedEpisodesPerSource = Math.max(0, Number(args.get('embedEpisodesPerSource') || 0));

function timeValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const time = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readMaybeGzipJson(file) {
  const data = await fs.readFile(file);
  const text = /\.gz$/i.test(file) ? (await gunzip(data)).toString('utf8') : data.toString('utf8');
  return JSON.parse(text);
}

function sourceDetailPath(source, page) {
  if (!source?.detailPathPattern) return '';
  return source.detailPathPattern.replace('{page}', String(page).padStart(4, '0'));
}

function compactLatestItem(item, embedEpisodes = false) {
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  const compact = {
    id: item.id,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    vodId: item.vodId,
    title: item.title,
    originalName: item.originalName,
    kind: item.kind,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    year: item.year,
    area: item.area,
    genre: Array.isArray(item.genre) ? item.genre : [],
    remarks: item.remarks,
    score: item.score,
    views: item.views,
    hot: item.hot,
    updatedAt: item.updatedAt,
    poster: item.poster,
    episodeCount: item.episodeCount,
    playable: item.playable,
    adult: item.adult,
    lazyEpisodes: !embedEpisodes || episodes.length === 0,
    detailPage: item.detailPage,
    detailPath: item.detailPath,
  };
  if (embedEpisodes && episodes.length) compact.episodes = episodes;
  return compact;
}

const catalog = await readJson(catalogPath);
if (!catalog) throw new Error(`Catalog not found: ${catalogPath}`);

const rows = [];
const sourceStats = [];
for (const source of catalog.sources || []) {
  if (!source.indexed || !source.detailPathPattern) continue;
  const sourceRows = [];
  for (let page = 1; page <= 2; page += 1) {
    const detailPath = sourceDetailPath(source, page);
    if (!detailPath) continue;
    try {
      const payload = await readMaybeGzipJson(path.join(dataRoot, detailPath));
      for (const item of payload.items || []) {
        if (!item?.id || !item.title) continue;
        sourceRows.push(item);
      }
    } catch {
      // A source can still be usable through its index/detail pages even when one latest page is missing.
    }
  }
  sourceRows.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt) || Number(b.hot || 0) - Number(a.hot || 0));
  rows.push(
    ...sourceRows
      .slice(0, maxItemsPerSource)
      .map((item, index) => compactLatestItem(item, index < embedEpisodesPerSource)),
  );
  sourceStats.push({ id: source.id, name: source.name, items: sourceRows.length });
}

const seen = new Set();
const items = [];
for (const item of rows.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt) || Number(b.hot || 0) - Number(a.hot || 0))) {
  if (seen.has(item.id)) continue;
  seen.add(item.id);
  items.push(item);
  if (items.length >= maxItems) break;
}

const payload = {
  generatedAt: new Date().toISOString(),
  catalogGeneratedAt: catalog.generatedAt || '',
  maxItems,
  maxItemsPerSource,
  embedEpisodesPerSource,
  sourceCount: sourceStats.length,
  itemCount: items.length,
  items,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(payload)}\n`, 'utf8');
console.log(
  JSON.stringify({ output, itemCount: items.length, sourceCount: sourceStats.length, embedEpisodesPerSource }, null, 2),
);
