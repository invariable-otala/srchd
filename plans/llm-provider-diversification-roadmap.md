# Feature Roadmap: LLM Provider Diversification & Model Ranking

## Executive Summary

This roadmap extends srchd's model system to support:

1. **Local LLM Providers**: Run models locally via Ollama, LM Studio, vLLM, and OpenAI-compatible endpoints
2. **Small Language Models**: Support for efficient SLMs (1B-7B parameters) for cost-effective operations
3. **Model Ranking System**: User-driven evaluation and ranking of models based on performance

These features enable cost optimization, privacy-sensitive deployments, and data-driven model selection.

---

## Current System Analysis

### Current Model Architecture

The model system is built around a provider abstraction:

- **Provider Interface**: [`LLM`](src/models/index.ts:67-121) abstract class defines the contract
- **Supported Providers**: Anthropic, OpenAI, Google, Mistral, Moonshot AI, Deepseek, Zhipu, Stepfun, Scaleway
- **Provider Factory**: [`createLLM()`](src/models/provider.ts:77-100) instantiates provider-specific implementations
- **Model Configuration**: [`ModelConfig`](src/models/index.ts:54-57) with `maxTokens` and `thinking` level
- **Cost Tracking**: Each provider implements [`costPerTokenUsage()`](src/models/index.ts:94) for pricing

### Key Components

1. **Provider Registry** ([`src/models/provider.ts`](src/models/provider.ts))
   - Type union of all supported models
   - Provider detection from model string
   - Factory pattern for LLM instantiation

2. **LLM Interface** ([`src/models/index.ts`](src/models/index.ts))
   - [`run()`](src/models/index.ts:74-79) - Execute model with messages and tools
   - [`tokens()`](src/models/index.ts:81-86) - Estimate token count
   - [`maxTokens()`](src/models/index.ts:88) - Get model context window
   - [`cost()`](src/models/index.ts:100-120) - Calculate usage cost

3. **Token Usage Tracking** ([`src/db/schema.ts`](src/db/schema.ts))
   - [`token_usages`](src/db/schema.ts) table tracks input/output/cached/thinking tokens
   - Linked to agents and experiments
   - Used for cost analytics

4. **Agent Configuration** ([`src/db/schema.ts`](src/db/schema.ts))
   - Agents specify model and provider
   - Model config stored as JSON
   - Tools and environment variables per agent

### Extension Points

The architecture is well-designed for extension:
- ✅ Provider-agnostic LLM interface
- ✅ Factory pattern for new providers
- ✅ OpenAI-compatible client pattern (see [`ScalewayLLM`](src/models/scaleway.ts:48-59))
- ✅ Flexible model string format
- ⚠️ No model metadata or evaluation system
- ⚠️ No local provider support
- ⚠️ No model discovery mechanism

---

## Feature Design

### Feature 1: Local LLM Provider Support

#### Design Principles

- **OpenAI Compatibility**: Leverage OpenAI-compatible APIs (Ollama, LM Studio, vLLM)
- **Zero Cloud Dependency**: Models run entirely on local infrastructure
- **Flexible Endpoints**: Support custom base URLs and ports
- **Model Discovery**: Auto-detect available local models
- **Cost-Free Operation**: Local models have zero API cost

#### Supported Local Providers

| Provider | Description | API Compatibility | Model Discovery |
|----------|-------------|-------------------|-----------------|
| **Ollama** | Popular local LLM runtime | OpenAI-compatible | `/api/tags` endpoint |
| **LM Studio** | Desktop LLM application | OpenAI-compatible | Manual configuration |
| **vLLM** | High-performance inference server | OpenAI-compatible | `/v1/models` endpoint |
| **LocalAI** | Self-hosted OpenAI alternative | OpenAI-compatible | `/v1/models` endpoint |
| **Custom** | Any OpenAI-compatible endpoint | OpenAI-compatible | Manual configuration |

#### Configuration Model

```typescript
// Environment variables for local providers
OLLAMA_BASE_URL=http://localhost:11434/v1
LMSTUDIO_BASE_URL=http://localhost:1234/v1
VLLM_BASE_URL=http://localhost:8000/v1
LOCALAI_BASE_URL=http://localhost:8080/v1

// Custom endpoint format
CUSTOM_LLM_BASE_URL=http://custom-server:8080/v1
CUSTOM_LLM_API_KEY=optional-api-key
```

#### Model Naming Convention

```
Format: <provider>/<model-name>

Examples:
- ollama/llama3.2:3b
- ollama/qwen2.5:7b
- lmstudio/phi-3-mini
- vllm/mistral-7b-instruct
- custom/my-fine-tuned-model
```

### Feature 2: Small Language Model Support

#### Design Principles

- **Efficiency First**: Optimize for low-latency, low-cost operations
- **Task Specialization**: Match SLMs to appropriate tasks
- **Fallback Strategy**: Graceful degradation to larger models
- **Performance Tracking**: Monitor SLM effectiveness

#### Recommended SLMs

| Model | Size | Provider | Use Case |
|-------|------|----------|----------|
| **Llama 3.2** | 1B-3B | Ollama | Quick reasoning, classification |
| **Phi-3** | 3.8B | Ollama/LM Studio | Code generation, Q&A |
| **Qwen2.5** | 3B-7B | Ollama | Multilingual, reasoning |
| **Gemma 2** | 2B-9B | Ollama | Instruction following |
| **Mistral 7B** | 7B | vLLM/Ollama | General purpose |

#### Task-Model Mapping

```typescript
// Agent profile can specify model preferences by task type
{
  "model_preferences": {
    "quick_search": "ollama/llama3.2:3b",
    "code_generation": "ollama/phi-3-mini",
    "deep_reasoning": "anthropic/claude-sonnet-4",
    "fallback": "openai/gpt-5-mini"
  }
}
```

### Feature 3: Model Ranking & Evaluation System

#### Design Principles

- **User-Driven**: Evaluations come from actual agent performance
- **Multi-Dimensional**: Track multiple quality metrics
- **Experiment-Scoped**: Rankings can be global or per-experiment
- **Transparent**: Show evaluation data to inform model selection
- **Automated Collection**: Capture evaluations during agent runs

#### Evaluation Dimensions

