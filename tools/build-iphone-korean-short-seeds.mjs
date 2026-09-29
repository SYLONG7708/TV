import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_HOSTS = new Set(['api.ffzyapi.com', 'caiji.dyttzyapi.com']);
const KOREAN_AREA_RE = /韓國|韩国|南韓|南韩/;
const SHORT_CATEGORY_RE = /短劇|短剧/;
const DIRECT_MEDIA_RE = /\.(?:m3u8|mp4|m4v|webm|mov|flv|ts)(?:$|[?#])/i;
const TRACKED_TITLE = '我最亲爱的(Ai)';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function itemId(sourceId, vodId) {
  const value = `${sourceId}::${vodId}`
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${value || 'item'}-1`;
}

export function parseDirectEpisodes(playUrl) {
  const groups = String(playUrl || '').split('$$$').filter(Boolean);
  const direct = groups.find((group) => group.split('#').some((part) => DIRECT_MEDIA_RE.test(part.split('$').at(-1) || '')));
  if (!direct) return [];
  return direct.split('#').map((part, index) => {
    const bits = part.split('$');
    const url = bits.at(-1)?.trim() || '';
    if (!/^https?:\/\//i.test(url) || !DIRECT_MEDIA_RE.test(url)) return null;
    return { name: bits.length > 1 ? bits.slice(0, -1).join('$').trim() : `第${index + 1}集`, url };
  }).filter(Boolean);
}

export function compactKoreanShort(row, source) {
  if (!row?.vod_id || !KOREAN_AREA_RE.test(String(row.vod_area || '')) || !SHORT_CATEGORY_RE.test(String(row.type_name || ''))) return null;
  const episodes = parseDirectEpisodes(row.vod_play_url);
  if (!episodes.length) return null;
  return {
    id: itemId(source.id, row.vod_id),
    sourceId: source.id,
    sourceName: source.name,
    vodId: String(row.vod_id),
    title: String(row.vod_name || '').trim(),
    originalName: String(row.vod_en || '').trim(),
    kind: 'short',
    categoryId: String(row.type_id || ''),
    categoryName: String(row.type_name || ''),
    year: String(row.vod_year || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '',
    area: '韓國',
    genre: ['短劇'],
    remarks: String(row.vod_remarks || '').trim(),
    score: Number(row.vod_score || 0) || 0,
    views: Number(row.vod_hits || 0) || 0,
    hot: Number(row.vod_hits || 0) || 0,
    updatedAt: String(row.vod_time || '').trim(),
    poster: String(row.vod_pic || '').trim(),
    episodeCount: episodes.length,
    playable: true,
    adult: false,
    lazyEpisodes: false,
    episodes,
  };
}

async function querySource(source, params) {
  const url = new URL(source.api);
  url.search = new URLSearchParams({ ac: 'detail', ...params }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.list)) throw new Error(`${source.name}: invalid list`);
  return payload.list;
}

export async function buildKoreanShortSeeds({ catalogPath, output, pages = 3, query = querySource }) {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const previous = await fs.readFile(output, 'utf8').then(JSON.parse).catch(() => ({ items: [] }));
  const sources = (catalog.sources || []).filter((source) => {
    if (!source.indexed || source.adult || !source.api) return false;
    try { return SOURCE_HOSTS.has(new URL(source.api).hostname); } catch { return false; }
  });
  if (!sources.length) throw new Error('No indexed Korean short drama source is configured');

  const items = [];
  const status = [];
  for (const source of sources) {
    const category = (source.categories || []).find((entry) => SHORT_CATEGORY_RE.test(String(entry?.name || entry || '')));
    if (!category) continue;
    const categoryId = String(category.id || category.type_id || '');
    const requests = [
      ...Array.from({ length: pages }, (_, index) => ({ t: categoryId, pg: String(index + 1) })),
      { wd: TRACKED_TITLE },
    ];
    const responses = await Promise.allSettled(requests.map((params) => query(source, params)));
    const found = new Map();
    for (const response of responses) {
      if (response.status !== 'fulfilled') continue;
      for (const row of response.value) {
        const item = compactKoreanShort(row, source);
        if (item) found.set(item.id, item);
      }
    }
    const successes = responses.filter((response) => response.status === 'fulfilled').length;
    if (!successes) {
      for (const item of previous.items || []) {
        if (item.sourceId === source.id && item.kind === 'short' && item.area === '韓國' && item.episodes?.length) found.set(item.id, item);
      }
    }
    items.push(...found.values());
    status.push({ source: source.name, requests: requests.length, successes, items: found.size });
  }
  if (status.length && status.every((entry) => entry.successes === 0) && (previous.items || []).length) {
    return { output, itemCount: previous.items.length, preservedPrevious: true, status };
  }
  if (!items.length) {
    if ((previous.items || []).some((item) => item.kind === 'short' && item.area === '韓國' && item.episodes?.length)) {
      return { output, itemCount: previous.items.length, preservedPrevious: true, status };
    }
    throw new Error('No playable Korean short drama was found');
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.sourceName.localeCompare(b.sourceName));
  const payload = { generatedAt: new Date().toISOString(), itemCount: items.length, status, items };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(payload)}\n`, 'utf8');
  return { output, itemCount: items.length, status };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const tvRoot = path.resolve(option('--tvRoot', path.resolve(import.meta.dirname, '..')));
  const result = await buildKoreanShortSeeds({
    catalogPath: path.resolve(option('--catalog', path.join(tvRoot, 'docs/data/iphone-vod-catalog.json'))),
    output: path.resolve(option('--output', path.join(tvRoot, 'docs/iphone/korean-short-seeds.json'))),
    pages: Math.max(1, Math.min(10, Number(option('--pages', '3')) || 3)),
  });
  console.log(JSON.stringify(result, null, 2));
}
