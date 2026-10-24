// transport/http.js — Streamable HTTP transport for MCP (POST JSON-RPC,
// handles both direct JSON responses and text/event-stream responses).

'use strict';

import { EventEmitter } from 'node:events';
import { validateMessage, isResponse } from '../jsonrpc.js';

const SESSION_HEADER = 'mcp-session-id';

export class HttpTransport extends EventEmitter {
  /**
   * @param {object} spec { url, headers? }
   */
  constructor(spec) {
    super();
    this.spec = spec;
    this.sessionId = null;
    this.idCounter = 1;
    this.notifications = [];
    this.badMessages = [];
    this.closed = false;
    if (!spec || typeof spec.url !== 'string' || !/^https?:\/\//i.test(spec.url)) {
      throw new Error('http transport requires a valid "url" (http:// or https://)');
    }
  }

  #headers(extra) {
    const h = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.spec.headers || {}),
      ...extra,
    };
    if (this.sessionId) h[SESSION_HEADER] = this.sessionId;
    return h;
  }

  async #post(body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
    let res;
    try {
      res = await fetch(this.spec.url, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(`HTTP request failed: ${err.cause?.message || err.message}`);
    } finally {
      clearTimeout(timer);
    }
    const sid = res.headers.get(SESSION_HEADER);
    if (sid && !this.sessionId) this.sessionId = sid;
    return res;
  }

  async #readSse(res, wantedId, timeoutMs) {
    // Parse a text/event-stream response until we see the message with the
    // wanted id (or the stream ends). Other events (notifications, requests,
    // responses to other ids) are recorded and skipped.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (Date.now() > deadline) throw new Error(`SSE stream timed out after ${timeoutMs}ms`);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines = rawEvent
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''));
        if (!dataLines.length) continue;
        let msg;
        try {
          msg = JSON.parse(dataLines.join('\n'));
        } catch {
          this.badMessages.push({ line: dataLines.join('\n'), reason: 'SSE data is not JSON' });
          continue;
        }
        const check = validateMessage(msg);
        if (!check.ok) {
          this.badMessages.push({ line: '<sse>', reason: check.reason });
          continue;
        }
        if (isResponse(msg) && msg.id === wantedId) {
          try { await reader.cancel(); } catch { /* ignore */ }
          if ('error' in msg) {
            throw Object.assign(new Error(msg.error.message || 'JSON-RPC error'), { rpcError: msg.error });
          }
          return msg.result;
        }
        if (msg.method && msg.id === undefined) {
          this.notifications.push(msg);
          this.emit('notification', msg);
        }
      }
    }
    throw new Error(`SSE stream ended without a response for request id ${wantedId}`);
  }

  async request(method, params, timeoutMs = 30000) {
    if (this.closed) throw new Error('Transport is closed');
    const id = this.idCounter++;
    const body = { jsonrpc: '2.0', id, method };
    if (params !== undefined) body.params = params;
    const res = await this.#post(body, timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} ${res.statusText} for "${method}"${text ? ` — ${text.slice(0, 200)}` : ''}`);
      err.httpStatus = res.status;
      throw err;
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('text/event-stream')) {
      return this.#readSse(res, id, timeoutMs);
    }
    let msg;
    try {
      msg = await res.json();
    } catch (err) {
      throw new Error(`Response for "${method}" is not valid JSON: ${err.message}`);
    }
    const check = validateMessage(msg);
    if (!check.ok) throw new Error(`Response for "${method}" is not valid JSON-RPC: ${check.reason}`);
    if ('error' in msg) {
      throw Object.assign(new Error(msg.error.message || 'JSON-RPC error'), { rpcError: msg.error });
    }
    return msg.result;
  }

  async notify(method, params) {
    if (this.closed) throw new Error('Transport is closed');
    const body = { jsonrpc: '2.0', method };
    if (params !== undefined) body.params = params;
    const res = await fetch(this.spec.url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(body),
    }).catch((err) => {
      throw new Error(`HTTP notification failed: ${err.cause?.message || err.message}`);
    });
    // 202 Accepted is the spec-preferred answer for notifications.
    if (res.status !== 202 && !res.ok) {
      // Tolerate servers that answer notifications with 200 and a body.
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId) {
      try {
        await fetch(this.spec.url, {
          method: 'DELETE',
          headers: this.#headers(),
        });
      } catch { /* best effort */ }
    }
  }
}
