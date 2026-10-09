import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { exactVoiceMatch } from '../docs/iphone/car-integration.mjs';
const compact = value => String(value || '').trim().toLowerCase();
test('spoken titles never fall back to the first unrelated search result', () => {
  const rows = [{ title: 'One', year: 2001 }, { title: 'Two', year: 2002 }];
  assert.equal(exactVoiceMatch(rows, 'Three', compact), null);
  assert.equal(exactVoiceMatch(rows, 'o', compact), null);
  assert.equal(exactVoiceMatch(rows, 'One', compact), rows[0]);
});
test('ambiguous remakes require selection instead of silent guessing', () => {
  assert.equal(exactVoiceMatch([{ title: 'One', year: 2001 }, { title: 'One', year: 2020 }], 'One', compact), null);
});

function updateFixture(revision) {
  const timers = [], events = {}, calls = { fetch: 0, reload: 0, native: 0 };
  const document = { hidden: false, sheet: false, activeElement: null, querySelector() { return this.sheet ? {} : null; }, addEventListener() {} };
  const state = { query: '' };
  const context = { document, navigator: { onLine: true }, Date, AbortSignal,
    window: { addEventListener: (name, callback) => events[name] = callback, CarBridge: { requestCloudPlayerUpdate() { calls.native++; return true; } } },
    location: { reload() { calls.reload++; } },
    setTimeout: fn => fn(), setInterval: (fn, ms) => timers.push({ fn, ms }),
    fetch: async () => { calls.fetch++; return { ok: true, json: async () => ({ codeCommit: 'b'.repeat(40) }) }; },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../docs/iphone/car-integration.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function'), context);
  context.installCarIntegration({ state, codeRevision: revision });
  return { calls, document, state, events, context, timers, check: timers.find(row => row.ms === 300000).fn };
}

test('a new cloud player revision reloads only after the playing or paused sheet is closed', async () => {
  const f = updateFixture('a'.repeat(40)); f.document.sheet = true;
  await f.check(); assert.equal(f.calls.fetch, 0); assert.equal(f.calls.reload, 0);
  f.document.sheet = false; f.state.query = 'unfinished search'; await f.check(); assert.equal(f.calls.fetch, 0);
  f.state.query = ''; await f.check(); assert.equal(f.calls.fetch, 1); assert.equal(f.calls.reload, 1);
});

test('bundled fallback asks Android to retry the cloud after reconnect without interrupting playback', async () => {
  const f = updateFixture('local'); f.document.sheet = true;
  await f.check(); f.events.online(); assert.equal(f.calls.native, 0);
  f.document.sheet = false; await f.check(); assert.equal(f.calls.native, 1); assert.equal(f.calls.fetch, 0);
  f.events.online(); assert.equal(f.calls.native, 2); assert.equal(f.calls.reload, 0);
});

test('a movie opened while version fetch is pending prevents reload until the sheet closes', async () => {
  const f = updateFixture('a'.repeat(40));
  let resolve;
  f.context.fetch = () => new Promise(done => { resolve = done; });
  const pending = f.check();
  f.document.sheet = true;
  resolve({ ok: true, json: async () => ({ codeCommit: 'b'.repeat(40) }) });
  await pending;
  assert.equal(f.calls.reload, 0);
  f.document.sheet = false;
  f.timers.find(row => row.ms === 15000).fn();
  assert.equal(f.calls.reload, 1);
  f.timers.find(row => row.ms === 15000).fn();
  assert.equal(f.calls.reload, 1, 'consumed reload request must not loop');
});

test('an unreachable or malformed update keeps the current player and permits later checks', async () => {
  const f = updateFixture('a'.repeat(40));
  f.context.fetch = async () => { throw new Error('offline'); };
  await f.check();
  f.context.fetch = async () => ({ ok: false });
  await f.check();
  f.context.fetch = async () => ({ ok: true, json: async () => ({ codeCommit: 'bad-revision' }) });
  await f.check(); assert.equal(f.calls.reload, 0);
  f.context.fetch = async () => ({ ok: true, json: async () => ({ codeCommit: 'b'.repeat(40) }) });
  await f.check(); assert.equal(f.calls.reload, 1);
});
