import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyVodKind } from './vod-kind-rules.mjs';
import { parseVodPayload } from './vod-payload-parser.mjs';

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
const vodSourcesOutput = path.resolve(args.get('vodSourcesOutput') || path.join(path.dirname(output), 'vod-sources.json'));
const summaryOutput = path.resolve(args.get('summaryOutput') || path.join(path.dirname(output), 'source-summary.json'));
const timeoutMs = Number(args.get('timeoutMs') || 9000);
const concurrency = Number(args.get('concurrency') || 6);
const maxSources = Number(args.get('maxSources') || 120);
const maxItemsPerSource = Number(args.get('maxItemsPerSource') || 90);
const maxCategoriesPerSource = Number(args.get('maxCategoriesPerSource') || 8);
const maxPagesPerQuery = Number(args.get('maxPagesPerQuery') || 1);
const maxPagesPerSource = Number(args.get('maxPagesPerSource') || Math.max(1, maxPagesPerQuery * Math.max(1, maxCategoriesPerSource + 1)));
const pageSize = Number(args.get('pageSize') || 0);
const fetchPageConcurrency = Number(args.get('fetchPageConcurrency') || Math.max(1, Math.min(6, concurrency)));
const retries = Number(args.get('retries') || 2);
const sourceMatch = normalizeText(args.get('sourceMatch') || '');
const mergeExisting = args.get('mergeExisting') === 'true';
const includeAdult = args.get('includeAdult') !== 'false';
const includeLegacySources = args.get('includeLegacySources') === 'true';
let loadedCurrentVodUrl = '';

const currentSourcesPath = path.join(tvRoot, 'sources', 'current-sources.json');
const fallbackCurrentVodPath = path.join(tvRoot, '.patch-work', 'current-vod.json');
const allOnDemandSourcesPath = path.join(tvRoot, 'sources', 'All on-demand sources');
const lunaFullPath = path.join(tvRoot, 'sources', 'vod-lunatv-full-oktv.json');
const currentVodInput = args.get('currentVodInput') ? path.resolve(args.get('currentVodInput')) : '';

