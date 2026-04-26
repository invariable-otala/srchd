import { LocalLLM } from "./local";
import { ModelConfig } from "./index";
import { Result, err, ok } from "@app/lib/error";

/**
 * LM Studio provider for running local LLMs.
 * LM Studio is a desktop application for running LLMs locally with a user-friendly interface.
 * 
 * Setup:
 * 1. Download LM Studio: https://lmstudio.ai/
 * 2. Load a model in LM Studio
 * 3. Start the local server in LM Studio
 * 4. Set LMSTUDIO_BASE_URL (optional, defaults to http://localhost:1234/v1)
 * 
 * Usage:
 * - Model format: "lmstudio/phi-3-mini", "lmstudio/llama-3.2-3b", etc.
 * - The model name should match what's loaded in LM Studio
 */

export type LMStudioModel = string; // Dynamic: loaded model in LM Studio

export function isLMStudioModel(model: string): model is LMStudioModel {
  return model.startsWith("lmstudio/");
}

export function extractLMStudioModelName(model: LMStudioModel): string {
  return model.replace("lmstudio/", "");
}

export class LMStudioLLM extends LocalLLM {
  constructor(config: ModelConfig, model: LMStudioModel) {
    const baseUrl = process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1";
    const modelName = extractLMStudioModelName(model);
    super(config, modelName, baseUrl);
  }

  /**
   * Discover available models from LM Studio.
   * Uses the OpenAI-compatible /v1/models endpoint.
   */
  async discoverModels(): Promise<Result<string[]>> {
    try {
      const response = await this.client.models.list();
      const models = response.data.map((m) => `lmstudio/${m.id}`);
      
      return ok(models);
    } catch (error: any) {
      return err(
        "model_error",
        `Failed to discover LM Studio models: ${error.message}`,
        error
      );
    }
  }

  maxTokens(): number {
    // LM Studio models vary, default to 8K
    return this.config.maxTokens || 8192;
  }
}
