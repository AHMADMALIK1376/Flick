import { ProviderId, LLMProvider, LLMResult, LLMError } from './providers/llm-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { GeminiProvider } from './providers/gemini-provider';
import { DeepSeekProvider } from './providers/deepseek-provider';
import { AnthropicProvider } from './providers/anthropic-provider';
import {
  isVisionCapable,
  visionCapableProviders,
  DEFAULT_SELECTION,
  getProvider,
} from './provider-registry';

/** Active provider + model the service routes requests to. */
export interface Selection {
  provider: ProviderId;
  model: string;
}

/**
 * Result of a vision-completion request. Carries the underlying `LLMResult`
 * plus an optional `fallbackProviderId` set when the active model could not
 * handle vision and the request was transparently routed to a vision-capable
 * fallback provider.
 */
export interface VisionResult {
  result: LLMResult;
  fallbackProviderId?: ProviderId; // set when vision was routed to a fallback
}

/** Default max_tokens caps for response length control. */
const DEFAULT_TEXT_MAX_TOKENS = 500;
const DEFAULT_VISION_MAX_TOKENS = 800;

/** Text/vision requests are abandoned after this many milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Default token budget limit in USD. */
const DEFAULT_BUDGET_LIMIT_USD = 0.50;

/**
 * Approximate token pricing per 1K tokens (USD).
 * Conservative estimates for GPT-4o class models.
 */
const PRICING = {
  inputPer1K: 0.005,   // $5 / 1M input tokens
  outputPer1K: 0.015,  // $15 / 1M output tokens
  imagePer1K: 0.007,   // vision image tokens ~equivalent
};

/**
 * Tracks estimated token usage and cost for budget enforcement.
 */
export class TokenBudgetTracker {
  private totalEstimatedCost = 0;
  private budgetLimitUsd: number;

  constructor(budgetLimitUsd: number = DEFAULT_BUDGET_LIMIT_USD) {
    this.budgetLimitUsd = budgetLimitUsd;
  }

  /**
   * Estimate cost of a text request and add to running total.
   * Uses rough heuristic: 1 token ≈ 4 characters.
   */
  recordTextRequest(inputChars: number, outputChars: number): void {
    const inputTokens = inputChars / 4;
    const outputTokens = outputChars / 4;
    const cost =
      (inputTokens / 1000) * PRICING.inputPer1K +
      (outputTokens / 1000) * PRICING.outputPer1K;
    this.totalEstimatedCost += cost;
  }

  /**
   * Estimate cost of a vision request and add to running total.
   * Images are roughly 765 tokens for low-detail, ~1100 for 640x480.
   */
  recordVisionRequest(inputChars: number, outputChars: number, imageTokens: number = 1100): void {
    const inputTokens = inputChars / 4 + imageTokens;
    const outputTokens = outputChars / 4;
    const cost =
      (inputTokens / 1000) * PRICING.inputPer1K +
      (outputTokens / 1000) * PRICING.outputPer1K;
    this.totalEstimatedCost += cost;
  }

  /** Check if budget is exceeded. */
  isOverBudget(): boolean {
    return this.totalEstimatedCost >= this.budgetLimitUsd;
  }

  /** Get current estimated cost. */
  getEstimatedCost(): number {
    return this.totalEstimatedCost;
  }

  /** Get the budget limit. */
  getBudgetLimit(): number {
    return this.budgetLimitUsd;
  }

  /** Reset the tracker (e.g., for a new task). */
  reset(): void {
    this.totalEstimatedCost = 0;
  }
}

/**
 * Central, provider-agnostic LLM access point.
 *
 * Owns the mutable active {@link Selection} and the in-memory per-provider API
 * key map, and routes every text/vision request to the appropriate stateless
 * provider. Selection and key changes apply to the *next* request immediately
 * (instant switching); a request already in flight keeps the selection it
 * snapshotted at call start.
 *
 * Every failure mode is returned as an `{ ok: false, error }` value — this
 * service never throws for an LLM error.
 */
