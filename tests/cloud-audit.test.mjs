import assert from 'node:assert/strict';
import test from 'node:test';
import { apiUrl, list, episodeUrls } from '../tools/audit-cloud-media.mjs';
import { parseVodPayload } from '../tools/vod-payload-parser.mjs';
test('Feifei category list is not mistaken for video data with missing titles', () => {
  const movie = { vod_id: 4, vod_name: 'A valid title', vod_play: '第1集$https://example.org/a.m3u8' };
  assert.deepEqual(list({ list: [{ list_id: 1, list_name: '電影' }], data: [movie] }), [movie]);
  assert.deepEqual(episodeUrls(movie), ['https://example.org/a.m3u8']);
});
test('API category and literal search parameters are encoded correctly, including nested APIs', () => {
  const source = { api: 'https://example.org/api?url=https%3A%2F%2Fupstream.org%2Fvod' };
  const nested = new URL(new URL(apiUrl(source, { wd: 'A & B', t: 5 })).searchParams.get('url'));
  assert.equal(nested.searchParams.get('wd'), 'A & B'); assert.equal(nested.searchParams.get('t'), '5');
  assert.equal(nested.searchParams.get('ac'), 'detail');
});
test('Feifei payload normalizes real title, category, episodes and declared pagination', () => {
  const payload = parseVodPayload(JSON.stringify({ page: { pageindex: '2', pagecount: '8', recordcount: '150' }, list: [{ list_id: 3, list_name: '電影' }], data: [{ vod_id: 1, vod_cid: 3, vod_name: 'Actual title', vod_play: '正片$https://example.org/a.m3u8' }] }));
  assert.equal(payload.list[0].vod_name, 'Actual title'); assert.equal(payload.list[0].type_id, 3);
  assert.equal(payload.list[0].vod_play_url, '正片$https://example.org/a.m3u8'); assert.equal(payload.total, 150); assert.equal(payload.page, 2);
});