| Dimension | Description | Scale |
|-----------|-------------|-------|
| **Quality** | Output correctness and usefulness | 1-5 stars |
| **Speed** | Response latency | Measured (ms) |
| **Cost** | Token cost per operation | Measured ($) |
| **Reliability** | Success rate, error frequency | Percentage |
| **Tool Use** | Effectiveness with tool calls | 1-5 stars |
| **Reasoning** | Depth and clarity of thinking | 1-5 stars |

#### Evaluation Sources

1. **Explicit User Ratings**: Manual ratings via CLI/UI
2. **Implicit Metrics**: Automatic collection during runs
   - Token usage and cost
   - Response time
   - Error rates
   - Tool call success rates
3. **Comparative Evaluations**: A/B testing between models
4. **Solution Quality**: Correlation with accepted solutions
5. **Agent Performance**: Track which agents produce best results

#### Ranking Algorithm

```
Model Score = weighted_average(
  quality_rating * 0.30,
  speed_score * 0.20,
  cost_score * 0.20,
  reliability_score * 0.15,
  tool_use_rating * 0.10,
  reasoning_rating * 0.05
)

Normalized to 0-100 scale
```

---

## Database Schema Changes

### New Tables

#### `model_metadata` - Model Information Registry

```typescript
export const model_metadata = sqliteTable(
  "model_metadata",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    
    // Model identification
    model: text("model").notNull().unique(), // e.g., "ollama/llama3.2:3b"
    provider: text("provider").notNull(), // e.g., "ollama"
    display_name: text("display_name").notNull(), // e.g., "Llama 3.2 3B"
    
    // Model characteristics
    parameter_count: text("parameter_count"), // e.g., "3B", "7B", "70B"
    context_window: integer("context_window"), // e.g., 8192
    is_local: integer("is_local", { mode: "boolean" }).notNull().default(false),
    is_small: integer("is_small", { mode: "boolean" }).notNull().default(false),
    
    // Capabilities
    supports_tools: integer("supports_tools", { mode: "boolean" }).notNull().default(true),
    supports_thinking: integer("supports_thinking", { mode: "boolean" }).notNull().default(false),
    supports_vision: integer("supports_vision", { mode: "boolean" }).notNull().default(false),
    
    // Configuration
    base_url: text("base_url"), // For local/custom providers
    api_key_env: text("api_key_env"), // Environment variable name for API key
    
    // Metadata
    description: text("description"),
    tags: text("tags"), // JSON array of tags
    status: text("status", {
      enum: ["ACTIVE", "DEPRECATED", "EXPERIMENTAL"],
    }).notNull().default("ACTIVE"),
  },
  (t) => [
    index("model_metadata_idx_provider").on(t.provider),
    index("model_metadata_idx_is_local").on(t.is_local),
    index("model_metadata_idx_is_small").on(t.is_small),
  ],
);
```

#### `model_evaluations` - User Evaluations & Ratings

```typescript
export const model_evaluations = sqliteTable(
  "model_evaluations",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    
    // Context
    model: text("model").notNull(), // Model being evaluated
    experiment: integer("experiment").references(() => experiments.id),
    agent: integer("agent").references(() => agents.id),
    
    // Evaluation type
    evaluation_type: text("evaluation_type", {
      enum: ["EXPLICIT", "IMPLICIT", "COMPARATIVE"],
    }).notNull(),
    
    // Ratings (1-5 scale, nullable for implicit evaluations)
    quality_rating: integer("quality_rating"), // 1-5
    tool_use_rating: integer("tool_use_rating"), // 1-5
    reasoning_rating: integer("reasoning_rating"), // 1-5
    
    // Measured metrics (automatically collected)
    response_time_ms: integer("response_time_ms"),
    token_cost: real("token_cost"),
    success: integer("success", { mode: "boolean" }),
    error_message: text("error_message"),
    
    // Context
    task_description: text("task_description"),
    notes: text("notes"),
    
    // Comparative evaluation
    compared_to_model: text("compared_to_model"),
    preference: text("preference", {
      enum: ["THIS", "OTHER", "EQUAL"],
    }),
  },
  (t) => [
    index("model_evaluations_idx_model").on(t.model),
    index("model_evaluations_idx_experiment").on(t.experiment),
    index("model_evaluations_idx_agent").on(t.agent),
    index("model_evaluations_idx_created").on(t.created),
  ],
);
```

#### `model_rankings` - Aggregated Rankings (Materialized View)

```typescript
export const model_rankings = sqliteTable(
  "model_rankings",
  {
    id: integer("id").primaryKey(),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    
    // Scope
    model: text("model").notNull(),
    experiment: integer("experiment").references(() => experiments.id), // null = global
    
    // Aggregated scores (0-100 scale)
    overall_score: real("overall_score").notNull(),
    quality_score: real("quality_score"),
    speed_score: real("speed_score"),
    cost_score: real("cost_score"),
    reliability_score: real("reliability_score"),
    tool_use_score: real("tool_use_score"),
    reasoning_score: real("reasoning_score"),
    
    // Statistics
    evaluation_count: integer("evaluation_count").notNull(),
    success_rate: real("success_rate"),
    avg_response_time_ms: integer("avg_response_time_ms"),
    avg_cost_per_run: real("avg_cost_per_run"),
    
    // Ranking
    rank: integer("rank"), // Position in ranking (1 = best)
  },
  (t) => [
    unique().on(t.model, t.experiment),
    index("model_rankings_idx_experiment").on(t.experiment),
    index("model_rankings_idx_overall_score").on(t.overall_score),
    index("model_rankings_idx_rank").on(t.rank),
  ],
);
```

#### `agent_evaluations` - Agent Performance Evaluations

