// test/template.test.js — extraction + args resolution against a step view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyExtract, resolveArgs, buildScope } from '../src/flows/template.js';

const view = {
  ok: true,
  result: { content: [{ type: 'text', text: 'HELLO' }], structuredContent: { total: 5.5 } },
  error: null,
  latencyMs: 12,
};

test('applyExtract pulls values into vars with warnings for bad paths', () => {
  const { vars, warnings } = applyExtract(
    { shout: 'result.content.0.text', total: 'result.structuredContent.total', bad: 'result.nope', wrongRoot: 'banana.x' },
    view
  );
  assert.equal(vars.shout, 'HELLO');
  assert.equal(vars.total, 5.5);
  assert.equal(vars.bad, undefined);
  assert.equal(warnings.length, 2);
});

test('resolveArgs interpolates native values into args', () => {
  const scope = buildScope({ vars: { n: 5, s: 'x' }, steps: { one: view }, env: { USER: 'erfan' } });
  assert.deepEqual(resolveArgs({ a: '{{vars.n}}', b: 'v={{vars.s}}', c: { d: ['{{vars.n}}'] } }, scope), { a: 5, b: 'v=x', c: { d: [5] } });
  assert.deepEqual(resolveArgs({ t: '{{steps.one.result.content.0.text}}' }, scope), { t: 'HELLO' });
  assert.deepEqual(resolveArgs({ e: '{{env.USER}}' }, scope), { e: 'erfan' });
  assert.throws(() => resolveArgs({ x: '{{vars.gone}}' }, scope), /in "args"/);
});
