import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib';

const gunzip = promisify(gunzipCallback);
const gzip = promisify(gzipCallback);

function withoutKeys(value, volatileKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = { ...value };
  for (const key of volatileKeys) delete copy[key];
  return copy;
}

export async function readGzipJson(file) {
  const compressed = await fs.readFile(file);
  return JSON.parse((await gunzip(compressed)).toString('utf8'));
}

/**
 * Writes gzip JSON only when its meaningful payload changed. Volatile top-level
 * fields such as generatedAt are retained from the prior file for a no-op run,
 * preventing multi-gigabyte index churn in generated Git branches.
 */
export async function writeStableGzipJson(file, value, options = {}) {
  const volatileKeys = Array.isArray(options.volatileKeys) ? options.volatileKeys : ['generatedAt'];
  let previous = null;
  try {
    previous = await readGzipJson(file);
  } catch {
    previous = null;
  }

  const comparableNext = JSON.stringify(withoutKeys(value, volatileKeys));
  const comparablePrevious = previous ? JSON.stringify(withoutKeys(previous, volatileKeys)) : '';
  if (previous && comparableNext === comparablePrevious) {
    for (const key of volatileKeys) {
      if (Object.hasOwn(previous, key)) value[key] = previous[key];
    }
    const stat = await fs.stat(file);
    return { changed: false, bytes: stat.size, value };
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  const compressed = await gzip(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9 });
  await fs.writeFile(file, compressed);
  return { changed: true, bytes: compressed.length, value };
}
