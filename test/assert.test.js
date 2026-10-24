// test/assert.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAssertions } from '../src/flows/assert.js';

const okView = {
  ok: true,
  result: { content: [{ type: 'text', text: 'Echo: hello' }], structuredContent: { count: 2 } },
  error: null,
  latencyMs: 42,
  raw: null,
};

const errView = {
  ok: false,
  result: null,
  error: { message: 'Intentional failure happened' },
  latencyMs: 10,
  raw: null,
};

function fails(view, expect) {
  return runAssertions(view, expect).filter((r) => !r.pass);
}

test('ok expectation', () => {
  assert.equal(fails(okView, { ok: true }).length, 0);
  assert.equal(fails(errView, { ok: false }).length, 0);
  assert.ok(fails(okView, { ok: false }).length > 0);
  assert.ok(fails(errView, { ok: true }).length > 0);
});

test('equals with deep values and paths', () => {
  assert.equal(fails(okView, { equals: { 'result.content.0.text': 'Echo: hello' } }).length, 0);
  assert.equal(fails(okView, { equals: { 'result.structuredContent.count': 2 } }).length, 0);
  assert.ok(fails(okView, { equals: { 'result.content.0.text': 'nope' } }).length > 0);
  assert.ok(fails(okView, { equals: { 'result.content.99.text': 'x' } })[0].message.includes('not found'));
});

test('contains: strings and arrays', () => {
  assert.equal(fails(okView, { contains: { 'result.content.0.text': 'hello' } }).length, 0);
  assert.ok(fails(okView, { contains: { 'result.content.0.text': 'world' } }).length > 0);
  const arrView = { ...okView, result: { content: [{ type: 'a' }, { type: 'b' }] } };
  assert.equal(fails(arrView, { contains: { 'result.content': { type: 'b' } } }).length, 0);
  assert.ok(fails(arrView, { contains: { 'result.content': { type: 'z' } } }).length > 0);
});

test('matches: regex with flags, and invalid regex is a failure not a crash', () => {
  assert.equal(fails(okView, { matches: { 'result.content.0.text': '^Echo:' } }).length, 0);
  assert.equal(fails(okView, { matches: { 'result.content.0.text': { source: '^ECHO', flags: 'i' } } }).length, 0);
  assert.ok(fails(okView, { matches: { 'result.content.0.text': '^\\d+$' } }).length > 0);
  const res = fails(okView, { matches: { 'result.content.0.text': '(' } });
  assert.ok(res[0].message.includes('invalid regex'));
});

test('schema type checks', () => {
  assert.equal(fails(okView, { schema: { 'result.content.0.text': 'string', 'result.structuredContent.count': 'number' } }).length, 0);
  assert.ok(fails(okView, { schema: { 'result.structuredContent.count': 'string' } }).length > 0);
  assert.equal(fails(okView, { schema: { 'result.content': 'array' } }).length, 0);
  assert.equal(fails(okView, { schema: { latencyMs: 'number' } }).length, 0);
});

test('exists / notExists', () => {
  assert.equal(fails(okView, { exists: ['result.content.0.text'] }).length, 0);
  assert.ok(fails(okView, { exists: ['result.missing'] }).length > 0);
  assert.equal(fails(okView, { notExists: ['result.missing'] }).length, 0);
  assert.ok(fails(okView, { notExists: ['result.content'] }).length > 0);
});

test('latencyMs budget', () => {
  assert.equal(fails(okView, { latencyMs: { max: 100 } }).length, 0);
  assert.ok(fails(okView, { latencyMs: { max: 10 } })[0].message.includes('exceeded'));
  assert.ok(fails(okView, { latencyMs: -5 }).length > 0, 'invalid budget reported');
});

test('errorContains', () => {
  assert.equal(fails(errView, { errorContains: 'intentional' }).length, 0, 'case-insensitive');
  assert.ok(fails(okView, { errorContains: 'x' }).length > 0, 'fails on ok view');
  assert.ok(fails(errView, { errorContains: 'zzz' }).length > 0);
});

test('multiple assertions accumulate', () => {
  const res = runAssertions(okView, {
    ok: true,
    equals: { 'result.content.0.text': 'Echo: hello' },
    contains: { 'result.content.0.text': 'Echo' },
    schema: { 'result.content': 'array' },
    exists: ['latencyMs'],
  });
  assert.equal(res.length, 5);
  assert.ok(res.every((r) => r.pass));
});
