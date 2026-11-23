import { ProviderId } from './providers/llm-provider';

export interface ModelInfo {
  id: string;
  displayName: string;
  vision: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  models: ModelInfo[];
}

export const PROVIDER_REGISTRY: ProviderInfo[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', vision: true },
      { id: 'gpt-4o', displayName: 'GPT-4o', vision: true },
    ],
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    models: [
      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', vision: true },
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', vision: true },
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', vision: true },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat', vision: false },
    ],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    models: [
      // Haiku first: live answers are latency-bound, and it is the fastest.
      { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5 (fastest)', vision: true },
      { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', vision: true },
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5 (best, slower)', vision: true },
    ],
  },
  {
    id: 'qwen',
    displayName: 'Alibaba Cloud (Qwen)',
    models: [
      { id: 'qwen-plus', displayName: 'Qwen Plus', vision: false },
      { id: 'qwen-max', displayName: 'Qwen Max', vision: false },
      { id: 'qwen-vl-max', displayName: 'Qwen VL Max', vision: true },
    ],
  },
];

/** Returns the provider metadata for the given provider id, or undefined. */
export function getProvider(id: ProviderId): ProviderInfo | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

/** Returns the model metadata for the given provider/model pair, or undefined. */
export function getModel(providerId: ProviderId, modelId: string): ModelInfo | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

/** True when the given provider/model pair exists and supports vision. */
export function isVisionCapable(providerId: ProviderId, modelId: string): boolean {
  return getModel(providerId, modelId)?.vision ?? false;
}

/** Returns the id of the first listed model for the provider. */
export function firstModelOf(providerId: ProviderId): string {
  const provider = getProvider(providerId);
  if (!provider || provider.models.length === 0) {
    throw new Error(`No models registered for provider "${providerId}"`);
  }
  return provider.models[0].id;
}

/** Returns the ids of all providers that have at least one vision-capable model. */
export function visionCapableProviders(): ProviderId[] {
  return PROVIDER_REGISTRY.filter((p) => p.models.some((m) => m.vision)).map((p) => p.id);
}

/** Flick is built around Claude: its built-in web search needs no extra key. */
export const DEFAULT_SELECTION = { provider: 'anthropic', model: 'claude-haiku-5-5' } as const;
