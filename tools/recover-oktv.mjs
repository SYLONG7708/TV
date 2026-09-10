import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKFLOWS = { vod: 'update-lunatv-vod.yml', live: 'update-youtube-live.yml', pages: 'deploy-oktv-pages.yml', integrity: 'validate-oktv-integrity.yml' };
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

export function classifyFailure(jobs = []) {
  const failed = jobs.filter((job) => FAILED.has(job.conclusion));
  const names = failed.flatMap((job) => [job.name, ...(job.steps || []).filter((s) => s.conclusion === 'failure').map((s) => s.name)]).join(' ');
  return /deploy|Verify.*Pages|Verify complete public system/i.test(names) ? 'pages' : 'workflow';
}

export function planRecovery({ runs = {}, health = {}, dataHead = '', now = Date.now() }) {
  const histories = Object.fromEntries(Object.keys(WORKFLOWS).map((key) => [key,
    (runs[key] || []).filter((r) => !r.head_branch || r.head_branch === 'main').sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
  ]));
  const wanted = new Map();
  const decisions = [];
  for (const [key, history] of Object.entries(histories)) {
    const latest = history[0];
    if (latest && FAILED.has(latest.conclusion)) {
      const pagesSuccess = histories.pages.find((run) => run.conclusion === 'success');
      if (latest.failureStage === 'pages' && health.deployment?.dataCommit === dataHead &&
          pagesSuccess && Date.parse(pagesSuccess.updated_at) > Date.parse(latest.updated_at)) continue;
      wanted.set(latest.failureStage === 'pages' ? 'pages' : key, { reason: `${key} run ${latest.id} failed`, sourceRun: latest.id });
    }
  }
  if (health.repair?.pages || health.checks?.coreFiles === false || health.checks?.pageShell === false) {
    wanted.set('pages', { reason: 'public page or metadata unavailable' });
  } else {
    if (health.repair?.vod) wanted.set('vod', { reason: 'VOD freshness, catalog, or index degraded' });
    if (health.repair?.live) wanted.set('live', { reason: 'live freshness or availability degraded' });
  }
  if (dataHead && health.deployment?.dataCommit !== dataHead) wanted.set('pages', { reason: 'published website does not match current data revision' });
  for (const [key, cause] of wanted) {
    const history = histories[key];
    if (history.some((r) => ACTIVE.has(r.status))) {
      decisions.push({ key, action: 'wait', reason: 'target workflow already active' });
      continue;
    }
    if (['vod', 'live', 'pages'].includes(key) && ['vod', 'live'].some((writer) => histories[writer].some((r) => ACTIVE.has(r.status)))) {
      decisions.push({ key, action: 'wait', reason: 'data publisher already active' });
      continue;
    }
    const latest = history[0];
    let failures = 0;
    for (const run of history) {
      if (run.conclusion === 'success') break;
      if (FAILED.has(run.conclusion)) failures++;
    }
    // First failure retries promptly; repeated failures back off. Resolved
    // historical failures never permanently disable new updates.
    const cooldownMinutes = failures >= 4 ? 360 : failures === 3 ? 60 : failures === 2 ? 15 : failures === 1 ? 0 : 15;
    const previous = Date.parse(latest?.updated_at || latest?.created_at || '') || 0;
    if (latest && now - previous < cooldownMinutes * 60_000) {
      decisions.push({ key, action: 'wait', reason: 'bounded retry cooldown', retryAfter: new Date(previous + cooldownMinutes * 60_000).toISOString() });
      continue;
    }
    decisions.push({ key, action: 'dispatch', workflow: WORKFLOWS[key], ...cause, consecutiveFailures: failures });
  }
  return decisions;
}

export async function githubApi(endpoint, { method = 'GET', body, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) {
  if (!token) throw new Error('GitHub token is required');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(`https://api.github.com/${endpoint}`, {
        method, signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      // A timed-out dispatch may already have succeeded; never blindly repeat it.
      if (method !== 'GET' || attempt === 2) throw error;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (response.ok) return response.status === 204 ? null : response.json();
    if (method === 'GET' && response.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}`);
  }
}

export async function recover({ repository, health, api = githubApi, now = Date.now() }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('Invalid repository');
  const prefix = `repos/${repository}`;
  const runs = {};
  for (const [key, workflow] of Object.entries(WORKFLOWS)) {
    const result = await api(`${prefix}/actions/workflows/${workflow}/runs?per_page=30&branch=main`);
    runs[key] = result.workflow_runs || [];
    const latest = runs[key][0];
    if (latest && FAILED.has(latest.conclusion)) {
      const jobs = await api(`${prefix}/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`);
      latest.failureStage = classifyFailure(jobs.jobs);
    }
  }
  const ref = await api(`${prefix}/git/ref/heads/gh-pages`);
  const decisions = planRecovery({ runs, health, dataHead: ref.object.sha, now });
  const report = { checkedAt: new Date(now).toISOString(), publicHealthy: Boolean(health.ok), dataHead: ref.object.sha, decisions, dispatched: [], status: 'healthy' };
  for (const decision of decisions) {
    if (decision.action !== 'dispatch') continue;
    const fresh = await api(`${prefix}/actions/workflows/${decision.workflow}/runs?per_page=10&branch=main`);
    if (fresh.workflow_runs?.some((r) => ACTIVE.has(r.status))) {
      decision.action = 'wait';
      decision.reason = 'another run started before dispatch';
      continue;
    }
    await api(`${prefix}/actions/workflows/${decision.workflow}/dispatches`, { method: 'POST', body: { ref: 'main' } });
    report.dispatched.push(decision.workflow);
  }
  report.status = report.dispatched.length ? 'repair-dispatched' : decisions.length ? 'waiting-for-recovery' : health.ok ? 'healthy' : 'degraded';
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].slice(2), process.argv[i + 1]);
  let health;
  try { health = JSON.parse((await fs.readFile(args.get('health') || 'oktv-system-health.json', 'utf8')).replace(/^\uFEFF/, '')); }
  catch { health = { ok: false, repair: { pages: true }, error: 'health report unavailable' }; }
  const report = await recover({ repository: process.env.GITHUB_REPOSITORY || 'SYLONG7708/TV', health });
  const text = JSON.stringify(report, null, 2) + '\n';
  await fs.writeFile(args.get('output') || 'oktv-recovery-report.json', text, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Automatic recovery\n\n\`\`\`json\n${text}\`\`\`\n`);
  console.log(text);
}
