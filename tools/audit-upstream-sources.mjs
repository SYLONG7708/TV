import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseVodPayload } from './vod-payload-parser.mjs';

export const UPSTREAM_REPOSITORY = 'AA257265/265';
export const CONFIG_FILES = ['02.json', '265.json', 'A.json', 'A2.json', 'B.json', 'VIP.json', 'XBP.json'];
const GENERAL_NAMES = /黑木|黑墙|豆瓣|最大|天涯|索尼|優酷|优酷|U酷|光速|虎牙|金鹰|爱坤|iKun|卧龙|睏|土豪|豪华|華為|华为|優質|优质|極速|极速|无尽|魔都|电影天堂|茅台|无忧|新浪|量子|非凡|快车|百度|如意|红牛|闪电|影剧|牛牛|爱奇艺|海默|旺旺|金蝉|忆梦|天翼|祥子|速影|八戒|柒社|天空|四圈|飞龙|快看|索\s*2K|高\s*2K|映迷|全民|熊猫|阿里|鸭鸭|木耳|猫眼|吉吉|第一|无水印|速播|飘零|360|樱花|閃電|枫林|火狐/i;
const EXCLUDED_NAMES = /18\+|🔞|成人|porn|sex|麻豆|色|黄|黃|奶|裸|涩|澀|福利|玉兔|淫|探花|屁股|香蕉|撸|擼|妹|萝莉|蘿莉|嫩|精品|jkun|xiangjiao/i;
const SENSITIVE_CATEGORY = /成人|情色|色情|伦理|倫理|\bAV\b|国产传媒|國產傳媒|麻豆|无码|無碼|有码|有碼|自慰|口交|性交|强奸|強姦|乱伦|亂倫|幼女|萝莉|蘿莉|偷拍|偷窥|偷窺|探花|淫|兽交|獸交|福利姬|嫩模|女同|男同|性爱|性愛|三级|三級|韩国R级|韓國R級|擦边|擦邊|JAV|porn|hentai/i;
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

// Parse data only. Quoted URLs and comment-like text must survive unchanged.
export function parseJsonc(source) {
  const input = String(source).replace(/^\uFEFF/, '');
  let stripped = '', quoted = false, escaped = false, line = false, block = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], next = input[i + 1];
    if (line) { if (c === '\n') { line = false; stripped += c; } else stripped += ' '; continue; }
    if (block) { if (c === '*' && next === '/') { block = false; stripped += '  '; i++; } else stripped += c === '\n' ? '\n' : ' '; continue; }
    if (quoted) { stripped += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; stripped += c; }
    else if (c === '/' && next === '/') { line = true; stripped += '  '; i++; }
    else if (c === '/' && next === '*') { block = true; stripped += '  '; i++; }
    else stripped += c;
  }
  if (block || quoted) throw new Error('Unterminated JSON comment or string');
  let cleaned = ''; quoted = false; escaped = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (quoted) { cleaned += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    if (c === ',') { let j = i + 1; while (j < stripped.length && /\s/.test(stripped[j])) j++; if (stripped[j] === '}' || stripped[j] === ']') continue; }
    cleaned += c;
  }
  return JSON.parse(cleaned);
}

export function normalizeApi(api, logical = false) {
  const u = new URL(String(api).trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Expected an HTTP API without credentials');
  u.hash = '';
  if (u.searchParams.has('ac') && u.searchParams.size === 1) u.search = '';
  if (!u.searchParams.size) u.search = '';
  if (logical) {
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '');
    u.pathname = u.pathname.replace(/\/at\/(?:json|josn|xml)\/?$/i, '').replace(/\/from\/[^/]+\/?$/i, '').replace(/\/at\/(?:json|josn|xml)\/?$/i, '');
  }
  return u.href.replace(/\/+$/, '');
}

