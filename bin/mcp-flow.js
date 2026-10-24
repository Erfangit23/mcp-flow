#!/usr/bin/env node
// bin/mcp-flow.js — CLI entry point.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/args.js';
import { UserError } from '../src/util.js';
import { splitCommand } from '../src/runner.js';
import { loadConfig, resolveFlowFiles, resolveServerSpec } from '../src/config.js';
import { loadFlowFiles, runFlows } from '../src/runner.js';
import { getReporter, supportsColor } from '../src/report/index.js';
import { generateInit } from '../src/scaffold.js';
import { serve } from '../src/serve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

const HELP = `
  mcp-flow ${VERSION} — Postman for MCP servers

  Write scripted flows, chain tool calls, assert responses, gate your CI.
  Deterministic, zero dependencies, no LLM required.

  USAGE

    mcp-flow run    [patterns...] [-- <server command>]
    mcp-flow init   -- <server command>
    mcp-flow list   [patterns...] [-- <server command>]
    mcp-flow validate [patterns...]
    mcp-flow serve
    mcp-flow help | version

  COMMANDS

    run        Execute flows against an MCP server (the default workhorse)
    init       Introspect a server and write your first flow for you
    list       Show which tools a server exposes
    validate   Check flow file syntax without running anything
    serve      Run mcp-flow as an MCP server (for AI agents)

  FLAGS

    --server "cmd args"   Server command (alternative to "--" syntax)
    --url http://...      Server URL (Streamable HTTP transport)
    --reporter pretty|json|junit|tap
    --out FILE            Write the report to a file (junit/json/tap)
    --timeout MS          Per-step timeout (default 30000)
    --fail-fast           Stop a flow at its first failing step
    --safe-only           Refuse to call tools marked destructive
    --filter NAME         Only run flows whose name matches
    --no-color            Disable ANSI colors
    --verbose             More detail on failures
    --dry-run             (init) print generated files instead of writing

  EXAMPLES

    mcp-flow init -- node examples/echo/server.js
    mcp-flow run
    mcp-flow run flows/*.flow.json -- node my-server.js
    mcp-flow run --url http://localhost:3000/mcp --reporter junit --out report.xml

  DOCS   https://github.com/Erfangit23/mcp-flow
`;

function die(err) {
  const msg = err instanceof UserError ? err.message : (err?.stack || String(err));
  process.stderr.write(`\x1b[31m✘\x1b[0m ${msg}\n`);
  if (err instanceof UserError && err.hint) process.stderr.write(`  \x1b[33mhint:\x1b[0m ${err.hint}\n`);
  process.exit(2);
}

