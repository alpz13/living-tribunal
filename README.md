<p align="center">
    <a href="https://www.hackerrank.com/alejandro_lopez1">
        <img height=210 src="https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/9988213d-99cb-4c76-b88e-d710683f810e/dd2q5n7-f5f31733-9724-48c9-8fd5-b4ca14fc2c2f.jpg/v1/fit/w_400,h_534,q_70,strp/the_living_tribunal_marvel__by_robturp1230_dd2q5n7-375w-2x.jpg?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7ImhlaWdodCI6Ijw9NTM0IiwicGF0aCI6Ii9mLzk5ODgyMTNkLTk5Y2ItNGM3Ni1iODhlLWQ3MTA2ODNmODEwZS9kZDJxNW43LWY1ZjMxNzMzLTk3MjQtNDhjOS04ZmQ1LWI0Y2ExNGZjMmMyZi5qcGciLCJ3aWR0aCI6Ijw9NDAwIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmltYWdlLm9wZXJhdGlvbnMiXX0.FYGGZLDrZZUIxFzHycVvECxv-FuMBs8i6GKyyHRmhwQ">
    </a>
</p>

# Living Tribunal

An MCP server that puts an idea on trial. A single `discuss` tool fans a topic out

to three deliberately one-sided agents — a **Believer**, a **Skeptic**, and an
**Investor** — then hands all three arguments to a **Judge** who returns a
structured verdict: `PURSUE`, `PURSUE_WITH_CHANGES`, or `PASS`.

The balance comes from the Judge, not from any single agent. Each of the three
advocates is prompted to refuse to hedge: the Believer may not mention weaknesses,
the Skeptic may not acknowledge upside, and the Investor ignores everything except
whether the idea can make money.

## Requirements

- Node >= 24 (`.nvmrc` pins `24.21.0`)
- An Anthropic API key

## Setup

```bash
npm install
```

Create a `.env` in the project root:

```dotenv
ANTHROPIC_API_KEY=sk-ant-...     # required
ANTHROPIC_MODEL=claude-sonnet-5  # optional, this is the default
PORT=3000                        # optional, default 3000; use 0 for a random free port
```

`dotenv/config` does **not** override variables already set in your shell, so a
shell-exported `ANTHROPIC_API_KEY` wins over the file.

## Running

```bash
npm run build && npm start   # compile to dist/ then run
npm run dev                  # run from source with ts-node, no build step
```

On startup the server logs the address it actually bound to:

```
living-tribunal MCP server listening on http://localhost:3000/mcp
```

With `PORT=0` the OS assigns a free port — read it from that log line, which is
why the bound port is printed rather than the configured one.

### Connecting a client

The server speaks MCP over Streamable HTTP at `POST /mcp`. To register it with
Claude Code:

```bash
claude mcp add --transport http living-tribunal http://localhost:3000/mcp
```

Then ask it to use the `discuss` tool, or call it directly:

```
> use the discuss tool on "a subscription service for artisanal hot sauce"
```

A quick raw check that the server is up and advertising its tool:

```bash
curl -s http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## The `discuss` tool

**Input**

| Field   | Type   | Description                   |
| ------- | ------ | ----------------------------- |
| `topic` | string | The idea or question to judge |

**Output** — returned both as `structuredContent` and as four readable text
blocks (one per agent, then the verdict):

| Field               | Type                                           |
| ------------------- | ---------------------------------------------- |
| `believerArgument`  | string                                         |
| `skepticArgument`   | string                                         |
| `investorArgument`  | string                                         |
| `decision`          | `PURSUE` \| `PURSUE_WITH_CHANGES` \| `PASS`    |
| `reasoning`         | string — how the Judge weighed the three       |

Failures (missing API key, a truncated response, a Judge that doesn't submit a
verdict) come back as an MCP error response with a human-readable message rather
than throwing past the tool boundary.

## Architecture

Three layers, each depending only on the one below it:

```
src/index.ts            MCP + HTTP transport. Registers `discuss`, serves POST /mcp
      |
src/tribunal.ts         Orchestration. Owns the four system prompts, the
      |                 fan-out/fan-in, and the verdict contract
src/anthropic-client.ts Thin Anthropic SDK wrapper. Reads env lazily
```

`runTribunal(topic)` runs the three advocates concurrently with `Promise.all`,
then makes a fourth sequential call to the Judge with all three arguments in the
prompt. Because the fan-out is `Promise.all`, any single agent failure rejects the
whole run; `discussTool.handler` is the only place that catches.

**The verdict is a forced tool call, not parsed text.** The Judge is given exactly
one tool, `submit_verdict`, with `tool_choice: { type: "tool" }` forcing it, and
the decision is read out of the `tool_use` block. `thinking` is explicitly disabled
on every call, and every response is checked for `stop_reason === "max_tokens"` so
truncation fails loudly instead of returning half an argument.

**Server lifecycle is stateless per request.** Each `POST /mcp` builds a fresh
`McpServer` and `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`,
and closes both on the response's `close` event. There is no shared server instance
and no session state.

## Development

```bash
npm test              # vitest run (19 tests)
npm run test:watch
npm run test:coverage
npm run lint
npm run lint:fix
```

Run a single file or case:

```bash
npx vitest run src/__test__/tribunal.spec.ts
npx vitest run -t "throws a clear error if the Judge does not call submit_verdict"
```

Tests live in `src/__test__/*.spec.ts` and each spec mocks exactly the layer
directly beneath the unit under test — `index.spec.ts` mocks `../tribunal`,
`tribunal.spec.ts` mocks `../anthropic-client`. `index.spec.ts` drives the tool
over the real MCP protocol via `InMemoryTransport.createLinkedPair()` rather than
calling the handler directly.

A note if you touch the Judge's tool definition: `strict: true` requires the schema
to close itself with `additionalProperties: false` alongside `required`. The API
rejects the request otherwise, and mocked unit tests cannot catch it — this was a
real bug found only by a live call. `tribunal.spec.ts` carries a regression test
asserting the schema shape.

## Notes

- CommonJS with `module: node16`. MCP SDK deep imports need the `.js` suffix
  (`@modelcontextprotocol/sdk/server/mcp.js`); local imports do not (`./tribunal`).
- `index.ts` resolves `package.json` relative to `__dirname`, so the build output
  must stay at `dist/index.js`.
- `TribunalResult`'s `[key: string]: unknown` index signature is required for it to
  satisfy MCP's `structuredContent` type, and its shape must stay in sync with
  `discussTool.config.outputSchema`.
