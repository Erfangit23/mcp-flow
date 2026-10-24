// config.js — mcp-flow.json discovery and flow-file resolution.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { expandGlob } from './glob.js';
import { normalizeServerSpec } from './runner.js';
import { UserError } from './util.js';

export const CONFIG_NAME = 'mcp-flow.json';

export function findConfig(dir = process.cwd()) {
  let cur = path.resolve(dir);
  const root = path.parse(cur).root;
  while (true) {
    const candidate = path.join(cur, CONFIG_NAME);
    if (fs.existsSync(candidate)) return candidate;
    if (cur === root) return null;
    cur = path.dirname(cur);
  }
}

export function loadConfig(configPath) {
  const p = configPath || findConfig();
  if (!p) return { path: null, config: {} };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new UserError(`${p}: invalid JSON — ${err.message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new UserError(`${p}: config must be a JSON object`);
  }
  const allowed = ['flows', 'server', 'timeoutMs', 'reporter', 'failFast', 'safeOnly'];
  const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw new UserError(`${p}: unknown key(s) ${unknown.map((k) => `"${k}"`).join(', ')} — allowed: ${allowed.map((k) => `"${k}"`).join(', ')}`);
  }
  if (raw.timeoutMs !== undefined && (typeof raw.timeoutMs !== 'number' || raw.timeoutMs <= 0)) {
    throw new UserError(`${p}: "timeoutMs" must be a positive number`);
  }
  return { path: p, config: raw, dir: path.dirname(path.resolve(p)) };
}

/**
 * Resolve flow file paths from CLI patterns (win) or config defaults.
 * Returns { files: string[] } — throws if nothing found.
 */
export function resolveFlowFiles(patterns, configDir) {
  const cwd = configDir || process.cwd();
  const pats = patterns && patterns.length ? patterns : ['flows/**/*.flow.json'];
  const files = new Set();
  for (const pat of pats) {
    const expanded = expandGlob(pat, cwd);
    if (expanded.length === 0 && !/[*?{]/.test(pat)) {
      throw new UserError(`No such flow file: ${pat}`);
    }
    for (const f of expanded) files.add(f);
  }
  if (files.size === 0) {
    throw new UserError(
      'No flow files found',
      'Create one with "mcp-flow init -- <server command>", or point at a .flow.json file.'
    );
  }
  return { files: [...files].sort() };
}

export function resolveServerSpec({ cliServer, cliUrl, flowSpec, configSpec }) {
  if (cliServer) return normalizeServerSpec(cliServer);
  if (cliUrl) return normalizeServerSpec({ url: cliUrl });
  if (flowSpec) return normalizeServerSpec(flowSpec);
  if (configSpec) return normalizeServerSpec(configSpec);
  return undefined;
}