function exitCode(run) {
  return run.totals.failed === 0 && run.totals.flows > 0 ? 0 : 1;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    return die(err);
  }
  if (!args.command || args.command === 'help') {
    process.stdout.write(HELP);
    process.exit(args.command ? 0 : 0);
  }
  if (args.command === 'version') {
    process.stdout.write(`mcp-flow ${VERSION}\n`);
    process.exit(0);
  }

  const flags = args.flags;

  if (args.command === 'serve') {
    serve();
    return;
  }

  if (args.command === 'init') {
    let serverSpec;
    if (args.serverCommand) serverSpec = { command: args.serverCommand[0], args: args.serverCommand.slice(1) };
    else if (flags.server) {
      const parts = splitCommand(flags.server);
      serverSpec = { command: parts[0], args: parts.slice(1) };
    } else if (flags.url) serverSpec = { url: flags.url };
    else return die(new UserError('"init" needs a server: mcp-flow init -- node server.js', 'Or use --url http://localhost:3000/mcp'));

    try {
      const { files, tools, skipped, serverInfo, protocolVersion } = await generateInit({ serverSpec });
      if (flags.dryRun) {
        for (const f of files) {
          process.stdout.write(`\x1b[90m── would write ${path.relative(process.cwd(), f.path)} ──\x1b[0m\n${f.content}\n`);
        }
        process.exit(0);
      }
      for (const f of files) {
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        fs.writeFileSync(f.path, f.content, 'utf8');
        process.stdout.write(`\x1b[32m✔\x1b[0m wrote ${path.relative(process.cwd(), f.path)}\n`);
      }
      process.stdout.write(`\n  Server: \x1b[1m${serverInfo?.name || '?'}\x1b[0m ${serverInfo?.version || ''} · protocol ${protocolVersion} · ${tools.length} tool(s)\n`);
      if (skipped.length) process.stdout.write(`  Skipped (destructive): ${skipped.join(', ')}\n`);
      process.stdout.write(`\n  Next steps:\n`);
      process.stdout.write(`    1. Replace TODO_ values in flows/smoke.flow.json (if any)\n`);
      process.stdout.write(`    2. \x1b[1mmcp-flow run\x1b[0m\n\n`);
      process.exit(0);
    } catch (err) {
      return die(err);
    }
  }

  if (args.command === 'list') {
    try {
      const serverSpec = resolveServerSpec({
        cliServer: args.serverCommand ? args.serverCommand.join(' ') : undefined,
        cliUrl: flags.url,
        configSpec: loadConfig().config.server,
      });
      if (!serverSpec) return die(new UserError('No server given: use "-- node server.js", --url, or mcp-flow.json'));
      const { McpClient, createTransport } = await import('../src/client.js');
      const transport = createTransport(serverSpec);
      const client = new McpClient(transport, { timeoutMs: flags.timeout || 30000 });
      transport.start?.();
      await client.initialize();
      const tools = await client.listTools();
      process.stdout.write(`\x1b[1m${client.serverInfo?.name || '?'}\x1b[0m ${client.serverInfo?.version || ''} · protocol ${client.protocolVersion} · ${tools.length} tool(s)\n\n`);
      for (const t of tools) {
        const ro = t.annotations?.readOnlyHint === false ? ' \x1b[31m[destructive]\x1b[0m' : '';
        const req = t.inputSchema?.required || [];
        process.stdout.write(`  ${t.name}${ro}\n    ${(t.description || '').split('\n')[0]}\n`);
        if (req.length) process.stdout.write(`    required: ${req.join(', ')}\n`);
      }
      process.stdout.write('\n');
      await client.close();
      process.exit(0);
    } catch (err) {
      return die(err);
    }
  }

  // ---- run / validate ------------------------------------------------------
  try {
    const cfg = loadConfig();
    const baseDir = cfg.path ? cfg.dir : process.cwd();

    if (args.command === 'validate') {
      const { files } = resolveFlowFiles(args.patterns, baseDir);
      const { parseFlowSource } = await import('../src/flows/parse.js');
      let bad = 0;
      for (const f of files) {
        try {
          const flow = parseFlowSource(fs.readFileSync(f, 'utf8'), f);
          process.stdout.write(`\x1b[32m✔\x1b[0m ${path.relative(process.cwd(), f)} \x1b[90m(${flow.steps.length} steps)\x1b[0m\n`);
        } catch (err) {
          bad++;
          process.stdout.write(`\x1b[31m✘\x1b[0m ${path.relative(process.cwd(), f)}\n    ${err.message}\n`);
        }
      }
      process.exit(bad ? 1 : 0);
    }

    // run
    const { files } = resolveFlowFiles(args.patterns, baseDir);
    const { flows, errors } = loadFlowFiles(files);
    if (errors.length) {
      for (const e of errors) process.stderr.write(`\x1b[31m✘\x1b[0m ${e.message}\n${e.hint ? `  hint: ${e.hint}\n` : ''}`);
      process.exit(2);
    }
    let selected = flows;
    if (flags.filter) {
      const rx = new RegExp(flags.filter, 'i');
      selected = flows.filter((f) => rx.test(f.name));
      if (!selected.length) return die(new UserError(`No flow name matches --filter "${flags.filter}"`));
    }

    const serverSpec = resolveServerSpec({
      cliServer: args.serverCommand ? { command: args.serverCommand[0], args: args.serverCommand.slice(1) } : undefined,
      cliUrl: flags.url,
      configSpec: cfg.config.server,
    });

    const run = await runFlows({
      flows: selected,
      serverSpec,
      timeoutMs: flags.timeout || cfg.config.timeoutMs || 30000,
      failFast: flags.failFast || Boolean(cfg.config.failFast),
      safeOnly: flags.safeOnly || Boolean(cfg.config.safeOnly),
      verbose: flags.verbose,
    });

    const reporterName = flags.reporter || cfg.config.reporter || 'pretty';
    const reporter = getReporter(reporterName);
    const output = reporter.render(run, reporterName === 'pretty' ? { color: supportsColor(process.stdout, flags.noColor === true ? false : undefined) } : {});
    if (reporterName === 'pretty') {
      process.stdout.write(output + '\n');
    } else if (flags.out) {
      fs.writeFileSync(path.resolve(flags.out), output, 'utf8');
      process.stdout.write(`\x1b[32m✔\x1b[0m report written to ${path.resolve(flags.out)}\n`);
      const pretty = getReporter('pretty').render(run, { color: false });
      if (flags.verbose) process.stdout.write(pretty + '\n');
    } else {
      process.stdout.write(output);
    }
    process.exit(exitCode(run));
  } catch (err) {
    return die(err);
  }
}

main().catch(die);
