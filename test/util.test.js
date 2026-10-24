// test/util.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual, getPath, interpolateValue, resolveExpr, truncate, withTimeout } from '../src/util.js';

test('deepEqual: primitives, NaN, arrays, objects', () => {
  assert.ok(deepEqual(1, 1));
  assert.ok(deepEqual('a', 'a'));
  assert.ok(deepEqual(NaN, NaN));
  assert.ok(!deepEqual(1, '1'));
  assert.ok(!deepEqual(null, undefined));
  assert.ok(deepEqual([1, [2, 3]], [1, [2, 3]]));
  assert.ok(!deepEqual([1, 2], [1, 2, 3]));
  assert.ok(deepEqual({ a: 1, b: { c: 'x' } }, { b: { c: 'x' }, a: 1 }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!deepEqual([1, 2], { 0: 1, 1: 2 }));
});

test('getPath: dot paths with numeric indices', () => {
  const obj = { content: [{ type: 'text', text: 'hi' }], meta: null };
  const hit = getPath(obj, 'content.0.text');
  assert.equal(hit.found, true);
  assert.equal(hit.value, 'hi');
  assert.equal(getPath(obj, 'content.0.type').value, 'text');
  assert.ok(!getPath(obj, 'content.1').found);
  assert.ok(!getPath(obj, 'content.x').found, 'non-numeric index on array');
  assert.ok(!getPath(obj, 'meta.deep').found, 'null traversal');
  assert.ok(!getPath(obj, 'nope').found);
  assert.ok(!getPath(obj, 'with space').found, 'invalid syntax');
  assert.ok(!getPath(obj, 'injection"];').found, 'invalid syntax 2');
  assert.ok(getPath(obj, 'content').found);
});

test('interpolateValue: native value for pure template, string concat otherwise', () => {
  const scope = { vars: { n: 5, obj: { a: 1 } }, steps: {}, env: {} };
  assert.equal(interpolateValue('{{vars.n}}', scope), 5);
  assert.deepEqual(interpolateValue('{{vars.obj}}', scope), { a: 1 });
  assert.equal(interpolateValue('x={{vars.n}}', scope), 'x=5');
  assert.equal(interpolateValue('no templates', scope), 'no templates');
  assert.deepEqual(interpolateValue({ deep: ['{{vars.n}}', { k: 'v={{vars.n}}' }] }, scope), { deep: [5, { k: 'v=5' }] });
  assert.throws(() => interpolateValue('{{vars.missing}}', scope), /could not be resolved/);
  assert.throws(() => interpolateValue('{{bogus.root}}', scope), /Unknown template root/);
});

test('resolveExpr: unknown roots and empty remainder', () => {
  assert.throws(() => resolveExpr('nope.x', { vars: {} }), /Unknown template root/);
  const whole = resolveExpr('vars', { vars: { a: 1 } });
  assert.deepEqual(whole.value, { a: 1 });
});

test('withTimeout resolves and rejects', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 100), 'ok');
  await assert.rejects(() => withTimeout(new Promise(() => {}), 20, 'too slow'), /too slow/);
});

test('truncate', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.ok(truncate('x'.repeat(300), 100).length <= 100);
});
