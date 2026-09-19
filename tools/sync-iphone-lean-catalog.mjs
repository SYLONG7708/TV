#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(argValue('--repoRoot', process.cwd()));
const pagesRoot = path.resolve(argValue('--pagesRoot', repoRoot));
const sourceCatalogPath = path.resolve(repoRoot, argValue('--sourceCatalog', 'docs/data/tvbox-vod-catalog.json'));
const iphoneCatalogPath = path.resolve(pagesRoot, argValue('--iphoneCatalog', 'docs/data/iphone-vod-catalog.json'));
const pagesTvboxCatalogPath = path.resolve(pagesRoot, argValue('--pagesTvboxCatalog', 'docs/data/tvbox-vod-catalog.json'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const sourceCatalog = readJson(sourceCatalogPath);
const pathById = new Map((sourceCatalog.sources || []).map((source) => [source.id, source.searchIndexPath || '']));
const syncGeneratedAt = sourceCatalog.generatedAt || new Date().toISOString();

function existingLeanSearchPath(source, targetPath) {
  if (!source?.indexPath) return '';
  const outputPath = `vod-search/${path.basename(source.indexPath)}`;
  const dataRoot = path.dirname(targetPath);
  return fs.existsSync(path.join(dataRoot, outputPath)) ? outputPath : '';
}

for (const targetPath of [iphoneCatalogPath, pagesTvboxCatalogPath]) {
  if (!fs.existsSync(targetPath)) continue;
  const isIphoneCatalog = targetPath === iphoneCatalogPath;
  const target = readJson(targetPath);
  let changed = 0;
  for (const source of target.sources || []) {
    const searchIndexPath = pathById.get(source.id) || existingLeanSearchPath(source, targetPath) || source.searchIndexPath || '';
    if (searchIndexPath && source.searchIndexPath !== searchIndexPath) {
      source.searchIndexPath = searchIndexPath;
      changed += 1;
    }
  }
  const nextTotals = isIphoneCatalog ? { ...(target.totals || {}) } : { ...(target.totals || {}), ...(sourceCatalog.totals || {}) };
  if (isIphoneCatalog) {
    nextTotals.sources = (target.sources || []).length;
    nextTotals.indexedSources = (target.sources || []).filter((source) => source.indexed).length;
  }
  if (!isIphoneCatalog || !target.generatedAt) target.generatedAt = syncGeneratedAt;
  target.totals = nextTotals;
  if (!isIphoneCatalog && sourceCatalog.filters) target.filters = sourceCatalog.filters;
  target.source = target.source || {};
  target.source.searchIndexRoot = 'docs/data/vod-search';
  target.source.searchIndexMode = isIphoneCatalog ? 'pages-lean-search-gzip' : 'raw-main-lean-gzip';
  target.source.dataGeneratedAt = isIphoneCatalog ? target.source.dataGeneratedAt || target.generatedAt || syncGeneratedAt : syncGeneratedAt;
  target.source.searchIndexSyncedAt = new Date().toISOString();
  writeJson(targetPath, target);
  console.log(`${path.relative(process.cwd(), targetPath)}: ${changed} search paths synced`);
}
