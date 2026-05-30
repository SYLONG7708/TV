import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const appRoot = path.resolve(args.get('appRoot') || path.resolve(import.meta.dirname, '..'));
const tvRoot = path.resolve(args.get('tvRoot') || 'C:\\Users\\Administrator\\TV');
const output = path.resolve(args.get('output') || path.join(appRoot, 'public', 'data', 'iphone-vod-catalog.json'));
const reportOutput = path.resolve(
  args.get('reportOutput') || path.join(appRoot, 'public', 'data', 'iphone-vod-catalog-report.json'),
);
const timeoutMs = Number(args.get('timeoutMs') || 9000);
const concurrency = Number(args.get('concurrency') || 6);
const maxSources = Number(args.get('maxSources') || 24);
const maxItemsPerSource = Number(args.get('maxItemsPerSource') || 90);
const maxCategoriesPerSource = Number(args.get('maxCategoriesPerSource') || 8);
const includeAdult = args.get('includeAdult') === 'true';

const currentSourcesPath = path.join(tvRoot, 'sources', 'current-sources.json');
const fallbackCurrentVodPath = path.join(tvRoot, '.patch-work', 'current-vod.json');
const lunaFullPath = path.join(tvRoot, 'sources', 'vod-lunatv-full-oktv.json');

const INDEXABLE_TYPES = new Set([0, 1]);
const USER_AGENT = 'OKTV-iPhone-catalog-builder/1.0';

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: withTimeout(),
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function stripEmojiPrefix(value) {
  return normalizeText(value)
    .replace(/^[^\p{Letter}\p{Number}]+/u, '')
    .replace(/^\s*-\s*/, '')
    .trim();
}

function hostOf(value) {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeApi(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/g, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/g, '').toLowerCase();
  }
}

function addVodQuery(api, query) {
  const value = String(api || '').trim();
  if (!value) return '';
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  return `${value}?${query}`;
}

