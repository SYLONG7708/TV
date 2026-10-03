function decodeXmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function cleanXmlText(value) {
  return decodeXmlEntities(
    String(value ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function parseAttributes(value) {
  const attrs = {};
  for (const match of String(value || '').matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeXmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function tagText(block, names) {
  for (const name of names) {
    const match = String(block || '').match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    const text = cleanXmlText(match?.[1] || '');
    if (text) return text;
  }
  return '';
}

function parseXmlNumber(value, fallback = 0) {
  const number = Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0] || fallback);
  return Number.isFinite(number) ? number : fallback;
}

function parseXmlCategories(text) {
  const rows = [];
  for (const match of String(text || '').matchAll(/<ty\b([^>]*)>([\s\S]*?)<\/ty>/gi)) {
    const attrs = parseAttributes(match[1]);
    const id = String(attrs.id || attrs.tid || attrs.type_id || rows.length + 1);
    const name = cleanXmlText(match[2]);
    if (name) rows.push({ type_id: id, id, type_name: name, name });
  }
  return rows;
}

function parseXmlPlayUrl(block) {
  const ddRows = [];
  for (const match of String(block || '').matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const text = cleanXmlText(match[1]);
    if (text) ddRows.push(text);
  }
  if (ddRows.length > 0) return ddRows.join('$$$');
  return tagText(block, ['vod_play_url', 'play_url', 'playurl', 'url', 'dt']);
}

function parseXmlVideos(text) {
  const rows = [];
  for (const match of String(text || '').matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)) {
    const block = match[1];
    const vodId = tagText(block, ['vod_id', 'id']);
    const title = tagText(block, ['vod_name', 'name', 'title']);
    if (!vodId && !title) continue;
    rows.push({
      vod_id: vodId,
      id: vodId,
      type_id: tagText(block, ['type_id', 'tid', 'cid']),
      type_name: tagText(block, ['type_name', 'type', 'category']),
      vod_name: title,
      name: title,
      vod_en: tagText(block, ['vod_en', 'en']),
      vod_pic: tagText(block, ['vod_pic', 'pic', 'cover']),
      vod_year: tagText(block, ['vod_year', 'year']),
      vod_area: tagText(block, ['vod_area', 'area']),
      vod_lang: tagText(block, ['vod_lang', 'lang']),
      vod_score: tagText(block, ['vod_score', 'score']),
      vod_hits: tagText(block, ['vod_hits', 'hits']),
      vod_remarks: tagText(block, ['vod_remarks', 'remarks', 'note', 'state']),
      vod_actor: tagText(block, ['vod_actor', 'actor']),
      vod_director: tagText(block, ['vod_director', 'director']),
      vod_content: tagText(block, ['vod_content', 'content', 'des', 'desc']),
      vod_time: tagText(block, ['vod_time', 'last', 'time', 'addtime']),
      vod_play_url: parseXmlPlayUrl(block),
    });
  }
  return rows;
}

function parseXmlPageMeta(text) {
  const attrs = parseAttributes(String(text || '').match(/<list\b([^>]*)>/i)?.[1] || '');
  const page = parseXmlNumber(attrs.page || attrs.pg, 1) || 1;
  const pagecount = parseXmlNumber(attrs.pagecount || attrs.page_count || attrs.pagecountnum, 1) || 1;
  const total = parseXmlNumber(attrs.recordcount || attrs.total || attrs.totalcount, 0) || 0;
  const limit = parseXmlNumber(attrs.pagesize || attrs.limit, 0) || 0;
  return { page, pagecount, total, limit };
}

function looksLikeXml(text) {
  const trimmed = String(text || '').trimStart();
  return trimmed.startsWith('<') || /<rss\b|<list\b|<video\b|<class\b/i.test(trimmed.slice(0, 2048));
}

function parseXmlPayload(text) {
  const meta = parseXmlPageMeta(text);
  const categories = parseXmlCategories(text);
  const list = parseXmlVideos(text);
  return {
    ...meta,
    class: categories,
    list,
    total: meta.total || list.length,
    xml: true,
  };
}

export function parseVodPayload(text) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '');
  if (looksLikeXml(cleaned)) return parseXmlPayload(cleaned);
  return JSON.parse(cleaned);
}