```typescript
export const agent_evaluations = sqliteTable(
  "agent_evaluations",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    
    // Context
    agent: integer("agent").notNull().references(() => agents.id),
    experiment: integer("experiment").notNull().references(() => experiments.id),
    
    // Evaluation type
    evaluation_type: text("evaluation_type", {
      enum: ["EXPLICIT", "IMPLICIT", "SOLUTION_BASED"],
    }).notNull(),
    
    // Ratings (1-5 scale, nullable for implicit evaluations)
    solution_quality_rating: integer("solution_quality_rating"), // 1-5
    collaboration_rating: integer("collaboration_rating"), // 1-5
    efficiency_rating: integer("efficiency_rating"), // 1-5
    
    // Measured metrics (automatically collected)
    publications_count: integer("publications_count"),
    accepted_publications_count: integer("accepted_publications_count"),
    citations_received: integer("citations_received"),
    solutions_proposed: integer("solutions_proposed"),
    solutions_accepted: integer("solutions_accepted"),
    avg_response_time_ms: integer("avg_response_time_ms"),
    total_cost: real("total_cost"),
    runs_count: integer("runs_count"),
    
    // Context
    task_description: text("task_description"),
    notes: text("notes"),
    
    // Time period for metrics
    period_start: integer("period_start", { mode: "timestamp" }),
    period_end: integer("period_end", { mode: "timestamp" }),
  },
  (t) => [
    index("agent_evaluations_idx_agent").on(t.agent),
    index("agent_evaluations_idx_experiment").on(t.experiment),
    index("agent_evaluations_idx_created").on(t.created),
  ],
);
```

#### `agent_rankings` - Aggregated Agent Rankings

```typescript
export const agent_rankings = sqliteTable(
  "agent_rankings",
  {
    id: integer("id").primaryKey(),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    
    // Scope
    agent: integer("agent").notNull().references(() => agents.id),
    experiment: integer("experiment").notNull().references(() => experiments.id),
    
    // Aggregated scores (0-100 scale)
    overall_score: real("overall_score").notNull(),
    solution_quality_score: real("solution_quality_score"),
    collaboration_score: real("collaboration_score"),
    efficiency_score: real("efficiency_score"),
    publication_score: real("publication_score"),
    
    // Statistics
    evaluation_count: integer("evaluation_count").notNull(),
    total_publications: integer("total_publications"),
    accepted_publications: integer("accepted_publications"),
    publication_acceptance_rate: real("publication_acceptance_rate"),
    total_citations: integer("total_citations"),
    avg_citations_per_publication: real("avg_citations_per_publication"),
    total_solutions: integer("total_solutions"),
    accepted_solutions: integer("accepted_solutions"),
    solution_acceptance_rate: real("solution_acceptance_rate"),
    avg_cost_per_run: real("avg_cost_per_run"),
    avg_response_time_ms: integer("avg_response_time_ms"),
    total_runs: integer("total_runs"),
    
    // Ranking
    rank: integer("rank"), // Position in experiment (1 = best)
  },
  (t) => [
    unique().on(t.agent, t.experiment),
    index("agent_rankings_idx_experiment").on(t.experiment),
    index("agent_rankings_idx_overall_score").on(t.overall_score),
    index("agent_rankings_idx_rank").on(t.rank),
  ],
);
```

### Modified Tables

#### `agents` - Add Model Preferences

```typescript
export const agents = sqliteTable(
  "agents",
  {
    // ... existing fields ...
    
    // NEW FIELDS:
    model_preferences: text("model_preferences"), // JSON: task-specific model mapping
    fallback_model: text("fallback_model"), // Fallback if primary model fails
  },
  // ... existing constraints ...
);
```

---

## API Changes

### Resource Layer Changes

#### New: `ModelMetadataResource`

```typescript
class ModelMetadataResource {
  // List all available models
  static async listAll(filters?: {
    provider?: string;
    isLocal?: boolean;
    isSmall?: boolean;
    status?: "ACTIVE" | "DEPRECATED" | "EXPERIMENTAL";
  }): Promise<ModelMetadataResource[]>
  
  // Get model by name
  static async getByModel(model: string): Promise<ModelMetadataResource | null>
  
  // Register new model
  static async register(data: {
    model: string;
    provider: string;
    displayName: string;
    parameterCount?: string;
    contextWindow?: number;
    isLocal: boolean;
    isSmall: boolean;
    supportsTools?: boolean;
    supportsThinking?: boolean;
    baseUrl?: string;
    description?: string;
    tags?: string[];
  }): Promise<Result<ModelMetadataResource>>
  
  // Update model metadata
  async update(data: Partial<ModelMetadata>): Promise<Result<void>>
  
  // Discover local models (Ollama, vLLM, etc.)
  static async discoverLocalModels(
    provider: "ollama" | "vllm" | "localai"
  ): Promise<Result<ModelMetadataResource[]>>
}
```

#### New: `ModelEvaluationResource`

```typescript
class ModelEvaluationResource {
  // Submit explicit evaluation
  static async submitExplicit(data: {
    model: string;
    experiment?: number;
    agent?: number;
    qualityRating?: number; // 1-5
    toolUseRating?: number; // 1-5
    reasoningRating?: number; // 1-5
    taskDescription?: string;
    notes?: string;
  }): Promise<Result<ModelEvaluationResource>>
  
  // Record implicit evaluation (automatic)
  static async recordImplicit(data: {
    model: string;
    experiment?: number;
    agent?: number;
    responseTimeMs: number;
    tokenCost: number;
    success: boolean;
    errorMessage?: string;
  }): Promise<Result<ModelEvaluationResource>>
  
  // Submit comparative evaluation
  static async submitComparative(data: {
    model: string;
    comparedToModel: string;
    preference: "THIS" | "OTHER" | "EQUAL";
    experiment?: number;
    agent?: number;
    taskDescription?: string;
    notes?: string;
  }): Promise<Result<ModelEvaluationResource>>
  
  // Get evaluations for model
  static async getForModel(
    model: string,
    options?: { experiment?: number; limit?: number }
  ): Promise<ModelEvaluationResource[]>
}
```

#### New: `ModelRankingResource`

```typescript
class ModelRankingResource {
  // Get rankings
  static async getRankings(options?: {
    experiment?: number; // null = global
    limit?: number;
    minEvaluations?: number;
  }): Promise<ModelRankingResource[]>
  
  // Get ranking for specific model
  static async getForModel(
    model: string,
    experiment?: number
  ): Promise<ModelRankingResource | null>
  
  // Recalculate rankings (run periodically)
  static async recalculate(experiment?: number): Promise<Result<void>>
  
  // Get recommended model for task
  static async getRecommendation(options: {
    experiment?: number;
    prioritize?: "quality" | "speed" | "cost";
    requiresTools?: boolean;
    requiresThinking?: boolean;
    localOnly?: boolean;
  }): Promise<ModelRankingResource | null>
}
```

