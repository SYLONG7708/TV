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
const jsonOutput = path.resolve(args.get('json') || path.join(tvRoot, 'sources', 'live-signal-sources.json'));
const csvOutput = path.resolve(args.get('csv') || path.join(tvRoot, 'sources', 'live-signal-sources.csv'));
const inputFiles = {
  liveBase: path.join(tvRoot, 'sources', 'live-base.txt'),
  liveCleanedBackup: path.join(tvRoot, 'sources', 'live-cleaned-backup.txt'),
  youtubeChannels: path.join(tvRoot, 'sources', 'youtube-live-channels.csv'),
  youtubeGenerated: path.join(tvRoot, 'sources', 'live-youtube-stable.txt'),
};

function repoPath(file) {
  return path.relative(tvRoot, file).replaceAll(path.sep, '/');
}

function normalizeText(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function displayName(value) {
  return normalizeText(value).replace(/^\d{3}\s+/, '').trim();
}

function signalKey(value) {
  return (
    displayName(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/(?:f?hd|1080p|720p)$/i, '')
      .replace(/[^\p{L}\p{N}]+/gu, '') || 'live'
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
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

function signedExpireEpoch(url) {
  const pathMatch = String(url || '').match(/\/expire\/(\d+)(?:\/|$)/);
  if (pathMatch) return Number(pathMatch[1]);
  try {
    const parsed = new URL(url);
    const value = parsed.searchParams.get('expire') || parsed.searchParams.get('expires');
    return value ? Number(value) || 0 : 0;
  } catch {
    return 0;
  }
}

function youtubeVideoId(url) {
  const direct = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/))([A-Za-z0-9_-]{6,})/i);
  if (direct) return direct[1];
  const manifest = String(url || '').match(/\/id\/([^/]+)/i);
  if (!manifest) return '';
  return decodeURIComponent(manifest[1]).split('.')[0].replace(/[^A-Za-z0-9_-]/g, '');
}

