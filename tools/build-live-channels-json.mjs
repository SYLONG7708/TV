import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const tvRoot = path.resolve(args.get('tvRoot') || path.resolve(import.meta.dirname, '..'));
const input = path.resolve(args.get('input') || path.join(tvRoot, 'sources', 'live-stable.txt'));
const output = path.resolve(args.get('output') || path.join(tvRoot, 'docs', 'data', 'live-channels.json'));
const summaryOutput = path.resolve(args.get('summary') || path.join(tvRoot, 'docs', 'data', 'source-summary.json'));
const minValidSeconds = Number(args.get('minValidSeconds') || 600);
const nowEpoch = Math.floor(Date.now() / 1000);
const liveNote = '直播來源由 sources/live-stable.txt 重建為 docs/data/live-channels.json，YouTube 簽名 HLS 會由自動排程重新刷新。';

function normalizeText(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function slug(value) {
  return (
    normalizeText(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'live'
  );
}

function detectKind(url) {
  if (youtubeVideoId(url)) return 'youtube';
  if (/youtu\.be\/|youtube\.com\/watch|youtube\.com\/live/i.test(url)) return 'external';
  if (/\.m3u8(?:$|[?#])|manifest\/hls|mime=application%2Fx-mpegURL/i.test(url)) return 'hls';
  return 'direct';
}

function youtubeVideoId(url) {
  const direct = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/))([A-Za-z0-9_-]{6,})/i);
  if (direct) return direct[1];
  const manifest = String(url || '').match(/\/id\/([^/]+)/i);
  if (!manifest) return '';
  const decoded = decodeURIComponent(manifest[1]);
  return decoded.split('.')[0].replace(/[^A-Za-z0-9_-]/g, '');
}

function youtubeUrls(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) return {};
  return {
    pageUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0`,
  };
}

function signedExpire(url) {
  const match = String(url || '').match(/\/expire\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : 0;
}

function parseLive(text) {
  const channels = [];
  const seenUrls = new Set();
  const seenIds = new Map();
  let group = '直播';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (!line) continue;

    if (/#genre#$/i.test(line)) {
      group = normalizeText(line.replace(/,?#genre#$/i, '')) || '直播';
      continue;
    }

    const separator = line.indexOf(',');
    if (separator < 1) continue;

    const name = normalizeText(line.slice(0, separator));
    const url = normalizeText(line.slice(separator + 1));
    if (!name || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;

    const expire = signedExpire(url);
    if (expire && expire - nowEpoch < minValidSeconds) continue;

    const kind = detectKind(url);
    const extraUrls = youtubeUrls(url);
    const baseId = `${slug(group)}-${slug(name)}`;
    const count = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, count);
    seenUrls.add(url);

    channels.push({
      id: `${baseId}-${count}`,
      name,
      group,
      url,
      logo: '',
      kind,
      playable: kind !== 'external' || Boolean(extraUrls.embedUrl),
      origin: path.basename(input),
      ...extraUrls,
    });
  }

  return channels;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || '';
    if (value) acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

const sourceText = await fs.readFile(input, 'utf8');
const channels = parseLive(sourceText);
const groups = [...new Set(channels.map((channel) => channel.group))];
const kinds = countBy(channels, 'kind');

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(channels, null, 2)}\n`, 'utf8');

const summary = await readJson(summaryOutput, {});
summary.generatedAt = new Date().toISOString();
summary.input = {
  ...(summary.input || {}),
  live: input,
};
summary.live = {
  count: channels.length,
  playableCount: channels.filter((channel) => channel.playable).length,
  externalCount: channels.filter((channel) => channel.kind === 'external').length,
  networkOnlyCount: channels.filter((channel) => !/^https?:\/\//i.test(channel.url)).length,
  kinds,
  groups,
};
summary.notes = Array.isArray(summary.notes) ? summary.notes : [];
summary.notes = summary.notes.filter((note) => note !== liveNote && !/YouTube.*external|直播.*external/i.test(note));
summary.notes.push(liveNote);

await fs.mkdir(path.dirname(summaryOutput), { recursive: true });
await fs.writeFile(summaryOutput, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      input,
      output,
      summaryOutput,
      channels: channels.length,
      playable: channels.filter((channel) => channel.playable).length,
      groups: groups.length,
      kinds,
    },
    null,
    2,
  ),
);