#### New: `AgentEvaluationResource`

```typescript
class AgentEvaluationResource {
  // Submit explicit evaluation
  static async submitExplicit(data: {
    agent: number;
    experiment: number;
    solutionQualityRating?: number; // 1-5
    collaborationRating?: number; // 1-5
    efficiencyRating?: number; // 1-5
    taskDescription?: string;
    notes?: string;
  }): Promise<Result<AgentEvaluationResource>>
  
  // Record implicit evaluation (automatic)
  static async recordImplicit(data: {
    agent: number;
    experiment: number;
    publicationsCount: number;
    acceptedPublicationsCount: number;
    citationsReceived: number;
    solutionsProposed: number;
    solutionsAccepted: number;
    avgResponseTimeMs: number;
    totalCost: number;
    runsCount: number;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<Result<AgentEvaluationResource>>
  
  // Record solution-based evaluation
  static async recordSolutionBased(data: {
    agent: number;
    experiment: number;
    solutionAccepted: boolean;
    solutionQualityRating?: number;
    notes?: string;
  }): Promise<Result<AgentEvaluationResource>>
  
  // Get evaluations for agent
  static async getForAgent(
    agent: number,
    options?: { limit?: number }
  ): Promise<AgentEvaluationResource[]>
}
```

#### New: `AgentRankingResource`

```typescript
class AgentRankingResource {
  // Get rankings for experiment
  static async getRankings(
    experiment: number,
    options?: {
      limit?: number;
      minEvaluations?: number;
    }
  ): Promise<AgentRankingResource[]>
  
  // Get ranking for specific agent
  static async getForAgent(
    agent: number,
    experiment: number
  ): Promise<AgentRankingResource | null>
  
  // Recalculate rankings (run periodically)
  static async recalculate(experiment: number): Promise<Result<void>>
  
  // Get top performing agents
  static async getTopPerformers(
    experiment: number,
    options?: {
      limit?: number;
      sortBy?: "overall" | "solution_quality" | "collaboration" | "efficiency" | "publication";
    }
  ): Promise<AgentRankingResource[]>
  
  // Compare two agents
  static async compare(
    agent1: number,
    agent2: number,
    experiment: number
  ): Promise<{
    agent1: AgentRankingResource;
    agent2: AgentRankingResource;
    comparison: {
      overallWinner: number;
      dimensionWinners: Record<string, number>;
    };
  }>
}
```

#### Modified: `AgentResource`

```typescript
class AgentResource {
  // NEW: Get model preferences
  getModelPreferences(): Record<string, string> | null
  
  // NEW: Set model preferences
  async setModelPreferences(
    preferences: Record<string, string>
  ): Promise<Result<void>>
  
  // NEW: Get fallback model
  getFallbackModel(): string | null
  
  // NEW: Set fallback model
  async setFallbackModel(model: string): Promise<Result<void>>
}
```

### New Model Providers

#### `LocalLLM` - Base Class for Local Providers

```typescript
export abstract class LocalLLM extends LLM {
  protected client: OpenAI;
  protected model: string;
  protected baseUrl: string;
  
  constructor(config: ModelConfig, model: string, baseUrl: string, apiKey?: string) {
    super(config);
    this.model = model;
    this.baseUrl = baseUrl;
    this.client = new OpenAI({
      apiKey: apiKey || "not-needed",
      baseURL: baseUrl,
    });
  }
  
  // Local models have zero cost
  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    return 0;
  }
  
  // Abstract: Discover available models
  abstract discoverModels(): Promise<Result<string[]>>;
}
```

#### `OllamaLLM` - Ollama Provider

```typescript
export type OllamaModel = string; // Dynamic: any model in Ollama

export class OllamaLLM extends LocalLLM {
  constructor(config: ModelConfig, model: string) {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    super(config, model, baseUrl);
  }
  
  async discoverModels(): Promise<Result<string[]>> {
    // Call Ollama API to list models
    // GET http://localhost:11434/api/tags
  }
  
  // Implement run(), tokens(), maxTokens() using OpenAI client
}
```

#### `LMStudioLLM` - LM Studio Provider

```typescript
export type LMStudioModel = string; // Dynamic: loaded model

export class LMStudioLLM extends LocalLLM {
  constructor(config: ModelConfig, model: string) {
    const baseUrl = process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1";
    super(config, model, baseUrl);
  }
  
  async discoverModels(): Promise<Result<string[]>> {
    // LM Studio: check loaded model via /v1/models
  }
}
```

#### `VLLMLlm` - vLLM Provider

```typescript
export type VLLMModel = string; // Dynamic: deployed models

export class VLLMLLM extends LocalLLM {
  constructor(config: ModelConfig, model: string) {
    const baseUrl = process.env.VLLM_BASE_URL || "http://localhost:8000/v1";
    super(config, model, baseUrl);
  }
  
  async discoverModels(): Promise<Result<string[]>> {
    // vLLM: GET /v1/models
  }
}
```

#### `CustomLLM` - Custom OpenAI-Compatible Endpoint

```typescript
export type CustomModel = string; // User-defined

export class CustomLLM extends LocalLLM {
  constructor(config: ModelConfig, model: string, baseUrl: string, apiKey?: string) {
    super(config, model, baseUrl, apiKey);
  }
  
  async discoverModels(): Promise<Result<string[]>> {
    // Try /v1/models endpoint
  }
}
```

### CLI Changes

#### New Commands: Model Management

```bash
# List available models
npx tsx src/srchd.ts model list [--provider <provider>] [--local] [--small]

# Discover local models
npx tsx src/srchd.ts model discover <provider>

# Register custom model
npx tsx src/srchd.ts model register <model> \
  --provider <provider> \
  --display-name <name> \
  --base-url <url> \
  [--local] [--small] [--context-window <size>]

# Show model details
npx tsx src/srchd.ts model info <model>

# Test model connection
npx tsx src/srchd.ts model test <model>
```

#### New Commands: Model Evaluation

