import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { writeStableGzipJson } from './stable-gzip-json.mjs';

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
const reportPath = path.resolve(args.get('report') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog-report.json'));
const detailRoot = path.resolve(args.get('detailRoot') || path.join(tvRoot, 'docs', 'data', 'vod-detail'));
const indexRoot = path.resolve(args.get('indexRoot') || path.join(tvRoot, 'docs', 'data', 'vod-index'));
const dropEmptySources = args.get('dropEmptySources') === 'true';
const sourceMatch = normalizeText(args.get('sourceMatch')).toLowerCase();

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value, fallback = 'source') {
  return (
    normalizeText(value, fallback)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback
  );
}

async function readJson(file) {
  const data = await fs.readFile(file);
  const text = /\.gz$/i.test(file) ? (await gunzip(data)).toString('utf8') : data.toString('utf8');
  return JSON.parse(text);
}

async function readJsonIfExists(file, fallback = {}) {
  try {
    return await readJson(file);
  } catch {
    return fallback;
  }
}

function compactItem(item) {
  const { episodes, ...rest } = item;
  return rest;
}

function sourceSlug(source) {
  const match = normalizeText(source.detailPathPattern).match(/vod-detail\/([^/]+)\/page-\{page\}\.json\.gz/i);
  return match?.[1] || slugify(`${source.host || source.key || source.name}-${source.id}`, 'source');
}

function sourceCheck(source) {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    api: source.api,
    origin: source.origin,
    adult: source.adult,
    indexable: source.indexable,
    indexed: source.indexed,
    complete: source.complete,
    itemCount: source.itemCount,
    playableCount: source.playableCount,
    sourceTotalCount: source.sourceTotalCount,
    detailPageCount: source.detailPageCount,
    detailExpectedPages: source.detailExpectedPages,
    indexPath: source.indexPath,
    searchIndexPath: source.searchIndexPath,
    detailPathPattern: source.detailPathPattern,
    error: source.error,
    checks: source.checks,
  };
}

function addFilterSets(sets, item) {
  if (item.year) sets.years.add(item.year);
  if (item.area) sets.areas.add(item.area);
  for (const genre of item.genre || []) sets.genres.add(genre);
}

function emptyKindTotals() {
  return { movie: 0, series: 0, variety: 0, anime: 0, short: 0, adult: 0 };
}

function addKind(kindTotals, item) {
  if (item.kind === 'series') kindTotals.series += 1;
  else if (item.kind === 'variety') kindTotals.variety += 1;
  else if (item.kind === 'anime') kindTotals.anime += 1;
  else if (item.kind === 'short') kindTotals.short += 1;
  else if (item.kind === 'adult' || item.adult) kindTotals.adult += 1;
  else kindTotals.movie += 1;
}

function buildFilters(sets) {
  return {
    years: [...sets.years].sort((a, b) => b.localeCompare(a)).slice(0, 24),
    areas: [...sets.areas].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 28),
    genres: [...sets.genres].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 42),
  };
}

const catalog = await readJson(catalogPath);
if (!sourceMatch) await fs.rm(indexRoot, { recursive: true, force: true });
await fs.mkdir(indexRoot, { recursive: true });

const processedIds = new Set();
const updatedSources = [];
const filterSets = { years: new Set(), areas: new Set(), genres: new Set() };
const kindTotals = emptyKindTotals();
let indexedItemsTotal = 0;
let playableItemsTotal = 0;
const existingItemsBySource = new Map();
for (const item of catalog.items || []) {
  if (!existingItemsBySource.has(item.sourceId)) existingItemsBySource.set(item.sourceId, []);
  existingItemsBySource.get(item.sourceId).push(item);
}

