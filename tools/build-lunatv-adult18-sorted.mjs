import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, '..');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const repoRoot = path.resolve(args.get('repoRoot') || defaultRepoRoot);
const sourceName = args.get('sourceName') || 'full';
const adultStartIndex = Number(args.get('adultStartIndex') || 40);
const candidateOutput =
  args.get('candidateOutput') || path.join(repoRoot, 'sources', 'vod-lunatv-adult18-sorted-oktv.json');
const reportOutput =
  args.get('reportOutput') || path.join(repoRoot, 'sources', 'vod-lunatv-adult18-sorted-report.json');
const analysisOutput =
  args.get('analysisOutput') || path.join(repoRoot, 'sources', 'vod-lunatv-adult18-sorted-analysis.csv');

const fullConfigPath = path.join(repoRoot, 'sources', `vod-lunatv-${sourceName}-oktv.json`);
const fullReportPath = path.join(repoRoot, 'sources', `vod-lunatv-${sourceName}-report.json`);

function sourceIndex(name) {
  const match = String(name || '').match(/Luna\s+(\d+)/i);
  return match ? Number(match[1]) : 9999;
}

function adultCategory(name) {
  const value = String(name || '');
  if (/美少女|动漫|動畫|动画/.test(value)) return '04 動漫/美少女';
  if (/番号|souav|CK|黄AV|AVZY|丝袜|奥斯卡|jkun/i.test(value)) return '03 番號/日本';
  if (/麻豆|黑料|杏吧|大地|色猫|辣椒|桃花|黄色|白嫖|国产|國產/.test(value)) return '02 國產/短片';
  if (/155|玉兔|优优|小鸡|森林|鲨鱼|豆豆|滴滴|百万|精品|细胞|香蕉/.test(value)) return '05 精品/大站';
  if (/AIvin|老色|乐播|大奶|奶香/.test(value)) return '01 綜合成人';
  return '06 其他/待驗';
}

function sortedKey(key, index) {
  const safe = String(key || `adult18_${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `adult18_${String(index).padStart(3, '0')}_${safe || `source_${index}`}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  const headers = [
    'category',
    'order',
    'name',
    'api',
    'included',
    'duplicate',
    'duplicateReason',
    'listOk',
    'detailOk',
    'searchOk',
    'searchHasPlayUrl',
    'hasPlayUrl',
    'status',
    'error',
  ];
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(',')),
  ].join('\r\n') + '\r\n';
}

await fs.mkdir(path.dirname(candidateOutput), { recursive: true });
await fs.mkdir(path.dirname(reportOutput), { recursive: true });
await fs.mkdir(path.dirname(analysisOutput), { recursive: true });

const [fullConfig, fullReport] = await Promise.all([
  fs.readFile(fullConfigPath, 'utf8').then(JSON.parse),
  fs.readFile(fullReportPath, 'utf8').then(JSON.parse),
]);

const siteByName = new Map((fullConfig.sites || []).map((site) => [String(site.name), site]));
const rows = (fullReport.checks || [])
  .filter((check) => sourceIndex(check.name) >= adultStartIndex)
  .map((check) => {
    const order = sourceIndex(check.name);
    const included = Boolean(check.included);
    const duplicate = Boolean(check.duplicate);
    return {
      category: adultCategory(check.name),
      order,
      name: String(check.name || ''),
      api: String(check.api || ''),
      included,
      duplicate,
      duplicateReason: String(check.duplicateReason || ''),
      listOk: Boolean(check.listOk),
      detailOk: Boolean(check.detailOk),
      searchOk: Boolean(check.searchOk),
      searchHasPlayUrl: Boolean(check.searchHasPlayUrl),
      hasPlayUrl: Boolean(check.hasPlayUrl),
      status: included ? 'usable_review_required' : duplicate ? 'duplicate_removed' : 'failed_removed',
      error: String(check.error || ''),
    };
  })
  .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant') || a.order - b.order || a.name.localeCompare(b.name));

const usableSites = rows
  .filter((row) => row.included)
  .map((row) => {
    const site = siteByName.get(row.name);
    return {
      key: sortedKey(site?.key || row.name, row.order),
      name: row.name,
      type: Number(site?.type ?? 1),
      api: String(site?.api || row.api),
      searchable: Number(site?.searchable ?? 1),
      quickSearch: Number(site?.quickSearch ?? 1),
      filterable: Number(site?.filterable ?? 1),
      categories: [row.category, '18+', 'adult_review_required'],
    };
  });

const categoryCounts = {};
for (const row of rows) {
  categoryCounts[row.category] ||= { total: 0, usable: 0, duplicate: 0, failed: 0 };
  categoryCounts[row.category].total += 1;
  if (row.status === 'usable_review_required') categoryCounts[row.category].usable += 1;
  if (row.status === 'duplicate_removed') categoryCounts[row.category].duplicate += 1;
  if (row.status === 'failed_removed') categoryCounts[row.category].failed += 1;
}

const candidate = {
  spider: '',
  logo: 'https://raw.githubusercontent.com/SYLONG7708/TV/main/branding/icon-tech-20260528.png',
  wallpaper: 'http://tool.teyonds.com/api',
  warningText: 'LunaTV adult 18+ sorted technical candidate. Review required; not configured as default playback source.',
  sites: usableSites,
};

const report = {
  generatedAt: new Date().toISOString(),
  sourceName,
  adultStartIndex,
  totalAdultSources: rows.length,
  usableAdultSources: usableSites.length,
  duplicateAdultSources: rows.filter((row) => row.status === 'duplicate_removed').length,
  failedAdultSources: rows.filter((row) => row.status === 'failed_removed').length,
  searchOkSources: rows.filter((row) => row.searchOk).length,
  searchPlayableSources: rows.filter((row) => row.searchHasPlayUrl).length,
  candidateOutput,
  analysisOutput,
  categoryCounts,
  resources: rows,
};

await fs.writeFile(candidateOutput, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
await fs.writeFile(reportOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(analysisOutput, toCsv(rows), 'utf8');

console.log(`Wrote adult 18+ sorted candidate: ${candidateOutput}`);
console.log(`Wrote adult 18+ sorted report: ${reportOutput}`);
console.log(`Wrote adult 18+ sorted analysis: ${analysisOutput}`);
console.log(`Adult usable sources: ${usableSites.length} / ${rows.length}`);
