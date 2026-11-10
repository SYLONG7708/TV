import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createAutomaticPlayback } from '../docs/iphone/automatic-playback.mjs';
import { createBlueMLiveResolver } from '../docs/iphone/blue-m-live.mjs';

const source = fs.readFileSync(new URL('../docs/iphone/player-controls.mjs', import.meta.url), 'utf8').replace(/^export /gm, '').replace(/^import .*;\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Run the actual controller with a clock and the documented iframe API surface.
// No network, production channels, credentials or externally installed app is used.
async function fixture({ startState = 1, native = false } = {}) {
  let clock = 0, timerId = 0;
  const timers = new Map(), nodes = new Map(), players = [], failures = [], evidence = [];
  const setTimer = (callback, delay, interval = 0) => {
    const id = ++timerId; timers.set(id, { at: clock + delay, callback, interval }); return id;
  };
  class Node {
    constructor(id = '') {
      this.id = id; this.hidden = false; this.isConnected = true; this.dataset = {}; this.listeners = {};
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== callback); }
    dispatch(type, detail = {}) { for (const fn of this.listeners[type] || []) fn(detail); }
    removeAttribute(name) { delete this[name]; }
    setAttribute(name, value) { this[name] = value; }
    querySelector(selector) { return node(selector.slice(1)); }
    after(next) { next.isConnected = true; nodes.set(next.id, next); }
    replaceChildren() {}
    remove() { this.isConnected = false; }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
  const video = node('player');
  Object.assign(video, { currentTime: 0, duration: Infinity, paused: true, readyState: 0, videoHeight: 0,
    textTracks: Object.assign([], { addEventListener() {} }),
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {}, canPlayType() { return 'probably'; } });
  const document = new Node();
  Object.assign(document, { hidden: false, getElementById: node, createElement: () => new Node(), head: new Node() });
  class Player {
    constructor(frame, { events }) {
      this.frame = frame; this.events = events; this.time = 0; this.state = -1;
      players.push(this);
      queueMicrotask(() => { if (!this.destroyed) events.onReady({ target: this }); });
    }
    getCurrentTime() { return this.time; }
    getPlayerState() { return this.state; }
    playVideo() { this.emit(startState); }
    pauseVideo() { this.emit(2); }
    emit(state) { this.state = state; this.events.onStateChange({ data: state, target: this }); }
    error(code) { this.events.onError({ data: code, target: this }); }
    destroy() { this.destroyed = true; this.frame.remove(); }
  }
  const window = new Node(); window.YT = { Player }; window.localStorage = null;
  const nativeCalls = [], cancellations = [];
  if (native) window.CarBridge = { resolveBlueMLive: (videoId, requestId) => nativeCalls.push({ videoId, requestId }), cancelBlueMLive: id => cancellations.push(id) };
  const resolveNative = (data, index = nativeCalls.length - 1) => window.dispatch('yingshi-bluem-live', { detail: { requestId: nativeCalls[index].requestId, ...data } });
  const context = vm.createContext({ window, document, navigator: { onLine: true },
    createBlueMLiveResolver: options => createBlueMLiveResolver({ ...options, setTimer: (fn, delay) => setTimer(fn, delay), clearTimer: id => timers.delete(id) }),
    location: { origin: 'https://sylong7708.github.io' }, URL, performance: { now: () => clock },
    setTimeout: (fn, delay) => setTimer(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => setTimer(fn, delay, delay), clearInterval: id => timers.delete(id) });
  vm.runInContext(source + '\nglobalThis.makeController = createPlayerController;', context);
  const controller = context.makeController({ video, frame: node('playerFrame'), panel: new Node(),
    controls: node('controls'), hint: node('hint'), status: node('status'), storage: null,
    onFailure: (entry, detail) => failures.push({ entry, detail }),
    onEvidence: (entry, event, detail) => evidence.push({ entry, event, detail }) });
  const entry = { url: 'https://www.youtube.com/watch?v=pF507BLtbqU',
    embedUrl: 'https://www.youtube.com/embed/pF507BLtbqU', attemptId: 'same-channel' };
  async function advance(seconds, progress = false) {
    for (let i = 0; i < seconds; i++) {
      if (progress) players.at(-1).time++;
      const end = clock + 1000;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; clock = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        timer.callback(); await flush();
      }
      clock = end; await flush();
    }
  }
  controller.open(entry); await flush();
  return { controller, players, failures, evidence, document, nodes, context, entry, advance, video, nativeCalls, cancellations, resolveNative };
}

const nativeUrl = 'https://sylong7708.github.io/TV/__bluem_live__/0c49cd07-0607-465f-96c1-5f717bd30a6b/master.m3u8';
test('Android live playback waits for Blue M and never creates an iframe player', async () => {
  const f = await fixture({ native: true }); await f.advance(32);
  assert.equal(f.players.length, 0); assert.equal(f.failures.length, 0);
  f.resolveNative({ ok: true, backend: 'blue-m', url: nativeUrl }); await flush();
  assert.equal(f.controller.snapshot().backend, 'blue-m'); assert.equal(f.video.src, nativeUrl);
  assert.equal(f.video.paused, false); assert.equal(f.players.length, 0);
  f.controller.close(); assert.equal(f.cancellations.length, 1);
});
test('pausing during Blue M resolution remains paused when the media arrives', async () => {
  const f = await fixture({ native: true }); f.controller.pause();
  f.resolveNative({ ok: true, backend: 'blue-m', url: nativeUrl }); await flush();
  assert.equal(f.controller.snapshot().backend, 'blue-m'); assert.equal(f.video.paused, true);
  await f.advance(45); assert.equal(f.failures.length, 0); f.controller.close();
});
test('a native compatibility failure is reported even if resolution was paused', async () => {
  const f = await fixture({ native: true }); f.controller.pause();
  f.resolveNative({ ok: false, terminal: true, message: '請更新藍色 M。' }); await flush();
  assert.equal(f.failures.length, 1); assert.equal(f.failures[0].detail.terminal, true);
  assert.equal(f.video.paused, true); assert.equal(f.players.length, 0); f.controller.close();
});
test('closing or changing channel cancels native resolution and ignores its late reply', async () => {
  const f = await fixture({ native: true }); f.controller.close();
  f.resolveNative({ ok: true, backend: 'blue-m', url: nativeUrl }); await flush();
  assert.equal(f.controller.snapshot().active, false); assert.equal(f.cancellations.length, 1);
  f.controller.open({ ...f.entry, embedUrl: 'https://www.youtube.com/embed/TCnaIE_SAtM' });
  f.resolveNative({ ok: true, backend: 'blue-m', url: nativeUrl }, 0); await flush();
  assert.equal(f.controller.snapshot().backend, 'direct'); assert.equal(f.video.src, undefined);
  f.controller.close();
});

test('a stalled live player is recreated once for the same video inside the existing page', async () => {
  const f = await fixture(); await f.advance(3, true); await f.advance(7);
  assert.equal(f.players.length, 2); assert.equal(f.players[0].destroyed, true);
  assert.equal(new URL(f.players[1].frame.src).pathname, '/embed/pF507BLtbqU');
  assert.equal(f.failures.length, 0);
  assert.equal(f.evidence.some(row => row.detail?.reason === 'youtube-reconnect'), true);
  await f.advance(7); assert.equal(f.players.length, 2); assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0].entry.attemptId, f.entry.attemptId);
  f.controller.close();
});

