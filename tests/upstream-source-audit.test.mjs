import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc, normalizeApi, isGeneralSite, compareSources, fetchBoundedText, probeCms, auditSources, renderMarkdown } from '../tools/audit-upstream-sources.mjs';

test('JSONC preserves URL/comment text, escaped quotes and trailing punctuation in strings', () => {
  const text = '\uFEFF{ // note\n "url":"https://example.test/a//b?x=/*text*/", "quote":"a\\\"b", "items":["value,}",], /* note */ }';
  assert.deepEqual(parseJsonc(text), {url: 'https://example.test/a//b?x=/*text*/', quote: 'a"b', items: ['value,}']});
  for (const invalid of ['{"x":1} /* unterminated', '{"x":"unfinished}', '{"x": (() => 42)()}']) assert.throws(() => parseJsonc(invalid));
});

test('API comparison separates exact URLs, output variants and genuinely different hosts', () => {
  assert.equal(normalizeApi('https://example.test/api.php/provide/vod/?ac=list'), normalizeApi('https://example.test/api.php/provide/vod?'));
  assert.equal(normalizeApi('http://www.example.test/api.php/provide/vod/from/test/at/xml/', true), normalizeApi('https://example.test/api.php/provide/vod', true));
  assert.notEqual(normalizeApi('https://mirror.test/api.php/provide/vod', true), normalizeApi('https://example.test/api.php/provide/vod', true));
  assert.throws(() => normalizeApi('https://name:password@example.test/api'));
  assert.throws(() => normalizeApi('file:///tmp/source.json'));
});

test('only selected general HTTP CMS data is queried; Spider and unknown sources stay out', () => {
  const good = {name: '天涯资源', api: 'https://example.test/api.php/provide/vod/', type: 1};
  assert.equal(isGeneralSite(good), true);
  assert.equal(isGeneralSite({...good, type: 0}), true);
  for (const source of [{...good, type: 3}, {...good, type: 4}, {...good, api: 'https://example.test/source.py'}, {...good, api: 'https://example.test/source.jar'}, {...good, name: '不明來源'}, {...good, name: '天涯成人'}]) assert.equal(isGeneralSite(source), false);
});

test('existing membership uses the complete configuration even when its display name differs', () => {
  const existing = [{name: '自訂名稱', api: 'https://example.test/api.php/provide/vod/', type: 1}];
  const upstream = [{name: '豪华资源', api: 'https://example.test/api.php/provide/vod/?ac=list', type: 1, originFile: 'A.json'}, {name: '豪华资源备份', api: 'https://example.test/api.php/provide/vod', type: 1, originFile: '265.json'}];
  const result = compareSources(upstream, existing);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].alreadyConfigured, true);
  assert.deepEqual(result.sources[0].originFiles, ['A.json', '265.json']);
  assert.equal(result.baselines.length, 1);
});

test('bounded reads stop oversized upstream responses and reject HTTP failures', async () => {
  let cancelled = false;
  const fetchImpl = async () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(40));}, cancel() {cancelled = true;}}));
  await assert.rejects(fetchBoundedText('https://example.test', {fetchImpl, maxBytes: 20}), /exceeds/);
  assert.equal(cancelled, true);
  await assert.rejects(fetchBoundedText('https://example.test', {fetchImpl: async () => new Response('no', {status: 403})}), /HTTP 403/);
});

test('HTML success pages are not counted as healthy CMS APIs', async () => {
  const result = await probeCms('https://example.test/api', {fetchImpl: async () => new Response('<html><body>Sign in</body></html>')});
  assert.equal(result.status, 'failed');
  assert.match(result.error, /non-CMS/);
});

