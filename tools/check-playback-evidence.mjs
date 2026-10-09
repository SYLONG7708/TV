import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PUBLIC_DATA = 'https://sylong7708.github.io/TV/docs/data';
const MAX_TEXT_BYTES = 262_144;
const MEDIA_BYTES = 32_768;

export function playbackKind(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return 'invalid'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'invalid';
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname)) return 'embed';
  if (/\.m3u8(?:$|[?#])/i.test(url.href) || /manifest\/hls/i.test(url.pathname)) return 'hls';
  return 'direct';
}

export function firstPlaylistUri(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
  if (!lines[0]?.startsWith('#EXTM3U')) return '';
  const variants = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'));
  if (variants) {
    const index = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
    return lines.slice(index + 1).find((line) => line && !line.startsWith('#')) || '';
  }
  const segment = lines.findIndex((line) => line.startsWith('#EXTINF'));
  return segment < 0 ? '' : lines.slice(segment + 1).find((line) => line && !line.startsWith('#')) || '';
}

function mediaSignature(bytes) {
  if (bytes.length < 12) return false;
  const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (ascii(4, 8) === 'ftyp' || ascii(4, 8) === 'styp' || ascii(4, 8) === 'moof') return true;
  if (ascii(0, 3) === 'FLV' || ascii(0, 3) === 'ID3' || ascii(0, 4) === 'OggS') return true;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0;
}

async function readLimited(response, maximum = MAX_TEXT_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  try {
    while (length < maximum) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, maximum - length);
      chunks.push(part);
      length += part.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) { output.set(part, offset); offset += part.length; }
  return output;
}

async function request(url, { fetchImpl, timeoutMs, range = false } = {}) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: range ? 'video/*,application/octet-stream,*/*' : 'application/vnd.apple.mpegurl,*/*',
      ...(range ? { range: `bytes=0-${MEDIA_BYTES - 1}` } : {}),
      'user-agent': 'OKTV-playback-evidence/1.0',
    },
  });
  const body = await readLimited(response, range ? MEDIA_BYTES : MAX_TEXT_BYTES);
  return { ok: response.ok, status: response.status, type: response.headers.get('content-type') || '', body, url: response.url || url };
}

