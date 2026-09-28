import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeedPayload, selectSeedSource } from '../tools/build-iphone-series-seeds.mjs';

test('series seeds use a complete normal source and retain newest Korean dramas', () => {
  const source = {
    id: 'complete', name: 'Complete', indexed: true, adult: false, itemCount: 9000,
    indexPath: 'vod-index/complete.json.gz', categories: [{ name: '韩剧' }],
  };
  const catalog = {
    sources: [
      { ...source, id: 'tiny', itemCount: 100, indexPath: 'vod-index/tiny.json.gz' },
      { ...source, id: 'adult', itemCount: 10000, adult: true },
      source,
    ],
  };
  assert.equal(selectSeedSource(catalog)?.id, 'complete');
  const index = { items: [
    { id: 'old', title: 'Old', sourceId: 'complete', kind: 'series', categoryName: '韩剧', updatedAt: '2025-01-01' },
    { id: 'new', title: 'New', sourceId: 'complete', kind: 'series', categoryName: '韩剧', updatedAt: '2026-09-28' },
    { id: 'adult', title: 'Adult', sourceId: 'complete', kind: 'series', categoryName: '韩剧', adult: true },
    { id: 'movie', title: 'Movie', sourceId: 'complete', kind: 'movie', categoryName: '韩剧' },
  ] };
  const payload = buildSeedPayload(source, index, 1);
  assert.equal(payload.itemCount, 1);
  assert.equal(payload.items[0].id, 'new');
  assert.equal(payload.categories['韩剧'], 1);
});