test('JSON and XML probes store counts and fingerprints without media URLs or titles', async () => {
  const items = Array.from({length: 5}, (_, i) => ({vod_id: i + 1, vod_name: `一般作品${i}`, type_name: '短剧', vod_time: '2026-11-09 12:00:00', vod_play_url: 'https://media.test/video.m3u8'}));
  const data = {total: 30, class: [{type_id: 1, type_name: '短剧'}, {type_id: 2, type_name: '成人'}], list: items};
  const json = await probeCms('https://example.test/api', {fetchImpl: async () => new Response(JSON.stringify(data))});
  assert.equal(json.status, 'ok'); assert.equal(json.total, 30); assert.equal(json.generalCategoryCount, 1); assert.equal(json.mixedCategories, true); assert.equal(json.headFingerprint.length, 64);
  assert.doesNotMatch(JSON.stringify(json), /media\.test|一般作品|video\.m3u8/);
  const xml = '<rss><class><ty id="1">短剧</ty></class><list recordcount="30"><video><id>1</id><name>一般作品</name><type>短剧</type><last>2026-11-09</last></video></list></rss>';
  const parsed = await probeCms('https://example.test/api', {fetchImpl: async () => new Response(xml)});
  assert.equal(parsed.status, 'ok'); assert.equal(parsed.total, 30); assert.equal(parsed.sampleCount, 1); assert.equal(parsed.headFingerprint, null);
});

test('an audit handles partial upstream failure and identifies mirrors without importing anything', async () => {
  const calls = [], sha = 'a'.repeat(40), mainApi = 'https://primary.test/api.php/provide/vod';
  const source = (name, api, type = 1) => ({name, api, type});
  const sites = [source('天涯资源', mainApi + '/?ac=list'), source('天涯变体', 'http://primary.test/api.php/provide/vod/at/json'), source('天涯镜像', 'https://mirror.test/api.php/provide/vod'), source('金蝉影视', 'https://new.test/api'), source('天涯脚本', 'https://scripts.test/file.py', 3)];
  const snapshot = JSON.stringify(sites);
  const payload = {total: 99, class: [{type_id: 1, type_name: '短剧'}], list: Array.from({length: 5}, (_, i) => ({vod_id: i, vod_name: `一般作品${i}`, type_name: '短剧'}))};
  const fetchImpl = async (url, options) => {
    const u = new URL(url); calls.push({url: u.href, authorization: options.headers.authorization});
    if (u.hostname === 'api.github.com') return new Response(JSON.stringify({sha}));
    if (u.hostname === 'raw.githubusercontent.com') {
      assert.equal(options.headers.authorization, undefined);
      if (u.pathname.endsWith('/A2.json')) return new Response('unavailable', {status: 503});
      return new Response(JSON.stringify({sites: u.pathname.endsWith('/265.json') ? sites : []}));
    }
    if (u.hostname === 'new.test') return new Response('<html>not an API</html>');
    return new Response(JSON.stringify(payload));
  };
  const report = await auditSources({configuredSites: [source('天涯资源', mainApi)], fetchImpl, githubToken: 'test-token', now: new Date('2026-11-09T12:00:00Z')});
  assert.equal(report.upstreamRevision, sha);
  assert.deepEqual(report.totals, {generalApis: 4, alreadyConfigured: 1, candidates: 3, candidateOk: 2, candidateFailed: 1, variants: 1, probableMirrors: 1, needsReview: 0});
  assert.equal(report.configurations.filter(x => x.status === 'failed').length, 1);
  assert.equal(report.mode, 'audit-only'); assert.equal(report.playbackSourcesChanged, false);
  assert.equal(JSON.stringify(sites), snapshot);
  assert.equal(calls.some(x => x.url.includes('scripts.test')), false);
  assert.equal(calls[0].authorization, 'Bearer test-token');
  assert.doesNotMatch(JSON.stringify(report), /test-token|一般作品/);
  assert.match(renderMarkdown(report), /只更新比對報告/);
});

test('total upstream failure reports failure instead of declaring an empty healthy source list', async () => {
  await assert.rejects(auditSources({configuredSites: [], fetchImpl: async () => new Response('failed', {status: 503})}), /All upstream configurations failed/);
});
