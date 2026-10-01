import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanTitle, titleQuality, workIdentity, sameDetailIdentity } from '../docs/iphone/title-quality.mjs';
import { mergeItemsIntoGroups, expandQueryGroups } from '../tools/iphone-query-shards.mjs';

const compact = (s) => s.toLowerCase().replace(/[\s!?？]/g, '');
test('quarantines unreadable names without rejecting real single-letter or question-mark titles', () => {
  for (const title of ['???', '？ ？？', '', 'Broken\ufffdTitle']) assert.equal(titleQuality(title).valid, false);
  for (const title of ['X', 'K', '春', '請問您今天要來點兔子嗎？？']) assert.equal(titleQuality(title).valid, true);
  assert.equal(cleanTitle('<b>A &amp; B</b> &#x6625;'), 'A & B 春');
});
test('same-named remakes and different formats stay separate', () => {
  const movie = { title: 'The Example', year: '1998', kind: 'movie' };
  assert.notEqual(workIdentity(movie, compact), workIdentity({ ...movie, year: '2023' }, compact));
  assert.notEqual(workIdentity(movie, compact), workIdentity({ ...movie, kind: 'series' }, compact));
  assert.notEqual(workIdentity({ ...movie, year: '', id: 'a' }, compact), workIdentity({ ...movie, year: '', id: 'b' }, compact));
});
test('detail lookup rejects reused IDs with different titles, sources or years', () => {
  const movie = { id: 'a::12', sourceId: 'a', vodId: '12', title: 'Example', year: '2023' };
  assert.equal(sameDetailIdentity({ ...movie, title: '<b>Example</b>' }, movie, compact), true);
  for (const change of [{ title: 'Other Film' }, { sourceId: 'b' }, { year: '1998' }]) {
    assert.equal(sameDetailIdentity({ ...movie, ...change }, movie, compact), false);
  }
});
test('query groups preserve each signal metadata and keep remakes apart', () => {
  const normalizer = { compact };
  const item = { title: 'Example', kind: 'movie', year: '2023', episodeCount: 1, detailPath: 'vod-detail/a.json.gz' };
  const rows = [
    { ...item, id: 'a', sourceId: 'a', poster: 'a.jpg' },
    { ...item, id: 'b', sourceId: 'b', title: 'EXAMPLE', poster: 'b.jpg' },
    { ...item, id: 'c', sourceId: 'c', year: '1998', poster: 'c.jpg' },
  ];
  const groups = mergeItemsIntoGroups([], rows, { normalizer });
  assert.equal(groups.length, 2);
  const expanded = expandQueryGroups({ groups });
  assert.equal(expanded.find((r) => r.id === 'b').title, 'EXAMPLE');
  assert.equal(expanded.find((r) => r.id === 'b').poster, 'b.jpg');
  assert.equal(expanded.find((r) => r.id === 'c').year, '1998');
});
test('incremental year corrections move a signal out of its previous work group', () => {
  const normalizer = { compact };
  const item = { id: 'a', sourceId: 'a', vodId: '1', title: 'Example', kind: 'movie', year: '1998', episodeCount: 1, detailPath: 'vod-detail/a.json.gz' };
  const previous = mergeItemsIntoGroups([], [item], { normalizer });
  const updated = mergeItemsIntoGroups(previous, [{ ...item, year: '2023' }], { normalizer });
  assert.equal(updated.length, 1);
  assert.equal(expandQueryGroups({ groups: updated })[0].year, '2023');
});
