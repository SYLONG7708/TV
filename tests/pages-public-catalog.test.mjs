import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';

const execFileAsync = promisify(execFile);
const gzip = promisify(gzipCallback);
const script = path.resolve(import.meta.dirname, '..', 'tools', 'build-pages-public-catalog.mjs');

function makeCatalog({ guarded = false } = {}) {
  const source = {
    id: 'alpha',
    name: 'Alpha',
    api: 'https://alpha.example/api.php/provide/vod/',
    indexed: true,
    complete: true,
    itemCount: 1_000,
    playableCount: 990,
    sourceTotalCount: 1_100,
    indexPath: 'vod-index/alpha.json.gz',
    detailPathPattern: 'vod-detail/alpha/page-{page}.json.gz',
  };
  if (guarded) source.coverageGuard = { status: 'preserved-baseline' };
  return {
    generatedAt: '2026-07-10T00:00:00.000Z',
    source: {},
    totals: {
      sources: 1,
      indexedSources: 1,
      items: 1_000,
      playableItems: 990,
      movies: 1_000,
      series: 0,
      variety: 0,
      anime: 0,
      short: 0,
      adult: 0,
      other: 0,
    },
    filters: { years: [], areas: [], genres: [] },
    sources: [source],
    items: [],
  };
}

async function runFixture({ guarded }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-pages-catalog-'));
  const tvRoot = path.join(root, 'tv');
  const pagesRoot = path.join(root, 'pages');
  const tvData = path.join(tvRoot, 'docs', 'data');
  const pagesData = path.join(pagesRoot, 'docs', 'data');
  await fs.mkdir(path.join(tvData, 'vod-index'), { recursive: true });
  await fs.mkdir(pagesData, { recursive: true });

  const current = makeCatalog({ guarded });
  const previous = makeCatalog();
  await fs.writeFile(path.join(tvData, 'iphone-vod-catalog.json'), `${JSON.stringify(current)}\n`);
  await fs.writeFile(path.join(pagesData, 'iphone-vod-catalog.json'), `${JSON.stringify(previous)}\n`);
  if (guarded) {
    await fs.mkdir(path.join(pagesData, 'vod-index'), { recursive: true });
    const previousItems = Array.from({ length: 1_000 }, (_, index) => ({
      id: `alpha-${index}`,
      sourceId: 'alpha',
      vodId: String(index),
      title: `Previous ${index}`,
      playable: true,
      kind: 'movie',
    }));
    await fs.writeFile(
      path.join(pagesData, 'vod-index', 'alpha.json.gz'),
      await gzip(JSON.stringify({ sourceId: 'alpha', itemCount: previousItems.length, items: previousItems })),
    );
  }
  const partialItems = Array.from({ length: 10 }, (_, index) => ({
    id: `alpha-${index}`,
    sourceId: 'alpha',
    vodId: String(index),
    title: `Item ${index}`,
    playable: true,
    kind: 'movie',
  }));
  await fs.writeFile(
    path.join(tvData, 'vod-index', 'alpha.json.gz'),
    await gzip(JSON.stringify({ sourceId: 'alpha', itemCount: partialItems.length, items: partialItems })),
  );

  await execFileAsync(
    process.execPath,
    [
      script,
      '--tvRoot',
      tvRoot,
      '--pagesRoot',
      pagesRoot,
      '--catalog',
      path.join(tvData, 'iphone-vod-catalog.json'),
      '--smallCatalog',
      path.join(pagesData, 'iphone-vod-catalog.json'),
      '--output',
      path.join(pagesData, 'iphone-vod-catalog.json'),
      '--reportOutput',
      path.join(pagesData, 'iphone-vod-catalog-report.json'),
      '--preservePreviousPublicSources',
      'true',
      '--trustPreviousPublicSources',
      'true',
      '--minExpectedItems',
      '0',
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const output = JSON.parse(await fs.readFile(path.join(pagesData, 'iphone-vod-catalog.json'), 'utf8'));
  const report = JSON.parse(await fs.readFile(path.join(pagesData, 'iphone-vod-catalog-report.json'), 'utf8'));
  await fs.rm(root, { recursive: true, force: true });
  return { output, report };
}

test('does not copy a partial index when the coverage guard preserved the complete source', async () => {
  const { output, report } = await runFixture({ guarded: true });
  assert.equal(output.totals.items, 1_000);
  assert.equal(output.totals.playableItems, 1_000);
  assert.equal(output.sources[0].indexCoverageStatus, 'merged-incremental-index');
  assert.equal(report.publicationGuard.protectedPartialIndexes, 0);
  assert.equal(report.publishedIndexedData.preservedIndexFiles, 1);
  assert.equal(report.publishedIndexedData.mergedIndexFiles, 1);
});

test('detects a partial local index before it can lower public catalog totals', async () => {
  const { output, report } = await runFixture({ guarded: false });
  assert.equal(output.totals.items, 1_000);
  assert.equal(output.sources[0].publishedIndexItemCount, 10);
  assert.equal(output.sources[0].indexCoverageStatus, 'protected-partial-index');
  assert.equal(report.publicationGuard.protectedPartialIndexes, 1);
});
