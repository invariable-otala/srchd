import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
} from "./index";
import { Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";

export type ScalewayModel = "scaleway-llama2" | "scaleway-mistral";
export function isScalewayModel(model: string): model is ScalewayModel {
  return ["scaleway-llama2", "scaleway-mistral"].includes(model);
}

// Simple token pricing placeholder (cost per million tokens)
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
  "scaleway-llama2": normalizeTokenPrices(0.2, 0.6),
  "scaleway-mistral": normalizeTokenPrices(0.25, 0.7),
};

export class ScalewayLLM extends LLM {
  private model: ScalewayModel;
  private apiKey: string;
  private endpoint: string;

  constructor(config: ModelConfig, model: ScalewayModel = "scaleway-llama2") {
    super(config);
    this.model = model;
    this.apiKey = process.env.SCW_API_KEY ?? "";
    // Default endpoint – can be overridden via env var if needed
    this.endpoint = process.env.SCW_ENDPOINT ?? "https://api.scaleway.com/llm/v1/chat/completions";
  }

  /** Convert internal Message format to the payload expected by Scaleway */
  private toPayload(messages: Message[]) {
    const payload: any[] = messages.map((msg) => {
      const role = msg.role === "agent" ? "assistant" : "user";
      return {
        role,
        content: removeNulls(
          msg.content.map((c) => {
            switch (c.type) {
              case "text":
                return { type: "text", text: c.text };
              case "tool_use":
                return {
                  type: "function",
                  name: c.name,
                  arguments: JSON.stringify(c.input),
                };
              case "tool_result":
                return {
                  type: "function_result",
                  name: c.toolUseName,
                  content: JSON.stringify(c.content),
                };
              case "thinking":
                // Scaleway does not have a dedicated thinking field – embed as text comment
                return { type: "text", text: `Thinking: ${c.thinking}` };
              default:
                assertNever(c);
            }
          }),
        ),
      };
    });
    return payload;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>> {
    try {
      const body = {
        model: this.model,
        messages: [{ role: "system", content: prompt }, ...this.toPayload(messages)],
        // Scaleway currently mirrors OpenAI's tool_choice semantics
        tool_choice: toolChoice === "any" ? "required" : toolChoice,
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description ?? "",
            parameters: t.inputSchema,
          },
        })),
      };

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const txt = await response.text();
        return err("model_error", `Scaleway API error: ${response.status}`, new Error(txt));
      }

      const data = await response.json();
      // Expected shape similar to OpenAI's chat completion
      const choice = data.choices?.[0];
      if (!choice) {
        return err("model_error", "No choice returned from Scaleway", new Error(JSON.stringify(data)));
      }

      const output: (Message["content"][number])[] = [];
      if (choice.message?.content) {
        output.push({ type: "text", text: choice.message.content, provider: null });
      }
      if (choice.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === "function") {
            output.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
              provider: null,
            });
          }
        }
      }

      // Token usage – Scaleway returns usage similar to OpenAI if available
      const tokenUsage = data.usage
        ? {
            total: data.usage.total_tokens ?? 0,
            input: data.usage.prompt_tokens ?? 0,
            output: data.usage.completion_tokens ?? 0,
            cached: 0,
            thinking: 0,
          }
        : undefined;

      return ok({
        message: { role: "agent", content: output },
        tokenUsage,
      });
    } catch (e) {
      return err("model_error", "Failed to run Scaleway model", e);
    }
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>> {
    // Use the same endpoint with a special flag if Scaleway provides a token estimator.
    // Fallback to simple approximation (4 chars per token).
    try {
      const body = {
        model: this.model,
        messages: [{ role: "system", content: prompt }, ...this.toPayload(messages)],
        tool_choice: toolChoice,
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description ?? "",
            parameters: t.inputSchema,
          },
        })),
        // Indicate we only want token count if the API supports it
        stream: false,
        max_tokens: 0,
      };

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.usage?.total_tokens) {
          return ok(data.usage.total_tokens);
        }
      }
    } catch (_) {}
    // Approximation fallback
    const approx = JSON.stringify(messages).length + prompt.length;
    return ok(Math.floor(approx / 4));
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
