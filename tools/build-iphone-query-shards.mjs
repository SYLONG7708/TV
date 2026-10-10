#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  DEFAULT_BUCKET_COUNT,
  DEFAULT_MAX_GROUPS_PER_PREFIX,
  DEFAULT_MAX_SIGNALS_PER_TITLE,
  DEFAULT_MIN_QUERY_LENGTH,
  QUERY_SHARD_VERSION,
  bucketForPrefix,
  bucketName,
  createQueryNormalizer,
  leanQueryItem,
  queryPrefixesForItem,
  readGzipJson,
} from './iphone-query-shards.mjs';

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(argValue('--repoRoot', process.cwd()));
const catalogPath = path.resolve(repoRoot, argValue('--catalog', 'docs/data/iphone-vod-catalog.json'));
const searchRoot = path.resolve(repoRoot, argValue('--searchRoot', 'docs/data/vod-search'));
const inputPathField = argValue('--inputPathField', 'searchIndexPath');
const aliasPath = path.resolve(repoRoot, argValue('--titleAliases', 'sources/title-aliases.json'));
const outputRoot = path.resolve(repoRoot, argValue('--outputRoot', 'docs/data/vod-query'));
const iphoneHtmlPath = path.resolve(repoRoot, argValue('--iphoneHtml', 'docs/iphone/index.html'));
const bucketCount = Math.max(16, Number(argValue('--bucketCount', DEFAULT_BUCKET_COUNT)));
const minQueryLength = Math.max(2, Number(argValue('--minQueryLength', DEFAULT_MIN_QUERY_LENGTH)));
function nonNegativeLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

const maxSignalsPerTitle = nonNegativeLimit(
  argValue('--maxSignalsPerTitle', DEFAULT_MAX_SIGNALS_PER_TITLE),
  DEFAULT_MAX_SIGNALS_PER_TITLE,
);
const maxGroupsPerPrefix = nonNegativeLimit(
  argValue('--maxGroupsPerPrefix', DEFAULT_MAX_GROUPS_PER_PREFIX),
  DEFAULT_MAX_GROUPS_PER_PREFIX,
);
const workerCount = Math.max(
  1,
  Math.min(12, Number(argValue('--workers', Math.min(8, os.availableParallelism?.() || os.cpus().length)))),
);
const flushHighWaterBytes = Math.max(8 * 1024 * 1024, Number(argValue('--flushBytes', 64 * 1024 * 1024)));

