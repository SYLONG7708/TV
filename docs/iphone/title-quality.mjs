// Shared by the browser and index builders so every entry point uses one rule.
export function cleanTitle(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (raw, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? raw;
      const hex = /^#x/i.test(entity);
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '\ufffd';
    })
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function titleQuality(value) {
  const title = cleanTitle(value);
  if (!title || !/[\p{Letter}\p{Number}]/u.test(title)) return { title, valid: false, reason: 'missing-readable-title' };
  if (title.includes('\ufffd')) return { title, valid: false, reason: 'damaged-encoding' };
  // Question marks can be part of a real title (including Japanese seasons).
  return { title, valid: true, reason: '' };
}

export function titleYear(item) {
  return String(item?.year ?? '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
}

export function workIdentity(item, compact) {
  const title = compact(cleanTitle(item?.title));
  if (!title) return `record:${item?.sourceId || ''}:${item?.vodId || item?.id || ''}`;
  const year = titleYear(item);
  // Unknown years cannot safely identify a remake across sources.
  return [title, year || `unknown:${item?.sourceId || ''}:${item?.vodId || item?.id || ''}`, item?.kind || '', item?.adult ? 'adult' : 'normal'].join('\u001f');
}

export function sameDetailIdentity(entry, item, compact) {
  if (!entry || !item) return false;
  if (entry.sourceId && item.sourceId && entry.sourceId !== item.sourceId) return false;
  if (!(entry.id && entry.id === item.id) && !(entry.vodId && String(entry.vodId) === String(item.vodId))) return false;
  if (!titleQuality(entry.title).valid || compact(cleanTitle(entry.title)) !== compact(cleanTitle(item.title))) return false;
  const expectedYear = titleYear(item);
  const actualYear = titleYear(entry);
  return !(expectedYear && actualYear && expectedYear !== actualYear);
}
