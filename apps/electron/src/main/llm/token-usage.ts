import type { ProviderId } from './providers/llm-provider';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Image tokens, already included in inputTokens. Tracked separately so the
   * cost of vision calls is visible rather than buried in the input total. */
  imageTokens: number;
}

export interface UsageRecord extends TokenUsage {
  providerId: ProviderId;
  modelId: string;
  costUsd: number;
  timestamp: number;
  /** What produced this call, e.g. "tool-loop" or "browser-step". */
  label: string;
}

export interface ModelPrice {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** False when the figure is a rough estimate rather than a published rate. */
  exact: boolean;
}

/**
 * Published Anthropic rates. Other providers are approximate and flagged as
 * such — showing an estimate as though it were exact is worse than showing
 * nothing, because it stops people checking their real bill.
 */
const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic — published USD per million tokens.
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, exact: true },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, exact: true },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, exact: true },
};

/** Fallback when the exact model is unknown. Deliberately conservative. */
const PROVIDER_FALLBACK: Record<ProviderId, ModelPrice> = {
  anthropic: { inputPerMTok: 5, outputPerMTok: 25, exact: false },
  openai: { inputPerMTok: 2.5, outputPerMTok: 10, exact: false },
  gemini: { inputPerMTok: 1.25, outputPerMTok: 5, exact: false },
  deepseek: { inputPerMTok: 0.3, outputPerMTok: 1.2, exact: false },
  qwen: { inputPerMTok: 0.4, outputPerMTok: 1.2, exact: false },
};

export function priceFor(providerId: ProviderId, modelId: string): ModelPrice {
  return MODEL_PRICES[modelId] ?? PROVIDER_FALLBACK[providerId];
}

/**
 * Rough token count for text. Four characters per token is the usual
 * approximation; it is not exact for any tokenizer, and Urdu script costs
 * considerably more per character than English.
 */
export function estimateTextTokens(text: string): number {
  return tokensFromChars(text.length);
}

/**
 * Same approximation as {@link estimateTextTokens} for callers that already
 * have a character count, so a large prompt does not have to be re-materialised
 * as a string just to measure it.
 */
export function tokensFromChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

/**
 * Image tokens for a screenshot.
 *
 * Anthropic bills images at approximately (width x height) / 750 tokens, so a
 * 1280x720 browser screenshot is ~1229 tokens — roughly twice a short text
 * command, and it recurs on every step of a browser task.
 */
export function estimateImageTokens(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return Math.ceil((width * height) / 750);
}

export function estimateCost(
  usage: TokenUsage,
  providerId: ProviderId,
  modelId: string
): number {
  const price = priceFor(providerId, modelId);
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok
  );
}

/**
 * Records what every model call cost, per message.
 *
 * Kept separate from budget enforcement: the budget only needs a running
 * total, but showing the user where their money went needs the individual
 * records.
 */
export class UsageTracker {
  private readonly records: UsageRecord[] = [];

  /** Cap on retained records, so a long session cannot grow without bound. */
  constructor(private readonly maxRecords = 200) {}

  record(
    providerId: ProviderId,
    modelId: string,
    usage: TokenUsage,
    label: string
  ): UsageRecord {
    const entry: UsageRecord = {
      ...usage,
      providerId,
      modelId,
      costUsd: estimateCost(usage, providerId, modelId),
      timestamp: Date.now(),
      label,
    };

    this.records.push(entry);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    return entry;
  }

  /** Most recent first. */
  recent(limit = 20): UsageRecord[] {
    return this.records.slice(-limit).reverse();
  }

  last(): UsageRecord | undefined {
    return this.records[this.records.length - 1];
  }

  totals(): TokenUsage & { costUsd: number; calls: number } {
    return this.records.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        imageTokens: acc.imageTokens + r.imageTokens,
        costUsd: acc.costUsd + r.costUsd,
        calls: acc.calls + 1,
      }),
      { inputTokens: 0, outputTokens: 0, imageTokens: 0, costUsd: 0, calls: 0 }
    );
  }

  reset(): void {
    this.records.length = 0;
  }
}

/** One-line summary for logging a single call. */
export function formatUsage(record: UsageRecord): string {
  const image = record.imageTokens > 0 ? ` (${record.imageTokens} image)` : '';
  const price = priceFor(record.providerId, record.modelId);
  const approx = price.exact ? '' : ' approx';
  return (
    `${record.label}: ${record.inputTokens} in${image} + ` +
    `${record.outputTokens} out = $${record.costUsd.toFixed(4)}${approx}`
  );
}
