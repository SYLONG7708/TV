import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { normalizePublicSources, mergePublicLive } from '../docs/iphone/public-sources.mjs';
import { movieItem, preserveLastGood, httpsUrl, allowsBrowserOrigin } from '../tools/refresh-public-sources.mjs';
import { mergePublicCatalog, mergeData } from '../tools/merge-public-sources-into-data.mjs';
import { readGzipJson } from '../tools/stable-gzip-json.mjs';
const payload = JSON.parse(await fs.readFile(new URL('../docs/iphone/public-sources.json', import.meta.url), 'utf8'));

test('official movie ratings do not mistake AV production credits for adult content', async () => {
  const html = await fs.readFile(new URL('../docs/iphone/index.html', import.meta.url), 'utf8');
  const rules = html.slice(html.indexOf('const ADULT_ITEM_TEXT_RE ='), html.indexOf('const CLIENT_KIND_RULES ='));
  const fn = html.slice(html.indexOf('function itemIsAdult('), html.indexOf('function signalSourceEntry('));
  const classify = vm.runInNewContext(`${rules}\n${fn}\nitemIsAdult;`);
  const movie = payload.items.find(i => i.title === 'Tears of Steel');
  const source = payload.sources.find(s => s.id === movie.sourceId);
  assert.ok(movie.content.includes('AV Services'));
  assert.equal(classify(movie, source), false);
  for (const item of payload.items) assert.equal(classify(item, source), false);
  assert.equal(classify({ ...movie, adult: true }, source), true);
  assert.equal(classify({ ...movie, kind: 'adult' }, source), true);
  assert.equal(classify(movie, { ...source, adult: true }), true);
  assert.equal(classify(movie, { ...source, host: 'unverified.example' }), true);
  assert.equal(classify({ ...movie, sourceId: 'legacy' }, { id: 'legacy', adult: false }), true);
});
test('HLS availability requires a usable browser CORS response', () => {
  assert.equal(allowsBrowserOrigin('*'), true);
  assert.equal(allowsBrowserOrigin('https://sylong7708.github.io'), true);
  for (const value of [null, '', 'https://unrelated.example', 'null', '*, https://unrelated.example']) assert.equal(allowsBrowserOrigin(value), false);
});
test('shared cloud catalog stays idempotent and preserves legacy counts and rows', () => {
  const original = { generatedAt: 'unchanged', sources: [{ id: 'legacy', itemCount: 500, playableCount: 450, indexed: true }], items: [{ id: 'legacy:1', sourceId: 'legacy' }], totals: { items: 500, playableItems: 450, movies: 300, series: 200 } };
  const merged = mergePublicCatalog(original, payload);
  assert.equal(merged.totals.items, 500 + payload.items.length);
  assert.equal(merged.totals.movies, 300 + payload.items.length);
  assert.equal(merged.totals.series, 200); assert.equal(merged.generatedAt, 'unchanged');
  assert.deepEqual(mergePublicCatalog(merged, payload), merged);
  assert.ok(merged.sources[0].indexPath.endsWith('.json.gz'));
  assert.deepEqual(merged.items.at(-1), original.items[0]);
});
test('shared publisher writes a real compressed index and updates links without duplicating channels', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'oktv-public-publish-'));
  try {
    await fs.writeFile(path.join(folder, 'iphone-vod-catalog.json'), JSON.stringify({ sources: [{ id: 'legacy', itemCount: 100, playableCount: 80, indexed: true }], items: [{ id: 'legacy:1', sourceId: 'legacy' }], totals: { movies: 100 } }));
    await fs.writeFile(path.join(folder, 'live-channels.json'), JSON.stringify([{ id: 'legacy-live', url: 'https://example.com/legacy.m3u8' }]));
    const a = await mergeData({ dataRoot: folder }), b = await mergeData({ dataRoot: folder });
    assert.deepEqual(a, b); assert.equal(a.live, 1 + payload.live.length);
    const index = await readGzipJson(path.join(folder, 'vod-index/public-blender-open-movies.json.gz'));
    assert.equal(index.items.length, payload.items.length); assert.ok(index.items.every(i => i.episodes[0].url.startsWith('https://')));
    const updated = JSON.parse(await fs.readFile(path.join(folder, 'iphone-vod-catalog.json')));
    assert.equal(updated.totals.items, 100 + payload.items.length); assert.ok(updated.items.some(i => i.id === 'legacy:1'));
  } finally {
    if (!folder.startsWith(path.resolve(os.tmpdir()) + path.sep + 'oktv-public-publish-')) throw new Error('Unsafe temporary test path');
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test('published public media has unique IDs, attribution and one complete movie per item', () => {
  const actual = normalizePublicSources(payload);
  assert.equal(actual.items.length, payload.items.length);
  assert.equal(actual.live.length, payload.live.length);
  assert.ok(actual.items.length >= 8);
  assert.equal(new Set(actual.items.map(i => i.id)).size, actual.items.length);
  for (const item of actual.items) { assert.equal(item.episodes.length, 1); assert.ok(item.duration > 30); assert.ok(item.verifiedAt); assert.ok(item.rights.licenseLabel); }
});
test('untrusted supplements cannot replace legacy sources or add unsafe media', () => {
  const p = structuredClone(payload); p.sources.push({ id: 'legacy', indexed: true });
  p.items[0].episodes[0].url = 'javascript:alert(1)';
  p.items[1].episodes[0].variants = [{ url: 'https://user:password@example.com/a.mp4' }];
  p.items.push({ ...p.items[2], id: 'legacy:x', sourceId: 'legacy' });
  p.live[0].url = 'http://insecure.example/a.m3u8';
  const result = normalizePublicSources(p);
  assert.equal(result.items.length, payload.items.length - 2);
  assert.equal(result.live.length, payload.live.length - 1);
  assert.ok(result.sources.every(s => s.id.startsWith('public-')));
  assert.deepEqual(normalizePublicSources({ schemaVersion: 99 }), { sources: [], items: [], live: [] });
});
test('duplicate refreshes do not multiply channels or replace existing links', () => {
  const rows = mergePublicLive(payload.live, [...payload.live, { ...payload.live[0], id: 'public-another-id' }]);
  assert.equal(rows.length, payload.live.length); assert.deepEqual(mergePublicLive(rows, payload.live), rows);
});
test('temporary upstream outage preserves recent data without claiming new verification', () => {
  const now = Date.parse('2026-10-03T00:00:00Z');
  const entries = [{ id: 'recent', verifiedAt: '2026-10-02T00:00:00Z' }, { id: 'expired', verifiedAt: '2026-09-01T00:00:00Z' }, { id: 'invalid', verifiedAt: 'bad' }];
  const retained = preserveLastGood(entries, new Map(entries.map(i => [i.id, 'HTTP 503'])), now);
  assert.equal(retained.length, 1); assert.equal(retained[0].verifiedAt, entries[0].verifiedAt); assert.equal(retained[0].verification, 'stale');
  assert.deepEqual(preserveLastGood(entries, new Map(), now), []);
});
test('official movie ingestion rejects changed identity, private videos and missing rights', () => {
  const detail = { uuid: 'abc', channel: { name: 'blender_open_movies' }, privacy: { id: 1 }, licence: { id: 1 }, files: [{ resolution: { id: 720, label: '720p' }, fileUrl: 'https://video.blender.org/a.mp4' }], thumbnailPath: '/a.jpg' };
  assert.equal(movieItem(detail, ['abc', 'Sample', 2020], '2026-10-03').episodes[0].url, detail.files[0].fileUrl);
  assert.throws(() => movieItem({ ...detail, nsfw: true }, ['abc', 'Sample', 2020]), /non-public/);
  assert.throws(() => movieItem(detail, ['wrong', 'Sample', 2020]), /non-public/);
  assert.throws(() => movieItem({ ...detail, licence: { id: null } }, ['abc', 'Sample', 2020]), /License/);
  assert.throws(() => movieItem({ ...detail, files: [] }, ['abc', 'Sample', 2020]), /No supported/);
  assert.equal(httpsUrl('https://evil.example/a', ['video.blender.org']), '');
});
