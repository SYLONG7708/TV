import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { updatePolicy } from './update-iphone-csp.mjs';

export const BULK_PATH = /^docs\/data\/(?:vod-index|vod-detail|vod-search|vod-query|quantum-lzi)\//;
export function includeInPages(relative) {
  return !BULK_PATH.test(relative) && (
    /^docs\/(?:iphone|assets)\//.test(relative) ||
    /^docs\/data\/[^/]+\.(?:json|csv)$/.test(relative) ||
    /^sources\//.test(relative)
  );
}

export async function buildPagesShell({ dataRoot, codeRoot, output, dataRevision, codeRevision, maxBytes = 100 * 1024 * 1024 }) {
  if (!/^[a-f0-9]{40}$/.test(dataRevision) || !/^[a-f0-9]{40}$/.test(codeRevision)) throw new Error('Exact data and code commits are required');
  dataRoot = path.resolve(dataRoot);
  codeRoot = path.resolve(codeRoot);
  output = path.resolve(output);
  for (const root of [dataRoot, codeRoot]) {
    if (output === root || root.startsWith(output + path.sep) || output.startsWith(root + path.sep)) throw new Error('Output must be separate from source directories');
  }
  await fs.mkdir(output, { recursive: true });
  if ((await fs.readdir(output)).length) throw new Error('Output directory must be empty');
  const selected = new Map();
  async function walk(root, relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || BULK_PATH.test(name + '/')) continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${name}`);
      if (entry.isDirectory()) {
        if (/^(?:docs|sources)(?:\/|$)/.test(name)) await walk(root, name);
      } else if (includeInPages(name)) selected.set(name, path.join(root, name));
    }
  }
  await walk(dataRoot);
  // Application code comes from main; metadata and data always come from one
  // immutable data commit. Never mix in main's intentionally partial catalog.
  for (const name of ['docs/iphone', 'docs/assets']) {
    async function overlay(relative) {
      for (const entry of await fs.readdir(path.join(codeRoot, relative), { withFileTypes: true })) {
        const next = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${next}`);
        if (entry.isDirectory()) await overlay(next);
        else selected.set(next, path.join(codeRoot, next));
      }
    }
    await overlay(name);
  }
  let bytes = 0;
  for (const [relative, source] of selected) {
    bytes += (await fs.stat(source)).size;
    if (bytes > maxBytes) throw new Error(`Pages payload exceeds ${maxBytes} bytes`);
    const target = path.join(output, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  const htmlPath = path.join(output, 'docs/iphone/index.html');
  let html = await fs.readFile(htmlPath, 'utf8');
  if (!html.includes("const DATA_REVISION = 'gh-pages';")) throw new Error('Data revision marker missing');
  html = html.replace("const DATA_REVISION = 'gh-pages';", `const DATA_REVISION = '${dataRevision}';`);
  await fs.writeFile(htmlPath, updatePolicy(html).html, 'utf8');
  const catalog = JSON.parse((await fs.readFile(path.join(output, 'docs/data/iphone-vod-catalog.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const sum = (catalog.sources || []).reduce((total, source) => total + Number(source.itemCount || 0), 0);
  if (sum < 1_000_000 || sum !== Number(catalog.totals?.items)) throw new Error('Published catalog floor or total mismatch');
  const live = JSON.parse((await fs.readFile(path.join(output, 'docs/data/live-channels.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(live) || live.length < 10) throw new Error('Published live data must be an array with at least 10 channels');
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=docs/iphone/index.html"><title>影視</title><a href="docs/iphone/index.html">開啟影視</a></html>\n');
  const report = {
    schemaVersion: 1, builtAt: new Date().toISOString(), dataCommit: dataRevision, codeCommit: codeRevision,
    dataBaseUrl: `https://raw.githubusercontent.com/SYLONG7708/TV/${dataRevision}/docs/data/`,
    bulkDataExternal: true, maxPayloadBytes: maxBytes, catalogSources: catalog.sources.length, catalogItems: sum,
    liveChannels: live.length,
  };
  const statePath = path.join(output, 'docs/data/deployment-state.json');
  await fs.writeFile(statePath, JSON.stringify(report, null, 2) + '\n');
  let finalBytes = 0;
  async function measure(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const child = path.join(folder, entry.name);
      if (entry.isDirectory()) await measure(child);
      else finalBytes += (await fs.stat(child)).size;
    }
  }
  await measure(output);
  // Include the manifest itself; iterate until its byte-count field stabilizes.
  for (let attempt = 0; attempt < 5 && report.payloadBytes !== finalBytes; attempt++) {
    report.payloadBytes = finalBytes;
    await fs.writeFile(statePath, JSON.stringify(report, null, 2) + '\n');
    finalBytes = 0;
    await measure(output);
  }
  if (finalBytes > maxBytes) throw new Error('Final Pages payload exceeds size budget');
  return { ...report, actualPayloadBytes: finalBytes };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
  const report = await buildPagesShell({ dataRoot: args.dataRoot, codeRoot: args.codeRoot, output: args.output, dataRevision: args.dataRevision, codeRevision: args.codeRevision });
  console.log(JSON.stringify(report, null, 2));
}