for (const source of catalog.sources || []) {
  const matchesSource = !sourceMatch || normalizeText(
    [source.id, source.key, source.name, source.api, source.host, source.origin].join(' '),
  ).toLowerCase().includes(sourceMatch);
  if (!matchesSource) {
    updatedSources.push(source);
    indexedItemsTotal += Number(source.itemCount || 0);
    playableItemsTotal += Number(source.playableCount || 0);
    continue;
  }
  const slug = sourceSlug(source);
  const sourceDir = path.join(detailRoot, slug);
  let files = [];
  try {
    files = (await fs.readdir(sourceDir)).filter((file) => /\.json(?:\.gz)?$/i.test(file)).sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    const keptItems = existingItemsBySource.get(source.id) || [];
    const nextSource = { ...source };
    delete nextSource.indexMode;
    delete nextSource.indexPath;
    delete nextSource.detailMode;
    delete nextSource.detailPathPattern;
    nextSource.itemCount = keptItems.length;
    nextSource.playableCount = keptItems.filter((item) => item.playable).length;
    nextSource.indexed = keptItems.length > 0;
    updatedSources.push(nextSource);
    continue;
  }

  const compact = [];
  const seen = new Set();
  let total = 0;
  let expectedPages = 0;
  for (const file of files) {
    const detail = await readJson(path.join(sourceDir, file));
    total = Math.max(total, Number(detail.total || 0));
    expectedPages = Math.max(expectedPages, Number(detail.pagecount || 0));
    for (const item of detail.items || []) {
      const key = item.vodId || `${item.title}|${item.poster}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = compactItem(item);
      compact.push(row);
      addFilterSets(filterSets, row);
      addKind(kindTotals, row);
    }
  }

  const indexPayload = {
    generatedAt: new Date().toISOString(),
    sourceId: source.id,
    sourceName: source.name,
    itemCount: compact.length,
    items: compact,
  };
  const indexFileName = `${slug}.json.gz`;
  await writeStableGzipJson(path.join(indexRoot, indexFileName), indexPayload);

  processedIds.add(source.id);
  indexedItemsTotal += compact.length;
  playableItemsTotal += compact.filter((item) => item.playable).length;
  const checks = Array.isArray(source.checks) ? source.checks.filter((check) => check?.label !== 'source-index-gzip') : [];
  updatedSources.push({
    ...source,
    itemCount: compact.length,
    playableCount: compact.filter((item) => item.playable).length,
    sourceTotalCount: total || compact.length,
    complete: expectedPages > 0 && files.length >= expectedPages,
    detailPageCount: files.length,
    detailExpectedPages: expectedPages || files.length,
    indexed: compact.length > 0,
    indexMode: 'chunked-json-gzip',
    indexPath: `vod-index/${indexFileName}`,
    detailMode: 'chunked-json-gzip',
    detailPathPattern: `vod-detail/${slug}/page-{page}.json.gz`,
    checks: [
      ...checks,
      {
        label: 'source-index-gzip',
        ok: true,
        count: compact.length,
        pages: files.length,
        total: total || compact.length,
      },
    ],
    error: '',
  });

  console.log(`${source.name}: indexed ${compact.length} items from ${files.length} detail files`);
}

const inlineItems = (catalog.items || []).filter((item) => !processedIds.has(item.sourceId));
for (const item of inlineItems) {
  addFilterSets(filterSets, item);
  addKind(kindTotals, item);
}

const inlinePlayable = inlineItems.filter((item) => item.playable).length;
const publishedSources = dropEmptySources
  ? updatedSources.filter((source) => source.indexed || Number(source.itemCount || 0) > 0 || Number(source.playableCount || 0) > 0)
  : updatedSources;
const droppedSources = dropEmptySources
  ? updatedSources
      .filter((source) => !publishedSources.includes(source))
      .map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        api: source.api,
        origin: source.origin,
        itemCount: source.itemCount || 0,
        playableCount: source.playableCount || 0,
        error: source.error || '',
      }))
  : [];
const totals = {
  sources: publishedSources.length,
  indexedSources: publishedSources.filter((source) => source.indexed).length,
  items: indexedItemsTotal + inlineItems.length,
  playableItems: playableItemsTotal + inlinePlayable,
  movies: sourceMatch ? Number(catalog.totals?.movies || 0) : kindTotals.movie,
  series: sourceMatch ? Number(catalog.totals?.series || 0) : kindTotals.series,
  variety: sourceMatch ? Number(catalog.totals?.variety || 0) : kindTotals.variety,
  anime: sourceMatch ? Number(catalog.totals?.anime || 0) : kindTotals.anime,
  short: sourceMatch ? Number(catalog.totals?.short || 0) : kindTotals.short,
  adult: sourceMatch ? Number(catalog.totals?.adult || 0) : kindTotals.adult,
  other: Number(catalog.totals?.other || 0),
};

const nextCatalog = {
  ...catalog,
  generatedAt: new Date().toISOString(),
  source: {
    ...(catalog.source || {}),
    fullChunkedCatalog: true,
    detailRoot: 'docs/data/vod-detail',
    indexRoot: 'docs/data/vod-index',
  },
  totals,
  filters: sourceMatch ? catalog.filters : buildFilters(filterSets),
  sources: publishedSources,
  items: inlineItems,
};

const existingReport = await readJsonIfExists(reportPath, {});
const report = {
  ...existingReport,
  generatedAt: nextCatalog.generatedAt,
  totals,
  sourceChecks: publishedSources.map(sourceCheck),
  droppedSources,
};

await fs.writeFile(catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      catalogPath,
      reportPath,
      detailRoot,
      indexRoot,
      processedSources: processedIds.size,
      inlineItems: inlineItems.length,
      totals,
      droppedSources: droppedSources.length,
    },
    null,
    2,
  ),
);
