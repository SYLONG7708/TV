import assert from 'node:assert/strict';
import test from 'node:test';
import { planRecovery, classifyFailure, recover } from '../tools/recover-oktv.mjs';
import { verifyDeployment } from '../tools/verify-pages-deployment.mjs';

const now = Date.parse('2026-09-10T12:00:00Z');
const sha = 'a'.repeat(40);
const health = { ok: true, checks: { coreFiles: true, pageShell: true }, repair: {}, deployment: { dataCommit: sha } };
function run(id, conclusion, minutes = 30, extras = {}) {
  return { id, status: 'completed', conclusion, head_branch: 'main', created_at: new Date(now - minutes * 60_000).toISOString(), updated_at: new Date(now - (minutes - 1) * 60_000).toISOString(), ...extras };
}

test('resolved historical failures do not block healthy workflows or trigger quota retry storms', () => {
  assert.deepEqual(planRecovery({ runs: { vod: [run(2, 'success'), run(1, 'failure', 300)] }, health, dataHead: sha, now }), []);
});
test('the first failure dispatches a fresh run without waiting six hours', () => {
  const result = planRecovery({ runs: { live: [run(3, 'failure', 1)] }, health, dataHead: sha, now });
  assert.equal(result[0].workflow, 'update-youtube-live.yml');
  assert.equal(result[0].action, 'dispatch');
});
test('deployment failure repairs only deployment and resolved failures stay resolved', () => {
  const failed = run(4, 'failure', 30, { failureStage: 'pages' });
  let result = planRecovery({ runs: { live: [failed] }, health, dataHead: sha, now });
  assert.deepEqual(result.map((x) => x.key), ['pages']);
  result = planRecovery({ runs: { live: [failed], pages: [run(5, 'success', 20)] }, health, dataHead: sha, now });
  assert.deepEqual(result, []);
  assert.equal(classifyFailure([{ name: 'deploy / deploy', conclusion: 'failure', steps: [] }]), 'pages');
  assert.equal(classifyFailure([{ name: 'update', conclusion: 'failure', steps: [{ name: 'Refresh URLs', conclusion: 'failure' }] }]), 'workflow');
});
test('pending and queued publishers prevent duplicate repair or conflicting deployment', () => {
  const result = planRecovery({ runs: { vod: [run(6, '', 1, { status: 'pending' })] }, health: { ...health, repair: { live: true } }, dataHead: 'b'.repeat(40), now });
  assert.ok(result.length > 0);
  assert.ok(result.every((x) => x.action === 'wait'));
});
test('repeated failures back off and automatically become eligible again', () => {
  const runs = { live: [run(8, 'failure', 2), run(7, 'failure', 4)] };
  assert.equal(planRecovery({ runs, health, dataHead: sha, now })[0].action, 'wait');
  assert.equal(planRecovery({ runs, health, dataHead: sha, now: now + 20 * 60_000 })[0].action, 'dispatch');
});
test('missing public shell repairs deployment before rerunning all data collection', () => {
  const result = planRecovery({ health: { ok: false, checks: { coreFiles: false }, repair: { pages: true, vod: true, live: true } }, dataHead: sha, now });
  assert.deepEqual(result.map((x) => x.key), ['pages']);
});
test('stale live data does not cause full VOD refresh', () => {
  const result = planRecovery({ health: { ...health, repair: { live: true } }, dataHead: sha, now });
  assert.deepEqual(result.map((x) => x.workflow), ['update-youtube-live.yml']);
});
test('public media publishers also block conflicting repairs and deployments', () => {
  const result = planRecovery({ runs: { public: [run(10, '', 1, { status: 'in_progress' })] },
    health: { ...health, repair: { live: true } }, dataHead: 'b'.repeat(40), now });
  assert.ok(result.length > 0);
  assert.ok(result.every(row => row.action === 'wait'));
});
test('daily audit and backup failures are monitored without blind retries of code errors', () => {
  const failureStage = classifyFailure([{ name: 'audit', conclusion: 'failure', steps: [
    { name: 'Verify application behavior before network diagnosis', conclusion: 'failure' },
  ] }]);
  assert.equal(failureStage, 'code');
  const result = planRecovery({ runs: { audit: [run(11, 'failure', 2, { failureStage })],
    backups: [run(12, 'failure', 2)] }, health, dataHead: sha, now });
  assert.equal(result.find(row => row.key === 'audit').action, 'attention');
  assert.equal(result.find(row => row.key === 'backups').workflow, 'refresh-playback-repairs.yml');
});
test('healthy media endpoints cannot hide an unresolved interface regression', async () => {
  const api = async endpoint => {
    if (endpoint.endsWith('git/ref/heads/gh-pages')) return { object: { sha } };
    if (endpoint.includes('/jobs?')) return { jobs: [{ name: 'interface', conclusion: 'failure',
      steps: [{ name: 'Fail the run when interface regressions are found', conclusion: 'failure' }] }] };
    if (endpoint.includes('daily-media-audit.yml/runs?')) return { workflow_runs: [run(13, 'failure', 2)] };
    return { workflow_runs: [] };
  };
  const report = await recover({ repository: 'SYLONG7708/TV', health, api, now });
  assert.equal(report.status, 'needs-attention');
  assert.equal(report.publicHealthy, true);
  assert.deepEqual(report.dispatched, []);
});
test('dispatch race is checked again and pending recovery is not reported healthy', async () => {
  const posts = [];
  const api = async (endpoint, options) => {
    if (options?.method === 'POST') { posts.push(endpoint); return null; }
    if (endpoint.endsWith('git/ref/heads/gh-pages')) return { object: { sha } };
    if (endpoint.includes('per_page=10')) return { workflow_runs: [run(9, '', 1, { status: 'queued' })] };
    return { workflow_runs: [] };
  };
  const report = await recover({ repository: 'SYLONG7708/TV', health: { ...health, repair: { live: true } }, api, now });
  assert.equal(posts.length, 0);
  assert.equal(report.status, 'waiting-for-recovery');
});
test('CDN verification waits for the exact data and code revisions', async () => {
  let calls = 0;
  const state = { dataCommit: sha, codeCommit: sha, bulkDataExternal: true, payloadBytes: 100, maxPayloadBytes: 200 };
  const result = await verifyDeployment({ dataRevision: sha, codeRevision: sha, delayMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ...state, dataCommit: ++calls === 1 ? 'old' : sha }) }), sleep: async () => {},
  });
  assert.equal(result.dataCommit, sha);
  assert.equal(calls, 2);
});
