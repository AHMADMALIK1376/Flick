import OpenAI from 'openai';
import {
  LLMError,
  LLMProvider,
  LLMResult,
  ProviderId,
  TextCompleteParams,
  VisionCompleteParams,
} from './llm-provider';

const PROVIDER_ID: ProviderId = 'deepseek';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const JSON_ONLY_INSTRUCTION =
  'You must reply with valid JSON only. Do not include any prose, explanation, or markdown code fences.';

/**
 * DeepSeek provider adapter. DeepSeek exposes an OpenAI-compatible Chat
 * Completions API, so this reuses the `openai` SDK with a custom `baseURL`.
 * Stateless: the API key and model id arrive per call via the params.
 *
 * DeepSeek does not support vision tasks. JSON mode is requested via
 * `response_format` and reinforced with an explicit system-prompt instruction,
 * which DeepSeek follows more reliably.
 *
 * Never throws — every failure mode is surfaced as an `{ ok: false, error }`
 * LLMResult so callers can branch on the discriminant.
 */
export class DeepSeekProvider implements LLMProvider {
  readonly id: ProviderId = PROVIDER_ID;

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, jsonMode, maxTokens } = params;

    const systemContent = jsonMode
      ? `${JSON_ONLY_INSTRUCTION}\n\n${systemPrompt}`
      : systemPrompt;

    try {
      const client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });

      const response = await client.chat.completions.create({
        model: modelId,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemContent },
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

  async visionComplete(_params: VisionCompleteParams): Promise<LLMResult> {
    return {
      ok: false,
      error: {
        kind: 'unsupported',
        providerId: PROVIDER_ID,
        message: 'DeepSeek does not support vision tasks',
      },
    };
  }

  private emptyResponse(): LLMResult {
    return {
      ok: false,
      error: {
        kind: 'empty_response',
        providerId: PROVIDER_ID,
        message: 'DeepSeek returned an empty response',
      },
    };
  }

  private mapError(error: unknown): LLMError {
    // DeepSeek uses the OpenAI SDK, so errors arrive as OpenAI.APIError with a
    // status code.
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

    // Network-level failures.
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
