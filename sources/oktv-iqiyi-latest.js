const BASE_API = 'https://iqiyizyapi.com/api.php/provide/vod/';
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  Referer: 'https://iqiyizyapi.com/',
};

const CLASSES = [
  { type_id: '10', type_name: '\u52a8\u4f5c\u7247' },
  { type_id: '1', type_name: '\u56fd\u4ea7\u52a8\u6f2b' },
  { type_id: '38', type_name: '\u77ed\u5267' },
  { type_id: '34', type_name: '\u5927\u9646\u7efc\u827a' },
];

const LATEST_TYPE_IDS = new Set([
  '1',
  '2',
  '3',
  '4',
  '5',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '38',
]);
const ADULT_TYPE_IDS = new Set(['6', '39']);
const LATEST_RAW_PAGES_PER_PAGE = 6;

function asPage(value) {
  if (Array.isArray(value)) return asPage(value[0]);
  if (value && typeof value === 'object') return asPage(value.pg || value.page);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 1;
}

function apiUrl(params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `${BASE_API}?${query}` : BASE_API;
}

async function requestText(url) {
  const requester = globalThis.req;
  if (typeof requester === 'function') {
    let response;
    try {
      response = await requester(url, { headers: REQUEST_HEADERS });
    } catch {
      response = await requester(url);
    }
    if (typeof response === 'string') return response;
    if (response && typeof response.content === 'string') return response.content;
    if (response && typeof response.body === 'string') return response.body;
    if (response && typeof response.data === 'string') return response.data;
    if (response && response.data) return JSON.stringify(response.data);
  }
  if (typeof fetch === 'function') {
    const response = await fetch(url, { headers: REQUEST_HEADERS });
    return await response.text();
  }
  throw new Error('No HTTP requester is available.');
}

async function requestJson(params) {
  const text = await requestText(apiUrl(params));
  return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
}

async function safeRequestJson(params) {
  try {
    return await requestJson(params);
  } catch {
    return {};
  }
}

function vodTimeValue(vod) {
  const text = String(vod?.vod_time || '').replace(' ', 'T');
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed / 1000;
  const addTime = Number(vod?.vod_time_add);
  if (Number.isFinite(addTime) && addTime > 0) return addTime;
  return 0;
}

function isAdultVod(vod) {
  return ADULT_TYPE_IDS.has(String(vod?.type_id || '')) || ADULT_TYPE_IDS.has(String(vod?.type_id_1 || ''));
}

function isLatestVod(vod) {
  return (
    !isAdultVod(vod) &&
    (LATEST_TYPE_IDS.has(String(vod?.type_id || '')) || LATEST_TYPE_IDS.has(String(vod?.type_id_1 || '')))
  );
}

function normalizeVod(vod) {
  if (!vod || typeof vod !== 'object') return null;
  const normalized = { ...vod };
  normalized.vod_id = String(vod.vod_id || '');
  normalized.vod_name = String(vod.vod_name || '').trim();
  normalized.vod_pic = String(vod.vod_pic || vod.vod_pic_thumb || vod.vod_pic_slide || '').trim();
  normalized.vod_remarks = String(vod.vod_remarks || vod.vod_serial || vod.vod_score || vod.type_name || '').trim();
  if (!normalized.vod_year && vod.vod_pubdate) normalized.vod_year = String(vod.vod_pubdate).slice(0, 4);
  return normalized.vod_id && normalized.vod_name ? normalized : null;
}

function normalizeList(list, filter = () => true) {
  const seen = new Set();
  const output = [];
  for (const vod of Array.isArray(list) ? list : []) {
    if (!filter(vod)) continue;
    const normalized = normalizeVod(vod);
    if (!normalized || seen.has(normalized.vod_id)) continue;
    seen.add(normalized.vod_id);
    output.push(normalized);
  }
  return output;
}

function json(value) {
  return JSON.stringify(value || {});
}

async function latestVodPage(page = 1) {
  const safePage = asPage(page);
  const rawStartPage = (safePage - 1) * LATEST_RAW_PAGES_PER_PAGE + 1;
  const requests = [];
  for (let offset = 0; offset < LATEST_RAW_PAGES_PER_PAGE; offset += 1) {
    requests.push(safeRequestJson({ ac: 'videolist', pg: rawStartPage + offset }));
  }

  const pages = await Promise.all(requests);
  const byId = new Map();
  for (const pageData of pages) {
    for (const vod of Array.isArray(pageData?.list) ? pageData.list : []) {
      if (!isLatestVod(vod)) continue;
      const normalized = normalizeVod(vod);
      if (normalized && !byId.has(normalized.vod_id)) byId.set(normalized.vod_id, normalized);
    }
  }

  const list = Array.from(byId.values()).sort((a, b) => vodTimeValue(b) - vodTimeValue(a));
  const firstPage = pages.find((pageData) => Number(pageData?.pagecount) > 0) || {};
  const rawPageCount = Number(firstPage.pagecount) || 1;
  return {
    page: safePage,
    pagecount: Math.max(1, Math.ceil(rawPageCount / LATEST_RAW_PAGES_PER_PAGE)),
    limit: list.length || Number(firstPage.limit) || 20,
    total: Number(firstPage.total) || list.length,
    list,
  };
}

async function home() {
  const latest = await latestVodPage(1);
  return json({
    class: CLASSES,
    filters: {},
    list: latest.list,
  });
}

async function homeVod(page) {
  return json(await latestVodPage(page));
}

async function category(tid, pg) {
  const page = asPage(pg);
  const data = await safeRequestJson({ ac: 'videolist', t: tid, pg: page });
  const list = normalizeList(data.list, (vod) => !isAdultVod(vod));
  return json({
    page,
    pagecount: Number(data.pagecount) || 1,
    limit: Number(data.limit) || list.length || 20,
    total: Number(data.total) || list.length,
    list,
  });
}

async function detail(ids) {
  const id = Array.isArray(ids) ? ids.join(',') : String(ids || '');
  const data = await safeRequestJson({ ac: 'detail', ids: id });
  return json({ list: normalizeList(data.list, (vod) => !isAdultVod(vod)) });
}

async function play(flag, id) {
  return json({
    parse: 0,
    jx: 0,
    header: REQUEST_HEADERS,
    url: String(id || ''),
  });
}

async function search(wd, quick, pg) {
  const page = asPage(pg);
  const data = await safeRequestJson({ wd, pg: page });
  const list = normalizeList(data.list, (vod) => !isAdultVod(vod));
  return json({
    page,
    pagecount: Number(data.pagecount) || 1,
    limit: Number(data.limit) || list.length || 20,
    total: Number(data.total) || list.length,
    list,
  });
}

const spider = {
  init: async () => '',
  home,
  homeContent: home,
  homeVod,
  homeVideoContent: homeVod,
  category,
  categoryContent: category,
  detail,
  detailContent: detail,
  play,
  playerContent: play,
  search,
  searchContent: search,
};

export function __jsEvalReturn() {
  return spider;
}

export default spider;
