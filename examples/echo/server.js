#!/usr/bin/env node
// examples/echo/server.js — a well-behaved zero-dependency MCP server.
// Used by the mcp-flow test-suite, the demo flows, and `mcp-flow init`.

'use strict';

import readline from 'node:readline';

const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the given text back, prefixed with "Echo:".',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text'],
    },
    annotations: { title: 'Echo', readOnlyHint: true },
    run: (args) => `Echo: ${args.text ?? ''}`,
  },
  {
    name: 'add',
    description: 'Add two numbers and return the sum as text.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    annotations: { title: 'Add', readOnlyHint: true },
    run: (args) => String(Number(args.a) + Number(args.b)),
  },
  {
    name: 'now',
    description: 'Return the current ISO-8601 timestamp.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Now', readOnlyHint: true },
    run: () => new Date().toISOString(),
  },
  {
    name: 'upper',
    description: 'Uppercase the given text. Handy for testing variable chaining.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    annotations: { title: 'Upper', readOnlyHint: true },
    run: (args) => String(args.text ?? '').toUpperCase(),
  },
  {
    name: 'slow',
    description: 'Sleep for the given number of milliseconds (max 5000), then confirm. For latency assertions.',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'number', description: 'Milliseconds to sleep', default: 100 } },
    },
    annotations: { title: 'Slow', readOnlyHint: true },
    run: (args) =>
      new Promise((resolve) => {
        const ms = Math.min(Number(args.ms) || 100, 5000);
        setTimeout(() => resolve(`slept ${ms}ms`), ms);
      }),
  },
  {
    name: 'fail',
    description: 'Always fails with isError=true and a message. For testing error expectations.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', default: 'Intentional failure' } },
    },
    annotations: { title: 'Fail', readOnlyHint: true, destructiveHint: false },
    run: (args) => {
      const err = new Error(String(args.message || 'Intentional failure'));
      err.__toolError = true;
      throw err;
    },
  },
  {
    name: 'totals',
    description: 'Sum an array of { name, price } items. Returns structuredContent and a text summary.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, price: { type: 'number' } },
            required: ['name', 'price'],
          },
        },
      },
      required: ['items'],
    },
    annotations: { title: 'Totals', readOnlyHint: true },
    run: (args) => {
      const items = Array.isArray(args.items) ? args.items : [];
      const total = items.reduce((acc, it) => acc + (Number(it?.price) || 0), 0);
      return { __structured: { count: items.length, total }, text: `count=${items.length} total=${total}` };
    },
  },
];

function toolResult(text, structured) {
  const result = { content: [{ type: 'text', text: String(text) }] };
  if (structured) result.structuredContent = structured;
  return result;
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (msg.id === undefined) return; // notification — ignore

  if (msg.method === 'initialize') {
    const requested = msg.params?.protocolVersion;
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-server', version: '1.0.0' },
        instructions: 'A well-behaved demo server for mcp-flow.',
      },
    });
    return;
  }
  if (msg.method === 'ping') return send({ jsonrpc: '2.0', id: msg.id, result: {} });
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: TOOLS.map(({ run, ...t }) => t),
      },
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
    }
    Promise.resolve()
      .then(() => tool.run(args || {}))
      .then((out) => {
        if (out && out.__structured) send({ jsonrpc: '2.0', id: msg.id, result: toolResult(out.text, out.__structured) });
        else send({ jsonrpc: '2.0', id: msg.id, result: toolResult(out) });
      })
      .catch((err) => {
        if (err.__toolError) {
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
        } else {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
        }
      });
    return;
  }
  if (msg.method?.startsWith('resources') || msg.method?.startsWith('prompts')) {
    return send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
});

rl.on('close', () => process.exit(0));
process.stdin.resume();
