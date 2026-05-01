import { LocalLLM } from "./local";
import { ModelConfig } from "./index";
import { Result, err, ok } from "@app/lib/error";

/**
 * Custom provider for any OpenAI-compatible endpoint.
 * This allows connecting to any LLM service that implements the OpenAI API.
 * 
 * Setup:
 * 1. Set CUSTOM_LLM_BASE_URL to your endpoint (e.g., http://my-server:8080/v1)
 * 2. Set CUSTOM_LLM_API_KEY if your endpoint requires authentication (optional)
 * 
 * Usage:
 * - Model format: "custom/model-name"
 * - The model name should match what your endpoint expects
 * 
 * Examples:
 * - LocalAI: "custom/gpt-3.5-turbo"
 * - Text Generation Inference: "custom/my-model"
 * - Any OpenAI-compatible API
 */

export type CustomModel = string; // User-defined model name

export function isCustomModel(model: string): model is CustomModel {
  return model.startsWith("custom/");
}

export function extractCustomModelName(model: CustomModel): string {
  return model.replace("custom/", "");
}

export class CustomLLM extends LocalLLM {
  constructor(config: ModelConfig, model: CustomModel, baseUrl?: string, apiKey?: string) {
    const url = baseUrl || process.env.CUSTOM_LLM_BASE_URL || "http://localhost:8080/v1";
    const key = apiKey || process.env.CUSTOM_LLM_API_KEY;
    const modelName = extractCustomModelName(model);
    super(config, modelName, url, key);
  }

  /**
   * Discover available models from the custom endpoint.
   * Attempts to use the OpenAI-compatible /v1/models endpoint.
   */
  async discoverModels(): Promise<Result<string[]>> {
    try {
      const response = await this.client.models.list();
      const models = response.data.map((m) => `custom/${m.id}`);
      
      return ok(models);
    } catch (error: any) {
      // Some endpoints may not support model listing
      return err(
        "model_error",
        `Failed to discover custom models: ${error.message}. The endpoint may not support model listing.`,
        error
      );
    }
  }

  maxTokens(): number {
    // Custom models vary widely, use config or default to 8K
    return this.config.maxTokens || 8192;
  }
}
