import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessage } from "../anthropic-client";

vi.mock("../anthropic-client", () => ({
  createMessage: vi.fn(),
  getDefaultModel: () => "claude-sonnet-5",
}));

const mockedCreateMessage = createMessage as unknown as ReturnType<typeof vi.fn>;

function textMessage(text: string) {
  return { content: [{ type: "text", text }] };
}

function verdictMessage(decision: string, reasoning: string) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "submit_verdict",
        input: { decision, reasoning },
      },
    ],
  };
}

describe("runTribunal", () => {
  beforeEach(() => {
    mockedCreateMessage.mockReset();
  });

  it("runs Believer, Skeptic, and Investor, then the Judge, and assembles the result", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(verdictMessage("PURSUE", "Strong case, real market"));

    const { runTribunal } = await import("../tribunal");
    const result = await runTribunal("A subscription box for cat toys");

    expect(mockedCreateMessage).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      believerArgument: "Believer argument",
      skepticArgument: "Skeptic argument",
      investorArgument: "Investor argument",
      decision: "PURSUE",
      reasoning: "Strong case, real market",
    });
  });

  it("includes all three arguments in the Judge's prompt", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(verdictMessage("PASS", "Too risky"));

    const { runTribunal } = await import("../tribunal");
    await runTribunal("A subscription box for cat toys");

    const judgeCallArgs = mockedCreateMessage.mock.calls[3][0];
    const judgeUserMessage = judgeCallArgs.messages[0].content as string;
    expect(judgeUserMessage).toContain("Believer argument");
    expect(judgeUserMessage).toContain("Skeptic argument");
    expect(judgeUserMessage).toContain("Investor argument");
    expect(judgeCallArgs.tool_choice).toEqual({ type: "tool", name: "submit_verdict" });
  });

  it("declares submit_verdict as a strict tool with a closed schema", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(verdictMessage("PASS", "Too risky"));

    const { runTribunal } = await import("../tribunal");
    await runTribunal("A subscription box for cat toys");

    const judgeTool = mockedCreateMessage.mock.calls[3][0].tools[0];
    // The API rejects strict: true unless the schema closes itself with
    // additionalProperties: false and lists required fields.
    expect(judgeTool.strict).toBe(true);
    expect(judgeTool.input_schema.additionalProperties).toBe(false);
    expect(judgeTool.input_schema.required).toEqual(["decision", "reasoning"]);
  });

  it("rejects if one of the three argument agents fails", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce(textMessage("Investor argument"));

    const { runTribunal } = await import("../tribunal");

    await expect(runTribunal("An idea")).rejects.toThrow("rate limited");
    expect(mockedCreateMessage).toHaveBeenCalledTimes(3);
  });

  it("throws a clear error if the Judge does not call submit_verdict", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(textMessage("I refuse to decide"));

    const { runTribunal } = await import("../tribunal");

    await expect(runTribunal("An idea")).rejects.toThrow(
      "Expected the Judge to call submit_verdict"
    );
  });

  it("throws a clear error if an argument agent's response has no text block", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce({ content: [] })
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"));

    const { runTribunal } = await import("../tribunal");

    await expect(runTribunal("An idea")).rejects.toThrow(
      "Expected a text response from Claude"
    );
  });

  it("passes thinking disabled and high max_tokens to all argument agents", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(verdictMessage("PURSUE", "Strong case"));

    const { runTribunal } = await import("../tribunal");
    await runTribunal("An idea");

    // Check first three calls (argument agents) have thinking disabled and high max_tokens
    for (let i = 0; i < 3; i++) {
      const callArgs = mockedCreateMessage.mock.calls[i][0];
      expect(callArgs.max_tokens).toBeGreaterThanOrEqual(10000);
      expect(callArgs.thinking).toEqual({ type: "disabled" });
    }
  });

  it("rejects with a message about truncation if an argument agent returns max_tokens stop_reason", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce({ content: [{ type: "text", text: "partial" }], stop_reason: "max_tokens" })
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"));

    const { runTribunal } = await import("../tribunal");

    await expect(runTribunal("An idea")).rejects.toThrow(/truncated|max_tokens/i);
  });

  it("passes the topic to all argument agents in their user messages", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(verdictMessage("PURSUE", "Strong case"));

    const { runTribunal } = await import("../tribunal");
    const topic = "A subscription box for sustainable socks";
    await runTribunal(topic);

    // Check first three calls (argument agents) have the topic in their messages
    for (let i = 0; i < 3; i++) {
      const callArgs = mockedCreateMessage.mock.calls[i][0];
      expect(callArgs.messages[0].content).toBe(topic);
    }
  });

  it("passes distinct system prompts to Believer, Skeptic, and Investor", async () => {
    mockedCreateMessage
      .mockResolvedValueOnce(textMessage("Believer argument"))
      .mockResolvedValueOnce(textMessage("Skeptic argument"))
      .mockResolvedValueOnce(textMessage("Investor argument"))
      .mockResolvedValueOnce(verdictMessage("PURSUE", "Strong case"));

    const { runTribunal } = await import("../tribunal");
    await runTribunal("An idea");

    // Collect system prompts from first three calls
    const believerPrompt = mockedCreateMessage.mock.calls[0][0].system;
    const skepticPrompt = mockedCreateMessage.mock.calls[1][0].system;
    const investorPrompt = mockedCreateMessage.mock.calls[2][0].system;

    // All should be distinct
    expect(believerPrompt).not.toBe(skepticPrompt);
    expect(skepticPrompt).not.toBe(investorPrompt);
    expect(believerPrompt).not.toBe(investorPrompt);

    // All should mention their role
    expect(believerPrompt).toContain("Believer");
    expect(skepticPrompt).toContain("Skeptic");
    expect(investorPrompt).toContain("Investor");
  });
});
