import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const tvRoot = path.resolve(args.get('tvRoot') || '.');
const catalogPath = path.resolve(tvRoot, args.get('catalog') || path.join('docs', 'data', 'iphone-vod-catalog.json'));
const reportPath = path.resolve(tvRoot, args.get('report') || path.join('docs', 'data', 'iphone-vod-catalog-report.json'));
const detailRoot = path.resolve(tvRoot, args.get('detailRoot') || path.join('docs', 'data', 'vod-detail'));
const logDir = path.resolve(tvRoot, args.get('logDir') || path.join('logs', 'full-vod-per-source'));
const pageSize = Number(args.get('pageSize') || 100);
const pageConcurrency = Number(args.get('pageConcurrency') || 6);
const timeoutMs = Number(args.get('timeoutMs') || 30000);
const retries = Number(args.get('retries') || 4);
const retryDelayMs = Number(args.get('retryDelayMs') || 750);
const rateLimitDelayMs = Number(args.get('rateLimitDelayMs') || 8000);
const pageDelayMs = Number(args.get('pageDelayMs') || 0);
const minSourceSeconds = Number(args.get('minSourceSeconds') || 600);
const maxSourceSeconds = Number(args.get('maxSourceSeconds') || 3600);
const secondsPerPageEstimate = Number(args.get('secondsPerPageEstimate') || 1.5);
const idleSourceSeconds = Number(args.get('idleSourceSeconds') || 0);
const maxSources = Number(args.get('maxSources') || 0);
const startAt = Number(args.get('startAt') || 1);
const appendDetailPages = args.get('appendDetailPages') === 'true';
const skipExistingPages = args.get('skipExistingPages') !== 'false';
const keepPartialPages = args.get('keepPartialPages') === 'true';
const includeEmptySeedSources = args.get('includeEmptySeedSources') === 'true';
const refreshLeadingPages = Math.max(0, Number(args.get('refreshLeadingPages') || 0));
const allowPartialSources = args.get('allowPartialSources') === 'true';
const maxFailedPages = Math.max(0, Number(args.get('maxFailedPages') || args.get('maxFailedPagesPerSource') || 0));

function safeName(value) {
  const safe = String(value || 'source')
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return safe || 'source';
}

function maxNumber(values) {
  return values.reduce((max, value) => {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > max ? number : max;
  }, 0);
}

