// test/report.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJunit } from '../src/report/junit.js';
import { renderTap } from '../src/report/tap.js';
import { renderJson } from '../src/report/json.js';
import { renderPretty } from '../src/report/pretty.js';

function fakeRun() {
  return {
    startedAt: '2026-01-01T00:00:00Z',
    durationMs: 123,
    totals: { flows: 2, passed: 1, failed: 1, steps: 3, stepsPassed: 2 },
    flows: [
      {
        name: 'good',
        description: null,
        status: 'passed',
        error: null,
        connection: { serverInfo: { name: 'srv', version: '1' }, protocolVersion: '2025-06-18', transport: 'stdio', tools: 3 },
        warnings: [],
        steps: [
          { index: 1, name: 'a', tool: 'a', status: 'passed', latencyMs: 5, attempts: 1, failures: [], warnings: [] },
        ],
      },
      {
        name: 'bad <flow> & "quote"',
        description: null,
        status: 'failed',
        error: null,
        connection: null,
        warnings: ['watch out'],
        steps: [
          { index: 1, name: 'b', tool: 'b', status: 'failed', latencyMs: 7, attempts: 2, failures: [{ pass: false, message: 'expected <x> & got "y"' }], warnings: [] },
        ],
      },
    ],
  };
}

test('junit escapes XML and counts failures', () => {
  const xml = renderJunit(fakeRun());
  assert.ok(xml.includes('tests="3"'));
  assert.ok(xml.includes('failures="1"'));
  assert.ok(xml.includes('&lt;x&gt; &amp; got &quot;y&quot;'));
  assert.ok(!xml.includes('<x> &'));
});

test('tap counts and labels', () => {
  const tap = renderTap(fakeRun());
  assert.ok(tap.startsWith('TAP version 13'));
  assert.ok(tap.includes('1..3'));
  assert.ok(tap.includes('ok 1 - good › a'));
  assert.ok(tap.includes('not ok 2 - bad <flow> & "quote" › b'));
  assert.ok(tap.includes('# fail  1'));
});

test('json round-trips', () => {
  const data = JSON.parse(renderJson(fakeRun()));
  assert.equal(data.totals.failed, 1);
  assert.equal(data.passing, false);
  assert.equal(data.flows[1].steps[0].failures[0].message, 'expected <x> & got "y"');
});

test('pretty renders without color when disabled', () => {
  const out = renderPretty(fakeRun(), { color: false });
  assert.ok(out.includes('FAILING'));
  assert.ok(out.includes('good'));
  assert.ok(out.includes('expected <x> & got "y"'));
  assert.ok(!out.includes('\x1b['), 'no ANSI escapes');
});
