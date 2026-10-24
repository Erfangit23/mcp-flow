// flows/parse.js — strict validation of flow files with precise error
// messages. A flow file that passes this parser is safe to execute.

'use strict';

import { UserError } from '../util.js';

const EXPECT_KEYS = ['ok', 'equals', 'contains', 'matches', 'schema', 'exists', 'notExists', 'latencyMs', 'errorContains'];
const STEP_KEYS = ['call', 'args', 'expect', 'extract', 'as', 'ignore', 'retries'];
const FLOW_KEYS = ['name', 'description', 'server', 'timeoutMs', 'steps', 'vars', 'todo'];

function err(msg, file) {
  return new UserError(file ? `${file}: ${msg}` : msg);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkServerSpec(server, file) {
  if (!isPlainObject(server)) throw err('"server" must be an object', file);
  const hasCmd = typeof server.command === 'string' && server.command.length > 0;
  const hasUrl = typeof server.url === 'string' && server.url.length > 0;
  if (!hasCmd && !hasUrl) throw err('"server" needs either "command" or "url"', file);
  if (hasCmd && hasUrl) throw err('"server" cannot have both "command" and "url"', file);
  if (hasCmd && server.args !== undefined && !Array.isArray(server.args)) {
    throw err('"server.args" must be an array of strings', file);
  }
  if (server.env !== undefined && !isPlainObject(server.env)) {
    throw err('"server.env" must be an object of strings', file);
  }
}

export function validateFlow(raw, file) {
  if (!isPlainObject(raw)) throw err('flow file must contain a JSON object', file);
  const unknownTop = Object.keys(raw).filter((k) => !FLOW_KEYS.includes(k));
  if (unknownTop.length) {
    throw err(`unknown top-level key(s): ${unknownTop.map((k) => `"${k}"`).join(', ')} — allowed: ${FLOW_KEYS.map((k) => `"${k}"`).join(', ')}`, file);
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw err('missing required "name" (string)', file);
  if (raw.description !== undefined && typeof raw.description !== 'string') throw err('"description" must be a string', file);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw err('"steps" must be a non-empty array', file);
  if (raw.server !== undefined) checkServerSpec(raw.server, file);
  if (raw.timeoutMs !== undefined && (typeof raw.timeoutMs !== 'number' || raw.timeoutMs <= 0)) {
    throw err('"timeoutMs" must be a positive number', file);
  }
  if (raw.vars !== undefined && !isPlainObject(raw.vars)) throw err('"vars" must be an object', file);
  if (raw.todo !== undefined && !Array.isArray(raw.todo)) throw err('"todo" must be an array of strings (metadata written by mcp-flow init)', file);

  const stepNames = new Set();
  raw.steps.forEach((step, i) => {
    const where = `steps[${i}]`;
    if (!isPlainObject(step)) throw err(`${where} must be an object`, file);
    const unknown = Object.keys(step).filter((k) => !STEP_KEYS.includes(k));
    if (unknown.length) {
      throw err(`${where}: unknown key(s) ${unknown.map((k) => `"${k}"`).join(', ')} — allowed: ${STEP_KEYS.map((k) => `"${k}"`).join(', ')}`, file);
    }
    if (typeof step.call !== 'string' || !step.call.trim()) throw err(`${where}: missing required "call" (tool name)`, file);
    if (step.args !== undefined && !isPlainObject(step.args)) throw err(`${where}: "args" must be an object`, file);
    if (step.as !== undefined) {
      if (typeof step.as !== 'string' || !/^[A-Za-z0-9_\-]+$/.test(step.as)) {
        throw err(`${where}: "as" must be a short identifier (letters, digits, - _)`, file);
      }
      if (stepNames.has(step.as)) throw err(`${where}: duplicate step name "${step.as}"`, file);
      stepNames.add(step.as);
    }
    if (step.ignore !== undefined && typeof step.ignore !== 'boolean') throw err(`${where}: "ignore" must be a boolean`, file);
    if (step.retries !== undefined && (typeof step.retries !== 'number' || step.retries < 0 || !Number.isInteger(step.retries))) {
      throw err(`${where}: "retries" must be a non-negative integer`, file);
    }
    if (step.extract !== undefined) {
      if (!isPlainObject(step.extract)) throw err(`${where}: "extract" must be an object of { name: path }`, file);
      for (const [k, v] of Object.entries(step.extract)) {
        if (typeof v !== 'string' || !v.trim()) throw err(`${where}: extract."${k}" must be a non-empty path string`, file);
      }
    }
    if (step.expect !== undefined) {
      if (!isPlainObject(step.expect)) throw err(`${where}: "expect" must be an object`, file);
      const unknownExp = Object.keys(step.expect).filter((k) => !EXPECT_KEYS.includes(k));
      if (unknownExp.length) {
        throw err(`${where}.expect: unknown key(s) ${unknownExp.map((k) => `"${k}"`).join(', ')} — allowed: ${EXPECT_KEYS.map((k) => `"${k}"`).join(', ')}`, file);
      }
      if (step.expect.ok !== undefined && typeof step.expect.ok !== 'boolean') throw err(`${where}.expect.ok must be a boolean`, file);
      for (const key of ['equals', 'contains', 'matches', 'schema']) {
        const v = step.expect[key];
        if (v !== undefined && !isPlainObject(v)) throw err(`${where}.expect.${key} must be an object of { path: value }`, file);
      }
      for (const key of ['exists', 'notExists']) {
        const v = step.expect[key];
        if (v !== undefined && (!Array.isArray(v) || v.some((p) => typeof p !== 'string'))) {
          throw err(`${where}.expect.${key} must be an array of path strings`, file);
        }
      }
      if (step.expect.latencyMs !== undefined) {
        const l = step.expect.latencyMs;
        const okNum = typeof l === 'number' ? l > 0 : isPlainObject(l) && typeof l.max === 'number' && l.max > 0;
        if (!okNum) throw err(`${where}.expect.latencyMs must be a positive number or { "max": n }`, file);
      }
      if (step.expect.errorContains !== undefined && typeof step.expect.errorContains !== 'string') {
        throw err(`${where}.expect.errorContains must be a string`, file);
      }
    }
  });
  return raw;
}

export function parseFlowSource(text, file) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new UserError(`${file}: invalid JSON — ${e.message}`, 'Flow files are JSON. Write {"name": "...", "steps": [...]}.');
  }
  return validateFlow(raw, file);
}
