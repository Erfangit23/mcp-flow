// runner.js — orchestrates flows against an MCP server and produces
// structured results that any reporter can render.

'use strict';

import fs from 'node:fs';
import { McpClient, createTransport } from './client.js';
import { runAssertions } from './flows/assert.js';
import { parseFlowSource } from './flows/parse.js';
import { applyExtract, buildScope, resolveArgs } from './flows/template.js';
import { UserError, sleep, truncate } from './util.js';

const DEFAULT_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Server spec resolution
// ---------------------------------------------------------------------------

export function mergeServerSpec(...specs) {
  // Later specs win; CLI `--` command takes precedence upstream of this fn.
  for (const s of specs) {
    if (s !== undefined && s !== null) return s;
  }
  return undefined;
}

/**
 * Normalize a raw spec. Accepts:
 *   { command, args?, env?, cwd? } | { url, headers? } | { server: {...} }
 */
export function normalizeServerSpec(spec) {
  if (spec === undefined || spec === null) return undefined;
  if (typeof spec === 'string') {
    // Either a URL or a command line.
    if (/^https?:\/\//i.test(spec)) return { url: spec };
    const parts = splitCommand(spec);
    return { command: parts[0], args: parts.slice(1) };
  }
  if (typeof spec !== 'object') throw new UserError(`Invalid server spec: ${truncate(spec)}`);
  if (spec.server && typeof spec.server === 'object') return normalizeServerSpec(spec.server);
  if (spec.url) return { url: String(spec.url), headers: spec.headers };
  if (spec.command) {
    return {
      command: String(spec.command),
      args: (spec.args || []).map(String),
      env: spec.env && typeof spec.env === 'object' ? Object.fromEntries(Object.entries(spec.env).map(([k, v]) => [k, String(v)])) : undefined,
      cwd: spec.cwd ? String(spec.cwd) : undefined,
    };
  }
  throw new UserError('Server spec needs either "command" or "url"', 'Example: { "command": "node", "args": ["server.js"] } or { "url": "http://localhost:3000/mcp" }');
}

/** Minimal shell-like splitter: honors ' and " quoting. */
export function splitCommand(line) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

function buildView(outcome, startedNs) {
  const latencyMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
  const view = { latencyMs, raw: outcome.rawResult };
  if (outcome.kind === 'rpc-error') {
    view.ok = false;
    view.result = null;
    view.error = { code: outcome.error.code, message: outcome.error.message };
  } else if (outcome.kind === 'transport-error') {
    view.ok = false;
    view.result = null;
    view.error = { message: outcome.error.message };
  } else {
    // Tool result (CallToolResult)
    const r = outcome.result || {};
    const isError = r.isError === true;
    view.ok = !isError;
    view.result = r;
    view.error = isError ? { message: extractText(r) || 'tool reported an error' } : null;
  }
  return view;
}

function extractText(callToolResult) {
  if (!callToolResult || !Array.isArray(callToolResult.content)) return '';
  return callToolResult.content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

async function callOnce(client, toolName, args, timeoutMs) {
  const started = process.hrtime.bigint();
  try {
    const result = await client.callTool(toolName, args);
    return { kind: 'tool-result', result, rawResult: result, startedNs: started };
  } catch (err) {
    if (err.rpcError) return { kind: 'rpc-error', error: err.rpcError, rawResult: null, startedNs: started };
    return { kind: 'transport-error', error: err, rawResult: null, startedNs: started };
  }
}

// ---------------------------------------------------------------------------
// Flow execution
// ---------------------------------------------------------------------------

async function runFlowSteps(flow, client, timeoutMs, ctx) {
  const scope = buildScope({ vars: { ...(flow.vars || {}) }, steps: {}, env: { ...process.env } });
  const stepsOut = [];

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const label = step.as || step.call;
    const stepOut = {
      index: i + 1,
      tool: step.call,
      name: label,
      status: 'pending',
      latencyMs: null,
      attempts: 0,
      failures: [],
      warnings: [],
    };
    stepsOut.push(stepOut);

    const retries = step.retries || 0;
    let attemptsAllowed = 1 + retries;
    let view = null;
    let argError = null;
    let lastFatal = null;

    while (attemptsAllowed > 0) {
      attemptsAllowed--;
      stepOut.attempts++;
      // Resolve args fresh each attempt (vars may have changed via extract
      // of a previous attempt — deterministic, but keeps semantics simple).
      let args;
      try {
        args = resolveArgs(step.args, scope);
      } catch (err) {
        argError = err;
        break; // templating errors are not retryable
      }
      if (ctx.safeOnly) {
        const tool = ctx.tools.get(step.call);
        if (tool && tool.annotations && tool.annotations.readOnlyHint === false) {
          argError = new UserError(
            `tool "${step.call}" is marked destructive (readOnlyHint=false) and --safe-only is on`,
            'Add "allowUnsafe": true to the step, or drop --safe-only.'
          );
          break;
        }
      }
      const outcome = await callOnce(client, step.call, args, timeoutMs);
      view = buildView(outcome, outcome.startedNs);
      stepOut.latencyMs = view.latencyMs;
      stepOut.raw = outcome.rawResult ?? null;

      if (outcome.kind === 'transport-error') {
        // Transport broke — retrying against a dead server is pointless.
        lastFatal = view;
        break;
      }
      const assertionResults = step.expect ? runAssertions(view, step.expect) : [];
      const failed = assertionResults.filter((r) => !r.pass);
      if (failed.length === 0) {
        stepOut.status = 'passed';
        break;
      }
      if (attemptsAllowed > 0) {
        await sleep(250 * (1 + (retries - attemptsAllowed)));
        continue;
      }
      stepOut.status = 'failed';
      stepOut.failures = failed;
    }

    if (argError) {
      stepOut.status = 'error';
      stepOut.failures = [{ pass: false, message: argError.message }];
    } else if (lastFatal && stepOut.status === 'pending') {
      stepOut.status = 'failed';
      stepOut.failures = [{ pass: false, message: lastFatal.error?.message || 'transport error during call' }];
    }

    // Extract variables even from failing steps? No — only from passed steps,
    // so downstream templates never see half-baked data.
    if (stepOut.status === 'passed' && step.extract) {
      const { vars, warnings } = applyExtract(step.extract, view);
      Object.assign(scope.vars, vars);
      stepOut.warnings.push(...warnings);
    }

    // Register step result under its name (and numeric alias 1-based).
    if (step.as) scope.steps[step.as] = view;
    scope.steps[String(i + 1)] = view;

    if (ctx.failFast && (stepOut.status === 'failed' || stepOut.status === 'error')) break;
  }
  return stepsOut;
}

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 *   flows: validated flow objects (each may carry its own "server")
 *   serverSpec: default server spec (normalized) or undefined
 *   timeoutMs, failFast, safeOnly, verbose
 */
export async function runFlows(opts) {
  const {
    flows = [],
    serverSpec,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    failFast = false,
    safeOnly = false,
    verbose = false,
  } = opts;

  if (!flows.length) throw new UserError('No flows to run');
  const run = {
    startedAt: new Date().toISOString(),
    flows: [],
    totals: { flows: flows.length, passed: 0, failed: 0, steps: 0, stepsPassed: 0 },
    durationMs: 0,
  };
  const t0 = Date.now();

  for (const flow of flows) {
    const spec = normalizeServerSpec(mergeServerSpec(serverSpec, flow.server));
    if (!spec) {
      throw new UserError(
        `Flow "${flow.name}" has no server to connect to`,
        'Pass --server "node server.js" or --url http://..., or set "server" in mcp-flow.json / the flow file.'
      );
    }
    const flowOut = {
      name: flow.name,
      description: flow.description || null,
      status: 'pending',
      steps: [],
      connection: null,
      warnings: [],
      error: null,
    };
    run.flows.push(flowOut);
    const flowTimeout = flow.timeoutMs || timeoutMs;

    const transport = createTransport(spec);
    const client = new McpClient(transport, { timeoutMs: Math.min(flowTimeout, 45000) });
    try {
      try {
        transport.start?.();
        await client.initialize();
      } catch (err) {
        const diag = transport.diagnostics ? transport.diagnostics() : {};
        flowOut.status = 'error';
        flowOut.error = {
          message: `Could not connect and initialize: ${err.message}`,
          stderr: diag.stderrTail?.length ? diag.stderrTail.slice(-3) : undefined,
          noise: diag.noiseLines?.length ? diag.noiseLines.slice(0, 3) : undefined,
        };
        continue;
      }
      flowOut.connection = {
        serverInfo: client.serverInfo,
        protocolVersion: client.protocolVersion,
        transport: spec.url ? 'http' : 'stdio',
      };
      if (diagHasNoise(transport)) {
        flowOut.warnings.push(...collectNoise(transport));
      }
      // Load tools (for annotations/safe-only + tool existence checking).
      let tools = new Map();
      try {
        for (const t of await client.listTools()) tools.set(t.name, t);
        flowOut.connection.tools = tools.size;
      } catch (err) {
        flowOut.warnings.push(`tools/list failed: ${err.message} — steps will still run`);
      }

      // Unknown tool detection up-front (fast, clearer errors).
      for (const step of flow.steps) {
        if (tools.size && !tools.has(step.call)) {
          flowOut.status = 'error';
          flowOut.error = {
            message: `Flow "${flow.name}" step ${flow.steps.indexOf(step) + 1} calls unknown tool "${step.call}"`,
            hint: `Server exposes: ${[...tools.keys()].slice(0, 20).join(', ') || '(none)'}`,
          };
          break;
        }
      }
      if (flowOut.status === 'error') continue;

      flowOut.steps = await runFlowSteps(flow, client, flowTimeout, { failFast, safeOnly, tools, verbose });
      const anyBad = flowOut.steps.some((s) => s.status === 'failed' || s.status === 'error');
      flowOut.status = anyBad ? 'failed' : 'passed';
      // Re-collect protocol noise: violations often surface during the steps
      // themselves (junk frames, duplicate ids, mid-call exits).
      if (diagHasNoise(transport)) {
        flowOut.warnings.push(...collectNoise(transport));
      }
    } finally {
      // Close first: once the process is gone, every stdout frame has been
      // delivered — the final noise sweep below can't miss anything.
      await client.close().catch(() => {});
      if (diagHasNoise(transport)) {
        flowOut.warnings.push(...collectNoise(transport));
      }
    }
  }

  for (const f of run.flows) {
    run.totals.steps += f.steps.length;
    run.totals.stepsPassed += f.steps.filter((s) => s.status === 'passed').length;
    if (f.status === 'passed') run.totals.passed++;
    else run.totals.failed++;
  }
  run.durationMs = Date.now() - t0;
  return run;
}

function diagHasNoise(transport) {
  const d = transport.diagnostics ? transport.diagnostics() : null;
  return Boolean(d && (d.noiseLines?.length || d.badMessages?.length));
}

function collectNoise(transport) {
  const d = transport.diagnostics();
  const warnings = [];
  // Drain consumed entries so repeated collection never duplicates warnings.
  for (const line of transport.noiseLines.splice(0)) {
    warnings.push(`server wrote non-JSON to stdout (protocol violation): ${truncate(line, 120)}`);
  }
  for (const b of transport.badMessages.splice(0)) {
    warnings.push(`invalid JSON-RPC from server: ${b.reason}`);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Flow loading helpers
// ---------------------------------------------------------------------------

export function loadFlowFiles(paths) {
  const flows = [];
  const errors = [];
  for (const p of paths) {
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (err) {
      errors.push(new UserError(`Cannot read ${p}: ${err.message}`));
      continue;
    }
    try {
      flows.push({ ...parseFlowSource(text, p), _file: p });
    } catch (err) {
      errors.push(err);
    }
  }
  return { flows, errors };
}
