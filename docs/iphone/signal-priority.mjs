// Quality is evidence, never a fabricated property of a title or provider.
export const SIGNAL_HISTORY_KEY = 'oktv:signal-history:v1';
export function startupVariants(episode) {
  const variants = (episode?.variants || []).filter(row => /^https:\/\//i.test(row.url || ''));
  if (!variants.length) return [{ url: episode?.url }];
  // Begin progressive MP4 at a practical resolution instead of downloading a
  // large 1080p/4K initial range on a tethered car connection. Other genuine
  // variants remain selectable and available for automatic fallback.
  const preferred = variants.filter(row => Number(row.height) > 0 && Number(row.height) <= 720).sort((a, b) => b.height - a.height)[0] || variants[0];
  return [preferred, ...variants.filter(row => row.url !== preferred.url)];
}
export function signalKey(value) {
  let url;
  try { url = new URL(String(value)); url.hash = ''; } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  let hash = 2166136261;
  for (const char of url.href) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function episodeIdentity(value) {
  const name = String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const dated = name.match(/^(?:第)?((?:19|20)\d{2})[-./年]?(\d{2})[-./月]?(\d{2})(?:日)?(.*?)(?:期|集)?$/);
  if (dated) {
    const [, year, month, day, edition] = dated;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`)
      return `date:${year}${month}${day}:${edition.replace(/[()（）]/g, '')}`;
  }
  const numbered = name.match(/^(?:第)?(\d+)(?:集|話|话|期|回)?$/) || name.match(/^(?:ep(?:isode)?[._-]?)(\d+)$/);
  return numbered ? `episode:${Number(numbered[1])}` : `label:${name}`;
}
export function playbackTitle(item, requested, compact) {
  const title = compact(item?.title || '');
  return item?.kind === 'variety' && episodeIdentity(requested?.name).startsWith('date:')
    ? title.replace(/(?:19|20)\d{2}$/, '') : title;
}
export function samePlaybackWork(left, right, requested, compact, identity) {
  if (identity(left) === identity(right)) return true;
  // Dated daily shows may report a start year or a collection year. The exact
  // broadcast date AND edition must still match below; movies/remakes do not use this exception.
  return left?.kind === 'variety' && right?.kind === 'variety' && !left.adult && !right.adult
    && episodeIdentity(requested?.name).startsWith('date:')
    && playbackTitle(left, requested, compact).length >= 4
    && playbackTitle(left, requested, compact) === playbackTitle(right, requested, compact);
}
export function matchingEpisodes(item, requested, original, index) {
  const rows = Array.isArray(item?.episodes) ? item.episodes : [];
  if (item?.id === original?.id && rows[index] === requested) {
    return [requested, ...rows.filter(row => row !== requested && episodeIdentity(row.name) === episodeIdentity(requested.name))];
  }
  const key = episodeIdentity(requested?.name);
  if (key !== 'label:') {
    const found = rows.filter(row => episodeIdentity(row.name) === key);
    if (found.length) return found;
  }
  // A single movie can have different edition labels. A series cannot safely
  // fall back by array index: another provider may omit episodes or specials.
  return original?.kind === 'movie' && original.episodes?.length === 1 && rows.length === 1 ? rows : [];
}
export function createSignalPriority({ storage, now = Date.now } = {}) {
  let history = {};
  try { history = JSON.parse(storage?.getItem(SIGNAL_HISTORY_KEY) || '{}'); } catch {}
  if (!history || typeof history !== 'object' || Array.isArray(history)) history = {};
  let cloud = { signals: {}, sources: {} };
  function persist() {
    history = Object.fromEntries(Object.entries(history).filter(([, row]) => row && now() - row.updated < 7 * 864e5)
      .sort((a, b) => b[1].updated - a[1].updated).slice(0, 300));
    try { storage?.setItem(SIGNAL_HISTORY_KEY, JSON.stringify(history)); } catch {}
  }
  function record(candidate, event, detail = {}) {
    const key = signalKey(candidate.embedUrl || candidate.url);
    if (!key) return;
    const row = history[key] || { successes: 0, failures: 0, stalls: 0 };
    if (event === 'playing') {
      row.successes++; row.lastSuccess = now(); row.failures = 0;
      if (Number.isFinite(detail.startupMs)) row.startupMs = detail.startupMs;
      if (Number.isFinite(detail.height)) row.height = detail.height;
    } else if (event === 'failure') { row.failures++; row.lastFailure = now(); }
    else if (event === 'stall') { row.stalls++; row.lastStall = now(); }
    row.updated = now(); history[key] = row; persist();
  }
  function setCloud(report) {
    const age = now() - Date.parse(report?.checkedAt || '');
    cloud = Number.isFinite(age) && age >= -300000 && age < 36 * 36e5 ? report : { signals: {}, sources: {} };
  }
  function evidence(candidate) {
    const key = signalKey(candidate.embedUrl || candidate.url);
    return { local: history[key] || {}, remote: cloud.signals?.[key] || {}, source: cloud.sources?.[candidate.sourceId] || {} };
  }
  function score(candidate) {
    const { local, remote, source } = evidence(candidate);
    let value = candidate.embedUrl ? -20 : 0;
    if (now() - (local.lastSuccess || 0) < 2 * 864e5) {
      value += 100 - Math.min(30, Number(local.startupMs || 0) / 400);
      value += Math.min(6, Number(local.height || 0) / 360);
    }
    if (now() - (local.lastFailure || 0) < 10 * 60e3) value -= 150 + Math.min(3, local.failures || 0) * 20;
    if (now() - (local.lastStall || 0) < 60 * 60e3) value -= Math.min(30, (local.stalls || 0) * 5);
    if (remote.verified === true) value += 35 - Math.min(20, Number(remote.elapsedMs || 0) / 500);
    if (remote.status === 'failed') value -= 60;
    // A successful sample from a provider is only a modest prior, not proof
    // that another movie on that provider works.
    if (source.tested > 0) value += 12 * (Number(source.verified || 0) / source.tested) - 6;
    return value;
  }
  function rank(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
      const key = signalKey(candidate.embedUrl || candidate.url);
      const id = key || `item:${candidate.itemId || candidate.id || ''}`;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }).map((candidate, index) => ({ candidate, index, score: score(candidate) }))
      .sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.candidate);
  }
  return { rank, record, setCloud, score, evidence, snapshot: () => ({ ...history }) };
}
