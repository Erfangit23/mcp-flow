# Contributing to mcp-flow

Thanks for your interest! mcp-flow is deliberately small and dependency-free.

## Ground rules

1. **Zero dependencies.** If you need a capability, implement it on Node's
   stdlib and cover it with tests. If it's genuinely large (a YAML parser, a
   browser), propose it as an issue first.
2. **Windows matters.** The project is developed on Windows; CI runs
   Windows + Ubuntu. Path handling and process teardown must work on both.
3. **Determinism.** Tests must not depend on the network, the clock (beyond
   monotonic latency), or an LLM.
4. **Flow format is versioned.** Changes to `docs/flow-format.md` need a
   changelog entry and backwards compatibility or a format bump.

## Setup

```bash
git clone https://github.com/Erfangit23/mcp-flow.git
cd mcp-flow
npm test          # 49 tests, no install step — there are no dependencies
```

## Workflow

1. Open an issue describing the bug or feature.
2. Fork, create a branch (`feat/my-thing` or `fix/my-bug`).
3. Add tests that fail before your change and pass after.
4. Run `npm test` and `node bin/mcp-flow.js run examples/echo/flows/smoke.flow.json -- node examples/echo/server.js`.
5. Open a PR referencing the issue.

## Reporting bugs

Include: OS, Node version (`node -v`), the flow file, the server command,
and the output of `mcp-flow run --reporter json` for the failing case.
