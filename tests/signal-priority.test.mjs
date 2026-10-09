import assert from 'node:assert/strict';
import test from 'node:test';
import { createSignalPriority, matchingEpisodes, signalKey } from '../docs/iphone/signal-priority.mjs';
const a = { url: 'https://example.org/a.m3u8', sourceId: 'a' };
const b = { url: 'https://example.org/b.m3u8', sourceId: 'b' };
test('recent device success outranks unknown signals; recent failures open a short circuit', () => {
  let time = Date.UTC(2026, 9, 3); const ranker = createSignalPriority({ now: () => time });
  ranker.record(b, 'playing', { startupMs: 1200, height: 720 });
  assert.equal(ranker.rank([a, b])[0], b);
  ranker.record(b, 'failure'); assert.equal(ranker.rank([a, b])[0], a);
  time += 11 * 60e3; assert.equal(ranker.rank([a, b])[0], b);
  time += 8 * 864e5; assert.equal(ranker.rank([a, b])[0], a);
});
test('old cloud evidence and expired signed URLs cannot claim a current success', () => {
  const time = Date.UTC(2026, 9, 3); const ranker = createSignalPriority({ now: () => time });
  ranker.setCloud({ checkedAt: new Date(time - 48 * 36e5).toISOString(), signals: { [signalKey(b.url)]: { verified: true } } });
  assert.equal(ranker.rank([a, b])[0], a);
  ranker.setCloud({ checkedAt: new Date(time).toISOString(), signals: { [signalKey(b.url)]: { verified: true } } });
  assert.equal(ranker.rank([a, b])[0], b);
  assert.notEqual(signalKey(b.url + '?sig=old'), signalKey(b.url + '?sig=new'));
});
test('episode failover matches the actual episode number, never the array position', () => {
  const original = { id: 'a', kind: 'series', episodes: [{ name: '第02集', url: 'a' }] };
  const alternate = { id: 'b', episodes: [{ name: '第01集' }, { name: '第03集' }] };
  assert.deepEqual(matchingEpisodes(alternate, original.episodes[0], original, 0), []);
  alternate.episodes.push({ name: '02' });
  assert.equal(matchingEpisodes(alternate, original.episodes[0], original, 0)[0].name, '02');
});
test('missing and corrupted storage does not block playback or leak full stream URLs', () => {
  let written = ''; const ranker = createSignalPriority({ storage: { getItem: () => '{', setItem: (_, text) => { written = text; } } });
  ranker.record(a, 'playing'); assert.ok(written); assert.ok(!written.includes('https:'));
  assert.equal(ranker.rank([a, a]).length, 1);
  assert.equal(signalKey('javascript:alert(1)'), '');
});
