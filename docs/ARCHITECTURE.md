# Architecture

mcp-flow is a zero-dependency Node.js CLI that runs scripted integration tests
against MCP (Model Context Protocol) servers. This document explains the
module map and the decisions behind it.

## Module map

```
bin/mcp-flow.js            CLI entry: command dispatch, exit codes, error rendering
src/args.js                Hand-rolled argv parser (-- separator preserved verbatim)
src/config.js              mcp-flow.json discovery, flow-file glob resolution
src/glob.js                ** / * / ? / {a,b} expansion, Windows-separator aware
src/jsonrpc.js             JSON-RPC 2.0 message builders + lenient validation
src/client.js              MCP client: initialize handshake, tools/*, ping
src/transport/
  stdio.js                 Spawn + newline-delimited JSON framing, id correlation,
                           process-tree teardown (taskkill fallback on Windows)
  http.js                  Streamable HTTP: POST JSON-RPC, direct-JSON and SSE
                           responses, Mcp-Session-Id handling
src/flows/
  parse.js                 Strict flow validation with precise error messages
  template.js              {{expr}} interpolation and variable extraction
  assert.js                Assertion engine -> structured pass/fail records
src/runner.js              Orchestration: per-flow connection, step execution,
                           retries, fail-fast, protocol-noise collection
src/scaffold.js            mcp-flow init: introspection -> generated flow
src/serve.js               mcp-flow AS an MCP server (tools for agents)
src/report/
  pretty.js                ANSI terminal report (also used colorless by serve)
  json.js                  Machine-readable dump
  junit.js                 JUnit XML (escaping checked by tests)
  tap.js                   TAP 13
```

## Design decisions

**Zero dependencies.** A test tool's job is to be trustworthy; every transitive
dependency is supply-chain surface. JSON-RPC framing, SSE parsing, globbing,
ANSI, XML escaping — all are small, testable problems. Total: ~0 deps,
Node >= 18 stdlib only.

**Deterministic by default.** No LLM calls, no network calls to third parties,
no randomness. Two runs against the same server produce byte-identical
JSON reports. This is what makes the tool CI-native where LLM-as-judge
evaluators are not.

**One fresh connection per flow.** Flows must not leak state into each other.
Costs a process spawn per flow; correctness wins.

**Strict parsing, lenient protocol.** Flow files are validated strictly (unknown
keys are errors — typos should fail loudly). The MCP protocol layer is
deliberately lenient: non-JSON stdout lines, duplicate ids, and invalid frames
are *recorded as warnings* instead of crashing, because surfacing
non-conformance is the product.

**The `--` separator is raw.** Everything after `--` is passed to the transport
as the OS-tokenized argv, never re-split — paths with spaces survive.

**Noise draining.** Protocol violations are collected (a) after handshake,
(b) after steps, and (c) after transport close, with consumed entries drained
so reports never duplicate or miss late frames. This ordering closed a real
race where duplicate-id frames arrived after the last step resolved.

**Windows is a first-class platform.** Process teardown uses `taskkill /T /F`
fallback, globs normalize separators, the CI matrix runs Windows + Ubuntu.

## Exit codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | All flows passed                     |
| 1    | At least one step/flow failed        |
| 2    | Usage / config / parse error         |
