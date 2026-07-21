import { ProviderId } from './providers/llm-provider';

/**
 * Validates an API key against the per-provider format rules.
 *
 * - OpenAI / DeepSeek: must start with `sk-` and be at least 20 characters.
 * - Anthropic: must start with `sk-ant-` and be at least 20 characters.
 * - Gemini: must be at least 20 characters.
 */
export function validateApiKey(providerId: ProviderId, key: string): boolean {
  const trimmed = key.trim();
  switch (providerId) {
    case 'openai':
    case 'deepseek':
      return trimmed.startsWith('sk-') && trimmed.length >= 20;
    case 'anthropic':
      return trimmed.startsWith('sk-ant-') && trimmed.length >= 20;
    case 'gemini':
      return trimmed.length >= 20;
    default:
      return false;
  }
}
