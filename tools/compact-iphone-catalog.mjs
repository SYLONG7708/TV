import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { classifyVodKind } from './vod-kind-rules.mjs';

const gzip = promisify(zlib.gzip);

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
const detailRoot = path.resolve(args.get('detailRoot') || path.join(tvRoot, 'docs', 'data', 'iphone-detail'));
const pageSize = Math.max(50, Number(args.get('pageSize') || 240));
const pretty = args.get('pretty') === 'true';

const dataRoot = path.resolve(tvRoot, 'docs', 'data');
if (!detailRoot.startsWith(`${dataRoot}${path.sep}`)) {
  throw new Error(`Refusing to write detail chunks outside docs/data: ${detailRoot}`);
}

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
      .slice(0, 86) || fallback
  );
}

function sourceSlug(source, sourceId) {
  return slugify(`${source?.host || source?.key || source?.name || 'source'}-${sourceId || source?.id || ''}`, 'source');
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8');
}

function hasHeavyInlineDetail(item) {
  return Array.isArray(item?.episodes) || Boolean(item?.content || item?.actor || item?.director || item?.originalName);
}

function compactItem(item, detailPath, page) {
  const episodeCount = Number(item.episodeCount || item.episodes?.length || 0);
  const next = {
    ...item,
    episodeCount,
    playable: Boolean(item.playable || episodeCount > 0),
    lazyEpisodes: true,
    detailPage: page,
    detailPath,
  };
  delete next.episodes;
  delete next.content;
  delete next.actor;
  delete next.director;
  delete next.originalName;
  delete next.adultDetected;
  return next;
}

function fullDetailItem(item, detailPath, page) {
  return {
    ...item,
    episodeCount: Number(item.episodeCount || item.episodes?.length || 0),
    lazyEpisodes: false,
    detailPage: page,
    detailPath,
  };
}

function emptyKindTotals() {
  return { movies: 0, series: 0, variety: 0, anime: 0, short: 0, adult: 0, other: 0 };
}

function addKind(totals, item) {
  if (item.kind === 'series') totals.series += 1;
  else if (item.kind === 'variety') totals.variety += 1;
  else if (item.kind === 'anime') totals.anime += 1;
  else if (item.kind === 'short') totals.short += 1;
  else if (item.kind === 'adult' || item.adult) totals.adult += 1;
  else if (item.kind === 'other') totals.other += 1;
  else totals.movies += 1;
}

function classifyItem(item, sourceAdult = false) {
  return classifyVodKind({
    categoryName: item.categoryName || item.typeName || item.type_name || '',
    genre: item.genre || item.vod_class || item.class || '',
    title: item.title || item.vod_name || '',
    adult: item.adult || sourceAdult,
  });
}

function buildFilters(items) {
  const years = new Set();
  const areas = new Set();
  const genres = new Set();
  for (const item of items) {
    if (item.year) years.add(item.year);
    if (item.area) areas.add(item.area);
    for (const genre of item.genre || []) genres.add(genre);
  }
  return {
    years: [...years].sort((a, b) => b.localeCompare(a)).slice(0, 24),
    areas: [...areas].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 28),
    genres: [...genres].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 48),
  };
}

const catalog = await readJson(catalogPath);
if (!catalog) throw new Error(`Catalog not found: ${catalogPath}`);

if (!Array.isArray(catalog.items) || !catalog.items.length) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: 'source-only-catalog',
        catalog: path.relative(tvRoot, catalogPath).replace(/\\/g, '/'),
        sources: Array.isArray(catalog.sources) ? catalog.sources.length : 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const sourceById = new Map((catalog.sources || []).map((source) => [source.id, source]));
const itemsBySource = new Map();
for (const item of catalog.items || []) {
  const source = sourceById.get(item.sourceId);
  const next = {
    ...item,
    kind: classifyItem(item, source?.adult),
  };
  if (next.kind === 'adult') next.adult = true;
  if (!itemsBySource.has(next.sourceId)) itemsBySource.set(next.sourceId, []);
  itemsBySource.get(next.sourceId).push(next);
}

await fs.rm(detailRoot, { recursive: true, force: true });
await fs.mkdir(detailRoot, { recursive: true });

