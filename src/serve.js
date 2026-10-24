// serve.js — run mcp-flow itself as an MCP server, so coding agents
// (Claude Code, Cursor, gmt-code…) can run your flows as a tool.

'use strict';

import fs from 'node:fs';
import readline from 'node:readline';
import { validateFlow } from './flows/parse.js';
import { loadConfig, resolveFlowFiles } from './config.js';
import { loadFlowFiles, runFlows } from './runner.js';
import { renderSummary } from './report/pretty.js';
import { makeError, METHOD_NOT_FOUND, PARSE_ERROR, validateMessage, isResponse } from './jsonrpc.js';
import { normalizeServerSpec } from './runner.js';

const TOOLS = [
  {
    name: 'mcp_flow_run',
    description:
      'Run mcp-flow integration tests against an MCP server. Flows are scripted tool-call sequences with assertions. Returns a pass/fail summary plus per-step detail.',
    inputSchema: {
      type: 'object',
      properties: {
        flows: {
          type: 'string',
          description: 'Glob or path of flow files (e.g. "flows/*.flow.json"). Defaults to the mcp-flow.json config.',
        },
        inline_flow: {
          type: 'object',
          description: 'Run a single flow object directly instead of loading files.',
        },
        server: {
          type: 'object',
          description: 'Server spec override: { "command": "...", "args": [...] } or { "url": "..." }',
          properties: {
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            url: { type: 'string' },
          },
        },
        timeout_ms: { type: 'number', description: 'Per-step timeout in ms (default 30000).' },
        fail_fast: { type: 'boolean', description: 'Stop a flow at its first failing step.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_flow_list',
    description: 'List available flows and the tool calls each one makes.',
    inputSchema: {
      type: 'object',
      properties: {
        flows: { type: 'string', description: 'Glob or path of flow files. Defaults to config.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_flow_validate',
    description: 'Validate flow file syntax without running anything.',
    inputSchema: {
      type: 'object',
      properties: {
        flows: { type: 'string', description: 'Glob or path of flow files.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

function textResult(payload, isError = false) {
  const result = {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

async function loadFlows(pattern, cwd) {
  const cfg = loadConfig(undefined);
  const baseDir = cfg.path ? cfg.dir : cwd;
  const { files } = resolveFlowFiles(pattern ? [pattern] : undefined, baseDir);
  const { flows, errors } = loadFlowFiles(files);
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('\n'));
  }
  return { flows, config: cfg.config, baseDir };
}

function loadConfigOnly(cwd) {
  const cfg = loadConfig(undefined);
  return { config: cfg.config, baseDir: cfg.path ? cfg.dir : cwd };
}

async function toolRun(args) {
  let flowList;
  let config;
  if (args.inline_flow) {
    const inline = validateFlow(JSON.parse(JSON.stringify(args.inline_flow)), '<inline>');
    flowList = [{ ...inline, _file: '<inline>' }];
    config = loadConfigOnly(process.cwd()).config;
  } else {
    const loaded = await loadFlows(args.flows, process.cwd());
    flowList = loaded.flows;
    config = loaded.config;
  }
  if (!flowList.length) throw new Error('No flows matched');
  const run = await runFlows({
    flows: flowList,
    serverSpec: normalizeServerSpec(args.server || config.server),
    timeoutMs: args.timeout_ms || config.timeoutMs || 30000,
    failFast: Boolean(args.fail_fast),
  });
  const failures = [];
  for (const f of run.flows) {
    for (const s of f.steps) {
      if (s.status === 'failed' || s.status === 'error') {
        failures.push({ flow: f.name, step: s.name, errors: s.failures.map((x) => x.message) });
      }
    }
    if (f.error) failures.push({ flow: f.name, step: null, errors: [f.error.message] });
  }
  return {
    summary: renderSummary(run),
    passing: run.totals.failed === 0 && run.totals.flows > 0,
    totals: run.totals,
    failures,
    detail: run,
  };
}

async function toolList(args) {
  const { flows } = await loadFlows(args.flows, process.cwd());
  return flows.map((f) => ({
    name: f.name,
    description: f.description || null,
    file: f._file,
    steps: f.steps.map((s) => ({ call: s.call, args: s.args || {}, as: s.as || null })),
  }));
}

async function toolValidate(args) {
  const cfg = loadConfig(undefined);
  const baseDir = cfg.path ? cfg.dir : process.cwd();
  const { files } = resolveFlowFiles(args.flows ? [args.flows] : undefined, baseDir);
  const out = [];
  for (const f of files) {
    try {
      const { parseFlowSource } = await import('./flows/parse.js');
      const flow = parseFlowSource(fs.readFileSync(f, 'utf8'), f);
      out.push({ file: f, valid: true, name: flow.name, steps: flow.steps.length });
    } catch (err) {
      out.push({ file: f, valid: false, error: err.message });
    }
  }
  return out;
}

export async function handleToolCall(name, args) {
  switch (name) {
    case 'mcp_flow_run': return toolRun(args || {});
    case 'mcp_flow_list': return toolList(args || {});
    case 'mcp_flow_validate': return toolValidate(args || {});
    default: throw Object.assign(new Error(`Unknown tool "${name}"`), { rpcError: makeError(METHOD_NOT_FOUND, `Unknown tool "${name}"`) });
  }
}

/**
 * Minimal MCP server over stdio. Hand-rolled on purpose — zero dependencies.
 */
export function serve() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  let inFlight = 0;
  let draining = false;

  const finishWithDrain = () => {
    // Give in-flight tool calls up to 30s to flush before exiting.
    const started = Date.now();
    const tick = () => {
      if (inFlight === 0 || Date.now() - started > 30000) process.exit(0);
      else setTimeout(tick, 100);
    };
    tick();
  };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: makeError(PARSE_ERROR, 'Invalid JSON') });
      return;
    }
    const check = validateMessage(msg);
    if (!check.ok) {
      if (msg && msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: makeError(-32600, check.reason) });
      return;
    }
    if (!isResponse(msg) && msg.id === undefined) {
      // notification — accept and ignore (initialized, cancelled, …)
      return;
    }
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'mcp-flow', version: '0.1.0' },
          instructions: 'mcp-flow: deterministic integration testing for MCP servers. Use mcp_flow_run to execute flows.',
        },
      });
      return;
    }
    if (msg.method === 'ping') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      return;
    }
    if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      return;
    }
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};
      inFlight++;
      handleToolCall(name, args)
        .then((payload) => send({ jsonrpc: '2.0', id: msg.id, result: textResult(payload) }))
        .catch((err) => {
          if (err.rpcError) {
            send({ jsonrpc: '2.0', id: msg.id, error: err.rpcError });
          } else {
            send({ jsonrpc: '2.0', id: msg.id, result: textResult(`${err.message}${err.hint ? `\n\nhint: ${err.hint}` : ''}`, true) });
          }
        })
        .finally(() => {
          inFlight--;
          if (draining) finishWithDrain();
        });
      return;
    }
    if (msg.method?.startsWith('resources') || msg.method?.startsWith('prompts')) {
      // Declared no such capability, but answer politely instead of hanging.
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      return;
    }
    send({ jsonrpc: '2.0', id: msg.id, error: makeError(METHOD_NOT_FOUND, `Method not found: ${msg.method}`) });
  });

  rl.on('close', () => {
    draining = true;
    finishWithDrain();
  });

  // Keep the process alive; stdin stays open for the whole session.
  process.stdin.resume();
  return { close: () => process.exit(0) };
}
