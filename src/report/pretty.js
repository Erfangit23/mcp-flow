// report/pretty.js — terminal report with ANSI color. Also used (colorless)
// by `mcp-flow serve` so agents get the same rendering.

'use strict';

import { truncate } from '../util.js';

function makeColor(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    bold: wrap(1),
    dim: wrap(2),
    green: wrap(32),
    red: wrap(31),
    yellow: wrap(33),
    cyan: wrap(36),
    gray: wrap(90),
    white: wrap(97),
  };
}

export function supportsColor(stream = process.stdout, force) {
  if (force !== undefined) return Boolean(force);
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream && stream.isTTY);
}

export function renderPretty(run, { color = supportsColor() } = {}) {
  const c = makeColor(color);
  const lines = [];
  const line = (s = '') => lines.push(s);

  line(c.bold('mcp-flow ') + c.gray(`· ${run.totals.flows} flow${run.totals.flows === 1 ? '' : 's'} · ${run.totals.steps} step${run.totals.steps === 1 ? '' : 's'}`));
  line();

  for (const flow of run.flows) {
    const icon = flow.status === 'passed' ? c.green('✔') : flow.status === 'failed' ? c.red('✘') : c.yellow('⚠');
    const title = flow.description ? `${flow.name} ${c.gray(`— ${flow.description}`)}` : flow.name;
    line(`  ${icon} ${c.bold(title)}`);

    if (flow.error) {
      line(`      ${c.red(flow.error.message)}`);
      if (flow.error.hint) line(`      ${c.yellow('hint:')} ${flow.error.hint}`);
      for (const s of flow.error.stderr || []) line(`      ${c.gray('stderr:')} ${c.gray(truncate(s, 160))}`);
    }
    if (flow.connection) {
      const conn = flow.connection;
      const name = conn.serverInfo?.name || 'unknown server';
      const ver = conn.serverInfo?.version || '?';
      line(`      ${c.gray(`${name} ${ver} · protocol ${conn.protocolVersion || '?'} · ${conn.transport}${conn.tools !== undefined ? ` · ${conn.tools} tools` : ''}`)}`);
    }

    for (const step of flow.steps) {
      const ms = step.latencyMs !== null ? ` ${c.gray(`${step.latencyMs >= 100 ? Math.round(step.latencyMs) : step.latencyMs.toFixed(1)}ms`)}` : '';
      const retry = step.attempts > 1 ? c.yellow(` (retry ${step.attempts - 1})`) : '';
      if (step.status === 'passed') {
        line(`      ${c.green('✔')} ${step.name}${ms}${retry}`);
      } else if (step.status === 'failed' || step.status === 'error') {
        line(`      ${c.red('✘')} ${step.name}${ms}${retry}`);
        for (const f of step.failures) {
          line(`          ${c.red(f.message)}`);
        }
      } else {
        line(`      ${c.yellow('○')} ${step.name} ${c.gray('(skipped)')}`);
      }
      for (const w of step.warnings) line(`          ${c.yellow('⚠')} ${c.yellow(w)}`);
    }

    const flowWarnings = [...(flow.warnings || [])];
    for (const w of flowWarnings) line(`      ${c.yellow('⚠')} ${c.yellow(w)}`);
    line();
  }

  // Summary
  const allPassed = run.totals.failed === 0 && run.totals.flows > 0;
  const status = allPassed ? c.green('ALL PASSING') : c.red('FAILING');
  line(`  ${'─'.repeat(64)}`);
  const parts = [
    `${run.totals.flows} flow${run.totals.flows === 1 ? '' : 's'}`,
    `${run.totals.steps} step${run.totals.steps === 1 ? '' : 's'}`,
  ];
  if (run.totals.stepsPassed !== run.totals.steps) parts.push(c.green(`${run.totals.stepsPassed} passed`), c.red(`${run.totals.steps - run.totals.stepsPassed} failed`));
  else parts.push(c.green(`${run.totals.stepsPassed} passed`));
  parts.push(`${run.durationMs}ms`);
  line(`  ${status} ${c.gray('·')} ${parts.join(c.gray(' · '))}`);
  line();

  return lines.join('\n');
}

/** One-line summary used by serve mode. */
export function renderSummary(run) {
  const allPassed = run.totals.failed === 0 && run.totals.flows > 0;
  return allPassed
    ? `${run.totals.stepsPassed}/${run.totals.steps} steps passed in ${run.durationMs}ms`
    : `${run.totals.steps - run.totals.stepsPassed}/${run.totals.steps} steps failed (${run.totals.stepsPassed} passed) in ${run.durationMs}ms`;
}
