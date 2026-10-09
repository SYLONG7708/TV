import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomaticPlayback } from '../docs/iphone/automatic-playback.mjs';
import { episodeIdentity, matchingEpisodes, samePlaybackWork } from '../docs/iphone/signal-priority.mjs';
import { workIdentity } from '../docs/iphone/title-quality.mjs';
import { liveChannelIdentity, withLiveAlternates } from '../docs/iphone/public-sources.mjs';
const compact = text => String(text).toLowerCase().replace(/\s/g, '');
const identity = item => workIdentity(item, compact);
function fixture(extra = {}) {
  const starts = [], timers = [], statuses = [];
  const player = createAutomaticPlayback({ rank: rows => rows, resolve: row => [row],
    start: (entry, info) => starts.push({ entry, info }), exhausted: value => statuses.push(value),
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cancelled = true; }, ...extra });
  return { player, starts, timers, statuses };
}
test('failure discovers a source absent from the visible home page and preserves the exact position', async () => {
  const f = fixture({ discover: async () => [{ url: 'new' }] });
  await f.player.open([{ url: 'old' }]);
  await f.player.failed(f.starts[0].entry, 123.5);
  assert.equal(f.starts[1].entry.url, 'new'); assert.equal(f.starts[1].info.position, 123.5);
});
test('closing during cloud discovery aborts the request and cannot start another episode', async () => {
  let finish, signal;
  const f = fixture({ discover: (_options, value) => { signal = value; return new Promise(r => { finish = r; }); } });
  await f.player.open([{ url: 'a' }]); const pending = f.player.failed(f.starts[0].entry);
  f.player.close(); finish([{ url: 'b' }]); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.starts.length, 1);
});
test('offline playback waits and network return resumes at the saved position', async () => {
  let online = true; const f = fixture({ online: () => online });
  await f.player.open([{ url: 'a' }]); online = false;
  await f.player.failed(f.starts[0].entry, 87);
  assert.equal(f.starts.length, 1); assert.equal(f.timers[0].delay, 5000);
  online = true; await f.player.reconnect();
  assert.equal(f.starts[1].info.position, 87); assert.equal(f.timers[0].cancelled, true);
});
test('a manual retry is a new accepted attempt after all sources were exhausted', async () => {
  const f = fixture(); await f.player.open([{ url: 'a' }]);
  await f.player.failed(f.starts[0].entry, 52); assert.equal(f.statuses.length, 1);
  await f.player.retry(52); await f.player.failed(f.starts[1].entry, 53);
  assert.equal(f.statuses.length, 2); assert.notEqual(f.starts[0].entry.attemptId, f.starts[1].entry.attemptId);
});
test('exhausted sources back off and closing cancels the pending restart', async () => {
  const f = fixture(); await f.player.open([{ url: 'a' }]);
  await f.player.failed(f.starts[0].entry); assert.equal(f.timers[0].delay, 30000);
  await f.player.retry(); await f.player.failed(f.starts[1].entry); assert.equal(f.timers[1].delay, 60000);
  f.player.close(); assert.equal(f.timers[1].cancelled, true);
  f.timers[1].callback(); assert.equal(f.starts.length, 2);
});
test('user pause cancels automatic reconnect until an explicit play request', async () => {
  const f = fixture(); await f.player.open([{ url: 'a' }]); await f.player.failed(f.starts[0].entry, 16);
  f.player.intent('pause'); await f.player.reconnect(); assert.equal(f.starts.length, 1);
  f.player.intent('play'); await new Promise(r => setImmediate(r)); assert.equal(f.starts.length, 2);
});
test('broadcast dates normalize separators but keep special editions distinct', () => {
  assert.equal(episodeIdentity('第20261007期'), episodeIdentity('2026-10-07'));
  assert.equal(episodeIdentity('2026.10.07'), episodeIdentity('20261007期'));
  assert.notEqual(episodeIdentity('第20220103(微女人)期'), episodeIdentity('20220103'));
  assert.notEqual(episodeIdentity('20260230'), episodeIdentity('20260302'));
});
test('dated variety collections can find the same broadcast across different collection years', () => {
  const original = { id: 'a', title: '女人我最大2022', year: '2020', kind: 'variety', episodes: [{ name: '第20261007期' }] };
  const other = { id: 'b', title: '女人我最大', year: '2011', kind: 'variety', episodes: [{ name: '2026-10-06' }, { name: '20261007' }] };
  assert.equal(samePlaybackWork(original, other, original.episodes[0], compact, identity), true);
  assert.deepEqual(matchingEpisodes(other, original.episodes[0], original, 0), [other.episodes[1]]);
  assert.equal(samePlaybackWork({ ...original, kind: 'movie' }, other, original.episodes[0], compact, identity), false);
  assert.equal(samePlaybackWork(original, { ...other, title: '另一個節目' }, original.episodes[0], compact, identity), false);
});
test('movie remakes and missing episodes cannot be substituted', () => {
  const a = { title: '同名電影', year: '1990', kind: 'movie' }, b = { ...a, year: '2020' };
  assert.equal(samePlaybackWork(a, b, { name: '正片' }, compact, identity), false);
  assert.deepEqual(matchingEpisodes({ episodes: [{ name: '20261006' }] }, { name: '第20261007期' }, { kind: 'variety' }, 0), []);
});
test('official live alternatives match the same channel and language only', () => {
  assert.equal(liveChannelIdentity({ name: '054 FRANCE 24 English' }), liveChannelIdentity({ name: 'France 24 英語｜官方串流' }));
  assert.notEqual(liveChannelIdentity({ name: 'France 24 法語｜官方串流' }), liveChannelIdentity({ name: '054 FRANCE 24 English' }));
  assert.notEqual(liveChannelIdentity({ name: 'Arirang TV' }), liveChannelIdentity({ name: 'Arirang UN' }));
  assert.notEqual(liveChannelIdentity({ name: '001 三立iNEWS' }), liveChannelIdentity({ name: '005 中視新聞' }));
});

test('legacy live metadata adds only same-channel alternatives and preserves ids and names', () => {
  const rows = [{ id: 'en', name: '054 FRANCE 24 English', url: 'https://www.youtube.com/watch?v=test', embedUrl: 'https://www.youtube.com/embed/test' },
    { id: 'public-en', name: 'France 24 英語｜官方串流', url: 'https://en.test/master.m3u8' },
    { id: 'public-fr', name: 'France 24 法語｜官方串流', url: 'https://fr.test/master.m3u8' }];
  const enriched = withLiveAlternates(rows);
  assert.equal(enriched.length, 3); assert.equal(enriched[0].name, rows[0].name);
  assert.equal(enriched[0].alternates.length, 1); assert.equal(enriched[0].alternates[0].url, rows[1].url);
  assert.equal(enriched[2].alternates, undefined); assert.equal(rows[0].alternates, undefined);
  assert.deepEqual(withLiveAlternates(enriched), enriched);
});
