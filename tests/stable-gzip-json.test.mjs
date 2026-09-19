import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readGzipJson, writeStableGzipJson } from '../tools/stable-gzip-json.mjs';

test('does not rewrite gzip JSON when only generatedAt changed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oktv-stable-gzip-'));
  const file = path.join(root, 'index.json.gz');
  try {
    const first = await writeStableGzipJson(file, {
      generatedAt: '2026-09-04T00:00:00.000Z',
      sourceId: 'alpha',
      items: [{ id: '1', title: 'Alpha' }],
    });
    const firstBytes = await fs.readFile(file);
    const secondValue = {
      generatedAt: '2026-09-04T01:00:00.000Z',
      sourceId: 'alpha',
      items: [{ id: '1', title: 'Alpha' }],
    };
    const second = await writeStableGzipJson(file, secondValue);
    const secondBytes = await fs.readFile(file);

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.deepEqual(secondBytes, firstBytes);
    assert.equal(secondValue.generatedAt, '2026-09-04T00:00:00.000Z');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rewrites gzip JSON when items changed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oktv-stable-gzip-'));
  const file = path.join(root, 'index.json.gz');
  try {
    await writeStableGzipJson(file, { generatedAt: 'old', items: [{ id: '1' }] });
    const result = await writeStableGzipJson(file, { generatedAt: 'new', items: [{ id: '2' }] });
    assert.equal(result.changed, true);
    assert.deepEqual(await readGzipJson(file), { generatedAt: 'new', items: [{ id: '2' }] });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
