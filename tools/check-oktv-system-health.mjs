import fs from 'node:fs/promises';
import path from 'node:path';
import { parseVodPayload } from './vod-payload-parser.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (!key.startsWith('--')) continue;
  args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
  if (next && !next.startsWith('--')) index += 1;
}

const baseUrl = String(args.get('baseUrl') || 'https://sylong7708.github.io/TV').replace(/\/+$/, '');
const dataBase = `${baseUrl}/docs/data`;
const timeoutMs = Number(args.get('timeoutMs') || 10_000);
const concurrency = Math.max(1, Number(args.get('concurrency') || 10));
const maxVodAgeHours = Number(args.get('maxVodAgeHours') || 30);
const maxLiveAgeHours = Number(args.get('maxLiveAgeHours') || 8);
const minIndexAvailability = Number(args.get('minIndexAvailability') || 0.98);
const minApiAvailability = Number(args.get('minApiAvailability') || 0.7);
const probeApis = args.get('probeApis') !== 'false';
const failOnDegraded = args.get('failOnDegraded') !== 'false';
const output = args.get('output') ? path.resolve(args.get('output')) : '';

function ageHours(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? (Date.now() - parsed) / 36e5 : Number.POSITIVE_INFINITY;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || timeoutMs));
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: options.accept || '*/*',
        'cache-control': 'no-cache',
        'user-agent': 'OKTV-system-health/1.0',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(relativePath) {
  const url = `${dataBase}/${relativePath}?health=${Date.now()}`;
  const response = await fetchWithTimeout(url, { accept: 'application/json' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function probeStaticIndex(source) {
  if (!source?.indexPath) return { id: source?.id || '', name: source?.name || '', ok: false, error: 'missing indexPath' };
  const url = new URL(source.indexPath.replace(/^\/+/, ''), `${dataBase}/`).href;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      let response = await fetchWithTimeout(`${url}?health=${Date.now()}`, { method: 'HEAD' });
      if (response.status === 405) {
        response = await fetchWithTimeout(`${url}?health=${Date.now()}`, {
          headers: { range: 'bytes=0-1' },
        });
      }
      const bytes = Number(response.headers.get('content-length') || 0);
      const ok = response.ok && (bytes > 20 || response.status === 206);
      if (ok || (response.status >= 400 && response.status < 500)) {
        return {
          id: source.id,
          name: source.name,
          url,
          ok,
          status: response.status,
          bytes,
          error: ok ? '' : `HTTP ${response.status}`,
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { id: source.id, name: source.name, url, ok: false, status: 0, bytes: 0, error: lastError };
}

function sourceProbeUrl(source) {
  const url = new URL(source.api);
  if (url.protocol === 'http:') url.protocol = 'https:';
  const nestedValue = url.searchParams.get('url');
  if (nestedValue && /^https?:\/\//i.test(nestedValue)) {
    const nested = new URL(nestedValue);
    if (!nested.searchParams.has('ac')) nested.searchParams.set('ac', 'detail');
    if (!nested.searchParams.has('pg')) nested.searchParams.set('pg', '1');
    url.searchParams.set('url', nested.href);
    return url.href;
  }
  if (!url.searchParams.has('ac')) url.searchParams.set('ac', 'detail');
  if (!url.searchParams.has('pg')) url.searchParams.set('pg', '1');
  return url.href;
}

async function probeVodApi(source) {
  if (Number(source?.type || 1) === 3 || !/^https?:\/\//i.test(String(source?.api || ''))) {
    return { id: source?.id || '', name: source?.name || '', skipped: true, ok: true, error: '' };
  }
  let url = '';
  try {
    url = sourceProbeUrl(source);
    const response = await fetchWithTimeout(url, { accept: 'application/json, application/xml, text/xml, */*' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (/<!doctype html|<html\b/i.test(text.slice(0, 2048))) throw new Error('HTML challenge instead of VOD data');
    const payload = parseVodPayload(text);
    const rows = Array.isArray(payload?.list)
      ? payload.list
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.videos)
          ? payload.videos
          : [];
    const declared = Number(payload?.total || payload?.recordcount || payload?.totalCount || 0);
    if (rows.length < 1 && declared < 1) throw new Error('empty VOD payload');
    return { id: source.id, name: source.name, url, ok: true, items: rows.length, total: declared, error: '' };
  } catch (error) {
    return { id: source?.id || '', name: source?.name || '', url, ok: false, items: 0, total: 0, error: error.message };
  }
}

const coreNames = [
  'lunatv-vod-update-state.json',
  'iphone-vod-catalog-report.json',
  'iphone-vod-catalog.json',
  'iphone-vod-latest.json',
  'source-summary.json',
  'live-channels.json',
];
const coreEntries = await Promise.all(
  coreNames.map(async (name) => {
    try {
      return { name, ok: true, value: await fetchJson(name), error: '' };
    } catch (error) {
      return { name, ok: false, value: null, error: error.message };
    }
  }),
);
const values = Object.fromEntries(coreEntries.map((entry) => [entry.name, entry.value]));
const state = values['lunatv-vod-update-state.json'] || {};
const catalogReport = values['iphone-vod-catalog-report.json'] || {};
const catalog = values['iphone-vod-catalog.json'] || {};
const latest = values['iphone-vod-latest.json'] || {};
const summary = values['source-summary.json'] || {};
const liveChannels = Array.isArray(values['live-channels.json']) ? values['live-channels.json'] : [];
const sources = Array.isArray(catalog.sources) ? catalog.sources : [];

let pageOk = false;
let pageError = '';
try {
  const response = await fetchWithTimeout(`${baseUrl}/docs/iphone/index.html?health=${Date.now()}`, { accept: 'text/html' });
  const html = response.ok ? await response.text() : '';
  pageOk = response.ok && /<!doctype html/i.test(html) && /ONLINE_DATA_BASE/.test(html);
  if (!pageOk) pageError = response.ok ? 'unexpected HTML shell' : `HTTP ${response.status}`;
} catch (error) {
  pageError = error.message;
}

const indexProbes = await mapLimit(sources, concurrency, probeStaticIndex);
const apiProbes = probeApis ? await mapLimit(sources, concurrency, probeVodApi) : [];
const checkedApis = apiProbes.filter((entry) => !entry.skipped);
const vodAge = Math.max(ageHours(state.lastSuccessAt), ageHours(catalogReport.generatedAt));
const liveReference = summary.live?.lastSuccessfulAt || summary.live?.lastAttemptAt || summary.lastLiveAttemptAt || summary.generatedAt;
const liveAge = ageHours(liveReference);
const declaredItems = Number(catalog.totals?.items || 0);
const summedItems = sources.reduce((sum, source) => sum + Number(source.itemCount || 0), 0);
const indexOk = indexProbes.filter((entry) => entry.ok).length;
const apiOk = checkedApis.filter((entry) => entry.ok).length;
const indexRatio = sources.length ? indexOk / sources.length : 0;
const apiRatio = checkedApis.length ? apiOk / checkedApis.length : 1;
const liveUsable = liveChannels.filter(
  (channel) => channel?.playable && /^https?:\/\//i.test(String(channel.embedUrl || channel.pageUrl || channel.url || '')),
).length;

const checks = {
  coreFiles: coreEntries.every((entry) => entry.ok),
  pageShell: pageOk,
  vodFresh: vodAge <= maxVodAgeHours,
  catalogStructure: sources.length > 0 && declaredItems > 0 && declaredItems === summedItems,
  latestFeed: Array.isArray(latest.items) && latest.items.length > 0,
  sourceIndexes: indexRatio >= minIndexAvailability,
  sourceApis: apiRatio >= minApiAvailability,
  liveFresh: liveAge <= maxLiveAgeHours,
  liveUsable: liveChannels.length > 0 && liveUsable > 0,
};
const report = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  ok: Object.values(checks).every(Boolean),
  repair: {
    vod: !checks.coreFiles || !checks.pageShell || !checks.vodFresh || !checks.catalogStructure || !checks.latestFeed || !checks.sourceIndexes || !checks.sourceApis,
    live: !checks.coreFiles || !checks.liveFresh || !checks.liveUsable,
  },
  checks,
  metrics: {
    vodAgeHours: Number.isFinite(vodAge) ? Number(vodAge.toFixed(2)) : null,
    liveAgeHours: Number.isFinite(liveAge) ? Number(liveAge.toFixed(2)) : null,
    sources: sources.length,
    declaredItems,
    summedItems,
    latestItems: Array.isArray(latest.items) ? latest.items.length : 0,
    indexOk,
    indexFailed: sources.length - indexOk,
    indexAvailability: Number(indexRatio.toFixed(4)),
    apiOk,
    apiFailed: checkedApis.length - apiOk,
    apiSkipped: apiProbes.filter((entry) => entry.skipped).length,
    apiAvailability: Number(apiRatio.toFixed(4)),
    liveChannels: liveChannels.length,
    liveUsable,
  },
  failures: {
    core: coreEntries.filter((entry) => !entry.ok).map(({ name, error }) => ({ name, error })),
    page: pageOk ? [] : [{ error: pageError }],
    indexes: indexProbes.filter((entry) => !entry.ok),
    apis: checkedApis.filter((entry) => !entry.ok),
  },
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, json, 'utf8');
}
process.stdout.write(json);
if (!report.ok && failOnDegraded) process.exitCode = 1;
