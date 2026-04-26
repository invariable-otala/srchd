import {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
} from "openai/resources/chat";
import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
} from "./index";

import OpenAI from "openai";
import { Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";
import { convertToolChoice } from "./openai";
import { CompletionUsage } from "openai/resources/completions";

export type ScalewayModel = "gpt-oss-120b";
export function isScalewayModel(model: string): model is ScalewayModel {
  return ["gpt-oss-120b"].includes(model);
}

type ScalewayTokenPrices = {
  input: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
): ScalewayTokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
  };
}

// Pricing based on public Scaleway rates (example values)
const TOKEN_PRICING: Record<ScalewayModel, ScalewayTokenPrices> = {
  "gpt-oss-120b": normalizeTokenPrices(0.2, 0.6),
};



export class ScalewayLLM extends LLM {
  private client: OpenAI;
  private model: ScalewayModel;

  constructor(config: ModelConfig, model: ScalewayModel = "gpt-oss-120b") {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.SCW_API_KEY,
      baseURL: "https://api.scaleway.ai/v1",
    });
    this.model = model;
  }

  messages(prompt: string, messages: Message[]) {
    const inputItems: ChatCompletionMessageParam[] = [
      { role: "system", content: prompt },
      ...removeNulls(
        messages
          .map((msg) => {
            switch (msg.role) {
              case "user":
                return msg.content.map((c) => {
                  switch (c.type) {
                    case "text":
                      return { role: "user" as const, content: c.text };
                    case "tool_result":
                      return {
                        role: "tool" as const,
                        name: c.toolUseName,
                        tool_call_id: c.toolUseId,
                        content: JSON.stringify(c.content),
                      };
                    case "thinking":
                      // Scaleway does not have a dedicated thinking field – embed as text
                      return {
                        role: "user" as const,
                        content: `Thinking: ${c.thinking}`,
                      };
                    default:
                      return undefined;
                  }
                });
              case "agent":
                const message: ChatCompletionAssistantMessageParam = {
                  role: "assistant",
                  content: null,
                };
                msg.content.forEach((c) => {
                  switch (c.type) {
                    case "text":
                      message.content = c.text;
                      break;
                    case "thinking":
                      // Scaleway does not support thinking in assistant messages
                      break;
                    case "tool_use":
                      message.tool_calls = message.tool_calls ?? [];
                      message.tool_calls.push({
                        type: "function" as const,
                        id: c.id,
                        function: {
                          name: c.name,
                          arguments: JSON.stringify(c.input),
                        },
                      });
                      break;
                  }
                });
                return [message];
            }
          })
          .flat(),
      ),
    ];

    return inputItems;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>> {
    try {
      const input = this.messages(prompt, messages);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: input,
        tool_choice: convertToolChoice(toolChoice),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as any,
          },
        })),
      });

      const message = response.choices[0].message;
      const textContent = message.content;
      const toolCalls = message.tool_calls;

      const output = [];

      if (textContent) {
        output.push({
          type: "text" as const,
          text: textContent,
          provider: null,
        });
      }

      if (toolCalls) {
        output.push(
          ...toolCalls
            .filter((t) => t.type === "function")
            .map((toolCall) => {
              return {
                type: "tool_use" as const,
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments),
                provider: null,
              };
            }),
        );
      }

      const tokenUsage = response.usage
        ? this.tokenUsage(response.usage)
        : undefined;

      return ok({
        message: {
          role: "agent",
          content: output,
        },
        tokenUsage,
      });
    } catch (error) {
      return err("model_error", "Failed to run model", error);
    }
  }

  private tokenUsage(usage: CompletionUsage): TokenUsage {
    return {
      total: usage.total_tokens,
      input: usage.prompt_tokens,
      output: usage.completion_tokens,
      cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
      thinking: 0,
    };
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>> {
    // Scaleway doesn't have a token counting API, so we approximate with 4 chars per token
    try {
      const input = this.messages(prompt, messages);
      const approx = JSON.stringify(input).length;
      return ok(Math.floor(approx / 4));
    } catch (error) {
      return err("model_error", "Failed to estimate token count", error);
    }
  }

  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    return tokenUsage.input * pricing.input + tokenUsage.output * pricing.output;
  }

  maxTokens(): number {
    // Generic large context size for Scaleway models
    return 200000;
  }
}
