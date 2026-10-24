// report/json.js — machine-readable full dump.
'use strict';

export function renderJson(run) {
  const clone = {
    tool: 'mcp-flow',
    version: '0.1.0',
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    totals: run.totals,
    passing: run.totals.failed === 0 && run.totals.flows > 0,
    flows: run.flows.map((f) => ({
      name: f.name,
      description: f.description,
      status: f.status,
      error: f.error,
      connection: f.connection
        ? {
            server: f.connection.serverInfo,
            protocolVersion: f.connection.protocolVersion,
            transport: f.connection.transport,
            tools: f.connection.tools,
          }
        : null,
      warnings: f.warnings,
      steps: f.steps.map((s) => ({
        index: s.index,
        name: s.name,
        tool: s.tool,
        status: s.status,
        latencyMs: s.latencyMs !== null ? Math.round(s.latencyMs * 1000) / 1000 : null,
        attempts: s.attempts,
        failures: s.failures,
        warnings: s.warnings,
        raw: s.raw ?? undefined,
      })),
    })),
  };
  return JSON.stringify(clone, null, 2) + '\n';
}
