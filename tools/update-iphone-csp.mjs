import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key.startsWith('--')) continue;
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
  return args;
}

function sha256(value) {
  return `sha256-${crypto.createHash('sha256').update(value, 'utf8').digest('base64')}`;
}

function singleMatch(html, pattern, label) {
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  return matches[0][1];
}

export function buildPolicy(html) {
  const style = singleMatch(html, /<style\s+data-csp-hash>([\s\S]*?)<\/style>/g, 'hashed style block');
  const script = singleMatch(
    html,
    /<script\s+type="module"\s+data-csp-hash>([\s\S]*?)<\/script>/g,
    'hashed module script block',
  );
  return [
    "default-src 'self'",
    `script-src 'self' '${sha256(script)}' https://cdn.jsdelivr.net`,
    `style-src 'self' '${sha256(style)}'`,
    "img-src 'self' data: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https:",
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function updatePolicy(html) {
  const policy = buildPolicy(html);
  const metaPattern = /<meta\s+http-equiv="Content-Security-Policy"\s+data-oktv-csp\s+content="[^"]*"\s*\/?>/g;
  const matches = [...html.matchAll(metaPattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one CSP meta tag; found ${matches.length}.`);
  return {
    policy,
    html: html.replace(
      metaPattern,
      `<meta http-equiv="Content-Security-Policy" data-oktv-csp content="${policy}" />`,
    ),
  };
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const file = path.resolve(args.get('file') || path.resolve(import.meta.dirname, '..', 'docs', 'iphone', 'index.html'));
  const check = args.get('check') === 'true';
  const current = await fs.readFile(file, 'utf8');
  const normalized = current.replace(/\r\n?/g, '\n');
  const result = updatePolicy(normalized);
  if (check) {
    if (result.html !== current) throw new Error(`CSP hashes are stale: ${file}`);
  } else if (result.html !== current) {
    await fs.writeFile(file, result.html, 'utf8');
  }
  console.log(JSON.stringify({ file, check, policy: result.policy }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
