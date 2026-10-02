import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafeStorage } from '../docs/iphone/safe-storage.mjs';
test('blocked storage keeps the current session usable', () => {
  const store = createSafeStorage(() => { throw new Error('SecurityError'); });
  assert.equal(store.getItem('source'), null);store.setItem('source','normal');
  assert.equal(store.getItem('source'),'normal');store.removeItem('source');assert.equal(store.getItem('source'),null);
});
test('quota failures fall back to memory', () => {
  const store = createSafeStorage(() => ({getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError');},removeItem:()=>{}}));
  store.setItem('source','selected');assert.equal(store.getItem('source'),'selected');
});