function estimatePages(source) {
  const checkTotals = [];
  for (const check of source.checks || []) {
    checkTotals.push(check.total);
    if (check.pagecount && check.count) checkTotals.push(Number(check.pagecount) * pageSize);
  }
  const total = Math.max(1, maxNumber([source.sourceTotalCount, source.itemCount, source.playableCount, ...checkTotals]));
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

function sourceTimeoutSeconds(source) {
  const pages = estimatePages(source);
  return Math.min(maxSourceSeconds, Math.max(minSourceSeconds, Math.ceil(300 + pages * secondsPerPageEstimate)));
}

async function rmTmpDirs() {
  let rows = [];
  try {
    rows = await fs.readdir(detailRoot, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    rows
      .filter((row) => row.isDirectory() && row.name.startsWith('.tmp-'))
      .map((row) => fs.rm(path.join(detailRoot, row.name), { recursive: true, force: true })),
  );
}

function runSource(source, index, total) {
  return new Promise((resolve) => {
    const label = source.name || source.key || source.id || `source-${index + 1}`;
    const base = `${String(index + 1).padStart(3, '0')}-${safeName(label)}`;
    const outLog = path.join(logDir, `${base}.out.log`);
    const errLog = path.join(logDir, `${base}.err.log`);
    const stdout = fsSync.createWriteStream(outLog, { flags: 'w' });
    const stderr = fsSync.createWriteStream(errLog, { flags: 'w' });
    const timeoutSeconds = sourceTimeoutSeconds(source);
    const startedAt = new Date();
    const childArgs = [
      path.join('tools', 'build-full-vod-chunked-catalog.mjs'),
      '--tvRoot',
      tvRoot,
      '--catalog',
      catalogPath,
      '--report',
      reportPath,
      '--detailRoot',
      detailRoot,
      '--includeAdult',
      'true',
      '--sourceMatch',
      String(source.id),
      '--pageSize',
      String(pageSize),
      '--sourceConcurrency',
      '1',
      '--pageConcurrency',
      String(pageConcurrency),
      '--timeoutMs',
      String(timeoutMs),
      '--retries',
      String(retries),
      '--retryDelayMs',
      String(retryDelayMs),
      '--rateLimitDelayMs',
      String(rateLimitDelayMs),
      '--pageDelayMs',
      String(pageDelayMs),
      '--detailOnly',
      'true',
      '--appendDetailPages',
      String(appendDetailPages),
      '--skipExistingPages',
      String(skipExistingPages),
      '--keepPartialPages',
      String(keepPartialPages),
      '--includeEmptySeedSources',
      String(includeEmptySeedSources),
      '--refreshLeadingPages',
      String(refreshLeadingPages),
      '--maxFailedPages',
      String(maxFailedPages),
    ];

    const child = spawn(process.execPath, childArgs, {
      cwd: tvRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    let stdoutText = '';
    let summaryKill = false;
    let idleTimedOut = false;
    let summaryKillTimer = null;
    let idleTimer = null;
    const resetIdleTimer = () => {
      if (idleSourceSeconds <= 0) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        child.kill('SIGKILL');
      }, idleSourceSeconds * 1000);
    };
    resetIdleTimer();
    child.stdout.on('data', (chunk) => {
      resetIdleTimer();
      stdoutText += chunk.toString('utf8');
      if (!summaryKillTimer && /"failedSources"\s*:/.test(stdoutText)) {
        summaryKillTimer = setTimeout(() => {
          summaryKill = true;
          child.kill('SIGKILL');
        }, 3000);
      }
    });
    child.stderr.on('data', () => resetIdleTimer());

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);

    child.on('close', async (code) => {
      clearTimeout(timer);
      if (summaryKillTimer) clearTimeout(summaryKillTimer);
      if (idleTimer) clearTimeout(idleTimer);
      stdout.end();
      stderr.end();
      if (timedOut || summaryKill || idleTimedOut) await rmTmpDirs();
      let errText = '';
      try {
        errText = await fs.readFile(errLog, 'utf8');
      } catch {
        errText = '';
      }
      const failedSources = Number(stdoutText.match(/"failedSources"\s*:\s*(\d+)/)?.[1] || Number.NaN);
      const completedSources = Number(stdoutText.match(/"completedSources"\s*:\s*(\d+)/)?.[1] || Number.NaN);
      const status =
        (timedOut || idleTimedOut) && !summaryKill
          ? 'timeout'
          : Number.isFinite(failedSources)
            ? failedSources > 0 || /failed:/i.test(errText)
              ? 'failed'
              : completedSources > 0
                ? 'completed'
                : code === 0
                  ? 'completed'
                  : 'failed'
            : code !== 0 || /failed:/i.test(errText)
              ? 'failed'
              : 'completed';
      resolve({
        index: index + 1,
        total,
        id: String(source.id || ''),
        key: String(source.key || ''),
        name: String(label),
        api: String(source.api || ''),
        status,
        exitCode: code,
        timeoutSeconds,
        estimatedPages: estimatePages(source),
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        outLog,
        errLog,
      });
    });
  });
}

await fs.mkdir(logDir, { recursive: true });
await fs.mkdir(detailRoot, { recursive: true });
await rmTmpDirs();

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
let sources = (catalog.sources || []).filter((source) => source?.indexable && /^https?:\/\//i.test(String(source.api || '')));
if (startAt > 1) sources = sources.slice(startAt - 1);
if (maxSources > 0) sources = sources.slice(0, maxSources);

const progressPath = path.join(logDir, 'progress.ndjson');
const summaryPath = path.join(logDir, 'summary.json');
await fs.rm(progressPath, { force: true });
await fs.rm(summaryPath, { force: true });

const summary = {
  startedAt: new Date().toISOString(),
  tvRoot,
  catalog: catalogPath,
  detailRoot,
  totalSources: sources.length,
  completed: 0,
  failed: 0,
  timedOut: 0,
  results: [],
};

for (let index = 0; index < sources.length; index += 1) {
  const result = await runSource(sources[index], index, sources.length);
  summary.results.push(result);
  if (result.status === 'completed') summary.completed += 1;
  else if (result.status === 'timeout') summary.timedOut += 1;
  else summary.failed += 1;
  await fs.appendFile(progressPath, `${JSON.stringify(result)}\n`, 'utf8');
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`[${result.index}/${result.total}] ${result.status}: ${result.name}`);
}

summary.finishedAt = new Date().toISOString();
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`done: completed=${summary.completed}, failed=${summary.failed}, timeout=${summary.timedOut}, total=${summary.totalSources}`);
if (!allowPartialSources && (summary.failed > 0 || summary.timedOut > 0)) {
  process.exitCode = 1;
}
