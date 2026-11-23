import Anthropic from '@anthropic-ai/sdk';
import {
  LLMError,
  LLMProvider,
  LLMResult,
  ProviderId,
  SearchCompleteParams,
  SearchResult,
  TextCompleteParams,
  VisionCompleteParams,
  WebSource,
} from './llm-provider';

const PROVIDER_ID: ProviderId = 'anthropic';

/** Default max_tokens when the caller does not specify one (the Messages API requires it). */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * A server-tool turn can stop early with `pause_turn`; the request is then
 * resent so the model can finish. Bounded so a stuck turn cannot loop forever.
 */
const MAX_PAUSE_CONTINUATIONS = 3;

/** How many sources to show when the model cites nothing explicitly. */
const FALLBACK_SOURCE_COUNT = 3;

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
   * Answers with Claude's built-in web search tool available. Claude decides
   * whether to search: if the prompt already holds the answer (the slides), it
   * answers directly and `searched` comes back false.
   */
  async webSearchComplete(params: SearchCompleteParams): Promise<SearchResult> {
    const { apiKey, modelId, systemPrompt, userMessage, maxTokens, maxSearches } = params;

    try {
      const client = new Anthropic({ apiKey });
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
      const content: Anthropic.ContentBlock[] = [];

      for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
        const response = await client.messages.create({
          model: modelId,
          max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
          system: systemPrompt,
          messages,
          tools: [
            { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches ?? 3 },
          ],
        });
        content.push(...response.content);
        if (response.stop_reason !== 'pause_turn') break;
        // Resend with the partial turn so the model picks up where it paused.
        messages.push({ role: 'assistant', content: response.content });
      }

      return this.parseSearchResponse(content);
    } catch (error: unknown) {
      return { ok: false, error: this.mapError(error) };
    }
  }

  /**
   * Pulls the spoken answer and its sources out of a search turn.
   *
   * Only text after the last search result counts as the answer: anything
   * before it is the model narrating ("Let me look that up"), which should not
   * be read aloud to an audience.
   */
  parseSearchResponse(content: Anthropic.ContentBlock[]): SearchResult {
    let lastResultAt = -1;
    content.forEach((block, i) => {
      if (block.type === 'web_search_tool_result') lastResultAt = i;
    });
    const searched = lastResultAt !== -1;

    const answerBlocks = content
      .slice(lastResultAt + 1)
      .filter((block): block is Anthropic.TextBlock => block.type === 'text');
    const text = answerBlocks.map((b) => b.text).join('').replace(/\s+/g, ' ').trim();
    if (!text) {
      return this.emptyResponse() as SearchResult;
    }

    const sources: WebSource[] = [];
    const seen = new Set<string>();
    const add = (url: string, title: string | null | undefined) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      sources.push({ url, title: title || url });
    };

    for (const block of answerBlocks) {
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location') add(c.url, c.title);
      }
    }

    // No explicit citations: show the top results the model searched over.
    if (searched && sources.length === 0) {
      for (const block of content) {
        if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
        for (const r of block.content) {
          if (sources.length >= FALLBACK_SOURCE_COUNT) break;
          add(r.url, r.title);
        }
      }
    }

    return { ok: true, text, sources, searched };
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