export function isGeneralSite(site) {
  if (![0, 1].includes(Number(site?.type))) return false;
  const name = String(site.name || site.key || '');
  if (!GENERAL_NAMES.test(name) || EXCLUDED_NAMES.test([name, site.key, site.api].join(' '))) return false;
  try { const u = new URL(normalizeApi(site.api)); return !/\.(?:js|mjs|py|jar|dex|so|exe)$/i.test(u.pathname); } catch { return false; }
}

export function compareSources(upstreamSites, configuredSites) {
  const configured = new Map();
  for (const site of configuredSites) {
    if (![0, 1].includes(Number(site.type))) continue;
    try { configured.set(normalizeApi(site.api), site); } catch { /* Ignore non-HTTP and invalid configuration entries. */ }
  }
  const logical = new Set([...configured.values()].map(site => normalizeApi(site.api, true)));
  const unique = new Map();
  for (const site of upstreamSites.filter(isGeneralSite)) {
    const api = normalizeApi(site.api);
    if (unique.has(api)) { unique.get(api).originFiles.push(site.originFile); continue; }
    unique.set(api, { name: String(site.name || site.key), api, type: Number(site.type), originFiles: [site.originFile], alreadyConfigured: configured.has(api), sameLogicalEndpoint: logical.has(normalizeApi(api, true)) });
  }
  const sources = [...unique.values()].map(row => ({ ...row, originFiles: [...new Set(row.originFiles.filter(Boolean))] }));
  const baselines = [...configured.values()].filter(site => isGeneralSite(site) || unique.has(normalizeApi(site.api))).map(site => ({name: String(site.name || site.key), api: normalizeApi(site.api)}));
  return { sources, baselines, configuredApiCount: configured.size };
}

