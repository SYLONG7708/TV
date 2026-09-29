import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildKoreanShortSeeds } from '../tools/build-iphone-korean-short-seeds.mjs';

test('daily Korean short seeds keep playable episodes and survive a temporary source outage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oktv-korean-short-'));
  try {
    const catalogPath = path.join(root, 'catalog.json');
    const output = path.join(root, 'seeds.json');
    const source = {
      id: 'ffzy-test', name: '非凡資源', api: 'https://api.ffzyapi.com/api.php/provide/vod/', indexed: true,
      categories: [{ id: '36', name: '短劇' }],
    };
    await fs.writeFile(catalogPath, JSON.stringify({ sources: [source] }));
    const rows = [
      { vod_id: 1, vod_name: '我最亲爱的(Ai)', vod_area: '韩国', type_name: '短剧', vod_year: '2026', vod_play_url: '第1集$https://example.com/share/one$$$第1集$https://example.com/one.m3u8' },
      { vod_id: 2, vod_name: '無關短劇', vod_area: '大陸', type_name: '短劇', vod_play_url: '第1集$https://example.com/two.m3u8' },
    ];
    const first = await buildKoreanShortSeeds({ catalogPath, output, pages: 1, query: async () => rows });
    assert.equal(first.itemCount, 1);
    const saved = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(saved.items[0].episodes[0].url, 'https://example.com/one.m3u8');
    assert.equal(saved.items[0].area, '韓國');

    const second = await buildKoreanShortSeeds({ catalogPath, output, pages: 1, query: async () => { throw new Error('temporary outage'); } });
    assert.equal(second.preservedPrevious, true);
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), saved);
  } finally {
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(root).startsWith(tempRoot)) throw new Error('Temporary path escaped its root');
    await fs.rm(root, { recursive: true, force: true });
  }
});
