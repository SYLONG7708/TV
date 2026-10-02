import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { parseVodPayload } from './vod-payload-parser.mjs';

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
const indexRoot = path.resolve(args.get('indexRoot') || path.join(repoRoot, 'docs', 'data', 'vod-index'));
const catalogPath = path.resolve(args.get('catalog') || path.join(repoRoot, 'docs', 'data', 'tvbox-vod-catalog.json'));
const output = path.resolve(args.get('output') || path.join(repoRoot, 'docs', 'data', 'tvbox-vod-freshness-report.json'));
const timeoutMs = Number(args.get('timeoutMs') || 12000);
const concurrency = Math.max(1, Number(args.get('concurrency') || 8));
const pageSize = Math.max(1, Number(args.get('pageSize') || 20));
const maxSources = Math.max(0, Number(args.get('maxSources') || 0));

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

function sourceIdFallback(site, api, index) {
  const key = normalizeText(site.key || site.name || `source-${index + 1}`);
  return `tvbox-${slugify(`${key}-${api}-${index + 1}`, `source-${index + 1}`)}`;
}

async function readJson(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

async function readMaybeGzipJson(file) {
  const data = await fs.readFile(file);
  const text = /\.gz$/i.test(file) ? (await gunzip(data)).toString('utf8') : data.toString('utf8');
  return JSON.parse(text);
}

function dateMs(value) {
  const raw = normalizeText(value);
  if (!raw) return 0;
  const timestamp = raw.match(/^\d{10,13}$/)?.[0];
  if (timestamp) {
    const number = Number(timestamp);
    return timestamp.length === 10 ? number * 1000 : number;
  }

  const match = raw.match(
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (!match) return 0;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function itemDate(item) {
  return normalizeText(
    item?.updatedAt ||
      item?.vod_time ||
      item?.vod_time_update ||
      item?.vod_time_add ||
      item?.vod_addtime ||
      item?.time ||
      item?.last ||
      item?.addtime,
  );
}

function itemTitle(item) {
  return normalizeText(item?.title || item?.name || item?.vod_name || item?.vod_title || item?.vod_en);
}

function newerItem(current, item) {
  const updatedAt = itemDate(item);
  const updatedAtMs = dateMs(updatedAt);
  if (!updatedAtMs || updatedAtMs <= (current?.updatedAtMs || 0)) return current;
  return {
    title: itemTitle(item),
    updatedAt,
    updatedAtMs,
  };
}

function extractList(payload) {
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.videos)) return payload.videos;
  return [];
}

function buildVideolistUrl(api) {
  const url = new URL(api);
  url.searchParams.set('ac', 'videolist');
  url.searchParams.set('pg', '1');
  url.searchParams.set('pagesize', String(pageSize));
  return url.toString();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'OKTV-TVBOX-Freshness/1.0',
        accept: 'application/json,text/xml,text/plain,*/*',
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function readSavedIndexes() {
  const records = [];
  let files = [];
  try {
    files = (await fs.readdir(indexRoot)).filter((file) => /\.json(?:\.gz)?$/i.test(file)).sort();
  } catch {
    files = [];
  }

  for (const file of files) {
    let data = null;
    try {
      data = await readMaybeGzipJson(path.join(indexRoot, file));
    } catch (error) {
      records.push({ file, error: error.message });
      continue;
    }

    let latest = null;
    for (const item of data.items || []) {
      latest = newerItem(latest, item);
    }

    records.push({
      file,
      sourceId: normalizeText(data.sourceId),
      sourceName: normalizeText(data.sourceName),
      itemCount: Number(data.itemCount || data.items?.length || 0),
      latestTitle: latest?.title || '',
      latest: latest?.updatedAt || '',
      latestMs: latest?.updatedAtMs || 0,
    });
  }
  return records;
}

async function readCatalogSources() {
  try {
    const catalog = await readJson(catalogPath);
    return Array.isArray(catalog.sources) ? catalog.sources : [];
  } catch {
    return [];
  }
}

function buildSavedLookups(indexRecords, catalogSources) {
  const bySourceId = new Map();
  const byName = new Map();
  const byApi = new Map();

  for (const record of indexRecords) {
    if (record.sourceId) bySourceId.set(record.sourceId, record);
    if (record.sourceName) byName.set(record.sourceName.toLowerCase(), record);
  }

  for (const source of catalogSources) {
    const record = bySourceId.get(normalizeText(source.id));
    if (!record) continue;
    for (const key of apiKeys(source.api)) byApi.set(key, record);
    if (source.name) byName.set(normalizeText(source.name).toLowerCase(), record);
  }

  return { bySourceId, byName, byApi };
}

function matchSavedRecord(site, api, index, lookups) {
  for (const key of apiKeys(api)) {
    if (lookups.byApi.has(key)) return lookups.byApi.get(key);
  }

  const sourceId = sourceIdFallback(site, api, index);
  if (lookups.bySourceId.has(sourceId)) return lookups.bySourceId.get(sourceId);

  const name = normalizeText(site.name).toLowerCase();
  if (name && lookups.byName.has(name)) return lookups.byName.get(name);
  return null;
}

async function checkSource(source) {
  const { site, api, index, saved } = source;
  const check = {
    index: index + 1,
    name: normalizeText(site.name || site.key || `source-${index + 1}`),
    key: normalizeText(site.key),
    api,
    savedLatest: saved?.latest || '',
    savedLatestTitle: saved?.latestTitle || '',
    savedItemCount: saved?.itemCount || 0,
    liveLatest: '',
    liveLatestTitle: '',
    liveItemCount: 0,
    changed: false,
    error: '',
  };

  try {
    const text = await fetchWithTimeout(buildVideolistUrl(api));
    const payload = parseVodPayload(text);
    const list = extractList(payload);
    let latest = null;
    for (const item of list) latest = newerItem(latest, item);
    check.liveItemCount = list.length;
    check.liveLatest = latest?.updatedAt || '';
    check.liveLatestTitle = latest?.title || '';
    check.changed = Boolean(latest?.updatedAtMs && saved?.latestMs && latest.updatedAtMs > saved.latestMs);
    check.liveNewerThanSavedGlobal = false;
    check.liveLatestMs = latest?.updatedAtMs || 0;
    check.savedLatestMs = saved?.latestMs || 0;
  } catch (error) {
    check.error = error.message;
  }

  return check;
}

async function runLimited(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const [tvbox, indexRecords, catalogSources] = await Promise.all([readJson(input), readSavedIndexes(), readCatalogSources()]);
const lookups = buildSavedLookups(indexRecords, catalogSources);
const savedGlobal = indexRecords.reduce((latest, record) => (record.latestMs > (latest?.latestMs || 0) ? record : latest), null);
const sites = Array.isArray(tvbox.sites) ? tvbox.sites : [];
const checkableSources = [];

for (let index = 0; index < sites.length; index += 1) {
  const site = sites[index];
  const api = crawlApiForSite(site);
  if (!api) continue;
  checkableSources.push({
    site,
    api,
    index,
    saved: matchSavedRecord(site, api, index, lookups),
  });
}

const limitedSources = maxSources > 0 ? checkableSources.slice(0, maxSources) : checkableSources;
const sourceChecks = await runLimited(limitedSources, checkSource);
for (const check of sourceChecks) {
  check.liveNewerThanSavedGlobal = Boolean(check.liveLatestMs && savedGlobal?.latestMs && check.liveLatestMs > savedGlobal.latestMs);
}

const liveGlobal = sourceChecks.reduce(
  (latest, check) => (check.liveLatestMs > (latest?.liveLatestMs || 0) ? check : latest),
  null,
);
const changedSources = sourceChecks.filter((check) => check.changed);
const hasNewerUpstream =
  changedSources.length > 0 || Boolean(liveGlobal?.liveLatestMs && savedGlobal?.latestMs && liveGlobal.liveLatestMs > savedGlobal.latestMs);

const report = {
  generatedAt: new Date().toISOString(),
  input: path.relative(repoRoot, input).replace(/\\/g, '/'),
  indexRoot: path.relative(repoRoot, indexRoot).replace(/\\/g, '/'),
  savedGlobalLatest: savedGlobal
    ? {
        sourceName: savedGlobal.sourceName,
        title: savedGlobal.latestTitle,
        updatedAt: savedGlobal.latest,
        file: savedGlobal.file,
      }
    : null,
  liveGlobalLatest: liveGlobal
    ? {
        sourceName: liveGlobal.name,
        title: liveGlobal.liveLatestTitle,
        updatedAt: liveGlobal.liveLatest,
        api: liveGlobal.api,
      }
    : null,
  hasNewerUpstream,
  summary: {
    checkedSources: sourceChecks.length,
    okSources: sourceChecks.filter((check) => !check.error).length,
    failedSources: sourceChecks.filter((check) => check.error).length,
    changedSources: changedSources.length,
  },
  newestUpstreamItems: sourceChecks
    .filter((check) => check.liveLatestMs)
    .sort((a, b) => b.liveLatestMs - a.liveLatestMs)
    .slice(0, 20)
    .map((check) => ({
      sourceName: check.name,
      title: check.liveLatestTitle,
      updatedAt: check.liveLatest,
      changed: check.changed,
      liveNewerThanSavedGlobal: check.liveNewerThanSavedGlobal,
    })),
  sourceChecks: sourceChecks.map(({ liveLatestMs, savedLatestMs, ...check }) => check),
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify({
    hasNewerUpstream: report.hasNewerUpstream,
    savedGlobalLatest: report.savedGlobalLatest?.updatedAt || '',
    liveGlobalLatest: report.liveGlobalLatest?.updatedAt || '',
    checkedSources: report.summary.checkedSources,
    changedSources: report.summary.changedSources,
    failedSources: report.summary.failedSources,
    output: path.relative(repoRoot, output).replace(/\\/g, '/'),
  }),
);
