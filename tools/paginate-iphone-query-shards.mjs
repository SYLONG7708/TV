#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_QUERY_PAGE_JSON_BYTES, MAX_QUERY_PAGE_GZIP_BYTES,
  bucketName, readGzipJson, writeQueryBucket,
} from './iphone-query-shards.mjs';

// Repack a completed snapshot without re-reading millions of source records.
// Small buckets stay byte-for-byte unchanged. All large buckets retain signals.
const root = path.resolve(process.argv[2] || 'docs/data/vod-query');
const manifestFile = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.version !== 3) throw new Error('Only verified v3 inputs can be repaginated.');
let splitBuckets = 0;
for (const [scope, info] of Object.entries(manifest.scopes)) {
  for (const bucket of info.buckets) {
    const stats = info.bucketStats[String(bucket)];
    if (stats.pages) continue;
    const file = path.join(root, scope, bucketName(bucket, manifest.bucketCount));
    const gzip = fs.readFileSync(file);
    const jsonBytes = gzip.readUInt32LE(gzip.length - 4);
    if (gzip.length <= MAX_QUERY_PAGE_GZIP_BYTES && jsonBytes <= MAX_QUERY_PAGE_JSON_BYTES) {
      stats.maxGzipBytes = gzip.length;
      stats.pages = [{ part: 0, groups: stats.groups, signals: stats.signals, gzipBytes: gzip.length, jsonBytes }];
      continue;
    }
    const payload = readGzipJson(file);
    const next = writeQueryBucket(file, payload);
    if (next.signals !== stats.signals) throw new Error(`Signal loss: ${scope}/${bucket}`);
    info.bucketStats[String(bucket)] = next;
    splitBuckets++;
    console.log(JSON.stringify({ scope, bucket, pages: next.pages.length, oldGzipBytes: gzip.length, maxGzipBytes: next.maxGzipBytes }));
  }
  const stats = Object.values(info.bucketStats);
  info.groups = stats.reduce((n, row) => n + row.groups, 0);
  info.signals = stats.reduce((n, row) => n + row.signals, 0);
  info.gzipBytes = stats.reduce((n, row) => n + row.gzipBytes, 0);
  info.maxGzipBytes = Math.max(...stats.map((row) => row.maxGzipBytes));
}
manifest.pageBudgets = { jsonBytes: MAX_QUERY_PAGE_JSON_BYTES, gzipBytes: MAX_QUERY_PAGE_GZIP_BYTES };
manifest.paginatedAt = new Date().toISOString();
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, splitBuckets, files: Object.values(manifest.scopes).reduce((n, info) => n + Object.values(info.bucketStats).reduce((m, row) => m + row.pages.length, 0), 0) }));
