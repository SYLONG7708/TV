import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { classifyVodKind, VOD_KIND_ORDER } from './vod-kind-rules.mjs';

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const tvRoot = path.resolve(args.get('tvRoot') || path.resolve(import.meta.dirname, '..'));
const catalogPath = path.resolve(args.get('catalog') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog.json'));
const reportPath = path.resolve(args.get('report') || path.join(tvRoot, 'docs', 'data', 'iphone-vod-catalog-report.json'));
const detailRoot = path.resolve(args.get('detailRoot') || path.join(tvRoot, 'docs', 'data', 'vod-detail'));
const indexRoot = path.resolve(args.get('indexRoot') || path.join(tvRoot, 'docs', 'data', 'vod-index'));
const quantumRoot = path.resolve(args.get('quantumRoot') || path.join(tvRoot, 'docs', 'data', 'quantum-lzi'));
const skipCatalog = args.get('skipCatalog') === 'true';
const skipDetail = args.get('skipDetail') === 'true';
const skipIndex = args.get('skipIndex') === 'true';
const skipQuantum = args.get('skipQuantum') === 'true';

function kindTotals() {
  return { movie: 0, series: 0, variety: 0, anime: 0, short: 0, adult: 0, other: 0 };
}

function addKind(total, kind) {
  const key = VOD_KIND_ORDER.includes(kind) ? kind : 'movie';
  total[key] = (total[key] || 0) + 1;
}

function classifyItem(item, sourceAdult = false) {
  return classifyVodKind({
    categoryName: item.categoryName || item.typeName || item.type_name || '',
    genre: item.genre || item.vod_class || item.class || '',
    title: item.title || item.vod_name || '',
    adult: item.adult || sourceAdult,
  });
}

function applyItemKind(item, sourceAdult = false) {
  if (!item || typeof item !== 'object') return false;
  const nextKind = classifyItem(item, sourceAdult);
  if (item.kind === nextKind) return false;
  item.kind = nextKind;
  return true;
}

function applySourceCategoryKinds(source) {
  let changed = 0;
  const categories = source?.categories || [];
  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    if (typeof category === 'string') {
      const nextKind = classifyVodKind({ categoryName: category, sourceAdult: source.adult });
      categories[index] = { id: category, name: category, kind: nextKind };
      changed += 1;
      continue;
    }
    if (!category || typeof category !== 'object') continue;
    const nextKind = classifyVodKind({ categoryName: category.name || category.type_name || category.kind || '', sourceAdult: source.adult });
    if (category.kind !== nextKind) {
      category.kind = nextKind;
      changed += 1;
    }
  }
  return changed;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readGzipJson(file) {
  return JSON.parse((await gunzip(await fs.readFile(file))).toString('utf8'));
}

async function writeGzipJson(file, value) {
  await fs.writeFile(file, await gzip(`${JSON.stringify(value)}\n`));
}

async function listFiles(root, predicate) {
  const files = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!predicate || predicate(file)) files.push(file);
    }
  }
  await walk(root);
  return files;
}

