import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPagesShell, includeInPages } from '../tools/build-pages-shell.mjs';
import { updatePolicy } from '../tools/update-iphone-csp.mjs';

test('large data remains in source storage and is excluded from Pages', () => {
  for (const folder of ['vod-index','vod-query','vod-detail','vod-search','quantum-lzi']) assert.equal(includeInPages(`docs/data/${folder}/test.json.gz`), false);
  assert.equal(includeInPages('docs/data/live-channels.json'), true);
  assert.equal(includeInPages('sources/TVBOX'), true);
  assert.equal(includeInPages('.git/config'), false);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oktv-shell-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data'), codeRoot = path.join(root, 'code'), output = path.join(root, 'site');
  for (const folder of ['docs/data/vod-query', 'docs/iphone', 'docs/assets']) await fs.mkdir(path.join(dataRoot, folder), { recursive: true });
  for (const folder of ['docs/iphone', 'docs/assets', 'docs/data']) await fs.mkdir(path.join(codeRoot, folder), { recursive: true });
  await fs.writeFile(path.join(dataRoot,'docs/data/iphone-vod-catalog.json'), JSON.stringify({ sources: [{ itemCount: 2_000_000 }], totals: { items: 2_000_000 } }));
  await fs.writeFile(path.join(codeRoot,'docs/data/iphone-vod-catalog.json'), JSON.stringify({ sources: [], totals: { items: 0 } }));
  await fs.writeFile(path.join(dataRoot,'docs/data/live-channels.json'), JSON.stringify(Array.from({ length: 12 }, () => ({ playable: true }))));
  await fs.writeFile(path.join(dataRoot,'docs/data/vod-query/must-preserve.json.gz'), 'bulk-data');
  await fs.copyFile(path.resolve(import.meta.dirname,'../docs/iphone/index.html'), path.join(codeRoot,'docs/iphone/index.html'));
  return { root, dataRoot, codeRoot, output, dataRevision: 'a'.repeat(40), codeRevision: 'b'.repeat(40) };
}
test('artifact preserves full catalog, pins data commit, updates CSP, and leaves source files intact', async (t) => {
  const input = await fixture(t);
  const report = await buildPagesShell(input);
  assert.equal(report.catalogItems, 2_000_000);
  assert.equal(report.liveChannels, 12);
  assert.ok(report.actualPayloadBytes < 1024 * 1024);
  assert.equal(report.actualPayloadBytes, report.payloadBytes);
  const html = await fs.readFile(path.join(input.output,'docs/iphone/index.html'), 'utf8');
  assert.ok(html.includes(`const DATA_REVISION = '${input.dataRevision}';`));
  assert.equal(updatePolicy(html).html, html);
  await assert.rejects(fs.stat(path.join(input.output,'docs/data/vod-query/must-preserve.json.gz')));
  assert.equal(await fs.readFile(path.join(input.dataRoot,'docs/data/vod-query/must-preserve.json.gz'), 'utf8'), 'bulk-data');
});
test('oversized output and missing data revision fail before deployment', async (t) => {
  const input = await fixture(t);
  await assert.rejects(buildPagesShell({ ...input, dataRevision: 'gh-pages' }), /Exact/);
  await assert.rejects(buildPagesShell({ ...input, maxBytes: 100 }), /exceeds/);
});
test('live schema regression cannot silently publish an empty list', async (t) => {
  const input = await fixture(t);
  await fs.writeFile(path.join(input.dataRoot,'docs/data/live-channels.json'), JSON.stringify({ channels: [] }));
  await assert.rejects(buildPagesShell(input), /live data/);
});
