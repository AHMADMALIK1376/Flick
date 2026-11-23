import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  LLMError,
  LLMProvider,
  LLMResult,
  ProviderId,
  TextCompleteParams,
  VisionCompleteParams,
} from './llm-provider';

const PROVIDER_ID: ProviderId = 'gemini';

/**
 * Google Gemini provider adapter. Stateless: the API key and model id arrive
 * per call via the params. Wraps the official `@google/generative-ai` SDK.
 *
 * Gemini takes the system prompt as `systemInstruction` on the model and JSON
 * mode via `generationConfig.responseMimeType`. Images are passed as
 * `inlineData` parts with raw base64 (no `data:` URL prefix).
 *
 * Never throws — every failure mode is surfaced as an `{ ok: false, error }`
 * LLMResult so callers can branch on the discriminant.
 */
export class GeminiProvider implements LLMProvider {
  readonly id: ProviderId = PROVIDER_ID;

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    const { apiKey, modelId, systemPrompt, userMessage, jsonMode, maxTokens } = params;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt,
        generationConfig: {
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        },
      });

      const result = await model.generateContent(userMessage);
      const text = result.response.text();
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
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt,
        generationConfig: {
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        },
      });

      const result = await model.generateContent([
        userMessage,
        { inlineData: { mimeType: 'image/png', data: imageBase64 } },
      ]);
      const text = result.response.text();
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
        message: 'Gemini returned an empty response',
      },
    };
  }

  private mapError(error: unknown): LLMError {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      // Authentication failures. The Gemini SDK reports invalid keys in the
      // error message rather than via a typed status code.
      if (
        msg.includes('api key') ||
        msg.includes('api_key_invalid') ||
        msg.includes('permission denied')
      ) {
        return {
          kind: 'invalid_key',
          providerId: PROVIDER_ID,
          message: error.message,
        };
      }

      // Network-level failures.
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
