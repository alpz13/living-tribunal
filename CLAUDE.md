# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsc -> dist/
npm start              # node dist/index.js (requires build first)
npm run dev            # ts-node src/index.ts
npm test               # vitest run
npm run test:watch
npm run test:coverage
npm run lint           # eslint .
npm run lint:fix
```

Run a single test file or case:

```bash
npx vitest run src/__test__/tribunal.spec.ts
npx vitest run -t "throws a clear error if the Judge does not call submit_verdict"
```

Node >= 24 (`.nvmrc` pins 24.21.0). Requires a `.env` with `ANTHROPIC_API_KEY`;
optional `ANTHROPIC_MODEL` (defaults to `claude-sonnet-5`) and `PORT`
(`0` = let the OS assign a free port — the bound port is logged at startup).
`dotenv/config` does **not** override variables already present in the shell.

This directory is **not** a git repository.

## Architecture

Three layers, each depending only on the one below it:

- `src/index.ts` — MCP + HTTP transport. Registers the single `discuss` tool,
  exposes `POST /mcp` over Express.
- `src/tribunal.ts` — the orchestration. Owns all four system prompts, the
  fan-out/fan-in, and the verdict contract.
- `src/anthropic-client.ts` — thin Anthropic SDK wrapper. Reads env lazily and
  constructs a fresh `Anthropic` client per call, which is what makes the
  env-var tests possible.

### The tribunal flow

`runTribunal(topic)` fans out Believer, Skeptic, and Investor concurrently via
`Promise.all`, then feeds all three arguments to the Judge in a fourth,
sequential call. Each of the three is deliberately one-sided — the prompts
forbid hedging — so the balance comes from the Judge, not from any single agent.

Because the fan-out is `Promise.all`, any single agent failure rejects the whole
run. `discussTool.handler` is the only place that catches: it converts any throw
into an MCP `{ isError: true }` text response. Nothing below that layer handles
errors, so new failure modes should surface as thrown `Error`s with messages
meant for a human reading the tool output.

### Judge verdicts are a forced tool call, not parsed text

The Judge is given one tool, `submit_verdict`, with `tool_choice: { type: "tool" }`
forcing it. The structured verdict is read out of the `tool_use` block.

**Gotcha:** `strict: true` on a tool definition requires the schema to close
itself with `additionalProperties: false` alongside `required`. The API rejects
the request otherwise, and mocked unit tests cannot catch it — this was a real
bug found only by a live call. `tribunal.spec.ts` has a regression test asserting
the schema shape; keep it if you touch the tool definition, and prefer a live
smoke test when changing anything about the request envelope.

`thinking: { type: "disabled" }` is set explicitly on every call, and every
response is checked for `stop_reason === "max_tokens"` so truncation fails loudly
instead of returning a half-argument.

### MCP server lifecycle

The server is stateless per request: each `POST /mcp` builds a new `McpServer`
plus `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, and
both are closed on the response's `close` event. There is no shared server
instance and no session state to reason about.

`TribunalResult` carries an `[key: string]: unknown` index signature — that's
required for it to satisfy MCP's `structuredContent`, not an accident. Its shape
must stay in sync with `discussTool.config.outputSchema` in `index.ts`.

`index.ts` reads the version from `../package.json` relative to `__dirname`,
which only resolves correctly when the build output stays at `dist/index.js`.

## Conventions

- CommonJS with `module: node16`. MCP SDK deep imports need the `.js` suffix
  (`@modelcontextprotocol/sdk/server/mcp.js`); local imports do not
  (`./tribunal`).
- Tests live in `src/__test__/*.spec.ts` — a path both `tsconfig.json`
  (`exclude`) and `vitest.config.mts` (`include`) depend on, so moving them
  breaks the build and the test run in opposite directions.
- Every spec mocks exactly the layer directly beneath the unit under test
  (`index.spec.ts` mocks `../tribunal`; `tribunal.spec.ts` mocks
  `../anthropic-client`). Modules are pulled in with a dynamic
  `await import()` *after* `vi.mock`, because `index.ts` has module-level side
  effects (reads `package.json`, constructs the Express app).
- `index.spec.ts` exercises the tool over the real MCP protocol using
  `InMemoryTransport.createLinkedPair()` rather than calling the handler
  directly — use that pattern for anything protocol-shaped.
