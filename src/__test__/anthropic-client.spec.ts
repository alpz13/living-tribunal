import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessage, getDefaultModel } from "../anthropic-client";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

describe("anthropic-client", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalModel = process.env.ANTHROPIC_MODEL;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
    process.env.ANTHROPIC_MODEL = originalModel;
  });

  it("returns claude-sonnet-5 as the default model when ANTHROPIC_MODEL is unset", () => {
    delete process.env.ANTHROPIC_MODEL;
    expect(getDefaultModel()).toBe("claude-sonnet-5");
  });

  it("returns the override when ANTHROPIC_MODEL is set", () => {
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
    expect(getDefaultModel()).toBe("claude-haiku-4-5-20251001");
  });

  it("rejects when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      createMessage({ model: "claude-sonnet-5", max_tokens: 10, messages: [] } as never)
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("forwards params to the Anthropic SDK when a key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const params = { model: "claude-sonnet-5", max_tokens: 10, messages: [] };

    const result = await createMessage(params as never);

    expect(mockCreate).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });
});
