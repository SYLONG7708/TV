import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeStableGzipJson } from './stable-gzip-json.mjs';

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
const detailRoot = path.resolve(args.get('detailRoot') || path.join(tvRoot, 'docs', 'data', 'vod-detail'));
const timeoutMs = Number(args.get('timeoutMs') || 15000);
const sourceMatch = normalizeText(args.get('sourceMatch') || '').toLowerCase();
const maxSources = Number(args.get('maxSources') || 0);
const pageSize = Number(args.get('pageSize') || 24);
const maxPagesPerCategory = Number(args.get('maxPagesPerCategory') || 3);
const maxCategoryPageSafetyLimit = Number(args.get('maxCategoryPageSafetyLimit') || 200);
const detailConcurrency = Number(args.get('detailConcurrency') || 8);
const outputPageSize = Number(args.get('outputPageSize') || 80);
const fetchRetries = Math.max(1, Number(args.get('fetchRetries') || 3));
const keepExistingOnFailure = args.get('keepExistingOnFailure') !== 'false';

const USER_AGENT = 'OKTV-type3-spider-engine/1.0';
const QIXING_API_RE = /mpimg\.cn\/down\.php\/48e9d346cdf6da376c53136693bec95a\.py/i;
const TENCENT_EXT_RE = /20251023002144-0e40887294\.js|video\.qq|v\.qq\.com/i;

const QIXING_CATEGORIES = [
  { id: '1', name: '\u4e03\u661f\u5287\u5834' },
  { id: '3', name: '\u4e03\u661f\u65b0\u5287' },
  { id: '2', name: '\u4e03\u661f\u71b1\u64ad' },
  { id: '7', name: '\u4e03\u661f\u661f\u9078' },
  { id: '5', name: '\u4e03\u661f\u967d\u5149' },
];

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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fetchText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= fetchRetries; attempt += 1) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: withTimeout(),
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': USER_AGENT,
          ...(options.headers || {}),
        },
        method: options.method || 'GET',
        body: options.body,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      return text;
    } catch (error) {
      lastError = error;
      if (attempt === fetchRetries) break;
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, options));
}

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

function sourceSlug(source) {
  return slugify(`${source.host || source.key || source.name}-${source.id}`, 'source');
}

function textId(input, index = 0) {
  const value = normalizeText(input, `item-${index}`)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${value || 'item'}-${index + 1}`;
}

function imageUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return raw.replace(/^http:/i, 'https:');
}

function isDirectMediaUrl(value) {
  return /\.(m3u8|mp4|m4v|webm|mov|flv|ts)(?:$|[?#])/i.test(String(value || '').trim());
}

function mediaUrl(value) {
  const raw = normalizeText(value);
  if (!/^https?:\/\//i.test(raw) || !isDirectMediaUrl(raw)) return '';
  return raw.replace(/^http:/i, 'https:');
}

function parseYear(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? match[0] : '';
}

function parseNumber(value) {
  const raw = normalizeText(value);
  if (!raw) return 0;
  const number = Number(raw.match(/\d+(?:\.\d+)?/)?.[0] || 0);
  if (!Number.isFinite(number)) return 0;
  if (/[亿億]/.test(raw)) return Math.round(number * 100000000);
  if (/万|萬/.test(raw)) return Math.round(number * 10000);
  return number;
}

function parseScore(value) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseEpoch(value) {
  const raw = normalizeText(value);
  if (!raw) return 0;
  const time = Date.parse(raw.replace(/-/g, '/'));
  return Number.isFinite(time) ? time : 0;
}

function buildQixingLoginBody() {
  const payload = {
    device: '2a50580e69d38388c94c93605241fb306',
    package_name: 'com.jz.xydj',
    android_id: 'ec1280db12795506',
    install_first_open: true,
    first_install_time: 1752505243345,
    last_update_time: 1752505243345,
    report_link_url: '',
    authorization: '',
    timestamp: Date.now(),
  };
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('B@ecf920Od8A4df7', 'utf8'), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('base64');
}

async function qixingLogin() {
  const payload = await fetchJson('https://u.shytkjgs.com/user/v3/account/login', {
    method: 'POST',
    headers: {
      platform: '1',
      user_agent:
        'Mozilla/5.0 (Linux; Android 9; V1938T Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
      'content-type': 'application/json; charset=utf-8',
    },
    body: buildQixingLoginBody(),
  });
  const token = normalizeText(payload?.data?.token);
  if (!token) throw new Error('Qixing login returned no token');
  return token;
}

function qixingHeaders(token) {
  return {
    authorization: token,
    platform: '1',
    version_name: '3.8.3.1',
  };
}

async function qixingCategoryPage(token, category, page) {
  const url = `https://app.whjzjx.cn/v1/theater/home_page?theater_class_id=${encodeURIComponent(
    category.id,
  )}&page_num=${page}&page_size=${pageSize}`;
  const payload = await fetchJson(url, { headers: qixingHeaders(token) });
  const rows = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  return rows
    .map((row) => ({
      category,
      theater: row?.theater || row,
    }))
    .filter((row) => row.theater?.id && row.theater?.title);
}

async function qixingDetail(token, theaterId) {
  const url = `https://app.whjzjx.cn/v2/theater_parent/detail?theater_parent_id=${encodeURIComponent(theaterId)}`;
  const payload = await fetchJson(url, { headers: qixingHeaders(token) });
  return payload?.data || null;
}

