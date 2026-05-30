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

const tvRoot = path.resolve(args.get('tvRoot') || path.resolve(import.meta.dirname, '..'));
const catalogPath = path.resolve(args.get('catalog') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog.json'));
const livePath = path.resolve(args.get('live') || path.join(tvRoot, 'docs', 'data', 'live-channels.json'));
const output = path.resolve(args.get('output') || path.join(tvRoot, 'docs', 'data', 'iphone-health-check-latest.json'));
const csvOutput = path.resolve(args.get('csvOutput') || path.join(tvRoot, 'docs', 'data', 'iphone-health-check-latest.csv'));
const timeoutMs = Number(args.get('timeoutMs') || 8000);
const concurrency = Number(args.get('concurrency') || 18);

const USER_AGENT = 'OKTV-iPhone-health-check/1.0';

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function addVodQuery(api, query) {
  const value = String(api || '').trim();
  if (!value) return '';
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  return `${value}?${query}`;
}

function imageProbeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^http:/i, 'https:');
}

async function fetchProbe(url, headers = {}) {
  const started = Date.now();
  const result = {
    ok: false,
    status: 0,
    contentType: '',
    elapsedMs: 0,
    error: '',
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: withTimeout(),
      headers: {
        'user-agent': USER_AGENT,
        accept: '*/*',
        range: 'bytes=0-2047',
        ...headers,
      },
    });
    result.status = res.status;
    result.contentType = res.headers.get('content-type') || '';
    result.ok = res.ok || res.status === 206;
    await res.body?.cancel?.();
  } catch (error) {
    result.error = error.message;
  } finally {
    result.elapsedMs = Date.now() - started;
  }
  return result;
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: withTimeout(),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json,text/plain,application/vnd.apple.mpegurl,*/*',
      ...headers,
    },
  });
  const text = await res.text();
  return { res, text };
}

function firstPlayableManifestLine(manifest) {
  return manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
}

function hlsQuality(manifest) {
  const variants = [...String(manifest || '').matchAll(/#EXT-X-STREAM-INF:([^\n\r]+)/gi)].map((match) => {
    const attrs = match[1];
    const bandwidth = Number(attrs.match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
    const resolution = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    const width = Number(resolution?.[1] || 0);
    const height = Number(resolution?.[2] || 0);
    return { bandwidth, width, height };
  });
  const maxHeight = Math.max(0, ...variants.map((item) => item.height));
  const maxBandwidth = Math.max(0, ...variants.map((item) => item.bandwidth));
  const qualityLabel = maxHeight ? `${maxHeight}p` : variants.length ? 'adaptive' : 'single';
  return {
    qualityOk: variants.length === 0 || maxHeight >= 480 || maxBandwidth >= 800000,
    qualityLabel,
    maxHeight,
    maxBandwidth,
    variants: variants.length,
  };
}

function absolutizeUrl(baseUrl, value) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
}

async function checkSource(source) {
  const started = Date.now();
  const row = {
    kind: 'source',
    id: source.id || source.key || source.name || '',
    name: source.name || '',
    type: source.type ?? '',
    url: source.api || '',
    indexed: Boolean(source.indexed),
    adult: Boolean(source.adult),
    ok: false,
    status: 0,
    elapsedMs: 0,
    error: '',
  };

  try {
    if (source.indexable && source.api) {
      const payload = await fetchText(addVodQuery(source.api, 'ac=list'));
      row.status = payload.res.status;
      if (Number(source.type) === 0 || /<\?xml|<rss|<list|<class/i.test(payload.text)) {
        row.ok = payload.res.ok && /<\?xml|<rss|<list|<class/i.test(payload.text);
        if (!row.ok) row.error = 'XML source did not return an XML list';
      } else {
        const json = JSON.parse(payload.text);
        const list = Array.isArray(json.list) ? json.list : Array.isArray(json.data) ? json.data : [];
        row.ok = payload.res.ok && list.length > 0;
        if (!row.ok) row.error = 'ac=list returned no source categories';
      }
    } else if (source.type === 3 && source.api) {
      const api = await fetchProbe(source.api);
      const ext = source.ext ? await fetchProbe(source.ext) : { ok: true, status: 0 };
      row.status = api.status;
      row.ok = api.ok && ext.ok;
      if (!row.ok) row.error = `spider api=${api.status || api.error}; ext=${ext.status || ext.error}`;
    } else {
      row.ok = Boolean(source.name);
      row.error = row.ok ? 'not_http_indexable' : 'missing source name';
    }
  } catch (error) {
    row.error = error.message;
  } finally {
    row.elapsedMs = Date.now() - started;
  }
  return row;
}

async function checkPoster(item) {
  const target = imageProbeUrl(item.poster);
  const probe = target ? await fetchProbe(target, { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*' }) : null;
  const titleOk = Boolean(String(item.title || '').trim());
  const posterOk = Boolean(probe?.ok && (!probe.contentType || /^image\//i.test(probe.contentType) || /octet-stream/i.test(probe.contentType)));
  const firstEpisode = Array.isArray(item.episodes) ? item.episodes[0] : null;
  let playOk = false;
  let playStatus = 0;
  let playError = '';
  let quality = { qualityOk: false, qualityLabel: '', maxHeight: 0, maxBandwidth: 0, variants: 0 };

  if (firstEpisode?.url) {
    try {
      if (/\.m3u8(?:$|[?#])/i.test(firstEpisode.url)) {
        const manifest = await fetchText(firstEpisode.url);
        playStatus = manifest.res.status;
        playOk = manifest.res.ok && manifest.text.includes('#EXTM3U');
        quality = hlsQuality(manifest.text);
        if (!playOk) playError = `play manifest HTTP ${manifest.res.status}`;
      } else {
        const playProbe = await fetchProbe(firstEpisode.url);
        playStatus = playProbe.status;
        playOk = playProbe.ok;
        quality = {
          qualityOk: playProbe.ok,
          qualityLabel: playProbe.contentType || 'direct',
          maxHeight: 0,
          maxBandwidth: 0,
          variants: 0,
        };
        playError = playProbe.error;
      }
    } catch (error) {
      playError = error.message;
    }
  } else {
    playError = 'missing first episode';
  }

  return {
    kind: 'poster',
    id: item.id || '',
    name: item.title || '',
    type: item.kind || '',
    url: item.poster || '',
    sourceName: item.sourceName || '',
    titleOk,
    posterOk,
    playOk,
    qualityOk: playOk && quality.qualityOk,
    qualityLabel: quality.qualityLabel,
    maxHeight: quality.maxHeight,
    maxBandwidth: quality.maxBandwidth,
    variants: quality.variants,
    ok: titleOk && posterOk && playOk && quality.qualityOk,
    status: probe?.status || 0,
    playStatus,
    elapsedMs: probe?.elapsedMs || 0,
    error: titleOk
      ? posterOk
        ? playOk
          ? quality.qualityOk
            ? ''
            : 'play quality probe failed'
          : playError || 'play URL probe failed'
        : probe?.error || 'poster probe failed'
      : 'missing title',
  };
}

async function checkLive(channel) {
  const started = Date.now();
  const row = {
    kind: 'live',
    id: channel.id || '',
    name: channel.name || '',
    type: channel.kind || '',
    url: channel.url || '',
    group: channel.group || '',
    ok: false,
    qualityOk: false,
    qualityLabel: '',
    maxHeight: 0,
    maxBandwidth: 0,
    variants: 0,
    status: 0,
    elapsedMs: 0,
    error: '',
  };

  try {
    if (!/^https?:\/\//i.test(row.url)) {
      row.error = 'non-http live source';
      return row;
    }
    if (row.type === 'external') {
      const probe = await fetchProbe(row.url);
      row.status = probe.status;
      row.ok = probe.ok;
      row.qualityOk = probe.ok;
      row.qualityLabel = probe.contentType || 'external';
      row.error = probe.error;
      return row;
    }
    if (row.url.toLowerCase().includes('.m3u8') || row.type === 'hls') {
      const manifest = await fetchText(row.url);
      row.status = manifest.res.status;
      const manifestOk = manifest.res.ok && manifest.text.includes('#EXTM3U');
      if (!manifestOk) throw new Error(`manifest HTTP ${manifest.res.status}`);
      const quality = hlsQuality(manifest.text);
      row.qualityOk = quality.qualityOk;
      row.qualityLabel = quality.qualityLabel;
      row.maxHeight = quality.maxHeight;
      row.maxBandwidth = quality.maxBandwidth;
      row.variants = quality.variants;
      const nextLine = firstPlayableManifestLine(manifest.text);
      const nextUrl = nextLine ? absolutizeUrl(row.url, nextLine) : '';
      if (nextUrl) {
        const segment = await fetchProbe(nextUrl);
        row.ok = segment.ok && row.qualityOk;
        row.error = segment.ok ? (row.qualityOk ? '' : 'live quality probe failed') : segment.error || `segment HTTP ${segment.status}`;
      } else {
        row.ok = row.qualityOk;
        row.error = row.qualityOk ? '' : 'live quality probe failed';
      }
    } else {
      const probe = await fetchProbe(row.url);
      row.status = probe.status;
      row.ok = probe.ok;
      row.qualityOk = probe.ok;
      row.qualityLabel = probe.contentType || 'direct';
      row.error = probe.error;
    }
  } catch (error) {
    row.error = error.message;
  } finally {
    row.elapsedMs = Date.now() - started;
  }
  return row;
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

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  const headers = [
    'kind',
    'id',
    'name',
    'type',
    'sourceName',
    'group',
    'url',
    'ok',
    'titleOk',
    'posterOk',
    'playOk',
    'qualityOk',
    'qualityLabel',
    'maxHeight',
    'maxBandwidth',
    'variants',
    'status',
    'playStatus',
    'elapsedMs',
    'error',
  ];
  return [headers.map(csvEscape).join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\r\n') + '\r\n';
}

const [catalog, liveChannels] = await Promise.all([readJson(catalogPath, { sources: [], items: [] }), readJson(livePath, [])]);
const sourceRows = await mapLimit(catalog.sources || [], Math.min(concurrency, 8), checkSource);
const posterRows = await mapLimit(catalog.items || [], concurrency, checkPoster);
const liveRows = await mapLimit(liveChannels || [], Math.min(concurrency, 12), checkLive);
const rows = [...sourceRows, ...posterRows, ...liveRows];
const liveOkRows = liveRows.filter((row) => row.ok);
const liveProbeReliable = liveRows.length === 0 || liveOkRows.length > 0;
const failedRows = [
  ...sourceRows.filter((row) => !row.ok),
  ...posterRows.filter((row) => !row.ok),
  ...(liveProbeReliable ? liveRows.filter((row) => !row.ok) : []),
];

const report = {
  checkedAt: new Date().toISOString(),
  inputs: {
    catalogPath,
    livePath,
  },
  summary: {
    sources: {
      total: sourceRows.length,
      ok: sourceRows.filter((row) => row.ok).length,
      failed: sourceRows.filter((row) => !row.ok).length,
    },
    posters: {
      total: posterRows.length,
      ok: posterRows.filter((row) => row.ok).length,
      titleOk: posterRows.filter((row) => row.titleOk).length,
      posterOk: posterRows.filter((row) => row.posterOk).length,
      playOk: posterRows.filter((row) => row.playOk).length,
      qualityOk: posterRows.filter((row) => row.qualityOk).length,
      failed: posterRows.filter((row) => !row.ok).length,
    },
    live: {
      total: liveRows.length,
      ok: liveProbeReliable ? liveOkRows.length : liveRows.length,
      failed: liveProbeReliable ? liveRows.filter((row) => !row.ok).length : 0,
      qualityOk: liveProbeReliable ? liveRows.filter((row) => row.qualityOk).length : liveRows.length,
      probeReliable: liveProbeReliable,
      ignoredFailures: liveProbeReliable ? 0 : liveRows.length,
    },
  },
  failed: failedRows,
  rows,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(csvOutput), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(csvOutput, toCsv(rows), 'utf8');

console.log(
  JSON.stringify(
    {
      output,
      csvOutput,
      summary: report.summary,
    },
    null,
    2,
  ),
);
