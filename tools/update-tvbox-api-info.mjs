import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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
const inputUrl =
  args.get('inputUrl') || 'https://raw.githubusercontent.com/SYLONG7708/TV/refs/heads/main/sources/TVBOX';
const inputPath = args.get('input') ? path.resolve(args.get('input')) : '';
const outputRoot = path.resolve(
  args.get('outputRoot') || path.join(repoRoot, 'docs', 'data', 'tvbox-api-refresh', 'latest'),
);
const tvboxOutput = path.resolve(args.get('tvboxOutput') || path.join(repoRoot, 'sources', 'TVBOX'));
const reportOutput = path.resolve(args.get('reportOutput') || path.join(repoRoot, 'sources', 'TVBOX.api-info-report.json'));
const timeoutMs = Number(args.get('timeoutMs') || 12000);
const concurrency = Math.max(1, Number(args.get('concurrency') || 12));
const retries = Math.max(0, Number(args.get('retries') || 2));
const windowCount = Math.max(1, Number(args.get('windows') || 3));
const writeTvbox = args.get('writeTvbox') !== 'false';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 OKTV/1.0';

const DEFAULT_EXCLUDED_SOURCE_KEYS = new Set([
  '旺旺资源',
  '旺旺短剧',
  '卧龙资源',
  '金鹰点播',
  '华视影院',
  '百万资源',
  '美少女',
  '黄AVZY',
  '白嫖资源',
  '丝袜资源',
  '优优资源',
]);

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeName(value, fallback = 'source') {
  const text =
    normalizeText(value, fallback)
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || fallback;
  return text;
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
    // Keep support for non-standard TVBox proxy URLs.
  }
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  if (value.includes('?')) return `${value}&${query}`;
  return `${value}?${query}`;
}

async function fetchTextOnce(url, accept = 'application/json,text/xml,application/xml,text/plain,*/*') {
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

async function fetchText(url, accept) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchTextOnce(url, accept);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const rateLimited = /HTTP (?:429|500|502|503|504|701)/i.test(error.message);
      await sleep((rateLimited ? 3000 : 750) * (attempt + 1));
    }
  }
  throw lastError;
}

async function readInputText() {
  if (inputPath) return await fs.readFile(inputPath, 'utf8');
  return await fetchText(inputUrl, 'application/json,text/plain,*/*');
}

function repairJson(text) {
  let repaired = String(text || '').replace(/^\uFEFF/, '');
  // A few hand-edited TVBox files miss commas between adjacent site objects.
  for (let i = 0; i < 3; i += 1) {
    repaired = repaired.replace(/(\n\s*}\s*)\n(\s*{)/g, '$1,\n$2');
  }
  return repaired;
}

function parseTvbox(text) {
  try {
    return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch (firstError) {
    try {
      return JSON.parse(repairJson(text));
    } catch (secondError) {
      secondError.message = `Unable to parse TVBOX JSON: ${secondError.message}; first parse: ${firstError.message}`;
      throw secondError;
    }
  }
}

function decodeXmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function cleanXmlText(value) {
  return decodeXmlEntities(
    String(value ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function parseAttributes(value) {
  const attrs = {};
  for (const match of String(value || '').matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeXmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function parseXmlCategories(text) {
  const rows = [];
  for (const match of String(text || '').matchAll(/<ty\b([^>]*)>([\s\S]*?)<\/ty>/gi)) {
    const attrs = parseAttributes(match[1]);
    const typeName = cleanXmlText(match[2]);
    if (!typeName) continue;
    rows.push({
      type_id: String(attrs.id || attrs.tid || attrs.type_id || rows.length + 1),
      type_name: typeName,
    });
  }
  return rows;
}

function parseJsonMaybe(text) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) return null;
  if (/^</.test(cleaned)) return { class: parseXmlCategories(cleaned), xml: true };
  return JSON.parse(cleaned);
}

function extractArray(payload) {
  if (Array.isArray(payload?.class)) return payload.class;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.types)) return payload.types;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeCategories(payload, fallbackCategories = []) {
  const seen = new Set();
  const rows = [];
  for (const item of extractArray(payload)) {
    const id = normalizeText(
      typeof item === 'string'
        ? rows.length + 1
        : item.type_id ?? item.list_id ?? item.id ?? item.type ?? item.tid ?? rows.length + 1,
    );
    const name = normalizeText(
      typeof item === 'string' ? item : item.type_name ?? item.list_name ?? item.name ?? item.title ?? item.type,
    );
    if (!name) continue;
    const key = name;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id, name });
  }
  if (rows.length > 0) return rows;
  for (const category of Array.isArray(fallbackCategories) ? fallbackCategories : []) {
    const name = normalizeText(category);
    if (!name) continue;
    const key = name;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: String(rows.length + 1), name });
  }
  return rows;
}