```bash
# Submit evaluation
npx tsx src/srchd.ts model evaluate <model> \
  --experiment <name> \
  --quality <1-5> \
  --tool-use <1-5> \
  --reasoning <1-5> \
  [--notes <text>]

# Compare two models
npx tsx src/srchd.ts model compare <model1> <model2> \
  --experiment <name> \
  --preference <model1|model2|equal> \
  [--notes <text>]

# View rankings
npx tsx src/srchd.ts model rankings [--experiment <name>] [--limit <n>]

# Get recommendation
npx tsx src/srchd.ts model recommend \
  [--experiment <name>] \
  [--prioritize quality|speed|cost] \
  [--local-only]

# Recalculate rankings
npx tsx src/srchd.ts model recalculate-rankings [--experiment <name>]
```

#### New Commands: Agent Evaluation

```bash
# Submit agent evaluation
npx tsx src/srchd.ts agent evaluate <experiment> <agent> \
  --solution-quality <1-5> \
  --collaboration <1-5> \
  --efficiency <1-5> \
  [--notes <text>]

# View agent rankings
npx tsx src/srchd.ts agent rankings <experiment> [--limit <n>]

# Compare two agents
npx tsx src/srchd.ts agent compare <experiment> <agent1> <agent2>

# Get top performing agents
npx tsx src/srchd.ts agent top-performers <experiment> \
  [--limit <n>] \
  [--sort-by overall|solution_quality|collaboration|efficiency|publication]

# Recalculate agent rankings
npx tsx src/srchd.ts agent recalculate-rankings <experiment>
```

#### Modified Commands: Agent Management

```bash
# Create agent with local model
npx tsx src/srchd.ts agent create <experiment> <profile> \
  --model ollama/llama3.2:3b

# Set model preferences
npx tsx src/srchd.ts agent set-preferences <experiment> <agent> \
  --quick-search ollama/llama3.2:3b \
  --code-generation ollama/phi-3-mini \
  --deep-reasoning anthropic/claude-sonnet-4

# Set fallback model
npx tsx src/srchd.ts agent set-fallback <experiment> <agent> <model>
```

### Web UI Changes

#### New Pages

1. **Model Registry** (`/models`)
   - List all available models
   - Filter by provider, local/cloud, small/large
   - Show model capabilities and metadata
   - Test model connection

2. **Model Rankings** (`/models/rankings`)
   - Global and per-experiment rankings
   - Sort by overall score, quality, speed, cost
   - Show evaluation statistics
   - Filter by model characteristics

3. **Model Evaluation** (`/models/:model/evaluate`)
   - Submit evaluation for a model
   - View evaluation history
   - Compare with other models
   - Show performance trends

4. **Model Comparison** (`/models/compare`)
   - Side-by-side comparison of 2-4 models
   - Show scores, costs, capabilities
   - Submit comparative evaluation

5. **Agent Rankings** (`/experiments/:id/agent-rankings`)
   - List agents ranked by performance
   - Sort by different dimensions (overall, solution quality, collaboration, efficiency, publication)
   - Show evaluation statistics
   - Visual score indicators
   - Filter and search agents

6. **Agent Evaluation** (`/experiments/:id/agents/:agentId/evaluate`)
   - Evaluation form (solution quality, collaboration, efficiency)
   - View evaluation history
   - Show performance trends over time
   - Charts for metrics

7. **Agent Comparison** (`/experiments/:id/agents/compare`)
   - Select 2-4 agents to compare
   - Side-by-side comparison table
   - Show scores, publications, solutions, costs
   - Highlight strengths and weaknesses

#### Updated Pages

1. **Agent Detail** - Show model preferences, fallback, and agent ranking/score
2. **Experiment Metrics** - Add model usage breakdown and agent performance leaderboard
3. **Token Usage** - Add model comparison charts
4. **Experiment Dashboard** - Add agent rankings widget showing top performers

---

## Implementation Phases

### Phase 1: Local Provider Infrastructure

**Goal**: Enable local LLM providers (Ollama, LM Studio, vLLM)

#### Tasks

1. **Create Base Local Provider**
   - Implement [`LocalLLM`](src/models/local.ts) abstract class
   - OpenAI-compatible client wrapper
   - Zero-cost implementation
   - Model discovery interface

2. **Implement Ollama Provider**
   - Create [`src/models/ollama.ts`](src/models/ollama.ts)
   - Implement model discovery via `/api/tags`
   - Handle Ollama-specific quirks
   - Add to provider registry

3. **Implement LM Studio Provider**
   - Create [`src/models/lmstudio.ts`](src/models/lmstudio.ts)
   - Model discovery via `/v1/models`
   - Add to provider registry

4. **Implement vLLM Provider**
   - Create [`src/models/vllm.ts`](src/models/vllm.ts)
   - Model discovery via `/v1/models`
   - Add to provider registry

5. **Implement Custom Provider**
   - Create [`src/models/custom.ts`](src/models/custom.ts)
   - Support arbitrary OpenAI-compatible endpoints
   - Flexible configuration

6. **Update Provider Registry**
   - Modify [`src/models/provider.ts`](src/models/provider.ts)
   - Add local provider types
   - Update factory function
   - Handle dynamic model names

#### Acceptance Criteria

- [ ] Ollama models can be used in agents
- [ ] LM Studio models can be used in agents
- [ ] vLLM models can be used in agents
- [ ] Custom endpoints can be configured
- [ ] Model discovery works for each provider
- [ ] Zero cost tracked for local models
- [ ] All existing tests pass

---

### Phase 2: Model Metadata System

**Goal**: Create registry and metadata for all models

#### Tasks

1. **Create Database Schema**
   - Add [`model_metadata`](src/db/schema.ts) table
   - Create migration
   - Add indexes

2. **Implement ModelMetadataResource**
   - Create [`src/resources/model_metadata.ts`](src/resources/model_metadata.ts)
   - Implement CRUD operations
   - Implement discovery methods
   - Add filtering and search

3. **Seed Initial Data**
   - Create seed script for existing cloud models
   - Add metadata for Anthropic, OpenAI, Google, etc.
   - Mark small models (< 10B parameters)

4. **Add CLI Commands**
   - `model list` command
   - `model discover` command
   - `model register` command
   - `model info` command
   - `model test` command

5. **Auto-Discovery on Startup**
   - Detect available local providers
   - Auto-register discovered models
   - Update metadata on changes