function qixingEpisodes(detail) {
  const theaters = Array.isArray(detail?.theaters) ? detail.theaters : [];
  const episodes = theaters
    .map((row, index) => {
      const url = mediaUrl(row?.son_video_url);
      if (!url) return null;
      return {
        name: `${normalizeText(row?.num, index + 1)} \u96c6`,
        url,
      };
    })
    .filter(Boolean);

  if (episodes.length > 0) return episodes;

  const single = mediaUrl(detail?.video_url);
  return single ? [{ name: '1 \u96c6', url: single }] : [];
}

function normalizeQixingItem(source, slug, category, theater, detail, detailPage) {
  const title = normalizeText(detail?.title || theater?.title);
  if (!title) return null;
  const episodes = qixingEpisodes(detail);
  if (episodes.length === 0) return null;

  const classNames = Array.isArray(detail?.class_two)
    ? detail.class_two.map((row) => normalizeText(row?.class_name)).filter(Boolean)
    : [];
  const descTags = Array.isArray(detail?.desc_tags) ? detail.desc_tags.map(normalizeText).filter(Boolean) : [];
  const genre = [...new Set(['\u77ed\u5287', category.name, ...classNames, ...descTags].filter(Boolean))];
  const updatedAt = normalizeText(theater?.updated_at || detail?.updated_at || theater?.created_at || '');
  const views = parseNumber(theater?.play_amount_str || theater?.play_amount || detail?.play_amount || '');
  const score = parseScore(detail?.score || theater?.score_str || theater?.from_data_score || '');
  const vodId = String(detail?.id || theater?.id || '');
  const id = textId(`${source.id}::${vodId || title}`, 0);

  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    vodId,
    title,
    originalName: '',
    kind: 'short',
    categoryId: category.id,
    categoryName: category.name,
    year: parseYear(updatedAt || theater?.created_at),
    area: descTags[0] || '',
    genre,
    remarks: normalizeText(detail?.filing || theater?.play_amount_str || theater?.theme || ''),
    actor: '',
    director: '',
    content: normalizeText(detail?.introduction || theater?.introduction || theater?.descrip || '').slice(0, 220),
    score,
    views,
    hot: views + score * 100 + parseEpoch(updatedAt) / 100000000,
    updatedAt,
    poster: imageUrl(detail?.cover_url || theater?.cover_url || theater?.share_cover),
    episodes,
    episodeCount: episodes.length,
    playable: true,
    adult: Boolean(source.adult),
    lazyEpisodes: true,
    detailPage,
    detailPath: `vod-detail/${slug}/page-${String(detailPage).padStart(4, '0')}.json.gz`,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function writeDetailPages(source, slug, items, total, checks) {
  const sourceDir = path.join(detailRoot, slug);
  await fs.rm(sourceDir, { recursive: true, force: true });
  await fs.mkdir(sourceDir, { recursive: true });

  const chunks = chunkItems(items, outputPageSize);
  for (let index = 0; index < chunks.length; index += 1) {
    const page = index + 1;
    const pageItems = chunks[index].map((item) => ({
      ...item,
      detailPage: page,
      detailPath: `vod-detail/${slug}/page-${String(page).padStart(4, '0')}.json.gz`,
    }));
    const detailPayload = {
      generatedAt: new Date().toISOString(),
      sourceId: source.id,
      sourceName: source.name,
      sourceKey: source.key,
      api: source.api,
      spiderEngine: source.spiderEngine,
      page,
      pagecount: chunks.length,
      total,
      checks,
      items: pageItems,
    };
    await writeStableGzipJson(
      path.join(sourceDir, `page-${String(page).padStart(4, '0')}.json.gz`),
      detailPayload,
    );
  }
  return chunks.length;
}

async function indexQixingSource(source) {
  const slug = sourceSlug(source);
  const token = await qixingLogin();
  const categoryPages = [];
  const rawRows = [];
  const categoryPageLimit = Math.max(1, maxPagesPerCategory > 0 ? maxPagesPerCategory : maxCategoryPageSafetyLimit);

  for (const category of QIXING_CATEGORIES) {
    for (let page = 1; page <= categoryPageLimit; page += 1) {
      const rows = await qixingCategoryPage(token, category, page);
      categoryPages.push({ category: category.name, page, count: rows.length });
      rawRows.push(...rows);
      if (rows.length === 0) break;
      if (maxPagesPerCategory <= 0 && rows.length < pageSize) break;
    }
  }

  const uniqueRows = [];
  const seenVodIds = new Set();
  for (const row of rawRows) {
    const key = String(row.theater.id);
    if (seenVodIds.has(key)) continue;
    seenVodIds.add(key);
    uniqueRows.push(row);
  }

  const detailRows = await mapLimit(uniqueRows, detailConcurrency, async (row) => {
    try {
      const detail = await qixingDetail(token, row.theater.id);
      return normalizeQixingItem(source, slug, row.category, row.theater, detail, 1);
    } catch (error) {
      return { error: error.message, theaterId: row.theater.id, title: row.theater.title };
    }
  });

  const items = detailRows.filter((row) => row && !row.error);
  const failedDetails = detailRows.filter((row) => row?.error);
  if (items.length === 0) throw new Error(`Qixing spider produced no playable detail items; failedDetails=${failedDetails.length}`);

  const checks = [
    { label: 'spider-qixing-login', ok: true },
    {
      label: 'spider-qixing-snapshot',
      ok: true,
      count: items.length,
      playable: items.filter((item) => item.playable).length,
      rawRows: rawRows.length,
      uniqueRows: uniqueRows.length,
      failedDetails: failedDetails.length,
      pageLimitMode: maxPagesPerCategory > 0 ? 'capped' : 'until-empty-or-short-page',
      maxCategoryPageSafetyLimit,
      categoryPages,
    },
  ];

  const sourceForDetail = { ...source, spiderEngine: 'qixing-short-drama-v1' };
  const pagecount = await writeDetailPages(sourceForDetail, slug, items, uniqueRows.length, checks);

  return {
    source: {
      ...source,
      spiderEngine: 'qixing-short-drama-v1',
      spiderIndexable: true,
      indexed: true,
      itemCount: items.length,
      playableCount: items.filter((item) => item.playable).length,
      sourceTotalCount: uniqueRows.length,
      detailMode: 'spider-json-gzip',
      detailPathPattern: `vod-detail/${slug}/page-{page}.json.gz`,
      detailPageCount: pagecount,
      detailExpectedPages: pagecount,
      categories: QIXING_CATEGORIES.map((category) => ({ ...category, kind: 'short' })),
      checks,
      error: '',
    },
    items,
  };
}

async function probeUnsupportedTencent(source) {
  const apiText = await fetchText(source.api);
  const extText = source.ext ? await fetchText(source.ext) : '';
  const hasSearchApi = /pbaccess\.video\.qq\.com/.test(extText);
  const usesProxyParse = /127\.0\.0\.1:9978|play_parse\s*:\s*true/.test(extText);
  const officialUrlsOnly = /v\.qq\.com\/x\/cover/.test(extText);
  return {
    source: {
      ...source,
      spiderEngine: 'drpy-proxy-required',
      spiderIndexable: false,
      indexed: false,
      itemCount: 0,
      playableCount: 0,
      checks: [
        {
          label: 'spider-drpy-probe',
          ok: false,
          apiBytes: apiText.length,
          extBytes: extText.length,
          hasSearchApi,
          usesProxyParse,
          officialUrlsOnly,
          error: 'drpy source needs a local proxy/parser and does not expose direct m3u8/mp4 URLs',
        },
      ],
      error: 'type3 spider requires proxy parser; direct playable URLs unavailable',
    },
    items: [],
  };
}

function adapterFor(source) {
  const haystack = [source.key, source.name, source.api, source.ext].map(normalizeText).join(' ');
  if (QIXING_API_RE.test(haystack)) return indexQixingSource;
  if (/TX|tencent/i.test(source.key || '') || TENCENT_EXT_RE.test(haystack)) return probeUnsupportedTencent;
  return null;
}

function sourceMatches(source) {
  if (!sourceMatch) return true;
  return normalizeText([source.id, source.key, source.name, source.api, source.ext, source.host].join(' ')).toLowerCase().includes(sourceMatch);
}

function sourceCheck(source) {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    api: source.api,
    ext: source.ext,
    origin: source.origin,
    adult: source.adult,
    indexable: source.indexable,
    spiderIndexable: source.spiderIndexable,
    spiderEngine: source.spiderEngine,
    indexed: source.indexed,
    itemCount: source.itemCount,
    playableCount: source.playableCount,
    sourceTotalCount: source.sourceTotalCount,
    detailPageCount: source.detailPageCount,
    detailExpectedPages: source.detailExpectedPages,
    detailPathPattern: source.detailPathPattern,
    error: source.error,
    checks: source.checks,
  };
}

