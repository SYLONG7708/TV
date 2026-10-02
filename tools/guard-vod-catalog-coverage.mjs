import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const KIND_FIELDS = ['movies', 'series', 'variety', 'anime', 'short', 'adult', 'other'];
const SOURCE_PATH_FIELDS = [
  'detailMode',
  'detailPathPattern',
  'indexMode',
  'indexPath',
  'searchIndexPath',
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function text(value) {
  return String(value ?? '').trim();
}

function normalizeApi(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/g, '');
  } catch {
    return raw.replace(/\/+$/g, '');
  }
}

function detailSlug(source) {
  return text(source?.detailPathPattern).match(/vod-detail\/([^/]+)\/page-\{page\}\.json\.gz/i)?.[1] || '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceMaps(sources = []) {
  const byId = new Map();
  const byApi = new Map();
  const bySlug = new Map();
  for (const source of sources) {
    if (source?.id && !byId.has(source.id)) byId.set(source.id, source);
    const api = normalizeApi(source?.api);
    if (api && !byApi.has(api)) byApi.set(api, source);
    const slug = detailSlug(source);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, source);
  }
  return { byId, byApi, bySlug };
}

function findSource(source, maps) {
  return (
    maps.byId.get(source?.id) ||
    maps.byApi.get(normalizeApi(source?.api)) ||
    maps.bySlug.get(detailSlug(source)) ||
    null
  );
}

function sourceTotals(sources = []) {
  return {
    sources: sources.length,
    indexedSources: sources.filter((source) => source?.indexed).length,
    items: sources.reduce((sum, source) => sum + number(source?.itemCount), 0),
    playableItems: sources.reduce((sum, source) => sum + number(source?.playableCount), 0),
  };
}

function mergeFilters(current = {}, baseline = {}) {
  const limits = { years: 36, areas: 40, genres: 80 };
  const next = { ...baseline, ...current };
  for (const key of Object.keys(limits)) {
    next[key] = [...new Set([...(current?.[key] || []), ...(baseline?.[key] || [])].filter(Boolean))].slice(
      0,
      limits[key],
    );
  }
  return next;
}

function kindTotalsForFinal(currentCatalog, baselineCatalog, usedBaseline, finalItems) {
  const preferred = usedBaseline ? baselineCatalog?.totals : currentCatalog?.totals;
  const alternate = usedBaseline ? currentCatalog?.totals : baselineCatalog?.totals;
  const selected = preferred || alternate || {};
  const result = {};
  for (const key of KIND_FIELDS) result[key] = number(selected[key]);
  const classified = KIND_FIELDS.reduce((sum, key) => sum + result[key], 0);
  if (classified < finalItems) result.other += finalItems - classified;
  return result;
}

function sourceCheck(source) {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    api: source.api,
    origin: source.origin,
    adult: source.adult,
    indexed: source.indexed,
    complete: source.complete,
    itemCount: source.itemCount,
    playableCount: source.playableCount,
    sourceTotalCount: source.sourceTotalCount,
    detailPageCount: source.detailPageCount,
    detailExpectedPages: source.detailExpectedPages,
    indexPath: source.indexPath,
    searchIndexPath: source.searchIndexPath,
    detailPathPattern: source.detailPathPattern,
    coverageGuard: source.coverageGuard,
    error: source.error,
  };
}