export async function probePlayback(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const kind = playbackKind(url);
  if (kind === 'invalid') return { kind, verified: false, reason: 'invalid URL' };
  if (kind === 'embed') return { kind, verified: false, reason: 'iframe requires browser playback test' };
  try {
    let target = url, encrypted = false;
    let first = await request(target, { fetchImpl, timeoutMs, range: kind !== 'hls' });
    let initialText = new TextDecoder().decode(first.body).replace(/^\uFEFF/, '').trimStart();
    let media = first;
    if (kind === 'hls' || initialText.startsWith('#EXTM3U')) {
      for (let depth = 0; depth < 3; depth += 1) {
        const playlist = depth === 0 ? first : await request(target, { fetchImpl, timeoutMs });
        const text = new TextDecoder().decode(playlist.body).replace(/^\uFEFF/, '').trimStart();
        if (!playlist.ok || !text.startsWith('#EXTM3U')) {
          return { kind, verified: false, status: playlist.status, reason: 'HLS manifest unavailable' };
        }
        const next = firstPlaylistUri(text);
        if (!next) return { kind, verified: false, status: playlist.status, reason: 'HLS has no media segment' };
        target = new URL(next, playlist.url || target).href;
        if (!text.includes('#EXT-X-STREAM-INF')) {
          encrypted = /#EXT-X-KEY:.*METHOD=(?!NONE)[^,\r\n]+/.test(text);
          break;
        }
      }
      media = await request(target, { fetchImpl, timeoutMs, range: true });
    }
    const opening = new TextDecoder().decode(media.body.subarray(0, 256));
    const html = /<!doctype html|<html\b|<script\b/i.test(opening);
    const playlist = opening.startsWith('#EXTM3U');
    const verified = media.ok && media.body.length >= 1024 && !html && !playlist
      && !/text\/html/i.test(media.type) && mediaSignature(media.body);
    return {
      kind,
      verified,
      status: media.status,
      bytes: media.body.length,
      reason: verified ? '' : html || playlist ? 'response is a page, not media' : encrypted ? 'encrypted segment requires browser decoding' : 'verified media signature unavailable',
    };
  } catch (error) {
    return { kind, verified: false, reason: error?.cause?.code ? `${error.message}: ${error.cause.code}` : error?.message || 'request failed' };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export function vodCandidates(sources, items, maxPerSource = 2) {
  const bySource = new Map((sources || []).map((source) => [source.id, []]));
  for (const item of items || []) {
    const candidates = bySource.get(item.sourceId);
    if (!candidates || candidates.length >= maxPerSource) continue;
    const episode = (item.episodes || []).slice().reverse().find((row) => playbackKind(row.url) !== 'invalid');
    if (episode && !candidates.includes(episode.url)) candidates.push(episode.url);
  }
  return bySource;
}

export async function checkPlaybackEvidence({ sources = [], items = [], channels = [], fetchImpl = fetch, timeoutMs = 10_000, concurrency = 8 } = {}) {
  const candidates = vodCandidates(sources, items);
  const vod = await mapLimit(sources, concurrency, async (source) => {
    const urls = candidates.get(source.id) || [];
    let last = { kind: 'none', verified: false, reason: 'no recent episode sample' };
    for (const url of urls) {
      last = await probePlayback(url, { fetchImpl, timeoutMs });
      if (last.verified) break;
    }
    return { id: source.id, name: source.name, attempted: urls.length, ...last };
  });
  const live = await mapLimit(channels, concurrency, async (channel) => ({
    id: channel.id,
    name: channel.name,
    delivery: channel.kind === 'external' ? 'external' : 'in_app',
    ...await probePlayback(channel.embedUrl || channel.url, { fetchImpl, timeoutMs }),
  }));
  const sampledVod = vod.filter((row) => row.attempted > 0);
  const summary = {
    vod: {
      sources: vod.length,
      sampled: sampledVod.length,
      verified: sampledVod.filter((row) => row.verified).length,
      failed: sampledVod.filter((row) => !row.verified).length,
      noSample: vod.length - sampledVod.length,
    },
    live: {
      channels: live.length,
      directVerified: live.filter((row) => row.verified).length,
      directFailed: live.filter((row) => row.kind !== 'embed' && !row.verified).length,
      embedUnverified: live.filter((row) => row.kind === 'embed' && row.delivery !== 'external').length,
      externalUnverified: live.filter((row) => row.kind === 'embed' && row.delivery === 'external').length,
    },
  };
  return { checkedAt: new Date().toISOString(), summary, vod, live };
}

async function loadJson(value, fallback) {
  try {
    const target = String(value || fallback);
    if (/^https?:\/\//i.test(target)) {
      const response = await fetch(target, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${target}`);
      return response.json();
    }
    return JSON.parse(await fs.readFile(path.resolve(target), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read playback input: ${error.message}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index].slice(2), process.argv[index + 1]);
  const [catalog, latest, live] = await Promise.all([
    loadJson(args.get('catalog'), `${PUBLIC_DATA}/iphone-vod-catalog.json`),
    loadJson(args.get('latest'), `${PUBLIC_DATA}/iphone-vod-latest.json`),
    loadJson(args.get('live'), `${PUBLIC_DATA}/live-channels.json`),
  ]);
  const report = await checkPlaybackEvidence({
    sources: catalog.sources || [], items: latest.items || [],
    channels: Array.isArray(live) ? live : live.channels || [],
    timeoutMs: Number(args.get('timeoutMs') || 10_000),
    concurrency: Number(args.get('concurrency') || 8),
  });
  const output = path.resolve(args.get('output') || 'oktv-playback-evidence.json');
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, summary: report.summary }, null, 2));
  if (report.summary.vod.sampled === 0) process.exitCode = 1;
}
