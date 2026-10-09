import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseVodPayload } from './vod-payload-parser.mjs';
import { probePlayback } from './check-playback-evidence.mjs';
import { signalKey } from '../docs/iphone/signal-priority.mjs';
import { titleQuality } from '../docs/iphone/title-quality.mjs';

export function apiUrl(source, params = {}) {
  const url = new URL(source.api);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  const nested = url.searchParams.get('url');
  const target = nested && /^https?:\/\//.test(nested) ? new URL(nested) : url;
  for (const [key, value] of Object.entries({ ac: 'detail', pg: 1, ...params })) target.searchParams.set(key, String(value));
  if (target !== url) url.searchParams.set('url', target.href);
  return url.href;
}
export async function mapLimit(rows, limit, worker) {
  const output = new Array(rows.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) { const index = cursor++; output[index] = await worker(rows[index], index); }
  }));
  return output;
}
async function fetchText(url, timeout = 10000, maxBytes = 12 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json,application/xml,text/xml,*/*', 'user-agent': 'Yingshi-Cloud-Audit/1.0' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maxBytes) throw new Error('response-size-limit'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
}
const json = async url => JSON.parse(await fetchText(url, 25000));
export const list = payload => {
  const candidates = [payload?.list, payload?.data].filter(Array.isArray);
  return candidates.find(rows => rows.some(row => row.vod_id !== undefined || row.vod_name !== undefined || row.title !== undefined)) || candidates.find(rows => !rows.some(row => row.list_id !== undefined)) || [];
};
export function episodeUrls(row) {
  if (row.episodes?.length) return row.episodes.map(ep => ep.url).filter(url => /^https?:\/\//i.test(url));
  return [...String(row.vod_play_url || row.rawPlayUrl || row.vod_play || '').matchAll(/https?:\/\/[^\s$#]+/gi)].map(match => match[0]);
}
function safeError(error) { return String(error?.message || error).replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 160); }
export async function audit({ base = 'https://sylong7708.github.io/TV', output, timeoutMs = 8000, concurrency = 6, categoryProbes = true, sourceFilter = '', liveProbes = true } = {}) {
  await fs.mkdir(output, { recursive: true });
  const deployment = await json(`${base}/docs/data/deployment-state.json`);
  const bulk = deployment.dataBaseUrl;
  if (!/^https:\/\/raw\.githubusercontent\.com\/SYLONG7708\/TV\/[a-f0-9]{40}\/docs\/data\/$/.test(bulk)) throw new Error('Untrusted data revision');
  const [catalog, latest, channels, publicMedia] = await Promise.all([
    json(`${bulk}iphone-vod-catalog.json`), json(`${bulk}iphone-vod-latest.json`), json(`${bulk}live-channels.json`), json(`${base}/docs/iphone/public-sources.json`),
  ]);
  const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), dataRevision: deployment.dataCommit,
    scope: sourceFilter ? `Targeted recheck: ${sourceFilter}` : 'All catalog sources and categories, every configured live signal, rotating episode samples. Media bytes are not full viewing or device decoding proof.',
    sources: [], categories: [], live: [], titleValidation: {}, summary: {}, signals: {} };
  const mediaCache = new Map();
  async function media(url) {
    const key = signalKey(url);
    if (!mediaCache.has(key)) mediaCache.set(key, (async () => {
      const start = Date.now(); const result = await probePlayback(url, { timeoutMs });
      const entry = { ...result, status: result.verified ? 'media-response-verified' : result.kind === 'embed' || /requires browser|signature unavailable/.test(result.reason || '') ? 'browser-required' : 'failed', httpStatus: result.status || 0, elapsedMs: Date.now() - start };
      report.signals[key] = entry;
      return { key, ...entry };
    })());
    return mediaCache.get(key);
  }
  const currentItems = [...(latest.items || []), ...(publicMedia.items || [])];
  const bySource = new Map(catalog.sources.map(source => [source.id, currentItems.filter(item => item.sourceId === source.id)]));
  report.titleValidation = { inspected: currentItems.length, invalid: currentItems.filter(item => !titleQuality(item.title).valid).length, note: 'Readable metadata only; no claim that every title matches the audiovisual content.' };
  const day = Math.floor(Date.now() / 864e5);
  report.sources = await mapLimit(catalog.sources.filter(source => !sourceFilter || source.id.includes(sourceFilter) || source.api?.includes(sourceFilter)), concurrency, async source => {
    const row = { id: source.id, categories: source.categories?.length || 0, api: 'not-applicable', search: 'not-tested', samples: [], categoriesResults: [] };
    let rows = bySource.get(source.id) || [];
    if (source.api && Number(source.type || 1) !== 3) {
      try {
        const body = await fetchText(apiUrl(source), timeoutMs); const payload = parseVodPayload(body);
        const fresh = list(payload); if (!fresh.length && !Number(payload.total)) throw new Error('empty-api-payload');
        row.api = 'passed'; row.returned = fresh.length;
        if (fresh.length) rows = fresh;
        const first = fresh.find(item => titleQuality(item.vod_name || item.title).valid);
        if (first) {
          const title = first.vod_name || first.title;
          try {
            const searchRows = list(parseVodPayload(await fetchText(apiUrl(source, { wd: title }), timeoutMs)));
            row.search = searchRows.some(item => String(item.vod_id || item.id) === String(first.vod_id || first.id) && titleQuality(item.vod_name || item.title).title === titleQuality(title).title) ? 'exact-id-title-found' : 'exact-title-not-returned';
          } catch (error) { row.search = 'failed'; row.searchError = safeError(error); }
        }
      } catch (error) { row.api = 'failed'; row.error = safeError(error); }
    }
    // Non-explicit ordinary categories are sampled as media; all category/API
    // metadata still gets an independent result, without creating new content.
    const samples = rows.filter(item => !source.adult && !item.adult && episodeUrls(item).length);
    if (samples.length) {
      const item = samples[day % samples.length], urls = episodeUrls(item);
      row.samples.push(await media(urls[day % urls.length]));
    }
    for (const category of source.categories || []) {
      const result = { sourceId: source.id, id: String(category.id || category.name), kind: category.kind || 'other', status: 'not-tested' };
      if (!categoryProbes) result.status = 'disabled-by-option';
      else if (!source.api || !category.id || Number(source.type || 1) === 3) {
        result.status = source.id.startsWith('public-') ? 'catalog-validated' : 'no-category-api';
      } else if (row.api === 'failed') result.status = 'blocked-by-source-api';
      else {
        try {
          const response = parseVodPayload(await fetchText(apiUrl(source, { t: category.id }), timeoutMs));
          const items = list(response); result.items = items.length;
          result.status = items.length ? 'passed' : 'empty';
          result.invalidTitles = items.filter(item => !titleQuality(item.vod_name || item.title).valid).length;
          // Do not quietly treat a source that ignores category selection as a pass.
          const declared = items.filter(item => item.type_id !== undefined);
          result.categoryIdsReturned = [...new Set(declared.map(item => String(item.type_id)))];
          const acceptedIds = new Set([String(category.id)]);
          // Parent categories may correctly return declared child categories.
          for (let pass = 0; pass < 5; pass++) for (const type of response.class || []) {
            if (acceptedIds.has(String(type.type_pid ?? type.pid))) acceptedIds.add(String(type.type_id ?? type.id));
          }
          result.selectionVerification = !declared.length ? 'not-declared' : declared.every(item => acceptedIds.has(String(item.type_id))) ? 'matched' : 'unconfirmed';
          if (items.length && result.selectionVerification === 'unconfirmed') result.status = 'category-selection-unconfirmed';
          if (result.invalidTitles) result.status = 'invalid-titles';
          const candidates = items.filter(item => !source.adult && category.kind !== 'adult' && episodeUrls(item).length);
          if (candidates.length) {
            const candidate = candidates[day % candidates.length], urls = episodeUrls(candidate);
            result.sample = await media(urls[day % urls.length]);
          }
        } catch (error) { result.status = 'failed'; result.error = safeError(error); }
      }
      row.categoriesResults.push(result);
      if (row.categoriesResults.length % 20 === 0) console.log(`category-progress ${source.id}: ${row.categoriesResults.length}/${row.categories}`);
    }
    console.log(`source-complete ${source.id}: api=${row.api}, categories=${row.categoriesResults.length}`);
    // Preserve incremental evidence even if a later source hangs or the host restarts.
    await fs.writeFile(path.join(output, `source-${signalKey('https://audit.invalid/' + encodeURIComponent(source.id))}.json`), JSON.stringify(row));
    return row;
  });
  report.categories = report.sources.flatMap(source => source.categoriesResults);
  for (const source of report.sources) delete source.categoriesResults;
  report.live = liveProbes ? await mapLimit(channels, concurrency, async channel => ({ id: channel.id, kind: channel.kind, ...await media(channel.embedUrl || channel.url) })) : [];
  const frequencies = rows => Object.fromEntries([...new Set(rows.map(row => row.status))].map(status => [status, rows.filter(row => row.status === status).length]));
  report.summary = { sources: report.sources.length, apiPassed: report.sources.filter(source => source.api === 'passed').length,
    apiFailed: report.sources.filter(source => source.api === 'failed').length, categories: report.categories.length,
    categoryResults: frequencies(report.categories), live: report.live.length, liveResults: frequencies(report.live),
    mediaProbes: mediaCache.size, mediaVerified: Object.values(report.signals).filter(row => row.verified).length };
  const sourceScores = Object.fromEntries(report.sources.map(source => {
    const samples = [...source.samples, ...report.categories.filter(row => row.sourceId === source.id && row.sample).map(row => row.sample)];
    return [source.id, { tested: samples.length, verified: samples.filter(row => row.verified).length, api: source.api }];
  }));
  await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(output, 'signal-health.json'), JSON.stringify({ schemaVersion: 1, checkedAt: report.checkedAt, dataRevision: report.dataRevision, sources: sourceScores, signals: report.signals }, null, 2));
  console.log(JSON.stringify(report.summary));
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
  await audit({ base: args.base, output: path.resolve(args.output || 'cloud-audit'), timeoutMs: Number(args.timeoutMs || 8000), concurrency: Number(args.concurrency || 6), categoryProbes: args.categoryProbes !== 'false', sourceFilter: args.sourceFilter || '', liveProbes: args.liveProbes !== 'false' });
}