test('a playing flag without advancing time never counts as actual playback', async () => {
  const f = await fixture(); await f.advance(5);
  assert.equal(f.evidence.some(row => row.event === 'playing'), false);
  await f.advance(2); assert.equal(f.players.length, 2); f.controller.close();
});

test('an advancing preroll clock is neither interrupted nor reported as verified live playback', async () => {
  const f = await fixture({ startState: -1 }); await f.advance(45, true);
  assert.equal(f.players.length, 1); assert.equal(f.failures.length, 0);
  assert.equal(f.evidence.some(row => row.event === 'playing'), false);
  f.players[0].emit(1); await f.advance(3, true);
  assert.equal(f.evidence.some(row => row.event === 'playing'), true); f.controller.close();
});

test('pause, autoplay blocking and a completed broadcast do not trigger automatic reloads', async () => {
  for (const action of ['pause', 'autoplay', 'ended']) {
    const f = await fixture(); await f.advance(2, true);
    if (action === 'pause') f.players[0].emit(2);
    if (action === 'ended') f.players[0].emit(0);
    if (action === 'autoplay') f.players[0].events.onAutoplayBlocked();
    await f.advance(45);
    assert.equal(f.players.length, 1, action); assert.equal(f.failures.length, 0, action);
    f.controller.close();
  }
});