export function guardCatalogCoverage({
  catalog,
  baseline,
  minSourceRetention = 0.9,
  minGlobalRetention = 0.95,
  minTotalItems = 1_000_000,
  preserveMissingSources = true,
  now = new Date().toISOString(),
}) {
  if (!catalog || !Array.isArray(catalog.sources)) throw new Error('Current catalog has no sources array.');
  if (!baseline || !Array.isArray(baseline.sources)) throw new Error('Baseline catalog has no sources array.');
  if (!(minSourceRetention > 0 && minSourceRetention <= 1)) throw new Error('minSourceRetention must be in (0, 1].');
  if (!(minGlobalRetention > 0 && minGlobalRetention <= 1)) throw new Error('minGlobalRetention must be in (0, 1].');

  const current = clone(catalog);
  const reference = clone(baseline);
  const baselineMaps = sourceMaps(reference.sources);
  const matchedBaselineIds = new Set();
  const preserved = [];
  const healthy = [];
  const sources = [];

  for (const source of current.sources) {
    const baselineSource = findSource(source, baselineMaps);
    if (baselineSource?.id) matchedBaselineIds.add(baselineSource.id);
    const priorGuard = source?.coverageGuard || {};
    const priorPreserved = /^preserved-/i.test(text(priorGuard.status));
    const observedItemCount = priorPreserved
      ? number(priorGuard.observedItemCount, number(source.itemCount))
      : number(source.itemCount);
    const observedPlayableCount = priorPreserved
      ? number(priorGuard.observedPlayableCount, number(source.playableCount))
      : number(source.playableCount);
    const baselineItemCount = number(baselineSource?.itemCount);
    const baselinePlayableCount = number(baselineSource?.playableCount);
    const retention = baselineItemCount > 0 ? observedItemCount / baselineItemCount : 1;
    const shouldPreserve = Boolean(
      baselineSource && baselineItemCount > 0 && (priorPreserved || retention < minSourceRetention),
    );
    const next = { ...(baselineSource || {}), ...source };

    if (shouldPreserve) {
      next.itemCount = baselineItemCount;
      next.playableCount = Math.max(observedPlayableCount, baselinePlayableCount);
      next.sourceTotalCount = Math.max(number(source.sourceTotalCount), number(baselineSource.sourceTotalCount));
      next.detailPageCount = Math.max(number(source.detailPageCount), number(baselineSource.detailPageCount));
      next.detailExpectedPages = Math.max(
        number(source.detailExpectedPages),
        number(baselineSource.detailExpectedPages),
      );
      next.indexed = Boolean(source.indexed || baselineSource.indexed);
      // The last complete snapshot remains served, but the current refresh is
      // partial. Do not report the refresh itself as complete.
      next.complete = false;
      for (const key of SOURCE_PATH_FIELDS) next[key] = source[key] || baselineSource[key] || '';
      next.coverageGuard = {
        status: 'preserved-baseline',
        checkedAt: now,
        observedItemCount,
        observedPlayableCount,
        baselineItemCount,
        baselinePlayableCount,
        retention,
        servingBaseline: true,
      };
      preserved.push({ id: next.id, name: next.name, observedItemCount, baselineItemCount, retention });
    } else {
      next.coverageGuard = {
        status: 'current',
        checkedAt: now,
        observedItemCount,
        observedPlayableCount,
        baselineItemCount,
        baselinePlayableCount,
        retention,
      };
      healthy.push({ id: next.id, name: next.name, observedItemCount, baselineItemCount, retention });
    }
    sources.push(next);
  }

  const missing = [];
  if (preserveMissingSources) {
    const currentIds = new Set(sources.map((source) => source.id));
    for (const baselineSource of reference.sources) {
      if (matchedBaselineIds.has(baselineSource.id) || currentIds.has(baselineSource.id)) continue;
      const next = {
        ...baselineSource,
        coverageGuard: {
          status: 'preserved-missing-source',
          checkedAt: now,
          observedItemCount: 0,
          observedPlayableCount: 0,
          baselineItemCount: number(baselineSource.itemCount),
          baselinePlayableCount: number(baselineSource.playableCount),
          retention: 0,
        },
      };
      sources.push(next);
      currentIds.add(next.id);
      missing.push({ id: next.id, name: next.name, baselineItemCount: number(next.itemCount) });
    }
  }

  const observedTotals = sourceTotals(current.sources);
  const baselineTotals = sourceTotals(reference.sources);
  const finalTotals = sourceTotals(sources);
  const referenceItems = Math.max(baselineTotals.items, number(reference.totals?.items));
  const requiredFromBaseline = referenceItems * minGlobalRetention;
  const requiredItems = Math.max(number(minTotalItems), requiredFromBaseline);
  if (finalTotals.items < requiredItems) {
    throw new Error(
      `Catalog coverage guard failed: final ${finalTotals.items} items, required at least ${Math.ceil(requiredItems)} ` +
        `(baseline ${referenceItems}, retention ${minGlobalRetention}).`,
    );
  }

  const usedBaseline = preserved.length > 0 || missing.length > 0;
  const nextCatalog = {
    ...current,
    generatedAt: current.generatedAt || now,
    source: {
      ...(current.source || {}),
      coverageGuard: {
        status: usedBaseline ? 'protected' : 'healthy',
        checkedAt: now,
        baselineGeneratedAt: reference.generatedAt || '',
        minSourceRetention,
        minGlobalRetention,
        minTotalItems: number(minTotalItems),
        preservedSources: preserved.length,
        preservedMissingSources: missing.length,
      },
    },
    totals: {
      ...(current.totals || {}),
      ...finalTotals,
      ...kindTotalsForFinal(current, reference, usedBaseline, finalTotals.items),
    },
    filters: usedBaseline ? mergeFilters(current.filters, reference.filters) : current.filters,
    sources,
  };

  const report = {
    status: usedBaseline ? 'protected' : 'healthy',
    checkedAt: now,
    baselineGeneratedAt: reference.generatedAt || '',
    thresholds: {
      minSourceRetention,
      minGlobalRetention,
      minTotalItems: number(minTotalItems),
    },
    observedTotals,
    baselineTotals: { ...baselineTotals, declaredItems: number(reference.totals?.items) },
    finalTotals,
    preservedSources: preserved,
    preservedMissingSources: missing,
    healthySources: healthy.length,
  };

  return { catalog: nextCatalog, report };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value)}\n`, 'utf8');
  await fs.rename(temp, file);
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key.startsWith('--')) continue;
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
  return args;
}

async function readBaseline(args, tvRoot, catalogPath) {
  const baselinePath = args.get('baseline');
  if (baselinePath) return readJson(path.resolve(baselinePath));
  const baselineGitRef = text(args.get('baselineGitRef'));
  if (!baselineGitRef) throw new Error('Provide --baseline or --baselineGitRef.');
  if (!/^[A-Za-z0-9._/-]+$/.test(baselineGitRef)) throw new Error('Invalid --baselineGitRef.');
  const relativeCatalog = path.relative(tvRoot, catalogPath).replace(/\\/g, '/');
  if (relativeCatalog.startsWith('../')) throw new Error('Catalog must be inside tvRoot when using --baselineGitRef.');
  const { stdout } = await execFileAsync('git', ['show', `${baselineGitRef}:${relativeCatalog}`], {
    cwd: tvRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const tvRoot = path.resolve(args.get('tvRoot') || path.resolve(import.meta.dirname, '..'));
  const catalogPath = path.resolve(args.get('catalog') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog.json'));
  const reportPath = path.resolve(
    args.get('report') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog-report.json'),
  );
  const catalog = await readJson(catalogPath);
  const baseline = await readBaseline(args, tvRoot, catalogPath);
  const result = guardCatalogCoverage({
    catalog,
    baseline,
    minSourceRetention: number(args.get('minSourceRetention'), 0.9),
    minGlobalRetention: number(args.get('minGlobalRetention'), 0.95),
    minTotalItems: number(args.get('minTotalItems'), 1_000_000),
    preserveMissingSources: args.get('preserveMissingSources') !== 'false',
  });

  const existingReport = await readJson(reportPath).catch(() => ({}));
  const nextReport = {
    ...existingReport,
    generatedAt: result.catalog.generatedAt,
    totals: result.catalog.totals,
    coverageGuard: result.report,
    sourceChecks: result.catalog.sources.map(sourceCheck),
  };
  await writeJsonAtomic(catalogPath, result.catalog);
  await writeJsonAtomic(reportPath, nextReport);
  console.log(JSON.stringify({ catalogPath, reportPath, coverageGuard: result.report }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await main();
}