export class LLMService {
  /** Mutable active selection; starts at the registry default. */
  private selection: Selection = {
    provider: DEFAULT_SELECTION.provider,
    model: DEFAULT_SELECTION.model,
  };

  /** In-memory API keys, one slot per provider (empty until configured). */
  private apiKeys: Record<ProviderId, string> = {
    openai: '',
    gemini: '',
    deepseek: '',
    anthropic: '',
  };

  /** Stateless provider adapters keyed by provider id. */
  private readonly providers: Record<ProviderId, LLMProvider>;

  /** Token budget tracker for cost enforcement. */
  readonly budgetTracker: TokenBudgetTracker;

  /**
   * @param providers Optional provider overrides (used by tests). Any provider
   * not supplied falls back to the real SDK-backed implementation.
   * @param budgetLimitUsd Optional cost limit in USD (default $0.50).
   */
  constructor(providers?: Partial<Record<ProviderId, LLMProvider>>, budgetLimitUsd?: number) {
    this.providers = {
      openai: providers?.openai ?? new OpenAIProvider(),
      gemini: providers?.gemini ?? new GeminiProvider(),
      deepseek: providers?.deepseek ?? new DeepSeekProvider(),
      anthropic: providers?.anthropic ?? new AnthropicProvider(),
    };
    this.budgetTracker = new TokenBudgetTracker(budgetLimitUsd);
  }

  // --- Selection (instant switching) ---------------------------------------

  /**
   * Switch the active provider/model. The change is validated against the
   * registry: if the provider is unknown or the model is not registered for
   * that provider, the call is ignored (and logged) and the current selection
   * is preserved.
   */
  setActiveSelection(provider: ProviderId, model: string): void {
    const providerInfo = getProvider(provider);
    if (!providerInfo) {
      console.warn(`[LLMService] Unknown provider "${provider}"; ignoring selection change`);
      return;
    }
    if (!providerInfo.models.some((m) => m.id === model)) {
      console.warn(
        `[LLMService] Model "${model}" is not registered for provider "${provider}"; ignoring selection change`,
      );
      return;
    }
    this.selection = { provider, model };
  }

  /** Returns a copy of the current active selection. */
  getActiveSelection(): Selection {
    return { ...this.selection };
  }

  // --- Keys ----------------------------------------------------------------

  /** Store the API key for a provider; applies to that provider's next request. */
  setApiKey(providerId: ProviderId, key: string): void {
    this.apiKeys[providerId] = key;
  }

  /** True when a non-empty API key is stored for the given provider. */
  hasApiKey(providerId: ProviderId): boolean {
    return this.apiKeys[providerId].trim().length > 0;
  }

  // --- Core operations -----------------------------------------------------

  /**
   * Run a text completion against the currently active selection.
   *
   * Snapshots the selection and key at call start so in-flight requests are
   * unaffected by later switches. Returns a `missing_key` error when the active
   * provider has no key; otherwise delegates to the provider under a 10s
   * timeout. Enforces max_tokens: 500 by default.
   */
  async textComplete(
    systemPrompt: string,
    userMessage: string,
    jsonMode: boolean,
    maxTokens: number = DEFAULT_TEXT_MAX_TOKENS,
  ): Promise<LLMResult> {
    // Budget check
    if (this.budgetTracker.isOverBudget()) {
      return {
        ok: false,
        error: {
          kind: 'timeout',
          message: `Token budget exceeded: estimated cost $${this.budgetTracker.getEstimatedCost().toFixed(4)} >= limit $${this.budgetTracker.getBudgetLimit().toFixed(2)}`,
        },
      };
    }

    const { provider, model } = this.selection; // snapshot at call start
    const inputChars = systemPrompt.length + userMessage.length;

    const result = await this.callWithKeyAndTimeout(provider, (p, apiKey) =>
      p.textComplete({ apiKey, modelId: model, systemPrompt, userMessage, jsonMode, maxTokens }),
    );

    // Track cost
    const outputChars = result.ok ? result.text.length : 0;
    this.budgetTracker.recordTextRequest(inputChars, outputChars);

    return result;
  }

