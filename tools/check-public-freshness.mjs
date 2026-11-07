const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const baseUrl = String(args.get('baseUrl') || 'https://sylong7708.github.io/TV').replace(/\/+$/, '');
const maxVodAgeHours = Number(args.get('maxVodAgeHours') || 30);
const maxLiveAgeHours = Number(args.get('maxLiveAgeHours') || 8);
const failOnStale = args.get('failOnStale') !== 'false';

async function fetchJson(pathname) {
  const url = `${baseUrl}${pathname}${pathname.includes('?') ? '&' : '?'}freshness=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'OKTV-public-freshness-check/1.0',
      'cache-control': 'no-cache',
    },
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

function ageHours(value) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 36e5;
}

function formatAge(hours) {
  return Number.isFinite(hours) ? `${hours.toFixed(2)}h` : 'unknown';
}

const [vodState, vodReport, sourceSummary] = await Promise.all([
  fetchJson('/docs/data/lunatv-vod-update-state.json').catch((error) => ({ error: error.message })),
  fetchJson('/docs/data/iphone-vod-catalog-report.json').catch((error) => ({ error: error.message })),
  fetchJson('/docs/data/source-summary.json').catch((error) => ({ error: error.message })),
]);

const vodStateAge = ageHours(vodState.lastSuccessAt);
const vodReportAge = ageHours(vodReport.generatedAt);
const liveReference =
  sourceSummary.live?.lastAttemptAt || sourceSummary.lastLiveAttemptAt || sourceSummary.generatedAt;
const liveSummaryAge = ageHours(liveReference);

const checks = [
  {
    name: 'vod-state',
    value: vodState.lastSuccessAt || '',
    ageHours: vodStateAge,
    maxAgeHours: maxVodAgeHours,
    ok: vodStateAge <= maxVodAgeHours,
    error: vodState.error || '',
  },
  {
    name: 'vod-public-report',
    value: vodReport.generatedAt || '',
    ageHours: vodReportAge,
    maxAgeHours: maxVodAgeHours,
    ok: vodReportAge <= maxVodAgeHours,
    error: vodReport.error || '',
  },
  {
    name: 'live-public-summary',
    value: liveReference || '',
    ageHours: liveSummaryAge,
    maxAgeHours: maxLiveAgeHours,
    ok: liveSummaryAge <= maxLiveAgeHours,
    error: sourceSummary.error || '',
  },
];

const stale = checks.filter((check) => !check.ok);
const vodStale = checks.some((check) => check.name.startsWith('vod-') && !check.ok);
const liveStale = checks.some((check) => check.name.startsWith('live-') && !check.ok);
const report = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  thresholds: { maxVodAgeHours, maxLiveAgeHours },
  checks: checks.map((check) => ({
    ...check,
    age: formatAge(check.ageHours),
  })),
  vodStale,
  liveStale,
  ok: stale.length === 0,
};

console.log(JSON.stringify(report, null, 2));

if (stale.length && failOnStale) {
  process.exitCode = 1;
}
