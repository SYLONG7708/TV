import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function verifyDeployment({ baseUrl = 'https://sylong7708.github.io/TV', dataRevision, codeRevision, attempts = 12, delayMs = 10_000, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(`${baseUrl}/docs/data/deployment-state.json?verify=${Date.now()}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const state = await response.json();
      if (state.dataCommit !== dataRevision || state.codeCommit !== codeRevision) throw new Error('CDN still serves a different deployment revision');
      if (!state.bulkDataExternal || state.payloadBytes > state.maxPayloadBytes) throw new Error('Invalid Pages payload manifest');
      return state;
    } catch (error) { lastError = error; }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw lastError;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].slice(2), process.argv[i + 1]);
  console.log(JSON.stringify(await verifyDeployment({ baseUrl: args.get('baseUrl'), dataRevision: args.get('dataRevision'), codeRevision: args.get('codeRevision') }), null, 2));
}
