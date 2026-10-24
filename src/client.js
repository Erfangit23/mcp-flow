// client.js — a minimal MCP client used for testing: initialize handshake,
// tools/list, tools/call, ping. Speaks protocol version 2025-06-18 first and
// gracefully falls back to 2024-11-05.

'use strict';

import { makeNotification } from './jsonrpc.js';
import { StdioTransport } from './transport/stdio.js';
import { HttpTransport } from './transport/http.js';

export const PROTOCOL_VERSION_LATEST = '2025-06-18';
export const PROTOCOL_VERSION_FALLBACK = '2024-11-05';

export function createTransport(serverSpec) {
  if (!serverSpec || typeof serverSpec !== 'object') {
    throw new Error('Server spec must be an object: { command, args } or { url }');
  }
  if (serverSpec.url) return new HttpTransport(serverSpec);
  if (serverSpec.command) return new StdioTransport(serverSpec);
  throw new Error('Server spec must have either "command" (stdio) or "url" (http)');
}

export class McpClient {
  constructor(transport, { timeoutMs = 30000 } = {}) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.serverInfo = null;
    this.capabilities = null;
    this.protocolVersion = null;
    this.instructions = null;
    this.initialized = false;
  }

  async initialize() {
    let result;
    let versionTried = PROTOCOL_VERSION_LATEST;
    try {
      result = await this.transport.request(
        'initialize',
        {
          protocolVersion: PROTOCOL_VERSION_LATEST,
          capabilities: {},
          clientInfo: { name: 'mcp-flow', version: '0.1.0' },
        },
        this.timeoutMs
      );
    } catch (err) {
      if (err.rpcError && (err.rpcError.code === -32601 || err.rpcError.code === -32602 || err.rpcError.code === -32600)) {
        // Older servers may reject unknown protocol versions outright.
        versionTried = PROTOCOL_VERSION_FALLBACK;
        result = await this.transport.request(
          'initialize',
          {
            protocolVersion: PROTOCOL_VERSION_FALLBACK,
            capabilities: {},
            clientInfo: { name: 'mcp-flow', version: '0.1.0' },
          },
          this.timeoutMs
        );
      } else {
        throw err;
      }
    }
    if (!result || typeof result !== 'object') {
      throw new Error('initialize returned an empty or non-object result');
    }
    this.protocolVersion = result.protocolVersion || versionTried;
    this.serverInfo = result.serverInfo || null;
    this.capabilities = result.capabilities || {};
    this.instructions = result.instructions || null;
    // Notify, then give the server a beat to settle (some servers do async
    // init work on this notification).
    this.transport.notify('notifications/initialized');
    this.initialized = true;
    return result;
  }

  async listTools() {
    this.#requireInit();
    const result = await this.transport.request('tools/list', {}, this.timeoutMs);
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async listResources() {
    this.#requireInit();
    const result = await this.transport.request('resources/list', {}, this.timeoutMs);
    return Array.isArray(result?.resources) ? result.resources : [];
  }

  async listPrompts() {
    this.#requireInit();
    const result = await this.transport.request('prompts/list', {}, this.timeoutMs);
    return Array.isArray(result?.prompts) ? result.prompts : [];
  }

  async callTool(name, args) {
    this.#requireInit();
    const result = await this.transport.request('tools/call', { name, arguments: args ?? {} }, this.timeoutMs);
    return result;
  }

  async ping() {
    await this.transport.request('ping', undefined, Math.min(this.timeoutMs, 10000));
  }

  #requireInit() {
    if (!this.initialized) throw new Error('Client is not initialized — call initialize() first');
  }

  async close() {
    await this.transport.close();
  }

  /**
   * Open a connection, run the handshake, hand the client to fn, then always
   * close the transport. Returns whatever fn returns.
   */
  static async withConnection(serverSpec, opts, fn) {
    const transport = createTransport(serverSpec);
    const client = new McpClient(transport, opts);
    try {
      transport.start?.();
      await client.initialize();
      return await fn(client, transport);
    } finally {
      await client.close();
    }
  }
}

export { makeNotification };