const INDEXABLE_TYPES = new Set([0, 1]);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 OKTV/1.0';

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeTextAtomic(file, text) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(temp, text, 'utf8');
  try {
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

async function fetchTextOnce(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: withTimeout(),
    headers: {
      accept: 'application/json,text/xml,application/xml,text/plain,*/*',
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchTextOnce(url);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const rateLimited = /HTTP (?:429|701|502|503)/i.test(error.message);
      await sleep((rateLimited ? 5000 : 750) * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function fetchPayload(url) {
  const text = await fetchText(url);
  const trimmed = text.trim();
  if (/^</.test(trimmed)) return parseXmlPayload(trimmed);
  return JSON.parse(trimmed);
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

const EXPLICIT_ADULT_SOURCE_APIS = [
  'https://91md.me/api.php/provide/vod/',
  'http://lbapiby.com/api.php/provide/vod/',
  'https://155api.com/api.php/provide/vod/',
  'https://apiyutu.com/api.php/provide/vod/',
  'http://fhapi9.com/api.php/provide/vod/',
  'https://apilsbzy1.com/api.php/provide/vod/',
  'https://www.yytv4.cc/api.php/provide/vod/',
  'https://api.xiaojizy.live/provide/vod/',
  'https://hsckzy.xyz/api.php/provide/vod/',
  'https://apidanaizi.com/api.php/provide/vod/',
  'https://jkunzyapi.com/api.php/provide/vod/',
  'https://lbapi9.com/api.php/provide/vod/',
  'https://Naixxzy.com/api.php/provide/vod/',
  'https://beiyong.slapibf.com/api.php/provide/vod/',
  'https://pz.v88.qzz.io/?url=https://apilj.com/api.php/provide/vod',
  'https://apilj.com/api.php/provide/vod',
  'https://shayuapi.com/api.php/provide/vod/',
  'https://api.douapi.cc/api.php/provide/vod/',
  'https://api.ddapi.cc/api.php/provide/vod/',
  'https://www.heiliaozyapi.com/api.php/provide/vod/',
  'https://api.bwzyz.com/api.php/provide/vod/',
  'https://thzy1.me/api.php/provide/vod/',
  'https://www.jingpinx.com/api.php/provide/vod/',
  'https://ckzy.me/api.php/provide/vod/',
  'https://api.souavzyw.net/api.php/provide/vod/',
  'https://www.xxibaozyw.com/api.php/provide/vod/',
  'https://www.xiangjiaozyw.com/api.php/provide/vod/',
  'https://www.msnii.com/api/json.php',
  'https://www.pgxdy.com/api/json.php',
  'https://www.kxgav.com/api/json.php',
  'https://xingba222.com/api.php/provide/vod/',
  'https://dadiapi.com/feifei',
  'https://caiji.semaozy.net/inc/apijson_vod.php/provide/vod/',
  'https://aosikazy.com/api.php/provide/vod/',
  'https://siwazyw.tv/api.php/provide/vod/',
  'https://od.lk/s/NjFfMTI2OTY0NTk3Xw/truvaze.py',
  'https://dadiapi.com/apple_m3u8.php',
  'https://hsckzy.vip/api.php/provide/vod/',
  'https://fqzy.me//api.php/provide/vod/?ac=list',
];

const ADULT_SOURCE_API_KEYS = new Set(EXPLICIT_ADULT_SOURCE_APIS.map(normalizeAdultApiKey));
const ADULT_SOURCE_TEXT_RE =
  /18\+|avzy|souav|swag|91md|155api|apiyutu|fhapi|apilsb|yytv4|xiaojizy|hsck|apidanaizi|jkunzy|lbapi|naixxzy|slapibf|apilj|shayuapi|douapi|ddapi|heiliao|bwzyz|thzy|jingpin|ckzy|xxibao|xiangjiao|msnii|pgxdy|kxgav|xingba|dadiapi|semaozy|aosika|siwazy|truvaze|fqzy|\u6210\u4eba|\u9ebb\u8c46|\u756a\u53f7|\u9ec4\u8272|\u9ec3\u8272|\u60c5\u8272|\u8001\u8272|\u5927\u5976|\u4e1d\u889c|\u7d72\u896a|\u4ed3\u5e93|\u5009\u5eab|\u674f\u5427|\u8272\u732b|\u6843\u82b1|\u9999\u8549|\u5976\u9999|\u68ee\u6797|\u8fa3\u6912|\u9ca8\u9c7c|\u9bca\u9b5a|\u9ed1\u6599|\u7cbe\u54c1|\u7ec6\u80de|\u7d30\u80de|\u5965\u65af\u5361|\u5967\u65af\u5361|\u65e0\u7801|\u7121\u78bc|\u4e71\u4f26|\u4e82\u502b|\u798f\u5229\u59ec|\u4e3b\u64ad|\u5f3a\u5978|\u841d\u8389|\u863f\u8389|\u5236\u670d|\u4f26\u7406|\u502b\u7406|\u6deb|AV/i;
const ADULT_ITEM_TEXT_RE =
  /18\+|\u6210\u4eba|\u9ebb\u8c46|\u756a\u53f7|\u9ec4\u8272|\u9ec3\u8272|\u60c5\u8272|\u4e09\u7ea7|\u4e09\u7d1a|\u8001\u8272|\u5927\u5976|\u4e1d\u889c|\u7d72\u896a|\u65e0\u7801|\u7121\u78bc|\u6709\u7801|\u6709\u78bc|\u4e71\u4f26|\u4e82\u502b|\u798f\u5229\u59ec|\u5f3a\u5978|\u5f37\u59e6|\u841d\u8389|\u863f\u8389|\u91cc\u756a|\u88cf\u756a|\u5236\u670d\u8bf1\u60d1|\u5236\u670d\u8a98\u60d1|\u4f26\u7406|\u502b\u7406|\u5199\u771f|\u5beb\u771f|\u5973\u512a|\u5973\u4f18|\u5de8\u4e73|\u4e73\u4ea4|\u53e3\u4ea4|\u6deb|\u5077\u62cd|\u4eba\u59bb|\u56fd\u4ea7\u81ea\u62cd|\u570b\u7522\u81ea\u62cd|\bAV\b/i;

function normalizeAdultApiKey(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    if (url.searchParams.has('ac') && url.searchParams.size === 1) url.search = '';
    return url.toString().replace(/\/$/g, '');
  } catch {
    return raw.replace(/\/$/g, '');
  }
}

function adultApiCandidates(site) {
  const candidates = [site?.api, site?.ext].map(normalizeAdultApiKey).filter(Boolean);
  for (const raw of [site?.api, site?.ext]) {
    try {
      const nested = new URL(String(raw || '')).searchParams.get('url');
      if (nested) candidates.push(normalizeAdultApiKey(nested));
    } catch {
      // Ignore malformed URLs from third-party configs.
    }
  }
  return [...new Set(candidates)];
}

function adultText(site) {
  return [
    site?.key,
    site?.name,
    site?.api,
    site?.ext,
  ]
    .map((value) => String(value || ''))
    .join(' ');
}

function addVodQuery(api, query) {
  const value = String(api || '').trim();
  if (!value) return '';
  if (/[?&]url=/i.test(value)) {
    if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
    return `${value}?${query}`;
  }
  try {
    const url = new URL(value);
    const params = new URLSearchParams(query);
    for (const [key, paramValue] of params.entries()) url.searchParams.set(key, paramValue);
    return url.toString();
  } catch {
    // Keep support for non-standard third-party proxy URLs.
  }
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  if (value.includes('?')) return `${value}&${query}`;
  return `${value}?${query}`;
}

function vodQueryWithPage(query, page) {
  const params = new URLSearchParams(String(query || ''));
  params.set('pg', String(page));
  if (pageSize > 0) {
    params.set('pagesize', String(pageSize));
    params.set('limit', String(pageSize));
  }
  return params.toString();
}

function vodAction(source) {
  return Number(source?.type) === 0 ? 'videolist' : 'detail';
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
  return adultApiCandidates(site).some((api) => ADULT_SOURCE_API_KEYS.has(api)) || ADULT_SOURCE_TEXT_RE.test(adultText(site));
}

function isAdultVodItem(item, source, typeName, genre, title) {
  if (source.adult) return true;
  const text = [
    title,
    typeName,
    Array.isArray(genre) ? genre.join(' ') : '',
    item.vod_class,
    item.class,
    item.tag,
    item.vod_actor,
    item.actor,
    item.vod_director,
    item.director,
    item.vod_content,
    item.content,
    item.vod_remarks,
    item.remarks,
  ]
    .map((value) => String(value || ''))
    .join(' ');
  return ADULT_ITEM_TEXT_RE.test(text);
}

function kindFromTypeName(typeName, sourceAdult = false) {
  return classifyVodKind(typeName, sourceAdult);
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

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function xmlAttr(value, name) {
  return decodeEntities(String(value || '').match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1] || '');
}

function xmlTag(value, name) {
  return decodeEntities(String(value || '').match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
}

function xmlTags(value, name) {
  return [...String(value || '').matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((match) =>
    decodeEntities(match[1]),
  );
}

function parseXmlPayload(text) {
  const listOpen = String(text || '').match(/<list\b([^>]*)>/i)?.[1] || '';
  const videos = [...String(text || '').matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)].map((match) => {
    const node = match[1];
    const playGroups = xmlTags(node, 'dd');
    const typeName = xmlTag(node, 'type');
    return {
      vod_id: xmlTag(node, 'id'),
      id: xmlTag(node, 'id'),
      type_id: xmlTag(node, 'tid'),
      type_name: typeName,
      vod_name: xmlTag(node, 'name'),
      vod_pic: xmlTag(node, 'pic'),
      vod_area: xmlTag(node, 'area'),
      vod_year: xmlTag(node, 'year'),
      vod_remarks: xmlTag(node, 'note'),
      vod_actor: xmlTag(node, 'actor'),
      vod_director: xmlTag(node, 'director'),
      vod_content: xmlTag(node, 'des') || xmlTag(node, 'content'),
      vod_time: xmlTag(node, 'last'),
      vod_class: typeName,
      vod_play_url: playGroups.join('$$$'),
    };
  });
  const categories = [...String(text || '').matchAll(/<ty\b([^>]*)>([\s\S]*?)<\/ty>/gi)].map((match, index) => ({
    type_id: xmlAttr(match[1], 'id') || String(index + 1),
    type_name: decodeEntities(match[2]),
  }));
  return {
    list: videos,
    class: categories,
    page: Number(xmlAttr(listOpen, 'page') || 1) || 1,
    pagecount: Number(xmlAttr(listOpen, 'pagecount') || 1) || 1,
    limit: Number(xmlAttr(listOpen, 'pagesize') || 0) || 0,
    total: Number(xmlAttr(listOpen, 'recordcount') || 0) || 0,
  };
}

function extractArray(payload) {
  if (Array.isArray(payload?.data) && payload.data.some((item) => item?.vod_name || item?.name || item?.title)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.videos)) return payload.videos;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractCategories(payload) {
  if (Array.isArray(payload?.class)) return payload.class;
  return extractArray(payload);
}

function parseScore(value) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseNumber(value) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseYear(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? match[0] : '';
}

function normalizeArea(value) {
  return normalizeText(value)
    .replace(/韩国/g, '韓國')
    .replace(/中国台湾|中国台灣|中国臺灣|中國台湾|中國台灣|中國臺灣/g, '台灣')
    .replace(/中国香港|中國香港|香港地区/g, '香港')
    .replace(/中国澳门|中國澳門|澳门|澳門/g, '澳門')
    .replace(/中国大陆|中國大陸|大陆/g, '大陸')
    .replace(/台湾|台灣/g, '台灣')
    .replace(/日本/g, '日本')
    .replace(/泰国|泰國/g, '泰國')
    .replace(/欧美|歐美/g, '歐美');
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
  const directGroup =
    groups.find((group) =>
      group.split('#').some((part) => {
        const url = part.split('$').at(-1) || part;
        return /^https?:\/\//i.test(url) && isDirectMediaUrl(url);
      }),
    ) || '';
  const group = directGroup || groups.find((entry) => /https?:\/\//i.test(entry)) || groups[0] || '';
  return group
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
    .filter(Boolean);
}

function normalizeCategory(item, index, adult) {
  const id = normalizeText(item.type_id ?? item.list_id ?? item.id ?? item.type ?? index + 1);
  const name = normalizeText(item.type_name ?? item.list_name ?? item.name ?? item.type ?? `分類 ${index + 1}`);
  return {
    id: String(id),
    name,
    kind: kindFromTypeName(name, adult),
  };
}

function normalizeVodItem(item, source, category = null) {
  const title = normalizeText(item.vod_name ?? item.name ?? item.title);
  if (!title) return null;
  const typeName = normalizeText(item.type_name || item.list_name || category?.name || '');
  const year = parseYear(item.vod_year || item.year || item.vod_time || item.update_time || item.vod_pubdate || item.vod_addtime);
  const area = normalizeArea(item.vod_area || item.area || item.region || item.vod_area_name || '');
  const genre = splitClasses(item.vod_class || item.class || item.tag, typeName);
  const score = parseScore(item.vod_score || item.score || item.douban_score);
  const views = parseNumber(item.vod_hits || item.hits || item.views || item.play_count || item.vod_up);
  const updatedAt = normalizeText(item.vod_time || item.update_time || item.vod_pubdate || item.created_at || item.vod_addtime || '');
  const episodes = parseEpisodes(item.vod_play_url || item.vod_url || item.vod_play_url_with_player || item.play_url || item.url);
  const adult = isAdultVodItem(item, source, typeName || category?.name || '', genre, title);
  const kind = classifyVodKind({ categoryName: typeName || category?.name || '', genre, title, sourceAdult: adult, adult });
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
    views,
    hot: views + score * 100 + parseEpoch(updatedAt) / 100000000,
    updatedAt,
    poster: normalizeImage(source.api, item.vod_pic || item.pic || item.cover || item.logo || item.vod_pic_thumb),
    episodes,
    playable: episodes.length > 0,
    adult,
    adultDetected: adult && !source.adult,
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

function sourceMatchesFilter(source) {
  if (!sourceMatch) return true;
  const haystack = normalizeText([source.id, source.key, source.name, source.api, source.host, source.origin].join(' '));
  return haystack.includes(sourceMatch.toLowerCase());
}

async function loadSources() {
  const rawSources = [];
  const seen = new Set();

  const addSites = (config, origin) => {
    const sites = Array.isArray(config?.sites) ? config.sites : [];
    for (const site of sites) {
      const apiKey = normalizeApi(site.api || `${origin}:${site.key || site.name}`);
      const dedupeKey = `${apiKey}|${site.ext || ''}`;
      if (!apiKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rawSources.push(sourceFromSite(site, rawSources.length, origin));
    }
  };

  const currentSources = await readJson(currentSourcesPath, {});
  const currentVodUrl = currentSources?.vod?.url || '';
  loadedCurrentVodUrl = currentVodInput || currentVodUrl;
  if (currentVodInput) {
    addSites(await readJson(currentVodInput, {}), 'current-vod-local');
  } else if (currentVodUrl) {
    try {
      addSites(await fetchJson(currentVodUrl), 'current-vod-url');
    } catch {
      addSites(await readJson(fallbackCurrentVodPath, {}), 'current-vod-fallback');
    }
  } else {
    addSites(await readJson(fallbackCurrentVodPath, {}), 'current-vod-fallback');
  }

  if (includeLegacySources) {
    addSites(await readJson(allOnDemandSourcesPath, {}), 'legacy-all-on-demand');
    addSites(await readJson(lunaFullPath, {}), 'legacy-lunatv-full');
  }

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
    const payload = await fetchPayload(addVodQuery(source.api, 'ac=list'));
    const seen = new Set();
    return extractCategories(payload)
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
  const preferred = ['movie', 'short', 'series', 'variety', 'anime'].map((kind) => byKind.get(kind)).filter(Boolean);
  const rest = categories.filter((category) => !preferred.includes(category));
  return [...preferred, ...rest].slice(0, maxCategoriesPerSource);
}

function pageMeta(payload) {
  return {
    page: Number(payload?.page || 1) || 1,
    pagecount: Number(payload?.pagecount || payload?.pageCount || payload?.page?.pagecount || 1) || 1,
    total: Number(payload?.total || payload?.totalCount || payload?.page?.recordcount || 0) || 0,
    limit: Number(payload?.limit || payload?.page?.pagesize || 0) || 0,
  };
}

async function fetchListPage(source, query, category = null, page = 1) {
  const payload = await fetchPayload(addVodQuery(source.api, vodQueryWithPage(query, page)));
  return {
    rows: extractArray(payload)
      .map((item) => normalizeVodItem(item, source, category))
      .filter((item) => item && item.poster && item.playable),
    meta: pageMeta(payload),
  };
}

async function fetchList(source, query, category = null, pageBudget = maxPagesPerQuery) {
  const first = await fetchListPage(source, query, category, 1);
  const pageLimit = Math.max(1, Math.min(maxPagesPerQuery, pageBudget, first.meta.pagecount || 1));
  const remainingPages = Array.from({ length: Math.max(0, pageLimit - 1) }, (_, index) => index + 2);
  const rest = await mapLimit(remainingPages, fetchPageConcurrency, (page) => fetchListPage(source, query, category, page));
  const pages = [first, ...rest];
  return {
    rows: pages.flatMap((page) => page.rows),
    pages: pages.length,
    meta: {
      ...first.meta,
      pagecount: Math.max(first.meta.pagecount || 1, ...pages.map((page) => page.meta.pagecount || 1)),
      total: Math.max(first.meta.total || 0, ...pages.map((page) => page.meta.total || 0)),
    },
  };
}

async function indexSource(source) {
  const categories = await getSourceCategories(source);
  source.categories = categories;
  const itemMap = new Map();
  const checks = [];
  const action = vodAction(source);
  const queries = [
    { query: `ac=${action}&pg=1`, category: null, label: '最新' },
    ...pickCategoryFetches(categories).map((category) => ({
      query: `ac=${action}&t=${encodeURIComponent(category.id)}&pg=1`,
      category,
      label: category.name,
    })),
  ];

  let remainingPageBudget = Math.max(1, maxPagesPerSource);
  for (const entry of queries) {
    try {
      const result = await fetchList(source, entry.query, entry.category, remainingPageBudget);
      remainingPageBudget -= result.pages;
      const rows = result.rows;
      checks.push({
        label: entry.label,
        ok: true,
        count: rows.length,
        pages: result.pages,
        pagecount: result.meta.pagecount,
        total: result.meta.total,
      });
      for (const row of rows) {
        const key = `${row.vodId || row.title}|${row.poster}|${row.categoryName}`;
        if (!itemMap.has(key)) itemMap.set(key, row);
        if (itemMap.size >= maxItemsPerSource) break;
      }
    } catch (error) {
      checks.push({ label: entry.label, ok: false, count: 0, error: error.message });
    }
    if (itemMap.size >= maxItemsPerSource || remainingPageBudget <= 0) break;
  }

  const items = [...itemMap.values()].slice(0, maxItemsPerSource);
  source.itemCount = items.length;
  source.playableCount = items.filter((item) => item.playable).length;
  source.checks = checks;
  source.sourceTotalCount = Math.max(0, ...checks.map((check) => Number(check.total || 0)));
  source.indexed = items.length > 0;
  return { source, items };
}

const existingCatalog = mergeExisting ? await readJson(output, null) : null;
const existingSourceById = new Map((existingCatalog?.sources || []).map((source) => [source.id, source]));
const existingSourceByApi = new Map();
for (const source of existingCatalog?.sources || []) {
  const apiKey = normalizeApi(source.api);
  if (apiKey && !existingSourceByApi.has(apiKey)) existingSourceByApi.set(apiKey, source);
}

function preserveExistingSourceIdentity(source) {
  if (!mergeExisting) return source;
  const existingSource = existingSourceByApi.get(normalizeApi(source.api));
  if (!existingSource || existingSource.id === source.id) return source;
  return {
    ...source,
    id: existingSource.id,
    key: existingSource.key || source.key,
    detailMode: existingSource.detailMode || source.detailMode,
    detailPathPattern: existingSource.detailPathPattern || source.detailPathPattern,
    indexMode: existingSource.indexMode || source.indexMode,
    indexPath: existingSource.indexPath || source.indexPath,
    preservedIdentityFrom: source.id,
  };
}

const allSources = (await loadSources()).map(preserveExistingSourceIdentity);
const indexableSources = allSources
  .filter((source) => source.indexable)
  .filter((source) => includeAdult || !source.adult)
  .filter(sourceMatchesFilter)
  .slice(0, maxSources);

const indexed = await mapLimit(indexableSources, concurrency, indexSource);
const indexedById = new Map(indexed.map(({ source }) => [source.id, source]));
const updatedSourceIds = new Set(indexed.map(({ source }) => source.id));

function sourceView(source) {
  const indexedSource = indexedById.get(source.id);
  if (indexedSource) {
    return {
      ...source,
      categories: indexedSource.categories || [],
      itemCount: indexedSource.itemCount || 0,
      playableCount: indexedSource.playableCount || 0,
      sourceTotalCount: indexedSource.sourceTotalCount || 0,
      indexed: Boolean(indexedSource.indexed),
      checks: indexedSource.checks || [],
      error: indexedSource.error || source.error || '',
    };
  }

  const existingSource = existingSourceById.get(source.id);
  if (mergeExisting && existingSource) {
    return {
      ...source,
      categories: existingSource.categories || [],
      itemCount: existingSource.itemCount || 0,
      playableCount: existingSource.playableCount || 0,
      sourceTotalCount: existingSource.sourceTotalCount || 0,
      indexed: Boolean(existingSource.indexed),
      checks: existingSource.checks || [],
      error: existingSource.error || source.error || '',
    };
  }

  return {
    ...source,
    categories: [],
    itemCount: 0,
    playableCount: 0,
    sourceTotalCount: 0,
    indexed: false,
    checks: [],
    error: source.error || '',
  };
}

function typeLabel(type) {
  if (type === 0) return 'CMS XML/API';
  if (type === 3) return 'Spider/API';
  if (type === 4) return 'Proxy/API';
  return 'CMS JSON/API';
}

function modeLabel(type) {
  if (type === 3) return 'spider';
  if (type === 2) return 'parse';
  if (type === 4) return 'proxy';
  return 'api';
}

function vodSourceEntry(source) {
  return {
    id: source.id,
    key: source.key,
    name: source.name,
    type: source.type,
    typeLabel: typeLabel(source.type),
    mode: modeLabel(source.type),
    api: source.api,
    searchable: true,
    changeable: false,
    quickSearch: true,
    categories: source.categories || [],
    endpointHost: source.host,
    hasExt: Boolean(source.ext),
    enabled: true,
    status: source.indexed ? 'indexed' : source.indexable ? 'enabled' : 'listed',
    origin: source.origin,
    adult: Boolean(source.adult),
  };
}

const sources = allSources.map(sourceView);
if (mergeExisting) {
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const source of existingCatalog?.sources || []) {
    if (!sourceIds.has(source.id)) sources.push(source);
  }
}

const indexedItems = indexed.flatMap(({ items }) => items);
const items = mergeExisting
  ? [...(existingCatalog?.items || []).filter((item) => !updatedSourceIds.has(item.sourceId)), ...indexedItems]
  : indexedItems;
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
    ...(includeLegacySources ? { allOnDemandSourcesPath, lunaFullPath } : {}),
    maxSources,
    maxItemsPerSource,
    maxPagesPerQuery,
    maxPagesPerSource,
    pageSize,
    sourceMatch,
    mergeExisting,
    includeAdult,
    includeLegacySources,
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
    short: items.filter((item) => item.kind === 'short').length,
    adult: items.filter((item) => item.kind === 'adult' || item.adult).length,
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
    sourceTotalCount: source.sourceTotalCount,
    error: source.error,
    checks: source.checks,
  })),
};

await writeTextAtomic(output, `${JSON.stringify(catalog, null, 2)}\n`);
await writeTextAtomic(reportOutput, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      output,
      reportOutput,
      vodSourcesOutput,
      summaryOutput,
      totals: catalog.totals,
    },
    null,
    2,
  ),
);
