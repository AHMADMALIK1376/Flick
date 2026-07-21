import OpenAI from 'openai';
import {
  LLMError,
  LLMProvider,
  LLMResult,
  ProviderId,
  TextCompleteParams,
  VisionCompleteParams,
} from './llm-provider';

const PROVIDER_ID: ProviderId = 'openai';

/**
 * OpenAI provider adapter. Stateless: the API key and model id arrive per call
 * via the params. Wraps the official `openai` SDK's Chat Completions API.
 *
 * Never throws — every failure mode is surfaced as an `{ ok: false, error }`
 * LLMResult so callers can branch on the discriminant.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id: ProviderId = PROVIDER_ID;

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, jsonMode, maxTokens } = params;

    try {
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model: modelId,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      const text = response.choices?.[0]?.message?.content;
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

    try {
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model: modelId,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${imageBase64}` },
              },
            ],
          },
        ],
      });

      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        return this.emptyResponse();
      }

      return { ok: true, text };
    } catch (error: unknown) {
      return { ok: false, error: this.mapError(error) };
    }
  }

  private emptyResponse(): LLMResult {
    return {
      ok: false,
      error: {
        kind: 'empty_response',
        providerId: PROVIDER_ID,
        message: 'OpenAI returned an empty response',
      },
    };
  }

  private mapError(error: unknown): LLMError {
    // OpenAI SDK errors carry an HTTP status.
    if (error instanceof OpenAI.APIError) {
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
