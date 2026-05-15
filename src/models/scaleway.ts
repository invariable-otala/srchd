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

export type ScalewayModel = "qwen3.5-397b-a17b";
export function isScalewayModel(model: string): model is ScalewayModel {
  return ["qwen3.5-397b-a17b"].includes(model);
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
  "qwen3.5-397b-a17b": normalizeTokenPrices(0.6, 3.6),
};

function convertToolChoice(toolChoice: ToolChoice) {
  switch (toolChoice) {
    case "none":
    case "auto":
      return toolChoice;
    case "any":
      return "required";
    default:
      assertNever(toolChoice);
  }
}

function convertThinking(thinking: "high" | "low" | "none" | undefined) {
  switch (thinking) {
    case "high":
      return "high";
    case "low":
      return "low";
    case "none":
    case undefined:
      return undefined;
    default:
      assertNever(thinking);
  }
}

export class ScalewayLLM extends LLM {
  private client: OpenAI;
  private model: ScalewayModel;

  constructor(config: ModelConfig, model: ScalewayModel = "qwen3.5-397b-a17b") {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.SCW_API_KEY,
      baseURL: "https://api.scaleway.ai/v1",
    });
    this.model = model;
  }

  messages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    
    for (const msg of messages) {
      switch (msg.role) {
        case "user": {
          for (const content of msg.content) {
            switch (content.type) {
              case "text":
                result.push({
                  role: "user",
                  content: content.text,
                });
                break;
              case "tool_result":
                result.push({
                  role: "tool",
                  tool_call_id: content.toolUseId,
                  content: content.isError
                    ? JSON.stringify({ error: content.content })
                    : JSON.stringify(content.content),
                });
                break;
            }
          }
          break;
        }
        case "agent": {
          const textContent: string[] = [];
          const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
          
          for (const content of msg.content) {
            switch (content.type) {
              case "text":
                textContent.push(content.text);
                break;
              case "thinking":
                // Reasoning is handled separately in Scaleway's extended format
                break;
              case "tool_use":
                toolCalls.push({
                  id: content.id,
                  type: "function",
                  function: {
                    name: content.name,
                    arguments: JSON.stringify(content.input),
                  },
                });
                break;
            }
          }
          
          if (textContent.length > 0 || toolCalls.length > 0) {
            result.push({
              role: "assistant",
              content: textContent.join("\n\n") || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
          break;
        }
        default:
          assertNever(msg.role);
      }
    }
    
    return result;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>> {
    try {
      const chatMessages = this.messages(messages);
      
      // Add system message at the beginning
      const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: prompt },
        ...chatMessages,
      ];

      // Scaleway supports reasoning in chat completions
      const reasoningEffort = convertThinking(this.config.thinking);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messagesWithSystem,
        tools: tools.length > 0 ? tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as any,
          },
        })) : undefined,
        tool_choice: convertToolChoice(toolChoice),
        // @ts-ignore - Scaleway extends the API with reasoning support
        reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
      });

      const choice = response.choices[0];
      if (!choice) {
        return err("model_error", "No response from model", null);
      }

      const content: Message["content"] = [];
      
      // Check for reasoning content (Scaleway extension)
      // @ts-ignore - Scaleway may include reasoning in the response
      if (choice.message.reasoning) {
        content.push({
          type: "thinking",
          // @ts-ignore
          thinking: choice.message.reasoning,
          provider: {
            scaleway: {
              // @ts-ignore
              reasoning_content: choice.message.reasoning,
            },
          },
        });
      }
      
      // Add text content
      if (choice.message.content) {
        content.push({
          type: "text",
          text: choice.message.content,
          provider: {
            scaleway: {
              content: choice.message.content,
            },
          },
        });
      }
      
      // Add tool calls
      if (choice.message.tool_calls) {
        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === "function") {
            content.push({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments),
              provider: {
                scaleway: {
                  id: toolCall.id,
                },
              },
            });
          }
        }
      }

      const tokenUsage = response.usage
        ? {
            total: response.usage.total_tokens,
            input: response.usage.prompt_tokens,
            output: response.usage.completion_tokens,
            cached: 0,
            // @ts-ignore - Scaleway may include reasoning tokens
            thinking: response.usage.reasoning_tokens || 0,
          }
        : undefined;

      return ok({
        message: {
          role: "agent",
          content,
        },
        tokenUsage,
      });
    } catch (error) {
      return err("model_error", "Failed to run model", error);
    }
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>> {
    // Scaleway API doesn't support token counting endpoint
    // Use rough estimation: 1 token ≈ 4 characters
    const input = this.messages(messages);
    const text = JSON.stringify({ prompt, input, tools });
    return ok(Math.ceil(text.length / 4));
  }

  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    return tokenUsage.input * pricing.input + tokenUsage.output * pricing.output;
  }

  maxInputItems(): number {
    return 16384;
  }

  maxTokens(): number {
    // Scaleway context size for qwen3.5-397b-a17b
    return 200000;
  }
}