const expectedParent = path.resolve(repoRoot, 'docs', 'data');
const relativeOutput = path.relative(expectedParent, outputRoot);
if (
  !relativeOutput ||
  relativeOutput.startsWith('..') ||
  path.isAbsolute(relativeOutput) ||
  path.basename(outputRoot).toLowerCase() !== 'vod-query'
) {
  throw new Error(`Refusing to replace unexpected query output path: ${outputRoot}`);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const sources = Array.isArray(catalog.sources) ? catalog.sources : [];
const sourceById = new Map(sources.map((source) => [source.id, source]));
const normalizer = createQueryNormalizer(iphoneHtmlPath);
if (!fs.existsSync(aliasPath)) throw new Error(`Title alias registry not found: ${aliasPath}`);
const titleAliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
if (!Array.isArray(titleAliases.groups)) throw new Error(`Invalid title alias registry: ${aliasPath}`);

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
const buildRoot = path.join(outputRoot, '.build');
fs.mkdirSync(buildRoot, { recursive: true });

const buffers = new Map();
let bufferedBytes = 0;

function targetKey(scope, bucket) {
  return `${scope}\u001f${bucket}`;
}

function tempFileFor(key) {
  const [scope, bucket] = key.split('\u001f');
  return path.join(buildRoot, scope, `${bucket}.ndjson`);
}

function flushLargestBuffers(targetBytes = flushHighWaterBytes / 2) {
  const entries = [...buffers.entries()].sort((left, right) => right[1].bytes - left[1].bytes);
  for (const [key, buffer] of entries) {
    if (!buffer.chunks.length) continue;
    const file = tempFileFor(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, buffer.chunks.join(''));
    bufferedBytes -= buffer.bytes;
    buffers.delete(key);
    if (bufferedBytes <= targetBytes) break;
  }
}

function appendRow(scope, bucket, prefix, item) {
  const key = targetKey(scope, bucket);
  const line = `${JSON.stringify({ p: prefix, i: item })}\n`;
  const bytes = Buffer.byteLength(line);
  const buffer = buffers.get(key) || { chunks: [], bytes: 0 };
  buffer.chunks.push(line);
  buffer.bytes += bytes;
  buffers.set(key, buffer);
  bufferedBytes += bytes;
  if (bufferedBytes >= flushHighWaterBytes) flushLargestBuffers();
}

const inputReport = [];
const fallbackItems = [];
let totalInputItems = 0;
let totalIndexedRows = 0;

for (const source of sources) {
  const searchPath = source?.[inputPathField];
  if (!searchPath) continue;
  const file = path.resolve(repoRoot, 'docs', 'data', searchPath);
  const row = {
    id: source.id,
    name: source.name,
    file: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
    ok: false,
    items: 0,
    searchableItems: 0,
    embeddedFallbackItems: 0,
    skippedItems: 0,
    indexedRows: 0,
    error: '',
  };
  try {
    if (!file.startsWith(searchRoot + path.sep) || !fs.existsSync(file)) {
      throw new Error(`missing search index: ${searchPath}`);
    }
    const payload = readGzipJson(file);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    row.items = items.length;
    const expectedItems = Number(source?.itemCount || 0);
    if (expectedItems > 0 && items.length !== expectedItems) {
      throw new Error(`source index count mismatch: expected ${expectedItems}, got ${items.length}`);
    }
    totalInputItems += items.length;
    for (const rawItem of items) {
      const itemSource = sourceById.get(rawItem?.sourceId) || source;
      const item = leanQueryItem(rawItem, itemSource);
      if (!item.id || !item.title || !item.detailPath || !item.playable || item.episodeCount < 1) {
        row.skippedItems += 1;
        continue;
      }
      const prefixes = queryPrefixesForItem(item, normalizer, minQueryLength);
      if (!prefixes.length) {
        fallbackItems.push(item);
        row.searchableItems += 1;
        row.embeddedFallbackItems += 1;
        continue;
      }
      row.searchableItems += 1;
      const scope = item.adult ? 'adult' : 'normal';
      for (const prefix of prefixes) {
        const bucket = bucketForPrefix(prefix, bucketCount);
        appendRow(scope, bucket, prefix, item);
        row.indexedRows += 1;
        totalIndexedRows += 1;
      }
    }
    row.ok = true;
  } catch (error) {
    row.error = error?.message || String(error);
  }
  inputReport.push(row);
  console.log(
    `${row.ok ? 'OK' : 'FAIL'} ${row.name || row.id}: ${row.items} items, ${row.searchableItems} searchable, ${row.skippedItems} skipped, ${row.indexedRows} shard rows${row.error ? ` (${row.error})` : ''}`,
  );
}

flushLargestBuffers(0);

const failedInputs = inputReport.filter((row) => !row.ok);
if (failedInputs.length) {
  throw new Error(`Refusing to publish query shards: ${failedInputs.length} source index inputs failed validation.`);
}
const totalSearchableItems = inputReport.reduce((sum, row) => sum + Number(row.searchableItems || 0), 0);
const totalSkippedItems = inputReport.reduce((sum, row) => sum + Number(row.skippedItems || 0), 0);
const declaredPlayableItems = Number(catalog?.totals?.playableItems || 0);
if (declaredPlayableItems > 0 && totalSearchableItems !== declaredPlayableItems) {
  throw new Error(
    `Refusing to publish query shards: catalog declares ${declaredPlayableItems} playable items, but ${totalSearchableItems} are searchable.`,
  );
}

const manifest = {
  version: QUERY_SHARD_VERSION,
  generatedAt: new Date().toISOString(),
  algorithm: 'fnv1a-prefix-v1',
  bucketCount,
  minQueryLength,
  maxGroupsPerPrefix,
  maxSignalsPerTitle,
  normalization: {
    unicode: 'NFKC',
    case: 'lower',
    chinese: 'simplified-character-map',
    chineseMapSize: normalizer.mapSize,
  },
  titleAliases: titleAliases.groups,
  fallbackItems,
  scopes: {
    normal: {
      path: 'vod-query/normal/b-{bucket}.json.gz',
      buckets: [],
      bucketStats: {},
      groups: 0,
      signals: 0,
      gzipBytes: 0,
      maxGzipBytes: 0,
    },
    adult: {
      path: 'vod-query/adult/b-{bucket}.json.gz',
      buckets: [],
      bucketStats: {},
      groups: 0,
      signals: 0,
      gzipBytes: 0,
      maxGzipBytes: 0,
    },
  },
  inputs: {
    sources: inputReport.length,
    okSources: inputReport.filter((row) => row.ok).length,
    items: totalInputItems,
    searchableItems: totalSearchableItems,
    skippedItems: totalSkippedItems,
    playableCoverage: declaredPlayableItems > 0 ? totalSearchableItems / declaredPlayableItems : 1,
    indexedRows: totalIndexedRows,
  },
  sourceReport: inputReport,
};

const shardJobs = [];
for (const scope of ['normal', 'adult']) {
  const scopeBuildRoot = path.join(buildRoot, scope);
  if (!fs.existsSync(scopeBuildRoot)) continue;
  const bucketFiles = fs
    .readdirSync(scopeBuildRoot)
    .filter((name) => name.endsWith('.ndjson'))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  for (const name of bucketFiles) {
    const bucket = Number.parseInt(name, 10);
    shardJobs.push({
      scope,
      bucket,
      inputFile: path.join(scopeBuildRoot, name),
      outputFile: path.join(outputRoot, scope, bucketName(bucket, bucketCount)),
    });
  }
}

const jobChunks = Array.from({ length: Math.min(workerCount, shardJobs.length) }, () => []);
for (let index = 0; index < shardJobs.length; index += 1) {
  jobChunks[index % jobChunks.length].push(shardJobs[index]);
}

const workerResults = (
  await Promise.all(
    jobChunks.map(
      (jobs) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./iphone-query-shard-worker.mjs', import.meta.url), {
            workerData: {
              jobs,
              iphoneHtmlPath,
              maxGroupsPerPrefix,
              maxSignalsPerTitle,
              version: QUERY_SHARD_VERSION,
            },
          });
          worker.once('message', (message) => {
            if (message?.ok) resolve(message.results || []);
            else reject(new Error(message?.error || 'query shard worker failed'));
          });
          worker.once('error', reject);
          worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`query shard worker exited with code ${code}`));
          });
        }),
    ),
  )
).flat();

for (const result of workerResults) {
  const scopeManifest = manifest.scopes[result.scope];
  scopeManifest.buckets.push(result.bucket);
  scopeManifest.bucketStats[String(result.bucket)] = {
    groups: result.groups,
    signals: result.signals,
    gzipBytes: result.gzipBytes,
  };
  scopeManifest.groups += result.groups;
  scopeManifest.signals += result.signals;
  scopeManifest.gzipBytes += result.gzipBytes;
  scopeManifest.maxGzipBytes = Math.max(scopeManifest.maxGzipBytes, result.gzipBytes);
}
for (const scope of ['normal', 'adult']) {
  manifest.scopes[scope].buckets.sort((left, right) => left - right);
}

fs.rmSync(buildRoot, { recursive: true, force: true });
fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify({
    inputs: manifest.inputs,
    normal: manifest.scopes.normal,
    adult: manifest.scopes.adult,
    failedSources: failedInputs.length,
  }),
);
