// flows/template.js — path expressions and {{...}} interpolation scoped to a
// running flow. Scope: { vars, steps, env }.

'use strict';

import { getPath, interpolateValue } from '../util.js';

export function buildScope({ vars, steps, env }) {
  return {
    vars: vars || {},
    steps: steps || {},
    env: env || {},
  };
}

/**
 * Resolve a step's args through the template engine. Throws with a helpful
 * message when a template cannot be resolved.
 */
export function resolveArgs(args, scope) {
  try {
    return interpolateValue(args ?? {}, scope);
  } catch (err) {
    throw new Error(`in "args": ${err.message}`);
  }
}

/**
 * Apply the "extract" map: { varName: pathInView }. Returns { vars, warnings }.
 */
export function applyExtract(extract, view) {
  const out = {};
  const warnings = [];
  if (!extract || typeof extract !== 'object') return { vars: out, warnings };
  for (const [name, path] of Object.entries(extract)) {
    if (typeof path !== 'string') {
      warnings.push(`extract.${name}: path must be a string, got ${typeof path}`);
      continue;
    }
    const root = path.split('.')[0];
    if (!(root in view)) {
      warnings.push(`extract.${name}: path root "${root}" is not one of result|error|ok|latencyMs|raw`);
      continue;
    }
    const res = path === root ? { found: true, value: view[root] } : getPath(view[root], path.slice(root.length + 1));
    if (!res.found) {
      warnings.push(`extract.${name}: ${res.reason}`);
      continue;
    }
    out[name] = res.value;
  }
  return { vars: out, warnings };
}
