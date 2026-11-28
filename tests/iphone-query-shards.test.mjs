import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import {
  DEFAULT_MAX_SIGNALS_PER_TITLE,
  bucketForPrefix,
  bucketName,
  createQueryNormalizer,
  expandQueryGroups,
  limitQueryGroups,
  mergeItemsIntoGroups,
} from '../tools/iphone-query-shards.mjs';

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');

test('builds compact query shards, separates adult results, and groups title spacing variants', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iphone-query-shards-'));
  try {
    const dataRoot = path.join(root, 'docs', 'data');
    const searchRoot = path.join(dataRoot, 'vod-search');
    const iphoneRoot = path.join(root, 'docs', 'iphone');
    await fs.mkdir(searchRoot, { recursive: true });
    await fs.mkdir(iphoneRoot, { recursive: true });
    await fs.mkdir(path.join(root, 'sources'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'sources', 'title-aliases.json'),
      JSON.stringify({ version: 1, groups: [{ canonicalTraditional: '至死不渝', aliases: ['痴迷', '癡迷'] }] }),
    );
    await fs.writeFile(
      path.join(iphoneRoot, 'index.html'),
      '<script>const ZH_CHAR_MAP = { 剧: "劇", 单: "單" };</script>',
    );
    const sources = [
      { id: 'a', name: 'A', adult: false, searchIndexPath: 'vod-search/a.json.gz' },
      { id: 'b', name: 'B', adult: false, searchIndexPath: 'vod-search/b.json.gz' },
      { id: 'x', name: 'X', adult: true, searchIndexPath: 'vod-search/x.json.gz' },
    ];
    await fs.writeFile(path.join(dataRoot, 'iphone-vod-catalog.json'), JSON.stringify({ sources }));
    const item = (id, sourceId, title, adult = false, playable = true) => ({
      id,
      sourceId,
      sourceName: sourceId.toUpperCase(),
      vodId: id,
      title,
      episodeCount: 3,
      playable,
      adult,
      detailPath: `vod-detail/${sourceId}/page-0001.json.gz`,
    });
    const writeIndex = async (name, items) =>
      fs.writeFile(
        path.join(searchRoot, `${name}.json.gz`),
        zlib.gzipSync(Buffer.from(JSON.stringify({ items }))),
      );
    await writeIndex('a', [item('a1', 'a', '喜剧之王单口季 第三季')]);
    await writeIndex('b', [
      item('b-short', 'b', 'K'),
      item('b1', 'b', '喜剧之王单口季第三季'),
      item('b2', 'b', '不可播放', false, false),
    ]);
    await writeIndex('x', [item('x1', 'x', '成人测试', true)]);
    await fs.writeFile(
      path.join(dataRoot, 'iphone-vod-latest.json'),
      JSON.stringify({ items: [item('a1', 'a', '喜剧之王单口季 第三季')] }),
    );

    await run(process.execPath, [
      path.join(repoRoot, 'tools', 'build-iphone-query-shards.mjs'),
      '--repoRoot',
      root,
      '--bucketCount',
      '16',
    ]);

    const manifest = JSON.parse(await fs.readFile(path.join(dataRoot, 'vod-query', 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, 2);
    assert.equal(manifest.maxSignalsPerTitle, DEFAULT_MAX_SIGNALS_PER_TITLE);
    assert.deepEqual(manifest.titleAliases[0].aliases, ['痴迷', '癡迷']);
    assert.equal(manifest.scopes.normal.signals, 2);
    assert.equal(manifest.scopes.adult.signals, 1);
    assert.deepEqual(manifest.fallbackItems.map((row) => row.id), ['b-short']);

    const normalizer = createQueryNormalizer(path.join(iphoneRoot, 'index.html'));
    const prefix = [...normalizer.compact('喜劇')].slice(0, 2).join('');
    const bucket = bucketForPrefix(prefix, 16);
    const payload = JSON.parse(
      zlib
        .gunzipSync(await fs.readFile(path.join(dataRoot, 'vod-query', 'normal', bucketName(bucket, 16))))
        .toString('utf8'),
    );
    assert.equal(payload.groups.length, 1);
    assert.equal(payload.groups[0].signals.length, 2);
    assert.equal(expandQueryGroups(payload).length, 2);
    assert.ok(!expandQueryGroups(payload).some((row) => row.id === 'b2'));

    const mergeArgs = [
      path.join(repoRoot, 'tools', 'merge-iphone-query-shards.mjs'),
      '--repoRoot',
      root,
    ];
    const firstMerge = JSON.parse((await run(process.execPath, mergeArgs)).stdout.trim());
    const secondMerge = JSON.parse((await run(process.execPath, mergeArgs)).stdout.trim());
    assert.equal(firstMerge.changedBuckets, 0);
    assert.equal(secondMerge.changedBuckets, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('retains every source signal without a silent title cap', () => {
  const normalizer = createQueryNormalizer(path.join(repoRoot, 'docs', 'iphone', 'index.html'));
  const items = Array.from({ length: 300 }, (_, index) => ({
    id: `item-${index}`,
    sourceId: `source-${index}`,
    sourceName: `Source ${index}`,
    vodId: String(index),
    title: '痴迷',
    episodeCount: 1,
    playable: true,
    detailPath: `vod-detail/source-${index}/page-0001.json.gz`,
  }));
  const groups = mergeItemsIntoGroups([], items, { normalizer });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].signals.length, 300);
});

test('retains every title group without a silent crowded-prefix cap', () => {
  const groups = Array.from({ length: 1305 }, (_, index) => ({ k: `group-${index}` }));
  assert.equal(limitQueryGroups(groups).length, 1305);
  assert.equal(limitQueryGroups(groups, 1200).length, 1200);
});

test('fails a full query build when a declared source index is incomplete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iphone-query-count-guard-'));
  try {
    const dataRoot = path.join(root, 'docs', 'data');
    const searchRoot = path.join(dataRoot, 'vod-search');
    await fs.mkdir(searchRoot, { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'iphone'), { recursive: true });
    await fs.mkdir(path.join(root, 'sources'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'iphone', 'index.html'), '<script>const ZH_CHAR_MAP = {};</script>');
    await fs.writeFile(path.join(root, 'sources', 'title-aliases.json'), JSON.stringify({ version: 1, groups: [] }));
    await fs.writeFile(
      path.join(dataRoot, 'iphone-vod-catalog.json'),
      JSON.stringify({
        sources: [{ id: 'partial', name: 'Partial', itemCount: 2, searchIndexPath: 'vod-search/partial.json.gz' }],
      }),
    );
    await fs.writeFile(
      path.join(searchRoot, 'partial.json.gz'),
      zlib.gzipSync(Buffer.from(JSON.stringify({ items: [] }))),
    );

    await assert.rejects(
      run(process.execPath, [path.join(repoRoot, 'tools', 'build-iphone-query-shards.mjs'), '--repoRoot', root]),
      (error) => {
        assert.match(String(error.stdout || ''), /source index count mismatch: expected 2, got 0/);
        return true;
      },
    );

    await fs.rm(path.join(root, 'sources', 'title-aliases.json'));
    await assert.rejects(
      run(process.execPath, [path.join(repoRoot, 'tools', 'build-iphone-query-shards.mjs'), '--repoRoot', root]),
      (error) => {
        assert.match(String(error.stderr || ''), /Title alias registry not found/);
        return true;
      },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
