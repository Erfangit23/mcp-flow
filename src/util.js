// util.js — small hand-rolled helpers. Zero dependencies, on purpose.

'use strict';

// ---------------------------------------------------------------------------
// Deep equality
// ---------------------------------------------------------------------------

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Path access — dot notation with numeric indices: "content.0.text"
// ---------------------------------------------------------------------------

const PATH_RE = /^[A-Za-z0-9_\-$]+(?:\.[A-Za-z0-9_\-$]+)*$/;

export function isValidPath(path) {
  return typeof path === 'string' && path.length > 0 && PATH_RE.test(path);
}

export function getPath(obj, path) {
  if (!isValidPath(path)) return { found: false, value: undefined, reason: 'invalid path syntax' };
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) {
      return { found: false, value: undefined, reason: `"${parts.slice(0, i).join('.')}" is ${cur === null ? 'null' : 'undefined'}` };
    }
    if (typeof cur !== 'object') {
      return { found: false, value: undefined, reason: `"${parts.slice(0, i).join('.')}" is not an object` };
    }
    const key = parts[i];
    const next = cur[key];
    if (next === undefined) {
      const has = Array.isArray(cur) ? /^\d+$/.test(key) && key < cur.length : Object.prototype.hasOwnProperty.call(cur, key);
      if (!has) {
        return { found: false, value: undefined, reason: `missing key "${key}"` };
      }
    }
    cur = next;
  }
  return { found: true, value: cur };
}

export function hasPath(obj, path) {
  return getPath(obj, path).found;
}

// ---------------------------------------------------------------------------
// Template interpolation — {{expr}} where expr resolves against a scope
// Scope shape: { vars: {...}, steps: {...}, env: {...} }
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_\-$]+(?:\.[A-Za-z0-9_\-$]+)*)\s*\}\}/g;

export function resolveExpr(expr, scope) {
  const root = expr.split('.')[0];
  if (!(root in scope)) {
    const known = Object.keys(scope).filter((k) => scope[k] && Object.keys(scope[k]).length).join(', ');
    throw new Error(`Unknown template root "${root}" (available: ${known || 'none'})`);
  }
  const res = getPath(scope[root], expr.slice(root.length + 1) || '');
  // "vars" with empty remainder means the whole object
  if (expr === root) return { found: true, value: scope[root] };
  return res;
}

/**
 * Interpolate templates inside a value.
 * - A string that is exactly one "{{expr}}" resolves to the native value
 *   (number, object, boolean — not stringified).
 * - Strings with embedded templates are concatenated as strings.
 * - Objects/arrays are deep-interpolated.
 */
export function interpolateValue(value, scope) {
  if (typeof value === 'string') {
    const full = value.match(/^\{\{\s*([A-Za-z0-9_\-$]+(?:\.[A-Za-z0-9_\-$]+)*)\s*\}\}$/);
    if (full) {
      const res = resolveExpr(full[1], scope);
      if (!res.found) throw new Error(`Template "${value}" could not be resolved: ${res.reason}`);
      return res.value;
    }
    let out;
    let last = 0;
    let matched = false;
    value.replace(TEMPLATE_RE, (m, expr, offset) => {
      matched = true;
      if (out === undefined) out = value.slice(0, offset);
      else out += value.slice(last, offset);
      const res = resolveExpr(expr, scope);
      if (!res.found) throw new Error(`Template "${m}" could not be resolved: ${res.reason}`);
      out += typeof res.value === 'string' ? res.value : JSON.stringify(res.value);
      last = offset + m.length;
      return m;
    });
    if (!matched) return value;
    out += value.slice(last);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateValue(v, scope);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || `timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Errors that carry a hint for the user
// ---------------------------------------------------------------------------

export class UserError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'UserError';
    if (hint) this.hint = hint;
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function jsonStable(value) {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function truncate(str, max = 200) {
  const s = typeof str === 'string' ? str : jsonStable(str);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function pluralize(n, word, plural = word + 's') {
  return `${n} ${n === 1 ? word : plural}`;
}