  /**
   * Run a vision completion with capability-aware routing.
   *
   * - If the active model is vision-capable, the active provider serves it and
   *   no `fallbackProviderId` is returned.
   * - Otherwise the first registry-ordered vision-capable provider that has a
   *   stored key serves it, and its id is returned as `fallbackProviderId`.
   * - If no vision-capable provider has a key, a `no_vision_provider` error is
   *   returned.
   *
   * Enforces max_tokens: 800 by default for vision calls.
   */
  async visionComplete(
    systemPrompt: string,
    userMessage: string,
    imageBase64: string,
    jsonMode: boolean,
    maxTokens: number = DEFAULT_VISION_MAX_TOKENS,
  ): Promise<VisionResult> {
    // Budget check
    if (this.budgetTracker.isOverBudget()) {
      return {
        result: {
          ok: false,
          error: {
            kind: 'timeout',
            message: `Token budget exceeded: estimated cost $${this.budgetTracker.getEstimatedCost().toFixed(4)} >= limit $${this.budgetTracker.getBudgetLimit().toFixed(2)}`,
          },
        },
      };
    }

    const { provider, model } = this.selection; // snapshot at call start
    const inputChars = systemPrompt.length + userMessage.length;

    // Active model can handle vision directly.
    if (isVisionCapable(provider, model)) {
      const result = await this.callWithKeyAndTimeout(provider, (p, apiKey) =>
        p.visionComplete({ apiKey, modelId: model, systemPrompt, userMessage, imageBase64, jsonMode, maxTokens }),
      );
      // Track cost
      const outputChars = result.ok ? result.text.length : 0;
      this.budgetTracker.recordVisionRequest(inputChars, outputChars);
      return { result };
    }

    // Active model lacks vision: pick the first keyed vision-capable provider.
    const fallbackProviderId = visionCapableProviders().find((id) => this.hasApiKey(id));
    if (!fallbackProviderId) {
      return {
        result: {
          ok: false,
          error: {
            kind: 'no_vision_provider',
            message: 'No vision-capable provider has an API key configured',
          },
        },
      };
    }

    const fallbackModel = this.firstVisionModelOf(fallbackProviderId);
    const result = await this.callWithKeyAndTimeout(fallbackProviderId, (p, apiKey) =>
      p.visionComplete({
        apiKey,
        modelId: fallbackModel,
        systemPrompt,
        userMessage,
        imageBase64,
        jsonMode,
        maxTokens,
      }),
    );
    // Track cost
    const outputChars = result.ok ? result.text.length : 0;
    this.budgetTracker.recordVisionRequest(inputChars, outputChars);
    return { result, fallbackProviderId };
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Shared dispatch helper: verifies a key is configured for the provider,
   * then races the provider call against a 10s timeout. Returns a `missing_key`
   * error when no key is set and a `timeout` error when the call is too slow.
   */
  private async callWithKeyAndTimeout(
    providerId: ProviderId,
    call: (provider: LLMProvider, apiKey: string) => Promise<LLMResult>,
  ): Promise<LLMResult> {
    const apiKey = this.apiKeys[providerId]; // snapshot key at call start
    if (apiKey.trim().length === 0) {
      const error: LLMError = {
        kind: 'missing_key',
        providerId,
        message: `No API key configured for ${providerId}`,
      };
      return { ok: false, error };
    }

    const provider = this.providers[providerId];

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<LLMResult>((resolve) => {
      timer = setTimeout(() => {
        const error: LLMError = {
          kind: 'timeout',
          providerId,
          message: `Request to ${providerId} timed out after ${REQUEST_TIMEOUT_MS}ms`,
        };
        resolve({ ok: false, error });
      }, REQUEST_TIMEOUT_MS);
    });

    try {
      return await Promise.race([call(provider, apiKey), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** First vision-capable model id of a provider (falls back to its first model). */
  private firstVisionModelOf(providerId: ProviderId): string {
    const provider = getProvider(providerId);
    const model = provider?.models.find((m) => m.vision) ?? provider?.models[0];
    return model?.id ?? '';
  }
}