export async function fetchBoundedText(url, { fetchImpl = fetch, timeoutMs = 12000, maxBytes = 2097152, headers = {} } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json,text/plain,application/xml,text/xml,*/*', 'user-agent': 'OKTV-Upstream-Audit/1.0', ...headers } });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > maxBytes) { await reader.cancel(); throw new Error(`Response exceeds ${maxBytes} bytes`); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return { text: Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''), finalUrl: res.url || String(url), cors: res.headers.get('access-control-allow-origin') };
}

async function mapLimit(items, concurrency, work) {
  const results = Array(items.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => { while (next < items.length) { const index = next++; results[index] = await work(items[index], index); } }));
  return results;
}

export function cmsQuery(api) {
  const u = new URL(api);
  if (u.searchParams.has('url')) {
    const inner = new URL(u.searchParams.get('url'));
    inner.searchParams.set('ac', 'list'); inner.searchParams.set('pg', '1');
    u.searchParams.set('url', inner.href);
  } else { u.searchParams.set('ac', 'list'); u.searchParams.set('pg', '1'); }
  return u.href;
}

export async function probeCms(api, options = {}) {
  const started = Date.now();
  try {
    const response = await fetchBoundedText(cmsQuery(api), { ...options, headers: {origin: 'https://sylong7708.github.io'} });
    if (response.text.trimStart().startsWith('<') && !/<rss\b|<list\b/i.test(response.text)) throw new Error('HTML or non-CMS response');
    const data = parseVodPayload(response.text);
    if (!Array.isArray(data?.list)) throw new Error('CMS response has no list array');
    const categories = Array.isArray(data.class) ? data.class : [];
    const safeCategories = categories.filter(x => !SENSITIVE_CATEGORY.test(String(x.type_name || x.name || '')));
    const safeItems = data.list.filter(x => !SENSITIVE_CATEGORY.test([x.type_name, x.vod_name].join(' ')));
    // Store fingerprints and counts, never titles, episode URLs, or video bodies.
    return {status: data.list.length ? 'ok' : 'empty', durationMs: Date.now() - started, total: Number(data.total || 0), sampleCount: data.list.length, safeSampleCount: safeItems.length, categoryCount: categories.length, generalCategoryCount: safeCategories.length, mixedCategories: categories.length !== safeCategories.length, latestUpdate: safeItems.map(x => String(x.vod_time || '')).filter(Boolean).sort().at(-1) || null, headFingerprint: data.list.length >= 5 ? digest(data.list.slice(0, 5).map(x => [String(x.vod_id ?? x.id ?? ''), String(x.vod_name ?? x.name ?? '')])) : null, cors: response.cors};
  } catch (error) { return {status: 'failed', durationMs: Date.now() - started, error: String(error.message).slice(0, 180)}; }
}

export async function auditSources({ configuredSites, fetchImpl = fetch, timeoutMs = 12000, concurrency = 8, skipProbes = false, githubToken = '', now = new Date() }) {
  let revision = 'main'; const warnings = [];
  try {
    const result = await fetchBoundedText(`https://api.github.com/repos/${UPSTREAM_REPOSITORY}/commits/main`, {fetchImpl, timeoutMs, headers: githubToken ? {authorization: `Bearer ${githubToken}`} : {}});
    const sha = JSON.parse(result.text).sha;
    if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Invalid commit SHA');
    revision = sha;
  } catch { warnings.push('Could not pin upstream commit; per-file SHA-256 hashes identify this snapshot.'); }
  const configs = await mapLimit(CONFIG_FILES, 3, async file => {
    try {
      const url = `https://raw.githubusercontent.com/${UPSTREAM_REPOSITORY}/${revision}/${file}`;
      const {text} = await fetchBoundedText(url, {fetchImpl, timeoutMs});
      const config = parseJsonc(text);
      if (!Array.isArray(config?.sites)) throw new Error('Configuration has no sites array');
      return {file, status: 'ok', sha256: digest(text), siteCount: config.sites.length, sites: config.sites.map(site => ({...site, originFile: file}))};
    } catch (error) { return {file, status: 'failed', error: String(error.message).slice(0, 180), sites: []}; }
  });
  if (!configs.some(x => x.status === 'ok')) throw new Error('All upstream configurations failed; keep previous audit and playback data.');
  const comparison = compareSources(configs.flatMap(x => x.sites), configuredSites);
  const apis = [...new Set([...comparison.sources, ...comparison.baselines].map(x => x.api))];
  const probes = skipProbes ? [] : await mapLimit(apis, concurrency, async api => ({api, ...await probeCms(api, {fetchImpl, timeoutMs})}));
  const byApi = new Map(probes.map(x => [x.api, x]));
  const baselineProbes = comparison.baselines.map(x => ({...x, ...byApi.get(x.api)}));
  const sources = comparison.sources.map(row => {
    const health = byApi.get(row.api) || {status: 'not-probed'};
    const matches = health.headFingerprint ? baselineProbes.filter(x => x.api !== row.api && x.headFingerprint === health.headFingerprint).map(x => ({name: x.name, api: x.api, sameReportedTotal: x.total === health.total})) : [];
    const disposition = row.alreadyConfigured ? 'configured' : row.sameLogicalEndpoint ? 'url-variant' : matches.length ? 'probable-mirror' : health.status === 'failed' ? 'unavailable' : 'needs-review';
    return {...row, health, matchesExisting: matches, disposition};
  });
  const candidates = sources.filter(x => !x.alreadyConfigured);
  return { schemaVersion: 1, generatedAt: now.toISOString(), upstreamRepository: UPSTREAM_REPOSITORY, upstreamRevision: revision, snapshotSha256: digest(configs.map(({file, sha256}) => [file, sha256 || null])), mode: 'audit-only', playbackSourcesChanged: false, warnings, configurations: configs.map(({sites, ...config}) => config), totals: {generalApis: sources.length, alreadyConfigured: sources.filter(x => x.alreadyConfigured).length, candidates: candidates.length, candidateOk: candidates.filter(x => x.health.status === 'ok').length, candidateFailed: candidates.filter(x => x.health.status === 'failed').length, variants: candidates.filter(x => x.disposition === 'url-variant').length, probableMirrors: candidates.filter(x => x.disposition === 'probable-mirror').length, needsReview: candidates.filter(x => x.disposition === 'needs-review').length}, sources, baselineHealth: baselineProbes };
}

export function renderMarkdown(report) {
  const t = report.totals;
  const cell = value => String(value ?? '').replace(/[|\r\n]/g, ' ');
  const rows = report.sources.filter(x => !x.alreadyConfigured);
  return [`# 265 儲存庫來源每日比對`, '', `檢查時間：${report.generatedAt}；上游版本：${report.upstreamRevision}。`, '', `一般影視 API ${t.generalApis} 個；已設定 ${t.alreadyConfigured} 個；候選入口 ${t.candidates} 個。候選目錄回應成功 ${t.candidateOk} 個、失敗 ${t.candidateFailed} 個。`, '', `網址變體 ${t.variants} 個、抽樣疑似同片庫 ${t.probableMirrors} 個、仍需確認 ${t.needsReview} 個。`, '', '本流程只更新比對報告；目錄可讀不代表影片可播放、作品不重複或具有內容授權。新入口須確認一般內容、明細、串流與 App 相容性後才能加入播放設定。原有片庫及播放更新排程保持原設定。', '', '| 候選名稱 | 分類 | 目錄檢查 | 最近資料時間 |', '| --- | --- | --- | --- |', ...rows.map(x => `| ${cell(x.name)} | ${x.disposition} | ${cell(x.health.error || x.health.status)} | ${cell(x.health.latestUpdate)} |`), '', ...report.warnings.map(x => `- ${x}`), ...report.configurations.filter(x => x.status === 'failed').map(x => `- ${x.file}: ${x.error}`), ''].join('\n');
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i++) { const key = process.argv[i].replace(/^--/, ''); const value = process.argv[i + 1]; args.set(key, value && !value.startsWith('--') ? process.argv[++i] : 'true'); }
  const root = path.resolve(args.get('repoRoot') || path.join(import.meta.dirname, '..'));
  const output = path.resolve(root, args.get('output') || 'reports/upstream-265-latest.json');
  const markdownOutput = path.resolve(root, args.get('markdownOutput') || 'reports/upstream-265-latest.md');
  const reportRoot = path.resolve(root, 'reports') + path.sep;
  if ([output, markdownOutput].some(x => !x.toLowerCase().startsWith(reportRoot.toLowerCase())) || output.toLowerCase() === markdownOutput.toLowerCase()) throw new Error('Audit outputs must be separate files under reports/');
  const configuredSites = [];
  for (const file of ['sources/TVBOX', 'sources/All on-demand sources']) {
    const config = parseJsonc(await fs.readFile(path.join(root, file), 'utf8'));
    if (!Array.isArray(config?.sites)) throw new Error(`${file} has no sites array`);
    configuredSites.push(...config.sites);
  }
  const positiveInt = (value, fallback, maximum) => { const n = Number(value ?? fallback); if (!Number.isInteger(n) || n < 1 || n > maximum) throw new Error('Invalid timeout or concurrency'); return n; };
  const report = await auditSources({configuredSites, timeoutMs: positiveInt(args.get('timeoutMs'), 12000, 60000), concurrency: positiveInt(args.get('concurrency'), 8, 16), skipProbes: args.get('skipProbes') === 'true', githubToken: process.env.GITHUB_TOKEN || ''});
  for (const [file, text] of [[output, JSON.stringify(report, null, 2) + '\n'], [markdownOutput, renderMarkdown(report)]]) { await fs.mkdir(path.dirname(file), {recursive: true}); const temp = `${file}.${process.pid}.tmp`; await fs.writeFile(temp, text, 'utf8'); await fs.rename(temp, file); }
  console.log(JSON.stringify({output, markdownOutput, ...report.totals, playbackSourcesChanged: false}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => {console.error(error.message); process.exitCode = 1;});
