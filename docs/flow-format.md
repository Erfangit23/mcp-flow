# The mcp-flow Flow Format (v1)

A **flow** is a JSON file describing a scripted conversation with an MCP server:
which tools to call, with which arguments, and what must be true about each response.

- File extension: `.flow.json`
- Encoding: UTF-8, strict JSON (comments are not supported — use the `todo` key instead)

## Top level

```jsonc
{
  "name": "weather smoke test",          // required, shown in reports
  "description": "optional, shown in reports",
  "server": { ... },                      // optional; overrides mcp-flow.json, overridden by CLI
  "timeoutMs": 30000,                     // optional per-step timeout (default 30000)
  "vars": { "city": "Tehran" },           // optional seed variables
  "todo": ["step 1: replace TODO_ args"], // optional metadata (written by mcp-flow init)
  "steps": [ ... ]                        // required, executed in order
}
```

### `server`

```jsonc
{ "command": "node", "args": ["server.js"], "env": { "KEY": "v" }, "cwd": "." }  // stdio
{ "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer x" } } // Streamable HTTP
```

## Steps

Each step calls one tool and (optionally) asserts on the outcome and extracts values.

```jsonc
{
  "call": "get_weather",        // required: tool name
  "as": "weather-step",         // optional: named result, reference as steps.weather-step
  "args": { "city": "{{vars.city}}" },  // optional: templated (see below)
  "retries": 2,                 // optional: retry failed steps (linear backoff)
  "expect": { ... },            // optional: assertions (see below)
  "extract": { "temp": "result.content.0.text" }, // optional: save view paths into vars
  "ignore": false               // reserved
}
```

## The step view

Assertions and extractions see a normalized **view** of the tool outcome:

| Path                | Contents                                                      |
| ------------------- | ------------------------------------------------------------- |
| `ok`                | `true` if the tool returned a result without `isError`        |
| `result`            | The `CallToolResult` object (`content`, `structuredContent`…) |
| `error.message`     | Tool error text, or the JSON-RPC error message                |
| `error.code`        | JSON-RPC error code, when the server returned one             |
| `latencyMs`         | Round-trip time in milliseconds                               |
| `raw`               | The untouched response (last resort — prefer typed paths)     |

## Assertions (`expect`)

| Key              | Shape                          | Meaning                                    |
| ---------------- | ------------------------------ | ------------------------------------------ |
| `ok`             | `true` / `false`               | Tool succeeded / failed                    |
| `equals`         | `{ "path": value }`            | Deep equality at each path                 |
| `contains`       | `{ "path": value }`            | Substring (strings) or membership (arrays) |
| `matches`        | `{ "path": "regex" }`          | Regular expression (strings only)          |
| `schema`         | `{ "path": "string" }`         | Type check: string/number/boolean/object/array/null/any |
| `exists`         | `["path", …]`                  | Path must resolve                          |
| `notExists`      | `["path", …]`                  | Path must NOT resolve                      |
| `latencyMs`      | `500` or `{ "max": 500 }`      | Round-trip time budget                     |
| `errorContains`  | `"substring"`                  | Error message must contain (case-insensitive) |

## Templating

Strings may contain `{{expr}}` expressions resolved against:

| Root            | Contents                                        |
| --------------- | ----------------------------------------------- |
| `vars.X`        | Flow variables (`vars` seed + `extract` output) |
| `steps.N.…`     | The view of step *N* (1-based) or its `as` name |
| `env.X`         | Environment variables of the mcp-flow process   |

A string that is *exactly* one template (`"{{vars.count}}"`) resolves to the
**native value** (number, object, boolean — not stringified). Embedded
templates (`"count={{vars.count}}"`) are string-concatenated.

Paths use dot notation with numeric indices: `result.content.0.text`.

## Reference

- `$schema`-style tooling and JSON Schema for flows: planned (v0.2)
- Flow format is versioned; breaking changes will bump the format number in the changelog.
