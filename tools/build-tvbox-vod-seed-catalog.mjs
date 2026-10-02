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

const repoRoot = path.resolve(args.get('repoRoot') || path.resolve(import.meta.dirname, '..'));
const input = path.resolve(args.get('input') || path.join(repoRoot, 'sources', 'TVBOX'));
const output = path.resolve(args.get('output') || path.join(repoRoot, 'docs', 'data', 'tvbox-vod-catalog.json'));
const reportOutput = path.resolve(
  args.get('report') || args.get('reportOutput') || path.join(repoRoot, 'docs', 'data', 'tvbox-vod-catalog-report.json'),
);
const detailRoot = path.resolve(args.get('detailRoot') || path.join(repoRoot, 'docs', 'data', 'vod-detail'));

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
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

async function readMaybeGzipJson(file) {
  const data = await fs.readFile(file);
  const text = /\.gz$/i.test(file) ? (await gunzip(data)).toString('utf8') : data.toString('utf8');
  return JSON.parse(text);
}

function nestedUrl(value) {
  try {
    return new URL(String(value || '')).searchParams.get('url') || '';
  } catch {
    return '';
  }
}

function normalizeApi(api) {
  const raw = normalizeText(api);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    if (url.searchParams.has('ac') && url.searchParams.size === 1) url.search = '';
    return url.toString().replace(/\/$/g, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/g, '').toLowerCase();
  }
}

function apiKeys(api) {
  const keys = [normalizeApi(api)].filter(Boolean);
  const nested = nestedUrl(api);
  if (nested) keys.push(normalizeApi(nested));
  return [...new Set(keys)];
}

