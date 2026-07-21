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

export interface LLMProvider {
  readonly id: ProviderId;
  textComplete(params: TextCompleteParams): Promise<LLMResult>;
  visionComplete(params: VisionCompleteParams): Promise<LLMResult>;
}
