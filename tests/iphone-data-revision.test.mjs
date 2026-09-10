import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const html = await fs.readFile(new URL('../docs/iphone/index.html', import.meta.url), 'utf8');
const loaders = html.slice(html.indexOf('      function onlineDataUrl('), html.indexOf('      function clearViewCache('));
const revision = 'a'.repeat(40);
function client(fetch, { hostname = 'sylong7708.github.io', dataRevision = revision } = {}) {
  return vm.runInNewContext(`${loaders}\ngetJson;`, {
    DATA_REVISION: dataRevision,
    ONLINE_DATA_BASE: 'https://sylong7708.github.io/TV/docs/data/',
    CURRENT_RAW_DATA_BASE: `https://raw.githubusercontent.com/SYLONG7708/TV/${dataRevision}/docs/data/`,
    ARCHIVE_DATA_BASE: 'https://archive.invalid/docs/data/',
    ARCHIVE_RAW_DATA_BASE: 'https://raw.githubusercontent.com/SYLONG7708/TV-archive-20260904/main/docs/data/',
    location: { hostname, href: `https://${hostname}/TV/docs/iphone/index.html` },
    window: { setTimeout, clearTimeout },
    fetch, URL, AbortController, DOMException, TextDecoder, Uint8Array,
  });
}
const json = (value, status = 200) => ({ ok: status === 200, status, json: async () => value });

test('cached HTML keeps catalog and search metadata on its original data revision', async () => {
  const requests = [];
  const getJson = client(async (url, options) => {
    requests.push({ url, cache: options.cache });
    return json({ revision: url.includes(`/${revision}/`) ? revision : 'newer-published-data' });
  });
  const catalog = await getJson('../data/iphone-vod-catalog.json', null);
  const manifest = await getJson('../data/vod-query/manifest.json', null);
  assert.equal(catalog.revision, revision);
  assert.equal(manifest.revision, revision);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url.startsWith(`https://raw.githubusercontent.com/SYLONG7708/TV/${revision}/docs/data/`)));
  assert.ok(requests.every(request => request.cache === 'default'));
});

test('missing pinned metadata cannot silently use a different deployment or archive', async () => {
  const requests = [];
  const getJson = client(async url => {
    requests.push(url);
    return url.includes(`/${revision}/`) ? json(null, 404) : json({ revision: 'wrong-data' });
  });
  assert.equal(await getJson('../data/iphone-vod-catalog.json', null), null);
  assert.equal(requests.length, 1);
});

test('historical detail fallback remains available without mixing catalog revisions', async () => {
  const getJson = client(async url => url.includes('TV-archive-20260904') ? json({ title: 'preserved-detail' }) : json(null, 404));
  assert.equal((await getJson('../data/vod-detail/source/page-10.json', null)).title, 'preserved-detail');
});

test('local development and unpinned packages retain their existing primary endpoints', async () => {
  for (const settings of [{ hostname: 'localhost' }, { hostname: 'sylong7708.github.io', dataRevision: 'gh-pages' }]) {
    const requests = [];
    const getJson = client(async url => { requests.push(url); return json({ available: true }); }, settings);
    assert.equal((await getJson('../data/iphone-vod-catalog.json', null)).available, true);
    assert.ok(requests[0].startsWith('../data/iphone-vod-catalog.json?'));
  }
});
