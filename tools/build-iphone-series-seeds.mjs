import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const DEFAULT_LIMIT_PER_CATEGORY = 80;
const KOREAN_CATEGORY_RE = /^(?:韓劇|韩剧|韓國劇|韩国剧)$/;

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function timeValue(value) {
  const time = Date.parse(String(value || '').replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

function compactItem(item) {
  return {
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
    adult: false,
    lazyEpisodes: true,
    detailPage: item.detailPage,
    detailPath: item.detailPath,
  };
}

export function selectSeedSource(catalog) {
  return (catalog.sources || [])
    .filter((source) => source.indexed && !source.adult && Number(source.itemCount || 0) >= 5000 && /^vod-index\/[^/]+\.json\.gz$/.test(source.indexPath || ''))
    .filter((source) => source.categories?.some((entry) => KOREAN_CATEGORY_RE.test(String(entry?.name || entry))))
    .sort((a, b) => Number(a.itemCount || Infinity) - Number(b.itemCount || Infinity))[0] || null;
}

export function buildSeedPayload(source, index, limitPerCategory = DEFAULT_LIMIT_PER_CATEGORY) {
  const byCategory = new Map();
  for (const item of index.items || []) {
    if (!item?.id || !item.title || item.adult || item.kind !== 'series') continue;
    const category = String(item.categoryName || '').trim();
    if (!category) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(item);
  }
  const categories = {};
  const items = [];
  const seen = new Set();
  for (const [category, rows] of byCategory) {
    rows.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt) || Number(b.hot || 0) - Number(a.hot || 0));
    const limited = rows.slice(0, limitPerCategory);
    categories[category] = limited.length;
    for (const item of limited) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(compactItem(item));
    }
  }
  if (!Object.keys(categories).some((category) => KOREAN_CATEGORY_RE.test(category)) || !items.length) {
    throw new Error('Selected source index has no Korean series seed items');
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceId: source.id,
    sourceName: source.name,
    indexPath: source.indexPath,
    limitPerCategory,
    categories,
    itemCount: items.length,
    items,
  };
}

async function preservedSeedReport(output) {
  try {
    const previous = JSON.parse(await fs.readFile(output, 'utf8'));
    if (previous.itemCount >= 12 && Object.keys(previous.categories || {}).some((category) => KOREAN_CATEGORY_RE.test(category))) {
      return { output, source: previous.sourceName, items: previous.itemCount, categories: previous.categories, preservedPrevious: true };
    }
  } catch {
    // No previous seed is available.
  }
  return null;
}

export async function buildIphoneSeriesSeeds({ catalogPath, dataRoot, output, rawBase = '', limitPerCategory = DEFAULT_LIMIT_PER_CATEGORY }) {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const source = selectSeedSource(catalog);
  if (!source) {
    const previous = await preservedSeedReport(output);
    if (previous) return previous;
    throw new Error('No indexed, non-adult source with Korean drama is available');
  }
  const resolvedRoot = path.resolve(dataRoot);
  const localPath = path.resolve(resolvedRoot, source.indexPath);
  if (!localPath.startsWith(resolvedRoot + path.sep)) throw new Error('Source index path escapes data root');
  let compressed;
  try {
    compressed = await fs.readFile(localPath);
  } catch (error) {
    if (error?.code === 'ENOENT' && !rawBase) {
      const previous = await preservedSeedReport(output);
      if (previous) return previous;
    }
    if (!rawBase || error?.code !== 'ENOENT') throw error;
    const url = new URL(source.indexPath, `${rawBase.replace(/\/$/, '')}/`);
    if (url.protocol !== 'https:') throw new Error('Remote source index must use HTTPS');
    const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`Unable to load source index: HTTP ${response.status}`);
    compressed = Buffer.from(await response.arrayBuffer());
  }
  const index = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  let payload;
  try {
    payload = buildSeedPayload(source, index, limitPerCategory);
  } catch (error) {
    if (error?.message !== 'Selected source index has no Korean series seed items') throw error;
    const previous = await preservedSeedReport(output);
    if (previous) return previous;
    throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(payload)}\n`, 'utf8');
  return { output, source: source.name, items: payload.itemCount, categories: payload.categories };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const tvRoot = path.resolve(option('--tvRoot', path.resolve(import.meta.dirname, '..')));
  const report = await buildIphoneSeriesSeeds({
    catalogPath: path.resolve(option('--catalog', path.join(tvRoot, 'docs/data/iphone-vod-catalog.json'))),
    dataRoot: path.resolve(option('--dataRoot', path.join(tvRoot, 'docs/data'))),
    output: path.resolve(option('--output', path.join(tvRoot, 'docs/iphone/category-seeds.json'))),
    rawBase: option('--rawBase'),
    limitPerCategory: Math.max(1, Number(option('--limitPerCategory', String(DEFAULT_LIMIT_PER_CATEGORY)))),
  });
  console.log(JSON.stringify(report, null, 2));
}
