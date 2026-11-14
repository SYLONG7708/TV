import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyVodKind } from './vod-kind-rules.mjs';

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
const api = args.get('api') || 'https://cj.lziapi.com/api.php/provide/vod/';
const outputDir = path.resolve(args.get('outputDir') || path.join(repoRoot, 'docs', 'data', 'quantum-lzi'));
const concurrency = Math.max(1, Number(args.get('concurrency') || 18));
const timeoutMs = Math.max(5000, Number(args.get('timeoutMs') || 20000));
const episodePreviewLimit = Math.max(0, Number(args.get('episodePreviewLimit') || 3));
const USER_AGENT = 'OKTV-quantum-lzi-full-builder/1.0';

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

function addVodQuery(baseApi, query) {
  const value = String(baseApi || '').trim();
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  return `${value}?${query}`;
}

async function fetchJson(url, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: withTimeout(),
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': USER_AGENT,
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function normalizeArea(value) {
  return normalizeText(value)
    .replace(/中国大陆|中國大陸|内地|內地|大陆/g, '大陸')
    .replace(/中国台湾|中国台灣|中国臺灣|中國台湾|中國台灣|中國臺灣/g, '台灣')
    .replace(/中国香港|中國香港|香港地区/g, '香港')
    .replace(/中国澳门|中國澳門|澳门|澳門/g, '澳門')
    .replace(/韩国|韓国/g, '韓國')
    .replace(/台湾|臺灣/g, '台灣')
    .replace(/日本/g, '日本')
    .replace(/泰国|泰國/g, '泰國')
    .replace(/美国|美國/g, '美國')
    .replace(/英国|英國/g, '英國')
    .replace(/欧美|歐美/g, '歐美')
    .replace(/海外/g, '海外');
}

function splitClasses(value, fallback = '') {
  return [
    ...new Set(
      `${value || ''},${fallback || ''}`
        .split(/[,\s/、]+/)
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
}

function parseNumber(value) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseYear(...values) {
  for (const value of values) {
    const match = String(value || '').match(/(?:19|20)\d{2}/);
    if (match) return match[0];
  }
  return '';
}

function parseEpoch(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const time = Date.parse(raw.replace(/-/g, '/'));
  return Number.isFinite(time) ? time : 0;
}

function kindFromTypeName(typeName) {
  return classifyVodKind(typeName);
}

function normalizeImage(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return raw.split(/[,\s]+/).find(Boolean)?.replace(/^http:/i, 'https:') || raw.replace(/^http:/i, 'https:');
}

function isDirectMediaUrl(value) {
  return /\.(m3u8|mp4|m4v|webm|mov|flv|ts)(?:$|[?#])/i.test(String(value || ''));
}

function parseEpisodes(playUrl) {
  const groups = String(playUrl || '').split('$$$').filter(Boolean);
  const directGroup =
    groups.find((group) =>
      group.split('#').some((part) => {
        const url = part.split('$').at(-1) || part;
        return /^https?:\/\//i.test(url) && isDirectMediaUrl(url);
      }),
    ) || '';
  const group = directGroup || groups.find((entry) => /https?:\/\//i.test(entry)) || groups[0] || '';
  const all = group
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
  return {
    total: all.length,
    preview: episodePreviewLimit ? all.slice(0, episodePreviewLimit) : [],
  };
}

function normalizeItem(row) {
  const typeName = normalizeText(row.type_name);
  const genre = splitClasses(row.vod_class, typeName);
  const score = parseNumber(row.vod_score);
  const views = parseNumber(row.vod_hits || row.vod_up || row.vod_hits_day);
  const updatedAt = normalizeText(row.vod_time || row.vod_pubdate || row.vod_year);
  const episodes = parseEpisodes(row.vod_play_url);
  const kind = classifyVodKind({ categoryName: typeName, genre });
  const vodId = String(row.vod_id || '');
  return {
    id: `quantum-lzi-${vodId}`,
    sourceKey: 'quantum-lzi',
    sourceName: '量子影視｜追劇',
    vodId,
    title: normalizeText(row.vod_name),
    originalName: normalizeText(row.vod_en || row.vod_sub || ''),
    kind,
    categoryId: String(row.type_id || ''),
    categoryName: typeName,
    year: parseYear(row.vod_year, row.vod_time, row.vod_pubdate),
    area: normalizeArea(row.vod_area),
    genre,
    remarks: normalizeText(row.vod_remarks),
    score,
    views,
    hot: views + score * 100 + parseEpoch(updatedAt) / 100000000,
    updatedAt,
    poster: normalizeImage(row.vod_pic),
    episodeCount: episodes.total,
    episodes: episodes.preview,
    playable: episodes.preview.length > 0,
    fullDetailSource: api,
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

const listPayload = await fetchJson(addVodQuery(api, 'ac=list'));
const classes = Array.isArray(listPayload.class) ? listPayload.class : [];
const first = await fetchJson(addVodQuery(api, 'ac=detail&pg=1'));
const pagecount = Number(first.pagecount || 1);
const total = Number(first.total || 0);
const pages = Array.from({ length: pagecount }, (_, index) => index + 1);
const byKind = new Map();
const errors = [];
let completed = 0;

await mapLimit(pages, concurrency, async (page) => {
  try {
    const payload = page === 1 ? first : await fetchJson(addVodQuery(api, `ac=detail&pg=${page}`));
    for (const row of payload.list || []) {
      const item = normalizeItem(row);
      if (!item.title || !item.poster) continue;
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }
  } catch (error) {
    errors.push({ page, error: error.message });
  }
  completed += 1;
  if (completed % 250 === 0 || completed === pagecount) {
    console.log(JSON.stringify({ completed, pagecount, errors: errors.length }));
  }
});

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const areaOrder = (value) => {
  if (value === '韓國') return -100;
  if (String(value).includes('韓')) return -90;
  return 0;
};
const chunks = [];
let normalizedTotal = 0;
let playableTotal = 0;
const allAreas = new Set();
const shortAreas = new Set();
const allYears = new Set();
const allGenres = new Set();

for (const [kind, rows] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  rows.sort((a, b) => Number(b.hot || 0) - Number(a.hot || 0));
  normalizedTotal += rows.length;
  playableTotal += rows.filter((item) => item.playable).length;
  for (const item of rows) {
    if (item.area) allAreas.add(item.area);
    if (item.kind === 'short' && item.area) shortAreas.add(item.area);
    if (item.year) allYears.add(item.year);
    for (const genre of item.genre || []) allGenres.add(genre);
  }
  const file = `${kind}.json`;
  chunks.push({
    kind,
    file,
    count: rows.length,
    playable: rows.filter((item) => item.playable).length,
  });
  await fs.writeFile(path.join(outputDir, file), `${JSON.stringify({ kind, count: rows.length, items: rows })}\n`, 'utf8');
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    key: '量子影視',
    name: '量子影視｜追劇',
    api,
    total,
    pagecount,
    episodePreviewLimit,
  },
  totals: {
    apiTotal: total,
    normalizedItems: normalizedTotal,
    playableItems: playableTotal,
    errors: errors.length,
  },
  filters: {
    years: [...allYears].sort((a, b) => b.localeCompare(a)).slice(0, 36),
    areas: [...allAreas].sort((a, b) => areaOrder(a) - areaOrder(b) || a.localeCompare(b, 'zh-Hant')),
    shortAreas: [...shortAreas].sort((a, b) => areaOrder(a) - areaOrder(b) || a.localeCompare(b, 'zh-Hant')),
    genres: [...allGenres].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 80),
  },
  classes,
  chunks,
  errors: errors.slice(0, 100),
};

await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify({ ...manifest, errors }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputDir, totals: manifest.totals, chunks }, null, 2));
