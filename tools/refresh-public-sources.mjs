import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { blenderMovies, officialLives, discovery } from './public-source-config.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceId = 'public-blender-open-movies';
const apiBase = 'https://video.blender.org';
export function httpsUrl(value, hosts) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!hosts || hosts.includes(u.hostname)) ? u.href : ''; } catch { return ''; }
}
async function response(url, headers = {}) {
  if (!httpsUrl(url)) throw new Error('Only HTTPS sources are accepted');
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try { r = await fetch(url, { headers, signal: AbortSignal.timeout(18000) }); }
    catch (error) { if (attempt) throw error; await new Promise(resolve => setTimeout(resolve, 700)); continue; }
    if (!r.ok || !httpsUrl(r.url)) {
      await r.body?.cancel();
      if (!attempt && (r.status === 429 || r.status >= 500)) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
      throw new Error(`HTTP ${r.status}`);
    }
    return r;
  }
}
async function json(url) { return await (await response(url)).json(); }
const browserOrigin = 'https://sylong7708.github.io';
export function allowsBrowserOrigin(value) { return value === '*' || value === browserOrigin; }
export async function probeMedia(url, depth = 0, requireCors = false) {
  if (depth > 3) throw new Error('Playlist recursion limit');
  if (/\.m3u8(?:$|\?)/i.test(url)) {
    const r = await response(url, { Origin: browserOrigin });
    if (!allowsBrowserOrigin(r.headers.get('access-control-allow-origin'))) { await r.body?.cancel(); throw new Error('HLS CORS does not permit browser playback'); }
    const text = await r.text();
    if (!text.startsWith('#EXTM3U') || text.length > 2_000_000) throw new Error('Invalid HLS playlist');
    if (/#EXT-X-KEY:(?!METHOD=NONE)/.test(text)) throw new Error('Encrypted streams require separate review');
    const next = text.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#'));
    if (!next) throw new Error('Empty playlist');
    await probeMedia(new URL(next, url).href, depth + 1, true);
    return { kind: 'hls', validation: 'playlist-and-media-range' };
  }
  const r = await response(url, { Range: 'bytes=0-2047', ...(requireCors ? { Origin: browserOrigin } : {}) });
  if (requireCors && !allowsBrowserOrigin(r.headers.get('access-control-allow-origin'))) { await r.body?.cancel(); throw new Error('HLS media CORS does not permit browser playback'); }
  const reader = r.body.getReader(); let size = 0, first;
  try { while (size < 1024) { const result = await reader.read(); if (result.done) break; first ??= result.value; size += result.value.length; } }
  finally { await reader.cancel(); }
  if (!size || /html|json|text\//i.test(r.headers.get('content-type') || '') || /^\s*</.test(new TextDecoder().decode(first?.slice(0, 40)))) throw new Error('Media returned non-media data');
  return { kind: 'direct', validation: 'media-range' };
}
export function movieItem(detail, row, verifiedAt) {
  const [uuid, title, year, reviewedLicense] = row;
  if (detail.uuid !== uuid || detail.channel?.name !== 'blender_open_movies' || detail.nsfw || detail.privacy?.id !== 1) throw new Error('Unexpected or non-public official movie');
  const originalPage = `${apiBase}/videos/watch/${uuid}`;
  const license = reviewedLicense || ([1, 2].includes(detail.licence?.id) ? {
    label: detail.licence.id === 1 ? 'CC BY（版本依原站）' : 'CC BY-SA（版本依原站）', url: originalPage, evidence: `${apiBase}/api/v1/videos/${uuid}`,
  } : null);
  if (!license) throw new Error('License requires review');
  const variants = (detail.files || []).filter(f => Number(f.resolution?.id) > 0 && httpsUrl(f.fileUrl, ['video.blender.org']) && /\.mp4(?:$|\?)/.test(f.fileUrl))
    .map(f => ({ label: f.resolution.label, height: f.resolution.id, url: f.fileUrl })).sort((a, b) => b.height - a.height);
  const hls = (detail.streamingPlaylists || []).map(p => httpsUrl(p.playlistUrl, ['video.blender.org'])).find(Boolean);
  const url = hls || variants[0]?.url;
  if (!url) throw new Error('No supported official media');
  const rights = { creator: 'Blender Foundation / Blender Studio', attribution: '(CC) Blender Foundation | studio.blender.org', originalPage, licenseLabel: license.label, licenseUrl: license.url, evidenceUrl: license.evidence, changes: '原片未修改；影片與音訊由官方站提供。' };
  return { id: `${sourceId}:${uuid}`, vodId: uuid, sourceId, sourceName: 'Blender 官方公開短片', title, originalName: detail.name, kind: 'movie', categoryName: '電影', genre: ['公開短片'], year: String(year), area: '荷蘭', adult: false, playable: true, poster: httpsUrl(new URL(detail.thumbnailPath, apiBase).href, ['video.blender.org']), duration: detail.duration, remarks: '官方公開短片', updatedAt: detail.originallyPublishedAt || detail.publishedAt, content: `${detail.description || ''}\n\n${rights.attribution} · ${rights.licenseLabel}\n${rights.changes}`, rights, verifiedAt, verification: 'media-probe', episodeCount: 1, episodes: [{ name: '正片', url, ...(hls ? {} : { variants }) }] };
}
export function preserveLastGood(previous, failures, now, maximumAgeMs = 7 * 86400000) {
  return previous.filter(item => failures.has(item.id) && Number.isFinite(Date.parse(item.verifiedAt)) && now - Date.parse(item.verifiedAt) <= maximumAgeMs)
    .map(item => ({ ...item, verification: 'stale', lastFailure: failures.get(item.id) }));
}
async function parallel(rows, task) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => { while (next < rows.length) { const index = next++; out[index] = await task(rows[index]); } }));
  return out;
}
export async function refresh({ output = path.join(root, 'docs/iphone/public-sources.json') } = {}) {
  let previous = {}; try { previous = JSON.parse(await fs.readFile(output, 'utf8')); } catch {}
  const checkedAt = new Date().toISOString(), failures = new Map(), checks = [];
  const movies = await parallel(blenderMovies, async row => {
    const id = `${sourceId}:${row[0]}`;
    try {
      const item = movieItem(await json(`${apiBase}/api/v1/videos/${row[0]}`), row, checkedAt);
      await probeMedia(item.episodes[0].url);
      // Do not advertise MP4 quality options that fail the same media probe.
      if (item.episodes[0].variants) {
        const variants = [];
        for (const variant of item.episodes[0].variants) { try { await probeMedia(variant.url); variants.push(variant); } catch {} }
        if (!variants.length) throw new Error('No playable MP4 variants');
        item.episodes[0].variants = variants; item.episodes[0].url = variants[0].url;
      }
      checks.push({ id, ok: true }); return item;
    } catch (e) { failures.set(id, String(e.message).slice(0, 200)); checks.push({ id, ok: false, error: failures.get(id) }); return null; }
  });
  const lives = await parallel(officialLives, async row => {
    try { await probeMedia(row.url); checks.push({ id: row.id, ok: true }); return { ...row, group: '全球官方串流', kind: 'hls', playable: true, origin: '官方直播 / IPTV-org 索引', rights: { originalPage: row.pageUrl, attribution: '由原頻道提供串流；依原站使用條款，未取得額外商業轉播授權。' }, discovery, verifiedAt: checkedAt, verification: 'media-probe' }; }
    catch (e) { failures.set(row.id, String(e.message).slice(0, 200)); checks.push({ id: row.id, ok: false, error: failures.get(row.id) }); return null; }
  });
  const now = Date.parse(checkedAt);
  const items = [...movies.filter(Boolean), ...preserveLastGood(previous.items || [], failures, now)];
  const live = [...lives.filter(Boolean), ...preserveLastGood(previous.live || [], failures, now)];
  if (!items.length && !Array.isArray(previous.items)) throw new Error('No verified movies available for initial publication');
  const payload = { schemaVersion: 1, generatedAt: checkedAt, policy: 'Curated official HTTPS sources; media remains upstream; failed entries retain last-good data for at most seven days.', sources: [{ id: sourceId, name: 'Blender 官方公開短片', key: sourceId, host: 'video.blender.org', origin: '官方公開授權', adult: false, indexed: true, complete: true, itemCount: items.length, playableCount: items.length, categories: [{ name: '電影', kind: 'movie' }], checks: checks.filter(c => c.id.startsWith(sourceId)), verifiedAt: checkedAt }], items, live, checks, totals: { movies: items.length, live: live.length, passed: checks.filter(c => c.ok).length, failed: failures.size, retained: [...items, ...live].filter(i => i.verification === 'stale').length } };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(`${output}.tmp`, JSON.stringify(payload, null, 2) + '\n');
  await fs.rename(`${output}.tmp`, output);
  return payload.totals;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(await refresh()));