test('backgrounding and returning gives the same player a new observation period', async () => {
  const f = await fixture(); await f.advance(2, true);
  f.document.hidden = true; f.document.dispatch('visibilitychange'); await f.advance(45);
  assert.equal(f.players.length, 1);
  f.document.hidden = false; f.document.dispatch('visibilitychange'); await f.advance(2, true);
  assert.equal(f.players.length, 1); assert.equal(f.failures.length, 0); f.controller.close();
});

test('restricted, removed, malformed and unidentifiable embeds stop with a terminal explanation', async () => {
  for (const code of [2, 100, 101, 150, 153]) {
    const f = await fixture(); f.players[0].error(code); await flush(); await f.advance(30);
    assert.equal(f.players.length, 1, String(code)); assert.equal(f.failures.length, 1);
    assert.equal(f.failures[0].detail.terminal, true); assert.ok(f.failures[0].detail.message);
    f.controller.close();
  }
});

test('transient errors retry after two seconds and repeated error events cannot start extra retries', async () => {
  const f = await fixture(); f.players[0].error(5); f.players[0].error(5);
  await f.advance(1); assert.equal(f.players.length, 1);
  await f.advance(1); assert.equal(f.players.length, 2);
  assert.equal(f.failures.length, 0); f.controller.close();
});

test('closing the player cancels a pending recovery and stale callbacks after changing channels', async () => {
  const f = await fixture(); const old = f.players[0]; old.error(5); f.controller.close();
  await f.advance(5); assert.equal(f.players.length, 1); assert.equal(f.failures.length, 0);
  f.controller.open({ ...f.entry, embedUrl: 'https://www.youtube.com/embed/TCnaIE_SAtM' }); await flush();
  old.error(100); old.emit(3); await f.advance(3, true);
  assert.equal(f.players.length, 2); assert.equal(f.failures.length, 0); f.controller.close();
});

test('offline state hands control to the existing reconnect queue without rebuilding an iframe', async () => {
  const f = await fixture(); f.context.navigator.onLine = false; await f.advance(1);
  assert.equal(f.players.length, 1); assert.equal(f.failures.length, 1);
  assert.match(f.failures[0].detail.message, /網路/); f.controller.close();
});

test('ninety seconds of actual continued playback permits recovery from a later separate fault', async () => {
  const f = await fixture(); f.players[0].error(5); await f.advance(2);
  assert.equal(f.players.length, 2);
  await f.advance(93, true); await f.advance(7);
  assert.equal(f.players.length, 3); assert.equal(f.failures.length, 0); f.controller.close();
});

test('terminal embed errors stop discovery and automatic retries until a manual retry', async () => {
  const starts = [], timers = []; let discoveries = 0;
  const session = createAutomaticPlayback({ rank: rows => rows, resolve: row => [row],
    start: entry => starts.push(entry), exhausted() { throw new Error('must preserve the terminal explanation'); },
    discover: async () => { discoveries++; return []; },
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer() {} });
  await session.open([{ embedUrl: 'https://www.youtube.com/embed/pF507BLtbqU' }]);
  await session.failed(starts[0], 0, { terminal: true }); await session.reconnect();
  session.intent('pause'); session.intent('play'); await flush();
  assert.equal(discoveries, 0); assert.equal(timers.length, 0); assert.equal(starts.length, 1);
  assert.equal(session.snapshot().blocked, true);
  await session.retry(); assert.equal(starts.length, 2); assert.equal(session.snapshot().blocked, false);
  session.close();
});
