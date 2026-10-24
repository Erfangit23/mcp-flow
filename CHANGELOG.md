# Changelog

All notable changes to mcp-flow are documented here.

## [0.1.0] — 2026-10-24

Initial release.

- Flow format v1: scripted tool calls, `{{...}}` templating with native value
  resolution, variable extraction/chaining, 9 assertion kinds, retries, fail-fast
- Transports: stdio (newline-delimited JSON-RPC) and Streamable HTTP
  (direct JSON + SSE responses, session headers)
- `mcp-flow init` — introspects a live server and writes your first flow
- Reporters: pretty (ANSI), JSON, JUnit XML, TAP 13
- `mcp-flow serve` — run mcp-flow itself as an MCP server for coding agents
- Protocol conformance surfacing: non-JSON stdout, duplicate ids, invalid
  frames, mid-call crashes — recorded as structured warnings
- Safety: `--safe-only` honors `readOnlyHint` tool annotations
- 49 tests including end-to-end CLI integration against real example servers;
  zero runtime dependencies
