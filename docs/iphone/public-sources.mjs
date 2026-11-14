export const PUBLIC_SOURCE_PREFIX = 'public-';
export function liveChannelIdentity(channel) {
  const name = String(channel?.name || '').normalize('NFKC').toLowerCase()
    .replace(/^\d+[\s._-]*/, '').replace(/[|｜]官方串流$/, '').replace(/\s+/g, '');
  // Only explicitly identified simulcasts are interchangeable; languages and editions stay distinct.
  const aliases = {
    'france24english': 'france24-en', 'france24英語': 'france24-en',
    'france24français': 'france24-fr', 'france24法語': 'france24-fr',
    'france24español': 'france24-es', 'france24西班牙語': 'france24-es',
    'france24阿拉伯語': 'france24-ar', 'arirangtv': 'arirang-world', 'arirangun': 'arirang-un',
  };
  return aliases[name] || `name:${name}`;
}
export function publicHttpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
// Supplemental catalogs cannot replace legacy sources or insert executable URLs.
export function normalizePublicSources(payload) {
  const empty = { sources: [], items: [], live: [] };
  if (payload?.schemaVersion !== 1) return empty;
  const sources = (Array.isArray(payload.sources) ? payload.sources : []).filter(s => s && typeof s.id === 'string' && s.id.startsWith(PUBLIC_SOURCE_PREFIX) && !s.adult).slice(0, 100);
  const ids = new Set(sources.map(s => s.id)), seen = new Set();
  const items = (Array.isArray(payload.items) ? payload.items : []).filter(i => {
    if (!i || !ids.has(i.sourceId) || typeof i.id !== 'string' || !i.id.startsWith(`${i.sourceId}:`) || seen.has(i.id) || i.adult || !i.rights?.attribution || !publicHttpsUrl(i.rights.originalPage) || !publicHttpsUrl(i.rights.licenseUrl) || !Array.isArray(i.episodes) || !i.episodes.length || i.episodes.some(e => !publicHttpsUrl(e?.url) || (e.variants !== undefined && (!Array.isArray(e.variants) || e.variants.some(v => !publicHttpsUrl(v?.url)))))) return false;
    seen.add(i.id); return true;
  }).slice(0, 10000);
  const liveIds = new Set(), urls = new Set();
  const live = (Array.isArray(payload.live) ? payload.live : []).filter(i => {
    if (!i || typeof i.id !== 'string' || !i.id.startsWith(PUBLIC_SOURCE_PREFIX) || !publicHttpsUrl(i.url) || !publicHttpsUrl(i.pageUrl) || liveIds.has(i.id) || urls.has(i.url)) return false;
    liveIds.add(i.id); urls.add(i.url); return true;
  }).slice(0, 500);
  return { sources: sources.filter(s => items.some(i => i.sourceId === s.id)).map(s => ({ ...s, itemCount: items.filter(i => i.sourceId === s.id).length, playableCount: items.filter(i => i.sourceId === s.id).length })), items, live };
}
export function mergePublicLive(existing, added) {
  const ids = new Set(existing.map(i => i.id)), urls = new Set(existing.map(i => i.url));
  return withLiveAlternates([...existing, ...added.filter(i => { if (ids.has(i.id) || urls.has(i.url)) return false; ids.add(i.id); urls.add(i.url); return true; })]);
}
export function withLiveAlternates(channels) {
  return channels.map(channel => {
    const others = channels.filter(row => row.id !== channel.id && liveChannelIdentity(row) === liveChannelIdentity(channel));
    const seen = new Set([channel.embedUrl || channel.url]);
    const alternates = [...(channel.alternates || []), ...others.map(row => ({ url: row.url, ...(row.embedUrl ? { embedUrl: row.embedUrl } : {}), sourceName: row.group || row.name }))]
      .filter(row => { const url = typeof row === 'string' ? row : row.embedUrl || row.url; if (!publicHttpsUrl(url) || seen.has(url)) return false; seen.add(url); return true; }).slice(0, 4);
    return alternates.length ? { ...channel, alternates } : channel;
  });
}
