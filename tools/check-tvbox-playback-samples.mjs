import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);

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
const catalogPath = path.resolve(args.get('catalog') || path.join(tvRoot, 'docs', 'data', 'tvbox-vod-catalog.json'));
const outputPath = path.resolve(args.get('output') || path.join(tvRoot, 'docs', 'data', 'tvbox-playback-check-latest.json'));
const csvPath = path.resolve(args.get('csvOutput') || path.join(tvRoot, 'docs', 'data', 'tvbox-playback-check-latest.csv'));
const timeoutMs = Number(args.get('timeoutMs') || 12000);
const concurrency = Math.max(1, Number(args.get('concurrency') || 10));
const maxCandidates = Math.max(1, Number(args.get('maxCandidates') || 20));

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; OKTV) AppleWebKit/537.36 Chrome/125 Safari/537.36';

async function readJson(file) {
  const buffer = await fs.readFile(file);
  const text = /\.gz$/i.test(file) ? (await gunzip(buffer)).toString('utf8') : buffer.toString('utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function urlsFromRaw(raw) {
  return [...String(raw || '').matchAll(/https?:\/\/[^#\s$]+/gi)].map((match) =>
    match[0].replace(/[，,。；;]+$/g, ''),
  );
}

function itemUrls(item) {
  const episodeUrls = (item.episodes || [])
    .map((episode) => String(episode.url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url));
  return [...urlsFromRaw(item.rawPlayUrl), ...episodeUrls];
}

function uniqueSorted(urls) {
  const seen = new Set();
  return urls
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .sort(
      (a, b) =>
        (/\.m3u8(?:$|[?#])/i.test(b) ? 1 : 0) - (/\.m3u8(?:$|[?#])/i.test(a) ? 1 : 0),
    );
}

const detailCache = new Map();

async function detailFor(indexItem) {
  if (!indexItem?.detailPath) return indexItem;
  const file = path.join(tvRoot, 'docs', 'data', indexItem.detailPath);
  if (!fsSync.existsSync(file)) return indexItem;
  if (!detailCache.has(file)) detailCache.set(file, readJson(file));
  const detail = await detailCache.get(file);
  return (
    (detail.items || []).find(
      (item) => item.id === indexItem.id || (item.vodId && item.vodId === indexItem.vodId),
    ) || indexItem
  );
}

function hlsQuality(text) {
  const variants = [...String(text || '').matchAll(/#EXT-X-STREAM-INF:([^\n\r]+)/gi)].map((match) => {
    const attrs = match[1];
    const bandwidth = Number(attrs.match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
    const resolution = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    return {
      bandwidth,
      height: Number(resolution?.[2] || 0),
    };
  });
  const maxHeight = Math.max(0, ...variants.map((variant) => variant.height));
  const maxBandwidth = Math.max(0, ...variants.map((variant) => variant.bandwidth));
  return {
    variants: variants.length,
    maxHeight,
    maxBandwidth,
    qualityOk: variants.length === 0 || maxHeight >= 720 || maxBandwidth >= 1500000,
    qualityLabel: maxHeight ? `${maxHeight}p` : variants.length ? 'adaptive' : 'single',
  };
}

async function probe(url) {
  const started = Date.now();
  const result = {
    ok: false,
    status: 0,
    contentType: '',
    elapsedMs: 0,
    error: '',
    qualityOk: false,
    qualityLabel: '',
    maxHeight: 0,
    maxBandwidth: 0,
    variants: 0,
  };

  try {
    if (/\.m3u8(?:$|[?#])/i.test(url)) {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/vnd.apple.mpegurl,*/*',
        },
      });
      const text = await res.text();
      result.status = res.status;
      result.contentType = res.headers.get('content-type') || '';
      result.ok = res.ok && text.includes('#EXTM3U');
      Object.assign(result, hlsQuality(text));
      if (!result.ok) result.error = `manifest HTTP ${res.status}`;
    } else {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          range: 'bytes=0-4095',
        },
      });
      result.status = res.status;
      result.contentType = res.headers.get('content-type') || '';
      result.ok = res.ok || res.status === 206;
      result.qualityOk = result.ok;
      result.qualityLabel = result.contentType || 'direct';
      await res.body?.cancel?.();
    }
  } catch (error) {
    result.error = error.message;
  } finally {
    result.elapsedMs = Date.now() - started;
  }
  return result;
}

async function loadCandidates(source) {
  const indexPath = path.join(tvRoot, 'docs', 'data', source.indexPath || '');
  if (!fsSync.existsSync(indexPath)) return { candidates: [], error: 'missing index file' };
  const payload = await readJson(indexPath);
  const candidates = [];
  const seen = new Set();
  for (const indexItem of payload.items || []) {
    if (!indexItem.playable && !indexItem.rawPlayUrl && !indexItem.detailPath && !indexItem.episodes) continue;
    const item = indexItem.rawPlayUrl || indexItem.episodes ? indexItem : await detailFor(indexItem);
    for (const url of uniqueSorted(itemUrls(item))) {
      if (seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        title: item.title || indexItem.title || '',
        updatedAt: item.updatedAt || indexItem.updatedAt || '',
        url,
      });
      if (candidates.length >= maxCandidates) return { candidates, error: '' };
    }
  }
  return {
    candidates,
    error: candidates.length ? '' : 'no playable candidate URL in hydrated index/detail',
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const current = next++;
        results[current] = await worker(items[current], current);
      }
    }),
  );
  return results;
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

