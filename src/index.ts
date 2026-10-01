import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runTribunal } from "./tribunal";

const { version } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
) as { version: string };

export const discussTool = {
  name: "discuss" as const,
  config: {
    title: "Discuss",
    description:
      "Bring an idea or question before the Living Tribunal: three agents (Believer, Skeptic, Investor) argue independently, and a Judge renders a final verdict.",
    inputSchema: {
      topic: z.string().describe("The idea or question to discuss"),
    },
    outputSchema: {
      decision: z.enum(["PURSUE", "PURSUE_WITH_CHANGES", "PASS"]),
      reasoning: z.string(),
      believerArgument: z.string(),
      skepticArgument: z.string(),
      investorArgument: z.string(),
    },
  },
  handler: async ({ topic }: { topic: string }) => {
    try {
      const result = await runTribunal(topic);
      return {
        structuredContent: result,
        content: [
          { type: "text" as const, text: `## Believer\n${result.believerArgument}` },
          { type: "text" as const, text: `## Skeptic\n${result.skepticArgument}` },
          { type: "text" as const, text: `## Investor\n${result.investorArgument}` },
          {
            type: "text" as const,
            text: `## Verdict: ${result.decision}\n${result.reasoning}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `The Living Tribunal could not reach a verdict: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: "living-tribunal",
    version,
  });

  server.registerTool(discussTool.name, discussTool.config, discussTool.handler);

  return server;
}

export const app = express();
app.use(express.json());

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

function startServer(): void {
  const port = process.env.PORT || 3000;
  const httpServer = app.listen(port, () => {
    const boundPort = (httpServer.address() as { port: number }).port;
    console.log(`living-tribunal MCP server listening on http://localhost:${boundPort}/mcp`);
  });
}

if (require.main === module) {
  startServer();
}
