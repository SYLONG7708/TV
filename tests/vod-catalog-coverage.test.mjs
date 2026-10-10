import assert from 'node:assert/strict';
import test from 'node:test';

import { guardCatalogCoverage } from '../tools/guard-vod-catalog-coverage.mjs';

function catalog(sources, totals = {}) {
  return {
    generatedAt: '2026-07-10T00:00:00.000Z',
    totals: {
      sources: sources.length,
      indexedSources: sources.length,
      items: sources.reduce((sum, source) => sum + Number(source.itemCount || 0), 0),
      playableItems: sources.reduce((sum, source) => sum + Number(source.playableCount || 0), 0),
      movies: 0,
      series: 0,
      variety: 0,
      anime: 0,
      short: 0,
      adult: 0,
      other: 0,
      ...totals,
    },
    filters: { years: [], areas: [], genres: [] },
    sources,
    items: [],
  };
}

function source(id, itemCount, playableCount = itemCount) {
  return {
    id,
    name: id,
    api: `https://${id}.example/api.php/provide/vod/`,
    indexed: true,
    complete: true,
    itemCount,
    playableCount,
    sourceTotalCount: itemCount,
    indexPath: `vod-index/${id}.json.gz`,
    detailPathPattern: `vod-detail/${id}/page-{page}.json.gz`,
  };
}

test('preserves a complete baseline when a refresh only contains leading pages', () => {
  const baseline = catalog([source('alpha', 1_000, 990), source('beta', 500, 480)], {
    movies: 1_000,
    series: 500,
  });
  const current = catalog([source('alpha', 100, 98)]);
  const result = guardCatalogCoverage({ catalog: current, baseline, minTotalItems: 0 });

  assert.equal(result.catalog.totals.items, 1_500);
  assert.equal(result.catalog.totals.playableItems, 1_470);
  assert.equal(result.catalog.sources.length, 2);
  assert.equal(result.catalog.sources[0].coverageGuard.status, 'preserved-baseline');
  assert.equal(result.catalog.sources[0].complete, false);
  assert.equal(result.catalog.sources[1].coverageGuard.status, 'preserved-missing-source');
  assert.equal(result.report.status, 'protected');
});

test('keeps the real observed count across consecutive baseline guards', () => {
  const baseline = catalog([source('alpha', 1_000, 990)]);
  const partial = catalog([source('alpha', 100, 98)]);
  const first = guardCatalogCoverage({ catalog: partial, baseline, minTotalItems: 0 });
  const second = guardCatalogCoverage({ catalog: first.catalog, baseline, minTotalItems: 0 });

  assert.equal(second.catalog.sources[0].itemCount, 1_000);
  assert.equal(second.catalog.sources[0].coverageGuard.status, 'preserved-baseline');
  assert.equal(second.catalog.sources[0].coverageGuard.observedItemCount, 100);
  assert.equal(second.catalog.sources[0].coverageGuard.servingBaseline, true);
});

test('keeps a healthy growing catalog without lowering it to the baseline', () => {
  const baseline = catalog([source('alpha', 1_000, 990)]);
  const current = catalog([source('alpha', 1_200, 1_180)]);
  const result = guardCatalogCoverage({ catalog: current, baseline, minTotalItems: 0 });

  assert.equal(result.catalog.totals.items, 1_200);
  assert.equal(result.catalog.sources[0].coverageGuard.status, 'current');
  assert.equal(result.report.status, 'healthy');
});

test('matches a renamed source by normalized API URL', () => {
  const baselineSource = source('old-id', 2_000, 1_990);
  const currentSource = { ...source('new-id', 100, 100), api: `${baselineSource.api}?ignored=1` };
  currentSource.api = baselineSource.api.toUpperCase();
  const result = guardCatalogCoverage({
    catalog: catalog([currentSource]),
    baseline: catalog([baselineSource]),
    minTotalItems: 0,
  });

  assert.equal(result.catalog.sources[0].itemCount, 2_000);
  assert.equal(result.catalog.sources[0].coverageGuard.status, 'preserved-baseline');
});

test('fails closed when neither current nor baseline meets the absolute floor', () => {
  assert.throws(
    () =>
      guardCatalogCoverage({
        catalog: catalog([]),
        baseline: catalog([]),
        minTotalItems: 1_000,
      }),
    /coverage guard failed/i,
  );
});
