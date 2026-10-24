// report/junit.js — JUnit XML for CI systems (Jenkins, GitLab, Azure…).

'use strict';

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderJunit(run) {
  const totalTests = run.totals.steps;
  const failures = run.totals.steps - run.totals.stepsPassed;
  const timeSec = (run.durationMs / 1000).toFixed(3);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<testsuites name="mcp-flow" tests="${totalTests}" failures="${failures}" time="${timeSec}">`);

  for (const flow of run.flows) {
    const fFail = flow.steps.filter((s) => s.status === 'failed' || s.status === 'error').length;
    const fTime = (flow.steps.reduce((acc, s) => acc + (s.latencyMs || 0), 0) / 1000).toFixed(3);
    out.push(`  <testsuite name="${esc(flow.name)}" tests="${flow.steps.length}" failures="${fFail}" time="${fTime}">`);
    if (flow.error && flow.steps.length === 0) {
      out.push(`    <testcase name="connection" time="0">`);
      out.push(`      <failure message="${esc(flow.error.message)}">${esc(flow.error.hint || '')}</failure>`);
      out.push(`    </testcase>`);
    }
    for (const step of flow.steps) {
      const time = ((step.latencyMs || 0) / 1000).toFixed(3);
      out.push(`    <testcase name="${esc(`${flow.name} › ${step.name}`)}" classname="${esc(flow.name)}" time="${time}">`);
      if (step.status === 'failed' || step.status === 'error') {
        const msg = step.failures.map((f) => f.message).join(' | ') || step.status;
        out.push(`      <failure message="${esc(msg)}">`);
        for (const f of step.failures) out.push(`        ${esc(f.message)}`);
        out.push(`      </failure>`);
      } else if (step.status === 'skipped' || step.status === 'pending') {
        out.push(`      <skipped/>`);
      }
      out.push(`    </testcase>`);
    }
    out.push(`  </testsuite>`);
  }
  out.push('</testsuites>');
  return out.join('\n') + '\n';
}