async function mapLimit(items, limit, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function mergeTotals(target, totals) {
  target.movies = totals.movie || 0;
  target.series = totals.series || 0;
  target.variety = totals.variety || 0;
  target.anime = totals.anime || 0;
  target.short = totals.short || 0;
  target.adult = totals.adult || 0;
  target.other = totals.other || 0;
}

async function updateCatalog() {
  const catalog = await readJson(catalogPath);
  let itemChanges = 0;
  let categoryChanges = 0;
  for (const source of catalog.sources || []) categoryChanges += applySourceCategoryKinds(source);
  for (const item of catalog.items || []) if (applyItemKind(item)) itemChanges += 1;
  await writeJson(catalogPath, catalog);
  return { itemChanges, categoryChanges };
}

async function updateGzipItems(root, label) {
  const files = await listFiles(root, (file) => file.endsWith('.json.gz'));
  const totals = kindTotals();
  let itemChanges = 0;
  let changedFiles = 0;
  await mapLimit(files, 8, async (file, index) => {
    const payload = await readGzipJson(file);
    let changed = false;
    for (const item of payload.items || []) {
      if (applyItemKind(item)) {
        changed = true;
        itemChanges += 1;
      }
      addKind(totals, item.kind);
    }
    if (changed) {
      changedFiles += 1;
      await writeGzipJson(file, payload);
    }
    if ((index + 1) % 1000 === 0 || index + 1 === files.length) {
      console.log(JSON.stringify({ label, processed: index + 1, files: files.length, changedFiles, itemChanges }));
    }
  });
  return { files: files.length, changedFiles, itemChanges, totals };
}

async function updateReportTotals(totals) {
  const catalog = await readJson(catalogPath);
  catalog.totals = catalog.totals || {};
  mergeTotals(catalog.totals, totals);
  await writeJson(catalogPath, catalog);

  const report = await readJson(reportPath);
  report.totals = report.totals || {};
  mergeTotals(report.totals, totals);
  await writeJson(reportPath, report);
}

function quantumAreaOrder(value) {
  if (value === '韓國' || value === '韩国') return -100;
  if (String(value || '').includes('韓') || String(value || '').includes('韩')) return -90;
  return 0;
}

async function updateQuantum() {
  let manifest;
  try {
    manifest = await readJson(path.join(quantumRoot, 'manifest.json'));
  } catch {
    return { skipped: true };
  }

  const byKind = new Map(VOD_KIND_ORDER.map((kind) => [kind, []]));
  let itemChanges = 0;
  let inputItems = 0;
  for (const chunk of manifest.chunks || []) {
    const file = path.join(quantumRoot, chunk.file);
    const payload = await readJson(file);
    for (const item of payload.items || []) {
      inputItems += 1;
      const nextKind = classifyItem(item);
      if (item.kind !== nextKind) {
        item.kind = nextKind;
        itemChanges += 1;
      }
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }
  }

  const chunks = [];
  let normalizedTotal = 0;
  let playableTotal = 0;
  const allAreas = new Set();
  const shortAreas = new Set();
  const allYears = new Set();
  const allGenres = new Set();

  for (const [kind, rows] of [...byKind.entries()].filter(([, rows]) => rows.length)) {
    rows.sort((a, b) => Number(b.hot || 0) - Number(a.hot || 0));
    normalizedTotal += rows.length;
    playableTotal += rows.filter((item) => item.playable).length;
    for (const item of rows) {
      if (item.area) allAreas.add(item.area);
      if (item.kind === 'short' && item.area) shortAreas.add(item.area);
      if (item.year) allYears.add(item.year);
      for (const genre of item.genre || []) allGenres.add(genre);
    }
    const file = `${kind}.json`;
    chunks.push({ kind, file, count: rows.length, playable: rows.filter((item) => item.playable).length });
    await writeJson(path.join(quantumRoot, file), { kind, count: rows.length, items: rows });
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.totals = {
    ...(manifest.totals || {}),
    normalizedItems: normalizedTotal,
    playableItems: playableTotal,
  };
  manifest.filters = {
    ...(manifest.filters || {}),
    years: [...allYears].sort((a, b) => b.localeCompare(a)).slice(0, 36),
    areas: [...allAreas].sort((a, b) => quantumAreaOrder(a) - quantumAreaOrder(b) || a.localeCompare(b, 'zh-Hant')),
    shortAreas: [...shortAreas].sort((a, b) => quantumAreaOrder(a) - quantumAreaOrder(b) || a.localeCompare(b, 'zh-Hant')),
    genres: [...allGenres].sort((a, b) => a.localeCompare(b, 'zh-Hant')).slice(0, 80),
  };
  manifest.chunks = chunks;
  await writeJson(path.join(quantumRoot, 'manifest.json'), manifest);
  await writeJson(path.join(quantumRoot, 'report.json'), { ...manifest, classificationRule: 'tools/vod-kind-rules.mjs' });
  return { inputItems, itemChanges, chunks };
}

const catalogResult = skipCatalog ? { skipped: true } : await updateCatalog();
const detailResult = skipDetail ? { skipped: true } : await updateGzipItems(detailRoot, 'vod-detail');
const indexResult = skipIndex ? { skipped: true } : await updateGzipItems(indexRoot, 'vod-index');
const totalsForReport = detailResult.totals || indexResult.totals;
if (totalsForReport) await updateReportTotals(totalsForReport);
const quantumResult = skipQuantum ? { skipped: true } : await updateQuantum();

console.log(
  JSON.stringify(
    {
      catalog: catalogResult,
      detail: detailResult,
      index: indexResult,
      quantum: quantumResult,
    },
    null,
    2,
  ),
);
