# Implementation Plan: Multi-Model Chat

## Overview

This plan extracts all LLM access behind a provider-agnostic `LLMService`, adds Google Gemini and DeepSeek providers alongside OpenAI, supports instant model switching, and introduces a text chat panel in the dashboard. Work proceeds bottom-up: shared types and the provider abstraction first, then the concrete providers, then the routing service, then the pipeline refactor, the settings layer, and finally the chat panel and instant-switching wiring. Each step builds on the previous and ends by integrating into the existing agent pipeline so no code is left orphaned.

All new LLM modules live under `apps/electron/src/main/agent/llm/`. The implementation language is TypeScript, matching the existing Electron app.

> Note: Property-based tests from the design's Correctness Properties section are intentionally omitted from this plan for faster implementation. A few optional example/integration tests (marked with `*`) remain for the highest-value pure logic.

## Tasks

- [ ] 1. Add dependencies, shared types, and the provider registry
  - [ ] 1.1 Add the Gemini SDK dependency
    - Add `@google/generative-ai` to `dependencies` in `apps/electron/package.json` with a pinned version
    - Run the install so `package-lock.json` is updated
    - _Requirements: 3.2_

  - [ ] 1.2 Add provider, chat, and settings types and IPC channels
    - In `apps/electron/src/shared/types.ts`: extend `Settings` with `geminiApiKey`, `deepseekApiKey`, `llmProvider`, `llmModel`; add `ChatRole`, `ChatResponseStatus`, `ChatResponse`, `ChatMessage`
    - In `apps/electron/src/shared/ipc-channels.ts`: add `CHAT_SEND = 'chat-send'` and `CHAT_RESPONSE = 'chat-response'`
    - _Requirements: 7.1, 10.3, 12.1, 12.2_

  - [ ] 1.3 Define the LLMProvider interface and shared request/result types
    - Create `apps/electron/src/main/agent/llm/providers/llm-provider.ts`
    - Define `ProviderId`, `TextCompleteParams`, `VisionCompleteParams`, `LLMErrorKind`, `LLMError`, `LLMResult`, and the `LLMProvider` interface (`textComplete`, `visionComplete`)
    - _Requirements: 1.1, 1.2_

  - [ ] 1.4 Implement the ProviderRegistry and helper functions
    - Create `apps/electron/src/main/agent/llm/provider-registry.ts`
    - Declare `PROVIDER_REGISTRY` with OpenAI (`gpt-4o-mini`, `gpt-4o`; vision true), Gemini (`gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`; vision true), DeepSeek (`deepseek-chat`; vision false)
    - Implement `getProvider`, `getModel`, `isVisionCapable`, `firstModelOf`, `visionCapableProviders`, and `DEFAULT_SELECTION`
    - _Requirements: 2.1, 2.3, 3.1, 3.3, 4.1, 4.3, 5.2, 5.3_

  - [ ]* 1.5 Write unit tests for the ProviderRegistry
    - Assert provider/model lists and vision flags match the spec exactly
    - Test `firstModelOf`, `isVisionCapable`, and `visionCapableProviders`
    - _Requirements: 2.1, 2.3, 3.1, 3.3, 4.1, 4.3_

- [ ] 2. Implement the LLM provider adapters
  - [ ] 2.1 Implement OpenAIProvider
    - Create `apps/electron/src/main/agent/llm/providers/openai-provider.ts`
    - Construct `new OpenAI({ apiKey })` per call; `textComplete` uses `chat.completions.create` with `response_format: { type: 'json_object' }` when `jsonMode`; `visionComplete` builds the `data:image/png;base64,` URL from raw base64 and sends an `image_url` content part
    - Return `LLMResult`; never throw (normalization handled in LLMService, but surface auth/HTTP/network signals)
    - _Requirements: 2.2_

  - [ ] 2.2 Implement GeminiProvider
    - Create `apps/electron/src/main/agent/llm/providers/gemini-provider.ts`
    - Use `getGenerativeModel({ model }).generateContent(...)` with `systemInstruction`; set `generationConfig.responseMimeType = 'application/json'` when `jsonMode`; pass images as `inlineData` parts (`{ mimeType, data }`, raw base64)
    - Return `LLMResult`
    - _Requirements: 3.2, 3.4_

  - [ ] 2.3 Implement DeepSeekProvider
    - Create `apps/electron/src/main/agent/llm/providers/deepseek-provider.ts`
    - Construct `new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })`; `textComplete` mirrors OpenAI with `response_format: { type: 'json_object' }` and a system-prompt instruction to reply with JSON only
    - `visionComplete` returns `{ ok: false, error: { kind: 'unsupported', providerId: 'deepseek', ... } }`
    - _Requirements: 4.2, 4.4_

  - [ ]* 2.4 Write unit tests for the provider adapters with mocked SDKs
    - Verify OpenAI uses the configured key/model (Req 2.2), Gemini sets `responseMimeType` and `inlineData` (Req 3.2, 3.4), DeepSeek uses the DeepSeek baseURL and `json_object` (Req 4.2, 4.4)
    - _Requirements: 2.2, 3.2, 3.4, 4.2, 4.4_

