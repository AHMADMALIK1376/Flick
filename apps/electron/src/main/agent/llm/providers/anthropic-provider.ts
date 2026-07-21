import Anthropic from '@anthropic-ai/sdk';
import {
  LLMError,
  LLMProvider,
  LLMResult,
  ProviderId,
  TextCompleteParams,
  VisionCompleteParams,
} from './llm-provider';

const PROVIDER_ID: ProviderId = 'anthropic';

/** Default max_tokens when the caller does not specify one (the Messages API requires it). */
const DEFAULT_MAX_TOKENS = 1024;

const JSON_ONLY_INSTRUCTION =
  'You must reply with valid JSON only. Do not include any prose, explanation, or markdown code fences.';

/**
 * Anthropic (Claude) provider adapter. Wraps the official `@anthropic-ai/sdk`
 * Messages API. Stateless: the API key and model id arrive per call via the
 * params, so a single instance serves all requests and key/model switches take
 * effect on the next call.
 *
 * Claude has no native JSON-response mode, so JSON output is requested via an
 * explicit system-prompt instruction (Claude follows this reliably) and any
 * stray markdown fences are stripped before returning.
 *
 * Adaptive thinking and sampling parameters are intentionally omitted — intent
 * classification is a short, latency-sensitive call, and on the Opus 4.x /
 * Sonnet 4.6 family `temperature`/`top_p`/`top_k` are rejected outright.
 *
 * Never throws — every failure mode is surfaced as an `{ ok: false, error }`
 * LLMResult so callers can branch on the discriminant.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id: ProviderId = PROVIDER_ID;

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, jsonMode, maxTokens } = params;

    const system = jsonMode ? `${JSON_ONLY_INSTRUCTION}\n\n${systemPrompt}` : systemPrompt;

    try {
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = this.extractText(response, jsonMode);
      if (!text) {
        return this.emptyResponse();
      }

      return { ok: true, text };
    } catch (error: unknown) {
      return { ok: false, error: this.mapError(error) };
    }
  }

  async visionComplete(params: VisionCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, imageBase64, jsonMode, maxTokens } = params;

    const system = jsonMode ? `${JSON_ONLY_INSTRUCTION}\n\n${systemPrompt}` : systemPrompt;

    try {
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
              },
            ],
          },
        ],
      });

      const text = this.extractText(response, jsonMode);
      if (!text) {
        return this.emptyResponse();
      }

      return { ok: true, text };
    } catch (error: unknown) {
      return { ok: false, error: this.mapError(error) };
    }
  }

  /**
   * Concatenates the text blocks of a Messages API response. When `jsonMode` is
   * set, strips a surrounding ```json / ``` markdown fence if the model added one.
   */
  private extractText(response: Anthropic.Message, jsonMode: boolean): string {
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!jsonMode) {
      return text;
    }
    return text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private emptyResponse(): LLMResult {
    return {
      ok: false,
      error: {
        kind: 'empty_response',
        providerId: PROVIDER_ID,
        message: 'Anthropic returned an empty response',
      },
    };
  }

  private mapError(error: unknown): LLMError {
    // Anthropic SDK errors carry an HTTP status, mirroring the OpenAI adapter.
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        return {
          kind: 'invalid_key',
          providerId: PROVIDER_ID,
          message: error.message || 'Invalid API key',
          httpStatus: 401,
        };
      }
      if (typeof error.status === 'number') {
        return {
          kind: 'http_error',
          providerId: PROVIDER_ID,
          message: error.message || `HTTP ${error.status} error`,
          httpStatus: error.status,
        };
      }
    }

    // Network-level failures (connection refused, DNS failure, reset, etc.).
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('network') ||
        msg.includes('fetch failed') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout')
      ) {
        return {
          kind: 'network',
          providerId: PROVIDER_ID,
          message: `Network error: ${error.message}`,
        };
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return { kind: 'http_error', providerId: PROVIDER_ID, message };
  }
}
