import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import test from 'node:test';
import { buildIphoneSeriesSeeds, buildSeedPayload, selectSeedSource } from '../tools/build-iphone-series-seeds.mjs';

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

test('daily refresh preserves published category seeds when an index is temporarily missing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oktv-series-seeds-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const catalogPath = path.join(root, 'catalog.json');
  const output = path.join(root, 'category-seeds.json');
  const source = {
    id: 'complete', name: 'Complete', indexed: true, adult: false, itemCount: 9000,
    indexPath: 'vod-index/complete.json.gz', categories: [{ name: '韩剧' }],
  };
  await fs.writeFile(catalogPath, JSON.stringify({ sources: [source] }));
  await fs.writeFile(output, JSON.stringify({ sourceName: 'Previous', itemCount: 67, categories: { 韩剧: 67 }, items: [] }));
  const report = await buildIphoneSeriesSeeds({ catalogPath, dataRoot: root, output });
  assert.equal(report.preservedPrevious, true);
  assert.equal(report.items, 67);

  await fs.writeFile(catalogPath, JSON.stringify({ sources: [{ ...source, itemCount: 1000 }] }));
  const partialReport = await buildIphoneSeriesSeeds({ catalogPath, dataRoot: root, output });
  assert.equal(partialReport.preservedPrevious, true);

  await fs.mkdir(path.join(root, 'vod-index'));
  await fs.writeFile(path.join(root, source.indexPath), zlib.gzipSync(JSON.stringify({ items: [] })));
  await fs.writeFile(catalogPath, JSON.stringify({ sources: [source] }));
  const emptyIndexReport = await buildIphoneSeriesSeeds({ catalogPath, dataRoot: root, output });
  assert.equal(emptyIndexReport.preservedPrevious, true);
});
