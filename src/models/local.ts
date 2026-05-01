import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
  TextContent,
  ToolUse,
  Thinking,
} from "./index";
import OpenAI from "openai";
import { Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";
import {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
} from "openai/resources/chat";

/**
 * Base class for local LLM providers that use OpenAI-compatible APIs.
 * Local models have zero API cost and run on local infrastructure.
 */
export abstract class LocalLLM extends LLM {
  protected client: OpenAI;
  protected model: string;
  protected baseUrl: string;

  constructor(
    config: ModelConfig,
    model: string,
    baseUrl: string,
    apiKey?: string
  ) {
    super(config);
    this.model = model;
    this.baseUrl = baseUrl;
    this.client = new OpenAI({
      apiKey: apiKey || "not-needed", // Many local providers don't need API keys
      baseURL: baseUrl,
    });
  }

  /**
   * Convert internal message format to OpenAI format
   */
  protected messages(
    prompt: string,
    messages: Message[]
  ): ChatCompletionMessageParam[] {
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
                      // Local models typically don't have dedicated thinking fields
                      return {
                        role: "user" as const,
                        content: `[Thinking]: ${c.thinking}`,
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
                      // Most local models don't support thinking in assistant messages
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
          .flat()
      ),
    ];

    return inputItems;
  }

  /**
   * Convert tool choice to OpenAI format
   */
  protected convertToolChoice(toolChoice: ToolChoice): "auto" | "none" | "required" {
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

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[]
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>> {
    try {
      const input = this.messages(prompt, messages);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: input,
        tool_choice: this.convertToolChoice(toolChoice),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as any,
          },
        })),
        max_tokens: this.config.maxTokens,
      });

      const choice = response.choices[0];
      const apiMessage = choice.message;
      const textContent = apiMessage.content;

      const content: (TextContent | ToolUse | Thinking)[] = [];

      // Add text content if present
      if (textContent) {
        content.push({
          type: "text",
          text: textContent,
          provider: null,
        });
      }

      // Add tool calls if present
      if (apiMessage.tool_calls) {
        for (const toolCall of apiMessage.tool_calls) {
          if (toolCall.type === "function") {
            content.push({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments),
              provider: null,
            });
          }
        }
      }

      const message: Message = {
        role: "agent",
        content,
      };

      // Calculate token usage
      const usage = response.usage;
      const tokenUsage: TokenUsage | undefined = usage
        ? {
            total: usage.total_tokens || 0,
            input: usage.prompt_tokens || 0,
            output: usage.completion_tokens || 0,
            cached: 0, // Local models typically don't report cached tokens
            thinking: 0,
          }
        : undefined;

      return ok({ message, tokenUsage });
    } catch (error: any) {
      return err("model_error", `Local LLM error: ${error.message}`, error);
    }
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[]
  ): Promise<Result<number>> {
    // Rough estimation: 1 token ≈ 4 characters
    const input = this.messages(prompt, messages);
    const text = JSON.stringify(input);
    return ok(Math.ceil(text.length / 4));
  }

  maxTokens(): number {
    // Default context window for local models
    // Can be overridden by specific providers
    return this.config.maxTokens || 8192;
  }

  /**
   * Local models have zero API cost
   */
  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    return 0;
  }

  /**
   * Discover available models from the provider.
   * Each provider implements this differently.
   */
  abstract discoverModels(): Promise<Result<string[]>>;
}
