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

const repoRoot = path.resolve(args.get('repoRoot') || path.resolve(import.meta.dirname, '..'));
const reportUrl = args.get('reportUrl') || 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/report.md';
const output = path.resolve(args.get('output') || path.join(repoRoot, 'sources', 'All on-demand sources'));
const reportOutput = path.resolve(args.get('reportOutput') || path.join(repoRoot, 'sources', 'All on-demand sources-report.json'));
const docsVodOutput = path.resolve(args.get('docsVodOutput') || path.join(repoRoot, 'docs', 'data', 'vod-sources.json'));
const timeoutMs = Number(args.get('timeoutMs') || 10000);
const concurrency = Number(args.get('concurrency') || 10);

const USER_AGENT = 'OKTV-all-on-demand-builder/1.0';
const DEFAULT_CATEGORIES = [
  '国产剧',
  '短剧',
  '韩国剧',
  '香港剧',
  '台湾剧',
  '欧美剧',
  '动作片',
  '科幻片',
  '战争片',
  '奇幻片',
  '喜剧片',
  '爱情片',
  '恐怖片',
  '犯罪片',
  '悬疑片',
  '惊悚片',
  '剧情片',
  '冒险片',
  '记录片',
  '日本剧',
  '泰剧',
  '国产综艺',
  '港台综艺',
  '欧美综艺',
  '日韩综艺',
  '国产动漫',
  '港台动漫',
  '日韩动漫',
];

function withTimeout() {
  return AbortSignal.timeout(timeoutMs);
}

async function fetchText(url, accept = 'text/plain,*/*') {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: withTimeout(),
    headers: {
      accept,
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSourceName(value) {
  const text = normalizeText(value)
    .replace(/^[^\p{Letter}\p{Number}]+/u, '')
    .replace(/^\s*-+\s*/, '')
    .replace(/-+$/g, '')
    .trim();
  return text || '點播源';
}

function sourceKey(name, index) {
  const clean = cleanSourceName(name)
    .replace(/[｜|]+.*$/g, '')
    .replace(/\s+/g, '');
  return clean || `點播源${index + 1}`;
}

function keyId(value, index) {
  const id = normalizeText(value, `source-${index + 1}`)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return id || `source_${index + 1}`;
}

function apiType(api) {
  return /(?:xml|\/at\/xml|feifei)/i.test(api) ? 0 : 1;
}

function normalizeApi(api) {
  const raw = normalizeText(api);
  if (!raw) return '';
  if (/[?&]url=/i.test(raw)) return raw;
  if (/\/provide\/vod$/i.test(raw)) return `${raw}/`;
  return raw;
}

function addVodQuery(api, query) {
  const value = String(api || '').trim();
  if (!value) return '';
  if (value.endsWith('?') || value.endsWith('&')) return `${value}${query}`;
  return `${value}?${query}`;
}

function extractLink(cell) {
  return normalizeText(cell).match(/\[Link\]\(([^)]+)\)/)?.[1] || '';
}

function parseStatus(cell) {
  return cell.includes('✅') ? 'ok' : cell.includes('❌') ? 'failed' : 'unknown';
}

function parseSearchable(cell) {
  const text = normalizeText(cell);
  return text.includes('✅') ? 1 : 1;
}

function parseReportTable(markdown) {
  const rows = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (line.includes('资源名称') || line.includes('狀態') || line.includes('状态')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 9) continue;
    const api = extractLink(cells[3]);
    const name = cleanSourceName(cells[1]);
    if (!api || !name) continue;
    rows.push({
      status: parseStatus(cells[0]),
      name,
      site: extractLink(cells[2]),
      api,
      searchable: parseSearchable(cells[4]),
      successCount: Number(cells[5] || 0),
      failedCount: Number(cells[6] || 0),
      successRate: cells[7],
      trend: cells[8],
      adult: /🔞|成人|麻豆|番号|黄色|情色|大奶|丝袜|仓库|杏吧|色猫|桃花|香蕉|AV|91md|hsck|xgav|fhapi|dadiapi|lbapi/i.test(cells[1] + api),
    });
  }
  return rows;
}

