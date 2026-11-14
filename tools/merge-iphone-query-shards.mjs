#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_MAX_SIGNALS_PER_TITLE,
  bucketForPrefix,
  bucketName,
  createQueryNormalizer,
  leanQueryItem,
  mergeItemsIntoGroups,
  queryPrefixesForItem,
  readGzipJson,
  writeGzipJson,
} from './iphone-query-shards.mjs';

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(argValue('--repoRoot', process.cwd()));
const catalogPath = path.resolve(repoRoot, argValue('--catalog', 'docs/data/iphone-vod-catalog.json'));
const latestPath = path.resolve(repoRoot, argValue('--latest', 'docs/data/iphone-vod-latest.json'));
const outputRoot = path.resolve(repoRoot, argValue('--outputRoot', 'docs/data/vod-query'));
const manifestPath = path.resolve(outputRoot, 'manifest.json');
const iphoneHtmlPath = path.resolve(repoRoot, argValue('--iphoneHtml', 'docs/iphone/index.html'));
const aliasPath = path.resolve(repoRoot, argValue('--titleAliases', 'sources/title-aliases.json'));

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Query shard manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
const sourceById = new Map((catalog.sources || []).map((source) => [source.id, source]));
const normalizer = createQueryNormalizer(iphoneHtmlPath);
const bucketCount = Number(manifest.bucketCount);
const minQueryLength = Number(manifest.minQueryLength);
const requestedMaxSignals = Number(
  argValue('--maxSignalsPerTitle', manifest.maxSignalsPerTitle ?? DEFAULT_MAX_SIGNALS_PER_TITLE),
);
const maxSignalsPerTitle = Number.isFinite(requestedMaxSignals)
  ? Math.max(0, Math.floor(requestedMaxSignals))
  : DEFAULT_MAX_SIGNALS_PER_TITLE;
const byTarget = new Map();
let changedBuckets = 0;
if (fs.existsSync(aliasPath)) {
  const titleAliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
  if (!Array.isArray(titleAliases.groups)) throw new Error(`Invalid title alias registry: ${aliasPath}`);
  manifest.titleAliases = titleAliases.groups;
}
manifest.maxSignalsPerTitle = maxSignalsPerTitle;

for (const rawItem of latest.items || []) {
  const source = sourceById.get(rawItem?.sourceId) || {};
  const item = leanQueryItem(rawItem, source);
  if (!item.id || !item.title || !item.detailPath || !item.playable || item.episodeCount < 1) continue;
  const scope = item.adult ? 'adult' : 'normal';
  const buckets = new Set(
    queryPrefixesForItem(item, normalizer, minQueryLength).map((prefix) =>
      bucketForPrefix(prefix, bucketCount),
    ),
  );
  for (const bucket of buckets) {
    const key = `${scope}\u001f${bucket}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(item);
  }
}

for (const [key, items] of byTarget) {
  const [scope, bucketText] = key.split('\u001f');
  const bucket = Number(bucketText);
  const file = path.join(outputRoot, scope, bucketName(bucket, bucketCount));
  const current = fs.existsSync(file) ? readGzipJson(file) : { groups: [] };
  const groups = mergeItemsIntoGroups(current.groups || [], items, {
    normalizer,
    maxSignalsPerTitle,
  });
  const signals = groups.reduce((sum, group) => sum + group.signals.length, 0);
  const changed = JSON.stringify(current.groups || []) !== JSON.stringify(groups);
  const gzipBytes = changed
    ? writeGzipJson(file, {
        version: manifest.version,
        generatedAt: new Date().toISOString(),
        scope,
        bucket,
        groups,
      })
    : fs.statSync(file).size;
  if (changed) changedBuckets += 1;
  const scopeManifest = manifest.scopes[scope];
  if (!scopeManifest.buckets.includes(bucket)) scopeManifest.buckets.push(bucket);
  scopeManifest.bucketStats[String(bucket)] = { groups: groups.length, signals, gzipBytes };
}

for (const scope of ['normal', 'adult']) {
  const scopeManifest = manifest.scopes[scope];
  const stats = Object.values(scopeManifest.bucketStats || {});
  scopeManifest.buckets.sort((left, right) => left - right);
  scopeManifest.groups = stats.reduce((sum, row) => sum + Number(row.groups || 0), 0);
  scopeManifest.signals = stats.reduce((sum, row) => sum + Number(row.signals || 0), 0);
  scopeManifest.gzipBytes = stats.reduce((sum, row) => sum + Number(row.gzipBytes || 0), 0);
  scopeManifest.maxGzipBytes = stats.reduce(
    (max, row) => Math.max(max, Number(row.gzipBytes || 0)),
    0,
  );
}

manifest.updatedAt = new Date().toISOString();
manifest.incrementalItems = (latest.items || []).length;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    visitedBuckets: byTarget.size,
    changedBuckets,
    incrementalItems: manifest.incrementalItems,
    normal: manifest.scopes.normal,
    adult: manifest.scopes.adult,
  }),
);
