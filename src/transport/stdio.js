// transport/stdio.js — spawn an MCP server and speak newline-delimited JSON-RPC.

'use strict';

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { isNotification, isResponse, validateMessage } from '../jsonrpc.js';
import { sleep } from '../util.js';

export class StdioTransport extends EventEmitter {
  /**
   * @param {object} spec { command, args?, env?, cwd? }
   */
  constructor(spec) {
    super();
    this.spec = spec;
    this.proc = null;
    this.buffer = '';
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.idCounter = 1;
    this.stderrTail = []; // last lines of stderr, for diagnostics
    this.exited = null; // { code, signal }
    this.exitWaiters = [];
    this.noiseLines = []; // non-JSON lines the server wrote to stdout
    this.notifications = []; // protocol notifications received
    this.badMessages = []; // structurally invalid JSON-RPC
    this.closedByUs = false;
  }

  start() {
    const { command, args = [], env, cwd } = this.spec || {};
    if (!command || typeof command !== 'string') {
      throw new Error('stdio transport requires a "command"');
    }
    const childEnv = env ? { ...process.env, ...env } : process.env;
    try {
      this.proc = spawn(command, args.map(String), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
        cwd,
        windowsHide: true,
      });
    } catch (err) {
      throw new Error(`Failed to spawn "${command}": ${err.message}`);
    }

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.#onData(chunk));

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) this.stderrTail.push(line);
      }
      if (this.stderrTail.length > 50) this.stderrTail.splice(0, this.stderrTail.length - 50);
      this.emit('stderr', chunk);
    });

    this.proc.on('error', (err) => {
      // spawn failure (ENOENT etc.) — reject everything
      this.exited = { code: null, signal: null, error: err.message };
      this.#rejectAllPending(new Error(`Server process failed to start: ${err.message}`));
      this.#resolveExit();
    });

    this.proc.on('exit', (code, signal) => {
      this.exited = { code, signal };
      this.#rejectAllPending(new Error(
        `Server process exited (code=${code}${signal ? `, signal=${signal}` : ''}) while requests were pending` +
        (this.stderrTail.length ? ` — stderr: ${this.stderrTail.slice(-3).join(' | ')}` : '')
      ));
      this.#resolveExit();
    });

    return this;
  }

  #onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      this.#onLine(line);
    }
    // Guard against pathological buffering (spec: messages are newline-delimited)
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.noiseLines.push(`[unterminated stdout buffer of ${this.buffer.length} bytes discarded]`);
      this.buffer = '';
    }
  }

  #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.noiseLines.push(line);
      this.emit('noise', line);
      return;
    }
    const check = validateMessage(msg);
    if (!check.ok) {
      this.badMessages.push({ line, reason: check.reason });
      this.emit('badMessage', { message: msg, reason: check.reason });
      return;
    }
    if (isResponse(msg)) {
      const entry = this.pending.get(msg.id);
      if (!entry) {
        this.badMessages.push({ line, reason: `response for unknown id ${JSON.stringify(msg.id)}` });
        return;
      }
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if ('error' in msg) entry.reject(Object.assign(new Error(msg.error.message || 'JSON-RPC error'), { rpcError: msg.error }));
      else entry.resolve(msg.result);
      return;
    }
    if (isNotification(msg)) {
      this.notifications.push(msg);
      this.emit('notification', msg);
      return;
    }
    // A request from the server (has method + id) — we don't support server->client
    // requests, but record it instead of crashing.
    this.badMessages.push({ line, reason: 'server sent a request to the client (unsupported)' });
  }

  request(method, params, timeoutMs = 30000) {
    if (!this.proc || this.exited) {
      return Promise.reject(new Error('Transport is not running'));
    }
    const id = this.idCounter++;
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#write(msg, reject);
    });
  }

  notify(method, params) {
    const msg = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    this.#write(msg, (err) => { throw err; });
  }

  #write(msg, onError) {
    if (!this.proc || this.exited) {
      onError(new Error('Cannot write: transport is not running'));
      return;
    }
    let payload;
    try {
      payload = JSON.stringify(msg) + '\n';
    } catch (err) {
      onError(new Error(`Message is not JSON-serializable: ${err.message}`));
      return;
    }
    try {
      this.proc.stdin.write(payload);
    } catch (err) {
      onError(new Error(`Failed to write to server stdin: ${err.message}`));
    }
  }

  #rejectAllPending(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  #resolveExit() {
    for (const w of this.exitWaiters) w();
    this.exitWaiters = [];
  }

  onExit() {
    if (this.exited) return Promise.resolve(this.exited);
    return new Promise((resolve) => this.exitWaiters.push(resolve));
  }

  async close({ killAfterMs = 1500 } = {}) {
    this.closedByUs = true;
    if (!this.proc || this.exited) return;
    // 1. Politely close stdin — many servers exit when their stdin closes.
    try { this.proc.stdin.end(); } catch { /* ignore */ }
    const exitedDuringGrace = await Promise.race([
      this.onExit().then(() => true),
      sleep(killAfterMs).then(() => false),
    ]);
    if (exitedDuringGrace) return;
    // 2. SIGTERM-ish
    try { this.proc.kill(); } catch { /* ignore */ }
    const exitedDuringKill = await Promise.race([
      this.onExit().then(() => true),
      sleep(killAfterMs).then(() => false),
    ]);
    if (exitedDuringKill) return;
    // 3. Windows: SIGKILL does not kill child trees; use taskkill.
    if (process.platform === 'win32' && this.proc.pid) {
      await new Promise((resolve) => {
        const tk = spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true });
        tk.on('exit', resolve);
        tk.on('error', resolve);
      });
      await Promise.race([this.onExit(), sleep(500)]);
    } else {
      try { this.proc.kill('SIGKILL'); } catch { /* ignore */ }
      await Promise.race([this.onExit(), sleep(500)]);
    }
  }

  diagnostics() {
    return {
      exited: this.exited,
      stderrTail: this.stderrTail.slice(-10),
      noiseLines: this.noiseLines.slice(-10),
      badMessages: this.badMessages.slice(-10),
      notifications: this.notifications.length,
    };
  }
}