#### Acceptance Criteria

- [ ] Model metadata stored in database
- [ ] CLI commands work correctly
- [ ] Auto-discovery finds local models
- [ ] Metadata includes all relevant fields
- [ ] Filtering and search work

---

### Phase 3: Model Evaluation System

**Goal**: Implement evaluation and ranking infrastructure

#### Tasks

1. **Create Database Schema**
   - Add [`model_evaluations`](src/db/schema.ts) table
   - Add [`model_rankings`](src/db/schema.ts) table
   - Create migrations
   - Add indexes

2. **Implement ModelEvaluationResource**
   - Create [`src/resources/model_evaluation.ts`](src/resources/model_evaluation.ts)
   - Implement explicit evaluation submission
   - Implement implicit evaluation recording
   - Implement comparative evaluation

3. **Implement ModelRankingResource**
   - Create [`src/resources/model_ranking.ts`](src/resources/model_ranking.ts)
   - Implement ranking calculation algorithm
   - Implement recommendation logic
   - Add caching for performance

4. **Integrate Implicit Evaluation**
   - Modify [`src/runner/index.ts`](src/runner/index.ts)
   - Record response time, cost, success rate
   - Auto-submit implicit evaluations
   - Handle errors gracefully

5. **Add CLI Commands**
   - `model evaluate` command
   - `model compare` command
   - `model rankings` command
   - `model recommend` command
   - `model recalculate-rankings` command

6. **Scheduled Ranking Updates**
   - Create background job to recalculate rankings
   - Run hourly or on-demand
   - Update materialized view

#### Acceptance Criteria

- [ ] Evaluations can be submitted
- [ ] Implicit evaluations recorded automatically
- [ ] Rankings calculated correctly
- [ ] Recommendations work
- [ ] CLI commands functional
- [ ] Background job runs successfully

---

### Phase 4: Agent Model Preferences

**Goal**: Enable task-specific model selection

#### Tasks

1. **Update Database Schema**
   - Add `model_preferences` to [`agents`](src/db/schema.ts) table
   - Add `fallback_model` to [`agents`](src/db/schema.ts) table
   - Create migration

2. **Update AgentResource**
   - Add model preference getters/setters
   - Add fallback model getters/setters
   - Update agent creation to support preferences

3. **Implement Model Selection Logic**
   - Create [`src/runner/model_selector.ts`](src/runner/model_selector.ts)
   - Select model based on task type
   - Fallback on failure
   - Log model selection decisions

4. **Update Runner**
   - Modify [`src/runner/index.ts`](src/runner/index.ts)
   - Use model selector instead of fixed model
   - Handle model switching
   - Track which model was used per message

5. **Update Agent Profiles**
   - Add `model_preferences` to [`agents/<profile>/settings.json`](agents/)
   - Define sensible defaults for each profile
   - Document preference format

6. **Add CLI Commands**
   - `agent set-preferences` command
   - `agent set-fallback` command
   - Update `agent create` to accept preferences

#### Acceptance Criteria

- [ ] Agents can have model preferences
- [ ] Task-specific model selection works
- [ ] Fallback mechanism functional
- [ ] Agent profiles have defaults
- [ ] CLI commands work
- [ ] Model selection logged

---

### Phase 5: Web UI for Models

**Goal**: Visualize models, rankings, and evaluations

#### Tasks

1. **Create Model Registry Page**
   - New route: `/models`
   - List all models with metadata
   - Filter by provider, local/cloud, small/large
   - Search by name
   - Show capabilities (tools, thinking, vision)
   - Test connection button

2. **Create Model Rankings Page**
   - New route: `/models/rankings`
   - Show global and per-experiment rankings
   - Sort by different dimensions
   - Show evaluation statistics
   - Filter by model characteristics
   - Visual score indicators

3. **Create Model Evaluation Page**
   - New route: `/models/:model/evaluate`
   - Evaluation form (quality, tool use, reasoning)
   - View evaluation history
   - Show performance trends over time
   - Charts for metrics

4. **Create Model Comparison Page**
   - New route: `/models/compare`
   - Select 2-4 models to compare
   - Side-by-side comparison table
   - Show scores, costs, capabilities
   - Submit comparative evaluation

5. **Update Agent Detail Page**
   - Show model preferences
   - Show fallback model
   - Edit preferences inline
   - Show model usage history

6. **Update Experiment Metrics**
   - Add model usage breakdown
   - Show cost by model
   - Show performance by model
   - Model switching frequency

7. **Update Token Usage Page**
   - Add model comparison charts
   - Cost comparison by model
   - Performance comparison by model

#### Acceptance Criteria

- [ ] Model registry page functional
- [ ] Rankings page shows correct data
- [ ] Evaluation submission works
- [ ] Comparison page useful
- [ ] Agent pages show preferences
- [ ] Metrics include model breakdown
- [ ] UI is intuitive and responsive

---

### Phase 6: Agent Ranking System

**Goal**: Implement agent evaluation and ranking infrastructure

#### Tasks

1. **Create Database Schema**
   - Add [`agent_evaluations`](src/db/schema.ts) table
   - Add [`agent_rankings`](src/db/schema.ts) table
   - Create migrations
   - Add indexes

2. **Implement AgentEvaluationResource**
   - Create [`src/resources/agent_evaluation.ts`](src/resources/agent_evaluation.ts)
   - Implement explicit evaluation submission
   - Implement implicit evaluation recording
   - Implement solution-based evaluation

3. **Implement AgentRankingResource**
   - Create [`src/resources/agent_ranking.ts`](src/resources/agent_ranking.ts)
   - Implement ranking calculation algorithm
   - Implement comparison logic
   - Add caching for performance

4. **Integrate Implicit Evaluation**
   - Modify [`src/runner/index.ts`](src/runner/index.ts)
   - Collect agent performance metrics
   - Auto-submit implicit evaluations periodically
   - Track publications, citations, solutions

5. **Add CLI Commands**
   - `agent evaluate` command
   - `agent rankings` command
   - `agent compare` command
   - `agent top-performers` command
   - `agent recalculate-rankings` command

