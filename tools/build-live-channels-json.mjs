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
const liveNote = '直播 TXT 只收錄直接串流；手機與 APK 的 GitHub 網頁持續提供 YouTube 官方嵌入入口。GitHub 排程會移除過期短效網址並重建清單，無須重新安裝 App。';

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

function parseCsvRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map(normalizeText);
}

async function addWebYouTubeFallbacks(channels) {
  const csvPath = path.join(tvRoot, 'sources', 'youtube-live-channels.csv');
  let csvText;
  try {
    csvText = await fs.readFile(csvPath, 'utf8');
  } catch {
    return channels;
  }
  const rows = csvText.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  if (!rows.length) return channels;
  const header = rows.shift().map((cell) => cell.toLowerCase());
  const column = (name) => header.indexOf(name.toLowerCase());
  if (['Order', 'Group', 'Name', 'Url'].some((name) => column(name) < 0)) return channels;
  const existingIds = new Set(channels.map((channel) => youtubeVideoId(channel.url)).filter(Boolean));
  const existingNames = new Set(channels.map((channel) => `${channel.group}|${channel.name}`));
  for (const row of rows) {
    const pageUrl = row[column('Url')];
    const videoId = youtubeVideoId(pageUrl);
    if (!videoId || existingIds.has(videoId)) continue;
    const group = row[column('Group')] || 'YouTube';
    const order = Number(row[column('Order')]);
    const rawName = row[column('Name')];
    const name = Number.isFinite(order) && order > 0 ? `${String(order).padStart(3, '0')} ${rawName}` : rawName;
    if (!rawName || existingNames.has(`${group}|${name}`)) continue;
    const urls = youtubeUrls(pageUrl);
    channels.push({
      id: `${slug(group)}-${slug(name)}-web`,
      name,
      group,
      url: urls.pageUrl,
      logo: '',
      kind: 'youtube',
      playable: true,
      origin: 'youtube-live-channels.csv',
      ...urls,
    });
    existingIds.add(videoId);
    existingNames.add(`${group}|${name}`);
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
const channels = await addWebYouTubeFallbacks(parseLive(sourceText));
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
  ...(summary.live || {}),
  webCatalogBuiltAt: new Date().toISOString(),
  catalogRefreshProvider: 'github-actions',
  count: channels.length,
  playableCount: channels.filter((channel) => channel.playable).length,
  directStreamCount: channels.filter((channel) => !/youtu\.be\/|youtube\.com\/(?:watch|live|embed)/i.test(channel.url)).length,
  webYouTubeFallbackCount: channels.filter((channel) => channel.origin === 'youtube-live-channels.csv').length,
  externalCount: channels.filter((channel) => channel.kind === 'external').length,
  networkOnlyCount: channels.filter((channel) => !/^https?:\/\//i.test(channel.url)).length,
  kinds,
  groups,
};
summary.notes = Array.isArray(summary.notes) ? summary.notes : [];
summary.notes = summary.notes.filter((note) => !/短效 HLS 由店內排程更新/.test(note) && note !== liveNote && !/^直播來源由 sources\/live-stable\.txt/.test(note) && !/YouTube.*external|直播.*external/i.test(note));
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
