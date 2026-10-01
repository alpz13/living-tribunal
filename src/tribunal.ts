import { createMessage, getDefaultModel } from "./anthropic-client";

const MAX_ARGUMENT_TOKENS = 16000;
const MAX_VERDICT_TOKENS = 16000;

const BELIEVER_SYSTEM_PROMPT =
  "You are the Believer, a member of the Living Tribunal, a panel that evaluates " +
  "business ideas. Given an idea, make the strongest possible case for why it could " +
  "work: identify concretely who would buy it, why they'd choose it over " +
  "alternatives, and what makes now the right time. Do not mention weaknesses or " +
  "hedge — argue only the case for pursuing it, as persuasively as you can.";

const SKEPTIC_SYSTEM_PROMPT =
  "You are the Skeptic, a member of the Living Tribunal, a panel that evaluates " +
  "business ideas. Given an idea, attack it: explain concretely why customers " +
  "won't pay for it, and surface every weakness, unproven assumption, or risk the " +
  "idea's proponents haven't considered. Do not soften your critique or acknowledge " +
  "upside — argue only the case against it, as sharply as you can.";

const INVESTOR_SYSTEM_PROMPT =
  "You are the Investor, a member of the Living Tribunal, a panel that evaluates " +
  "business ideas. Given an idea, judge it purely on whether it could realistically " +
  "make money: market size, willingness to pay, unit economics, and a believable " +
  "path to revenue. Ignore how exciting, novel, or well-intentioned the idea is — " +
  "argue only from financial realism.";

const JUDGE_SYSTEM_PROMPT =
  "You are the Judge of the Living Tribunal. You will be given a business idea and " +
  "three arguments about it: one from a Believer arguing for it, one from a Skeptic " +
  "arguing against it, and one from an Investor judging its financial realism. Weigh " +
  "all three and call the submit_verdict tool exactly once with your final decision: " +
  "PURSUE if the idea is clearly worth pursuing, PURSUE_WITH_CHANGES if it has real " +
  "potential but needs a specific change first, or PASS if it should not be pursued. " +
  "Your reasoning must explain how you weighed the three arguments against each other.";

export type Verdict = "PURSUE" | "PURSUE_WITH_CHANGES" | "PASS";

export interface TribunalResult {
  [key: string]: unknown;
  believerArgument: string;
  skepticArgument: string;
  investorArgument: string;
  decision: Verdict;
  reasoning: string;
}

async function runArgumentAgent(systemPrompt: string, topic: string): Promise<string> {
  const message = await createMessage({
    model: getDefaultModel(),
    max_tokens: MAX_ARGUMENT_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: topic }],
    thinking: { type: "disabled" },
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error("Argument truncated due to token limit — increase MAX_ARGUMENT_TOKENS");
  }

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Expected a text response from Claude");
  }
  return textBlock.text;
}

async function runJudge(
  topic: string,
  believerArgument: string,
  skepticArgument: string,
  investorArgument: string
): Promise<{ decision: Verdict; reasoning: string }> {
  const message = await createMessage({
    model: getDefaultModel(),
    max_tokens: MAX_VERDICT_TOKENS,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Idea: ${topic}\n\nBeliever: ${believerArgument}\n\nSkeptic: ${skepticArgument}\n\nInvestor: ${investorArgument}`,
      },
    ],
    tools: [
      {
        name: "submit_verdict",
        description: "Submit the tribunal's final verdict",
        input_schema: {
          type: "object",
          properties: {
            decision: { type: "string", enum: ["PURSUE", "PURSUE_WITH_CHANGES", "PASS"] },
            reasoning: { type: "string" },
          },
          required: ["decision", "reasoning"],
          additionalProperties: false,
        },
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: "submit_verdict" },
    thinking: { type: "disabled" },
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error("Verdict truncated due to token limit — increase MAX_VERDICT_TOKENS");
  }

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "submit_verdict") {
    throw new Error("Expected the Judge to call submit_verdict");
  }

  const input = toolUse.input as { decision?: unknown; reasoning?: unknown };
  if (typeof input.decision !== "string" || !["PURSUE", "PURSUE_WITH_CHANGES", "PASS"].includes(input.decision)) {
    throw new Error(`Invalid verdict decision: ${input.decision}`);
  }
  if (typeof input.reasoning !== "string") {
    throw new Error("Invalid verdict reasoning: must be a string");
  }

  return { decision: input.decision as Verdict, reasoning: input.reasoning };
}

export async function runTribunal(topic: string): Promise<TribunalResult> {
  const [believerArgument, skepticArgument, investorArgument] = await Promise.all([
    runArgumentAgent(BELIEVER_SYSTEM_PROMPT, topic),
    runArgumentAgent(SKEPTIC_SYSTEM_PROMPT, topic),
    runArgumentAgent(INVESTOR_SYSTEM_PROMPT, topic),
  ]);

  const { decision, reasoning } = await runJudge(
    topic,
    believerArgument,
    skepticArgument,
    investorArgument
  );

  return { believerArgument, skepticArgument, investorArgument, decision, reasoning };
}
