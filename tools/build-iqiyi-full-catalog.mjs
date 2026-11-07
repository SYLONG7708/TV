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
const detailDir = path.resolve(args.get('detailDir') || path.join(tvRoot, 'docs', 'data', 'vod-detail', 'iqiyi'));
const pageSize = Number(args.get('pageSize') || 100);
const concurrency = Number(args.get('concurrency') || 10);
const timeoutMs = Number(args.get('timeoutMs') || 20000);
const sourceMatch = String(args.get('sourceMatch') || 'iqiyizyapi');

const USER_AGENT = 'OKTV-iQiyi-full-catalog-builder/1.0';

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function addVodQuery(api, query) {
  const value = String(api || '').trim();
  if (!value) return '';
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  return `${value}?${query}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: withTimeout(),
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return JSON.parse(await res.text());
}

function imageUrl(baseUrl, value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const first = raw.split(/[,\s]+/).find(Boolean) || raw;
  try {
    return new URL(first, baseUrl).toString().replace(/^http:/i, 'https:');
  } catch {
    return first.replace(/^http:/i, 'https:');
  }
}

function parseYear(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? match[0] : '';
}

function parseNumber(value) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseScore(value) {
  return parseNumber(value);
}

function parseEpoch(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const time = Date.parse(raw.replace(/-/g, '/'));
  return Number.isFinite(time) ? time : 0;
}

function normalizeArea(value) {
  return normalizeText(value)
    .replace(/中国大陆|中國大陸|大陆|大陸/g, '大陸')
    .replace(/中国香港|中國香港/g, '香港')
    .replace(/中国台湾|中國台灣/g, '台灣')
    .replace(/韩国|韓國/g, '韓國')
    .replace(/日本/g, '日本')
    .replace(/泰国|泰國/g, '泰國')
    .replace(/欧美|歐美/g, '歐美');
}

function splitClasses(value, fallback = '') {
  return [...new Set(`${value || ''},${fallback || ''}`.split(/[,\s/、]+/).map(normalizeText).filter(Boolean))];
}

function kindFromTypeName(typeName) {
  return classifyVodKind(typeName);
}

function isDirectMediaUrl(value) {
  return /\.(m3u8|mp4|m4v|webm|mov|flv|ts)(?:$|[?#])/i.test(String(value || '').trim());
}

function parseEpisodes(playUrl) {
  const raw = String(playUrl || '').trim();
  if (!raw) return [];
  const groups = raw.split('$$$').filter(Boolean);
  const firstUsableGroup = groups.find((group) => /https?:\/\//i.test(group)) || groups[0] || '';
  return firstUsableGroup
    .split('#')
    .map((part, index) => {
      const bits = part.split('$');
      const url = bits.length > 1 ? bits.at(-1) : part;
      const name = bits.length > 1 ? bits.slice(0, -1).join('$') : `第${index + 1}集`;
      const cleanUrl = normalizeText(url);
      if (!/^https?:\/\//i.test(cleanUrl)) return null;
      if (!isDirectMediaUrl(cleanUrl)) return null;
      return {
        name: normalizeText(name, `第${index + 1}集`),
        url: cleanUrl,
      };
    })
    .filter(Boolean);
}

function textId(input, index = 0) {
  const value = normalizeText(input, `item-${index}`)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${value || 'item'}-${index + 1}`;
}

function normalizeVodItem(item, source, page) {
  const title = normalizeText(item.vod_name ?? item.name ?? item.title);
  if (!title) return null;
  const typeName = normalizeText(item.type_name || '');
  const episodes = parseEpisodes(item.vod_play_url || item.play_url || item.url);
  const year = parseYear(item.vod_year || item.year || item.vod_time || item.update_time || item.vod_pubdate);
  const area = normalizeArea(item.vod_area || item.area || item.region || '');
  const genre = splitClasses(item.vod_class || item.class || item.tag, typeName);
  const score = parseScore(item.vod_score || item.score || item.douban_score);
  const views = parseNumber(item.vod_hits || item.hits || item.views || item.play_count || item.vod_up);
  const updatedAt = normalizeText(item.vod_time || item.update_time || item.vod_pubdate || item.created_at || '');
  const vodId = String(item.vod_id ?? item.id ?? '');
  const id = `${source.id}::${normalizeText(vodId || title)}`;
  return {
    id: textId(id, 0),
    sourceId: source.id,
    sourceName: source.name,
    vodId,
    title,
    originalName: normalizeText(item.vod_en || item.original_name || ''),
    kind: classifyVodKind({ categoryName: typeName, genre }),
    categoryId: String(item.type_id || ''),
    categoryName: typeName,
    year,
    area,
    genre,
    remarks: normalizeText(item.vod_remarks || item.remarks || item.note || ''),
    actor: normalizeText(item.vod_actor || item.actor || ''),
    director: normalizeText(item.vod_director || item.director || ''),
    content: normalizeText(item.vod_content || item.content || item.desc || '').slice(0, 220),
    score,
    views,
    hot: views + score * 100 + parseEpoch(updatedAt) / 100000000,
    updatedAt,
    poster: imageUrl(source.api, item.vod_pic || item.pic || item.cover || item.logo),
    episodes,
    episodeCount: episodes.length,
    playable: episodes.length > 0,
    adult: false,
    detailPage: page,
    detailPath: `vod-detail/iqiyi/page-${String(page).padStart(3, '0')}.json.gz`,
  };
}

