// test/glob.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandGlob, matchPattern } from '../src/glob.js';

function tmpTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpflow-glob-'));
  fs.mkdirSync(path.join(dir, 'flows', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'flows', 'a.flow.json'), '{}');
  fs.writeFileSync(path.join(dir, 'flows', 'b.flow.json'), '{}');
  fs.writeFileSync(path.join(dir, 'flows', 'nested', 'c.flow.json'), '{}');
  fs.writeFileSync(path.join(dir, 'flows', 'readme.md'), '');
  fs.writeFileSync(path.join(dir, 'top.flow.json'), '{}');
  return dir;
}

test('matchPattern: *, **, ?, literal', () => {
  assert.ok(matchPattern('flows/*.flow.json', 'flows/a.flow.json'));
  assert.ok(!matchPattern('flows/*.flow.json', 'flows/nested/c.flow.json'));
  assert.ok(matchPattern('flows/**/*.flow.json', 'flows/nested/c.flow.json'));
  assert.ok(matchPattern('flows/**/*.flow.json', 'flows/a.flow.json'));
  assert.ok(matchPattern('flows/?.flow.json', 'flows/a.flow.json'));
  assert.ok(!matchPattern('flows/?.flow.json', 'flows/ab.flow.json'));
  assert.ok(matchPattern('top.flow.json', 'top.flow.json'));
  assert.ok(matchPattern('**/*.flow.json', 'flows/nested/c.flow.json'));
});

test('expandGlob finds files and sorts them', () => {
  const dir = tmpTree();
  const files = expandGlob('flows/**/*.flow.json', dir).map((p) => path.relative(dir, p).split(path.sep).join('/'));
  assert.deepEqual(files, ['flows/a.flow.json', 'flows/b.flow.json', 'flows/nested/c.flow.json']);
  const one = expandGlob('flows/a.flow.json', dir);
  assert.equal(one.length, 1);
  assert.equal(expandGlob('flows/missing.flow.json', dir).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('expandGlob: literal missing file returns empty (caller decides)', () => {
  const dir = tmpTree();
  assert.equal(expandGlob('no-such.file', dir).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
