// test/parse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFlow } from '../src/flows/parse.js';

const good = {
  name: 't',
  steps: [{ call: 'echo', args: { x: 1 }, expect: { ok: true }, extract: { v: 'result.content.0.text' } }],
};

test('accepts a valid flow', () => {
  assert.doesNotThrow(() => validateFlow(good));
  assert.doesNotThrow(() =>
    validateFlow({
      name: 't',
      server: { command: 'node', args: ['s.js'] },
      timeoutMs: 1000,
      vars: { a: 1 },
      steps: [
        { call: 'x', as: 'step-one', retries: 2, ignore: false, expect: { equals: {}, contains: {}, matches: {}, schema: {}, exists: ['a'], notExists: ['b'], latencyMs: 100, errorContains: 'x', ok: false } },
      ],
    })
  );
});

test('rejects structurally broken flows with precise messages', () => {
  assert.throws(() => validateFlow(null), /JSON object/);
  assert.throws(() => validateFlow({}), /"name"/);
  assert.throws(() => validateFlow({ name: 'x' }), /"steps"/);
  assert.throws(() => validateFlow({ name: 'x', steps: [] }), /non-empty/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{}] }), /"call"/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 5 }] }), /"call"/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a' }, 5] }), /steps\[1\]/);
  assert.throws(() => validateFlow({ ...good, unknownKey: 1 }), /unknown top-level key/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a', bogus: 1 }] }), /unknown key/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a', expect: { ok: 'yes' } }] }), /expect.ok/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a', expect: { nope: {} } }] }), /unknown key/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a', extract: 5 }] }), /extract/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a', retries: -1 }] }), /retries/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a', as: 'b' }, { call: 'c', as: 'b' }] }), /duplicate step name/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a' }], server: { command: 'x', url: 'http://x' } }), /both/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a' }], server: {} }), /"command" or "url"/);
  assert.throws(() => validateFlow({ name: 'x', steps: [{ call: 'a' }], timeoutMs: -1 }), /timeoutMs/);
});
