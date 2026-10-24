// report/tap.js — TAP 13 output, the lingua franca of test harnesses.

'use strict';

export function renderTap(run) {
  const out = [];
  out.push('TAP version 13');
  out.push(`1..${run.totals.steps}`);
  let n = 0;
  for (const flow of run.flows) {
    if (flow.error && flow.steps.length === 0) {
      n++;
      out.push(`not ok ${n} - ${flow.name} (connection)`);
      out.push(`  ---`);
      out.push(`  message: ${JSON.stringify(flow.error.message)}`);
      out.push(`  severity: fail`);
      out.push(`  ...`);
    }
    for (const step of flow.steps) {
      n++;
      const label = `${flow.name} › ${step.name}`;
      if (step.status === 'passed') {
        out.push(`ok ${n} - ${label} # ${step.latencyMs?.toFixed(1) || '0'}ms`);
      } else if (step.status === 'pending' || step.status === 'skipped') {
        out.push(`ok ${n} - ${label} # SKIP`);
      } else {
        out.push(`not ok ${n} - ${label}`);
        out.push(`  ---`);
        for (const f of step.failures) out.push(`  message: ${JSON.stringify(f.message)}`);
        out.push(`  severity: fail`);
        out.push(`  ...`);
      }
    }
  }
  const failed = run.totals.steps - run.totals.stepsPassed;
  out.push(`# tests ${run.totals.steps}`);
  out.push(`# pass  ${run.totals.stepsPassed}`);
  out.push(`# fail  ${failed}`);
  return out.join('\n') + '\n';
}
