import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomaticPlayback } from '../docs/iphone/automatic-playback.mjs';
test('closing a player cancels an outstanding alternate lookup', async () => {
  let finish, started = 0;
  const player = createAutomaticPlayback({ rank: rows => rows, resolve: () => new Promise(r => { finish = r; }), start: () => started++, exhausted() {} });
  const pending = player.open([{}]); player.close(); finish([{ url: 'https://example.org/a' }]);
  await pending; assert.equal(started, 0); assert.equal(player.snapshot(), null);
});
test('late failures from an old attempt cannot advance a newer movie', async () => {
  const started = [];
  const player = createAutomaticPlayback({ rank: rows => rows, resolve: row => [row], start: row => started.push(row), exhausted() {} });
  await player.open([{ url: 'a' }, { url: 'b' }]); const old = started[0];
  await player.open([{ url: 'c' }, { url: 'd' }]);
  await player.failed(old); assert.deepEqual(started.map(row => row.url), ['a', 'c']);
});
test('failed signals advance only once, preserve position and stop at six attempts', async () => {
  const started = []; let ended;
  const player = createAutomaticPlayback({ rank: rows => rows, resolve: row => [row], start: (row, info) => started.push({ ...row, info }), exhausted: info => { ended = info; } });
  await player.open(Array.from({ length: 9 }, (_, i) => ({ url: String(i) })));
  for (let i = 0; i < 6; i++) await player.failed(started.at(-1), 42);
  assert.equal(started.length, 6); assert.equal(started[1].info.position, 42); assert.equal(ended.attempts, 6);
});
test('a failure after an hour of healthy playback still switches sources at the same position', async () => {
  let now = 0; const started = [];
  const player = createAutomaticPlayback({ now: () => now, rank: rows => rows, resolve: row => [row], start: (row, info) => started.push({ ...row, info }), exhausted() {} });
  await player.open([{ url: 'a' }, { url: 'b' }]); player.succeeded(started[0]);
  now = 3600000; await player.failed(started[0], 3595);
  assert.equal(started[1].url, 'b'); assert.equal(started[1].info.position, 3595);
});