- [ ] 3. Implement the LLMService (routing, instant switching, vision fallback)
  - [ ] 3.1 Implement SelectionHolder, key store, and textComplete
    - Create `apps/electron/src/main/agent/llm/llm-service.ts`
    - Implement `SelectionHolder`, an in-memory `Record<ProviderId, string>` key map, `setActiveSelection` (validates against the registry), `getActiveSelection`, `setApiKey`, `hasApiKey`, and the default-provider constructor wiring the three real providers
    - Implement `textComplete`: snapshot `{providerId, modelId}` + key at call start, return `missing_key` error when no key, delegate with a 10s `AbortController` timeout, and normalize provider failures to `LLMError` (`invalid_key`, `http_error` with `httpStatus`, `network`, `timeout`, `empty_response`)
    - _Requirements: 1.1, 1.3, 1.7, 2.2, 3.2, 4.2, 6.1, 6.2, 6.3, 6.5, 7.3, 8.4, 13.1, 13.2, 13.3_

  - [ ] 3.2 Implement visionComplete with capability-aware fallback
    - Add `VisionResult` and `visionComplete` to `llm-service.ts`
    - Route to the active provider when the active model is vision-capable; otherwise route to the first registry-ordered vision-capable provider that has a stored key and tag the result with `fallbackProviderId`; return `no_vision_provider` when none has a key
    - _Requirements: 1.2, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 3.3 Write unit tests for LLMService routing and fallback
    - Use stub `LLMProvider`s that record `modelId`/`apiKey`; cover active routing, missing-key, instant switching vs in-flight snapshot, vision fallback, and error normalization
    - _Requirements: 1.3, 6.1, 6.3, 6.5, 9.1, 9.2, 9.3, 9.4, 13.1, 13.2, 13.3_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Refactor the pipeline components onto LLMService
  - [ ] 5.1 Refactor IntentClassifier to use LLMService
    - In `apps/electron/src/main/agent/intent-classifier.ts`: replace the constructor `apiKey`/OpenAI import with an injected `LLMService`; `classify` calls `llm.textComplete(SYSTEM_PROMPT, commandText, true)` and maps `LLMError.kind` to the existing `ClassificationError.type`
    - Keep `parseResponse` behavior: parse JSON, validate `action`/`target`/`confidence`, ignore unknown fields
    - _Requirements: 1.4, 14.1, 14.2, 14.3, 14.5_

  - [ ] 5.2 Refactor PageAnalyzer to use LLMService
    - In `apps/electron/src/main/agent/page-analyzer.ts`: replace OpenAI usage with the injected `LLMService`; `generatePlan` uses `textComplete(..., false)`, `analyzeScreenshot` uses `visionComplete(..., screenshot.toString('base64'))`
    - Surface `fallbackProviderId` upward; throw a typed error on `no_vision_provider` so BrowserAgent reports a failed task
    - _Requirements: 1.5, 9.3, 9.4_

  - [ ] 5.3 Wire ReactLoop, BrowserAgent, and ActionExecutor to the shared LLMService
    - Replace `apiKey: string` in `ReactLoopConfig`/`BrowserAgentConfig` with the shared `LLMService`; update `react-loop.ts`, `browser-agent.ts`, and `ActionExecutor.setBrowserConfig` so browser tasks use the current selection/keys automatically
    - _Requirements: 1.6, 9.1_

  - [ ]* 5.4 Write unit tests for the refactored classifier and analyzer
    - Verify both call the injected `LLMService` (not a vendor SDK) and that intent parsing handles malformed/extra-field input
    - _Requirements: 1.4, 1.5, 14.2, 14.3, 14.5_