function compactItem(item) {
  const { episodes, ...rest } = item;
  return {
    ...rest,
    lazyEpisodes: true,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function extractList(payload) {
  return Array.isArray(payload?.list) ? payload.list : Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchPage(source, page) {
  const payload = await fetchJson(addVodQuery(source.api, `ac=detail&pg=${page}&pagesize=${pageSize}`));
  const rows = extractList(payload)
    .map((item) => normalizeVodItem(item, source, page))
    .filter((item) => item && item.poster && item.playable);
  return {
    page,
    pagecount: Number(payload.pagecount || 1) || 1,
    total: Number(payload.total || 0) || 0,
    rows,
  };
}

function recomputeTotals(items, sources) {
  return {
    sources: sources.length,
    indexedSources: sources.filter((source) => source.indexed).length,
    items: items.length,
    playableItems: items.filter((item) => item.playable).length,
    movies: items.filter((item) => item.kind === 'movie').length,
    series: items.filter((item) => item.kind === 'series').length,
    variety: items.filter((item) => item.kind === 'variety').length,
    anime: items.filter((item) => item.kind === 'anime').length,
    short: items.filter((item) => item.kind === 'short').length,
    adult: items.filter((item) => item.kind === 'adult' || item.adult).length,
  };
}

function recomputeFilters(items) {
  return {
    years: [...new Set(items.map((item) => item.year).filter(Boolean))].sort((a, b) => b.localeCompare(a)).slice(0, 24),
    areas: [...new Set(items.map((item) => item.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 28),
    genres: [...new Set(items.flatMap((item) => item.genre || []).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .slice(0, 42),
  };
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
    error: source.error,
    checks: source.checks,
  };
}

const catalog = await readJson(catalogPath);
const source = catalog.sources.find((item) => normalizeText([item.name, item.key, item.api, item.host].join(' ')).toLowerCase().includes(sourceMatch.toLowerCase()));
if (!source) throw new Error(`Source not found: ${sourceMatch}`);

await fs.rm(detailDir, { recursive: true, force: true });
await fs.mkdir(detailDir, { recursive: true });

const firstPage = await fetchPage(source, 1);
const pagecount = firstPage.pagecount;
const pages = [firstPage, ...(await mapLimit(
  Array.from({ length: Math.max(0, pagecount - 1) }, (_, index) => index + 2),
  concurrency,
  async (page) => {
    const result = await fetchPage(source, page);
    if (page % 25 === 0 || page === pagecount) {
      console.log(`Fetched iQiyi page ${page}/${pagecount}`);
    }
    return result;
  },
))].sort((a, b) => a.page - b.page);

const compactItems = [];
let playableCount = 0;
let sourceTotalCount = 0;
for (const page of pages) {
  const detailPayload = {
    generatedAt: new Date().toISOString(),
    sourceId: source.id,
    sourceName: source.name,
    api: source.api,
    page: page.page,
    pagecount,
    total: page.total,
    items: page.rows,
  };
  const compressed = await gzip(Buffer.from(JSON.stringify(detailPayload), 'utf8'), { level: 9 });
  await fs.writeFile(path.join(detailDir, `page-${String(page.page).padStart(3, '0')}.json.gz`), compressed);
  compactItems.push(...page.rows.map(compactItem));
  playableCount += page.rows.filter((item) => item.playable).length;
  sourceTotalCount = Math.max(sourceTotalCount, page.total);
}

const compactById = new Map();
for (const item of compactItems) {
  if (!compactById.has(item.id)) compactById.set(item.id, item);
}
const uniqueCompactItems = [...compactById.values()];
const otherItems = (catalog.items || []).filter((item) => item.sourceId !== source.id);
catalog.items = [...otherItems, ...uniqueCompactItems];

const sourceIndex = catalog.sources.findIndex((item) => item.id === source.id);
catalog.sources[sourceIndex] = {
  ...source,
  itemCount: uniqueCompactItems.length,
  playableCount,
  sourceTotalCount,
  indexed: uniqueCompactItems.length > 0,
  detailMode: 'chunked-gzip',
  detailPathPattern: 'vod-detail/iqiyi/page-{page}.json.gz',
  checks: [
    {
      label: 'latest-full',
      ok: true,
      count: uniqueCompactItems.length,
      pages: pagecount,
      pagecount,
      total: sourceTotalCount,
    },
  ],
  error: '',
};

catalog.generatedAt = new Date().toISOString();
catalog.source = {
  ...(catalog.source || {}),
  iqiyiFullCatalog: true,
  iqiyiDetailDir: 'docs/data/vod-detail/iqiyi',
  iqiyiPageSize: pageSize,
};
catalog.totals = recomputeTotals(catalog.items, catalog.sources);
catalog.filters = recomputeFilters(catalog.items);

const report = {
  generatedAt: catalog.generatedAt,
  totals: catalog.totals,
  sourceChecks: catalog.sources.map(sourceCheck),
};

await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      catalogPath,
      reportPath,
      detailDir,
      pagecount,
      total: sourceTotalCount,
      indexed: uniqueCompactItems.length,
      playable: playableCount,
    },
    null,
    2,
  ),
);
