import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyRepairs, mergeLegacySeeds } from '../tools/legacy-playback-repairs.mjs';
const now = Date.parse('2026-10-09T00:00:00Z');
const first = { id: 'a', sourceId: 'a', title: '女人我最大2022', kind: 'variety', year: '2020', episodes: [{ name: '第20220103(微女人)期', url: 'https://a.test/special.m3u8' }, { name: '第20261007期', url: 'https://a.test/recent.m3u8' }] };
const second = { id: 'b', sourceId: 'b', title: '女人我最大', kind: 'variety', year: '2011', episodes: [{ name: '20220103', url: 'https://b.test/ordinary.m3u8' }, { name: '2026-10-07', url: 'https://b.test/recent.m3u8' }] };
test('old APK compatible variants preserve every episode name, order, title and source identity', () => {
  const repair = buildLegacyRepairs([first], [first, second], {}, { now });
  assert.equal(repair.items.length, 1); const item = repair.items[0];
  assert.equal(item.id, first.id); assert.equal(item.title, first.title); assert.equal(item.sourceId, first.sourceId);
  assert.deepEqual(item.episodes.map(ep => ep.name), first.episodes.map(ep => ep.name));
  assert.equal(item.episodes[0].variants, undefined, 'special edition must not become ordinary edition');
  assert.deepEqual(item.episodes[1].variants.map(row => row.url), [first.episodes[1].url, second.episodes[1].url]);
});
test('reused detail ids and film remakes cannot receive mismatched cloud repairs', () => {
  assert.equal(buildLegacyRepairs([{ ...first, title: 'another show' }], [first, second], {}, { now }).items.length, 0);
  const movie = { ...first, kind: 'movie', title: 'same title', year: '1990', episodes: [{ name: '正片', url: 'https://a.test/a.mp4' }] };
  assert.equal(buildLegacyRepairs([movie], [movie, { ...movie, id: 'b', sourceId: 'b', year: '2020' }], {}, { now }).items.length, 0);
});
test('oversize and stale repair metadata do not replace working seeds', () => {
  assert.equal(buildLegacyRepairs([first], [first, second], {}, { now, maxBytes: 10 }).items.length, 0);
  const report = buildLegacyRepairs([first], [first, second], {}, { now }), seeds = { items: [{ id: 'existing' }] };
  assert.equal(mergeLegacySeeds(seeds, report, now + 1000).items.length, 2);
  assert.equal(mergeLegacySeeds(seeds, report, now + 37 * 36e5), seeds);
  report.items[0].episodes[1].variants[0].url = 'javascript:alert(1)';
  assert.equal(mergeLegacySeeds(seeds, report, now + 1000).items.length, 1);
});
