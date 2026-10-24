import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('regional title aliases cover Traditional, Simplified, and Taiwan naming', async () => {
  const registry = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'sources', 'title-aliases.json'), 'utf8'),
  );
  const group = registry.groups.find((entry) => entry.canonicalTraditional === '至死不渝');

  assert.ok(group);
  assert.ok(group.aliases.includes('痴迷'));
  assert.ok(group.aliases.includes('癡迷'));
});

test('web search expands aliases from the query manifest instead of renaming source titles', async () => {
  const html = await fs.readFile(path.join(repoRoot, 'docs', 'iphone', 'index.html'), 'utf8');

  assert.match(html, /state\.queryIndex\.manifest\?\.titleAliases/);
  assert.match(html, /aliases\.push\(query\.replaceAll\(variant, replacement\)\)/);
});
