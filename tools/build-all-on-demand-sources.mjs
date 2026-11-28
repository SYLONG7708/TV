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

const repoRoot = path.resolve(args.get('repoRoot') || path.resolve(import.meta.dirname, '..'));
const reportUrl = args.get('reportUrl') || 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/report.md';
const output = path.resolve(args.get('output') || path.join(repoRoot, 'sources', 'All on-demand sources'));
const reportOutput = path.resolve(args.get('reportOutput') || path.join(repoRoot, 'sources', 'All on-demand sources-report.json'));
const docsVodOutput = path.resolve(args.get('docsVodOutput') || path.join(repoRoot, 'docs', 'data', 'vod-sources.json'));
const timeoutMs = Number(args.get('timeoutMs') || 10000);
const concurrency = Number(args.get('concurrency') || 10);
const retries = Number(args.get('retries') || 2);
const defaultExtraConfigUrls = [
  'https://raw.githubusercontent.com/FGBLH/GHK/a1c46cb76810cd6d53b73e1c6f0a0789586151c5/%E6%B5%B7%E8%B1%9A%E5%BD%B1%E8%A7%86.json',
];
const extraConfigUrls = String(args.get('extraConfigUrls') || defaultExtraConfigUrls.join(','))
  .split(/[,\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 OKTV/1.0';
const DEFAULT_CATEGORIES = [
  '国产剧',
  '短剧',
  '韩国剧',
  '香港剧',
  '台湾剧',
  '欧美剧',
  '动作片',
  '科幻片',
  '战争片',
  '奇幻片',
  '喜剧片',
  '爱情片',
  '恐怖片',
  '犯罪片',
  '悬疑片',
  '惊悚片',
  '剧情片',
  '冒险片',
  '记录片',
  '日本剧',
  '泰剧',
  '国产综艺',
  '港台综艺',
  '欧美综艺',
  '日韩综艺',
  '国产动漫',
  '港台动漫',
  '日韩动漫',
];

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextOnce(url, accept = 'text/plain,*/*') {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: withTimeout(),
    headers: {
      accept,
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchText(url, accept = 'text/plain,*/*') {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchTextOnce(url, accept);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const rateLimited = /HTTP (?:429|701|502|503)/i.test(error.message);
      await sleep((rateLimited ? 5000 : 750) * (attempt + 1));
    }
  }
  throw lastError;
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSourceName(value) {
  const text = normalizeText(value)
    .replace(/^[^\p{Letter}\p{Number}]+/u, '')
    .replace(/^\s*-+\s*/, '')
    .replace(/-+$/g, '')
    .trim();
  return text || '點播源';
}

function cleanConfigSourceName(value, fallback = '') {
  const text = cleanSourceName(value || fallback)
    .replace(/🔞/g, '18+')
    .replace(/[🐬🦊]/gu, '')
    .replace(/\s*海豚影视.*$/i, '')
    .replace(/\s*海豚影視.*$/i, '')
    .replace(/[｜|]\s*$/g, '')
    .trim();
  return text || cleanSourceName(fallback) || '點播源';
}

function displayNameBase(value) {
  return cleanConfigSourceName(value)
    .replace(/[｜|].*$/g, '')
    .replace(/\s+海豚.*$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function sourceKey(name, index) {
  const clean = cleanSourceName(name)
    .replace(/[｜|]+.*$/g, '')
    .replace(/\s+/g, '');
  return clean || `點播源${index + 1}`;
}

function keyId(value, index) {
  const id = normalizeText(value, `source-${index + 1}`)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return id || `source_${index + 1}`;
}

function apiType(api) {
  return /(?:xml|\/at\/xml|feifei)/i.test(api) ? 0 : 1;
}

function normalizeApi(api) {
  const raw = normalizeText(api);
  if (!raw) return '';
  if (/[?&]url=/i.test(raw)) return raw;
  if (/\/provide\/vod$/i.test(raw)) return `${raw}/`;
  return raw;
}

function normalizeDedupeApi(api) {
  const raw = normalizeApi(api).toLowerCase();
  try {
    const url = new URL(raw);
    url.hash = '';
    if (url.searchParams.has('ac') && url.searchParams.size === 1) url.search = '';
    return url.toString().replace(/\/$/g, '');
  } catch {
    return raw.replace(/\/$/g, '');
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

function sourceDedupeKey(row) {
  return `${normalizeDedupeApi(row.api)}|${normalizeText(row.ext).toLowerCase()}`;
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

function parseXmlPayload(text) {
  const categories = [...String(text || '').matchAll(/<ty\b([^>]*)>([\s\S]*?)<\/ty>/gi)].map((match, index) => ({
    type_id: xmlAttr(match[1], 'id') || String(index + 1),
    type_name: decodeEntities(match[2]),
  }));
  return { class: categories };
}

function parsePayload(text) {
  const trimmed = String(text || '').trim();
  if (/^</.test(trimmed)) return parseXmlPayload(trimmed);
  return JSON.parse(trimmed);
}

function extractLink(cell) {
  return normalizeText(cell).match(/\[Link\]\(([^)]+)\)/)?.[1] || '';
}

function parseStatus(cell) {
  return cell.includes('✅') ? 'ok' : cell.includes('❌') ? 'failed' : 'unknown';
}

function parseSearchable(cell) {
  const text = normalizeText(cell);
  return text.includes('✅') ? 1 : 1;
}

function parseReportTable(markdown) {
  const rows = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (line.includes('资源名称') || line.includes('狀態') || line.includes('状态')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 9) continue;
    const api = extractLink(cells[3]);
    const name = cleanSourceName(cells[1]);
    if (!api || !name) continue;
    rows.push({
      status: parseStatus(cells[0]),
      name,
      site: extractLink(cells[2]),
      api,
      searchable: parseSearchable(cells[4]),
      successCount: Number(cells[5] || 0),
      failedCount: Number(cells[6] || 0),
      successRate: cells[7],
      trend: cells[8],
      adult: isAdultSource({ name, api }),
    });
  }
  return rows;
}

function extractArray(payload) {
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractCategories(payload) {
  if (Array.isArray(payload?.class)) return payload.class;
  return extractArray(payload);
}

function normalizeCategories(rows, fallbackAdult = false) {
  const categories = rows
    .map((item) =>
      normalizeText(typeof item === 'string' ? item : item.type_name ?? item.list_name ?? item.name ?? item.type ?? item.title),
    )
    .filter(Boolean);
  const unique = [...new Set(categories)];
  if (unique.length) return unique.slice(0, 80);
  return fallbackAdult ? ['成人18+', ...DEFAULT_CATEGORIES] : DEFAULT_CATEGORIES;
}

async function fetchCategories(row) {
  const type = Number(row.type ?? apiType(row.api));
  const provided = normalizeCategories(row.categories || [], row.adult);
  if (!new Set([0, 1]).has(type)) {
    return {
      categories: provided,
      ok: true,
      skipped: true,
      error: '',
    };
  }
  try {
    const text = await fetchText(addVodQuery(row.api, 'ac=list'), 'application/json,text/plain,*/*');
    const json = parsePayload(text);
    return {
      categories: normalizeCategories(extractCategories(json), row.adult),
      ok: true,
      error: '',
    };
  } catch (error) {
    return {
      categories: provided,
      ok: false,
      error: error.message,
    };
  }
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

function hostOf(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has('url')) return new URL(url.searchParams.get('url')).host;
    return url.host;
  } catch {
    return '';
  }
}

function isAdultSource(site) {
  return adultApiCandidates(site).some((api) => ADULT_SOURCE_API_KEYS.has(api)) || ADULT_SOURCE_TEXT_RE.test(adultText(site));
}

function configSiteRow(site, index, originUrl) {
  const type = Number(site.type ?? apiType(site.api));
  const key = cleanSourceName(site.key || site.name || `海豚來源${index + 1}`);
  const name = cleanConfigSourceName(site.name || key, key);
  return {
    status: 'ok',
    name,
    key,
    site: '',
    api: normalizeText(site.api),
    ext: normalizeText(site.ext),
    type,
    searchable: Number(site.searchable ?? 1),
    changeable: site.changeable === undefined ? undefined : Number(site.changeable),
    quickSearch: Number(site.quickSearch ?? 1),
    filterable: site.filterable === undefined ? undefined : Number(site.filterable),
    categories: Array.isArray(site.categories) ? site.categories : [],
    successRate: 'external',
    trend: '',
    origin: originUrl,
    adult: isAdultSource(site),
  };
}

async function loadExtraConfigRows(url) {
  const text = await fetchText(url, 'application/json,text/plain,*/*');
  const config = JSON.parse(text);
  const sites = Array.isArray(config?.sites) ? config.sites : [];
  return sites.map((site, index) => configSiteRow(site, index, url)).filter((row) => row.api && row.name);
}

const markdown = await fetchText(reportUrl, 'text/markdown,text/plain,*/*');
const parsedRows = parseReportTable(markdown);
const iqiyiIndex = parsedRows.findIndex((row) => /爱奇艺|愛奇藝/i.test(row.name));
const reportRows = iqiyiIndex > 0 ? [...parsedRows.slice(iqiyiIndex), ...parsedRows.slice(0, iqiyiIndex)] : parsedRows;
const requiredRows = [
  {
    status: 'ok',
    key: '爱奇艺',
    name: '爱奇艺｜追劇',
    site: 'https://iqiyizyapi.com/',
    api: 'https://iqiyizyapi.com/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'required',
    trend: '',
    origin: 'pinned:user-request:iqiyizyapi.com',
    adult: false,
  },
  {
    status: 'ok',
    key: '豆瓣资源',
    name: '豆瓣资源｜追劇',
    site: 'https://dbzy.tv/',
    api: 'https://dbzy.tv/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'required',
    trend: '',
    origin: 'pinned:user-request:dbzy.tv',
    adult: false,
  },
  {
    status: 'ok',
    key: '天涯资源',
    name: '天涯资源｜追劇',
    site: 'https://tyyszy.com/',
    api: 'https://tyyszy.com/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'required',
    trend: '',
    origin: 'pinned:user-request:tyyszy.com',
    adult: false,
  },
  {
    status: 'ok',
    key: '黑料资源',
    name: '黑料资源｜追劇',
    site: 'https://heiliaozy.cc/',
    api: 'https://www.heiliaozyapi.com/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'required',
    trend: '',
    origin: 'pinned:user-request:heiliaozy.cc',
    adult: true,
  },
  {
    status: 'ok',
    key: '精品资源',
    name: '精品资源｜追劇',
    site: 'https://www.jingpinx.com/',
    api: 'https://www.jingpinx.com/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'required',
    trend: '',
    origin: 'pinned:user-request:jingpinx.com',
    adult: true,
  },
  {
    status: 'ok',
    key: '155-资源',
    name: '155-资源｜追劇',
    site: 'https://155zy2.com/',
    api: 'https://155api.com/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'required',
    trend: '',
    origin: 'pinned:user-request:155zy2.com',
    adult: true,
  },
];
const pinnedRows = [
  {
    status: 'ok',
    key: 'TX',
    name: '腾讯视频｜追劇',
    site: '',
    api: 'https://file.icve.com.cn/file_doc/249/899/3E7E0C8A023B624CEC6BDCC200F06F02.js',
    ext: 'https://cdn.waimaimingtang.com/file/images/bwc/20251023002144-0e40887294.js',
    type: 3,
    searchable: 1,
    quickSearch: 1,
    categories: DEFAULT_CATEGORIES,
    successRate: 'pinned',
    trend: '',
    origin: 'pinned:user-request',
    adult: false,
  },
  {
    status: 'ok',
    key: '雲飛影视',
    name: '雲飛影视｜追劇',
    site: '',
    api: 'http://cj.lziapi.com/api.php/provide/vod/',
    ext: '',
    type: 1,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: [],
    successRate: 'pinned',
    trend: '',
    origin: 'pinned:user-request',
    adult: false,
  },
  {
    status: 'ok',
    key: '七星短剧',
    name: '七星丨短剧',
    site: '',
    api: 'https://mpimg.cn/down.php/48e9d346cdf6da376c53136693bec95a.py',
    ext: '',
    type: 3,
    searchable: 1,
    changeable: 1,
    quickSearch: 1,
    filterable: 1,
    categories: DEFAULT_CATEGORIES,
    successRate: 'pinned',
    trend: '',
    origin: 'pinned:user-request',
    adult: false,
  },
];
const dedupedRows = [];
const duplicateRows = [];
const extraConfigErrors = [];
const seenSourceKeys = new Set();
const seenNameBases = new Set();

function rowIdentity(row) {
  return cleanSourceName(row.key || row.name || '').replace(/\s+/g, '').toLowerCase();
}

function addSourceRow(row, { enforceName = false, pinned = false } = {}) {
  const sourceKeyValue = sourceDedupeKey(row);
  const nameBase = displayNameBase(row.name || row.key);
  if (pinned) {
    const identity = rowIdentity(row);
    const existingIndex = dedupedRows.findIndex((item) => rowIdentity(item) === identity);
    if (existingIndex >= 0) {
      duplicateRows.push({ ...dedupedRows[existingIndex], duplicateReason: 'replaced_by_pinned_source' });
      dedupedRows[existingIndex] = row;
      return;
    }
    dedupedRows.push(row);
    return;
  }
  if (!sourceKeyValue.replace(/\|$/g, '') || seenSourceKeys.has(sourceKeyValue)) {
    duplicateRows.push({ ...row, duplicateReason: 'duplicate_api_or_ext' });
    return;
  }
  if (enforceName && nameBase && seenNameBases.has(nameBase)) {
    duplicateRows.push({ ...row, duplicateReason: 'duplicate_name' });
    return;
  }
  seenSourceKeys.add(sourceKeyValue);
  if (nameBase) seenNameBases.add(nameBase);
  dedupedRows.push(row);
}

for (const row of reportRows) {
  addSourceRow({ ...row, type: apiType(row.api), ext: '', categories: [], origin: reportUrl });
}

for (const url of extraConfigUrls) {
  try {
    const rows = await loadExtraConfigRows(url);
    for (const row of rows) addSourceRow(row, { enforceName: true });
  } catch (error) {
    extraConfigErrors.push({ url, error: error.message });
  }
}

for (const row of requiredRows) {
  addSourceRow(row, { pinned: true });
}

for (const row of pinnedRows) {
  addSourceRow(row, { pinned: true });
}

const requiredOrder = new Map(requiredRows.map((row, index) => [rowIdentity(row), index]));
dedupedRows.sort((left, right) => {
  const leftOrder = requiredOrder.has(rowIdentity(left)) ? requiredOrder.get(rowIdentity(left)) : Number.POSITIVE_INFINITY;
  const rightOrder = requiredOrder.has(rowIdentity(right)) ? requiredOrder.get(rowIdentity(right)) : Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return 0;
});

const categoryChecks = await mapLimit(dedupedRows, concurrency, async (row) => fetchCategories(row));
const sites = dedupedRows.map((row, index) => {
  const categories = categoryChecks[index]?.categories || DEFAULT_CATEGORIES;
  const key = row.key ? cleanSourceName(row.key) : sourceKey(row.name, index);
  row.adult = isAdultSource({ ...row, key, name: row.name || key, categories });
  const site = {
    key,
    name: row.name && /[｜|]/.test(row.name) ? row.name : `${cleanConfigSourceName(row.name || key, key)}｜追劇`,
    type: Number(row.type ?? apiType(row.api)),
    api: normalizeApi(row.api),
    searchable: Number(row.searchable ?? 1),
    quickSearch: Number(row.quickSearch ?? 1),
    categories,
  };
  if (row.ext) site.ext = row.ext;
  if (row.changeable !== undefined) site.changeable = row.changeable;
  if (row.filterable !== undefined) site.filterable = row.filterable;
  return site;
});

function typeLabel(type) {
  if (type === 0) return 'CMS XML/API';
  if (type === 3) return 'Spider/API';
  return 'CMS JSON/API';
}

const outputJson = {
  spider: '',
  logo: 'https://raw.githubusercontent.com/SYLONG7708/TV/main/branding/icon-tech-20260528.png',
  wallpaper: 'http://tool.teyonds.com/api',
  warningText:
    'OKTV all on-demand sources. Auto refreshed daily at 02:00; existing detail pages are preserved and new pages are appended under docs/data/vod-detail.',
  sites,
};

const report = {
  generatedAt: new Date().toISOString(),
  reportUrl,
  totalRows: reportRows.length,
  totalSources: sites.length,
  extraConfigUrls,
  extraConfigErrors,
  requiredSources: requiredRows.map((row) => ({
    key: row.key,
    name: row.name,
    site: row.site,
    api: row.api,
    adult: row.adult,
    origin: row.origin,
  })),
  duplicateSources: duplicateRows.length,
  adultSources: dedupedRows.filter((row) => row.adult).length,
  okRows: dedupedRows.filter((row) => row.status === 'ok').length,
  failedRows: dedupedRows.filter((row) => row.status === 'failed').length,
  categoriesOk: categoryChecks.filter((row) => row.ok).length,
  categoriesFailed: categoryChecks.filter((row) => !row.ok).length,
  sources: dedupedRows.map((row, index) => ({
    key: sites[index].key,
    name: sites[index].name,
    api: sites[index].api,
    ext: sites[index].ext || '',
    changeable: sites[index].changeable,
    host: hostOf(sites[index].api),
    adult: row.adult,
    origin: row.origin || reportUrl,
    status: row.status,
    successRate: row.successRate,
    categories: sites[index].categories,
    categoriesOk: categoryChecks[index]?.ok || false,
    categoriesSkipped: categoryChecks[index]?.skipped || false,
    categoriesError: categoryChecks[index]?.error || '',
  })),
  duplicates: duplicateRows.map((row) => ({
    key: row.key || sourceKey(row.name, 0),
    name: row.name,
    api: row.api,
    ext: row.ext || '',
    changeable: row.changeable,
    origin: row.origin || '',
    adult: row.adult,
    duplicateReason: row.duplicateReason,
  })),
};

const docsVod = sites.map((site, index) => ({
  id: keyId(`${site.key}-${site.api}`, index),
  key: site.key,
  name: site.name,
  type: site.type,
  typeLabel: typeLabel(site.type),
  mode: 'api',
  api: site.api,
  searchable: true,
  changeable: Boolean(site.changeable),
  quickSearch: true,
  categories: site.categories,
  endpointHost: hostOf(site.api),
  hasExt: Boolean(site.ext),
  enabled: true,
  status: 'enabled',
  origin: 'All on-demand sources',
}));

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(reportOutput), { recursive: true });
await fs.mkdir(path.dirname(docsVodOutput), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(outputJson, null, 2)}\n`, 'utf8');
await fs.writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(docsVodOutput, `${JSON.stringify(docsVod, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      output,
      reportOutput,
      docsVodOutput,
      totalSources: sites.length,
      adultSources: report.adultSources,
      categoriesOk: report.categoriesOk,
      categoriesFailed: report.categoriesFailed,
    },
    null,
    2,
  ),
);