function classifyUrl(url) {
  const text = String(url || '');
  if (/manifest\.googlevideo\.com|\.googlevideo\.com/i.test(text)) return 'youtube-generated-hls';
  if (/youtu\.be\/|youtube\.com\/(?:watch|live|embed)/i.test(text)) return 'youtube-page';
  if (/\.m3u8(?:$|[?#])|\/index\.m3u8(?:$|[?#])/i.test(text)) return 'direct-hls';
  if (/\.txt(?:$|[?#])/i.test(text)) return 'playlist-text';
  return 'direct-url';
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function signalPolicy(kind, expireEpoch) {
  if (kind === 'youtube-page') {
    return {
      durable: true,
      continuousUpdate: true,
      updateMode: 'resolve-with-yt-dlp',
      note: 'Durable YouTube watch/live page; scheduled update can resolve a fresh short-lived HLS URL.',
    };
  }
  if (kind === 'direct-hls' && !expireEpoch) {
    return {
      durable: true,
      continuousUpdate: true,
      updateMode: 'retest-existing-hls',
      note: 'Direct HLS URL without a signed expiry; scheduled checks can keep or drop it by health.',
    };
  }
  if (kind === 'youtube-generated-hls' || expireEpoch) {
    return {
      durable: false,
      continuousUpdate: false,
      updateMode: 'generated-short-lived',
      note: 'Generated playback URL; keep the durable page/source URL instead.',
    };
  }
  return {
    durable: false,
    continuousUpdate: false,
    updateMode: 'manual-review',
    note: 'Unknown source type; review before treating it as a durable signal.',
  };
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function parseLiveTxt(text, sourceFile, sourceRole) {
  const out = [];
  let group = '直播';
  let order = 0;
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
    if (!name || !/^https?:\/\//i.test(url)) continue;
    out.push(makeSignal({ group, name, url, sourceFile, sourceRole, order: order += 1 }));
  }
  return out;
}

function parseYoutubeCsv(text, sourceFile) {
  const out = [];
  const lines = text.split(/\r?\n/).filter((line) => normalizeText(line));
  if (!lines.length) return out;
  const headers = parseCsvLine(lines[0]);
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cells = parseCsvLine(lines[rowIndex]);
    const name = normalizeText(cells[index.Name]);
    const url = normalizeText(cells[index.Url]);
    if (!name || !/^https?:\/\//i.test(url)) continue;
    out.push(
      makeSignal({
        group: normalizeText(cells[index.Group]) || 'YouTube',
        name,
        url,
        sourceFile,
        sourceRole: 'durable-youtube-page',
        order: Number(cells[index.Order]) || rowIndex,
      }),
    );
  }
  return out;
}

function makeSignal({ group, name, url, sourceFile, sourceRole, order }) {
  const kind = classifyUrl(url);
  const expireEpoch = signedExpireEpoch(url);
  const policy = signalPolicy(kind, expireEpoch);
  return {
    channelKey: signalKey(name),
    displayName: displayName(name),
    originalName: name,
    group,
    sourceFile: repoPath(sourceFile),
    sourceRole,
    order,
    url,
    host: hostOf(url),
    kind,
    durable: policy.durable,
    continuousUpdate: policy.continuousUpdate,
    updateMode: policy.updateMode,
    updateNote: policy.note,
    signedExpireEpoch: expireEpoch,
    signedExpireAt: expireEpoch ? new Date(expireEpoch * 1000).toISOString() : '',
    youtubeVideoId: youtubeVideoId(url),
  };
}

const allSignals = [
  ...parseLiveTxt(await readIfExists(inputFiles.liveBase), inputFiles.liveBase, 'durable-base-hls'),
  ...parseLiveTxt(await readIfExists(inputFiles.liveCleanedBackup), inputFiles.liveCleanedBackup, 'durable-cleaned-backup-hls'),
  ...parseYoutubeCsv(await readIfExists(inputFiles.youtubeChannels), inputFiles.youtubeChannels),
  ...parseLiveTxt(await readIfExists(inputFiles.youtubeGenerated), inputFiles.youtubeGenerated, 'generated-youtube-hls'),
];

const deduped = [];
const seen = new Set();
for (const signal of allSignals) {
  const key = `${signal.sourceFile}\n${signal.group}\n${signal.originalName}\n${signal.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(signal);
}

const channelMap = new Map();
for (const signal of deduped) {
  if (!channelMap.has(signal.channelKey)) {
    channelMap.set(signal.channelKey, {
      channelKey: signal.channelKey,
      displayName: signal.displayName,
      groups: [],
      signalCount: 0,
      durableSignalCount: 0,
      generatedSignalCount: 0,
      continuousUpdateSignalCount: 0,
      continuousUpdate: false,
      signals: [],
    });
  }
  const channel = channelMap.get(signal.channelKey);
  if (!channel.groups.includes(signal.group)) channel.groups.push(signal.group);
  channel.signalCount += 1;
  if (signal.durable) channel.durableSignalCount += 1;
  if (!signal.durable) channel.generatedSignalCount += 1;
  if (signal.continuousUpdate) channel.continuousUpdateSignalCount += 1;
  channel.continuousUpdate = channel.continuousUpdate || signal.continuousUpdate;
  channel.signals.push(signal);
}

const channels = [...channelMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hant'));
for (const channel of channels) {
  channel.signals.sort(
    (a, b) =>
      Number(b.continuousUpdate) - Number(a.continuousUpdate) ||
      Number(b.durable) - Number(a.durable) ||
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.order - b.order,
  );
}

const sourceRoleCounts = deduped.reduce((acc, signal) => {
  acc[signal.sourceRole] = (acc[signal.sourceRole] || 0) + 1;
  return acc;
}, {});

const output = {
  generatedAt: new Date().toISOString(),
  repository: 'SYLONG7708/TV',
  purpose:
    'Index every live channel name found in repository live source files and record which signals are durable enough for continuous scheduled updates.',
  inputFiles: Object.fromEntries(Object.entries(inputFiles).map(([key, file]) => [key, repoPath(file)])),
  updatePolicies: {
    'durable-base-hls': 'Direct HLS signals from live-base/live-cleaned-backup can be retested and kept when healthy.',
    'durable-youtube-page': 'YouTube page URLs can be resolved by yt-dlp into fresh short-lived HLS signals.',
    'generated-youtube-hls': 'Generated Googlevideo HLS URLs are playback outputs only and expire; do not treat them as durable sources.',
  },
  totals: {
    channels: channels.length,
    signals: deduped.length,
    durableSignals: deduped.filter((signal) => signal.durable).length,
    continuousUpdateSignals: deduped.filter((signal) => signal.continuousUpdate).length,
    generatedSignals: deduped.filter((signal) => !signal.durable).length,
    sourceRoleCounts,
  },
  channels,
};

await fs.mkdir(path.dirname(jsonOutput), { recursive: true });
await fs.writeFile(jsonOutput, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

const csvRows = [
  [
    'channelKey',
    'displayName',
    'groups',
    'sourceFile',
    'sourceRole',
    'originalName',
    'host',
    'kind',
    'durable',
    'continuousUpdate',
    'updateMode',
    'signedExpireAt',
    'youtubeVideoId',
    'url',
  ],
];

for (const channel of channels) {
  for (const signal of channel.signals) {
    csvRows.push([
      channel.channelKey,
      channel.displayName,
      channel.groups.join(' | '),
      signal.sourceFile,
      signal.sourceRole,
      signal.originalName,
      signal.host,
      signal.kind,
      signal.durable,
      signal.continuousUpdate,
      signal.updateMode,
      signal.signedExpireAt,
      signal.youtubeVideoId,
      signal.url,
    ]);
  }
}

await fs.writeFile(csvOutput, `${csvRows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      jsonOutput,
      csvOutput,
      channels: output.totals.channels,
      signals: output.totals.signals,
      durableSignals: output.totals.durableSignals,
      continuousUpdateSignals: output.totals.continuousUpdateSignals,
      generatedSignals: output.totals.generatedSignals,
      sourceRoleCounts,
    },
    null,
    2,
  ),
);
