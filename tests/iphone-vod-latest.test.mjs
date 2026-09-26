import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'build-iphone-vod-latest.mjs');

test('embeds episodes only for the configured newest items per source', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iphone-vod-latest-'));
  try {
    const dataRoot = path.join(tempRoot, 'docs', 'data');
    const detailDir = path.join(dataRoot, 'vod-detail', 'sample');
    const catalogPath = path.join(dataRoot, 'iphone-vod-catalog.json');
    const outputPath = path.join(dataRoot, 'iphone-vod-latest.json');
    await fs.mkdir(detailDir, { recursive: true });
    await fs.writeFile(
      catalogPath,
      JSON.stringify({
        generatedAt: '2026-07-11T00:00:00.000Z',
        sources: [
          {
            id: 'sample',
            name: 'Sample',
            indexed: true,
            detailPathPattern: 'vod-detail/sample/page-{page}.json.gz',
          },
        ],
      }),
    );
    const items = [
      {
        id: 'newest',
        sourceId: 'sample',
        sourceName: 'Sample',
        vodId: '2',
        title: 'Newest',
        updatedAt: '2026-07-11 08:00:00',
        playable: true,
        episodes: [{ name: '1', url: 'https://media.example/new.m3u8' }],
        episodeCount: 1,
        detailPath: 'vod-detail/sample/page-0001.json.gz',
        detailPage: 1,
      },
      {
        id: 'older',
        sourceId: 'sample',
        sourceName: 'Sample',
        vodId: '1',
        title: 'Older',
        updatedAt: '2026-07-10 08:00:00',
        playable: true,
        episodes: [{ name: '1', url: 'https://media.example/old.m3u8' }],
        episodeCount: 1,
        detailPath: 'vod-detail/sample/page-0001.json.gz',
        detailPage: 1,
      },
    ];
    await fs.writeFile(
      path.join(detailDir, 'page-0001.json.gz'),
      zlib.gzipSync(Buffer.from(JSON.stringify({ items }))),
    );

    await run(process.execPath, [
      script,
      '--tvRoot',
      tempRoot,
      '--catalog',
      catalogPath,
      '--dataRoot',
      dataRoot,
      '--output',
      outputPath,
      '--embedEpisodesPerSource',
      '1',
    ]);

    const result = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(result.embedEpisodesPerSource, 1);
    assert.deepEqual(result.items[0].episodes, items[0].episodes);
    assert.equal(result.items[0].lazyEpisodes, false);
    assert.equal('episodes' in result.items[1], false);
    assert.equal(result.items[1].lazyEpisodes, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
