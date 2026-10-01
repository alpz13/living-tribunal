import Anthropic from "@anthropic-ai/sdk";

export function getDefaultModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
}

export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.messages.create(params);
}