const catalog = await readJson(catalogPath);
const sources = (catalog.sources || []).filter((source) => source.indexed && source.indexPath);
const rows = await mapLimit(sources, concurrency, async (source) => {
  const loaded = await loadCandidates(source);
  const failures = [];
  for (const candidate of loaded.candidates) {
    const check = await probe(candidate.url);
    const row = {
      sourceId: source.id,
      key: source.key,
      name: source.name,
      adult: Boolean(source.adult),
      itemCount: source.itemCount || 0,
      playableCount: source.playableCount || 0,
      sampleTitle: candidate.title,
      sampleUpdatedAt: candidate.updatedAt,
      playbackUrl: candidate.url,
      candidateCount: loaded.candidates.length,
      ...check,
      ok: check.ok,
      error: check.ok
        ? check.qualityOk
          ? ''
          : 'playback reachable but below preferred quality probe threshold'
        : check.error,
    };
    if (row.ok) return row;
    failures.push({
      title: candidate.title,
      url: candidate.url,
      status: check.status,
      error: check.error,
      elapsedMs: check.elapsedMs,
    });
  }

  const first = loaded.candidates[0] || {};
  return {
    sourceId: source.id,
    key: source.key,
    name: source.name,
    adult: Boolean(source.adult),
    itemCount: source.itemCount || 0,
    playableCount: source.playableCount || 0,
    sampleTitle: first.title || '',
    sampleUpdatedAt: first.updatedAt || '',
    playbackUrl: first.url || '',
    candidateCount: loaded.candidates.length,
    ok: false,
    status: failures.at(-1)?.status || 0,
    elapsedMs: failures.reduce((sum, failure) => sum + Number(failure.elapsedMs || 0), 0),
    qualityOk: false,
    qualityLabel: '',
    maxHeight: 0,
    maxBandwidth: 0,
    variants: 0,
    error: loaded.error || failures.at(-1)?.error || 'all playback candidates failed',
    failures,
  };
});

const report = {
  checkedAt: new Date().toISOString(),
  catalogPath: path.relative(tvRoot, catalogPath).replaceAll(path.sep, '/'),
  samplePolicy: `up to ${maxCandidates} hydrated rawPlayUrl/episodes URLs per indexed source, m3u8 prioritized`,
  preferredQuality:
    'HLS >= 720p or >= 1.5 Mbps when variants are advertised; direct/ranged URLs are accepted when reachable',
  summary: {
    totalSources: rows.length,
    ok: rows.filter((row) => row.ok).length,
    failed: rows.filter((row) => !row.ok).length,
    qualityOk: rows.filter((row) => row.qualityOk).length,
    highQualityHls: rows.filter((row) => row.maxHeight >= 720 || row.maxBandwidth >= 1500000).length,
  },
  failed: rows.filter((row) => !row.ok),
  qualityWarnings: rows.filter((row) => row.ok && !row.qualityOk),
  rows,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const headers = [
  'key',
  'name',
  'itemCount',
  'playableCount',
  'candidateCount',
  'sampleTitle',
  'sampleUpdatedAt',
  'playbackUrl',
  'ok',
  'qualityOk',
  'qualityLabel',
  'maxHeight',
  'maxBandwidth',
  'variants',
  'status',
  'elapsedMs',
  'error',
];
const csv = [
  headers.map(csvEscape).join(','),
  ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
].join('\r\n');
await fs.writeFile(csvPath, `${csv}\r\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      output: outputPath,
      csvOutput: csvPath,
      summary: report.summary,
    },
    null,
    2,
  ),
);
