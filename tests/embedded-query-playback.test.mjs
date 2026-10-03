import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { expandQueryGroups, readGzipJson, queryPageFile } from '../tools/iphone-query-shards.mjs';
import { normalizePublicSources } from '../docs/iphone/public-sources.mjs';

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'embedded-query-playback-'));
  const dataRoot = path.join(root, 'docs/data');
  const source = { id: 'public-blender-open-movies', name: 'Official films', indexPath: 'vod-index/public.json.gz' };
  const payload = JSON.parse(await fs.readFile(path.join(repoRoot, 'docs/iphone/public-sources.json'), 'utf8'));
  const { items } = normalizePublicSources(payload);
  assert.ok(items.length > 0, 'Use the same embedded official films as production');
  const invalidTitle = { id: 'bad-title', sourceId: 'legacy', title: '???', playable: true, episodeCount: 1, detailPath: 'vod-detail/legacy/page-0001.json.gz' };
  await fs.mkdir(path.join(dataRoot, 'vod-index'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs/iphone'), { recursive: true });
  await fs.mkdir(path.join(root, 'sources'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs/iphone/index.html'), '<script>const ZH_CHAR_MAP = {};</script>');
  await fs.writeFile(path.join(root, 'sources/title-aliases.json'), JSON.stringify({ version: 1, groups: [] }));
  const writeIndex = (name, rows) => fs.writeFile(path.join(dataRoot, 'vod-index', name), zlib.gzipSync(Buffer.from(JSON.stringify({ items: rows }))));
  await writeIndex('public.json.gz', items);
  await writeIndex('legacy.json.gz', [invalidTitle]);
  await fs.writeFile(path.join(dataRoot, 'iphone-vod-catalog.json'), JSON.stringify({
    sources: [{ ...source, itemCount: items.length }, { id: 'legacy', itemCount: 1, indexPath: 'vod-index/legacy.json.gz' }],
    totals: { playableItems: items.length + 1 },
  }));
  const build = () => run(process.execPath, [path.join(repoRoot, 'tools/build-iphone-query-shards.mjs'),
    '--repoRoot', root, '--searchRoot', 'docs/data/vod-index', '--inputPathField', 'indexPath', '--bucketCount', '16', '--workers', '1']);
  const readOutput = async () => {
    const queryRoot = path.join(dataRoot, 'vod-query');
    const manifest = JSON.parse(await fs.readFile(path.join(queryRoot, 'manifest.json'), 'utf8'));
    const rows = Object.entries(manifest.scopes).flatMap(([scope, entry]) => entry.buckets.flatMap((bucket) => {
      const file = path.join(queryRoot, scope, `b-${String(bucket).padStart(4, '0')}.json.gz`);
      return entry.bucketStats[String(bucket)].pages.flatMap((page) => expandQueryGroups(readGzipJson(queryPageFile(file, page.part))));
    }));
    return { manifest, rows };
  };
  return { root, dataRoot, items, build, writeIndex, readOutput };
}

test('full publication includes official embedded films and accounts for quarantined titles', async () => {
  const f = await fixture();
  try {
    await f.build();
    const { manifest, rows } = await f.readOutput();
    assert.equal(manifest.inputs.searchableItems, f.items.length);
    assert.equal(manifest.inputs.quarantinedTitles, 1);
    assert.equal(manifest.inputs.accountedPlayableItems, f.items.length + 1);
    for (const item of f.items) {
      const recovered = rows.find(row => row.id === item.id);
      assert.ok(recovered, `${item.id} must appear in an actual generated query shard`);
      assert.equal(recovered.episodes[0].url, item.episodes[0].url);
      assert.deepEqual(recovered.rights, item.rights);
    }
    assert.ok(!rows.some(row => row.id === 'bad-title'));
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('incremental merge retains updated embedded playback, quality choices and attribution', async () => {
  const f = await fixture();
  try {
    await f.build();
    const item = structuredClone(f.items[0]);
    item.episodes = [{ name: 'Updated film', url: 'https://example.org/updated.mp4', variants: [
      { label: '1080p', height: 1080, url: 'https://example.org/1080.mp4' },
      { label: 'invalid', url: 'javascript:alert(1)' },
    ] }];
    await fs.writeFile(path.join(f.dataRoot, 'iphone-vod-latest.json'), JSON.stringify({ items: [item] }));
    await run(process.execPath, [path.join(repoRoot, 'tools/merge-iphone-query-shards.mjs'), '--repoRoot', f.root]);
    const { rows } = await f.readOutput();
    const updated = rows.filter(row => row.id === item.id);
    assert.ok(updated.length > 0);
    for (const recovered of updated) {
      assert.equal(recovered.episodes[0].url, item.episodes[0].url);
      assert.deepEqual(recovered.episodes[0].variants, [item.episodes[0].variants[0]]);
      assert.deepEqual(recovered.rights, item.rights);
    }
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('coverage guard still rejects a film with neither a detail path nor a valid embedded URL', async () => {
  const f = await fixture();
  try {
    const items = structuredClone(f.items);
    items[0].episodes = [{ name: 'invalid', url: 'javascript:alert(1)' }];
    await f.writeIndex('public.json.gz', items);
    await assert.rejects(f.build(), error => {
      assert.match(error.stderr, /Refusing to publish query shards/);
      return true;
    });
    await assert.rejects(fs.access(path.join(f.dataRoot, 'vod-query/manifest.json')));
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
