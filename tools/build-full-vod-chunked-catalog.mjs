import fs from 'node:fs/promises';
import path from 'node:path';
import { writeStableGzipJson } from './stable-gzip-json.mjs';
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

const tvRoot = path.resolve(args.get('tvRoot') || path.resolve(import.meta.dirname, '..'));
const catalogPath = path.resolve(args.get('catalog') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog.json'));
const reportPath = path.resolve(args.get('report') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog-report.json'));
const detailRoot = path.resolve(args.get('detailRoot') || path.join(tvRoot, 'docs', 'data', 'vod-detail'));
const includeAdult = args.get('includeAdult') !== 'false';
const sourceMatch = String(args.get('sourceMatch') || '').trim().toLowerCase();
const pageSize = Number(args.get('pageSize') || 100);
const maxSources = Number(args.get('maxSources') || 0);
const maxPagesPerSource = Number(args.get('maxPagesPerSource') || 0);
const maxNewPagesPerSource = Math.max(0, Number(args.get('maxNewPagesPerSource') || 0));
const startPage = Math.max(1, Number(args.get('startPage') || 1));
const endPage = Math.max(0, Number(args.get('endPage') || 0));
const sourceConcurrency = Number(args.get('sourceConcurrency') || 2);
const pageConcurrency = Number(args.get('pageConcurrency') || 8);
const outputPageSize = Number(args.get('outputPageSize') || 500);
const timeoutMs = Number(args.get('timeoutMs') || 20000);
const retries = Number(args.get('retries') || args.get('fetchRetries') || 2);
const retryDelayMs = Number(args.get('retryDelayMs') || 750);
const rateLimitDelayMs = Number(args.get('rateLimitDelayMs') || 8000);
const pageDelayMs = Number(args.get('pageDelayMs') || 0);
const keepExistingOnFailure = args.get('keepExistingOnFailure') !== 'false';
const detailOnly = args.get('detailOnly') === 'true';
const appendDetailPages = args.get('appendDetailPages') === 'true' || startPage > 1 || endPage > 0;
const skipExistingPages = args.get('skipExistingPages') !== 'false';
const keepPartialPages = args.get('keepPartialPages') === 'true';
const includeEmptySeedSources = args.get('includeEmptySeedSources') === 'true';
const refreshLeadingPages = Math.max(0, Number(args.get('refreshLeadingPages') || 0));
const maxFailedPages = Math.max(0, Number(args.get('maxFailedPages') || 0));
const validateExistingPages = args.get('validateExistingPages') === 'true';
const pruneObsoletePages = args.get('pruneObsoletePages') === 'true';

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
      const rateLimited = /HTTP (?:429|520|521|522|523|524|525|701|502|503|504)/i.test(error.message);
      await sleep((rateLimited ? rateLimitDelayMs : retryDelayMs) * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchVodPayload(url) {
  return parseVodPayload(await fetchText(url));
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
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
    // Fall back to the historical concatenation for non-standard proxy URLs.
  }
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  if (value.includes('?')) return `${value}&${query}`;
  return `${value}?${query}`;
}

function vodAction(source) {
  return Number(source?.type) === 0 ? 'videolist' : 'detail';
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

function normalizePayload(payload) {
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (/^</.test(text)) return parseXmlPayload(text);
    return JSON.parse(text);
  }
  return payload || {};
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

function detailDirFromPattern(pattern) {
  const match = normalizeText(pattern).match(/vod-detail\/([^/]+)\/page-\{page\}\.json\.gz/i);
  return match?.[1] || '';
}

function sourceDetailSlug(source) {
  return detailDirFromPattern(source.detailPathPattern) || slugify(`${source.host || source.key || source.name}-${source.id}`, 'source');
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

function parseEpoch(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const time = Date.parse(raw.replace(/-/g, '/'));
  return Number.isFinite(time) ? time : 0;
}

function normalizeArea(value) {
  return normalizeText(value)
    .replace(/中国大陆|中國大陸|大陆|大陸|内地|內地/g, '大陸')
    .replace(/中国香港|中國香港/g, '香港')
    .replace(/中国台湾|中国台灣|中国臺灣|中國台湾|中國台灣|中國臺灣/g, '台灣')
    .replace(/中国澳门|中國澳門|澳门|澳門/g, '澳門')
    .replace(/韩国|韓國/g, '韓國')
    .replace(/泰国|泰國/g, '泰國')
    .replace(/欧美|歐美|美国|美國|英国|英國/g, '歐美');
}

function splitClasses(value, fallback = '') {
  return [...new Set(`${value || ''},${fallback || ''}`.split(/[,\s/、]+/).map(normalizeText).filter(Boolean))];
}

function kindFromTypeName(typeName, sourceAdult = false) {
  return classifyVodKind(typeName, sourceAdult);
}

function isDirectMediaUrl(value) {
  return /\.(m3u8|mp4|m4v|webm|mov|flv|ts)(?:$|[?#])/i.test(String(value || '').trim());
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

function normalizeVodItem(item, source, sourceSlug, page) {
  const title = normalizeText(item.vod_name ?? item.name ?? item.title);
  if (!title) return null;
  const typeName = normalizeText(item.type_name || item.list_name || '');
  const playUrl = item.vod_play_url || item.vod_url || item.vod_play_url_with_player || item.play_url || item.url;
  const episodes = parseEpisodes(playUrl);

  const year = parseYear(item.vod_year || item.year || item.vod_time || item.update_time || item.vod_pubdate || item.vod_addtime);
  const area = normalizeArea(item.vod_area || item.area || item.region || item.vod_area_name || '');
  const genre = splitClasses(item.vod_class || item.class || item.tag, typeName);
  const score = parseNumber(item.vod_score || item.score || item.douban_score);
  const views = parseNumber(item.vod_hits || item.hits || item.views || item.play_count || item.vod_up);
  const updatedAt = normalizeText(item.vod_time || item.update_time || item.vod_pubdate || item.created_at || item.vod_addtime || '');
  const vodId = String(item.vod_id ?? item.id ?? '');
  const id = `${source.id}::${normalizeText(vodId || title)}`;

  return {
    id: textId(id, 0),
    sourceId: source.id,
    sourceName: source.name,
    vodId,
    title,
    originalName: normalizeText(item.vod_en || item.original_name || ''),
    kind: classifyVodKind({ categoryName: typeName, genre, sourceAdult: source.adult }),
    categoryId: String(item.type_id || ''),
    categoryName: typeName,
    year,
    area,
    genre,
    remarks: normalizeText(item.vod_remarks || item.remarks || item.note || ''),
    actor: normalizeText(item.vod_actor || item.actor || ''),
    director: normalizeText(item.vod_director || item.director || ''),
    content: normalizeText(item.vod_content || item.content || item.desc || ''),
    rawPlayUrl: normalizeText(playUrl),
    score,
    views,
    hot: views + score * 100 + parseEpoch(updatedAt) / 100000000,
    updatedAt,
    poster: imageUrl(source.api, item.vod_pic || item.pic || item.cover || item.logo || item.vod_pic_thumb),
    episodes,
    episodeCount: episodes.length,
    playable: episodes.length > 0,
    adult: Boolean(source.adult),
    lazyEpisodes: true,
    detailPage: page,
    detailPath: `vod-detail/${sourceSlug}/page-${String(page).padStart(4, '0')}.json.gz`,
  };
}

function compactItem(item) {
  const { episodes, ...rest } = item;
  return rest;
}

function extractArray(payload) {
  if (Array.isArray(payload?.data) && payload.data.some((item) => item?.vod_name || item?.name || item?.title)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.videos)) return payload.videos;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  let aborted = false;
  const errors = [];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !aborted) {
      const current = next++;
      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        errors.push({ index: current, error });
        aborted = true;
      }
    }
  });
  await Promise.all(workers);
  if (errors.length > 0) {
    const first = errors[0].error;
    if (errors.length > 1) first.message = `${first.message} (${errors.length} page failures)`;
    throw first;
  }
  return results;
}

async function fetchSourcePage(source, sourceSlug, page) {
  if (pageDelayMs > 0) await sleep(pageDelayMs);
  const payload = normalizePayload(
    await fetchText(addVodQuery(source.api, `ac=${vodAction(source)}&pg=${page}&pagesize=${pageSize}&limit=${pageSize}`)),
  );
  const rawRows = extractArray(payload);
  const rows = rawRows
    .map((item) => normalizeVodItem(item, source, sourceSlug, page))
    .filter(Boolean);
  return {
    page,
    pagecount: Number(payload.pagecount || payload.pageCount || payload.page?.pagecount || 1) || 1,
    total: Number(payload.total || payload.totalCount || payload.page?.recordcount || 0) || 0,
    limit: Number(payload.limit || payload.page?.pagesize || 0) || 0,
    rawCount: rawRows.length,
    rows,
  };
}

async function writeDetailPage(source, sourceSlug, pageResult, pagecount) {
  const { page, rows, total, rawCount } = pageResult;
  const sourceDir = path.join(detailRoot, sourceSlug);
  await fs.mkdir(sourceDir, { recursive: true });
  const detailPath = `vod-detail/${sourceSlug}/page-${String(page).padStart(4, '0')}.json.gz`;
  const items = rows.map((item) => ({
    ...item,
    detailPage: page,
    detailPath,
  }));
  const detailPayload = {
    generatedAt: new Date().toISOString(),
    sourceId: source.id,
    sourceName: source.name,
    sourceKey: source.key,
    api: source.api,
    page,
    pagecount,
    total,
    rawCount,
    items,
  };
  await writeStableGzipJson(
    path.join(sourceDir, `page-${String(page).padStart(4, '0')}.json.gz`),
    detailPayload,
  );
  return items;
}

async function listExistingDetailPages(sourceDir, validate = false) {
  try {
    const files = await fs.readdir(sourceDir);
    const pages = new Set();
    for (const file of files) {
      const page = Number(file.match(/^page-(\d+)\.json(?:\.gz)?$/i)?.[1] || 0);
      if (page < 1) continue;
      if (validate) {
        try {
          const data = await fs.readFile(path.join(sourceDir, file));
          const text = /\.gz$/i.test(file) ? zlib.gunzipSync(data).toString('utf8') : data.toString('utf8');
          const payload = JSON.parse(text);
          if (Number(payload?.page || page) !== page || !Array.isArray(payload?.items)) continue;
        } catch {
          continue;
        }
      }
      pages.add(page);
    }
    return pages;
  } catch {
    return new Set();
  }
}

async function detailCoverage(sourceDir, expectedPages, validate = false) {
  const pages = await listExistingDetailPages(sourceDir, validate);
  const missingPages = [];
  for (let page = 1; page <= expectedPages; page += 1) {
    if (!pages.has(page)) missingPages.push(page);
  }
  return {
    pageCount: expectedPages - missingPages.length,
    fileCount: pages.size,
    missingPages,
    extraPages: [...pages].filter((page) => page > expectedPages),
    complete: expectedPages > 0 && missingPages.length === 0,
  };
}

async function pruneDetailPages(sourceDir, pages) {
  for (const page of pages) {
    await fs.rm(path.join(sourceDir, `page-${String(page).padStart(4, '0')}.json.gz`), { force: true });
    await fs.rm(path.join(sourceDir, `page-${String(page).padStart(4, '0')}.json`), { force: true });
  }
}

function matchesSource(source) {
  if (!sourceMatch) return true;
  return normalizeText([source.id, source.key, source.name, source.api, source.host, source.origin].join(' ')).toLowerCase().includes(sourceMatch);
}

async function indexSource(source) {
  const sourceSlug = sourceDetailSlug(source);
  const sourceDir = path.join(detailRoot, sourceSlug);
  const tempDir = path.join(detailRoot, `.tmp-${sourceSlug}-${process.pid}-${Date.now()}`);

  try {
  const first = await fetchSourcePage(source, sourceSlug, 1);
  const fullPagecount = first.pagecount;
  let lastPage = endPage > 0 ? Math.min(fullPagecount, endPage) : fullPagecount;
  if (maxPagesPerSource > 0) lastPage = Math.min(lastPage, startPage + maxPagesPerSource - 1);
  const requestedPages = Array.from({ length: Math.max(0, lastPage - startPage + 1) }, (_, index) => startPage + index);
  const existingPages = appendDetailPages && skipExistingPages
    ? await listExistingDetailPages(sourceDir, validateExistingPages)
    : new Set();
  let targetPages = [];
  for (const page of requestedPages) {
    if (appendDetailPages && skipExistingPages && page > refreshLeadingPages && existingPages.has(page)) continue;
    targetPages.push(page);
  }
  const candidatePageCount = targetPages.length;
  if (maxNewPagesPerSource > 0 && targetPages.length > maxNewPagesPerSource) {
    const leadingPages = targetPages.filter((page) => page <= refreshLeadingPages);
    const remainingPages = targetPages.filter((page) => page > refreshLeadingPages);
    targetPages = [...leadingPages, ...remainingPages].slice(0, maxNewPagesPerSource);
    console.log(`${source.name}: limiting to ${targetPages.length}/${candidatePageCount} refresh or missing pages for this run`);
  }

  if (targetPages.length === 0) {
    const coverage = await detailCoverage(sourceDir, fullPagecount, validateExistingPages);
    console.log(`${source.name}: no missing pages in requested range ${startPage}-${lastPage}`);
    return {
      source: {
        ...source,
        indexed: true,
        complete: coverage.complete,
        detailMode: 'chunked-json-gzip',
        detailPageCount: coverage.pageCount,
        detailExpectedPages: fullPagecount,
        detailPathPattern: `vod-detail/${sourceSlug}/page-{page}.json.gz`,
        checks: [
          {
            label: 'full-latest-pages',
            ok: true,
            count: 0,
            pages: coverage.pageCount,
            pagecount: fullPagecount,
            total: first.total,
            missingPages: coverage.missingPages.length,
          },
        ],
        error: '',
      },
      items: [],
    };
  }

  let fetchedPages = 0;
  if (targetPages.length > 1) {
    console.log(`${source.name}: fetching range ${targetPages[0]}-${targetPages[targetPages.length - 1]} of ${fullPagecount}`);
  }
  const pageResults = [];
  const failures = [];
  const writeSlug = appendDetailPages ? sourceSlug : path.basename(tempDir);
  if (targetPages.includes(1)) {
    pageResults.push(first);
    await writeDetailPage(source, writeSlug, first, fullPagecount);
    fetchedPages += 1;
    console.log(`${source.name}: fetched ${fetchedPages}/${targetPages.length} requested pages`);
  }
  const restPageNumbers = targetPages.filter((page) => page !== 1);
  const rest = await mapLimit(restPageNumbers, pageConcurrency, async (page) => {
    try {
      const result = await fetchSourcePage(source, sourceSlug, page);
      await writeDetailPage(source, writeSlug, result, fullPagecount);
      fetchedPages += 1;
      if (fetchedPages % 50 === 0 || fetchedPages === targetPages.length) {
        console.log(`${source.name}: fetched ${fetchedPages}/${targetPages.length} requested pages`);
      }
      return { ok: true, result };
    } catch (error) {
      if (!keepPartialPages) throw error;
      failures.push({ page, error: error.message });
      console.warn(`${source.name}: page ${page} failed: ${error.message}`);
      if (maxFailedPages > 0 && failures.length >= maxFailedPages) {
        throw new Error(`stopped after ${failures.length} failed pages; latest page ${page}: ${error.message}`);
      }
      return { ok: false, page, error: error.message };
    }
  });
  for (const row of rest) {
    if (row?.ok) pageResults.push(row.result);
  }
  const pages = pageResults.sort((a, b) => a.page - b.page);
  const compact = [];
  const seen = new Set();
  const pendingRows = [];
  let playableCount = 0;
  let total = 0;
  let completedSourcePages = 0;
  let writtenDetailPages = 0;

  for (const page of pages) {
    total = Math.max(total, page.total);
    for (const item of page.rows) {
      const key = item.vodId || `${item.title}|${item.poster}`;
      if (seen.has(key)) continue;
      seen.add(key);
      compact.push(compactItem(item));
      if (item.playable) playableCount += 1;
    }
  };

  if (!appendDetailPages) {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rename(tempDir, sourceDir);
  }

  let coverage = await detailCoverage(sourceDir, fullPagecount, validateExistingPages);
  const refreshedCompleteRange = startPage === 1 && lastPage === fullPagecount && candidatePageCount === targetPages.length;
  if (pruneObsoletePages && refreshedCompleteRange && failures.length === 0 && coverage.complete && coverage.extraPages.length) {
    await pruneDetailPages(sourceDir, coverage.extraPages);
    coverage = await detailCoverage(sourceDir, fullPagecount, validateExistingPages);
  }
  console.log(`${source.name}: ${compact.length}/${total || compact.length} items, ${pages.length} pages`);
  if (failures.length > 0) {
    throw new Error(`partial range saved; failed pages: ${failures.map((failure) => `${failure.page} ${failure.error}`).join(', ')}`);
  }
  return {
    source: {
      ...source,
      itemCount: compact.length,
      playableCount,
      sourceTotalCount: total || compact.length,
      indexed: compact.length > 0,
      complete: coverage.complete,
      detailMode: 'chunked-json-gzip',
      detailPageCount: coverage.pageCount,
      detailExpectedPages: fullPagecount,
      detailPathPattern: `vod-detail/${sourceSlug}/page-{page}.json.gz`,
      checks: [
        {
          label: 'full-latest-pages',
          ok: true,
          count: compact.length,
          pages: coverage.pageCount,
          pagecount: fullPagecount,
          total: total || compact.length,
          missingPages: coverage.missingPages.length,
        },
      ],
      error: '',
    },
    items: detailOnly ? [] : compact,
  };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
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

const existingCatalog = await readJson(catalogPath);
if (!existingCatalog) throw new Error(`Catalog not found: ${catalogPath}`);

await fs.mkdir(detailRoot, { recursive: true });
const candidateSources = (existingCatalog.sources || [])
  .filter((source) => source.indexable && /^https?:\/\//i.test(source.api || ''))
  .filter((source) => includeEmptySeedSources || Number(source.playableCount || source.itemCount || 0) > 0)
  .filter((source) => includeAdult || !source.adult)
  .filter(matchesSource);
const targetSources = maxSources > 0 ? candidateSources.slice(0, maxSources) : candidateSources;
const targetIds = new Set(targetSources.map((source) => source.id));
const existingItemsBySource = new Map();
for (const item of existingCatalog.items || []) {
  if (!existingItemsBySource.has(item.sourceId)) existingItemsBySource.set(item.sourceId, []);
  existingItemsBySource.get(item.sourceId).push(item);
}

const results = await mapLimit(targetSources, sourceConcurrency, async (source) => {
  try {
    return await indexSource(source);
  } catch (error) {
    console.warn(`${source.name}: failed: ${error.message}`);
    const failedSlug = sourceDetailSlug(source);
    if (!appendDetailPages) {
      await fs.rm(path.join(detailRoot, failedSlug), { recursive: true, force: true });
    }
    const keptItems = keepExistingOnFailure ? existingItemsBySource.get(source.id) || [] : [];
    return {
      source: {
        ...source,
        itemCount: keptItems.length,
        playableCount: keptItems.filter((item) => item.playable).length,
        indexed: keptItems.length > 0,
        checks: [{ label: 'full-latest-pages', ok: false, count: 0, error: error.message }],
        error: error.message,
      },
      items: keptItems,
    };
  }
});

if (detailOnly) {
  console.log(
    JSON.stringify(
      {
        detailRoot,
        sources: targetSources.length,
        completedSources: results.filter((result) => !result.source.error).length,
        failedSources: results.filter((result) => result.source.error).length,
      },
      null,
      2,
    ),
  );
} else {
  const updatedSourceById = new Map(results.map((result) => [result.source.id, result.source]));
  const sources = (existingCatalog.sources || []).map((source) => updatedSourceById.get(source.id) || source);
  const newItems = [
    ...(existingCatalog.items || []).filter((item) => !targetIds.has(item.sourceId)),
    ...results.flatMap((result) => result.items),
  ];

  const catalog = {
    ...existingCatalog,
    generatedAt: new Date().toISOString(),
    source: {
      ...(existingCatalog.source || {}),
      fullChunkedCatalog: true,
      detailRoot: 'docs/data/vod-detail',
      pageSize,
    },
    totals: recomputeTotals(newItems, sources),
    filters: recomputeFilters(newItems),
    sources,
    items: newItems,
  };

  const report = {
    generatedAt: catalog.generatedAt,
    totals: catalog.totals,
    sourceChecks: sources.map(sourceCheck),
  };

  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        catalogPath,
        reportPath,
        detailRoot,
        sources: targetSources.length,
        totals: catalog.totals,
      },
      null,
      2,
    ),
  );
}
