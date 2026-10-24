<div align="center">

# mcp-flow

**Postman for MCP servers.**
Write scripted flows, chain tool calls, assert responses, gate your CI.

Deterministic · Zero dependencies · No LLM required · Node ≥ 18

[![CI](https://github.com/Erfangit23/mcp-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/Erfangit23/mcp-flow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green)](package.json)

</div>

---

MCP servers are APIs for AI agents — yet people "test" them by chatting with
Claude and hoping. **You would never ship an HTTP API without integration
tests. Your MCP server deserves the same discipline.**

`mcp-flow` runs deterministic, scripted conversations against any MCP server
(stdio or HTTP), asserts on every response, and fails your CI when behavior
drifts. No API keys. No tokens. No flaky judge models. Just tests.

```console
$ mcp-flow init -- node my-server.js
✔ wrote flows/smoke.flow.json
✔ wrote mcp-flow.json

  Server: my-server 1.2.0 · protocol 2025-06-18 · 7 tool(s)

  Next steps:
    1. Replace TODO_ values in flows/smoke.flow.json (if any)
    2. mcp-flow run

$ mcp-flow run
mcp-flow · 1 flow · 6 steps

  ✔ echo smoke test
      echo-server 1.0.0 · protocol 2025-06-18 · stdio · 7 tools
      ✔ greeting 0.7ms
      ✔ echo 0.4ms
      ✔ add 0.5ms
      ✔ slow 124ms
      ✔ fail 2.0ms
      ✔ totals 1.4ms

  ────────────────────────────────────────────────────────────────
  ALL PASSING · 1 flow · 6 steps · 6 passed · 310ms
```

## Why not just use the MCP Inspector?

The Inspector is a great *manual debugger*. mcp-flow is the *automated
regression gate* the ecosystem was missing:

| | Inspector | record/replay VCRs | LLM evals | **mcp-flow** |
|---|---|---|---|---|
| Scripted, repeatable | ✗ | partial | ✗ | ✔ |
| Asserts on responses | ✗ | ✗ | fuzzy | **✔ exact** |
| Deterministic in CI | ✗ | ✔ | ✗ | **✔** |
| Costs money per run | – | – | $$$ | **0** |
| Needs API keys | ✗ | ✗ | ✔ | **✗** |
| Installs dependencies | npm SDK | ✔ | ✔ | **0** |

They complement each other: explore with the Inspector, then pin behavior
down with mcp-flow.

## Install

No install needed — it's a single repo clone (or `npm i -g mcp-flow` once
published). Requires Node 18+.

```bash
git clone https://github.com/Erfangit23/mcp-flow.git
cd mcp-flow
npm test   # 49 tests pass out of the box
```

## The 30-second tour

**1. Let it write your first test.** `init` connects to your server, reads
`tools/list`, and generates a ready-to-edit flow — sampling arguments from
your tool schemas, skipping destructive tools:

```bash
mcp-flow init -- node my-server.js          # stdio
mcp-flow init --url http://localhost:3000/mcp  # Streamable HTTP
```

**2. Describe behavior as a flow** (`.flow.json`):

```json
{
  "name": "weather smoke test",
  "steps": [
    {
      "as": "weather",
      "call": "get_weather",
      "args": { "city": "Tehran" },
      "expect": {
        "ok": true,
        "contains": { "result.content.0.text": "°" },
        "latencyMs": { "max": 2000 }
      },
      "extract": { "temp": "result.content.0.text" }
    },
    {
      "call": "log_city",
      "args": { "note": "{{vars.temp}}" },
      "expect": { "ok": true }
    }
  ]
}
```

- **Chain calls**: `extract` saves values into `vars`, later steps read them
  via `{{vars.temp}}`. A pure template resolves to the native value — numbers
  stay numbers.
- **Assert precisely**: `equals` (deep), `contains`, `matches` (regex),
  `schema` (types), `exists`/`notExists`, `latencyMs` budgets, `ok`,
  `errorContains`. Paths address the normalized outcome:
  `result.content.0.text`, `result.structuredContent.total`, `error.message`.
- **Full format spec**: [docs/flow-format.md](docs/flow-format.md).

**3. Run it anywhere:**

```bash
mcp-flow run                                  # uses mcp-flow.json
mcp-flow run flows/*.flow.json -- node server.js
mcp-flow run --url http://localhost:3000/mcp
mcp-flow run --reporter junit --out report.xml  # GitLab/Jenkins/Azure
mcp-flow run --reporter tap                     # TAP 13
mcp-flow run --safe-only                        # refuse destructive tools
mcp-flow list  -- node server.js                # what does this server expose?
```

## Wire it into CI in one minute

```yaml
# .github/workflows/mcp-flow.yml
name: MCP contract tests
on: [push, pull_request]
jobs:
  mcp-flow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx mcp-flow run   # exit 1 on any assertion failure
```

Failures look like this — the exact diff, not a vibe:

```console
  ✘ intentional failure demo
      ✔ echo 0.6ms
      ✘ echo 0.4ms
          at "result.content.0.text": expected "Echo: something else entirely", got "Echo: but this is not"

  FAILING · 1 flow · 2 steps · 1 passed · 1 failed · 170ms
```

## It also catches what silent clients swallow

mcp-flow watches the wire, not just the answers. A server that writes log
lines to stdout, sends duplicate responses, or dies mid-call gets flagged:

```console
  ✔ broken server conformance
      broken-server 0.0.1 · protocol 2024-11-05 · stdio · 3 tools
      ✔ echo 0.5ms
      ✔ stutter 0.5ms
      ⚠ server wrote non-JSON to stdout (protocol violation): Welcome to my broken server!
      ⚠ invalid JSON-RPC from server: response for unknown id 3
```

Functional pass, protocol smell — reported separately, so you can gate on
what you care about.

## `mcp-flow serve` — an MCP server that tests MCP servers

Add mcp-flow to your Claude Desktop / Cursor / Windsurf config and your coding
agent can run your flows as a tool:

```json
{
  "mcpServers": {
    "mcp-flow": { "command": "node", "args": ["/path/to/mcp-flow/bin/mcp-flow.js", "serve"] }
  }
}
```

Tools exposed: `mcp_flow_run` (run flows or an inline flow object),
`mcp_flow_list`, `mcp_flow_validate`. Yes, it's turtles all the way down —
mcp-flow can test itself, and its own CI does exactly that.

## Comparison at a glance

| Capability | mcp-flow |
|---|---|
| Transports | stdio + Streamable HTTP (JSON & SSE responses) |
| Protocol | JSON-RPC 2.0, negotiates `2025-06-18` / `2024-11-05` |
| Assertions | equals · contains · matches · schema · exists · notExists · latency · ok · errorContains |
| Templating | `{{vars.*}}`, `{{steps.*}}`, `{{env.*}}`, native value resolution |
| Reporters | pretty · json · junit · tap |
| Retries / fail-fast / safe-only / filters | ✔ / ✔ / ✔ / ✔ |
| Dependencies | **zero** |
| Windows support | first-class (developed on it, CI runs it) |

## Philosophy

1. **A test tool must be trustworthy.** Zero dependencies = zero supply-chain
   risk. ~2.5k lines you can read in an afternoon.
2. **Determinism beats cleverness.** Same server + same flows = byte-identical
   JSON reports. LLM-as-judge has its place; your CI gate is not that place.
3. **Non-conformance is data.** The runner records protocol violations instead
   of crashing, so reports explain *what kind of wrong* your server is.

## Roadmap

- [ ] JSON Schema for flow files (`$schema` support in editors)
- [ ] `--coverage` report: which tools/arguments has your suite touched?
- [ ] Flow format: `assert_resources`, `assert_prompts`
- [ ] npm publish + `npx mcp-flow init`

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (rules: zero deps,
Windows-safe, deterministic).

## License

[MIT](LICENSE) © Erfan Rahimi

Built with a safety-first bias: dry-run defaults in
[mt5-mcp-server](https://github.com/Erfangit23/mt5-mcp-server), guarded
execution in production trading bots — mcp-flow applies the same discipline
to MCP testing.
