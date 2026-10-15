import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('all workflows writing shared data serialize before checkout and retain queued work', async () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  const publishers = [];
  for (const name of await fs.readdir(directory)) {
    if (!name.endsWith('.yml')) continue;
    const source = await fs.readFile(new URL(name, directory), 'utf8');
    if (!/publish-gh-pages-batched\.ps1|push origin HEAD:gh-pages/.test(source)) continue;
    const block = source.match(/^concurrency:\r?\n((?:[ \t]+[^\n]*\r?\n|\r?\n)*)/m)?.[1];
    assert.ok(block, `${name} must hold the shared lock before taking its data snapshot`);
    const values = {};
    for (const line of block.split(/\r?\n/)) {
      const field = line.match(/^  ([\w-]+):\s*(.*?)\s*$/);
      if (!field) continue;
      assert.ok(!(field[1] in values), `${name} has a duplicate concurrency field: ${field[1]}`);
      values[field[1]] = field[2];
    }
    assert.equal(values['cancel-in-progress'], 'false', `${name} must not interrupt another data writer`);
    assert.equal(values.queue, 'max', `${name} must not discard a queued different publisher`);
    assert.ok(values.group && !values.group.includes('${{'), `${name} writes one shared branch regardless of caller ref`);
    publishers.push({ name, group: values.group });
  }
  assert.ok(publishers.length >= 3, 'expected live, full catalog, and public media publishers');
  assert.equal(new Set(publishers.map(publisher => publisher.group)).size, 1,
    `shared branch has conflicting locks: ${JSON.stringify(publishers)}`);
});