function extractArray(payload) {
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeCategories(rows, fallbackAdult = false) {
  const categories = rows
    .map((item) => normalizeText(item.type_name ?? item.name ?? item.type ?? item.title))
    .filter(Boolean);
  const unique = [...new Set(categories)];
  if (unique.length) return unique.slice(0, 80);
  return fallbackAdult ? ['成人18+', ...DEFAULT_CATEGORIES] : DEFAULT_CATEGORIES;
}

async function fetchCategories(api, adult) {
  try {
    const text = await fetchText(addVodQuery(api, 'ac=list'), 'application/json,text/plain,*/*');
    const json = JSON.parse(text);
    return {
      categories: normalizeCategories(extractArray(json), adult),
      ok: true,
      error: '',
    };
  } catch (error) {
    return {
      categories: normalizeCategories([], adult),
      ok: false,
      error: error.message,
    };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function hostOf(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has('url')) return new URL(url.searchParams.get('url')).host;
    return url.host;
  } catch {
    return '';
  }
}

const markdown = await fetchText(reportUrl, 'text/markdown,text/plain,*/*');
const parsedRows = parseReportTable(markdown);
const iqiyiIndex = parsedRows.findIndex((row) => /爱奇艺|愛奇藝/i.test(row.name));
const reportRows = iqiyiIndex > 0 ? [...parsedRows.slice(iqiyiIndex), ...parsedRows.slice(0, iqiyiIndex)] : parsedRows;
const seen = new Set();
const dedupedRows = reportRows.filter((row) => {
  const key = normalizeText(row.api).toLowerCase().replace(/\/$/g, '');
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
});

const categoryChecks = await mapLimit(dedupedRows, concurrency, async (row) => fetchCategories(row.api, row.adult));
const sites = dedupedRows.map((row, index) => {
  const categories = categoryChecks[index]?.categories || DEFAULT_CATEGORIES;
  const key = sourceKey(row.name, index);
  return {
    key,
    name: `${key}｜追劇`,
    type: apiType(row.api),
    api: normalizeApi(row.api),
    searchable: 1,
    quickSearch: 1,
    categories,
  };
});

const outputJson = {
  spider: '',
  logo: 'https://raw.githubusercontent.com/SYLONG7708/TV/main/branding/icon-tech-20260528.png',
  wallpaper: 'http://tool.teyonds.com/api',
  warningText: '影視OKTV all on-demand sources. Auto refreshed from LunaTV-config report.md every hour.',
  sites,
};

const report = {
  generatedAt: new Date().toISOString(),
  reportUrl,
  totalRows: reportRows.length,
  totalSources: sites.length,
  adultSources: dedupedRows.filter((row) => row.adult).length,
  okRows: dedupedRows.filter((row) => row.status === 'ok').length,
  failedRows: dedupedRows.filter((row) => row.status === 'failed').length,
  categoriesOk: categoryChecks.filter((row) => row.ok).length,
  categoriesFailed: categoryChecks.filter((row) => !row.ok).length,
  sources: dedupedRows.map((row, index) => ({
    key: sites[index].key,
    name: sites[index].name,
    api: sites[index].api,
    host: hostOf(sites[index].api),
    adult: row.adult,
    status: row.status,
    successRate: row.successRate,
    categories: sites[index].categories,
    categoriesOk: categoryChecks[index]?.ok || false,
    categoriesError: categoryChecks[index]?.error || '',
  })),
};

const docsVod = sites.map((site, index) => ({
  id: keyId(`${site.key}-${site.api}`, index),
  key: site.key,
  name: site.name,
  type: site.type,
  typeLabel: site.type === 0 ? 'CMS XML/API' : 'CMS JSON/API',
  mode: 'api',
  api: site.api,
  searchable: true,
  quickSearch: true,
  categories: site.categories,
  endpointHost: hostOf(site.api),
  hasExt: false,
  enabled: true,
  status: 'enabled',
  origin: 'All on-demand sources',
}));

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(path.dirname(reportOutput), { recursive: true });
await fs.mkdir(path.dirname(docsVodOutput), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(outputJson, null, 2)}\n`, 'utf8');
await fs.writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(docsVodOutput, `${JSON.stringify(docsVod, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      output,
      reportOutput,
      docsVodOutput,
      totalSources: sites.length,
      adultSources: report.adultSources,
      categoriesOk: report.categoriesOk,
      categoriesFailed: report.categoriesFailed,
    },
    null,
    2,
  ),
);
