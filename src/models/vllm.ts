import { LocalLLM } from "./local";
import { ModelConfig } from "./index";
import { Result, err, ok } from "@app/lib/error";

/**
 * vLLM provider for high-performance local LLM inference.
 * vLLM is a fast and easy-to-use library for LLM inference and serving.
 * 
 * Setup:
 * 1. Install vLLM: `pip install vllm`
 * 2. Start vLLM server: `vllm serve meta-llama/Llama-3.2-3B-Instruct --port 8000`
 * 3. Set VLLM_BASE_URL (optional, defaults to http://localhost:8000/v1)
 * 
 * Usage:
 * - Model format: "vllm/llama-3.2-3b", "vllm/mistral-7b", etc.
 * - The model name should match the deployed model
 */

export type VLLMModel = string; // Dynamic: deployed models in vLLM

export function isVLLMModel(model: string): model is VLLMModel {
  return model.startsWith("vllm/");
}

export function extractVLLMModelName(model: VLLMModel): string {
  return model.replace("vllm/", "");
}

export class VLLMLLM extends LocalLLM {
  constructor(config: ModelConfig, model: VLLMModel) {
    const baseUrl = process.env.VLLM_BASE_URL || "http://localhost:8000/v1";
    const modelName = extractVLLMModelName(model);
    super(config, modelName, baseUrl);
  }

  /**
   * Discover available models from vLLM.
   * Uses the OpenAI-compatible /v1/models endpoint.
   */
  async discoverModels(): Promise<Result<string[]>> {
    try {
      const response = await this.client.models.list();
      const models = response.data.map((m) => `vllm/${m.id}`);
      
      return ok(models);
    } catch (error: any) {
      return err(
        "model_error",
        `Failed to discover vLLM models: ${error.message}`,
        error
      );
    }
  }

  maxTokens(): number {
    // vLLM models vary, default to 8K
    // Can be configured per model
    return this.config.maxTokens || 8192;
  }
}
