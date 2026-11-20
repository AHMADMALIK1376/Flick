export type ProviderId = 'openai' | 'gemini' | 'deepseek' | 'anthropic' | 'qwen';

export interface TextCompleteParams {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  jsonMode: boolean;
  maxTokens?: number;
}

export interface VisionCompleteParams {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  imageBase64: string;
  jsonMode: boolean;
  maxTokens?: number;
}

export type LLMErrorKind =
  | 'missing_key'
  | 'invalid_key'
  | 'http_error'
  | 'network'
  | 'timeout'
  | 'empty_response'
  | 'unsupported'
  | 'no_vision_provider'
  | 'parse_error';

export interface LLMError {
  kind: LLMErrorKind;
  message: string;
  providerId?: ProviderId;
  httpStatus?: number;
}

export type LLMResult =
  | { ok: true; text: string }
  | { ok: false; error: LLMError };

/** A web page an answer drew on, shown to the presenter as a citation. */
export interface WebSource {
  title: string;
  url: string;
}

export interface SearchCompleteParams {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** Upper bound on searches the model may run for this one request. */
  maxSearches?: number;
}

/**
 * Result of a completion that was allowed to search the web. `searched` is
 * true only when the model actually ran a search — when it could answer from
 * the prompt alone it does not, and the answer is not a web answer.
 */
export type SearchResult =
  | { ok: true; text: string; sources: WebSource[]; searched: boolean }
  | { ok: false; error: LLMError };

export interface LLMProvider {
  readonly id: ProviderId;
  textComplete(params: TextCompleteParams): Promise<LLMResult>;
  visionComplete(params: VisionCompleteParams): Promise<LLMResult>;
  /**
   * Text completion with the provider's own server-side web search. Optional:
   * only providers with built-in search implement it. Without it, Flick falls
   * back to a separate search API.
   */
  webSearchComplete?(params: SearchCompleteParams): Promise<SearchResult>;
}
