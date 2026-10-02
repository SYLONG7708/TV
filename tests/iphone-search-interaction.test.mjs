import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('blurring an unchanged search preserves result IDs for the following card click', () => {
  const html = fs.readFileSync(new URL('../docs/iphone/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function scheduleSearchRender(');
  const end = html.indexOf('\n      function bindToolbar', start);
  assert.ok(start > 0 && end > start);
  const state = { query: '我的', refocusSearch: true };
  const context = { state, cancelActiveSearch() { assert.fail('Unchanged blur must not cancel the current results'); } };
  vm.runInNewContext(`${html.slice(start, end)}\nscheduleSearchRender('我的', 0);`, context);
  assert.equal(state.query, '我的');
});
