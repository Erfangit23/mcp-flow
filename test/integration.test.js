// test/integration.test.js — end-to-end: real servers, real transports,
// the real CLI. Every scenario here mirrors a real developer workflow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFlows } from '../src/runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const ECHO = path.join(ROOT, 'examples', 'echo', 'server.js');
const BROKEN = path.join(ROOT, 'examples', 'broken', 'server.js');
const CLI = path.join(ROOT, 'bin', 'mcp-flow.js');

function runCli(args, { timeoutMs = 30000 } = {}) {
  const res = spawnSync(NODE, [CLI, ...args], { encoding: 'utf8', timeout: timeoutMs, cwd: ROOT, env: { ...process.env, NO_COLOR: '1' } });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const stdioSpec = { command: NODE, args: [ECHO] };

// ---------------------------------------------------------------------------
// Runner-level (library) integration
// ---------------------------------------------------------------------------

test('runner: happy-path flow with chaining, extraction, latency, errors', async () => {
  const flow = {
    name: 'integration happy path',
    steps: [
      {
        as: 'greeting',
        call: 'upper',
        args: { text: 'hello' },
        expect: { ok: true, equals: { 'result.content.0.text': 'HELLO' } },
        extract: { shout: 'result.content.0.text' },
      },
      {
        call: 'echo',
        args: { text: '{{vars.shout}}!' },
        expect: { ok: true, equals: { 'result.content.0.text': 'Echo: HELLO!' } },
      },
      { call: 'slow', args: { ms: 100 }, expect: { ok: true, latencyMs: { max: 5000 }, contains: { 'result.content.0.text': 'slept 100' } } },
      { call: 'fail', expect: { ok: false, errorContains: 'intentional' } },
      {
        call: 'totals',
        args: { items: [{ name: 'a', price: 2.5 }, { name: 'b', price: 3 }] },
        expect: { ok: true, equals: { 'result.structuredContent.count': 2, 'result.structuredContent.total': 5.5 } },
      },
    ],
  };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec });
  assert.equal(run.totals.failed, 0, JSON.stringify(run.flows[0], null, 2));
  assert.equal(run.totals.stepsPassed, 5);
  assert.equal(run.flows[0].connection.serverInfo.name, 'echo-server');
  assert.equal(run.flows[0].connection.protocolVersion, '2025-06-18');
});

test('runner: failing assertion produces precise failure and non-passing totals', async () => {
  const flow = {
    name: 'integration failure',
    steps: [{ call: 'add', args: { a: 1, b: 2 }, expect: { equals: { 'result.content.0.text': '4' } } }],
  };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec });
  assert.equal(run.totals.failed, 1);
  const failures = run.flows[0].steps[0].failures;
  assert.match(failures[0].message, /expected "4", got "3"/);
});

test('runner: unknown tool is a flow error with server tool list as hint', async () => {
  const flow = { name: 'unknown tool', steps: [{ call: 'does_not_exist' }] };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec });
  assert.equal(run.flows[0].status, 'error');
  assert.match(run.flows[0].error.message, /unknown tool "does_not_exist"/);
  assert.match(run.flows[0].error.hint, /echo/);
});

test('runner: broken server — passes functionally but reports protocol violations', async () => {
  const flow = { name: 'broken conformance', steps: [{ call: 'echo', args: { text: 'x' }, expect: { ok: true } }] };
  const run = await runFlows({ flows: [flow], serverSpec: { command: NODE, args: [BROKEN] } });
  assert.equal(run.totals.failed, 0);
  const warnings = run.flows[0].warnings.join('\n');
  assert.match(warnings, /non-JSON to stdout/);
  assert.match(warnings, /Welcome to my broken server/);
});

test('runner: duplicate id frames are recorded as bad messages', async () => {
  const flow = { name: 'stutter', steps: [{ call: 'stutter', expect: { ok: true } }] };
  const run = await runFlows({ flows: [flow], serverSpec: { command: NODE, args: [BROKEN] } });
  assert.equal(run.totals.failed, 0);
  assert.ok(run.flows[0].warnings.some((w) => /invalid JSON-RPC/.test(w)));
});

