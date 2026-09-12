import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

import {
  createQueryNormalizer,
  limitQueryGroups,
  mergeItemsIntoGroups,
  writeGzipJson,
} from './iphone-query-shards.mjs';

const normalizer = createQueryNormalizer(workerData.iphoneHtmlPath);
const results = [];

try {
  for (const job of workerData.jobs || []) {
    const lines = fs.readFileSync(job.inputFile, 'utf8').split(/\r?\n/).filter(Boolean);
    const byPrefix = new Map();
    for (const line of lines) {
      const record = JSON.parse(line);
      if (!record?.p || !record?.i) continue;
      if (!byPrefix.has(record.p)) byPrefix.set(record.p, []);
      byPrefix.get(record.p).push(record.i);
    }
    const groups = [];
    for (const items of byPrefix.values()) {
      const prefixGroups = mergeItemsIntoGroups([], items, {
        normalizer,
        maxSignalsPerTitle: workerData.maxSignalsPerTitle,
      });
      groups.push(...limitQueryGroups(prefixGroups, workerData.maxGroupsPerPrefix));
    }
    const signals = groups.reduce((sum, group) => sum + group.signals.length, 0);
    const gzipBytes = writeGzipJson(job.outputFile, {
      version: workerData.version,
      scope: job.scope,
      bucket: job.bucket,
      groups,
    });
    results.push({
      scope: job.scope,
      bucket: job.bucket,
      groups: groups.length,
      signals,
      gzipBytes,
    });
  }
  parentPort.postMessage({ ok: true, results });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error?.stack || error?.message || String(error),
  });
}