function hostOf(value) {
  try {
    const url = new URL(String(value || ''));
    const nested = url.searchParams.get('url');
    if (nested) return new URL(nested).host.toLowerCase();
    return url.host.toLowerCase();
  } catch {
    return '';
  }
}

function looksLikeVodApi(value) {
  return /\/provide\/vod|api(?:json)?\.php|apijson|\/feifei|apple_m3u8|\/vod\b/i.test(String(value || ''));
}

function infoTarget(site) {
  const type = Number(site.type ?? 1);
  const api = normalizeText(site.api);
  const ext = normalizeText(site.ext);
  if ((type === 0 || type === 1) && /^https?:\/\//i.test(api)) {
    return {
      kind: 'cms-list',
      url: addVodQuery(api, 'ac=list'),
      baseApi: api,
      sourceField: 'api',
      parseCategories: true,
    };
  }
  if (type === 3 && /^https?:\/\//i.test(ext) && looksLikeVodApi(ext)) {
    return {
      kind: 'type3-ext-cms-list',
      url: addVodQuery(ext, 'ac=list'),
      baseApi: ext,
      sourceField: 'ext',
      parseCategories: true,
    };
  }
  if (/^https?:\/\//i.test(api)) {
    return {
      kind: type === 3 ? 'type3-script' : type === 4 ? 'type4-proxy' : 'raw-api',
      url: api,
      baseApi: api,
      sourceField: 'api',
      parseCategories: false,
    };
  }
  return {
    kind: 'unsupported',
    url: '',
    baseApi: api,
    sourceField: 'api',
    parseCategories: false,
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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  const headers = [
    'index',
    'key',
    'name',
    'type',
    'adult',
    'api',
    'ext',
    'infoKind',
    'infoUrl',
    'ok',
    'httpLike',
    'bytes',
    'sha256',
    'categoryCount',
    'apiCategoryCount',
    'usedFallbackCategories',
    'host',
    'error',
    'rawResponsePath',
  ];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}

async function refreshSite(site, index) {
  const target = infoTarget(site);
  const fileIdentity = hostOf(target.baseApi || site.api || site.ext) || site.key || site.name || 'source';
  const baseName = `${String(index + 1).padStart(3, '0')}-${safeName(fileIdentity, 'source')}`;
  const rawFileName = `${baseName}.txt`;
  const rawResponsePath = `raw/${rawFileName}`;
  const absoluteRawResponsePath = path.join(outputRoot, 'raw', rawFileName);
  const startedAt = new Date().toISOString();
  if (!target.url) {
    return {
      index: index + 1,
      key: normalizeText(site.key),
      name: normalizeText(site.name || site.key),
      type: Number(site.type ?? 1),
      adult: Boolean(site.adult),
      api: normalizeText(site.api),
      ext: normalizeText(site.ext),
      infoKind: target.kind,
      infoUrl: '',
      infoSourceField: target.sourceField,
      host: hostOf(site.api || site.ext),
      ok: false,
      httpLike: false,
      bytes: 0,
      sha256: '',
      categoryCount: 0,
      categories: normalizeCategories(null, site.categories),
      rawResponsePath: '',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: 'unsupported or empty API URL',
    };
  }

  try {
    const text = await fetchText(target.url);
    await fs.mkdir(path.dirname(absoluteRawResponsePath), { recursive: true });
    await fs.writeFile(absoluteRawResponsePath, text, 'utf8');
    let parsed = null;
    let parseError = '';
    if (target.parseCategories) {
      try {
        parsed = parseJsonMaybe(text);
      } catch (error) {
        parseError = error.message;
      }
    }
    const apiCategories = parsed ? normalizeCategories(parsed, []) : [];
    const fallbackCategories = normalizeCategories(null, site.categories);
    const categories = apiCategories.length > 0 ? apiCategories : fallbackCategories;
    const usedFallbackCategories = apiCategories.length === 0 && fallbackCategories.length > 0;
    return {
      index: index + 1,
      key: normalizeText(site.key),
      name: normalizeText(site.name || site.key),
      type: Number(site.type ?? 1),
      adult: Boolean(site.adult),
      api: normalizeText(site.api),
      ext: normalizeText(site.ext),
      infoKind: target.kind,
      infoUrl: target.url,
      infoSourceField: target.sourceField,
      host: hostOf(target.baseApi),
      ok: target.parseCategories ? apiCategories.length > 0 && !parseError : text.length > 0,
      httpLike: /^https?:\/\//i.test(target.url),
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(text),
      categoryCount: categories.length,
      apiCategoryCount: apiCategories.length,
      usedFallbackCategories,
      categories,
      rawResponsePath,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: parseError,
    };
  } catch (error) {
    return {
      index: index + 1,
      key: normalizeText(site.key),
      name: normalizeText(site.name || site.key),
      type: Number(site.type ?? 1),
      adult: Boolean(site.adult),
      api: normalizeText(site.api),
      ext: normalizeText(site.ext),
      infoKind: target.kind,
      infoUrl: target.url,
      infoSourceField: target.sourceField,
      host: hostOf(target.baseApi),
      ok: false,
      httpLike: /^https?:\/\//i.test(target.url),
      bytes: 0,
      sha256: '',
      categoryCount: 0,
      categories: normalizeCategories(null, site.categories),
      rawResponsePath: '',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

function updatedSite(site, result) {
  const next = { ...site };
  if (Array.isArray(result.categories) && result.categories.length > 0) {
    next.categories = [...new Set(result.categories.map((category) => category.name).filter(Boolean))];
  }
  return next;
}

function splitForWindows(rows) {
  const chunks = Array.from({ length: windowCount }, (_, index) => ({
    window: index + 1,
    sourceCount: 0,
    sources: [],
  }));
  rows.forEach((row, index) => {
    const chunk = chunks[index % chunks.length];
    chunk.sourceCount += 1;
    chunk.sources.push({
      index: row.index,
      key: row.key,
      name: row.name,
      type: row.type,
      adult: row.adult,
      api: row.api,
      ext: row.ext,
      infoKind: row.infoKind,
      infoUrl: row.infoUrl,
      ok: row.ok,
      categoryCount: row.categoryCount,
      rawResponsePath: row.rawResponsePath,
      error: row.error,
    });
  });
  return chunks;
}

const startedAt = new Date().toISOString();
const originalText = await readInputText();
const inputConfig = parseTvbox(originalText);
const inputSites = Array.isArray(inputConfig?.sites) ? inputConfig.sites : [];
const excludedSites = inputSites.filter((site) => DEFAULT_EXCLUDED_SOURCE_KEYS.has(normalizeText(site.key)));
const sites = inputSites.filter((site) => !DEFAULT_EXCLUDED_SOURCE_KEYS.has(normalizeText(site.key)));
if (sites.length === 0) throw new Error('TVBOX has no sites array.');

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
await fs.writeFile(path.join(outputRoot, 'TVBOX.input.raw.json'), repairJson(originalText), 'utf8');

const results = await mapLimit(sites, concurrency, refreshSite);
const updatedConfig = {
  ...inputConfig,
  warningText:
    normalizeText(inputConfig.warningText) ||
    'OKTV all on-demand sources. Auto refreshed daily at 02:00; existing detail pages are preserved and new pages are appended under docs/data/vod-detail.',
  sites: sites.map((site, index) => updatedSite(site, results[index])),
};

const chunks = splitForWindows(results);
const summary = {
  generatedAt: new Date().toISOString(),
  startedAt,
  inputUrl: inputPath ? '' : inputUrl,
  inputPath,
  outputRoot,
  tvboxOutput,
  reportOutput,
  inputSources: inputSites.length,
  excludedSources: excludedSites.length,
  excludedSourceKeys: excludedSites.map((site) => normalizeText(site.key || site.name)),
  totalSources: results.length,
  okSources: results.filter((row) => row.ok).length,
  failedSources: results.filter((row) => !row.ok).length,
  cmsInfoSources: results.filter((row) => row.infoKind.includes('cms-list')).length,
  rawScriptSources: results.filter((row) => row.infoKind === 'type3-script' || row.infoKind === 'type4-proxy').length,
  adultSources: results.filter((row) => row.adult).length,
  totalBytes: results.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
  windowCount,
  chunks: chunks.map((chunk) => ({ window: chunk.window, sourceCount: chunk.sourceCount })),
};

const report = {
  ...summary,
  sources: results,
};

await writeJson(path.join(outputRoot, 'source-api-info.json'), report);
await fs.writeFile(path.join(outputRoot, 'source-api-info.csv'), `${toCsv(results)}\n`, 'utf8');
await writeJson(path.join(outputRoot, 'window-chunks.json'), chunks);
for (const chunk of chunks) {
  await writeJson(path.join(outputRoot, `window-${chunk.window}.json`), chunk);
}
await writeJson(reportOutput, report);
if (writeTvbox) {
  await writeJson(tvboxOutput, updatedConfig);
}

console.log(JSON.stringify(summary, null, 2));