6. **Create Web UI Pages**
   - Agent rankings page (`/experiments/:id/agent-rankings`)
   - Agent evaluation page (`/experiments/:id/agents/:agentId/evaluate`)
   - Agent comparison page (`/experiments/:id/agents/compare`)
   - Update agent detail page with ranking info
   - Update experiment dashboard with leaderboard widget

7. **Scheduled Ranking Updates**
   - Create background job to recalculate agent rankings
   - Run hourly or on-demand
   - Update materialized view

#### Acceptance Criteria

- [ ] Agent evaluations can be submitted
- [ ] Implicit evaluations recorded automatically
- [ ] Rankings calculated correctly
- [ ] Comparison works between agents
- [ ] CLI commands functional
- [ ] Web UI pages complete and intuitive
- [ ] Background job runs successfully
- [ ] Leaderboard shows accurate data

---

### Phase 7: Small Language Model Optimization

**Goal**: Optimize for SLM usage and task routing

#### Tasks

1. **Create SLM Task Classifier**
   - Create [`src/runner/task_classifier.ts`](src/runner/task_classifier.ts)
   - Classify tasks as simple/medium/complex
   - Recommend appropriate model size
   - Consider context length requirements

2. **Implement Smart Routing**
   - Route simple tasks to SLMs
   - Route complex tasks to larger models
   - Consider cost vs. quality tradeoffs
   - Log routing decisions

3. **Add SLM-Specific Optimizations**
   - Shorter prompts for SLMs
   - Simplified tool schemas
   - Reduced context windows
   - Faster timeout settings

4. **Create SLM Benchmarks**
   - Benchmark suite for common tasks
   - Compare SLM vs. large model performance
   - Identify SLM sweet spots
   - Document findings

5. **Update Agent Profiles**
   - Add SLM recommendations to profiles
   - Define task complexity levels
   - Set appropriate defaults

#### Acceptance Criteria

- [ ] Task classification works
- [ ] Smart routing functional
- [ ] SLM optimizations improve performance
- [ ] Benchmarks completed
- [ ] Profiles updated with SLM guidance

---

### Phase 8: Documentation & Testing

**Goal**: Comprehensive documentation and testing

#### Tasks

1. **Update Core Documentation**
   - Update [`AGENTS.md`](AGENTS.md) with model system
   - Document local provider setup
   - Document evaluation system
   - Add model selection guide

2. **Create Setup Guides**
   - Ollama setup guide
   - LM Studio setup guide
   - vLLM setup guide
   - Custom endpoint guide

3. **Create Best Practices Guide**
   - When to use local vs. cloud models
   - When to use SLMs vs. large models
   - How to evaluate models effectively
   - Cost optimization strategies

4. **Write Unit Tests**
   - Test local provider implementations
   - Test model metadata operations
   - Test evaluation calculations
   - Test ranking algorithm

5. **Write Integration Tests**
   - Test end-to-end local model usage
   - Test model discovery
   - Test evaluation workflow
   - Test model switching

6. **Create Examples**
   - Example: Cost-optimized agent with SLMs
   - Example: Privacy-focused agent with local models
   - Example: Hybrid agent with model preferences
   - Example: Model evaluation workflow

#### Acceptance Criteria

- [ ] Documentation complete and accurate
- [ ] Setup guides tested
- [ ] Best practices documented
- [ ] All tests pass
- [ ] Examples work correctly

---

## Migration Strategy

### Backward Compatibility

**Existing Behavior Preserved**:
- All existing agents continue to work with their configured models
- Existing cloud providers unchanged
- No breaking changes to agent configuration
- Token usage tracking continues to work

### Migration Steps for Users

1. **Update Database Schema**
   ```bash
   npx drizzle-kit generate
   npx drizzle-kit migrate
   ```

2. **Seed Model Metadata** (automatic on first run)
   ```bash
   npx tsx src/srchd.ts model list
   # Auto-seeds existing cloud models
   ```

3. **Install Local Provider** (optional)
   ```bash
   # Install Ollama
   curl -fsSL https://ollama.com/install.sh | sh
   
   # Pull a model
   ollama pull llama3.2:3b
   ```

4. **Discover Local Models**
   ```bash
   npx tsx src/srchd.ts model discover ollama
   ```

5. **Create Agent with Local Model**
   ```bash
   npx tsx src/srchd.ts agent create my-exp research \
     --model ollama/llama3.2:3b
   ```

6. **Start Evaluating Models**
   ```bash
   # Automatic implicit evaluations during runs
   npx tsx src/srchd.ts agent run my-exp my-agent
   
   # Manual evaluation
   npx tsx src/srchd.ts model evaluate ollama/llama3.2:3b \
     --experiment my-exp --quality 4 --tool-use 5
   ```

### Rollback Plan

If issues arise:
1. Database schema is additive (no data loss)
2. Disable local providers by removing environment variables
3. Agents fall back to configured cloud models
4. Report issues to development team

---

## Configuration Examples

### Environment Variables

```bash
# Ollama (default: http://localhost:11434/v1)
OLLAMA_BASE_URL=http://localhost:11434/v1

# LM Studio (default: http://localhost:1234/v1)
LMSTUDIO_BASE_URL=http://localhost:1234/v1

# vLLM (default: http://localhost:8000/v1)
VLLM_BASE_URL=http://localhost:8000/v1

# LocalAI
LOCALAI_BASE_URL=http://localhost:8080/v1

# Custom endpoint
CUSTOM_LLM_BASE_URL=http://my-server:8080/v1
CUSTOM_LLM_API_KEY=optional-key

# Existing cloud providers (unchanged)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
```

### Agent Profile with Model Preferences

```json
{
  "model": "ollama/llama3.2:3b",
  "model_preferences": {
    "quick_search": "ollama/llama3.2:3b",
    "classification": "ollama/qwen2.5:3b",
    "code_generation": "ollama/phi-3-mini",
    "deep_reasoning": "anthropic/claude-sonnet-4",
    "review": "openai/gpt-5-mini"
  },
  "fallback_model": "openai/gpt-5-mini",
  "thinking": "low",
  "tools": ["publications", "goal_solution"],
  "environment": {}
}
```

### Model Metadata Example