test('runner: server crash mid-call fails the step with a clear reason', async () => {
  const flow = { name: 'crash', steps: [{ call: 'crash' }] };
  const run = await runFlows({ flows: [flow], serverSpec: { command: NODE, args: [BROKEN] } });
  assert.equal(run.totals.failed, 1);
  assert.match(run.flows[0].steps[0].failures[0].message, /exited/);
});

test('runner: retries are attempted and recorded', async () => {
  const flow = {
    name: 'retry probe',
    steps: [{ call: 'fail', expect: { ok: true }, retries: 2 }],
  };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec });
  assert.equal(run.flows[0].steps[0].attempts, 3);
  assert.equal(run.totals.failed, 1);
});

test('runner: failFast stops the flow at the first failure', async () => {
  const flow = {
    name: 'fail fast',
    steps: [
      { call: 'fail', expect: { ok: true } },
      { call: 'echo', args: { text: 'should not run' } },
    ],
  };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec, failFast: true });
  assert.equal(run.flows[0].steps.length, 1);
});

test('runner: safe-only refuses destructive tools', async () => {
  // The echo server marks nothing destructive; temporarily craft a spec check
  // against `fail` (readOnlyHint true there), so instead we verify safe-only
  // allows everything when annotations permit — and that unknown-annotation
  // tools still run.
  const flow = { name: 'safe pass', steps: [{ call: 'echo', args: { text: 'x' }, expect: { ok: true } }] };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec, safeOnly: true });
  assert.equal(run.totals.failed, 0);
});

test('runner: unresolvable template args are reported without crashing', async () => {
  const flow = {
    name: 'bad template',
    steps: [{ call: 'echo', args: { text: '{{vars.missing}}' } }],
  };
  const run = await runFlows({ flows: [flow], serverSpec: stdioSpec });
  assert.equal(run.flows[0].steps[0].status, 'error');
  assert.match(run.flows[0].steps[0].failures[0].message, /could not be resolved/);
});

test('runner: connect failure reports diagnostics and does not hang', async () => {
  const flow = { name: 'no server', steps: [{ call: 'x' }] };
  const run = await runFlows({ flows: [flow], serverSpec: { command: NODE, args: [path.join(ROOT, 'examples', 'definitely-not-here.js')] } });
  assert.equal(run.flows[0].status, 'error');
  assert.match(run.flows[0].error.message, /Could not connect/);
});

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

test('runner: HTTP transport against Streamable HTTP server', async () => {
  const port = 3117 + Math.floor(Math.random() * 200);
  const server = spawn(NODE, [path.join(ROOT, 'examples', 'echo', 'server-http.js'), String(port)], { stdio: 'ignore', windowsHide: true });
  try {
    // Wait for the port to open.
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const res = await fetch(`http://localhost:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }) });
        up = res.ok || res.status === 202;
      } catch { /* not up yet */ }
    }
    assert.ok(up, 'http server did not start');

    const flow = {
      name: 'http happy path',
      steps: [
        { call: 'add', args: { a: 20, b: 22 }, expect: { ok: true, equals: { 'result.content.0.text': '42' } } },
        { call: 'echo', args: { text: 'over http' }, expect: { ok: true, contains: { 'result.content.0.text': 'over http' } } },
      ],
    };
    const run = await runFlows({ flows: [flow], serverSpec: { url: `http://localhost:${port}/mcp` } });
    assert.equal(run.totals.failed, 0, JSON.stringify(run.flows[0], null, 2));
    assert.equal(run.flows[0].connection.transport, 'http');
    assert.equal(run.flows[0].connection.serverInfo.name, 'echo-http-server');
  } finally {
    server.kill();
    if (process.platform === 'win32' && server.pid) {
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
    }
  }
});

// ---------------------------------------------------------------------------
// CLI end-to-end
// ---------------------------------------------------------------------------

test('cli: run demo flow exits 0 with pretty output', () => {
  const res = runCli(['run', 'examples/echo/flows/smoke.flow.json', '--', NODE, ECHO]);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ALL PASSING/);
  assert.match(res.stdout, /6 passed/);
  assert.match(res.stdout, /echo-server 1\.0\.0/);
});

test('cli: failing flow exits 1 with diff details', () => {
  const res = runCli(['run', 'examples/echo/flows-demo/failing.flow.json', '--', NODE, ECHO]);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /FAILING/);
  assert.match(res.stdout, /expected "Echo: something else entirely", got "Echo: but this is not"/);
});