- [ ] 6. Extend the settings layer for selection, keys, and migration
  - [ ] 6.1 Extend SettingsStore with defaults, obfuscation, and legacy migration
    - In `apps/electron/src/main/settings-store.ts`: add defaults `geminiApiKey: ''`, `deepseekApiKey: ''`, `llmProvider: ''`, `llmModel: ''`; base64-encode `openaiApiKey`/`geminiApiKey`/`deepseekApiKey` at rest and decode on `get`/`getAll`
    - On construction, migrate a legacy plaintext OpenAI key once (encode in place, set a `legacyKeyMigrated` flag); change state only when a legacy value exists
    - _Requirements: 2.4, 5.4, 6.4, 7.2, 7.4_

  - [ ] 6.2 Add per-provider API key validation helpers
    - Create a small pure validation module (e.g. `apps/electron/src/main/agent/llm/key-validation.ts`)
    - OpenAI/DeepSeek valid when the key starts with `sk-` and length >= 20; Gemini valid when length >= 20
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 6.3 Add provider/model dropdowns and per-provider key fields to the Settings panel
    - In `apps/electron/src/renderer/dashboard/dashboard.html`: add a provider dropdown (OpenAI, Google Gemini, DeepSeek) and a model dropdown populated for the selected provider; switching providers repopulates models and selects the first model
    - Add separate OpenAI/Gemini/DeepSeek key fields with format warnings on blur; preselect provider/model and prefill keys from persisted settings; send changes via `UPDATE_SETTINGS`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 7.1, 8.1, 8.2, 8.3_

  - [ ]* 6.4 Write unit tests for obfuscation, migration, and validation
    - Cover base64 round-trip and non-plaintext storage, idempotent/conditional migration, and the validation rules
    - _Requirements: 7.2, 7.4, 8.1, 8.2, 8.3_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement chat command processing and the chat panel
  - [ ] 8.1 Implement AgentService.processChatCommand and LLMService ownership
    - In `apps/electron/src/main/agent/agent-service.ts`: own the `LLMService`, construct `IntentClassifier(llmService)`, and expose `setActiveSelection`/`setProviderApiKey` setters
    - Add `processChatCommand(text): Promise<ChatResponse>`: return `disabled` when agent mode off; `error` on missing key/LLM failure (with description); `not_command` for dictation; `low_confidence` when confidence < 0.7; `success`/`error` from the executor with an action description; record an `ActionLogEntry` identical to voice commands
    - Update the voice `process` path so any LLM failure falls back to dictation
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.4, 13.5_

  - [ ] 8.2 Add the CHAT_SEND IPC handler and preload methods
    - In `apps/electron/src/main/main.ts`: register `ipcMain.handle(CHAT_SEND, ...)` delegating to `agentService.processChatCommand` and returning the `ChatResponse`
    - In `apps/electron/src/preload/preload.ts`: expose `sendChatCommand(text)` (invoke) and `onChatResponse(cb)` (reserved push channel)
    - _Requirements: 10.3, 11.1_

  - [ ] 8.3 Add the Chat panel UI to the dashboard
    - In `apps/electron/src/renderer/dashboard/dashboard.html`: add a sidebar "Chat" nav item and `#panel-chat` with `#chat-history`, `#chat-input`, and `#chat-send`
    - `sendChat()` trims input (no-op when empty), appends a user message, clears input immediately, shows a pending indicator, autoscrolls, calls `sendChatCommand`, then replaces the pending indicator with the agent message; Enter sends when non-empty, Shift+Enter inserts a newline; render newest at the bottom
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 8.4 Write an integration test for the chat round trip
    - Exercise renderer -> preload -> main -> `AgentService.processChatCommand` -> `ChatResponse` with a stub `LLMService`
    - _Requirements: 11.1, 11.4_

- [ ] 9. Wire instant model switching and key updates
  - [ ] 9.1 Apply selection and key changes in the settings handler
    - In `apps/electron/src/main/main.ts` `UPDATE_SETTINGS`: on `llmProvider`/`llmModel` call `agentService.setActiveSelection(provider, model)` and persist; on `openaiApiKey`/`geminiApiKey`/`deepseekApiKey` call `agentService.setProviderApiKey(providerId, key)`; run the legacy-key migration and seed `LLMService` keys/selection from persisted settings on startup
    - _Requirements: 6.1, 6.2, 6.4, 7.3_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional tests and can be skipped for a faster MVP; per the project request, property-based tests are omitted and only select example/integration tests remain.
- Each task references specific requirement sub-clauses for traceability.
- Providers are stateless (key/model passed per call), so instant switching is a no-op at the provider layer and the `LLMService` selection/key state drives behavior.
- Checkpoints (tasks 4, 7, 10) ensure incremental validation; they are not part of the dependency graph.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.2", "2.3", "6.1", "6.2"] },
    { "id": 2, "tasks": ["1.5", "2.4", "3.1", "6.3", "6.4"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3", "5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["5.4", "8.1"] },
    { "id": 6, "tasks": ["8.2"] },
    { "id": 7, "tasks": ["8.3", "8.4", "9.1"] }
  ]
}
```