```json
{
  "model": "ollama/llama3.2:3b",
  "provider": "ollama",
  "display_name": "Llama 3.2 3B",
  "parameter_count": "3B",
  "context_window": 8192,
  "is_local": true,
  "is_small": true,
  "supports_tools": true,
  "supports_thinking": false,
  "supports_vision": false,
  "base_url": "http://localhost:11434/v1",
  "description": "Fast, efficient model for quick reasoning tasks",
  "tags": ["local", "small", "efficient", "llama"],
  "status": "ACTIVE"
}
```

---

## Performance Considerations

### Local Model Performance

**Advantages**:
- Zero API cost
- No network latency (if running locally)
- Privacy (data never leaves infrastructure)
- No rate limits

**Considerations**:
- Requires GPU/CPU resources
- Slower inference than cloud (depending on hardware)
- Limited by local hardware capabilities
- Model loading time

### Optimization Strategies

1. **Model Caching**: Keep frequently-used models loaded
2. **Batch Processing**: Group requests to same model
3. **Smart Routing**: Use SLMs for simple tasks
4. **Parallel Execution**: Run multiple local models simultaneously
5. **Fallback Strategy**: Cloud models for complex tasks

### Database Performance

**Critical Indexes**:
- `model_evaluations.model` - For evaluation queries
- `model_evaluations.created` - For time-based queries
- `model_rankings.overall_score` - For ranking queries
- `model_metadata.provider` - For provider filtering

**Query Optimization**:
- Cache rankings (refresh hourly)
- Aggregate evaluations in background job
- Use materialized view for rankings
- Limit evaluation history queries

---

## Security Considerations

### Local Provider Security

**Risks**:
- Local endpoints may not have authentication
- Network exposure of local services
- Model poisoning (malicious models)
- Resource exhaustion attacks

**Mitigations**:
- Bind local providers to localhost only
- Use firewall rules to restrict access
- Validate model sources
- Set resource limits (memory, CPU)
- Monitor for unusual activity

### Evaluation Data Privacy

**Considerations**:
- Evaluations may contain sensitive task descriptions
- Model performance data may be proprietary
- Comparative evaluations reveal strategy

**Mitigations**:
- Experiment-scoped evaluations
- Optional anonymization of task descriptions
- Access control for evaluation data
- Audit logging for evaluation access

---

## Cost Analysis

### Cost Comparison: Cloud vs. Local

| Scenario | Cloud Cost | Local Cost | Savings |
|----------|------------|------------|---------|
| **1M tokens (GPT-5-mini)** | $0.25 input + $2 output = $2.25 | $0 (hardware amortized) | 100% |
| **1M tokens (Claude Sonnet)** | $3 input + $15 output = $18 | $0 | 100% |
| **100 agent runs/day** | ~$50-200/day | $0 API cost | ~$1,500-6,000/month |

**Local Infrastructure Costs**:
- GPU server: $1,000-5,000 one-time + $50-200/month power
- Break-even: 1-3 months for heavy usage
- Scales better for high-volume workloads

### Cost Optimization Strategies

1. **Use SLMs for Simple Tasks**: 10-100x faster, same quality
2. **Local Models for Iteration**: Free experimentation
3. **Cloud Models for Production**: Quality-critical tasks
4. **Hybrid Approach**: Best of both worlds
5. **Evaluation-Driven Selection**: Data-driven cost optimization

---

## Future Enhancements

### Beyond This Roadmap

1. **Advanced Model Selection**
   - ML-based task classification
   - Automatic model selection based on historical performance
   - Multi-model ensembles
   - Dynamic model switching mid-conversation

2. **Model Fine-Tuning Integration**
   - Fine-tune local models on agent data
   - Track fine-tuned model performance
   - A/B test fine-tuned vs. base models
   - Export training data from evaluations

3. **Distributed Inference**
   - Load balancing across multiple local servers
   - Model sharding for large models
   - Kubernetes-based model serving
   - Auto-scaling based on demand

4. **Advanced Evaluation**
   - Automated benchmark suites
   - Continuous evaluation pipelines
   - Regression detection
   - Performance alerts

5. **Model Marketplace**
   - Share model configurations
   - Community model ratings
   - Pre-configured model bundles
   - Model recommendation engine

6. **Cost Optimization Tools**
   - Cost forecasting
   - Budget alerts
   - Cost attribution by task type
   - ROI analysis for local infrastructure

---

## Success Metrics

### Adoption Metrics

- **Local Model Usage**: % of agent runs using local models
- **SLM Adoption**: % of tasks routed to SLMs
- **Model Diversity**: Number of different models in use
- **Evaluation Participation**: % of runs with evaluations

### Performance Metrics

- **Cost Reduction**: % decrease in API costs
- **Response Time**: P50/P95 latency by model type
- **Success Rate**: % of successful runs by model
- **Quality Score**: Average quality rating by model

### System Health

- **Model Discovery**: Success rate of auto-discovery
- **Evaluation Coverage**: % of models with evaluations
- **Ranking Freshness**: Time since last ranking update
- **Database Performance**: Query latency for rankings

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Local provider setup complexity | High | Medium | Comprehensive setup guides, auto-discovery |
| Model compatibility issues | Medium | High | Thorough testing, fallback mechanisms |
| Performance degradation with SLMs | Medium | Medium | Task classification, quality monitoring |
| Evaluation bias | Medium | Medium | Multiple evaluation sources, statistical validation |
| Database performance issues | Low | Medium | Proper indexing, caching, background jobs |
| Security vulnerabilities | Low | High | Security review, access controls, monitoring |

---

## Conclusion

This roadmap transforms srchd into a flexible, cost-effective AI agent platform by:

1. **Enabling Local LLMs**: Run models on your own infrastructure for privacy and cost savings
2. **Supporting SLMs**: Use efficient small models for appropriate tasks
3. **Data-Driven Model Selection**: Evaluate and rank models based on actual performance

The phased approach ensures each component is thoroughly tested, and the migration strategy protects existing installations. By following this roadmap, srchd users will gain:

- **Cost Flexibility**: Choose between cloud and local based on needs
- **Performance Optimization**: Match model size to task complexity
- **Data-Driven Decisions**: Select models based on empirical evidence
- **Privacy Options**: Keep sensitive data on local infrastructure

The system remains backward compatible while opening new possibilities for experimentation, optimization, and scale.