import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePublicSources, mergePublicLive } from '../docs/iphone/public-sources.mjs';
import { writeStableGzipJson } from './stable-gzip-json.mjs';
const root = path.resolve(import.meta.dirname, '..');
const managedSource = 'public-blender-open-movies';
export function mergePublicCatalog(catalog, payload) {
  const added = normalizePublicSources(payload);
  const previous = (catalog.sources || []).filter(s => s.id === managedSource);
  const previousCount = previous.reduce((sum, s) => sum + Number(s.itemCount || 0), 0);
  const sources = [...added.sources.map(s => ({ ...s, api: '', type: 1, providerType: 'official-public-catalog', indexable: true, indexMode: 'chunked-json-gzip', indexPath: `vod-index/${s.id}.json.gz` })), ...(catalog.sources || []).filter(s => s.id !== managedSource)];
  const items = [...added.items, ...(catalog.items || []).filter(i => i.sourceId !== managedSource)];
  return { ...catalog, publicSourcesGeneratedAt: payload.generatedAt, sources, items, totals: { ...catalog.totals,
    sources: sources.length, indexedSources: sources.filter(s => s.indexed).length,
    items: sources.reduce((n, s) => n + Number(s.itemCount || 0), 0),
    playableItems: sources.reduce((n, s) => n + Number(s.playableCount || 0), 0),
    movies: Math.max(0, Number(catalog.totals?.movies || 0) - previousCount) + added.items.length,
  } };
}
export async function mergeData({ dataRoot = path.join(root, 'docs/data'), publicFile = path.join(root, 'docs/iphone/public-sources.json') } = {}) {
  const payload = JSON.parse(await fs.readFile(publicFile, 'utf8'));
  if (payload.schemaVersion !== 1) throw new Error('Unsupported public source schema');
  const added = normalizePublicSources(payload), result = {};
  const catalogFile = path.join(dataRoot, 'iphone-vod-catalog.json');
  try {
    const catalog = mergePublicCatalog(JSON.parse(await fs.readFile(catalogFile, 'utf8')), payload);
    for (const source of added.sources) await writeStableGzipJson(path.join(dataRoot, `vod-index/${source.id}.json.gz`), { generatedAt: payload.generatedAt, sourceId: source.id, sourceName: source.name, complete: true, items: added.items.filter(i => i.sourceId === source.id) });
    await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n'); result.catalog = catalog.totals;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const liveFile = path.join(dataRoot, 'live-channels.json');
  try {
    const current = JSON.parse(await fs.readFile(liveFile, 'utf8'));
    const live = mergePublicLive(current.filter(i => !i.id.startsWith('public-')), added.live);
    await fs.writeFile(liveFile, JSON.stringify(live, null, 2) + '\n'); result.live = live.length;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!Object.keys(result).length) throw new Error('No shared catalog or live JSON found');
  return result;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const options = {}; for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
  console.log(JSON.stringify(await mergeData(options)));
}
