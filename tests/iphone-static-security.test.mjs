import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { updatePolicy } from '../tools/update-iphone-csp.mjs';

const file = path.resolve(import.meta.dirname, '..', 'docs', 'iphone', 'index.html');
const html = await fs.readFile(file, 'utf8');

test('inline module parses and its CSP hash is current', () => {
  const moduleSource = html.match(/<script\s+type="module"\s+data-csp-hash>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(moduleSource, 'hashed module script is present');
  assert.doesNotThrow(() => new Function(`return async () => {${moduleSource}\n}`));
  assert.equal(updatePolicy(html).html, html);
  const policy = html.match(/data-oktv-csp\s+content="([^"]+)"/)?.[1] || '';
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("base-uri 'none'"));
  assert.ok(!policy.includes("'unsafe-inline'"));
  assert.ok(!policy.includes("'unsafe-eval'"));
});

test('third-party scripts are pinned with integrity metadata', () => {
  const remoteScripts = [...html.matchAll(/<script\s+[^>]*src="https:\/\/[^>]+><\/script>/g)].map((match) => match[0]);
  assert.equal(remoteScripts.length, 2);
  for (const tag of remoteScripts) {
    assert.match(tag, /@\d+(?:\.\d+)+\//);
    assert.match(tag, /integrity="sha384-[^"]+"/);
    assert.match(tag, /crossorigin="anonymous"/);
  }
});

test('rendered markup has no inline event handlers or style attributes', () => {
  assert.doesNotMatch(html, /\s(?:onerror|onclick|onload|onmouseover|onfocus|oninput|onchange)\s*=/i);
  assert.doesNotMatch(html, /\sstyle="/i);
  assert.match(html, /function plainTextFromMarkup\([\s\S]*?\.replace\(\/<\[\^>\]\*>\/g, ' '\)/);
  assert.doesNotMatch(html, /new DOMParser\(\)\.parseFromString\(raw, 'text\/html'\)/);
  assert.match(html, /displayHtml\(plainTextFromMarkup\(item\.content \|\| item\.actor \|\| item\.director\)/);
});

test('player iframe is sandboxed and media URLs pass through allowlist helpers', () => {
  assert.match(html, /<iframe[^>]+sandbox="[^"]*allow-scripts[^"]*"/);
  assert.doesNotMatch(html, /<iframe[^>]+sandbox="[^"]*allow-same-origin[^"]*"/);
  assert.match(html, /function safeHttpUrl\(/);
  assert.match(html, /function safeEmbedUrl\(/);
  assert.match(html, /playerFrame\.src = verifiedEmbedUrl/);
  assert.match(html, /player\.src = verifiedMediaUrl/);
});
