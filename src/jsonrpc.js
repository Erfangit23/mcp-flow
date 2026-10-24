// jsonrpc.js — JSON-RPC 2.0 message helpers and validation.

'use strict';

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

let nextId = 1;
export function makeId() {
  return nextId++;
}
export function resetIds() {
  nextId = 1;
}

export function makeRequest(method, params, id) {
  const msg = { jsonrpc: '2.0', id: id === undefined ? makeId() : id, method };
  if (params !== undefined) msg.params = params;
  return msg;
}

export function makeNotification(method, params) {
  const msg = { jsonrpc: '2.0', method };
  if (params !== undefined) msg.params = params;
  return msg;
}

export function makeError(code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return err;
}

/**
 * Validate the shape of an inbound message. Returns { ok, reason }.
 * Lenient by design: we accept anything JSON-RPC-ish so that test reports can
 * *describe* non-conformance instead of silently dropping it.
 */
export function validateMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, reason: 'not an object' };
  }
  if (msg.jsonrpc !== '2.0') {
    return { ok: false, reason: `missing or invalid "jsonrpc" field (got ${JSON.stringify(msg.jsonrpc)})` };
  }
  const hasMethod = typeof msg.method === 'string';
  const hasId = msg.id !== undefined;
  if (!hasMethod && !hasId) {
    return { ok: false, reason: 'neither "method" nor "id" present' };
  }
  if (hasId && typeof msg.id !== 'string' && typeof msg.id !== 'number') {
    return { ok: false, reason: `"id" must be a string or number (got ${typeof msg.id})` };
  }
  if (hasId && !hasMethod) {
    // A response: must have result or error, not both.
    const hasResult = 'result' in msg;
    const hasError = 'error' in msg;
    if (!hasResult && !hasError) return { ok: false, reason: 'response has neither "result" nor "error"' };
    if (hasResult && hasError) return { ok: false, reason: 'response has both "result" and "error"' };
    if (hasError && (typeof msg.error !== 'object' || msg.error === null || typeof msg.error.code !== 'number' || typeof msg.error.message !== 'string')) {
      return { ok: false, reason: '"error" must be an object with numeric "code" and string "message"' };
    }
  }
  return { ok: true };
}

export function isResponse(msg) {
  return typeof msg === 'object' && msg !== null && msg.id !== undefined && msg.method === undefined;
}

export function isNotification(msg) {
  return typeof msg === 'object' && msg !== null && typeof msg.method === 'string' && msg.id === undefined;
}

export function isError(msg) {
  return typeof msg === 'object' && msg !== null && 'error' in msg;
}
