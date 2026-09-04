import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (!key.startsWith('--')) continue;
  args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
  if (next && !next.startsWith('--')) index += 1;
}

const treeRepo = path.resolve(args.get('treeRepo') || '.');
const treeish = args.get('treeish') || 'origin/gh-pages';
const outputRoot = path.resolve(args.get('outputRoot') || 'output/pages-dataset-migration');
const baseUrl = String(args.get('baseUrl') || 'https://sylong7708.github.io/TV').replace(/\/+$/, '');
const concurrency = Math.max(1, Math.min(32, Number(args.get('concurrency') || 12)));
const retries = Math.max(1, Number(args.get('retries') || 4));
const prefixes = String(
  args.get('prefixes') || 'docs/data/vod-index,docs/data/vod-query,docs/data/quantum-lzi',
)
  .split(',')
  .map((value) => value.trim().replace(/^\/+|\/+$/g, ''))
  .filter(Boolean);

function listTreeFiles() {
  const result = spawnSync('git', ['-C', treeRepo, 'ls-tree', '-r', '-z', treeish, '--', ...prefixes], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8').trim() || 'git ls-tree failed');
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/s);
      if (!match) throw new Error(`Unexpected ls-tree entry: ${entry.slice(0, 160)}`);
      return { oid: match[1], relativePath: match[2].replaceAll('\\', '/') };
    });
}

function targetFor(relativePath) {
  const fullPath = path.resolve(outputRoot, ...relativePath.split('/'));
  const prefix = `${outputRoot}${path.sep}`;
  if (!fullPath.startsWith(prefix)) throw new Error(`Refusing unsafe output path: ${relativePath}`);
  return fullPath;
}

function urlFor(relativePath) {
  return `${baseUrl}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function gitBlobIdentity(filePath) {
  const size = (await fs.stat(filePath)).size;
  const hash = createHash('sha1');
  hash.update(`blob ${size}\0`);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return { size, oid: hash.digest('hex') };
}

async function download(file) {
  const target = targetFor(file.relativePath);
  try {
    const existing = await gitBlobIdentity(target);
    if (existing.oid === file.oid) return { skipped: true, bytes: existing.size };
  } catch {
    // Missing files are downloaded below.
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.part-${process.pid}`;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await fs.rm(temporary, { force: true });
      const response = await fetch(urlFor(file.relativePath), {
        redirect: 'follow',
        headers: { 'cache-control': 'no-cache', 'user-agent': 'OKTV-quota-recovery/1.0' },
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      const downloaded = await gitBlobIdentity(temporary);
      if (downloaded.oid !== file.oid) throw new Error(`blob identity ${downloaded.oid}, expected ${file.oid}`);
      await fs.rm(target, { force: true });
      await fs.rename(temporary, target);
      return { skipped: false, bytes: downloaded.size };
    } catch (error) {
      await fs.rm(temporary, { force: true });
      if (attempt === retries) throw new Error(`${file.relativePath}: ${error.message}`);
      await sleep(attempt * 1500);
    }
  }
  throw new Error(`Unable to download ${file.relativePath}`);
}

const files = listTreeFiles();
let cursor = 0;
let completed = 0;
let downloaded = 0;
let skipped = 0;
let completedBytes = 0;

console.log(
  JSON.stringify({ treeish, baseUrl, outputRoot, prefixes, files: files.length, concurrency }),
);

const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
  while (cursor < files.length) {
    const current = cursor;
    cursor += 1;
    const file = files[current];
    const result = await download(file);
    completed += 1;
    completedBytes += result.bytes;
    if (result.skipped) skipped += 1;
    else downloaded += 1;
    if (completed % 100 === 0 || completed === files.length) {
      console.log(
        JSON.stringify({
          completed,
          total: files.length,
          downloaded,
          skipped,
          completedBytes,
          percent: Number(((completed / files.length) * 100).toFixed(2)),
        }),
      );
    }
  }
});

await Promise.all(workers);
console.log(JSON.stringify({ ok: true, files: files.length, downloaded, skipped, bytes: completedBytes }));