function textId(input, index = 0) {
  const value = normalizeText(input, `item-${index}`)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${value || 'item'}-${index + 1}`;
}

function isAdultSource(site) {
  const text = `${site.key || ''} ${site.name || ''} ${site.api || ''}`;
  return /🔞|18\+|AV|成人|黄色|情色|麻豆|番号|大奶|丝袜|国产|仓库|杏吧|色猫|桃花|香蕉|91md|hsck|xgav|fhapi|dadiapi|lbapi/i.test(
    text,
  );
}

function kindFromTypeName(typeName, sourceAdult = false) {
  const text = normalizeText(typeName);
  if (sourceAdult || /伦理|写真|福利|成人|情色|麻豆|番号|AV|直播秀/i.test(text)) return 'adult';
  if (/动漫|动画|番剧|番|少儿|卡通/i.test(text)) return 'anime';
  if (/综艺|真人秀|脱口秀|选秀/i.test(text)) return 'variety';
  if (/连续剧|电视剧|国产剧|港台剧|日韩剧|欧美剧|海外剧|泰剧|日剧|韩剧|美剧|剧集|短剧/i.test(text)) return 'series';
  if (/电影|动作|喜剧|爱情|科幻|恐怖|剧情|战争|纪录|犯罪|悬疑|惊悚|冒险|奇幻|灾难/i.test(text)) {
    return 'movie';
  }
  return 'movie';
}

function normalizeImage(baseUrl, value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const first = raw.split(/[,\s]+/).find(Boolean) || raw;
  try {
    return new URL(first, baseUrl).toString().replace(/^http:/i, 'https:');
  } catch {
    return first.replace(/^http:/i, 'https:');
  }
}

function extractArray(payload) {
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.videos)) return payload.videos;
  if (Array.isArray(payload)) return payload;
  return [];
}

function parseScore(value) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseYear(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? match[0] : '';
}

function parseEpoch(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/-/g, '/');
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
}

function isDirectMediaUrl(value) {
  const url = String(value || '').trim();
  return /\.(m3u8|mp4|m4v|webm|mov|flv|ts)(?:$|[?#])/i.test(url);
}

function splitClasses(value, fallback = '') {
  return [...new Set(`${value || ''},${fallback || ''}`.split(/[,\s/、|]+/).map(normalizeText).filter(Boolean))];
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
      const name = bits.length > 1 ? bits.slice(0, -1).join('$') : `第 ${index + 1} 集`;
      const cleanUrl = normalizeText(url);
      if (!/^https?:\/\//i.test(cleanUrl)) return null;
      if (!isDirectMediaUrl(cleanUrl)) return null;
      return {
        name: normalizeText(name, `第 ${index + 1} 集`),
        url: cleanUrl,
      };
    })
    .filter(Boolean)
    .slice(0, 60);
}

function normalizeCategory(item, index, adult) {
  const id = normalizeText(item.type_id ?? item.id ?? item.type ?? index + 1);
  const name = normalizeText(item.type_name ?? item.name ?? item.type ?? `分類 ${index + 1}`);
  return {
    id: String(id),
    name,
    kind: kindFromTypeName(name, adult),
  };
}

function normalizeVodItem(item, source, category = null) {
  const title = normalizeText(item.vod_name ?? item.name ?? item.title);
  if (!title) return null;
  const typeName = normalizeText(item.type_name || category?.name || '');
  const year = parseYear(item.vod_year || item.year || item.vod_time || item.update_time || item.vod_pubdate);
  const area = normalizeText(item.vod_area || item.area || item.region || '');
  const genre = splitClasses(item.vod_class || item.class || item.tag, typeName);
  const score = parseScore(item.vod_score || item.score || item.douban_score);
  const updatedAt = normalizeText(item.vod_time || item.update_time || item.vod_pubdate || item.created_at || '');
  const episodes = parseEpisodes(item.vod_play_url || item.play_url || item.url);
  const kind = kindFromTypeName(`${typeName} ${genre.join(' ')}`, source.adult);
  const id = `${source.id}::${normalizeText(item.vod_id ?? item.id ?? title)}`;

  return {
    id: textId(id, 0),
    sourceId: source.id,
    sourceName: source.name,
    vodId: String(item.vod_id ?? item.id ?? ''),
    title,
    originalName: normalizeText(item.vod_en || item.original_name || ''),
    kind,
    categoryId: category?.id || String(item.type_id || ''),
    categoryName: typeName || category?.name || '',
    year,
    area,
    genre,
    remarks: normalizeText(item.vod_remarks || item.remarks || item.note || ''),
    actor: normalizeText(item.vod_actor || item.actor || ''),
    director: normalizeText(item.vod_director || item.director || ''),
    content: normalizeText(item.vod_content || item.content || item.desc || '').slice(0, 220),
    score,
    hot: score * 100 + parseEpoch(updatedAt) / 100000000,
    updatedAt,
    poster: normalizeImage(source.api, item.vod_pic || item.pic || item.cover || item.logo),
    episodes,
    playable: episodes.length > 0,
    adult: source.adult,
  };
}

function sourceFromSite(site, index, origin) {
  const api = normalizeText(site.api);
  const type = Number(site.type ?? 1);
  const key = normalizeText(site.key || site.name || hostOf(api) || `source-${index + 1}`);
  const name = stripEmojiPrefix(site.name || key);
  const adult = isAdultSource(site);
  return {
    id: textId(`${origin}-${key}-${api || index}`, index),
    key,
    name,
    type,
    api,
    ext: normalizeText(site.ext || ''),
    host: hostOf(api),
    origin,
    indexable: INDEXABLE_TYPES.has(type) && /^https?:\/\//i.test(api),
    adult,
  };
}

async function loadSources() {
  const rawSources = [];
  const seen = new Set();

  const addSites = (config, origin) => {
    const sites = Array.isArray(config?.sites) ? config.sites : [];
    for (const site of sites) {
      const apiKey = normalizeApi(site.api || `${origin}:${site.key || site.name}`);
      const dedupeKey = `${apiKey}|${site.ext || ''}|${site.key || ''}`;
      if (!apiKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rawSources.push(sourceFromSite(site, rawSources.length, origin));
    }
  };

  const currentSources = await readJson(currentSourcesPath, {});
  const currentVodUrl = currentSources?.vod?.url || '';
  if (currentVodUrl) {
    try {
      addSites(await fetchJson(currentVodUrl), 'OKTV 內建點播源');
    } catch {
      addSites(await readJson(fallbackCurrentVodPath, {}), 'OKTV 內建點播源');
    }
  } else {
    addSites(await readJson(fallbackCurrentVodPath, {}), 'OKTV 內建點播源');
  }

  addSites(await readJson(lunaFullPath, {}), 'LunaTV full 技術檢測');

  return rawSources;
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

async function getSourceCategories(source) {
  try {
    const payload = await fetchJson(addVodQuery(source.api, 'ac=list'));
    const seen = new Set();
    return extractArray(payload)
      .map((item, index) => normalizeCategory(item, index, source.adult))
      .filter((item) => {
        const key = `${item.id}|${item.name}`;
        if (!item.id || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch (error) {
    source.error = `分類讀取失敗: ${error.message}`;
    return [];
  }
}

function pickCategoryFetches(categories) {
  const byKind = new Map();
  for (const category of categories) {
    if (!byKind.has(category.kind)) byKind.set(category.kind, category);
  }
  const preferred = ['movie', 'series', 'variety', 'anime'].map((kind) => byKind.get(kind)).filter(Boolean);
  const rest = categories.filter((category) => !preferred.includes(category));
  return [...preferred, ...rest].slice(0, maxCategoriesPerSource);
}

async function fetchList(source, query, category = null) {
  const payload = await fetchJson(addVodQuery(source.api, query));
  return extractArray(payload)
    .map((item) => normalizeVodItem(item, source, category))
    .filter((item) => item && item.poster && item.playable);
}

async function indexSource(source) {
  const categories = await getSourceCategories(source);
  source.categories = categories;
  const itemMap = new Map();
  const checks = [];
  const queries = [
    { query: 'ac=detail&pg=1', category: null, label: '最新' },
    ...pickCategoryFetches(categories).map((category) => ({
      query: `ac=detail&t=${encodeURIComponent(category.id)}&pg=1`,
      category,
      label: category.name,
    })),
  ];

  for (const entry of queries) {
    try {
      const rows = await fetchList(source, entry.query, entry.category);
      checks.push({ label: entry.label, ok: true, count: rows.length });
      for (const row of rows) {
        const key = `${row.vodId || row.title}|${row.poster}|${row.categoryName}`;
        if (!itemMap.has(key)) itemMap.set(key, row);
      }
    } catch (error) {
      checks.push({ label: entry.label, ok: false, count: 0, error: error.message });
    }
    if (itemMap.size >= maxItemsPerSource) break;
  }

  const items = [...itemMap.values()].slice(0, maxItemsPerSource);
  source.itemCount = items.length;
  source.playableCount = items.filter((item) => item.playable).length;
  source.checks = checks;
  source.indexed = items.length > 0;
  return { source, items };
}

const allSources = await loadSources();
const indexableSources = allSources
  .filter((source) => source.indexable)
  .filter((source) => includeAdult || !source.adult)
  .slice(0, maxSources);

const indexed = await mapLimit(indexableSources, concurrency, indexSource);
const indexedById = new Map(indexed.map(({ source }) => [source.id, source]));
const sources = allSources.map((source) => {
  const indexedSource = indexedById.get(source.id);
  return {
    ...source,
    categories: indexedSource?.categories || [],
    itemCount: indexedSource?.itemCount || 0,
    playableCount: indexedSource?.playableCount || 0,
    indexed: Boolean(indexedSource?.indexed),
    checks: indexedSource?.checks || [],
    error: indexedSource?.error || source.error || '',
  };
});

const items = indexed.flatMap(({ items }) => items);
const filters = {
  years: [...new Set(items.map((item) => item.year).filter(Boolean))].sort((a, b) => b.localeCompare(a)).slice(0, 24),
  areas: [...new Set(items.map((item) => item.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 28),
  genres: [...new Set(items.flatMap((item) => item.genre).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .slice(0, 42),
};

const catalog = {
  generatedAt: new Date().toISOString(),
  source: {
    currentSourcesPath,
    lunaFullPath,
    maxSources,
    maxItemsPerSource,
    includeAdult,
  },
  totals: {
    sources: sources.length,
    indexedSources: sources.filter((source) => source.indexed).length,
    items: items.length,
    playableItems: items.filter((item) => item.playable).length,
    movies: items.filter((item) => item.kind === 'movie').length,
    series: items.filter((item) => item.kind === 'series').length,
    variety: items.filter((item) => item.kind === 'variety').length,
    anime: items.filter((item) => item.kind === 'anime').length,
  },
  filters,
  sources,
  items,
};

const report = {
  generatedAt: catalog.generatedAt,
  totals: catalog.totals,
  sourceChecks: sources.map((source) => ({
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
    error: source.error,
    checks: source.checks,
  })),
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(reportOutput), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await fs.writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      output,
      reportOutput,
      totals: catalog.totals,
    },
    null,
    2,
  ),
);
