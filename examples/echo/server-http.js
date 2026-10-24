#!/usr/bin/env node
// examples/echo/server-http.js — the echo server over Streamable HTTP.
// Zero dependencies (node:http only). Proves mcp-flow's HTTP transport end-to-end.
//
//   node examples/echo/server-http.js [port]      # default 3117
//
// Endpoints:
//   POST /mcp   — JSON-RPC messages (direct JSON responses)
//   DELETE /mcp — session teardown

'use strict';

import http from 'node:http';

const PORT = Number(process.argv[2]) || 3117;
const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const sessions = new Map(); // sessionId -> true

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the given text back, prefixed with "Echo:".',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true },
    run: (a) => `Echo: ${a.text ?? ''}`,
  },
  {
    name: 'add',
    description: 'Add two numbers.',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    annotations: { readOnlyHint: true },
    run: (a) => String(Number(a.a) + Number(a.b)),
  },
];

function sessionId() {
  return `sess-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function handleInitialize(msg) {
  const requested = msg.params?.protocolVersion;
  return {
    protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : '2025-06-18',
    capabilities: { tools: {} },
    serverInfo: { name: 'echo-http-server', version: '1.0.0' },
  };
}

function dispatch(msg) {
  if (msg.method === 'initialize') return { ok: true, result: handleInitialize(msg), newSession: true };
  if (msg.method === 'ping') return { ok: true, result: {} };
  if (msg.method === 'tools/list') {
    return { ok: true, result: { tools: TOOLS.map(({ run, ...t }) => t) } };
  }
  if (msg.method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === msg.params?.name);
    if (!tool) return { ok: false, error: { code: -32602, message: `Unknown tool: ${msg.params?.name}` } };
    try {
      return { ok: true, result: { content: [{ type: 'text', text: String(tool.run(msg.params.arguments || {})) }] } };
    } catch (err) {
      return { ok: true, result: { content: [{ type: 'text', text: err.message }], isError: true } };
    }
  }
  return { ok: false, error: { code: -32601, message: `Method not found: ${msg.method}` } };
}

const server = http.createServer((req, res) => {
  if (req.method === 'DELETE' && req.url === '/mcp') {
    const sid = req.headers['mcp-session-id'];
    if (sid) sessions.delete(sid);
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    if (msg.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const out = dispatch(msg);
    const headers = { 'content-type': 'application/json' };
    if (out.newSession) {
      const sid = sessionId();
      sessions.set(sid, true);
      headers['mcp-session-id'] = sid;
    } else {
      const sid = req.headers['mcp-session-id'];
      if (sid && sessions.has(sid)) headers['mcp-session-id'] = sid;
    }
    res.writeHead(200, headers);
    res.end(
      JSON.stringify(
        out.ok
          ? { jsonrpc: '2.0', id: msg.id, result: out.result }
          : { jsonrpc: '2.0', id: msg.id, error: out.error }
      )
    );
  });
});

server.listen(PORT, () => {
  process.stderr.write(`echo-http-server listening on http://localhost:${PORT}/mcp\n`);
});
