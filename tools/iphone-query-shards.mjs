import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const QUERY_SHARD_VERSION = 2;
export const DEFAULT_BUCKET_COUNT = 2048;
export const DEFAULT_MIN_QUERY_LENGTH = 2;
// Zero means unlimited. Search completeness is more important than silently
// dropping a valid source or a less-popular title from a crowded prefix.
export const DEFAULT_MAX_SIGNALS_PER_TITLE = 0;
export const DEFAULT_MAX_GROUPS_PER_PREFIX = 0;
export const DEFAULT_MAX_EMBEDDED_EPISODES = 2000;

const COMPACT_RE = /[\s\-_.:：/\\|,，。！!？?·'"()[\]{}]+/g;

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function bucketForPrefix(prefix, bucketCount = DEFAULT_BUCKET_COUNT) {
  const count = Math.max(1, Number(bucketCount) || DEFAULT_BUCKET_COUNT);
  return fnv1a(prefix) % count;
}

export function bucketPadWidth(bucketCount = DEFAULT_BUCKET_COUNT) {
  return Math.max(4, String(Math.max(0, Number(bucketCount) - 1)).length);
}

export function bucketName(bucket, bucketCount = DEFAULT_BUCKET_COUNT) {
  return `b-${String(bucket).padStart(bucketPadWidth(bucketCount), '0')}.json.gz`;
}

export function limitQueryGroups(groups, maxGroupsPerPrefix = DEFAULT_MAX_GROUPS_PER_PREFIX) {
  const rows = Array.isArray(groups) ? groups : [];
  return maxGroupsPerPrefix > 0 ? rows.slice(0, maxGroupsPerPrefix) : rows;
}

export function readGzipJson(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

export function writeGzipJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const gzip = zlib.gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
  fs.writeFileSync(file, gzip);
  return gzip.length;
}

export function loadSimplifiedCharMap(iphoneHtmlPath) {
  try {
    const html = fs.readFileSync(iphoneHtmlPath, 'utf8');
    const match = html.match(/const ZH_CHAR_MAP = (\{[\s\S]*?\});/);
    if (!match) return {};
    const traditionalBySimplified = Function(`"use strict"; return (${match[1]});`)();
    return Object.fromEntries(
      Object.entries(traditionalBySimplified).map(([simplified, traditional]) => [traditional, simplified]),
    );
  } catch {
    return {};
  }
}

export function createQueryNormalizer(iphoneHtmlPath) {
  const simplifiedByTraditional = loadSimplifiedCharMap(iphoneHtmlPath);
  const toSimplified = (value) =>
    String(value ?? '').replace(
      /[\u3400-\u9fff]/g,
      (character) => simplifiedByTraditional[character] || character,
    );
  const compact = (value) =>
    toSimplified(value)
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(COMPACT_RE, '');
  return { compact, toSimplified, mapSize: Object.keys(simplifiedByTraditional).length };
}

export function queryPrefixesForItem(item, normalizer, minQueryLength = DEFAULT_MIN_QUERY_LENGTH) {
  const minimum = Math.max(1, Number(minQueryLength) || DEFAULT_MIN_QUERY_LENGTH);
  const prefixes = new Set();
  const aliases = Array.isArray(item?.titleAliases) ? item.titleAliases : [];
  for (const value of [item?.title, item?.originalName, ...aliases]) {
    const compact = normalizer.compact(value);
    const characters = [...compact];
    if (characters.length < minimum) continue;
    prefixes.add(characters.slice(0, minimum).join(''));
  }
  return [...prefixes];
}

export function normalizedTitleKey(item, normalizer) {
  return normalizer.compact(item?.title) || normalizer.compact(item?.originalName) || String(item?.id || '');
}

export function leanQueryItem(item, source = {}) {
  return {
    id: String(item?.id || ''),
    sourceId: String(item?.sourceId || source?.id || ''),
    sourceName: String(item?.sourceName || source?.name || ''),
    vodId: String(item?.vodId || ''),
    title: String(item?.title || ''),
    originalName: String(item?.originalName || ''),
    kind: String(item?.kind || ''),
    categoryName: String(item?.categoryName || ''),
    year: String(item?.year || ''),
    area: String(item?.area || ''),
    genre: Array.isArray(item?.genre) ? item.genre.map(String).filter(Boolean) : [],
    remarks: String(item?.remarks || ''),
    poster: String(item?.poster || ''),
    episodeCount: Number(item?.episodeCount || item?.episodes?.length || 0),
    playable: item?.playable !== false,
    adult: Boolean(item?.adult || source?.adult),
    detailPath: String(item?.detailPath || ''),
    score: Number(item?.score || 0),
    hot: Number(item?.hot || 0),
    updatedAt: String(item?.updatedAt || ''),
    ...(Array.isArray(item?.episodes) && item.episodes.length
      ? {
          episodes: item.episodes
            .slice(0, DEFAULT_MAX_EMBEDDED_EPISODES)
            .map((episode) => ({
              name: String(episode?.name || ''),
              url: String(episode?.url || ''),
            }))
            .filter((episode) => /^https?:\/\//i.test(episode.url)),
        }
      : {}),
  };
}

function itemQuality(item) {
  const embedded = Array.isArray(item?.episodes) ? item.episodes.length : 0;
  return (
    embedded * 1_000_000_000 +
    (item?.poster ? 100_000_000 : 0) +
    (item?.playable !== false ? 10_000_000 : 0) +
    Number(item?.hot || 0) +
    Number(item?.score || 0) * 1000 +
    Number(item?.episodeCount || 0)
  );
}

function groupBase(item, key) {
  return {
    k: key,
    title: item.title || '',
    originalName: item.originalName || '',
    kind: item.kind || '',
    categoryName: item.categoryName || '',
    year: item.year || '',
    area: item.area || '',
    genre: Array.isArray(item.genre) ? item.genre : [],
    poster: item.poster || '',
    score: Number(item.score || 0),
    hot: Number(item.hot || 0),
    updatedAt: item.updatedAt || '',
    _quality: itemQuality(item),
    signals: [],
  };
}

function signalFromItem(item) {
  return {
    id: item.id || '',
    sourceId: item.sourceId || '',
    sourceName: item.sourceName || '',
    vodId: item.vodId || '',
    remarks: item.remarks || '',
    episodeCount: Number(item.episodeCount || item.episodes?.length || 0),
    playable: item.playable !== false,
    adult: Boolean(item.adult),
    detailPath: item.detailPath || '',
    score: Number(item.score || 0),
    hot: Number(item.hot || 0),
    updatedAt: item.updatedAt || '',
    ...(Array.isArray(item.episodes) && item.episodes.length ? { episodes: item.episodes } : {}),
  };
}

function signalKey(signal) {
  return `${signal.sourceId || ''}\u001f${signal.vodId || signal.id || ''}`;
}

function normalizeExistingGroup(group) {
  const signals = Array.isArray(group?.signals) ? [...group.signals] : [];
  const quality = signals.reduce(
    (best, signal) => Math.max(best, itemQuality({ ...group, ...signal })),
    itemQuality(group),
  );
  return {
    ...group,
    _quality: Number(group?._quality || quality),
    signals,
  };
}

export function mergeItemsIntoGroups(
  existingGroups,
  items,
  {
    normalizer,
    maxSignalsPerTitle = DEFAULT_MAX_SIGNALS_PER_TITLE,
  },
) {
  const groups = new Map();
  for (const existing of existingGroups || []) {
    if (!existing?.k) continue;
    groups.set(existing.k, normalizeExistingGroup(existing));
  }

  for (const item of items || []) {
    if (!item?.id || !item?.title || !item?.detailPath || item.playable === false) continue;
    if (Number(item.episodeCount || item.episodes?.length || 0) < 1) continue;
    const key = normalizedTitleKey(item, normalizer);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = groupBase(item, key);
      groups.set(key, group);
    } else if (itemQuality(item) > Number(group._quality || 0)) {
      const signals = group.signals;
      group = { ...groupBase(item, key), signals };
      groups.set(key, group);
    }

    const nextSignal = signalFromItem(item);
    const nextKey = signalKey(nextSignal);
    const existingIndex = group.signals.findIndex((signal) => signalKey(signal) === nextKey);
    if (existingIndex >= 0) {
      if (itemQuality(nextSignal) >= itemQuality(group.signals[existingIndex])) {
        group.signals[existingIndex] = nextSignal;
      }
    } else {
      group.signals.push(nextSignal);
    }
  }

  const output = [...groups.values()];
  for (const group of output) {
    group.signals.sort((left, right) => itemQuality(right) - itemQuality(left));
    if (maxSignalsPerTitle > 0 && group.signals.length > maxSignalsPerTitle) {
      group.signals = group.signals.slice(0, maxSignalsPerTitle);
    }
    delete group._quality;
  }
  output.sort((left, right) => Number(right.hot || 0) - Number(left.hot || 0) || left.k.localeCompare(right.k));
  return output;
}

export function expandQueryGroups(payload) {
  const rows = [];
  for (const group of payload?.groups || []) {
    for (const signal of group?.signals || []) {
      rows.push({
        title: group.title || '',
        originalName: group.originalName || '',
        kind: group.kind || '',
        categoryName: group.categoryName || '',
        year: group.year || '',
        area: group.area || '',
        genre: Array.isArray(group.genre) ? group.genre : [],
        poster: group.poster || '',
        score: Number(signal.score || group.score || 0),
        hot: Number(signal.hot || group.hot || 0),
        updatedAt: signal.updatedAt || group.updatedAt || '',
        ...signal,
      });
    }
  }
  return rows;
}
