import { episodeIdentity, playbackTitle, samePlaybackWork, createSignalPriority } from '../docs/iphone/signal-priority.mjs';
import { workIdentity, sameDetailIdentity } from '../docs/iphone/title-quality.mjs';
const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const identity = row => workIdentity(row, compact);
const https = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
export function buildLegacyRepairs(targets, details, health, { maxBytes = 3 * 1024 * 1024, maxItems = 500, now = Date.now() } = {}) {
  const ranker = createSignalPriority({ now: () => now }); ranker.setCloud(health);
  const byId = new Map(details.map(row => [row.id, row])), groups = new Map();
  for (const row of details) {
    if (!row || row.adult || !row.episodes?.length) continue;
    const keys = [identity(row)];
    if (row.kind === 'variety') keys.push('daily:' + playbackTitle(row, { name: '20260101' }, compact));
    for (const key of keys) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  }
  const items = [], counts = { candidates: 0, repairedEpisodes: 0, alternatives: 0, skippedForSize: 0 };
  let bytes = 0;
  for (const target of targets) {
    const original = byId.get(target.id);
    if (!original || !sameDetailIdentity(original, target, compact) || original.adult || !original.episodes?.length || items.length >= maxItems) continue;
    const peers = [...new Set([...(groups.get(identity(original)) || []), ...(original.kind === 'variety' ? groups.get('daily:' + playbackTitle(original, { name: '20260101' }, compact)) || [] : [])])];
    if (peers.length < 2) continue;
    const peerEpisodes = new Map(peers.map(peer => [peer, new Map(peer.episodes.map(ep => [episodeIdentity(ep.name), ep]))]));
    let repaired = 0, added = 0;
    const episodes = original.episodes.map((episode, index) => {
      const key = episodeIdentity(episode.name);
      // Keep all episode names/order; old apps key remembered progress by index.
      const entry = { ...episode };
      const date = key.match(/^date:(\d{4})(\d{2})(\d{2}):/);
      if (date && Date.parse(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`) < now - 45 * 864e5 && index !== 0) return entry;
      const alternatives = [];
      for (const peer of peers) {
        if (!samePlaybackWork(original, peer, episode, compact, identity)) continue;
        const match = peerEpisodes.get(peer).get(key);
        // Do not use positional fallback or substitute a different movie edition.
        if (!match) continue;
        for (const variant of match.variants?.length ? match.variants : [{ url: match.url }]) {
          const url = https(variant.url); if (url) alternatives.push({ ...variant, url, sourceId: peer.sourceId, sourceName: peer.sourceName });
        }
      }
      const unique = ranker.rank(alternatives);
      if (unique.length > 1) {
        entry.variants = unique.slice(0, 4).map(row => ({ url: row.url, label: row.label || row.sourceName || '同集備援', ...(row.height ? { height: row.height } : {}) }));
        repaired++; added += entry.variants.length - 1;
      }
      return entry;
    });
    if (!repaired) continue;
    counts.candidates++;
    const row = { ...target, episodes, lazyEpisodes: false, episodeCount: episodes.length, cloudPlaybackRepairAt: new Date(now).toISOString() };
    const size = Buffer.byteLength(JSON.stringify(row));
    if (bytes + size > maxBytes) { counts.skippedForSize++; continue; }
    bytes += size; items.push(row); counts.repairedEpisodes += repaired; counts.alternatives += added;
  }
  return { schemaVersion: 1, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 36 * 36e5).toISOString(),
    scope: 'Recent non-adult catalog titles; exact work/episode variants for existing 1.4.28 clients. Source priority is measured sampling, not proof of every episode.',
    counts: { ...counts, items: items.length, bytes }, items };
}

export function mergeLegacySeeds(seeds, repairs, now = Date.now()) {
  const age = now - Date.parse(repairs?.checkedAt || ''), expiry = Date.parse(repairs?.expiresAt || '');
  if (repairs?.schemaVersion !== 1 || !Array.isArray(repairs.items) || !Number.isFinite(age) || age < -300000 || age > 36 * 36e5 || !(expiry > now)) return seeds;
  const rows = new Map((seeds.items || []).map(row => [row.id, row]));
  for (const row of repairs.items) {
    if (!row?.id || row.adult || !row.title || !row.sourceId || !Array.isArray(row.episodes) || !row.episodes.length) continue;
    if (row.episodes.some(ep => !https(ep.url) || ep.variants?.some(variant => !https(variant.url)))) continue;
    const previous = rows.get(row.id);
    if (previous && (identity(previous) !== identity(row) || previous.sourceId !== row.sourceId)) continue;
    rows.set(row.id, row);
  }
  return { ...seeds, cloudPlaybackRepairAt: repairs.checkedAt, items: [...rows.values()] };
}
