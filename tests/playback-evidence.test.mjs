import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPlaybackEvidence, firstPlaylistUri, playbackKind, probePlayback, vodCandidates } from '../tools/check-playback-evidence.mjs';

const transport = new Uint8Array(188 * 12);
for (let offset = 0; offset < transport.length; offset += 188) transport[offset] = 0x47;

function fixtureFetch(routes, requests = []) {
  return async (url, options) => {
    requests.push({ url: String(url), range: options.headers.range || '' });
    const route = routes[String(url)];
    if (!route) return new Response('missing', { status: 404 });
    return new Response(route.body, { status: route.status || 200, headers: { 'content-type': route.type || 'application/octet-stream' } });
  };
}

test('YouTube watch and embed pages are never reported as verified media', async () => {
  assert.equal(playbackKind('https://www.youtube.com/watch?v=abc1234'), 'embed');
  assert.equal(playbackKind('https://www.youtube.com/embed/abc1234'), 'embed');
  const probe = await probePlayback('https://www.youtube.com/watch?v=abc1234', {
    fetchImpl: () => { throw new Error('should not fetch HTML as video'); },
  });
  assert.equal(probe.verified, false);
  assert.match(probe.reason, /browser playback/);
});

test('HLS master, variant, and actual transport segment must all be available', async () => {
  const requests = [];
  const fetchImpl = fixtureFetch({
    'https://media.example/master.m3u8': { body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant/index.m3u8\n' },
    'https://media.example/variant/index.m3u8': { body: '#EXTM3U\n#EXTINF:4.0,\nsegment.ts\n' },
    'https://media.example/variant/segment.ts': { body: transport, type: 'video/mp2t' },
  }, requests);
  const probe = await probePlayback('https://media.example/master.m3u8', { fetchImpl });
  assert.equal(probe.verified, true);
  assert.deepEqual(requests.map((row) => row.url), [
    'https://media.example/master.m3u8',
    'https://media.example/variant/index.m3u8',
    'https://media.example/variant/segment.ts',
  ]);
  assert.equal(requests.at(-1).range, 'bytes=0-32767');
  assert.equal(firstPlaylistUri('#EXTM3U\n#EXTINF:4.0,\na.ts\n'), 'a.ts');
});

test('an HTTP 200 HTML challenge is not mistaken for a playable episode', async () => {
  const fetchImpl = fixtureFetch({ 'https://media.example/movie.mp4': { body: '<!doctype html><html>' + 'challenge '.repeat(300), type: 'text/html' } });
  const probe = await probePlayback('https://media.example/movie.mp4', { fetchImpl });
  assert.equal(probe.verified, false);
  const unknown = await probePlayback('https://media.example/unknown', {
    fetchImpl: fixtureFetch({ 'https://media.example/unknown': { body: new Uint8Array(4096).fill(65) } }),
  });
  assert.equal(unknown.verified, false);
  const mislabeled = await probePlayback('https://media.example/mislabeled.mp4', {
    fetchImpl: fixtureFetch({ 'https://media.example/mislabeled.mp4': { body: new Uint8Array(4096).fill(65), type: 'video/mp4' } }),
  });
  assert.equal(mislabeled.verified, false);
});

test('VOD report samples sources separately and marks missing samples', async () => {
  const sources = [{ id: 'working', name: 'Working' }, { id: 'missing', name: 'Missing' }];
  const items = [{ sourceId: 'working', episodes: [{ url: 'https://media.example/movie.mp4' }] }];
  assert.equal(vodCandidates(sources, items).get('working').length, 1);
  const fetchImpl = fixtureFetch({ 'https://media.example/movie.mp4': { body: transport, type: 'video/mp2t' } });
  const report = await checkPlaybackEvidence({
    sources, items,
    channels: [
      { id: 'yt', name: 'YT', kind: 'youtube', embedUrl: 'https://www.youtube.com/embed/abc1234' },
      { id: 'external', name: 'External', kind: 'external', url: 'https://www.youtube.com/channel/UC123/live' },
    ],
    fetchImpl,
  });
  assert.deepEqual(report.summary.vod, { sources: 2, sampled: 1, verified: 1, failed: 0, noSample: 1 });
  assert.equal(report.summary.live.embedUnverified, 1);
  assert.equal(report.summary.live.externalUnverified, 1);
  assert.equal(report.summary.live.directVerified, 0);
});
