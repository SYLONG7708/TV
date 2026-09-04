#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function boolValue(name, fallback = false) {
  const value = argValue(name, String(fallback));
  return /^(1|true|yes)$/i.test(String(value));
}

const repoRoot = path.resolve(argValue('--repoRoot', process.cwd()));
const catalogPath = path.resolve(repoRoot, argValue('--catalog', 'docs/data/tvbox-vod-catalog.json'));
const indexRoot = path.resolve(repoRoot, argValue('--indexRoot', 'docs/data/vod-index'));
const outputRoot = path.resolve(repoRoot, argValue('--outputRoot', 'docs/data/vod-search'));
const reportPath = path.resolve(repoRoot, argValue('--report', 'docs/data/vod-search-report.json'));
const updateCatalog = boolValue('--updateCatalog', true);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function outputNameFor(indexPath) {
  return path.basename(indexPath || '');
}

function leanItem(item) {
  return {
    id: item.id || '',
    sourceId: item.sourceId || '',
    sourceName: item.sourceName || '',
    vodId: item.vodId || '',
    title: item.title || '',
    originalName: item.originalName || '',
    kind: item.kind || '',
    categoryName: item.categoryName || '',
    year: item.year || '',
    area: item.area || '',
    genre: Array.isArray(item.genre) ? item.genre : [],
    remarks: item.remarks || '',
    poster: item.poster || '',
    episodeCount: Number(item.episodeCount || 0),
    playable: Boolean(item.playable),
    adult: Boolean(item.adult),
    detailPath: item.detailPath || '',
    score: Number(item.score || 0),
    hot: Number(item.hot || 0),
    updatedAt: item.updatedAt || '',
  };
}

const catalog = readJson(catalogPath);
const sources = Array.isArray(catalog.sources) ? catalog.sources : [];
const report = {
  generatedAt: new Date().toISOString(),
  input: path.relative(repoRoot, catalogPath).replaceAll(path.sep, '/'),
  outputRoot: path.relative(repoRoot, outputRoot).replaceAll(path.sep, '/'),
  sources: [],
  totals: {
    sources: 0,
    indexedSources: 0,
    items: 0,
    gzipBytes: 0,
  },
};

fs.mkdirSync(outputRoot, { recursive: true });

for (const source of sources) {
  if (!source?.indexPath) continue;
  report.totals.sources += 1;
  const inputFile = path.resolve(repoRoot, 'docs/data', source.indexPath);
  const name = outputNameFor(source.indexPath);
  const outputFile = path.join(outputRoot, name);
  const outputPath = path.relative(path.resolve(repoRoot, 'docs/data'), outputFile).replaceAll(path.sep, '/');
  const row = {
    id: source.id,
    name: source.name,
    input: source.indexPath,
    output: outputPath,
    ok: false,
    items: 0,
    gzipBytes: 0,
    error: '',
  };

  try {
    if (!fs.existsSync(inputFile)) throw new Error(`missing input index: ${source.indexPath}`);
    const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(inputFile)));
    const items = Array.isArray(payload.items) ? payload.items.map(leanItem) : [];
    const outPayload = {
      generatedAt: new Date().toISOString(),
      source: {
        id: source.id,
        name: source.name,
        api: source.api || '',
        indexPath: source.indexPath,
      },
      items,
    };
    const gzip = zlib.gzipSync(Buffer.from(JSON.stringify(outPayload)), { level: 9 });
    fs.writeFileSync(outputFile, gzip);
    source.searchIndexPath = outputPath;
    row.ok = true;
    row.items = items.length;
    row.gzipBytes = gzip.length;
    report.totals.indexedSources += 1;
    report.totals.items += items.length;
    report.totals.gzipBytes += gzip.length;
  } catch (error) {
    row.error = error?.message || String(error);
  }
  report.sources.push(row);
  console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.name || row.id}: ${row.items} items, ${row.gzipBytes} bytes`);
}

if (updateCatalog) writeJson(catalogPath, catalog);
writeJson(reportPath, report);
console.log(JSON.stringify(report.totals));