const compactItems = [];
const sourceDetailStats = new Map();
let compactedItems = 0;
let writtenChunks = 0;

for (const [sourceId, sourceItems] of itemsBySource.entries()) {
  const source = sourceById.get(sourceId);
  const slug = sourceSlug(source, sourceId);
  const sourceDir = path.join(detailRoot, slug);
  const shouldCompact = sourceItems.some(hasHeavyInlineDetail);
  if (!shouldCompact) {
    compactItems.push(...sourceItems);
    continue;
  }

  await fs.mkdir(sourceDir, { recursive: true });
  const chunks = [];
  for (let index = 0; index < sourceItems.length; index += pageSize) {
    chunks.push(sourceItems.slice(index, index + pageSize));
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const page = index + 1;
    const fileName = `page-${String(page).padStart(4, '0')}.json.gz`;
    const detailPath = `iphone-detail/${slug}/${fileName}`;
    const detailItems = chunks[index].map((item) => fullDetailItem(item, detailPath, page));
    const payload = {
      generatedAt: new Date().toISOString(),
      sourceId,
      sourceName: source?.name || '',
      page,
      pagecount: chunks.length,
      total: sourceItems.length,
      items: detailItems,
    };
    const compressed = await gzip(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
    await fs.writeFile(path.join(sourceDir, fileName), compressed);
    compactItems.push(...chunks[index].map((item) => compactItem(item, detailPath, page)));
    writtenChunks += 1;
  }

  compactedItems += sourceItems.length;
  sourceDetailStats.set(sourceId, {
    slug,
    detailPathPattern: `iphone-detail/${slug}/page-{page}.json.gz`,
    detailPageCount: chunks.length,
  });
}

const sources = (catalog.sources || []).map((source) => {
  const stats = sourceDetailStats.get(source.id);
  const categories = Array.isArray(source.categories)
    ? source.categories.map((category) => ({
        ...category,
        kind: classifyVodKind({ categoryName: category.name || category.type_name || category.kind || '', sourceAdult: source.adult }),
      }))
    : source.categories;
  if (!stats) return { ...source, categories };
  return {
    ...source,
    categories,
    detailMode: 'iphone-seed-gzip',
    detailPathPattern: stats.detailPathPattern,
    detailPageCount: stats.detailPageCount,
    detailExpectedPages: stats.detailPageCount,
    itemCount: itemsBySource.get(source.id)?.length || source.itemCount || 0,
    playableCount: (itemsBySource.get(source.id) || []).filter((item) => item.playable || item.episodeCount).length,
    indexed: true,
  };
});

const kindTotals = emptyKindTotals();
for (const item of compactItems) addKind(kindTotals, item);

const nextCatalog = {
  ...catalog,
  generatedAt: new Date().toISOString(),
  source: {
    ...(catalog.source || {}),
    iphoneCompacted: true,
    iphoneDetailRoot: path.relative(path.join(tvRoot, 'docs', 'data'), detailRoot).replace(/\\/g, '/'),
    iphoneDetailPageSize: pageSize,
    inlineItemsBeforeCompact: (catalog.items || []).length,
  },
  totals: {
    ...(catalog.totals || {}),
    items: compactItems.length,
    playableItems: compactItems.filter((item) => item.playable || item.episodeCount).length,
    ...kindTotals,
  },
  filters: buildFilters(compactItems),
  sources,
  items: compactItems,
};

await writeJson(catalogPath, nextCatalog);

const report = (await readJson(reportPath, {})) || {};
await writeJson(reportPath, {
  ...report,
  generatedAt: nextCatalog.generatedAt,
  totals: nextCatalog.totals,
  iphoneCompaction: {
    detailRoot: nextCatalog.source.iphoneDetailRoot,
    pageSize,
    compactedItems,
    writtenChunks,
    catalogBytes: Buffer.byteLength(JSON.stringify(nextCatalog), 'utf8'),
  },
});

console.log(
  JSON.stringify(
    {
      catalogPath,
      detailRoot,
      pageSize,
      compactedItems,
      writtenChunks,
      catalogBytes: Buffer.byteLength(JSON.stringify(nextCatalog), 'utf8'),
    },
    null,
    2,
  ),
);
