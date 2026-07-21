import {
  LLMProvider,
  LLMResult,
  ProviderId,
  TextCompleteParams,
  VisionCompleteParams,
} from './llm-provider';

/**
 * Alibaba Cloud Model Studio (DashScope), international endpoint.
 * OpenAI-compatible, so the request and response shapes match openai-provider.
 */
const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export class QwenProvider implements LLMProvider {
  readonly id: ProviderId = 'qwen';

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    return this.complete(params.apiKey, {
      model: params.modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userMessage },
      ],
      ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    });
  }

  async visionComplete(params: VisionCompleteParams): Promise<LLMResult> {
    return this.complete(params.apiKey, {
      model: params.modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: params.userMessage },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${params.imageBase64}` },
            },
          ],
        },
      ],
      ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    });
  }

  private async complete(apiKey: string, body: unknown): Promise<LLMResult> {
    if (!apiKey) {
      return {
        ok: false,
        error: {
          kind: 'missing_key',
          message: 'No Alibaba Cloud Model Studio API key configured.',
          providerId: this.id,
        },
      };
    }

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: err instanceof Error ? err.message : 'Network request failed.',
          providerId: this.id,
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          kind:
            response.status === 401 || response.status === 403
              ? 'invalid_key'
              : 'http_error',
          message: `Qwen request failed with HTTP ${response.status}.`,
          providerId: this.id,
          httpStatus: response.status,
        },
      };
    }

    let payload: { choices?: { message?: { content?: string } }[] };
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        error: {
          kind: 'parse_error',
          message: 'Qwen returned a response that was not valid JSON.',
          providerId: this.id,
        },
      };
    }

    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      return {
        ok: false,
        error: {
          kind: 'empty_response',
          message: 'Qwen returned no completion content.',
          providerId: this.id,
        },
      };
    }

    return { ok: true, text };
  }
}
