import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlueMLiveResolver, youTubeVideoId } from '../docs/iphone/blue-m-live.mjs';

function fixture() {
  const events = new EventTarget(), calls = [], cancellations = [], timers = [];
  const resolver = createBlueMLiveResolver({ events,
    bridge: { resolveBlueMLive: (videoId, requestId) => calls.push({ videoId, requestId }), cancelBlueMLive: id => cancellations.push(id) },
    setTimer: callback => { timers.push(callback); return callback; }, clearTimer: callback => { if (callback) callback.cancelled = true; } });
  const result = (id, data) => { const event = new Event('yingshi-bluem-live'); event.detail = { requestId: id, ...data }; events.dispatchEvent(event); };
  return { resolver, calls, cancellations, timers, result };
}
const embed = 'https://www.youtube.com/embed/pF507BLtbqU';
const url = 'https://sylong7708.github.io/TV/__bluem_live__/0c49cd07-0607-465f-96c1-5f717bd30a6b/master.m3u8';

test('only exact YouTube embed ids can request a native live stream', () => {
  assert.equal(youTubeVideoId(embed), 'pF507BLtbqU');
  for (const input of ['https://youtube.com.evil.test/embed/pF507BLtbqU', 'http://www.youtube.com/embed/pF507BLtbqU', 'https://www.youtube.com/embed/live_stream', 'https://www.youtube.com/embed/pF507BLtbqU/extra']) assert.equal(youTubeVideoId(input), '');
});
test('a verified native result resolves to an app-local stream, without a media address in the page', async () => {
  const f = fixture(), request = f.resolver.open(embed);
  f.result(f.calls[0].requestId, { ok: true, backend: 'blue-m', url });
  assert.deepEqual(await request.promise, { url, backend: 'blue-m' });
  assert.equal(f.timers[0].cancelled, true); request.close(); assert.deepEqual(f.cancellations, [f.calls[0].requestId]);
});
test('a late reply from a different channel cannot resolve the current operation', async () => {
  const f = fixture(), first = f.resolver.open(embed), second = f.resolver.open(embed); let resolved = false;
  second.promise.then(() => { resolved = true; });
  f.result(f.calls[0].requestId, { ok: true, backend: 'blue-m', url }); await first.promise; await Promise.resolve(); assert.equal(resolved, false);
  f.result(f.calls[1].requestId, { ok: true, backend: 'blue-m', url }); await second.promise;
  first.close(); second.close();
});
test('native public URLs, wrong origins, query strings and other backends are rejected', async () => {
  for (const value of [url+'?leak=1', url.replace('sylong7708.github.io', 'evil.test'), 'https://r1.googlevideo.com/videoplayback']) {
    const f = fixture(), request = f.resolver.open(embed); f.result(f.calls[0].requestId, { ok: true, backend: 'blue-m', url: value });
    await assert.rejects(request.promise, /驗證失敗/); request.close();
  }
});
test('native compatibility failures retain their terminal state for the playback queue', async () => {
  const f = fixture(), request = f.resolver.open(embed);
  f.result(f.calls[0].requestId, { ok: false, terminal: true, message: '請更新藍色 M。' });
  await assert.rejects(request.promise, error => error.terminal && error.message === '請更新藍色 M。'); request.close();
});
test('a bounded timeout cancels the native resolver and does not leave a late reply listener', async () => {
  const f = fixture(), request = f.resolver.open(embed); f.timers[0]();
  await assert.rejects(request.promise, /逾時/); assert.equal(f.cancellations.length, 1);
  f.result(f.calls[0].requestId, { ok: true, backend: 'blue-m', url }); request.close(); assert.equal(f.cancellations.length, 1);
});