const catalog = await readJson(catalogPath);
if (!catalog) throw new Error(`Catalog not found: ${catalogPath}`);

await fs.mkdir(detailRoot, { recursive: true });

const candidates = (catalog.sources || [])
  .filter((source) => Number(source.type) === 3)
  .filter(sourceMatches)
  .filter((source) => adapterFor(source));
const targets = maxSources > 0 ? candidates.slice(0, maxSources) : candidates;

const results = [];
for (const source of targets) {
  const adapter = adapterFor(source);
  try {
    const result = await adapter(source);
    results.push(result);
    console.log(`${source.name}: spider ${result.source.indexed ? 'indexed' : 'probed'} ${result.source.itemCount || 0} items`);
  } catch (error) {
    console.warn(`${source.name}: spider failed: ${error.message}`);
    results.push({
      source: {
        ...source,
        indexed: keepExistingOnFailure ? Boolean(source.indexed) : false,
        itemCount: keepExistingOnFailure ? Number(source.itemCount || 0) : 0,
        playableCount: keepExistingOnFailure ? Number(source.playableCount || 0) : 0,
        checks: [{ label: 'type3-spider-engine', ok: false, error: error.message }],
        error: error.message,
      },
      items: [],
    });
  }
}

const updatedSourceById = new Map(results.map((result) => [result.source.id, result.source]));
const sources = (catalog.sources || []).map((source) => updatedSourceById.get(source.id) || source);

const nextCatalog = {
  ...catalog,
  generatedAt: new Date().toISOString(),
  source: {
    ...(catalog.source || {}),
    type3SpiderEngine: true,
  },
  sources,
};

const existingReport = (await readJson(reportPath, {})) || {};
const report = {
  ...existingReport,
  generatedAt: nextCatalog.generatedAt,
  totals: nextCatalog.totals,
  type3SpiderEngine: {
    generatedAt: nextCatalog.generatedAt,
    targets: targets.length,
    indexedSources: results.filter((result) => result.source.indexed).length,
    playableItems: results.reduce((sum, result) => sum + Number(result.source.playableCount || 0), 0),
    checks: results.map((result) => sourceCheck(result.source)),
  },
  sourceChecks: sources.map(sourceCheck),
};

await writeJson(catalogPath, nextCatalog);
await writeJson(reportPath, report);

console.log(
  JSON.stringify(
    {
      catalogPath,
      reportPath,
      detailRoot,
      targets: targets.length,
      indexedSources: results.filter((result) => result.source.indexed).length,
      playableItems: results.reduce((sum, result) => sum + Number(result.source.playableCount || 0), 0),
    },
    null,
    2,
  ),
);
