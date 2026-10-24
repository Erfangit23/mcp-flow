// flows/assert.js — the assertion engine. Every check produces a structured
// result so reporters can render precise diffs.

'use strict';

import { deepEqual, getPath, isValidPath, truncate } from '../util.js';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object' | 'undefined' | ...
}

function checkAt(view, path) {
  if (!isValidPath(path)) {
    return { pass: false, message: `invalid path syntax: ${JSON.stringify(path)}` };
  }
  const res = getPath(view, path);
  return res;
}

function fail(message) {
  return { pass: false, message };
}
function pass() {
  return { pass: true, message: null };
}

/**
 * Run the "expect" block against a normalized step view.
 * View shape:
 *   { ok, result, error: {code?, message} | null, latencyMs, raw }
 * Returns an array of { pass, message, path? }.
 */
export function runAssertions(view, expect) {
  const results = [];
  const push = (r, path) => results.push(path !== undefined ? { ...r, path } : r);

  if ('ok' in expect && expect.ok !== undefined) {
    const want = Boolean(expect.ok);
    if (typeof view.ok !== 'boolean') {
      push(fail(`step did not produce a clear ok/error outcome`));
    } else if (view.ok !== want) {
      const got = want
        ? view.error
          ? `error${view.error.message ? `: "${truncate(view.error.message, 160)}"` : ''}`
          : 'error'
        : 'ok';
      push(fail(`expected the tool call to succeed, but it returned ${got}`));
    } else push(pass());
  }

  if (typeof expect.errorContains === 'string') {
    const msg = view.error?.message ?? (view.ok ? null : '');
    if (view.ok) push(fail(`expected an error containing ${JSON.stringify(expect.errorContains)}, but the call succeeded`));
    else if (typeof msg !== 'string' || !msg.toLowerCase().includes(expect.errorContains.toLowerCase())) {
      push(fail(`expected error message to contain ${JSON.stringify(expect.errorContains)} (case-insensitive), got ${JSON.stringify(truncate(msg, 160))}`));
    } else push(pass());
  }

  for (const [kind, map] of [['equals', expect.equals], ['contains', expect.contains]]) {
    if (!map || typeof map !== 'object') continue;
    for (const [path, expected] of Object.entries(map)) {
      const res = checkAt(view, path);
      if (!res.found) {
        push({ pass: false, message: `path "${path}" not found — ${res.reason}`, path });
        continue;
      }
      const actual = res.value;
      if (kind === 'equals') {
        if (!deepEqual(actual, expected)) {
          push({ pass: false, message: `at "${path}": expected ${JSON.stringify(truncate(expected))}, got ${JSON.stringify(truncate(actual))}`, path });
        } else push(pass());
      } else {
        // contains
        if (typeof actual === 'string' && (typeof expected === 'string' || typeof expected === 'number')) {
          if (!actual.includes(String(expected))) {
            push({ pass: false, message: `at "${path}": expected string containing ${JSON.stringify(truncate(String(expected), 80))}, got ${JSON.stringify(truncate(actual))}`, path });
          } else push(pass());
        } else if (Array.isArray(actual)) {
          const hit = actual.some((item) => deepEqual(item, expected));
          if (!hit) {
            push({ pass: false, message: `at "${path}": expected array containing ${JSON.stringify(truncate(expected))}, got [${actual.length} items]`, path });
          } else push(pass());
        } else {
          push({ pass: false, message: `at "${path}": "contains" needs a string or array, got ${typeOf(actual)}`, path });
        }
      }
    }
  }

  if (expect.matches && typeof expect.matches === 'object') {
    for (const [path, pattern] of Object.entries(expect.matches)) {
      const spec = typeof pattern === 'string' ? { source: pattern } : pattern || {};
      let re;
      try {
        re = new RegExp(spec.source, spec.flags || '');
      } catch (err) {
        push({ pass: false, message: `at "${path}": invalid regex — ${err.message}`, path });
        continue;
      }
      const res = checkAt(view, path);
      if (!res.found) {
        push({ pass: false, message: `path "${path}" not found — ${res.reason}`, path });
        continue;
      }
      if (typeof res.value !== 'string') {
        push({ pass: false, message: `at "${path}": "matches" needs a string, got ${typeOf(res.value)}`, path });
      } else if (!re.test(res.value)) {
        push({ pass: false, message: `at "${path}": ${JSON.stringify(truncate(res.value, 120))} does not match /${spec.source}/${spec.flags || ''}`, path });
      } else push(pass());
    }
  }

  if (expect.schema && typeof expect.schema === 'object') {
    for (const [path, wantType] of Object.entries(expect.schema)) {
      const res = checkAt(view, path);
      if (!res.found) {
        push({ pass: false, message: `path "${path}" not found — ${res.reason}`, path });
        continue;
      }
      const gotType = typeOf(res.value);
      if (wantType === 'any') { push(pass()); continue; }
      if (gotType !== wantType) {
        push({ pass: false, message: `at "${path}": expected type ${wantType}, got ${gotType} (${JSON.stringify(truncate(res.value, 60))})`, path });
      } else push(pass());
    }
  }

  for (const [kind, paths] of [['exists', expect.exists], ['notExists', expect.notExists]]) {
    if (!Array.isArray(paths)) continue;
    for (const path of paths) {
      const res = checkAt(view, path);
      if (kind === 'exists' && !res.found) push({ pass: false, message: `expected "${path}" to exist — ${res.reason}`, path });
      else if (kind === 'notExists' && res.found) push({ pass: false, message: `expected "${path}" NOT to exist, but it holds ${JSON.stringify(truncate(res.value, 60))}`, path });
      else push(pass());
    }
  }

  const latency = expect.latencyMs;
  if (latency !== undefined) {
    const max = typeof latency === 'number' ? latency : latency?.max;
    if (typeof max !== 'number' || max <= 0) {
      push(fail(`invalid "latencyMs" expectation: ${JSON.stringify(latency)} (use a number or { "max": n })`));
    } else if (view.latencyMs > max) {
      push(fail(`latency ${Math.round(view.latencyMs)}ms exceeded budget of ${max}ms`));
    } else push(pass());
  }

  return results;
}
