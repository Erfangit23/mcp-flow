#!/usr/bin/env node
// examples/broken/server.js — a deliberately misbehaving MCP server used by
// the test-suite to prove mcp-flow catches real-world protocol violations.

'use strict';

import readline from 'node:readline';

// Protocol violation #1: junk written to stdout (violates the stdio framing).
process.stdout.write('Welcome to my broken server!\n');

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
  if (msg.id === undefined) return;

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'broken-server', version: '0.0.1' },
      },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'echo', description: 'Works fine.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
          {
            name: 'crash',
            description: 'Sends a garbage frame, then exits the process mid-call.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'stutter',
            description: 'Sends the same response twice — duplicate id frames.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (name === 'echo') {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `Echo: ${msg.params?.arguments?.text ?? ''}` }] } });
      return;
    }
    if (name === 'crash') {
      // Violation #2: garbage frame, then die without answering.
      process.stdout.write('this is not json at all\n');
      setTimeout(() => process.exit(1), 30);
      return;
    }
    if (name === 'stutter') {
      // Violation #3: duplicate response for the same id.
      const response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'twice' }] } };
      send(response);
      send(response);
      return;
    }
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
    return;
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
});

rl.on('close', () => process.exit(0));
process.stdin.resume();