function hostFromApi(api) {
  try {
    return new URL(String(api || '')).hostname.toLowerCase();
  } catch {
    try {
      return new URL(nestedUrl(api)).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}

function isLikelyVodApi(value) {
  const raw = normalizeText(value);
  if (!/^https?:\/\//i.test(raw)) return false;
  return /\/provide\/vod|api(?:json)?\.php|json\.php|apijson|\/feifei|apple_m3u8|\/vod\b/i.test(raw);
}

function crawlApiForSite(site) {
  const api = normalizeText(site.api);
  const ext = normalizeText(site.ext);
  const type = Number(site.type);
  if (type === 3 && isLikelyVodApi(ext)) return ext;
  if (isLikelyVodApi(api)) return api;
  if (isLikelyVodApi(ext)) return ext;
  return '';
}

function crawlType(site, api) {
  if (Number(site.type) === 0) return 0;
  return /(?:xml|\/at\/xml|feifei|apple_m3u8)/i.test(api) ? 0 : 1;
}

function sourceIdFallback(site, api, index) {
  const key = normalizeText(site.key || site.name || `source-${index + 1}`);
  return `tvbox-${slugify(`${key}-${api}-${index + 1}`, `source-${index + 1}`)}`;
}

async function collectExistingDetailRecords() {
  const byApi = new Map();
  let rows = [];
  try {
    rows = await fs.readdir(detailRoot, { withFileTypes: true });
  } catch {
    return byApi;
  }

  for (const row of rows) {
    if (!row.isDirectory() || row.name.startsWith('.')) continue;
    const sourceDir = path.join(detailRoot, row.name);
    let files = [];
    try {
      files = (await fs.readdir(sourceDir)).filter((file) => /^page-\d+\.json(?:\.gz)?$/i.test(file)).sort();
    } catch {
      files = [];
    }
    if (files.length === 0) continue;

    let first = null;
    try {
      first = await readMaybeGzipJson(path.join(sourceDir, files[0]));
    } catch {
      continue;
    }

    const record = {
      dirName: row.name,
      sourceId: normalizeText(first.sourceId),
      sourceName: normalizeText(first.sourceName),
      sourceKey: normalizeText(first.sourceKey),
      api: normalizeText(first.api),
      host: hostFromApi(first.api),
      pageCount: files.length,
      expectedPages: Number(first.pagecount || 0) || files.length,
      total: Number(first.total || 0) || 0,
      complete: files.length >= (Number(first.pagecount || 0) || files.length),
    };
    if (!record.sourceId || !record.api) continue;

    for (const key of apiKeys(record.api)) {
      if (!byApi.has(key)) byApi.set(key, []);
      byApi.get(key).push(record);
    }
  }
  return byApi;
}

function scoreExistingRecord(record, site) {
  const key = normalizeText(site.key);
  const name = normalizeText(site.name);
  let score = record.pageCount;
  if (record.complete) score += 1_000_000;
  if (record.sourceKey === key) score += 200_000;
  if (record.sourceName === name) score += 100_000;
  if (/^all-on-demand-sources-/i.test(record.sourceId)) score += 10_000;
  if (/^current-vod-url-/i.test(record.sourceId)) score -= 5_000;
  return score;
}

function chooseExisting(byApi, api, site) {
  const candidates = apiKeys(api).flatMap((key) => byApi.get(key) || []);
  if (candidates.length === 0) return null;
  return candidates
    .map((record) => ({ record, score: scoreExistingRecord(record, site) }))
    .sort((a, b) => b.score - a.score)[0].record;
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
    itemCount: source.itemCount,
    playableCount: source.playableCount,
    sourceTotalCount: source.sourceTotalCount,
    complete: source.complete,
    detailPageCount: source.detailPageCount,
    detailExpectedPages: source.detailExpectedPages,
    detailPathPattern: source.detailPathPattern,
    unsupportedReason: source.unsupportedReason,
    mappedDetailDir: source.mappedDetailDir,
  };
}

const tvbox = await readJson(input);
const sites = Array.isArray(tvbox) ? tvbox : Array.isArray(tvbox.sites) ? tvbox.sites : [];
const existingByApi = await collectExistingDetailRecords();
const sources = [];
let mappedExisting = 0;
let indexableSources = 0;

for (const [index, site] of sites.entries()) {
  const key = normalizeText(site.key || site.name || `source-${index + 1}`);
  const name = normalizeText(site.name || key);
  const api = crawlApiForSite(site);
  const categories = Array.isArray(site.categories) ? site.categories.map((item) => normalizeText(item)).filter(Boolean) : [];

  if (!api) {
    sources.push({
      id: sourceIdFallback(site, normalizeText(site.api || site.ext || key), index),
      key,
      name,
      type: Number(site.type) || 1,
      api: normalizeText(site.api),
      ext: normalizeText(site.ext),
      origin: 'sources/TVBOX',
      adult: Boolean(site.adult),
      categories,
      indexable: false,
      indexed: false,
      itemCount: 0,
      playableCount: 0,
      sourceTotalCount: 0,
      unsupportedReason: 'not a direct VOD API source',
    });
    continue;
  }

  const existing = chooseExisting(existingByApi, api, site);
  if (existing) mappedExisting += 1;
  indexableSources += 1;
  const id = existing?.sourceId || sourceIdFallback(site, api, index);
  const host = existing?.host || hostFromApi(api);
  const detailPageCount = existing?.pageCount || 0;
  const detailExpectedPages = existing?.expectedPages || 0;
  const complete = detailExpectedPages > 0 ? detailPageCount >= detailExpectedPages : false;

  sources.push({
    id,
    key,
    name,
    type: crawlType(site, api),
    api,
    host,
    origin: 'sources/TVBOX',
    adult: Boolean(site.adult),
    categories,
    indexable: true,
    indexed: detailPageCount > 0,
    itemCount: existing?.total || 0,
    playableCount: 0,
    sourceTotalCount: existing?.total || 0,
    complete,
    detailPageCount,
    detailExpectedPages,
    detailPathPattern: `vod-detail/${slugify(`${host || key}-${id}`, 'source')}/page-{page}.json.gz`,
    mappedDetailDir: existing?.dirName || '',
    tvboxType: Number(site.type) || 1,
    tvboxApi: normalizeText(site.api),
    tvboxExt: normalizeText(site.ext),
  });
}

const generatedAt = new Date().toISOString();
const catalog = {
  generatedAt,
  source: {
    name: 'TVBOX all VOD sources',
    input: path.relative(repoRoot, input).replace(/\\/g, '/'),
    detailRoot: 'docs/data/vod-detail',
  },
  totals: {
    sources: sources.length,
    indexableSources,
    unsupportedSources: sources.length - indexableSources,
    mappedExistingSources: mappedExisting,
    items: 0,
    playableItems: 0,
  },
  filters: { years: [], areas: [], genres: [] },
  sources,
  items: [],
};

const report = {
  generatedAt,
  totals: catalog.totals,
  sourceChecks: sources.map(sourceCheck),
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await fs.writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      output,
      reportOutput,
      sources: sources.length,
      indexableSources,
      unsupportedSources: sources.length - indexableSources,
      mappedExistingSources: mappedExisting,
    },
    null,
    2,
  ),
);
