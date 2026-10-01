import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TribunalResult } from "../tribunal";

const { mockRunTribunal } = vi.hoisted(() => ({
  mockRunTribunal: vi.fn<(topic: string) => Promise<TribunalResult>>(),
}));

vi.mock("../tribunal", () => ({
  runTribunal: mockRunTribunal,
}));

const sampleResult: TribunalResult = {
  believerArgument: "Believer argument",
  skepticArgument: "Skeptic argument",
  investorArgument: "Investor argument",
  decision: "PURSUE",
  reasoning: "Strong case, real market",
};

beforeEach(() => {
  mockRunTribunal.mockReset();
});

describe("discussTool.handler", () => {
  it("returns the full transcript and structuredContent on success", async () => {
    mockRunTribunal.mockResolvedValue(sampleResult);
    const { discussTool } = await import("../index");

    const result = await discussTool.handler({ topic: "A subscription box for cat toys" });

    expect(mockRunTribunal).toHaveBeenCalledWith("A subscription box for cat toys");
    expect(result.structuredContent).toEqual(sampleResult);
    expect(result.content).toHaveLength(4);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Believer argument") });
    expect(result.content[3]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Verdict: PURSUE"),
    });
  });

  it("returns isError:true with a readable message when runTribunal rejects with an Error", async () => {
    mockRunTribunal.mockRejectedValue(new Error("ANTHROPIC_API_KEY is not set"));
    const { discussTool } = await import("../index");

    const result = await discussTool.handler({ topic: "An idea" });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("ANTHROPIC_API_KEY is not set"),
    });
  });

  it("returns isError:true with a readable message when runTribunal rejects with a non-Error value", async () => {
    mockRunTribunal.mockRejectedValue("unexpected failure");
    const { discussTool } = await import("../index");

    const result = await discussTool.handler({ topic: "An idea" });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("unexpected failure"),
    });
  });
});

describe("createServer", () => {
  async function connectClient() {
    mockRunTribunal.mockResolvedValue(sampleResult);
    const { createServer } = await import("../index");
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    return { server, client };
  }

  it("exposes exactly one tool named discuss", async () => {
    const { client } = await connectClient();

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("discuss");
  });

  it("calling discuss through the protocol returns the tribunal result", async () => {
    const { client } = await connectClient();

    const result = await client.callTool({
      name: "discuss",
      arguments: { topic: "Cats vs dogs" },
    });

    expect(result.structuredContent).toEqual(sampleResult);
  });
});