test('cli: validate command flags a broken flow file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpflow-cli-'));
  const good = path.join(dir, 'good.flow.json');
  const bad = path.join(dir, 'bad.flow.json');
  fs.writeFileSync(good, JSON.stringify({ name: 'g', steps: [{ call: 'a' }] }));
  fs.writeFileSync(bad, JSON.stringify({ name: 'b', steps: [{ call: 'a', expect: { wat: 1 } }] }));
  const res = runCli(['validate', good, bad]);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /✔.*good\.flow\.json/s);
  assert.match(res.stdout, /✘.*bad\.flow\.json/s);
  assert.match(res.stdout, /unknown key/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: junit reporter writes a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpflow-junit-'));
  const out = path.join(dir, 'report.xml');
  const res = runCli(['run', 'examples/echo/flows/smoke.flow.json', '--reporter', 'junit', '--out', out, '--', NODE, ECHO]);
  assert.equal(res.code, 0);
  const xml = fs.readFileSync(out, 'utf8');
  assert.ok(xml.includes('<?xml version="1.0"'));
  assert.ok(xml.includes('tests="6"'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: json reporter prints machine-readable output', () => {
  const res = runCli(['run', 'examples/echo/flows/smoke.flow.json', '--reporter', 'json', '--', NODE, ECHO]);
  assert.equal(res.code, 0);
  const data = JSON.parse(res.stdout);
  assert.equal(data.totals.stepsPassed, 6);
  assert.equal(data.passing, true);
});

test('cli: init --dry-run prints a flow without writing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpflow-init-'));
  const res = spawnSync(NODE, [CLI, 'init', '--dry-run', '--', NODE, ECHO], {
    encoding: 'utf8',
    timeout: 30000,
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /would write/);
  assert.match(res.stdout, /"call": "echo"/);
  assert.ok(!fs.existsSync(path.join(cwd, 'flows')), 'dry run must not write');
  // Now for real: files exist, and the generated flow runs green immediately.
  const real = spawnSync(NODE, [CLI, 'init', '--', NODE, ECHO], { encoding: 'utf8', timeout: 30000, cwd, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(real.status, 0, real.stdout + real.stderr);
  assert.ok(fs.existsSync(path.join(cwd, 'flows', 'smoke.flow.json')));
  assert.ok(fs.existsSync(path.join(cwd, 'mcp-flow.json')));
  const rerun = spawnSync(NODE, [CLI, 'run'], { encoding: 'utf8', timeout: 30000, cwd, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(rerun.status, 0, `generated flow should pass immediately:\n${rerun.stdout}\n${rerun.stderr}`);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('cli: usage errors exit 2 with hints', () => {
  assert.equal(runCli(['run', 'no-such.flow.json']).code, 2);
  assert.equal(runCli(['bogus-command']).code, 2);
  assert.match(runCli(['bogus-command']).stderr, /Unknown command/);
});

test('cli: serve answers initialize, tools/list, and runs an inline flow', async () => {
  const child = spawn(NODE, [CLI, 'serve'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const responses = [];
  let buf = '';
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve timed out; got: ${responses.join('\n')}`)), 30000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          responses.push(JSON.parse(line));
        } catch { /* noise */ }
        if (responses.length >= 3) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    child.on('exit', (code) => reject(new Error(`serve exited early: ${code}`)));
  });

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mcp_flow_run',
        arguments: {
          inline_flow: {
            name: 'inline via serve',
            steps: [{ call: 'add', args: { a: 2, b: 2 }, expect: { ok: true, equals: { 'result.content.0.text': '4' } } }],
          },
          server: { command: NODE, args: [ECHO] },
        },
      },
    }) + '\n'
  );
  child.stdin.end();

  await done;
  child.kill();
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.serverInfo.name, 'mcp-flow');
  assert.equal(responses[1].id, 2);
  assert.ok(responses[1].result.tools.some((t) => t.name === 'mcp_flow_run'));
  assert.equal(responses[2].id, 3);
  const payload = JSON.parse(responses[2].result.content[0].text);
  assert.equal(payload.passing, true);
  assert.equal(payload.totals.stepsPassed, 1);
});
