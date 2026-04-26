import { LocalLLM } from "./local";
import { ModelConfig } from "./index";
import { Result, err, ok } from "@app/lib/error";

/**
 * Ollama provider for running local LLMs.
 * Ollama is a popular tool for running LLMs locally with a simple API.
 * 
 * Setup:
 * 1. Install Ollama: https://ollama.com/download
 * 2. Pull a model: `ollama pull llama3.2:3b`
 * 3. Set OLLAMA_BASE_URL (optional, defaults to http://localhost:11434/v1)
 * 
 * Usage:
 * - Model format: "ollama/llama3.2:3b", "ollama/qwen2.5:7b", etc.
 */

export type OllamaModel = string; // Dynamic: any model available in Ollama

export function isOllamaModel(model: string): model is OllamaModel {
  return model.startsWith("ollama/");
}

export function extractOllamaModelName(model: OllamaModel): string {
  return model.replace("ollama/", "");
}

export class OllamaLLM extends LocalLLM {
  constructor(config: ModelConfig, model: OllamaModel) {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    const modelName = extractOllamaModelName(model);
    super(config, modelName, baseUrl);
  }

  /**
   * Discover available models from Ollama.
   * Uses the Ollama-specific /api/tags endpoint.
   */
  async discoverModels(): Promise<Result<string[]>> {
    try {
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const response = await fetch(`${baseUrl}/api/tags`);
      
      if (!response.ok) {
        return err(
          "model_error",
          `Failed to discover Ollama models: ${response.statusText}`
        );
      }

      const data = await response.json() as { models: Array<{ name: string }> };
      const models = data.models.map((m) => `ollama/${m.name}`);
      
      return ok(models);
    } catch (error: any) {
      return err(
        "model_error",
        `Failed to connect to Ollama: ${error.message}`,
        error
      );
    }
  }

  maxTokens(): number {
    // Most Ollama models support at least 8K context
    // Some models like Llama 3.2 support up to 128K
    return this.config.maxTokens || 8192;
  }
}
